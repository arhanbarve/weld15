import { describe, it, expect } from "vitest";
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
  GABLE_INNER_V,
  CLEAR_HALF_U,
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
