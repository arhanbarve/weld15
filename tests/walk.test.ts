/**
 * Walking the suite. The gates docs/phases/P7-P8.md asks for, and one it does not.
 *
 * The plan names four: walk the hall end to end and never leave the footprint per
 * collide.ts; walk into every wall in turn and resolve outside it; a 3 ft doorway is
 * passable and a 0.5 ft gap is not; and the capsule must not pass through a 0.5 ft
 * partition AT ANY STEP SIZE, tested at a deliberately absurd step. The fourth found two
 * real defects in walk.ts and both are pinned below by name -- see "tunnelling".
 *
 * WHAT COUNTS AS A TUNNELLING TEST HERE, because the obvious one is wrong. "The straight
 * segment from `from` to the result must not cross a solid" fails on legitimate walks:
 * step() slides, so an 8 ft walk that rounds a jamb and goes through a doorway has a
 * chord that clips that jamb. Measured on the default suite against the code as it now
 * stands, that test flags 1,236 of 40,000 random steps, and every example inspected was a
 * walker going through a door. So
 * three narrower statements are used instead, and together they are stronger:
 *
 *   head-on          Aim at a stretch of partition that has no door in it and assert the
 *                    walker stays on its own side. No sliding path reaches the far side,
 *                    so the chord argument holds and the step size can be absurd.
 *   the components   buildWalls() emits five interior doors and they leave the suite in one
 *                    piece plus one sealed room. So there is no walk at all into the
 *                    unknown strip from anywhere. A walker that arrives in it went through
 *                    plaster, whatever route it took.
 *
 *                    THIS IS WEAKER THAN IT WAS AND IT IS NOT VACUOUS. It used to be two
 *                    pieces plus the seal, because no door joined the hall to the common
 *                    room -- so the assertion also forbade a walk between the suite's two
 *                    halves, which was the strongest crossing statement available anywhere
 *                    in this file. That door has landed and the halves are one component
 *                    now, so what is left is the strip: one room, sealed on purpose, and
 *                    the only room in the suite a walker must never reach. The 600,000-hop
 *                    substep test below is what carries the interior guarantee the lost
 *                    half of this statement used to sample from outside.
 *   the substeps     At a displacement of at most SUBSTEP the chord IS the path, so the
 *                    segment test is exact. 600,000 consecutive substep-scale hops with
 *                    no solid penetrated is the interior guarantee that the two
 *                    statements above sample from the outside.
 */

import { describe, it, expect } from "vitest";
import { buildSuite, DEFAULT_PARAMS, type Rect, type SuiteParams } from "@/geo/rooms";
import { buildWalls, suiteFootprint, type Opening, type Wall } from "@/geo/walls";
import { pointInPolygon } from "@/geo/collide";
import { keyframes } from "@/scene/stages";
import { floorLevel } from "@/geo/place";
import {
  EYE,
  NO_INPUT,
  PITCH_LIMIT,
  RADIUS,
  SPEED,
  SUBSTEP,
  TURN_RATE,
  canPass,
  clearance,
  insideSuite,
  isClear,
  roomAt,
  solidsOf,
  step,
  walk,
  walkContext,
  type Solid,
  type Vec2,
  type WalkCtx,
} from "@/scene/walk";

const P = DEFAULT_PARAMS;
const suite = buildSuite();
const ctx = walkContext(suite);
const { openings } = buildWalls(suite);

/** Same deterministic pseudo-random generator style as tests/collide.test.ts. */
const makeRnd = (seed0: number) => {
  let seed = seed0;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
};

const dist = (a: Vec2, b: Vec2) => Math.hypot(b.u - a.u, b.v - a.v);

/**
 * Distance from a point to a rectangle, zero inside. walk.ts's own distanceTo() is not
 * exported and this is deliberately a second implementation: "the resolved position is
 * outside that wall" must not be measured with the arithmetic that placed it.
 */
const distTo = (p: Vec2, r: { u: number; v: number; du: number; dv: number }) =>
  Math.hypot(
    Math.max(r.u - p.u, 0, p.u - (r.u + r.du)),
    Math.max(r.v - p.v, 0, p.v - (r.v + r.dv)),
  );

/**
 * The suite's gross footprint as one closed ring, for collide.ts's pointInPolygon.
 *
 * The plan asks that the position never leave "the suite footprint per collide.ts", and
 * pointInPolygon is the containment predicate collide.ts offers -- tests/stages.test.ts
 * already uses it for the camera against Weld's own ring. suiteFootprint() returns the L
 * as two rectangles meeting on an edge, which a point test cannot be run against one at a
 * time: a walker standing at u = 21, v = 6 is inside K, inside the L, and inside NEITHER
 * rectangle's interior. So they are stitched into the L's outline first.
 */
function ringOf(s: ReturnType<typeof buildSuite>): number[][] {
  const parts = suiteFootprint(s);
  const leg = parts[0]!;
  const bump = parts[1];
  const legHi = leg.u + leg.du;
  if (!bump) {
    return [
      [leg.u, leg.v],
      [legHi, leg.v],
      [legHi, leg.v + leg.dv],
      [leg.u, leg.v + leg.dv],
    ];
  }
  return [
    [leg.u, leg.v],
    [bump.u + bump.du, bump.v],
    [bump.u + bump.du, bump.v + bump.dv],
    [legHi, bump.v + bump.dv],
    [legHi, leg.v + leg.dv],
    [leg.u, leg.v + leg.dv],
  ];
}

const ring = ringOf(suite);
const inRing = (p: Vec2, r = ring) => pointInPolygon([p.u, p.v], r);

/**
 * Does the open segment a -> b enter the interior of rect r? Liang-Barsky.
 *
 * Only ever applied to hops of at most SUBSTEP, where the chord is the path. See the
 * header for why it is not applied to a whole step().
 */
function segHitsRect(a: Vec2, b: Vec2, r: Solid): boolean {
  let t0 = 0;
  let t1 = 1;
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-15) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-du, a.u - r.u)) return false;
  if (!clip(du, r.u + r.du - a.u)) return false;
  if (!clip(-dv, a.v - r.v)) return false;
  if (!clip(dv, r.v + r.dv - a.v)) return false;
  return t1 - t0 > 1e-9;
}

/** A clear point inside the footprint, or null after `tries` darts. */
function randomStand(rnd: () => number, c: WalkCtx, r: number[][], tries = 60): Vec2 | null {
  for (let i = 0; i < tries; i++) {
    const p = { u: rnd() * 34 - 2, v: rnd() * 50 - 2 };
    if (isClear(p, c) && insideSuite(p, c) && pointInPolygon([p.u, p.v], r)) return p;
  }
  return null;
}

/** A jittered parameter set, the sweep tests/rooms.test.ts uses. legDepth closes. */
function jittered(rnd: () => number): SuiteParams {
  const jitter = (base: number, spread: number) => base + (rnd() * 2 - 1) * spread;
  const p: SuiteParams = {
    ...P,
    facade: rnd() < 0.5 ? "east" : "west",
    sectionLength: jitter(44, 4),
    hallWidth: jitter(4.5, 1),
    bedDepth: jitter(16, 1),
    commonAlong: jitter(15, 1),
    commonDeep: jitter(20, 2),
    bedAAlong: jitter(10, 1),
    bathAlong: jitter(8, 2),
    bathDeep: jitter(8, 1.5),
    kDeep: jitter(10, 1),
    kAlong: jitter(12, 1),
  };
  p.legDepth = p.hallWidth + p.partition + p.bedDepth;
  return p;
}

/**
 * A synthetic suite of two rooms with one gap of the given width between them.
 *
 * Built by hand rather than by moving a slider, because no slider in this project can
 * make a 0.5 ft doorway: buildOpenings() hangs 3 ft doors and clamps only against the
 * band's own length. The plan asks for a 0.5 ft gap to be refused, so the gap has to be
 * constructed. The band runs in u, so `offset` is measured along u from u = 0.
 */
function gapCtx(width: number): WalkCtx {
  const band: Wall = {
    id: "t0",
    u: 0,
    v: 10,
    du: 24,
    dv: 0.5,
    kind: "partition",
    between: ["s", "n"],
    separates: [["s", "n"]],
  };
  const rooms: Rect[] = [
    { id: "s", label: "south", u: 0, v: 0, du: 24, dv: 10, kind: "unknown", windows: [] },
    { id: "n", label: "north", u: 0, v: 10.5, du: 24, dv: 10, kind: "unknown", windows: [] },
  ];
  const gap: Opening = {
    id: "td",
    wallId: "t0",
    kind: "door",
    offset: 12 - width / 2,
    width,
    connects: ["s", "n"],
  };
  return {
    walls: [band],
    openings: [gap],
    footprint: [
      { id: "fp", label: "both", u: 0, v: 0, du: 24, dv: 20.5, kind: "unknown", windows: [] },
    ],
    rooms,
    solids: solidsOf([band], [gap], rooms),
    radius: RADIUS,
  };
}

/** Does the walker get from the south room to the north one through a gap this wide? */
const threads = (width: number, u0 = 12, travel = 6) =>
  step({ u: u0, v: 8 }, { u: 12, v: 8 + travel }, gapCtx(width)).v > 10.5;

// The hall's clear centreline at the defaults, measured off the bands rather than off the
// room: w4/w5/w6 stand at u 16..16.5 and p12 at u 21..21.5, so a 0.75 ft walker has
// u 17.25..20.25; w0 at v 15..15.5 and p10 at v 44..45.5 give v 16.25..43.25.
const HALL_U = 18.75;
const HALL_S = { u: HALL_U, v: 16.25 };
const HALL_N = { u: HALL_U, v: 43.25 };

describe("the numbers, and where they come from", () => {
  it("stands the walker at stages.ts's own eye height", () => {
    // walk.ts restates 5 ft 10 in rather than importing it, because stages.ts's EYE is
    // module-local. This is the join that stops the two from drifting: stage 5's camera
    // is placed at floorLevel(1) + stages.ts's EYE, so the difference is that constant.
    expect(EYE).toBeCloseTo(5 + 10 / 12, 12);
    expect(keyframes(P)[5].position[1] - floorLevel(1)).toBeCloseTo(EYE, 12);
  });

  it("gives the walker a radius that clears the near plane and fits a door", () => {
    // Both bounds are in RADIUS's docblock and neither is decoration. Experience.tsx
    // opens the canvas at near = 0.5 and the stage 4 -> 5 defect was a camera half a
    // foot from a partition; buildOpenings() hangs 3 ft doors.
    expect(RADIUS).toBeGreaterThan(0.5);
    expect(2 * RADIUS).toBeLessThan(3);
  });

  it("substeps at half the radius, which is what the tunnelling argument needs", () => {
    // A clear position is at least RADIUS from every band, so a displacement of at most
    // RADIUS / 2 leaves the point strictly outside all of them and on the same side of
    // each. Loosen this and SUBSTEP's derivation stops holding.
    expect(SUBSTEP).toBeGreaterThan(0);
    expect(SUBSTEP).toBeLessThanOrEqual(RADIUS / 2);
  });

  it("walks at an indoor pace and turns at a legible rate", () => {
    // Assumed, and bounded rather than sourced: see the docblocks. 2 ft/s crosses the
    // 44 ft section in 22 s and reads as a stall; 5.9 ft/s is 4 mph.
    expect(SPEED).toBeGreaterThan(2);
    expect(SPEED).toBeLessThan(5.9);
    expect((TURN_RATE * 180) / Math.PI).toBeCloseTo(120, 9);
  });
});

describe("canPass: doorway clearance against the radius", () => {
  const door = (width: number): Opening => ({
    id: "x",
    wallId: "w",
    kind: "door",
    offset: 0,
    width,
    connects: ["a", "b"],
  });

  it("passes a 3 ft door and refuses a 0.5 ft gap", () => {
    // docs/phases/P7-P8.md, verbatim.
    expect(canPass(door(3))).toBe(true);
    expect(canPass(door(0.5))).toBe(false);
  });

  it("is STRICTLY wider than the diameter", () => {
    // A gap exactly 2r across leaves the walker touching both jambs at once. The
    // geometry does thread that case, from dead centre only -- measured below -- and
    // canPass is deliberately the stricter of the two.
    expect(canPass(door(2 * RADIUS))).toBe(false);
    expect(canPass(door(2 * RADIUS + 1e-6))).toBe(true);
  });

  it("refuses every window, whatever its width", () => {
    // n5 is an 8 ft opening in the facade and would pass on width alone. It is glazed
    // and 12 ft up; a walker through it stands in mid-air over Harvard Yard.
    const windows = openings.filter((o) => o.kind === "window");
    expect(windows.length).toBeGreaterThan(3);
    expect(Math.max(...windows.map((o) => o.width))).toBeGreaterThan(2 * RADIUS);
    for (const o of windows) expect([o.id, canPass(o)]).toEqual([o.id, false]);
  });

  it("passes every door buildWalls() actually hangs", () => {
    // Six: three off the hall, K off the common room, the suite entry, and the hall's own
    // door into the common room. Five before that last one landed.
    const doors = openings.filter((o) => o.kind === "door");
    expect(doors.map((o) => o.id)).toEqual(["d0", "d1", "d2", "d3", "d4", "d5"]);
    expect(doors.length).toBe(6);
    for (const o of doors) expect([o.id, canPass(o)]).toEqual([o.id, true]);
  });

  it("closes every door in the suite for a walker too wide for one", () => {
    // canPass is a function of the walker, not only of the opening: the radius is a
    // parameter. A 1.6 ft radius is a 3.2 ft shoulder and no 3 ft door admits it.
    for (const o of openings.filter((x) => x.kind === "door")) {
      expect([o.id, canPass(o, 1.6)]).toEqual([o.id, o.width > 3.2]);
    }
  });
});

describe("the gap, in geometry rather than in the predicate", () => {
  /*
   * canPass() is route()'s test and solidsOf() does not consult it -- the hole is cut for
   * every door whatever its width, so a walker refused by a narrow gap is refused by
   * arithmetic. These are the two halves checked separately, which is what walk.ts's
   * docblock on canPass says this file does.
   */
  it("walks through a 3 ft doorway and not through a 0.5 ft gap", () => {
    expect(threads(3)).toBe(true);
    expect(threads(0.5)).toBe(false);
    // and it stops SHORT of the gap rather than ending up inside the band
    const narrow = gapCtx(0.5);
    const stuck = step({ u: 12, v: 8 }, { u: 12, v: 14 }, narrow);
    expect(stuck.v).toBeLessThan(10);
    expect(isClear(stuck, narrow)).toBe(true);
  });

  it("puts the geometric threshold at exactly the diameter", () => {
    // Measured, by bisecting the width: 1.4999999 does not thread and 1.5 does.
    for (const w of [0.5, 1, 1.4, 1.49, 2 * RADIUS - 1e-7]) {
      expect([w, threads(w)]).toEqual([w, false]);
    }
    for (const w of [2 * RADIUS + 1e-7, 1.51, 1.6, 2, 3, 3.2, 8]) {
      expect([w, threads(w)]).toEqual([w, true]);
    }
  });

  it("threads a gap exactly one diameter wide only from dead centre", () => {
    // The measurement behind canPass's strictness. At 2r the walker is touching both
    // jambs, so it gets through aimed straight at the middle and not from 3 ft off to
    // either side; at 3 ft wide it gets through from anywhere in the room.
    expect(threads(2 * RADIUS, 12)).toBe(true);
    expect(threads(2 * RADIUS, 9)).toBe(false);
    expect(threads(2 * RADIUS, 15)).toBe(false);
    for (const u0 of [9, 11, 12, 13, 15]) expect([u0, threads(3, u0)]).toEqual([u0, true]);
  });

  it("refuses a gap no wider than the diameter at every step size, however absurd", () => {
    // 40 ft/s at 5 fps is 8 ft. 400 ft is a tab that was backgrounded for a minute and a
    // half. Neither may put the walker in the next room.
    for (const d of [0.01, 0.1, 0.4, 1, 2, 8, 40, 400, 4000]) {
      expect([d, threads(0.5, 12, d)]).toEqual([d, false]);
      expect([d, threads(2 * RADIUS - 1e-7, 12, d)]).toEqual([d, false]);
    }
  });
});

describe("solidsOf: the bands, with the doorways cut out", () => {
  const solidAt = (p: Vec2, c = ctx) => c.solids.some((s) => distTo(p, s) < 1e-9);

  /** The middle of an opening, in the band it is hung in. */
  const middleOf = (o: Opening, c = ctx): Vec2 => {
    const w = c.walls.find((x) => x.id === o.wallId)!;
    const alongV = !(w.du > w.dv);
    const mid = (alongV ? w.v : w.u) + o.offset + o.width / 2;
    return alongV ? { u: w.u + w.du / 2, v: mid } : { u: mid, v: w.v + w.dv / 2 };
  };

  it("cuts a hole for every interior door", () => {
    const doors = openings.filter((o) => o.kind === "door" && !o.connects.includes("outside"));
    expect(doors.map((o) => o.id)).toEqual(["d0", "d1", "d2", "d3", "d5"]);
    expect(doors.length).toBe(5);
    for (const o of doors) expect([o.id, solidAt(middleOf(o))]).toEqual([o.id, false]);
  });

  it("leaves the suite entry and every window whole", () => {
    // d4 connects the hall to "outside", which this model has no floor for. Cutting it
    // would let the walker step out of the suite into nothing.
    const whole = openings.filter(
      (o) => o.kind === "window" || o.connects.includes("outside"),
    );
    expect(whole.length).toBe(6);
    for (const o of whole) expect([o.id, solidAt(middleOf(o))]).toEqual([o.id, true]);
  });

  it("leaves the entry whole even if a room is called 'outside'", () => {
    /*
     * The OUTSIDE token, isolated. In the real suite it is belt and braces -- "outside" is
     * not in the room list either, so the byId check alone already rejects the entry -- and
     * a redundant guard is a guard nothing tests. Here the model is given a room by that
     * name, so the token is the only thing left standing between the walker and a hole in
     * the wall to the stair hall. Without it this band loses its middle third.
     */
    const band: Wall = {
      id: "e0",
      u: 10,
      v: 0,
      du: 0.5,
      dv: 30,
      kind: "partition",
      between: ["hall", "outside"],
      separates: [["hall", "outside"]],
    };
    const rooms: Rect[] = [
      { id: "hall", label: "Hall", u: 0, v: 0, du: 10, dv: 30, kind: "circ", windows: [] },
      {
        id: "outside",
        label: "Not a room",
        u: 10.5,
        v: 0,
        du: 10,
        dv: 30,
        kind: "unknown",
        windows: [],
      },
    ];
    const entry: Opening = {
      id: "e-door",
      wallId: "e0",
      kind: "door",
      offset: 13.5,
      width: 3,
      connects: ["hall", "outside"],
      note: "suite entry, from the stair hall",
    };
    expect(solidsOf([band], [entry], rooms)).toEqual([
      { wallId: "e0", u: 10, v: 0, du: 0.5, dv: 30 },
    ]);
    // and it does cut a door between two rooms in the same synthetic wall, so the test
    // above is about the token and not about the wall being uncuttable
    const inner = { ...entry, connects: ["hall", "hall"] };
    expect(solidsOf([band], [inner], rooms).length).toBe(2);
  });

  it("keeps every piece inside the band it came from", () => {
    const byId = new Map(ctx.walls.map((w) => [w.id, w]));
    expect(ctx.solids.length).toBeGreaterThan(ctx.walls.length);
    for (const s of ctx.solids) {
      const w = byId.get(s.wallId)!;
      expect([s.wallId, s.u >= w.u - 1e-9, s.v >= w.v - 1e-9]).toEqual([s.wallId, true, true]);
      expect([
        s.wallId,
        s.u + s.du <= w.u + w.du + 1e-9,
        s.v + s.dv <= w.v + w.dv + 1e-9,
      ]).toEqual([s.wallId, true, true]);
      expect(s.du).toBeGreaterThan(0);
      expect(s.dv).toBeGreaterThan(0);
    }
  });

  it("conserves the band area, less the doors it cut", () => {
    /*
     * Nothing invented and nothing lost: the pieces of one band tile it apart from the
     * holes, so the total is the wall area minus one hole per interior door.
     *
     * DERIVED FROM THE OPENINGS RATHER THAN WRITTEN AS A CONSTANT, and the reason is that
     * a door's width is not 3 ft in general. door() clips a door to the stretch its two
     * rooms actually share, so a slider can make one narrower -- measured at 1.115 ft in
     * tests/walls.test.ts's 200-set sweep -- and `5 * 3 * partition` would then be a
     * number that happens to match at the defaults and silently stops meaning anything.
     * Summing the widths says what the arithmetic is instead of restating its answer.
     *
     * MEASURED at the defaults: 7.5 sq ft over 15 bands and 20 solids. Five interior doors,
     * each 3 ft wide in a 0.5 ft partition, is 5 * 1.5. It was 6 -- four doors -- before
     * the hall-to-common-room one, and w0 has gone from one whole 21 x 0.5 band to two
     * pieces, u 0 to 16.5 and u 19.5 to 21.
     *
     * THE PREMISE THE SUM DEPENDS ON is that each door is cut from exactly one band of
     * exactly partition thickness, which is true at the defaults and NOT true in general:
     * solidsOf() cuts the hole from every band across the doorway, and a partition split by
     * a footprint grid line is two bands -- the sliver case pinned in the test below. So the
     * premise is asserted rather than assumed, by counting: one extra solid per interior
     * door and no more.
     */
    const cut = openings.filter((o) => o.kind === "door" && !o.connects.includes("outside"));
    const wallArea = ctx.walls.reduce((a, w) => a + w.du * w.dv, 0);
    const solidArea = ctx.solids.reduce((a, s) => a + s.du * s.dv, 0);
    // The premise: every band is whole except the five each door splits in two.
    expect(ctx.solids.length).toBe(ctx.walls.length + cut.length);
    for (const o of cut) {
      const w = ctx.walls.find((x) => x.id === o.wallId)!;
      expect([o.id, Math.min(w.du, w.dv)]).toEqual([o.id, P.partition]);
      expect([o.id, ctx.solids.filter((s) => s.wallId === o.wallId).length]).toEqual([o.id, 2]);
    }
    const expected = cut.reduce((a, o) => a + o.width * P.partition, 0);
    expect(wallArea - solidArea).toBeCloseTo(expected, 9);
    // And what that comes to here, so a changed door width shows up as a changed figure
    // rather than only as a satisfied identity.
    expect(expected).toBeCloseTo(7.5, 9);
    expect(cut.map((o) => o.width)).toEqual([3, 3, 3, 3, 3]);
    expect(ctx.solids.filter((s) => s.wallId === "w0")).toEqual([
      { wallId: "w0", u: 0, v: 15, du: 16.5, dv: 0.5 },
      { wallId: "w0", u: 19.5, v: 15, du: 1.5, dv: 0.5 },
    ]);
  });

  it("cuts the door out of EVERY band across the doorway, not just the one it is hung in", () => {
    /*
     * The regression this pins. buildWalls() cuts its grid on footprint edges as well as
     * room edges, so an interior partition whose two faces are not both room edges is
     * split into two bands, and buildOpenings() hangs the door in one of them. These
     * params -- taken off the randomised route sweep at seed 20260731, iteration 3 -- put
     * commonDeep at 20.1515 and legDepth at 20.1609, which splits the common-room-to-K
     * partition into a 0.0095 ft sliver and the rest. The door goes in the thick half,
     * and before the fix the sliver stayed whole: a hundredth of a foot of plaster
     * stretched across the doorway, which stopped the walker 0.24 ft into a 2.5 ft
     * crossing. Two bands must lose a piece here, not one.
     */
    const p: SuiteParams = {
      ...P,
      sectionLength: 41.553566188343595,
      hallWidth: 4.539236730271907,
      bedDepth: 15.121709162602687,
      commonAlong: 14.688613951526868,
      commonDeep: 20.15149450402311,
      bedAAlong: 10.807904456354357,
      bathAlong: 9.573961374112143,
      bathDeep: 7.4611864287594045,
      kDeep: 9.998595059383007,
      kAlong: 12.097696781669603,
      legDepth: 20.160945892874594,
    };
    const s = buildSuite(p);
    const c = walkContext(s);
    const kDoor = c.openings.find((o) => o.connects.includes("k"))!;
    const hung = c.walls.find((w) => w.id === kDoor.wallId)!;
    const common = s.rooms.find((r) => r.id === "common1")!;
    const k = s.rooms.find((r) => r.id === "k")!;

    // The suite really is the awkward one: two bands stand between the common room and K.
    const inGap = c.walls.filter(
      (w) => w.u >= common.u + common.du - 1e-9 && w.u + w.du <= k.u + 1e-9,
    );
    expect(inGap.length).toBe(2);
    expect(inGap.some((w) => w.id !== hung.id)).toBe(true);
    // and both of them lose a piece to the door
    for (const w of inGap) {
      expect([w.id, c.solids.filter((so) => so.wallId === w.id).length]).toEqual([w.id, 2]);
    }
    // so the doorway is walkable, which is the thing that was broken
    const mid = hung.v + kDoor.offset + kDoor.width / 2;
    const from = { u: common.u + common.du - RADIUS - 0.25, v: mid };
    const to = { u: k.u + RADIUS + 0.25, v: mid };
    expect(dist(step(from, to, c), to)).toBeLessThan(1e-6);
  });
});

describe("walk the hall end to end", () => {
  /**
   * One frame of walking at 60 Hz on a fixed bearing, recording every position. The
   * hall's clear run is 27 ft, so 500 frames at 4 ft/s overshoots it three times over --
   * the walker is meant to arrive at the gable wall and stay there.
   */
  const traverse = (from: Vec2, to: Vec2, frames = 500, dt = 1 / 60) => {
    const path = [from];
    let at = from;
    const bearing = Math.atan2(to.u - at.u, to.v - at.v);
    for (let i = 0; i < frames; i++) {
      at = walk(
        { p: at, heading: bearing, pitch: 0 },
        { forward: 1, strafe: 0, turn: 0, pitch: 0 },
        dt,
        ctx,
      ).p;
      path.push(at);
    }
    return path;
  };

  it("never leaves the suite footprint, per collide.ts", () => {
    // docs/phases/P7-P8.md's first assertion. pointInPolygon against the L, which is
    // what collide.ts offers for "is this point in the footprint".
    const there = traverse(HALL_S, HALL_N);
    const back = traverse(there[there.length - 1]!, HALL_S);
    for (const p of [...there, ...back]) {
      const where = `${p.u.toFixed(3)},${p.v.toFixed(3)}`;
      expect([where, inRing(p)]).toEqual([where, true]);
    }
  });

  it("is never inside a wall band on the way", () => {
    for (const p of traverse(HALL_S, HALL_N)) expect(clearance(p, ctx)).toBeGreaterThan(-1e-9);
  });

  it("actually walks the hall, which is what makes the two above statements", () => {
    // Non-vacuity. A step() that returned `from` unchanged would pass everything above.
    const there = traverse(HALL_S, HALL_N);
    const end = there[there.length - 1]!;
    expect(end.v - HALL_S.v).toBeGreaterThan(25);
    expect(roomAt(HALL_S, ctx)).toBe("hall");
    expect(roomAt(end, ctx)).toBe("hall");
    // and it stops at the gable rather than walking through it
    expect(end.v).toBeLessThan(P.sectionLength);
    expect(clearance(end, ctx)).toBeLessThan(0.01);
  });

  it("walks it in about the time SPEED's docblock claims", () => {
    // "puts the hall's 28.5 ft end to end at about 7 s". The clear run for a 0.75 ft
    // walker is 27 ft, so 6.75 s, and the frame the walker arrives on says so.
    const path = traverse(HALL_S, HALL_N, 600);
    const arrived = path.findIndex((p) => p.v > HALL_N.v - 0.01);
    expect(arrived).toBeGreaterThan(0);
    expect(arrived / 60).toBeCloseTo(27 / SPEED, 1);
  });
});

describe("walk into every wall in turn", () => {
  /**
   * Every solid, approached from each of its four faces from 2 ft out, aimed at its
   * centre with an 8 ft displacement -- the plan's absurd frame. A start position is used
   * only when it is clear and in the footprint, so the cases are the approaches the suite
   * actually admits.
   */
  const approaches: { s: Solid; from: Vec2; to: Vec2 }[] = [];
  for (const s of ctx.solids) {
    const centre = { u: s.u + s.du / 2, v: s.v + s.dv / 2 };
    const stand = RADIUS + 2;
    for (const from of [
      { u: s.u - stand, v: centre.v },
      { u: s.u + s.du + stand, v: centre.v },
      { u: centre.u, v: s.v - stand },
      { u: centre.u, v: s.v + s.dv + stand },
    ]) {
      if (!isClear(from, ctx) || !insideSuite(from, ctx) || !inRing(from)) continue;
      const d = dist(from, centre);
      approaches.push({
        s,
        from,
        to: {
          u: from.u + ((centre.u - from.u) / d) * 8,
          v: from.v + ((centre.v - from.v) / d) * 8,
        },
      });
    }
  }

  it("finds a real approach to every one of the fifteen bands", () => {
    // Non-vacuity, and worth stating: an empty list passes every assertion below.
    // Measured on the default suite: 37 approaches over 20 solids, and every one of the
    // 15 bands is walked into from at least one side. A band whose only reachable face is
    // the outside of the facade masonry would contribute nothing, and none is.
    //
    // 36 over 19 solids before the hall-to-common-room door, and the one extra approach is
    // that door's doing rather than a drift. It splits w0 into two pieces where there was
    // one, u 0 to 16.5 and u 19.5 to 21. The long piece keeps the two approaches the whole
    // band had -- from the common room to its south and bedroom A to its north, the only
    // two faces of it a walker can stand clear of -- and the 1.5 ft stub beyond the door
    // adds one, from the hall. Its other three starts are refused: two land in the band's
    // own row and one lands inside w7, so none of them is clear.
    expect(approaches.length).toBe(37);
    expect(ctx.solids.length).toBe(20);
    expect(new Set(approaches.map((a) => a.s.wallId)).size).toBe(ctx.walls.length);
    expect(approaches.filter((a) => a.s.wallId === "w0").length).toBe(3);
  });

  it("resolves outside the band it walked into", () => {
    // docs/phases/P7-P8.md's second assertion. Measured with this file's own distTo, not
    // with the arithmetic in walk.ts that placed the walker.
    for (const a of approaches) {
      const got = step(a.from, a.to, ctx);
      const label = `${a.s.wallId} from ${a.from.u.toFixed(2)},${a.from.v.toFixed(2)}`;
      expect([label, distTo(got, a.s) >= RADIUS - 1e-9]).toEqual([label, true]);
      expect([label, inRing(got)]).toEqual([label, true]);
    }
  });

  it("resolves outside EVERY band, not only the one it aimed at", () => {
    // Pushing out of one solid can push into another. An inside corner is where three
    // passes of resolve() have to settle, and where a single-solid assertion would pass.
    for (const a of approaches) {
      const got = step(a.from, a.to, ctx);
      expect([a.s.wallId, clearance(got, ctx) >= -1e-9]).toEqual([a.s.wallId, true]);
    }
  });

  it("arrives flush against the band rather than at the last clear substep", () => {
    /*
     * What resolve()'s push is FOR, and the only assertion here that needs it. Substep
     * boundaries land wherever ceil(dist / SUBSTEP) puts them, so a walker that merely
     * stopped at the last clear one would come to rest a fraction of a foot short and a
     * different fraction for every step length. Measured with the push removed: from
     * u = 18 it stops at 17.2727 and from u = 20 at 17.375, instead of 17.25 from both.
     * A walker whose standoff depends on its frame rate is a walker that jitters.
     */
    for (const u0 of [18, 19, 20, 20.25]) {
      const got = step({ u: u0, v: 17 }, { u: 14, v: 17 }, ctx);
      expect([u0, got.u]).toEqual([u0, 16.5 + RADIUS]);
      expect([u0, clearance(got, ctx)]).toEqual([u0, 0]);
    }
  });

  it("settles flush in BOTH axes in an inside corner", () => {
    /*
     * Where the second push pass earns its place. Bedroom B's south-west corner is the
     * facade masonry (p9, u -1.5..0) meeting the partition under it (w2, v 33.5..34):
     * pushing out of one moves the walker into the other, so one pass cannot settle it.
     * Measured with PUSH_PASSES at 1: u = 0.75 and v = 34.9565, flush in u and 0.21 ft
     * off in v, which on screen is a walker floating away from one of the two walls it is
     * standing in the corner of.
     */
    const got = step({ u: 2, v: 36 }, { u: -4, v: 30 }, ctx);
    expect(got).toEqual({ u: RADIUS, v: 34 + RADIUS });
    expect(clearance(got, ctx)).toBe(0);
  });

  it("slides rather than stopping dead", () => {
    // The property that makes a doorway roundable. Walking into the hall's west
    // partition at 45 degrees has to keep the along-wall component: a walker that stops
    // on contact cannot get past a jamb, and a jamb it cannot get past is a room it
    // cannot leave. v = 17 is opposite the solid stretch of w4, south of bedroom A's door.
    const from = { u: 17.6, v: 17 };
    const got = step(from, { u: from.u - 4, v: from.v + 4 }, ctx);
    expect(got.u).toBeLessThan(from.u);
    expect(got.v - from.v).toBeGreaterThan(2);
    expect(clearance(got, ctx)).toBeGreaterThan(-1e-9);
  });
});

describe("tunnelling", () => {
  /*
   * docs/phases/P7-P8.md: "The capsule must not pass through a 0.5 ft partition at any
   * step size. Test it at a deliberately absurd step." It found two defects.
   *
   * ONE. step() sampled the from -> to line at i / n instead of advancing from the
   * position it had resolved, so as the walker slid the sample ran ahead of it and landed
   * past the far face of a partition -- where resolve() pushed it out by the nearest face,
   * the wrong one, and isClear() agreed, because a position on the far side of a wall is
   * perfectly clear of that wall. Measured before the fix: one 1 ft step from u = 17.25
   * in the hall put the walker at u = 15.25, inside bedroom A; one 120 ft step from the
   * common room put it 90 ft outside Weld.
   *
   * TWO. solidsOf() cut each door out of the single band it was hung in, and a partition
   * split by a footprint grid line is two bands. See its own test above.
   */
  const ABSURD = [0.01, 0.1, 0.4, 1, 2, 8, 40, 400, 4000];

  it("does not cross a partition with no door in it, at any step size", () => {
    // w4 stands at u 16..16.5 between bedroom A and the hall and its door is at
    // v 19..22, so v = 17 is 1.5 ft of solid plaster. 8 ft of it is the plan's own
    // frame: 40 ft/s at 5 fps.
    const from = { u: 17.25, v: 17 };
    expect(roomAt(from, ctx)).toBe("hall");
    for (const d of ABSURD) {
      const got = step(from, { u: from.u - d, v: from.v }, ctx);
      expect([d, got.u]).toEqual([d, 17.25]);
    }
  });

  it("does not cross the north gable, or the facade, at any step size", () => {
    // Perimeter masonry, from inside. 4,000 ft is not a plausible frame; it is the
    // statement that the guard does not depend on the number being plausible.
    for (const d of ABSURD) {
      const north = step(HALL_N, { u: HALL_U, v: HALL_N.v + d }, ctx);
      expect([d, north.v <= P.sectionLength - RADIUS + 1e-9]).toEqual([d, true]);
      const west = step({ u: 8, v: 39 }, { u: 8 - d, v: 39 }, ctx);
      expect([d, west.u >= RADIUS - 1e-9]).toEqual([d, true]);
    }
  });

  /**
   * The suite's doorway components, computed here from buildWalls()'s own openings rather
   * than read out of route.ts, so the two cannot agree by construction.
   *
   * There is one of them plus one sealed room, and the seal is a choice rooms.ts explains:
   * the 7.5 ft strip beside the bathroom has no door because "giving it a door would mean
   * choosing whose door it is". So the crossing assertion the sweeps below make is about
   * the strip, and only about the strip.
   *
   * IT USED TO BE TWO COMPONENTS PLUS THE SEAL, because no door was hung between the hall
   * and the common room -- a gap in walls.ts rather than a choice, and it made an unusually
   * strong tunnelling statement available: there was no walk at all between the suite's two
   * halves. That door has landed, so that half of the statement is gone and what is left is
   * weaker. tests/route.test.ts pins the topology itself; the 600,000-hop substep test is
   * what now carries the guarantee the lost half sampled from the outside.
   */
  const componentOf = (() => {
    const edges = openings
      .filter((o) => canPass(o))
      .filter((o) => o.connects.every((id) => suite.rooms.some((r) => r.id === id)))
      .map((o) => o.connects);
    const comp = new Map<string, number>();
    let n = 0;
    for (const r of suite.rooms) {
      if (comp.has(r.id)) continue;
      const mark = n++;
      comp.set(r.id, mark);
      const queue = [r.id];
      while (queue.length > 0) {
        const at = queue.shift()!;
        for (const e of edges) {
          for (const [x, y] of [e, [...e].reverse()]) {
            if (x === at && y !== undefined && !comp.has(y)) {
              comp.set(y, mark);
              queue.push(y);
            }
          }
        }
      }
    }
    return (id: string | null) => (id === null ? null : (comp.get(id) ?? null));
  })();

  it("splits the default suite into two doorway components: the suite, and the sealed strip", () => {
    // Non-vacuity for the sweeps below: with ONE component the assertion is empty, because
    // there would be no pair of rooms a walker must not get between. Two is the minimum
    // that leaves it saying anything, and the second is a single room -- so what the sweeps
    // forbid is precisely "a walker got into the unknown strip", which is also what
    // "holds every invariant over 300 suites" asserts directly at the bottom of this file.
    //
    // Three before the hall-to-common-room door: [bath bedA bedB hall], [common1 k],
    // [unknown]. The first two are one group now.
    const groups = new Map<number, string[]>();
    for (const r of suite.rooms) {
      const c = componentOf(r.id)!;
      groups.set(c, [...(groups.get(c) ?? []), r.id]);
    }
    expect(
      [...groups.values()].map((g) => [...g].sort()).sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ).toEqual([["bath", "bedA", "bedB", "common1", "hall", "k"], ["unknown"]]);
    // The strip really is alone in its own component, which is the fact the crossing
    // assertions rest on, and it is the only room that is.
    expect(componentOf("unknown")).not.toBe(componentOf("hall"));
    expect([...groups.values()].filter((g) => g.length === 1).map((g) => g[0])).toEqual([
      "unknown",
    ]);
  });

  /**
   * Random clear starts, random bearings, a given set of step sizes. A walker that ends
   * up in a different doorway component from the one it started in went through plaster,
   * whatever path it took to get there; a walker outside the ring left the building.
   */
  const sweep = (seed: number, n: number, sizes: number[]) => {
    const rnd = makeRnd(seed);
    let steps = 0;
    let crossings = 0;
    let worst = Infinity;
    for (let i = 0; i < n; i++) {
      const from = randomStand(rnd, ctx, ring);
      if (!from) continue;
      const bearing = rnd() * Math.PI * 2;
      const d = sizes[Math.floor(rnd() * sizes.length)]!;
      const got = step(
        from,
        { u: from.u + Math.cos(bearing) * d, v: from.v + Math.sin(bearing) * d },
        ctx,
      );
      steps++;
      worst = Math.min(worst, clearance(got, ctx));
      const a = componentOf(roomAt(from, ctx));
      const b = componentOf(roomAt(got, ctx));
      if (a !== null && b !== null && a !== b) {
        crossings++;
        expect([roomAt(from, ctx), from, d, bearing, got]).toEqual(["no crossing", 0, 0, 0, 0]);
      }
      if (!inRing(got)) expect([from, d, bearing, got]).toEqual(["in the footprint", 0, 0, 0]);
    }
    return { steps, crossings, worst };
  };

  it("never puts the walker in a room no doorway chain reaches, over 40,000 steps", () => {
    // Measured: 40,000 steps, 0 crossings, worst clearance -1.4e-15 -- float noise on a
    // walker resolved flush against a band, six orders inside walk.ts's own epsilon.
    const got = sweep(20260730, 40000, [0.05, 0.4, 1.5, 8, 40]);
    expect(got.steps).toBe(40000);
    expect(got.crossings).toBe(0);
    expect(got.worst).toBeGreaterThan(-1e-9);
  });

  it("still does not, at 400 ft and 4,000 ft a frame", () => {
    // The absurd end of the same sweep, on its own and with a smaller sample, because a
    // 4,000 ft displacement is 10,667 substeps and paying for that 40,000 times costs a
    // minute of gate time to say what 40 ft already says.
    // Measured: 300 steps, 0 crossings, worst clearance exactly 0.
    const got = sweep(20260731, 300, [400, 4000]);
    expect(got.steps).toBe(300);
    expect(got.crossings).toBe(0);
    expect(got.worst).toBeGreaterThan(-1e-9);
  });

  it("never penetrates a solid over 600,000 consecutive substep-scale hops", () => {
    /*
     * The interior guarantee, and the one place a swept-segment test is exact: at a
     * displacement of at most SUBSTEP, step() takes one substep, so the chord IS the
     * path. 3,000 walkers, 200 hops each, bearing re-rolled 5% of the time so they grind
     * along walls and into corners rather than crossing open floor.
     */
    const rnd = makeRnd(777);
    let hops = 0;
    let penetrations = 0;
    let longest = 0;
    for (let i = 0; i < 3000; i++) {
      let at = randomStand(rnd, ctx, ring);
      if (!at) continue;
      let bearing = rnd() * Math.PI * 2;
      for (let j = 0; j < 200; j++) {
        if (rnd() < 0.05) bearing = rnd() * Math.PI * 2;
        const d = SUBSTEP * (0.2 + rnd() * 0.8);
        const next = step(
          at,
          { u: at.u + Math.cos(bearing) * d, v: at.v + Math.sin(bearing) * d },
          ctx,
        );
        hops++;
        longest = Math.max(longest, dist(at, next));
        for (const s of ctx.solids) {
          if (segHitsRect(at, next, s)) {
            penetrations++;
            expect([s.wallId, at, next]).toEqual(["no penetration", 0, 0]);
          }
        }
        at = next;
      }
    }
    expect(hops).toBeGreaterThan(500000);
    expect(penetrations).toBe(0);
    // A hop can slightly exceed SUBSTEP, because resolve() pushes as well as advancing:
    // the bound that matters is that it stays under the 2 * RADIUS a crossing needs.
    expect(longest).toBeLessThan(2 * RADIUS);
  });
});

describe("walk: one frame of input", () => {
  const open = { u: 8, v: 39 }; // middle of bedroom B, 4 ft of clearance every way

  it("faces +v at heading zero and +u at ninety degrees", () => {
    // frames.ts's azimuthToBuilding() convention, restated. A sign error here mirrors
    // the controls, which reads as a broken mouse rather than as a broken bearing.
    const north = walk(
      { p: open, heading: 0, pitch: 0 },
      { forward: 1, strafe: 0, turn: 0, pitch: 0 },
      0.5,
      ctx,
    );
    expect(north.p.v - open.v).toBeCloseTo(SPEED * 0.5, 9);
    expect(north.p.u).toBeCloseTo(open.u, 9);
    const inward = walk(
      { p: open, heading: Math.PI / 2, pitch: 0 },
      { forward: 1, strafe: 0, turn: 0, pitch: 0 },
      0.5,
      ctx,
    );
    expect(inward.p.u - open.u).toBeCloseTo(SPEED * 0.5, 9);
    expect(inward.p.v).toBeCloseTo(open.v, 9);
  });

  it("strafes ninety degrees off the heading", () => {
    const right = walk(
      { p: open, heading: 0, pitch: 0 },
      { forward: 0, strafe: 1, turn: 0, pitch: 0 },
      0.5,
      ctx,
    );
    expect(right.p.u - open.u).toBeCloseTo(SPEED * 0.5, 9);
    expect(right.p.v).toBeCloseTo(open.v, 9);
  });

  it("normalises the diagonal, so 45 degrees is not the fast way across a room", () => {
    // Forward and strafe together would otherwise cover sqrt(2) * SPEED.
    const diag = walk(
      { p: open, heading: 0, pitch: 0 },
      { forward: 1, strafe: 1, turn: 0, pitch: 0 },
      0.4,
      ctx,
    );
    expect(dist(open, diag.p)).toBeCloseTo(SPEED * 0.4, 9);
    const back = walk(
      { p: open, heading: 0, pitch: 0 },
      { forward: -1, strafe: -1, turn: 0, pitch: 0 },
      0.4,
      ctx,
    );
    expect(dist(open, back.p)).toBeCloseTo(SPEED * 0.4, 9);
    // and a half-pressed stick is still slower than a full one
    const half = walk(
      { p: open, heading: 0, pitch: 0 },
      { forward: 0.5, strafe: 0, turn: 0, pitch: 0 },
      0.4,
      ctx,
    );
    expect(dist(open, half.p)).toBeCloseTo(SPEED * 0.4 * 0.5, 9);
  });

  it("turns at TURN_RATE and wraps the bearing to (-pi, pi]", () => {
    const t = walk(
      { p: open, heading: 0, pitch: 0 },
      { forward: 0, strafe: 0, turn: 1, pitch: 0 },
      0.5,
      ctx,
    );
    expect(t.heading).toBeCloseTo(TURN_RATE * 0.5, 9);
    expect(t.p).toEqual(open);
    // 1.5 s at 120 deg/s is a 180 degree turn, which wraps to +pi and not to -pi
    const about = walk(
      { p: open, heading: 0, pitch: 0 },
      { forward: 0, strafe: 0, turn: 1, pitch: 0 },
      1.5,
      ctx,
    );
    expect(about.heading).toBeCloseTo(Math.PI, 9);
    for (const dt of [0.5, 1, 2, 3, 7, 30]) {
      for (const sign of [1, -1]) {
        const h = walk(
          { p: open, heading: 0, pitch: 0 },
          { forward: 0, strafe: 0, turn: sign, pitch: 0 },
          dt,
          ctx,
        ).heading;
        expect([dt, sign, h > -Math.PI && h <= Math.PI]).toEqual([dt, sign, true]);
      }
    }
  });

  it("turns first, so a key held down walks along the new bearing in the same frame", () => {
    // The other order lags the turn by a frame, which at 20 Hz is a camera that slides
    // sideways out of the turn. Turning 90 degrees and walking must move in u, not v.
    const dt = Math.PI / 2 / TURN_RATE;
    const got = walk(
      { p: open, heading: 0, pitch: 0 },
      { forward: 1, strafe: 0, turn: 1, pitch: 0 },
      dt,
      ctx,
    );
    expect(got.heading).toBeCloseTo(Math.PI / 2, 9);
    expect(got.p.u - open.u).toBeCloseTo(SPEED * dt, 9);
    expect(got.p.v).toBeCloseTo(open.v, 9);
  });

  it("does nothing on no input, and nothing on a zero dt", () => {
    expect(walk({ p: open, heading: 1, pitch: 0 }, NO_INPUT, 1 / 60, ctx)).toEqual({
      p: open,
      heading: 1,
      pitch: 0,
    });
    expect(
      walk(
        { p: open, heading: 1, pitch: 0 },
        { forward: 1, strafe: 0, turn: 0, pitch: 0 },
        0,
        ctx,
      ).p,
    ).toEqual(open);
  });

  it("survives a 30 second frame from a backgrounded tab", () => {
    // dt is deliberately not clamped here -- SUBSTEP's docblock says so -- so this is
    // 120 ft of walking in one call, in 24 directions, from every room the walker can
    // stand in. It may not leave the suite and it may not change component.
    let cases = 0;
    for (const r of suite.rooms) {
      const from = { u: r.u + r.du / 2, v: r.v + r.dv / 2 };
      if (!isClear(from, ctx)) continue;
      for (let i = 0; i < 24; i++) {
        const got = walk(
          { p: from, heading: (i / 24) * 2 * Math.PI, pitch: 0 },
          { forward: 1, strafe: 0, turn: 0, pitch: 0 },
          30,
          ctx,
        );
        cases++;
        expect([r.id, i, inRing(got.p)]).toEqual([r.id, i, true]);
        expect([r.id, i, clearance(got.p, ctx) > -1e-9]).toEqual([r.id, i, true]);
        expect([r.id, i, roomAt(got.p, ctx) === "unknown"]).toEqual([
          r.id,
          i,
          r.id === "unknown",
        ]);
      }
    }
    expect(cases).toBe(7 * 24);
  });
});

describe("pitch: looking up and down", () => {
  const open = { u: 8, v: 39 }; // middle of bedroom B, same spot the frame tests use

  it("clamps both ways and does not wrap", () => {
    // 100 frames of dt 0.1 at input.pitch = -1 asks for 100 * TURN_RATE * 0.1 = about
    // 20.9 rad of downward look, twelve times PITCH_LIMIT. The clamp inside walk() catches
    // it every frame, so the walker is pinned at -PITCH_LIMIT long before frame 100 and
    // sits there rather than rolling past it -- the thing wrap() would do and this must not.
    let down = { p: open, heading: 0, pitch: 0 };
    for (let i = 0; i < 100; i++) {
      down = walk(down, { forward: 0, strafe: 0, turn: 0, pitch: -1 }, 0.1, ctx);
    }
    expect(down.pitch).toBe(-PITCH_LIMIT);
    // one more frame at the limit changes nothing
    expect(walk(down, { forward: 0, strafe: 0, turn: 0, pitch: -1 }, 0.1, ctx).pitch).toBe(
      -PITCH_LIMIT,
    );

    let up = { p: open, heading: 0, pitch: 0 };
    for (let i = 0; i < 100; i++) {
      up = walk(up, { forward: 0, strafe: 0, turn: 0, pitch: 1 }, 0.1, ctx);
    }
    expect(up.pitch).toBe(PITCH_LIMIT);
    expect(walk(up, { forward: 0, strafe: 0, turn: 0, pitch: 1 }, 0.1, ctx).pitch).toBe(
      PITCH_LIMIT,
    );
  });

  it("does not move the walker, whatever it is aimed at", () => {
    // The same 40-frame walk -- forward, strafe and turn all live -- run three times,
    // differing only in the pitch the walker starts and stays at. Bit-identical `p` is the
    // property that says walking stays horizontal however far up or down you are looking.
    const run = (pitch0: number): Vec2 => {
      let state = { p: open, heading: 0.3, pitch: pitch0 };
      for (let i = 0; i < 40; i++) {
        state = walk(state, { forward: 0.7, strafe: -0.4, turn: 0.2, pitch: 0 }, 1 / 60, ctx);
      }
      return state.p;
    };
    const level = run(0);
    expect(run(PITCH_LIMIT)).toEqual(level);
    expect(run(-PITCH_LIMIT)).toEqual(level);
  });

  it("is not moved by the walker, even across a collision that needs more than one pass to settle", () => {
    // The same inside corner as "settles flush in BOTH axes in an inside corner" above --
    // bedroom B's south-west corner, where a single resolve() pass cannot settle both walls
    // at once -- run through walk() instead of step() directly, so that whichever of
    // resolve()'s extra passes or step()'s per-axis retry the collision needs happens under
    // a nonzero pitch. input.pitch is 0 throughout, so pitch must come out exactly as it
    // went in regardless of what the position maths had to do to resolve the corner.
    const from = { u: 2, v: 36 };
    const to = { u: -4, v: 30 };
    const heading = Math.atan2(to.u - from.u, to.v - from.v);
    const dt = dist(from, to) / SPEED;
    const got = walk(
      { p: from, heading, pitch: 0.37 },
      { forward: 1, strafe: 0, turn: 0, pitch: 0 },
      dt,
      ctx,
    );
    expect(got.pitch).toBe(0.37);
    // and it really did resolve the corner, so this is the collision case and not a no-op
    expect(got.p).toEqual({ u: RADIUS, v: 34 + RADIUS });
  });

  it("the early return carries pitch, so looking around while standing still works", () => {
    // walk()'s zero-magnitude early return is the common case for a pure look: no forward,
    // no strafe, no turn. It must still apply the pitch clamp line, or holding the look-down
    // key while standing still would silently do nothing.
    const got = walk(
      { p: open, heading: 0, pitch: 0 },
      { forward: 0, strafe: 0, turn: 0, pitch: -1 },
      1 / 60,
      ctx,
    );
    expect(got.p).toEqual(open);
    expect(got.pitch).toBeCloseTo(-TURN_RATE / 60, 12);
    expect(got.pitch).not.toBe(0);
  });
});

describe("the sliders move the walls, so all of it again on randomised suites", () => {
  /*
   * 30 s, not vitest's 5.
   *
   * MEASURED: this sweep takes 4.1 s in isolation, which passes, and it failed once in a
   * full run while three other agents were driving Playwright on the same cores. So the
   * default left about 0.9 s of headroom on a machine under load, and the failure mode is
   * a timeout that reads exactly like a geometry regression.
   *
   * Raising the budget rather than shrinking the sweep, for the reason playwright.config.ts
   * gives about the same trade: 300 randomised suites is what makes this a property test
   * rather than a check of one arrangement, and tunnelling only shows up on a slow frame,
   * which is what the absurd step size simulates. Trimming it to fit a timer would remove
   * the evidence to protect the clock.
   */
  it("holds every invariant over 300 suites and 24,000 absurd steps", { timeout: 30_000 }, () => {
    const rnd = makeRnd(4242);
    let steps = 0;
    let worst = Infinity;
    let moved = 0;
    for (let i = 0; i < 300; i++) {
      const p = jittered(rnd);
      const s = buildSuite(p);
      const c = walkContext(s);
      const r = ringOf(s);
      if (Math.abs(p.sectionLength - P.sectionLength) > 1) moved++;
      for (let j = 0; j < 80; j++) {
        const from = randomStand(rnd, c, r, 40);
        if (!from) continue;
        const bearing = rnd() * Math.PI * 2;
        const d = [0.3, 8, 40, rnd() < 0.2 ? 400 : 40][Math.floor(rnd() * 4)]!;
        const got = step(
          from,
          { u: from.u + Math.cos(bearing) * d, v: from.v + Math.sin(bearing) * d },
          c,
        );
        steps++;
        worst = Math.min(worst, clearance(got, c));
        if (!pointInPolygon([got.u, got.v], r)) {
          expect([i, j, from, got]).toEqual(["in the footprint", 0, 0, 0]);
        }
        if (!insideSuite(got, c)) expect([i, j, from, got]).toEqual(["in the suite", 0, 0, 0]);
        // The unknown strip has no door in any suite, so nothing may walk into it.
        if (roomAt(from, c) !== "unknown" && roomAt(got, c) === "unknown") {
          expect([i, j, from, got]).toEqual(["not into the strip", 0, 0, 0]);
        }
      }
    }
    // Non-vacuity: the sliders really did move, and the sweep really did run. Measured:
    // 24,000 steps over 300 suites, 237 of them with the section length more than a foot
    // off the default, worst clearance -2.0e-15.
    //
    // The 237 was 221 before the hall-to-common-room door, and the sliders did not change.
    // randomStand() draws until it finds a CLEAR point, so how many draws it takes depends
    // on the solids -- and the door split w0 and moved every draw after the first suite.
    // The count is a property of the seed's path through the generator, not of the suite.
    expect(steps).toBe(24000);
    expect(moved).toBeGreaterThan(200);
    expect(worst).toBeGreaterThan(-1e-9);
  });

  it("cuts a walkable hole for every door buildWalls() hangs, in every suite", () => {
    // The sliver defect showed up in 12 of 6,226 randomised routes and in none of the
    // default suite, so it needs the sweep to be visible at all. Here it is stated
    // directly: stand one standoff off each face of every interior doorway and cross.
    const rnd = makeRnd(90210);
    let doors = 0;
    let split = 0;
    for (let i = 0; i < 300; i++) {
      const s = buildSuite(jittered(rnd));
      const c = walkContext(s);
      const byId = new Map(s.rooms.map((x) => [x.id, x]));
      for (const o of c.openings) {
        if (o.kind !== "door") continue;
        if (!o.connects.every((id) => byId.has(id))) continue;
        const w = c.walls.find((x) => x.id === o.wallId)!;
        const alongV = !(w.du > w.dv);
        const mid = (alongV ? w.v : w.u) + o.offset + o.width / 2;
        const pair = o.connects.map((id) => byId.get(id)!);
        const face = (x: Rect, hi: boolean) =>
          alongV ? (hi ? x.u + x.du : x.u) : hi ? x.v + x.dv : x.v;
        const lo = Math.min(...pair.map((x) => face(x, true)));
        const hi = Math.max(...pair.map((x) => face(x, false)));
        const stand = RADIUS + 0.25;
        const from: Vec2 = alongV ? { u: lo - stand, v: mid } : { u: mid, v: lo - stand };
        const to: Vec2 = alongV ? { u: hi + stand, v: mid } : { u: mid, v: hi + stand };
        if (!isClear(from, c) || !isClear(to, c)) continue;
        doors++;
        // How many bands stand in this doorway. More than one is the case the fix is for.
        const inGap = c.walls.filter((x) =>
          alongV
            ? x.u >= lo - 1e-9 && x.u + x.du <= hi + 1e-9
            : x.v >= lo - 1e-9 && x.v + x.dv <= hi + 1e-9,
        );
        if (inGap.length > 1) split++;
        if (dist(step(from, to, c), to) > 1e-6) {
          expect([i, o.id, inGap.length, from, to, step(from, to, c)]).toEqual([
            "walkable",
            0,
            0,
            0,
            0,
            0,
          ]);
        }
        if (dist(step(to, from, c), from) > 1e-6) {
          expect([i, o.id, inGap.length]).toEqual(["walkable both ways", 0, 0]);
        }
      }
    }
    // Non-vacuity, measured: 1,454 doorways over 300 suites, and 992 of them have the
    // partition split into more than one band, which is how thoroughly the default suite's
    // tidy arithmetic was hiding this. Without that second count the test would pass on a
    // build that never produced a split at all.
    //
    // 1,168 and 992 before the hall-to-common-room door, so it contributed 286 crossings of
    // the 300 -- the other 14 are suites where one side of it is too narrow to stand a
    // walker clear of the band at all, and are skipped by the isClear() guard above. It
    // contributed none of the splits: it is hung in w0, which the footprint grid does not
    // cut, so the count of split partitions is unchanged at 992.
    expect(doors).toBeGreaterThan(1400);
    expect(split).toBeGreaterThan(900);
  });
});
