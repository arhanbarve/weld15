/**
 * Walking the suite: one step, with the wall bands in the way.
 *
 * WHAT THIS PAYS BACK. stages.ts records the defect that made P7 necessary: a
 * straight camera path from bedroom B to the hall passes through the partition
 * between them, and at t = 0.7 the camera stood half a foot from that wall --
 * exactly Experience.tsx's near plane of 0.5 -- so every face clipped and the frame
 * went empty. The fix is not a longer blend. It is a walker with a radius, which
 * cannot be closer to a wall than that radius, and a route through the doorway
 * rather than through the plaster. RADIUS below is 0.75 ft for exactly that reason,
 * among others: the near plane can never be reached again by construction.
 *
 * NO THREE.JS, and this is not taste. scripts/emit-layout.mjs and
 * scripts/emit-plan.mjs import geometry modules by path in plain node and
 * tests/drift.test.ts shells out to both, so three anywhere in their reachable set
 * is an ERR_MODULE_NOT_FOUND at import that tsc reports nothing about -- it has got
 * in twice already, once through rooms.ts and once through url.ts, past a green
 * typecheck both times (place.ts's maxSectionLength docblock carries that story).
 * cutaway.ts and orbit.ts are the precedent: both live under src/scene/ and are
 * deliberately three-free and both say so. This module is the third. FirstPerson.tsx
 * is where three is allowed.
 *
 * FRAME. The suite frame, the same one rooms.ts, collide.ts and drag.ts use:
 *   u = feet inward from the outer facade
 *   v = feet north along the end section
 * The camera lives in three.js world space, Y up and north at -Z. FirstPerson.tsx
 * converts, with place.ts's suiteToThree() going out and cutaway.ts's
 * cameraInSuite() coming back. Nothing here knows either exists.
 *
 * HEIGHT IS DROPPED. Every wall band is a vertical prism from floor to ceiling, so
 * no height can change which side of a vertical face the walker is on -- the same
 * argument cutaway.ts makes for throwing the camera's Y away on the way in. EYE is
 * exported for the renderer to stand the camera at and is used by nothing here.
 * Pitch is dropped from the same maths for the same reason: a wall band is a
 * vertical prism whichever way the eye is tilted, so no pitch changes which side
 * of a vertical face the walker is on either.
 *
 * WHAT COLLISION IS AGAINST. buildWalls(suite) already emits the bands and the
 * openings, exactly once each, and this module invents no geometry of its own: a
 * doorway becomes a void subtracted from every band standing in it -- usually one,
 * leaving the two jambs either side of the hole -- and everything else stays whole.
 * See solidsOf().
 */

import type { Rect, Suite } from "@/geo/rooms";
import { buildWalls, suiteFootprint, type Opening, type Wall } from "@/geo/walls";
import { bathFixtureParts } from "@/geo/fixtures";

/** A point in the suite frame, in feet. */
export type Vec2 = { u: number; v: number };

/**
 * Eye height, ft. ASSUMED, and stages.ts assumed it first -- its `EYE` is this
 * number and this is the same 5 ft 2 in, restated here rather than imported
 * because stages.ts does not export it and importing a scene module that pulls
 * place.ts and buildSuite in for one scalar is worse than the duplication.
 *
 * What bounds it: it is a standing adult's eye, so somewhere between about 4 ft 9 in
 * (a 5th-percentile adult) and 6 ft 3 in, and the choice inside that changes nothing
 * this module computes -- height is dropped, see the header. It matters only to how
 * the room reads. WAS 5 ft 10 in; docs/phases/P11-PHOTOREAL.md decision 7 lowered it
 * to 5 ft 2 in because the opening first-person shot read as a 7 ft tall viewer --
 * decision 8 is that this one constant is shared, so the opening shot and the walker
 * come down together. The -8 deg look-down pitch in route.ts's standingPose() is
 * unchanged; only the eye it starts from moved. tests/walk.test.ts pins it against
 * stages.ts's own arithmetic so the two cannot drift.
 */
export const EYE = 5 + 2 / 12;

/**
 * The walker's radius in plan, ft. ASSUMED. 0.75 ft, i.e. an 18 in shoulder width.
 *
 * Bounded from BELOW by the renderer, and this is the interesting half. Experience.tsx
 * opens the canvas with near = 0.5, and the stage 4 -> 5 defect stages.ts records is
 * a camera that ended up half a foot from a partition -- at the near plane, so every
 * face clipped and the frame went black. A walker whose centre is never nearer than
 * RADIUS to any solid can only reproduce that if RADIUS <= 0.5. So the radius has to
 * clear the near plane, with margin, and 0.75 is 1.5 times it.
 *
 * Bounded from ABOVE by the doorways. buildOpenings() hangs 3 ft doors on the three
 * hall bands and on K's, so the clear width the walker has to fit through is 3 ft and
 * the radius must be under half of it or the suite has no way out of any room --
 * canPass() is that test, and a radius of 1.5 would fail every door in the model.
 * 0.75 leaves 0.75 ft of clearance on each side of a 3 ft doorway, which is the same
 * order as the 1.5 ft corridor a real 32 in door leaf gives a real shoulder.
 *
 * NOT drag.ts's DOOR_CLEARANCE and not collide.ts's GRID, both of which are also
 * fractions of a foot. drag.ts's docblock on DOOR_CLEARANCE records what happens when
 * a coincidence of magnitude is written as a dependency: correcting one value moves
 * something it was never about.
 */
export const RADIUS = 0.75;

/**
 * Walking speed, ft/s. ASSUMED.
 *
 * Bounded below by the suite: the section is 44 ft long, and at 2 ft/s crossing it
 * takes 22 s, which is long enough that a viewer stops believing they are walking and
 * starts believing the app has stalled. Bounded above by what a walk is: 5.9 ft/s
 * (4 mph) is a brisk outdoor pace and anything past it is a run through somebody's
 * bedroom. 4 ft/s is 2.7 mph, an unhurried indoor walk, and puts the hall's 28.5 ft
 * end to end at about 7 s.
 *
 * Nothing in this project sources it and nothing can: it is a property of the person,
 * not of Weld.
 */
export const SPEED = 4;

/**
 * Turn rate for a key held down, radians/s. ASSUMED, 120 degrees per second.
 *
 * Bounded below by needing to turn round: a 180 degree turn to look back down the
 * hall takes 1.5 s at this rate, and at 45 deg/s it would take four, which reads as
 * a stuck key. Bounded above by legibility -- past about 240 deg/s a tap of the key
 * overshoots the doorway you were aiming at. The pointer's own rate is a separate
 * decision and lives in FirstPerson.tsx, because it is degrees per pixel rather than
 * per second.
 */
export const TURN_RATE = (120 * Math.PI) / 180;

/**
 * How far the walker may travel between two collision tests, ft.
 *
 * DERIVED, and it is the whole tunnelling guard. A disc of radius r is clear of a
 * solid exactly when its centre is at least r from that solid, so a CLEAR position is
 * at least r from every band. Displace it by at most r / 2 and the new point is still
 * at least r / 2 from every band -- strictly outside all of them, and on the same side
 * of each, because crossing a band of thickness t from a standoff of r takes more than
 * r + t. So no substep can land inside a band, and none can land past one. Both halves
 * matter: the second is what stops tunnelling, and the first is what keeps resolve()
 * out of its centre-inside recovery branch, which is the branch that can leave by the
 * WRONG face.
 *
 * THE ARGUMENT ONLY HOLDS IF EACH SUBSTEP STARTS FROM A CLEAR POSITION, which is why
 * step() advances by a fixed delta from the position it resolved rather than sampling
 * the original from -> to line at i / n. It sampled the line first, and that voided the
 * whole guard: the resolved position lags the line as the walker slides, so the next
 * sample was up to r / 2 + (the push) away from where the walker actually stood, which
 * is enough to land 0.2 ft past the far face of a 0.5 ft partition. resolve() then
 * pushed it out by the nearest face -- the far one -- and isClear() agreed, because a
 * position on the wrong side of a wall is perfectly clear of it. Measured before the
 * fix, from the hall at u = 17.25 with one 1 ft step at the solid part of w4: u = 15.25,
 * inside bedroom A. And from u = 8.98, v = 14.20 in the common room with one 120 ft step:
 * u = 120.74, v = -29.50 -- 90 ft past the suite's inner wall and 29 ft south of it, with
 * the whole of Weld behind.
 *
 * This is what makes docs/phases/P7-P8.md's absurd-step requirement pass: 40 ft/s at
 * 5 fps is one 8 ft displacement, far more than the 0.5 ft partition is thick, and it
 * is cut into 22 substeps rather than trusted as one. Sweeping a point against a thin
 * wall is the classic tunnelling bug and it only shows up on a slow frame.
 */
export const SUBSTEP = RADIUS / 2;

/**
 * Float slack, ft. collide.ts's EPSILON, which is not exported, and the same
 * argument: two orders of magnitude below anything a viewer could see and five above
 * the arithmetic noise at suite scale.
 */
const EPS = 1e-9;

/**
 * walls.ts's token for the space on the far side of the suite's entry door.
 *
 * buildOpenings() gives that door `connects: ["hall", "outside"]`, and "outside" is
 * the stair hall, which this project does not model: there is no floor there, no
 * walls, and nothing for the walker to stand on. So it is not a hole. See solidsOf().
 */
const OUTSIDE = "outside";

/** One solid rectangle the walker cannot enter: a whole band, or a jamb beside a door. */
export type Solid = {
  /** the band this came from, so a failure can name it */
  wallId: string;
  u: number;
  v: number;
  du: number;
  dv: number;
};

/**
 * Everything a step needs, built once per suite.
 *
 * Built rather than assembled at the call site because buildWalls() walks a grid and
 * merges rectangles, which is not something to do on the pointer path sixty times a
 * second: P6's gates found hiddenWalls() in a useFrame was a real stall for exactly
 * that reason, and it was doing less than this. FirstPerson.tsx memoises one of these
 * per params.
 *
 * `walls` and `openings` are carried through unused by the maths so that a caller
 * holding a WalkCtx has the same view of the suite this module resolved against --
 * docs/phases/P7-P8.md's contract names them, and a gate that wants to check a
 * doorway needs them.
 */
export type WalkCtx = {
  walls: Wall[];
  openings: Opening[];
  /** the gross footprint: the main leg plus the K bump. An L. */
  footprint: Rect[];
  /** the rooms, for roomAt() */
  rooms: Rect[];
  /** what the walker cannot enter, doors already cut out */
  solids: Solid[];
  /**
   * Fixed fixtures the walker cannot enter either (P14 row 9's bathroom fit-out),
   * kept apart from `solids` rather than folded into it: every solid there comes
   * from exactly one wall band, an invariant tests/walk.test.ts checks directly by
   * looking each one's wallId back up in `walls` -- a fixture has no band to name.
   * clearance() checks both.
   */
  fixtures: Solid[];
  /** the walker's radius in plan, ft */
  radius: number;
};

/**
 * Whether a doorway is wide enough for the walker to get through, ft against ft.
 *
 * STRICTLY wider than the diameter, because a gap exactly 2r across leaves the walker
 * touching both jambs at once -- zero clearance, and a resolver working to a float
 * epsilon cannot be asked to thread it. docs/phases/P7-P8.md wants a 3 ft door
 * passable and a 0.5 ft gap not, and both fall out of this at RADIUS = 0.75.
 *
 * Windows always answer false, whatever their width. n5 is an 8 ft opening in the
 * facade and would pass this test on width alone; it is glazed, it is above the sill,
 * and a walker who could step through it would be standing in mid-air 12 ft above
 * Harvard Yard.
 *
 * This is the ROUTE's test, and the geometry does not depend on it: solidsOf() cuts
 * the hole for every door regardless, so a walker refused by a 0.5 ft gap is refused
 * by arithmetic rather than by this predicate agreeing with it. tests/walk.test.ts
 * checks both halves separately for that reason.
 */
export function canPass(opening: Opening, radius = RADIUS): boolean {
  return opening.kind === "door" && opening.width > 2 * radius;
}

/**
 * Which axis a band runs along. buildOpenings()'s own tie-break, copied rather than
 * inferred: `offset` is measured along whichever axis that function called the long
 * one, and for a square band the two answers differ. drag.ts's doorZone() copies it
 * for the same reason and says so.
 */
function runsAlongV(w: Wall): boolean {
  return !(w.du > w.dv);
}

/**
 * A doorway as a void in the plan: the hole it makes, in absolute suite coordinates.
 *
 * `along` is the interval the walker walks THROUGH, on the band's long axis. `thin` is
 * the range the void spans ACROSS the wall, and it runs from one room's face to the
 * other's rather than from one band's face to its own -- see solidsOf() for the sliver
 * this exists to cut.
 */
type DoorVoid = {
  alongV: boolean;
  alongLo: number;
  alongHi: number;
  thinLo: number;
  thinHi: number;
};

/**
 * The bands, with the walkable doorways cut out of them.
 *
 * A band is solid except where a door goes through it, and the doors that go through
 * it are the ones with modelled floor on BOTH sides. Two openings are therefore left
 * whole:
 *
 *   the suite entry (d4, hall to "outside")   There is no stair hall in this model.
 *     Cutting it would let the walker step out of the suite into nothing, and
 *     "never leaves the suite" is the property docs/phases/P7-P8.md asks for.
 *   every window                              Glazed, and 12 ft up. canPass() says so.
 *
 * A door whose two rooms are both present is cut whatever its width, including one
 * too narrow to use: the walker is then refused by the jambs rather than by a rule,
 * which is a stronger statement and the one the tests check.
 *
 * THE TRAP, which drag.ts's doorZone() hit first: `offset` is measured along the
 * BAND, from the band's origin corner, and bands merge. w4 carries bedroom A's door
 * and runs that room's full 10 ft; p12 carries the suite entry and runs 31.5 ft, past
 * the hall at both ends. So the hole has to be built off the wall's own origin and
 * axis, never off a room's.
 *
 * THE SECOND TRAP, and it took a randomised sweep to find: a door is hung in ONE band,
 * and the partition it is hung in is not always one band. buildWalls() cuts its grid on
 * every room edge AND every footprint edge, so an interior gap whose two faces are not
 * both room edges gets split. At bedDepth 16 the defaults put legDepth and commonDeep
 * both at 20 and nothing splits; move the sliders apart and the common room's inner
 * face lands at u = 20.151 while legDepth -- the leg footprint's own edge -- lands at
 * 20.161, so the 0.5 ft partition between the common room and K comes out as a 0.0095 ft
 * sliver plus the rest. wallBetween() hangs the door in the thick half, because the thin
 * half's probe finds a room on one face only and so `separates` nothing, and the walker
 * then meets a hundredth of a foot of plaster stretched across the doorway. Measured
 * before this fix: 12 of 6226 randomised routes had an unwalkable doorway segment, all
 * of them common room to K, and the walker stopped 0.24 ft into a 2.5 ft crossing.
 *
 * So a door is cut as a VOID rather than as an interval in one rectangle: the interval
 * along the band's long axis, crossed with the full range from one room's face to the
 * other's, subtracted from every band parallel to it that the void actually overlaps.
 * That is what a doorway is in the plan, and it does not care how walls.ts split the
 * assembly. The void's thin range is unioned with the named band's own, so a suite
 * whose two rooms somehow overlap across the wall still gets at least the old hole.
 */
export function solidsOf(
  walls: Wall[],
  openings: Opening[],
  rooms: readonly Rect[],
  radius = RADIUS,
): Solid[] {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const byWall = new Map(walls.map((w) => [w.id, w]));
  const out: Solid[] = [];

  const voids: DoorVoid[] = [];
  for (const o of openings) {
    if (o.kind !== "door") continue;
    if (!o.connects.every((id) => id !== OUTSIDE && byId.has(id))) continue;
    const w = byWall.get(o.wallId);
    if (!w) continue;
    const alongV = runsAlongV(w);
    const lo = alongV ? w.v : w.u;
    const span = alongV ? w.dv : w.du;
    // Clipped to the band it is hung in. A door wider than that band would otherwise
    // produce a negative interval; buildOpenings() clamps the width already, but a wall
    // list and an opening list can arrive from two different builds.
    const alongLo = Math.max(lo + o.offset, lo);
    const alongHi = Math.min(lo + o.offset + o.width, lo + span);
    if (alongHi - alongLo <= EPS) continue;

    const faces = o.connects.map((id) => byId.get(id)!);
    const near = (r: Rect) => (alongV ? r.u + r.du : r.v + r.dv);
    const far = (r: Rect) => (alongV ? r.u : r.v);
    voids.push({
      alongV,
      alongLo,
      alongHi,
      thinLo: Math.min(alongV ? w.u : w.v, ...faces.map(near)),
      thinHi: Math.max(alongV ? w.u + w.du : w.v + w.dv, ...faces.map(far)),
    });
  }

  for (const w of walls) {
    const alongV = runsAlongV(w);
    const lo = alongV ? w.v : w.u;
    const span = alongV ? w.dv : w.du;
    const thinLo = alongV ? w.u : w.v;
    const thinHi = alongV ? w.u + w.du : w.v + w.dv;

    // Every hole in this band, as intervals along its own long axis, in order. A void
    // counts when it runs the same way and genuinely overlaps this band across the
    // wall -- touching at a face is not overlapping, or the party-wall stub beside K's
    // doorway would lose a piece it is not in the way of.
    const holes = voids
      .filter((d) => d.alongV === alongV)
      .filter((d) => Math.min(d.thinHi, thinHi) - Math.max(d.thinLo, thinLo) > EPS)
      .map((d) => ({ a: Math.max(d.alongLo, lo), b: Math.min(d.alongHi, lo + span) }))
      .filter((h) => h.b - h.a > EPS)
      .sort((x, y) => x.a - y.a);

    const emit = (a: number, b: number) => {
      if (b - a <= EPS) return;
      out.push(
        alongV
          ? { wallId: w.id, u: w.u, v: a, du: w.du, dv: b - a }
          : { wallId: w.id, u: a, v: w.v, du: b - a, dv: w.dv },
      );
    };

    let cursor = lo;
    for (const h of holes) {
      emit(cursor, h.a);
      cursor = Math.max(cursor, h.b);
    }
    emit(cursor, lo + span);
  }

  // radius is a parameter of the WALKER, not of the geometry, so nothing above reads
  // it. Kept in the signature because every other function here takes it and a caller
  // that had to remember which ones do would eventually pass it to the wrong one.
  void radius;
  return out;
}

/**
 * The bathroom's fixed fixtures (P14 row 9), as Solids -- geo/fixtures.ts's own
 * `solid` field, given a synthetic wallId since they came from no wall band. `0` for
 * `floor`: FixturePart carries a y0/y1 this module never reads (HEIGHT IS DROPPED,
 * see the header), so any value produces the same u/v/du/dv.
 */
function bathFixtureSolids(rooms: readonly Rect[]): Solid[] {
  const bath = rooms.find((r) => r.kind === "bath");
  if (!bath) return [];
  return bathFixtureParts(bath, 0).solid.map((p, i) => ({
    wallId: `fixture:bath:${i}`,
    u: p.u,
    v: p.v,
    du: p.du,
    dv: p.dv,
  }));
}

/** Everything a step needs, for one suite. Memoise this per params, not per frame. */
export function walkContext(suite: Suite, radius = RADIUS): WalkCtx {
  const { walls, openings } = buildWalls(suite);
  return {
    walls,
    openings,
    footprint: suiteFootprint(suite),
    rooms: suite.rooms,
    solids: solidsOf(walls, openings, suite.rooms, radius),
    fixtures: bathFixtureSolids(suite.rooms),
    radius,
  };
}

/** Distance from a point to a rectangle, zero inside it. */
function distanceTo(p: Vec2, r: { u: number; v: number; du: number; dv: number }): number {
  const du = Math.max(r.u - p.u, 0, p.u - (r.u + r.du));
  const dv = Math.max(r.v - p.v, 0, p.v - (r.v + r.dv));
  return Math.hypot(du, dv);
}

/**
 * How much room the walker has, ft: the distance from its edge to the nearest solid.
 *
 * Negative means the walker is inside a wall band, which is the thing that must never
 * happen and the number a Playwright gate can assert on. Infinity for a suite with no
 * walls at all, which a slider closing every room to nothing can produce.
 */
export function clearance(p: Vec2, ctx: WalkCtx): number {
  let best = Infinity;
  for (const s of ctx.solids) {
    const d = distanceTo(p, s) - ctx.radius;
    if (d < best) best = d;
  }
  for (const s of ctx.fixtures) {
    const d = distanceTo(p, s) - ctx.radius;
    if (d < best) best = d;
  }
  return best;
}

/** Is the walker clear of every band? The invariant, as a predicate. */
export function isClear(p: Vec2, ctx: WalkCtx): boolean {
  return clearance(p, ctx) > -EPS;
}

/**
 * Is the walker inside the suite at all?
 *
 * Against the GROSS footprint rather than the rooms, and that is not laxity: a walker
 * halfway through a doorway stands inside the band, which is inside the footprint and
 * inside no room. suiteFootprint() is the L that rooms plus walls tile, so "in the
 * footprint and clear of every band" is exactly "on the suite's floor or in one of its
 * doorways" and nothing else.
 */
export function insideSuite(p: Vec2, ctx: WalkCtx): boolean {
  return ctx.footprint.some(
    (r) =>
      p.u > r.u - EPS &&
      p.u < r.u + r.du + EPS &&
      p.v > r.v - EPS &&
      p.v < r.v + r.dv + EPS,
  );
}

/**
 * The room the walker is standing in, or null in a doorway or a wall.
 *
 * For the live region and the HUD: cutaway.ts's header records that a canvas is
 * opaque to a screen reader and the mode has to be said in words, and "which room am
 * I in" is the same requirement one level down.
 */
export function roomAt(p: Vec2, ctx: WalkCtx): string | null {
  for (const r of ctx.rooms) {
    if (p.u >= r.u && p.u <= r.u + r.du && p.v >= r.v && p.v <= r.v + r.dv) return r.id;
  }
  return null;
}

/**
 * Push the walker out of one solid, or null if it was never in it.
 *
 * Out along the shortest way to the surface, which for a disc against a rectangle is
 * the direction from the rectangle's nearest point to the centre. That is what makes
 * this SLIDE rather than stop: the push is normal to the face, so the component of
 * the walker's motion ALONG the face survives it untouched. Stopping dead instead is
 * what makes a walk unusable -- the specific failure is a doorway, where the walker
 * clips a jamb, stops, and the door becomes a wall.
 *
 * The centre-inside-the-rectangle branch is separate because the nearest point is then
 * the centre itself and there is no direction to push along. It leaves by the nearest
 * FACE, which is the least wrong answer available: a walker whose centre is inside a
 * band has already failed, and this is the recovery rather than the rule.
 */
function pushOut(p: Vec2, s: Solid, radius: number): Vec2 | null {
  const cu = Math.min(Math.max(p.u, s.u), s.u + s.du);
  const cv = Math.min(Math.max(p.v, s.v), s.v + s.dv);
  const du = p.u - cu;
  const dv = p.v - cv;
  const d2 = du * du + dv * dv;
  if (d2 > radius * radius) return null;

  if (d2 > EPS * EPS) {
    const d = Math.sqrt(d2);
    const k = radius / d;
    return { u: cu + du * k, v: cv + dv * k };
  }

  const outs = [
    { cost: p.u - s.u + radius, at: { u: s.u - radius, v: p.v } },
    { cost: s.u + s.du - p.u + radius, at: { u: s.u + s.du + radius, v: p.v } },
    { cost: p.v - s.v + radius, at: { u: p.u, v: s.v - radius } },
    { cost: s.v + s.dv - p.v + radius, at: { u: p.u, v: s.v + s.dv + radius } },
  ];
  let best = outs[0]!;
  for (const o of outs) if (o.cost < best.cost) best = o;
  return best.at;
}

/**
 * How many times to push before giving up.
 *
 * Three, because a walker meets at most two solids at once in this geometry -- an
 * inside corner of a room, or the two jambs of a doorway -- and resolving against one
 * can move it into the other, so two passes settle a corner and the third is the check
 * that it settled. MEASURED: two is enough and one is not. Over 180,000 step() calls
 * across 60 suites, 2 and 3 gave bit-identical answers everywhere; 1 differs, and the
 * case that shows it is bedroom B's inside corner at the facade, where a single pass
 * settles the walker flush in u and leaves it 0.21 ft off in v. So the third pass is one
 * pass of margin rather than a requirement, and tests/walk.test.ts pins the corner.
 *
 * A loop until clear is refused: a walker wedged somewhere narrower than its own
 * diameter, which a slider shrinking the hall under it can produce, would never
 * terminate. step() falls back instead.
 */
const PUSH_PASSES = 3;

/** Push out of everything, deepest first, up to PUSH_PASSES times. */
function resolve(p: Vec2, ctx: WalkCtx): Vec2 {
  let at = p;
  for (let pass = 0; pass < PUSH_PASSES; pass++) {
    // Deepest first: resolving a shallow overlap can push the walker further into a
    // deep one, and starting with the deep one usually settles both at once.
    let worst: Solid | null = null;
    let worstDepth = 0;
    for (const s of [...ctx.solids, ...ctx.fixtures]) {
      const depth = ctx.radius - distanceTo(at, s);
      if (depth > worstDepth) {
        worstDepth = depth;
        worst = s;
      }
    }
    if (!worst) return at;
    at = pushOut(at, worst, ctx.radius) ?? at;
  }
  return at;
}

/**
 * Move the walker from `from` toward `to`, with the walls in the way.
 *
 * docs/phases/P7-P8.md's contract, and the guarantee is unconditional: if `from` was
 * clear of every band then the returned position is too, at any step size, for any
 * suite. Three things buy that, and all three are load-bearing.
 *
 * SUBSTEPPING buys it against tunnelling, and it substeps FROM THE RESOLVED POSITION.
 * See SUBSTEP for the derivation and for what sampling the from -> to line instead
 * actually did, which was to tunnel. Without substepping at all a single 8 ft frame --
 * 40 ft/s at 5 fps, which is what a tab regaining focus looks like -- steps straight
 * through a 0.5 ft partition and the walker is in the next room, or outside the
 * building.
 *
 * SLIDING buys it usability, and resolve() is the whole of it: the push is normal to the
 * face it hit, so the component of the motion ALONG that face survives untouched. A
 * walker who stops dead on contact cannot round the jamb of a doorway, and a doorway you
 * cannot round is a room you cannot leave.
 *
 * THE PER-AXIS RETRY is a fallback and NOT what makes sliding work, which is the opposite
 * of what this docblock used to claim. MEASURED: over 180,000 step() calls across 60
 * suites -- every bearing, step sizes from 0.1 to 40 ft -- removing it changed not one
 * answer, because resolve()'s push already slides. It is kept for the case the sweep did
 * not produce, a walker whose substep three passes cannot settle at all, where one
 * component of what was asked for may still be free when both together are not. No test
 * below distinguishes it, and that is recorded rather than hidden: it is a candidate for
 * deletion, on evidence, and not a load-bearing part of the argument.
 *
 * AND THE FALLBACK closes it. If none of that produces a clear position the substep is
 * abandoned and the walker stays where it was -- so the return value is a position this
 * function has SEEN to be clear, never one it hoped was. That is the difference between
 * an invariant and an argument.
 */
export function step(from: Vec2, to: Vec2, ctx: WalkCtx): Vec2 {
  const dist = Math.hypot(to.u - from.u, to.v - from.v);
  if (!(dist > EPS)) return from;

  const n = Math.max(1, Math.ceil(dist / SUBSTEP));
  // A fixed displacement per substep, applied to wherever the walker ended up, so that
  // n of them unobstructed sum to exactly to - from. NOT from + (to - from) * i / n:
  // see SUBSTEP for why sampling the line is the tunnelling bug rather than the guard.
  const dU = (to.u - from.u) / n;
  const dV = (to.v - from.v) / n;
  let at = from;

  for (let i = 1; i <= n; i++) {
    const want = { u: at.u + dU, v: at.v + dV };

    const direct = resolve(want, ctx);
    if (isClear(direct, ctx)) {
      at = direct;
      continue;
    }
    // One axis at a time, from where the walker actually is rather than from `want`:
    // sliding means keeping the component that is free, and the component that is
    // free is measured against the position it is leaving.
    const alongU = resolve({ u: want.u, v: at.v }, ctx);
    if (isClear(alongU, ctx)) {
      at = alongU;
      continue;
    }
    const alongV = resolve({ u: at.u, v: want.v }, ctx);
    if (isClear(alongV, ctx)) {
      at = alongV;
      continue;
    }
    // Blocked outright. Stop here rather than carrying on to the next substep: the
    // remaining substeps are further along the same blocked line.
    break;
  }

  return at;
}

/**
 * How far up or down the walker may look, radians. ASSUMED, 85 degrees.
 *
 * Bounded ABOVE by 90 degrees, which is unavailable rather than merely undesirable:
 * `camera.lookAt` with `up = (0, 1, 0)` is degenerate when the view direction is
 * parallel to up, so a straight-up or straight-down look has no well-defined camera
 * basis. Bounded at 85 rather than closer to 90 because the last 5 degrees buys
 * nothing a viewer can use: at 85 degrees the floor is already
 * `5.167 / tan(85 deg) = 0.45 ft` ahead of the eye and the ceiling
 * `5.583 / tan(85 deg) = 0.49 ft` ahead, so the frame is already filled with the
 * floor or the ceiling and further tilt only pushes that point half an inch closer.
 * (Recomputed for EYE = 5 ft 2 in; the 10 ft 9 in ceiling did not move.)
 */
export const PITCH_LIMIT = (85 * Math.PI) / 180;

/** Where the walker stands and which way it faces. */
export type WalkState = {
  p: Vec2;
  /**
   * Suite-frame bearing, radians. 0 faces +v, the north gable; positive turns toward
   * +u, inward from the facade. Same convention as frames.ts's azimuthToBuilding(),
   * where 0 also means "along +v".
   *
   * WHICH WAY THAT IS ON SCREEN is FirstPerson.tsx's problem and not a detail: the
   * suite-to-world map is a rotation on the east facade and a REFLECTION on the west
   * (place.ts's suiteToBuilding negates u for east, frames.ts's toThree negates v, and
   * two negations compose to a rotation while one does not). So a bearing of +90
   * degrees is screen-right in one and screen-left in the other. That component reads
   * the sign off suiteToThree()'s own basis rather than assuming either.
   */
  heading: number;
  /**
   * How far up or down the walker looks, radians, negative down. Clamped to
   * +/-PITCH_LIMIT in walk(), never wrapped: see wrap()'s docblock for why a pitch
   * is not a bearing.
   */
  pitch: number;
};

/** What the keys and the pointer ask for, each component in -1..1. */
export type WalkInput = {
  /** +1 walks along the heading, -1 backs up */
  forward: number;
  /** +1 walks along heading + 90 degrees */
  strafe: number;
  /** +1 adds to the heading. Radians/s comes from TURN_RATE. */
  turn: number;
  /**
   * +1 looks up, -1 looks down. Radians/s comes from TURN_RATE, the same constant
   * turn uses rather than a second one: levelling out to PITCH_LIMIT at that rate
   * takes 0.71 s, the same order as the 1.5 s a 180 degree turn takes, so holding
   * one key never feels faster or slower than holding the other.
   */
  pitch: number;
};

export const NO_INPUT: WalkInput = { forward: 0, strafe: 0, turn: 0, pitch: 0 };

/**
 * Wrap a bearing to (-pi, pi]. Pitch does NOT go through this: a bearing is circular
 * (facing 179 degrees and facing -179 degrees are one step apart), but a pitch is not
 * (looking 84 degrees down and 84 degrees up are nowhere near each other, they are
 * almost opposite). So heading wraps here and pitch is clamped in walk() instead --
 * a viewer holding the look-down key must stop at the floor, not roll over backwards
 * into looking at the ceiling.
 */
function wrap(a: number): number {
  const t = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  return t - Math.PI === -Math.PI ? Math.PI : t - Math.PI;
}

/**
 * One frame of walking: turn, then move, then resolve.
 *
 * Turning first, so a key held down turns and walks along the NEW heading in the same
 * frame. The other order makes a turn-and-walk lag the turn by a frame, which at 60 Hz
 * is invisible and at 20 Hz is a camera that slides sideways out of the turn.
 *
 * DIAGONALS ARE NORMALISED. Forward and strafe together would otherwise cover
 * sqrt(2) * SPEED, so the fastest way across a room would be to walk at 45 degrees to
 * where you are looking. Normalising the input rather than clamping the result keeps
 * the speed exactly SPEED in every direction.
 *
 * dt IS NOT CLAMPED HERE. A 30 s dt from a backgrounded tab produces a 120 ft
 * displacement, and step() handles it correctly -- 160 substeps, no tunnelling -- which
 * is what makes the absurd-step gate in docs/phases/P7-P8.md a statement about this
 * module rather than about a clamp somewhere else. FirstPerson.tsx clamps anyway,
 * because 120 ft of walking nobody asked for is still wrong even when it is safe.
 */
export function walk(state: WalkState, input: WalkInput, dt: number, ctx: WalkCtx): WalkState {
  const heading = wrap(state.heading + input.turn * TURN_RATE * dt);
  const pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, state.pitch + input.pitch * TURN_RATE * dt));

  const mag = Math.hypot(input.forward, input.strafe);
  if (!(mag > EPS) || !(dt > 0)) return { p: state.p, heading, pitch };

  const f = Math.min(1, mag) * (input.forward / mag);
  const s = Math.min(1, mag) * (input.strafe / mag);

  // forward = (sin h, cos h); its right hand at heading + 90 = (cos h, -sin h).
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const d = SPEED * dt;
  const to = {
    u: state.p.u + (f * sin + s * cos) * d,
    v: state.p.v + (f * cos - s * sin) * d,
  };

  return { p: step(state.p, to, ctx), heading, pitch };
}
