import { describe, it, expect } from "vitest";
import { buildSuite, DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";
import { buildWalls, type Wall } from "@/geo/walls";
import { suiteToThree } from "@/geo/place";
import type { Vec3 } from "@/geo/frames";
import {
  CUTAWAY_MODES,
  WALL_HOLD_FT,
  cameraInSuite,
  ceilingVisible,
  hiddenWalls,
  sectionPlaneU,
} from "@/scene/cutaway";

const P = DEFAULT_PARAMS;
const suite = buildSuite();
const { walls } = buildWalls(suite);
const perimeter = walls.filter((w) => w.perimeter === true);

/**
 * A camera placed by suite-frame coordinates.
 *
 * The height is arbitrary and deliberately not level with anything: every band is a
 * vertical prism, so no assertion here may depend on it.
 */
const cam = (u: number, v: number, params: SuiteParams = P): Vec3 =>
  suiteToThree(u, v, 25, params);

/**
 * The four sides, each far enough out that which side the camera is on is not a
 * judgement call. v = 22 is the middle of the 44 ft section, u = 10 the middle of
 * the 21 ft leg, so a facade camera is not also a north one.
 */
const sides = {
  facade: cam(-60, 22),
  inner: cam(80, 22),
  north: cam(10, 120),
  south: cam(10, -80),
} as const;

const ids = (ws: Wall[]) => ws.map((w) => w.id).sort();
const sorted = (s: Set<string>) => [...s].sort();

/**
 * The perimeter bands, identified by geometry rather than by the id walls.ts happens
 * to mint, so a change to the emission order does not silently retarget a test.
 * These are the same discriminators walls.ts's own wallOnFace() uses: the facade band
 * is the exterior band that runs in v, the gable band the one that runs in u.
 */
const band = {
  facade: perimeter.find((w) => w.kind === "exterior" && w.dv > w.du)!,
  gable: perimeter.find((w) => w.kind === "exterior" && w.du > w.dv)!,
  south: perimeter.find((w) => w.v < 0)!,
  party: perimeter.find((w) => w.dv > w.du && Math.abs(w.u - P.legDepth) < 1e-9)!,
  bumpFace: perimeter.find((w) => w.dv > w.du && w.u > P.legDepth + 1e-9)!,
  step: perimeter.find((w) => w.du > w.dv && w.v > 0 && w.v < P.sectionLength)!,
};

/** Straight-line distance from a band's centre to the camera, in the suite frame. */
const distance = (w: Wall, camera: Vec3, params: SuiteParams = P) => {
  const c = cameraInSuite(camera, params);
  return Math.hypot(w.u + w.du / 2 - c.u, w.v + w.dv / 2 - c.v);
};

describe("the six perimeter bands are all found, distinctly", () => {
  it("names one band per face of the L, and no band twice", () => {
    // If this fails every set assertion below is testing something else.
    const found = Object.values(band);
    expect(found.every((w) => w !== undefined)).toBe(true);
    expect(new Set(found.map((w) => w.id)).size).toBe(6);
    expect(found.length).toBe(perimeter.length);
  });
});

describe("the camera arrives in the suite frame", () => {
  // frames.ts warns that a mistake in the y-north to z-south swap mirrors the whole
  // building and is invisible. Every decision in cutaway.ts is downstream of this
  // inversion, so it is pinned before anything else.
  it("inverts suiteToThree exactly, on both facades", () => {
    for (const facade of ["east", "west"] as const) {
      const params = { ...P, facade };
      for (const [u, v] of [
        [0, 0],
        [-60, 22],
        [80, 22],
        [10, 120],
        [10, -80],
        [7.25, 31.5],
      ] as [number, number][]) {
        const back = cameraInSuite(cam(u, v, params), params);
        expect(back.u).toBeCloseTo(u, 9);
        expect(back.v).toBeCloseTo(v, 9);
      }
    }
  });

  it("puts north at negative Z, which is the swap frames.ts warns about", () => {
    // The suite's +v runs north along Weld's axis, and three is z-south. A camera
    // 200 ft north of the suite's south wall therefore has a large NEGATIVE z; a
    // sign error in toThree would put it in front of the building instead of behind.
    const far = cam(10, 200);
    expect(far[2]).toBeLessThan(-100);
    expect(cameraInSuite(far, P).v).toBeCloseTo(200, 6);
  });

  it("ignores the camera's height", () => {
    const low = suiteToThree(-60, 22, 0, P);
    const high = suiteToThree(-60, 22, 900, P);
    expect(sorted(hiddenWalls(walls, "wallsDown", low, P))).toEqual(
      sorted(hiddenWalls(walls, "wallsDown", high, P)),
    );
  });
});

describe("none", () => {
  // The one case that can silently become "returns everything": an empty set is what
  // both a correct implementation and a `return new Set(walls.map(w => w.id))` typo
  // produce for a test that only checks the type.
  it("hides nothing, from every side", () => {
    expect(walls.length).toBeGreaterThan(10);
    for (const [where, c] of Object.entries(sides)) {
      expect([where, sorted(hiddenWalls(walls, "none", c, P))]).toEqual([where, []]);
    }
  });

  it("hides nothing even when handed a previous set naming every wall", () => {
    // Hysteresis must not be a back door into a mode that hides nothing.
    const all = new Set(walls.map((w) => w.id));
    for (const c of Object.values(sides)) {
      expect(hiddenWalls(walls, "none", c, P, all).size).toBe(0);
    }
  });

  it("leaves the ceiling on", () => {
    expect(ceilingVisible("none")).toBe(true);
  });
});

describe("roofOff", () => {
  it("hides the ceiling and not one wall", () => {
    // The claim is exactly "the ceiling"; the ceiling is not a Wall, so the wall set
    // is empty and the flag carries the whole mode.
    expect(ceilingVisible("roofOff")).toBe(false);
    for (const [where, c] of Object.entries(sides)) {
      expect([where, sorted(hiddenWalls(walls, "roofOff", c, P))]).toEqual([where, []]);
    }
  });

  it("is the only mode that takes the ceiling", () => {
    // section keeps it: the plate beyond the cut is part of what a section exposes.
    expect(CUTAWAY_MODES.filter((m) => !ceilingVisible(m))).toEqual(["roofOff"]);
  });
});

describe("wallsDown drops the near wall, and only the near wall", () => {
  // THE SIGN TEST. A flipped normal-against-camera comparison hides the FAR wall
  // instead of the near one, which renders as a hole in the wrong side of the
  // building -- it reads as a rendering fault, not a logic fault, and ships.
  const expected: Record<keyof typeof sides, Wall[]> = {
    facade: [band.facade],
    // Two, and both are genuinely the near boundary: the suite is an L, so its inner
    // side is the party wall for the leg plus the K bump's outer face beside it.
    inner: [band.party, band.bumpFace],
    // Likewise the north side is the gable band plus the step over the bump.
    north: [band.gable, band.step],
    south: [band.south],
  };

  for (const where of Object.keys(sides) as (keyof typeof sides)[]) {
    it(`camera to the ${where}: exactly the bands facing it`, () => {
      const got = hiddenWalls(walls, "wallsDown", sides[where], P);
      expect(sorted(got)).toEqual(ids(expected[where]));
    });
  }

  it("drops the nearest perimeter band and keeps the farthest, on all four sides", () => {
    // Distance-only, so it shares no arithmetic with the module: whatever the normals
    // are doing, the wall between you and the room is the one you are closest to.
    for (const [where, c] of Object.entries(sides)) {
      const byDistance = [...perimeter].sort((a, b) => distance(a, c) - distance(b, c));
      const got = hiddenWalls(walls, "wallsDown", c, P);
      expect([where, got.has(byDistance[0]!.id)]).toEqual([where, true]);
      expect([where, got.has(byDistance[byDistance.length - 1]!.id)]).toEqual([
        where,
        false,
      ]);
    }
  });

  it("drops nothing that opposite sides agree on", () => {
    const facade = hiddenWalls(walls, "wallsDown", sides.facade, P);
    const inner = hiddenWalls(walls, "wallsDown", sides.inner, P);
    const north = hiddenWalls(walls, "wallsDown", sides.north, P);
    const south = hiddenWalls(walls, "wallsDown", sides.south, P);
    for (const [a, b] of [
      [facade, inner],
      [north, south],
    ] as [Set<string>, Set<string>][]) {
      expect([...a].filter((id) => b.has(id))).toEqual([]);
      expect(a.size).toBeGreaterThan(0);
      expect(b.size).toBeGreaterThan(0);
    }
  });

  it("never drops an interior partition", () => {
    // A grid-derived band divides two rooms, so it has two inward faces and no
    // outward one. Asking which way its normal points has no answer, and answering
    // anyway is what would turn the plan into an open floor plate.
    const interior = new Set(walls.filter((w) => w.perimeter !== true).map((w) => w.id));
    expect(interior.size).toBeGreaterThan(5);
    for (const c of Object.values(sides)) {
      for (const id of hiddenWalls(walls, "wallsDown", c, P)) {
        expect(interior.has(id)).toBe(false);
      }
    }
  });

  it("drops nothing when the camera stands inside the suite", () => {
    // No wall is between you and the room you are in. Holds even with every wall
    // handed in as previously dropped, so the hold cannot keep the room open.
    const all = new Set(walls.map((w) => w.id));
    const inside = cam(10, 22);
    expect(hiddenWalls(walls, "wallsDown", inside, P).size).toBe(0);
    expect(hiddenWalls(walls, "wallsDown", inside, P, all).size).toBe(0);
  });

  it("behaves the same on the west facade, where the u mapping mirrors", () => {
    // params.facade flips the sign of suite u through the building frame. The suite's
    // own frame does not change, so neither should the answer -- and mirroring is the
    // live ambiguity frames.ts names.
    const west = { ...P, facade: "west" as const };
    const wSuite = buildSuite(west);
    const wWalls = buildWalls(wSuite).walls;
    const map = new Map(wWalls.map((w) => [`${w.u},${w.v},${w.du},${w.dv}`, w.id]));
    for (const where of Object.keys(sides) as (keyof typeof sides)[]) {
      const [u, v] = [cameraInSuite(sides[where], P).u, cameraInSuite(sides[where], P).v];
      const got = hiddenWalls(wWalls, "wallsDown", cam(u, v, west), west);
      const want = expected[where].map((w) => map.get(`${w.u},${w.v},${w.du},${w.dv}`)!);
      expect(sorted(got)).toEqual([...want].sort());
    }
  });
});

describe("wallsDown hysteresis", () => {
  // The facade band's outer face is at suite u = -masonry, and the camera is walked
  // straight along that band's normal at v = 22, so the sideways margin never binds
  // and the only quantity moving is the distance past the face.
  const face = -P.masonry;
  const at = (u: number) => cam(u, 22);
  const dropped = (u: number, prev?: ReadonlySet<string>) =>
    hiddenWalls(walls, "wallsDown", at(u), P, prev).has(band.facade.id);

  it("drops the band once the camera is outside its face", () => {
    expect(dropped(face - 1.5)).toBe(true);
    expect(dropped(face + 1.5)).toBe(false);
  });

  it("holds a dropped band down across the crossing", () => {
    const held = new Set([band.facade.id]);
    // Inside the face by half a foot. Without the hold this flips every frame the
    // camera jitters across the plane, which reads as a flickering hole.
    expect(dropped(face + 1.5)).toBe(false);
    expect(dropped(face + 1.5, held)).toBe(true);
  });

  it("releases once the camera is WALL_HOLD_FT past, so it does not stick forever", () => {
    const held = new Set([band.facade.id]);
    expect(dropped(face + WALL_HOLD_FT - 0.1, held)).toBe(true);
    expect(dropped(face + WALL_HOLD_FT + 0.1, held)).toBe(false);
    // and deep inside the suite it is long gone
    expect(dropped(10, held)).toBe(false);
  });

  it("changes its mind exactly twice over a sweep out of the suite and back", () => {
    // From 20 ft inside to 40 ft outside and back, feeding each answer forward. A
    // correct hold flips the band exactly twice, and the two crossings sit at
    // DIFFERENT places -- that gap is the hysteresis. Without it the two coincide.
    let prev: ReadonlySet<string> = new Set();
    const flips: number[] = [];
    const path = [
      ...Array.from({ length: 121 }, (_, i) => 20 - i * 0.5),
      ...Array.from({ length: 121 }, (_, i) => -40 + i * 0.5),
    ];
    for (const u of path) {
      const next = hiddenWalls(walls, "wallsDown", at(u), P, prev);
      if (prev.has(band.facade.id) !== next.has(band.facade.id)) flips.push(u);
      prev = next;
    }
    expect(flips.length).toBe(2);
    // It drops on the way OUT, past the face; it returns on the way IN, further in
    // than it dropped, by at least the hold.
    expect(flips[0]).toBeLessThan(flips[1]!);
    expect(flips[1]! - flips[0]!).toBeGreaterThan(WALL_HOLD_FT);
    // and it ends where it started: inside, with the band up
    expect(prev.has(band.facade.id)).toBe(false);
  });

  it("is a fixed point: feeding its own answer back changes nothing", () => {
    // The hold band must be a superset of the drop band. If it were not, a stationary
    // camera would oscillate between two sets forever.
    for (const c of Object.values(sides)) {
      const first = hiddenWalls(walls, "wallsDown", c, P);
      expect(sorted(hiddenWalls(walls, "wallsDown", c, P, first))).toEqual(sorted(first));
    }
  });

  it("does not launder a stale id from the previous set into the answer", () => {
    // A slider can remove a band between frames. The previous set is read, not copied.
    const stale = new Set([band.facade.id, "w-was-here-last-slider-tick"]);
    const got = hiddenWalls(walls, "wallsDown", sides.facade, P, stale);
    expect(got.has("w-was-here-last-slider-tick")).toBe(false);
  });
});

describe("section", () => {
  it("cuts on the hall's centreline, which is inside the hall at every setting", () => {
    // The justification, made testable: the plane is distinguished because the hall is
    // what every room is entered from, so the cut has to stay in the hall as the leg
    // and hall sliders move rather than drift into a bedroom.
    for (const params of [
      P,
      { ...P, hallWidth: 6, legDepth: 24 },
      { ...P, hallWidth: 3, legDepth: 18 },
    ]) {
      const hall = buildSuite(params).rooms.find((r) => r.id === "hall")!;
      const plane = sectionPlaneU(params);
      expect(plane).toBeGreaterThan(hall.u);
      expect(plane).toBeLessThan(hall.u + hall.du);
    }
    expect(sectionPlaneU(P)).toBeCloseTo(18.75, 9);
  });

  it("hides every band wholly on the camera's side of the plane, and no other", () => {
    const plane = sectionPlaneU(P);
    for (const [where, c] of Object.entries(sides)) {
      const near = cameraInSuite(c, P).u > plane;
      const got = hiddenWalls(walls, "section", c, P);
      expect([where, got.size]).not.toEqual([where, 0]);
      for (const w of walls) {
        const wholly = near ? w.u >= plane : w.u + w.du <= plane;
        expect([where, w.id, got.has(w.id)]).toEqual([where, w.id, wholly]);
      }
    }
  });

  it("keeps a band the plane passes through, because that band is the cut face", () => {
    const plane = sectionPlaneU(P);
    const straddling = walls.filter((w) => w.u < plane && w.u + w.du > plane);
    expect(straddling.length).toBeGreaterThan(0);
    for (const c of Object.values(sides)) {
      const got = hiddenWalls(walls, "section", c, P);
      for (const w of straddling) expect(got.has(w.id)).toBe(false);
    }
  });

  it("takes disjoint halves from the two sides of the plane", () => {
    const a = hiddenWalls(walls, "section", sides.facade, P);
    const b = hiddenWalls(walls, "section", sides.inner, P);
    expect([...a].filter((id) => b.has(id))).toEqual([]);
    // Together they are everything except the bands the plane passes through.
    const plane = sectionPlaneU(P);
    const cut = walls.filter((w) => w.u < plane && w.u + w.du > plane).length;
    expect(a.size + b.size + cut).toBe(walls.length);
  });

  it("hides nothing when the camera lies exactly in the cut plane", () => {
    // Standing in the hall, on the plane, neither half is the near one. Picking one
    // would make the set flip on a coin toss as the camera jitters.
    expect(hiddenWalls(walls, "section", cam(sectionPlaneU(P), 22), P).size).toBe(0);
  });

  it("removes strictly more than wallsDown from the same viewpoint", () => {
    // The two modes are not the same thing with different numbers: wallsDown takes one
    // face, a section takes a whole half.
    const s = hiddenWalls(walls, "section", sides.facade, P);
    const d = hiddenWalls(walls, "wallsDown", sides.facade, P);
    expect(s.size).toBeGreaterThan(d.size);
    for (const id of d) expect(s.has(id)).toBe(true);
  });
});

describe("invariants every mode owes", () => {
  const known = new Set(walls.map((w) => w.id));

  it("returns only ids that are in the input", () => {
    const all = new Set([...known, "not-a-wall"]);
    for (const mode of CUTAWAY_MODES) {
      for (const [where, c] of Object.entries(sides)) {
        for (const prev of [undefined, all]) {
          for (const id of hiddenWalls(walls, mode, c, P, prev)) {
            expect([mode, where, known.has(id)]).toEqual([mode, where, true]);
          }
        }
      }
    }
  });

  it("returns the same set when the same input is passed twice", () => {
    for (const mode of CUTAWAY_MODES) {
      for (const c of Object.values(sides)) {
        const a = hiddenWalls(walls, mode, c, P);
        const b = hiddenWalls(walls, mode, c, P);
        expect(sorted(a)).toEqual(sorted(b));
        // and a fresh Set each time, so a caller cannot mutate the next answer
        expect(a).not.toBe(b);
      }
    }
  });

  it("never hides every wall, in any mode, from any side", () => {
    // A suite with no walls at all is not a cutaway, it is a bug that looks like one.
    for (const mode of CUTAWAY_MODES) {
      for (const c of Object.values(sides)) {
        expect(hiddenWalls(walls, mode, c, P).size).toBeLessThan(walls.length);
      }
    }
  });

  it("handles an empty wall list", () => {
    for (const mode of CUTAWAY_MODES) {
      expect(hiddenWalls([], mode, sides.facade, P).size).toBe(0);
    }
  });
});
