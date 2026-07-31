import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import weld from "@/data/weld.json";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import { pointInPolygon } from "@/geo/collide";
import { siteToBuilding, signedArea } from "@/geo/frames";
import {
  suiteToBuilding,
  suiteToSite,
  suiteToThree,
  suiteCornersSite,
  rectCornersSite,
  facadeAzimuth,
  gableAzimuth,
  facadeStep,
  floorLevel,
  maxSectionLength,
  GABLE_INNER_V,
  CLEAR_HALF_U,
  MAX_SECTION_LENGTH,
  WELD,
} from "@/geo/place";

const ring = weld.rings[0] as number[][];

describe("suite to building frame", () => {
  it("puts the suite's north edge on the gable's interior face", () => {
    const p = DEFAULT_PARAMS;
    const b = suiteToBuilding(0, p.sectionLength, p);
    expect(b.v).toBeCloseTo(GABLE_INNER_V, 6);
  });

  it("puts the suite's south edge one section length back from the gable", () => {
    const p = DEFAULT_PARAMS;
    const b = suiteToBuilding(0, 0, p);
    expect(b.v).toBeCloseTo(GABLE_INNER_V - p.sectionLength, 6);
  });

  it("puts u = 0 on the facade's interior face, on whichever side", () => {
    expect(suiteToBuilding(0, 0, { ...DEFAULT_PARAMS, facade: "east" }).u).toBeCloseTo(
      CLEAR_HALF_U,
      6,
    );
    expect(suiteToBuilding(0, 0, { ...DEFAULT_PARAMS, facade: "west" }).u).toBeCloseTo(
      -CLEAR_HALF_U,
      6,
    );
  });

  it("moves inward from the facade in opposite directions for east and west", () => {
    // The whole point of the facade toggle. If these had the same sign the
    // mirror option would be a no-op.
    const east = suiteToBuilding(10, 0, { ...DEFAULT_PARAMS, facade: "east" }).u;
    const west = suiteToBuilding(10, 0, { ...DEFAULT_PARAMS, facade: "west" }).u;
    expect(east).toBeLessThan(CLEAR_HALF_U);
    expect(west).toBeGreaterThan(-CLEAR_HALF_U);
    expect(Math.sign(east)).not.toBe(Math.sign(west));
  });

  it("round trips through the site frame", () => {
    const p = DEFAULT_PARAMS;
    const b = suiteToBuilding(7, 19, p);
    const s = suiteToSite(7, 19, p);
    const back = siteToBuilding(s);
    expect(back.u).toBeCloseTo(b.u, 9);
    expect(back.v).toBeCloseTo(b.v, 9);
  });

  it("sends the suite to three.js space with north on -Z", () => {
    const p = DEFAULT_PARAMS;
    const v = suiteToThree(0, p.sectionLength, floorLevel(1), p);
    expect(v).toHaveLength(3);
    expect(v[1]).toBeCloseTo(12, 6); // first floor, 12 ft up
    // the gable end is toward building north, which in three space is -Z-ish
    expect(v[2]).toBeLessThan(0);
  });
});

describe("the suite actually fits inside Weld", () => {
  // This is the integration test the project did not have. It composes rooms.ts,
  // place.ts, collide.ts, frames.ts and the real GIS footprint. Every one of
  // those could pass its own unit tests while the suite still landed in the car
  // park.

  it("has a footprint polygon with real area, so the test is not vacuous", () => {
    expect(Math.abs(signedArea(ring))).toBeGreaterThan(7000);
  });

  it("puts every room corner inside Weld's real 59-point footprint, east facade", () => {
    const suite = buildSuite({ ...DEFAULT_PARAMS, facade: "east" });
    const outside = suiteCornersSite(suite).filter(
      (c) => !pointInPolygon([c.site.x, c.site.y], ring),
    );
    expect(
      outside.map((o) => `${o.id} at ${o.site.x.toFixed(1)},${o.site.y.toFixed(1)}`),
    ).toEqual([]);
  });

  it("puts every room corner inside Weld's real footprint, west facade too", () => {
    const suite = buildSuite({ ...DEFAULT_PARAMS, facade: "west" });
    const outside = suiteCornersSite(suite).filter(
      (c) => !pointInPolygon([c.site.x, c.site.y], ring),
    );
    expect(
      outside.map((o) => `${o.id} at ${o.site.x.toFixed(1)},${o.site.y.toFixed(1)}`),
    ).toEqual([]);
  });

  it("catches a suite pushed deliberately out of the building", () => {
    // Proves the containment test above can fail. Weld's clear width at the
    // gable is 49 ft, so a suite reaching 64 ft inward from one facade must
    // punch out the far wall. 40 ft was NOT enough: measured from the east
    // facade it lands 19.5 ft past the centreline, still inside a 49 ft span,
    // which is exactly why the first version of this test passed vacuously.
    const suite = buildSuite({
      ...DEFAULT_PARAMS,
      bedDepth: 60,
      legDepth: 65,
      commonDeep: 64,
    });
    const outside = suiteCornersSite(suite).filter(
      (c) => !pointInPolygon([c.site.x, c.site.y], ring),
    );
    expect(outside.length).toBeGreaterThan(0);
  });

  it("keeps the wall bands inside the footprint as well", () => {
    const suite = buildSuite();
    const { walls } = buildWalls(suite);
    // Exclude the exterior masonry: it is the building's own wall, so it sits ON
    // the boundary and its outer face is legitimately at or outside the polygon.
    const inner = walls.filter((w) => w.kind === "partition");
    const escaped: string[] = [];
    for (const w of inner) {
      for (const site of rectCornersSite(
        { ...w, id: w.id, label: w.id, kind: "unknown", windows: [] },
        suite.params,
      )) {
        if (!pointInPolygon([site.x, site.y], ring)) escaped.push(w.id);
      }
    }
    expect([...new Set(escaped)]).toEqual([]);
  });
});

/**
 * The wing step, measured a second way.
 *
 * facadeStep() slices the ring into zones and reads each one at its own midpoint.
 * This describe block does not call any of that: it ray-casts the raw ring at two v
 * positions it picks itself, one in each zone, and asserts the implementation agrees.
 * Two independent routes to 5.17 ft is the same argument towerCentres() makes with
 * the vertex mean against the shoelace centroid -- if the zone merging ever loses a
 * boundary, this notices, and an assertion against facadeStep()'s own output would
 * not.
 */
describe("the facade step is measured off the ring, not typed in", () => {
  /** How far the raw footprint reaches on one side at v = const, in the building frame. */
  const reachAt = (v: number, facade: "east" | "west") => {
    const loop = ring.slice(0, -1).map((p) => siteToBuilding({ x: p[0]!, y: p[1]! }));
    let out = -Infinity;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const c = loop[(i + 1) % loop.length]!;
      if (a.v > v === c.v > v) continue;
      const u = a.u + ((c.u - a.u) * (v - a.v)) / (c.v - a.v);
      out = Math.max(out, facade === "east" ? u : -u);
    }
    return out;
  };

  /** v 40 is well inside the north wing zone, v 60 well inside the end zone. */
  const IN_WING = 40;
  const IN_END = 60;

  it("reproduces the dumbbell the audit describes, so the probe is not vacuous", () => {
    expect(reachAt(IN_WING, "east")).toBeCloseTo(30.607, 2);
    expect(reachAt(IN_END, "east")).toBeCloseTo(25.442, 2);
    expect(reachAt(IN_WING, "west")).toBeCloseTo(31.587, 2);
    expect(reachAt(IN_END, "west")).toBeCloseTo(26.333, 2);
  });

  it("gets the projection right on both facades, to the ring's own resolution", () => {
    for (const facade of ["east", "west"] as const) {
      const independent = reachAt(IN_WING, facade) - reachAt(IN_END, facade);
      // 0.1 ft is what these coordinates are published to; the two routes actually
      // agree to a thousandth.
      expect(facadeStep({ ...DEFAULT_PARAMS, facade }).projection, facade).toBeCloseTo(
        independent,
        1,
      );
    }
    // And the two sides differ, which is why one number for both would be wrong.
    expect(facadeStep({ ...DEFAULT_PARAMS, facade: "east" }).projection).toBeCloseTo(5.165, 3);
    expect(facadeStep({ ...DEFAULT_PARAMS, facade: "west" }).projection).toBeCloseTo(5.298, 3);
  });

  it("puts the step where the ring's own wall steps, at building v 48.45", () => {
    const p = DEFAULT_PARAMS;
    const b = suiteToBuilding(0, facadeStep(p).v, p).v;
    expect(b).toBeCloseTo(48.45, 2);
    // Either side of it, the reach differs by the projection; the ring's four
    // vertices at this transition spread over v 48.45 to 48.58, so probe clear of it.
    expect(reachAt(b - 1, "east") - reachAt(b + 1, "east")).toBeGreaterThan(3);
  });

  it("keeps the step fixed in the building while the suite's own v moves under it", () => {
    // The suite hangs off the gable, so a shorter section pulls its v = 0 north and
    // the step has to arrive at a smaller suite v. A constant would not do this.
    for (const sectionLength of [40, 44, 48]) {
      const p = { ...DEFAULT_PARAMS, sectionLength };
      expect(suiteToBuilding(0, facadeStep(p).v, p).v, `${sectionLength}`).toBeCloseTo(48.45, 2);
    }
    expect(facadeStep({ ...DEFAULT_PARAMS, sectionLength: 40 }).v).toBeCloseTo(
      facadeStep(DEFAULT_PARAMS).v - 4,
      9,
    );
  });
});

describe("the stepped common room lands on the building's wing wall", () => {
  const reachAt = (v: number, facade: "east" | "west") => {
    const loop = ring.slice(0, -1).map((p) => siteToBuilding({ x: p[0]!, y: p[1]! }));
    let out = -Infinity;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const c = loop[(i + 1) % loop.length]!;
      if (a.v > v === c.v > v) continue;
      const u = a.u + ((c.u - a.u) * (v - a.v)) / (c.v - a.v);
      out = Math.max(out, facade === "east" ? u : -u);
    }
    return out;
  };

  /**
   * How far a suite-frame u sits INSIDE the real wall at that point along the
   * building, in feet. The model's facade is a nominal 49 ft clear width and the
   * ring is a survey, so this is never zero -- 0.94 ft on the east, 1.84 on the west
   * -- and the whole test is that the wing zone gets the SAME standoff as the end
   * zone rather than that either is nought.
   */
  const standoff = (u: number, v: number, params: typeof DEFAULT_PARAMS) => {
    const b = suiteToBuilding(u, v, params);
    return reachAt(b.v, params.facade) - Math.abs(b.u);
  };

  for (const facade of ["east", "west"] as const) {
    it(`closes the gap the straight facade leaves, ${facade}`, () => {
      const straight = { ...DEFAULT_PARAMS, facade };
      const stepped = { ...straight, wingStep: true };
      const inEndZone = buildSuite(straight).rooms.find((r) => r.id === "bedB")!;
      const before = buildSuite(straight).rooms.find((r) => r.id === "common1")!;
      const after = buildSuite(stepped).rooms.find((r) => r.id === "common1")!;

      // The end-zone rooms are the control: their facade wall is where it should be.
      const end = standoff(inEndZone.u, inEndZone.v + inEndZone.dv / 2, straight);
      const strayed = standoff(before.u, before.v + before.dv / 2, straight);
      const fixed = standoff(after.u, after.v + after.dv / 2, stepped);

      // Straight, the common room sits a whole projection deeper inside the building
      // than the end-zone rooms do. That is the defect.
      // 0.05 ft, not tighter, and the slack is the taper: these standoffs are read
      // at each room's OWN midpoint along the building -- v 33.65 and 65.15 -- while
      // facadeStep() reads each zone's, and neither wall is quite parallel to the
      // axis. The disagreement is 0.02 ft, a quarter of an inch.
      expect(strayed - end).toBeCloseTo(facadeStep(straight).projection, 1);
      // Stepped, it stands off its own wall by exactly what the end zone stands off
      // its own -- which is what "on the real wing wall" can mean for a model whose
      // facade line is a published clear width rather than a surveyed one.
      expect(fixed).toBeCloseTo(end, 1);
    });
  }

  it("keeps every stepped room corner inside Weld's real footprint, both facades", () => {
    for (const facade of ["east", "west"] as const) {
      const suite = buildSuite({ ...DEFAULT_PARAMS, facade, wingStep: true });
      const outside = suiteCornersSite(suite).filter(
        (c) => !pointInPolygon([c.site.x, c.site.y], ring),
      );
      expect(
        outside.map((o) => `${o.id} at ${o.site.x.toFixed(1)},${o.site.y.toFixed(1)}`),
        facade,
      ).toEqual([]);
    }
  });
});

describe("facade orientation feeds solar.ts", () => {
  it("gives the east facade an azimuth 90 degrees off the building axis", () => {
    const axis = weld.meta.long_axis_deg_e_of_n;
    expect(facadeAzimuth({ ...DEFAULT_PARAMS, facade: "east" })).toBeCloseTo(axis + 90, 6);
    expect(facadeAzimuth({ ...DEFAULT_PARAMS, facade: "west" })).toBeCloseTo(axis - 90, 6);
    expect(gableAzimuth()).toBeCloseTo(axis, 6);
  });

  it("puts the east facade at 103.2 degrees, a morning wall", () => {
    // 13.2 + 90. Used by the sun tests; recorded here so the two agree.
    expect(facadeAzimuth({ ...DEFAULT_PARAMS, facade: "east" })).toBeCloseTo(103.2, 6);
  });
});

/**
 * The section-length cap, measured a second way.
 *
 * maxSectionLength() zones the ring and reads each zone at its own midpoint. This
 * block does none of that: it walks v northward in thousandths of a foot, ray-casting
 * the raw ring at each step, and asks where the footprint first becomes wide enough to
 * hold the suite. Two routes to the same waist face is the argument the facade-step
 * block above makes, and it is the check that the derivation survived being moved here
 * from scene/weldGeometry.ts -- tests/weldGeometry.test.ts still comes at the same
 * number through ringStations(), which is a third route again.
 */
describe("the cap on sectionLength is measured off the ring", () => {
  /** u = 0 out to the nearer wall at v = const, from the raw ring. Not width / 2. */
  const halfWidthAt = (v: number) => {
    const loop = ring.slice(0, -1).map((p) => siteToBuilding({ x: p[0]!, y: p[1]! }));
    let east = -Infinity;
    let west = -Infinity;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const c = loop[(i + 1) % loop.length]!;
      if (a.v > v === c.v > v) continue;
      const u = a.u + ((c.u - a.u) * (v - a.v)) / (c.v - a.v);
      east = Math.max(east, u);
      west = Math.max(west, -u);
    }
    return Math.min(east, west);
  };

  it("finds the waist and the wings, so the probe is not vacuous", () => {
    // the waist is narrower than the suite; a foot into the wings it is not
    expect(halfWidthAt(0)).toBeCloseTo(23.14, 2);
    expect(halfWidthAt(0)).toBeLessThan(CLEAR_HALF_U);
    expect(halfWidthAt(21)).toBeGreaterThan(CLEAR_HALF_U);
  });

  it("stops the suite at the waist's north face, 50.25 ft back from the gable", () => {
    let face = Infinity;
    for (let v = 0; v < 30; v += 0.001) {
      if (halfWidthAt(v) >= CLEAR_HALF_U) {
        face = v;
        break;
      }
    }
    expect(Number.isFinite(face), "the scan found the step at all").toBe(true);
    // 0.02 ft, and the slack is stated rather than tuned: the zone boundary is the
    // LOWEST v of a merged cluster whose four vertices spread over v 19.897 to 19.916,
    // so the implementation is up to 0.017 ft generous against a scan that finds the
    // true crossing. See maxSectionLength()'s own docblock.
    expect(Math.abs(GABLE_INNER_V - face - MAX_SECTION_LENGTH)).toBeLessThan(0.02);
    expect(MAX_SECTION_LENGTH).toBeCloseTo(50.25, 1);
    expect(maxSectionLength(), "the exported value is the function's").toBe(MAX_SECTION_LENGTH);
  });
});

/**
 * three.js must not be reachable from geo/ or state/, and this is where that is
 * asserted because this file's own module is where the rule sent maxSectionLength().
 *
 * The rule has teeth: scripts/emit-layout.mjs and emit-plan.mjs import these modules
 * by path in plain node and tests/drift.test.ts shells out to both, so three in the
 * reachable set is an ERR_MODULE_NOT_FOUND at import -- invisible to tsc, and drift
 * only catches the modules those two scripts happen to reach. It has been broken twice,
 * once by a value import in rooms.ts and once by url.ts importing MAX_SECTION_LENGTH
 * from scene/weldGeometry.ts, and in both cases the file carried a comment saying not
 * to. So this walks the real import graph instead: the roots are every .ts under
 * src/geo and src/state as they are on disk, and the edges are the specifiers those
 * files actually load. Nothing here is a list of files to keep up to date, which is
 * the only version of this test worth having.
 */
describe("the geometry and state layers stay three-free", () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

  /** Anything that would pull the renderer in. Bare specifiers only. */
  const RENDERER = /^(three($|[-/])|@react-three\/|postprocessing($|\/))/;

  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      if (e.isDirectory()) return sources(p);
      return /\.tsx?$/.test(e.name) ? [p] : [];
    });

  /**
   * The specifiers a file loads at RUNTIME.
   *
   * Comments are stripped first, and they have to be: these modules quote refused
   * imports in prose, spelled exactly as code (rooms.ts's `import { facadeStep } from
   * "./place"` is the reason place.ts pushes instead of being pulled, and furniture.ts
   * quotes two more), and a scanner that believed them would be walking edges nobody
   * wrote.
   *
   * `import type` / `export type` statements are dropped because they are erased. An
   * inline `{ type X }` in an otherwise value import is NOT dropped -- over-reporting
   * an edge is safe here, under-reporting one is the bug this test exists to catch.
   */
  const loads = (file: string): string[] => {
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    const re = /(?:^|[^\w.$])(?:import|export)[\s(]+(?!type[\s{])(?:[^'";]*?\bfrom\s*)?["']([^"']+)["']/g;
    return [...src.matchAll(re)].map((m) => m[1]!);
  };

  /** A specifier as a file under src/, or null for a package. */
  const fileOf = (spec: string, importer: string): string | null => {
    const base = spec.startsWith("@/")
      ? join(SRC, spec.slice(2))
      : spec.startsWith(".")
        ? resolve(dirname(importer), spec)
        : null;
    if (base === null) return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
  };

  /** Every path from `roots` to a renderer package, as "a -> b -> three". */
  const routesToThree = (roots: string[]): string[] => {
    const from = new Map<string, string | null>(roots.map((r) => [r, null]));
    const queue = [...roots];
    const out: string[] = [];
    const chain = (file: string, tail: string) => {
      const parts = [tail];
      for (let f: string | null | undefined = file; f; f = from.get(f)) {
        parts.unshift(relative(join(SRC, ".."), f));
      }
      return parts.join(" -> ");
    };
    while (queue.length > 0) {
      const file = queue.shift()!;
      for (const spec of loads(file)) {
        const next = fileOf(spec, file);
        if (next === null) {
          if (RENDERER.test(spec)) out.push(chain(file, spec));
          continue;
        }
        if (from.has(next)) continue;
        from.set(next, file);
        queue.push(next);
      }
    }
    return out;
  };

  /**
   * The two P9 modules under src/scene that are held to the same rule.
   *
   * src/scene is where the renderer lives, so it cannot be swept wholesale. But altitude.ts
   * and globeRig.ts are declared three-free in their own headers for the same reason walk.ts
   * and route.ts are -- they are the pure maths of the descent, they are unit-tested in plain
   * node, and altitude.ts is what a script would import to ask what is visible at a given
   * height. A `import * as THREE` added to either for one Vector3 would be invisible to tsc
   * and would break those callers at runtime, which is exactly the failure this whole
   * describe block exists to catch. Named individually rather than by directory because the
   * rest of src/scene is legitimately full of three.
   */
  const PURE_SCENE = ["altitude.ts", "globeRig.ts", "journey.ts"].map((f) => join(SRC, "scene", f));

  const layers = [...sources(join(SRC, "geo")), ...sources(join(SRC, "state")), ...PURE_SCENE];

  it("has found the modules it is meant to be walking", () => {
    expect(layers.length).toBeGreaterThan(8);
    expect(layers).toContain(join(SRC, "geo", "place.ts"));
    expect(layers).toContain(join(SRC, "state", "url.ts"));
    // The P9 pair really is on the list and really is on disk, so a rename cannot quietly
    // drop it from the sweep.
    for (const f of PURE_SCENE) {
      expect(layers).toContain(f);
      expect(existsSync(f), `${f} is missing`).toBe(true);
    }
    // and globeRig is reaching geo through a real edge
    expect(loads(join(SRC, "scene", "globeRig.ts"))).toContain("@/geo/frames");
    // and it is reading real edges out of them, not an empty regex
    expect(loads(join(SRC, "state", "url.ts"))).toContain("@/geo/place");
  });

  it("can find three when it is there, several hops away", () => {
    // The positive control, and it is CanvasHost.tsx rather than a module that imports
    // three itself: it reaches three only through `dynamic(() => import("./Experience"))`,
    // so a route out of it proves the walk follows transitive edges AND lazy ones. A
    // walker that only noticed a file's own direct `import * as THREE` would pass the
    // test below on a graph that had three three levels down.
    const routes = routesToThree([join(SRC, "scene", "CanvasHost.tsx")]);
    expect(routes.filter((r) => r.endsWith("-> three")).length).toBeGreaterThan(0);
    expect(Math.max(...routes.map((r) => r.split(" -> ").length))).toBeGreaterThan(2);
  });

  it("reaches three from no module under src/geo or src/state, nor from the pure scene pair", () => {
    // Verified to have teeth rather than assumed: adding `import * as THREE from "three"` to
    // altitude.ts fails this and nothing else in the suite, which is the whole point -- tsc
    // is happy with it and so is every other test.
    expect(routesToThree(layers)).toEqual([]);
  });
});

describe("building constants come from weld.json, not from prose", () => {
  it("reads the verified envelope", () => {
    expect(WELD.length).toBeCloseTo(143.3, 6);
    expect(WELD.gableWidth).toBeCloseTo(52.0, 6);
    expect(WELD.clearWidth).toBeCloseTo(49.0, 6);
    expect(WELD.floorToFloor).toBeCloseTo(12.0, 6);
    expect(WELD.eaves).toBeCloseTo(60.0, 6);
    expect(WELD.ridge).toBeCloseTo(85.4, 6);
  });

  it("stacks floors 12 ft apart", () => {
    expect(floorLevel(1)).toBeCloseTo(12, 6);
    expect(floorLevel(5)).toBeCloseTo(60, 6);
    // and the fifth floor level lands on the eaves, which is the cross-check
    // that made 12 ft credible in the first place
    expect(floorLevel(5)).toBeCloseTo(WELD.eaves, 6);
  });
});
