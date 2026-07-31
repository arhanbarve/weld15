/**
 * The suite's circulation, as a graph a walker can follow.
 *
 * WHAT THIS IS FOR. stages.ts wanted the stage 5 shot to stand in the hall and could
 * not: "a straight camera path from bedroom B to the hall passes through the partition
 * between them", so it stayed in bedroom B and left a comment saying that routing a
 * path through the doorway needs a spline and collision. This is the routing half. A
 * straight line between two room centres goes through whatever is between them; a
 * polyline through the doorways does not, and the doorway waypoints below are what
 * make each of its segments a segment inside one convex room.
 *
 * NO THREE.JS, for the reason walk.ts's header gives at length: the two generator
 * scripts import geometry modules in plain node and tests/drift.test.ts shells out to
 * them, so three in the reachable set is an ERR_MODULE_NOT_FOUND that tsc cannot see.
 * cutaway.ts and orbit.ts are the precedent. Everything here is arithmetic in the
 * suite frame -- u inward from the facade, v north along the section.
 *
 * IT AGREES WITH rooms.ts ABOUT THE TOPOLOGY, AND WHERE IT DOES NOT, IT SAYS SO.
 * unreachableRooms() flood-fills from "hall" and not from any other room, because the
 * hall is what every room in this suite is entered from -- a fact about Weld 15's
 * circulation rather than a convention, and cutaway.ts's sectionPlaneU() leans on the
 * same fact to pick its cut. reachable() below is seeded from the same room for the
 * same reason, and HUB names it once.
 *
 * The difference is the point of the module. unreachableRooms() fills over touches(),
 * i.e. over shared WALL SEGMENTS, because it is asking whether a suite could be built
 * with a door there. This fills over DOORWAYS, because it is asking where a person can
 * actually walk. Both nulls below are docs/phases/P7-P8.md's "returns null when no
 * doorway chain exists, which is the case unreachableRooms() exists to detect".
 *
 * MEASURED, not asserted, and the answer changed once this module existed -- which is the
 * whole reason it is worth recording rather than deleting.
 *
 * WHAT IT WAS. reachable() on the default suite returned ["hall", "bedA", "bath", "bedB"]
 * while unreachableRooms() returned [], because buildOpenings() hung door("hall","bedA"),
 * ("hall","bath"), ("hall","bedB") and ("common1","k") and stopped: there was no door
 * between the hall and the common room at all. The suite's doorway graph was two
 * components -- hall plus the three rooms off it, and common room plus K reachable only
 * through it -- so route("hall", "common1") was null and no viewer could be walked to the
 * room the suite is named for. This module is what found that; nothing else in the project
 * asked the question in a form that could fail.
 *
 * WHAT IT IS. The door is hung. w0 already listed ["common1","hall"] in its `separates`,
 * and at the defaults the opening lands in that band at offset 16.5, width 3 -- u 16.5 to
 * 19.5, slid to the low end of the 3.5 ft stretch where the two rooms actually face each
 * other, because the band is 21 ft long and its own centre at u 9 to 12 is inside bedroom
 * A. reachable() now returns all six rooms and route("hall", "common1") returns a path.
 *
 * THE STRIP IS STILL SEALED, and that one is deliberate: rooms.ts says the 7.5 ft strip
 * beside the bathroom touches bedroom A and has no door because "giving it a door would
 * mean choosing whose door it is". route() is right to refuse it, and
 * tests/route.test.ts pins it as permanent rather than as a defect awaiting a fix.
 *
 * So the two functions still disagree, and the disagreement is now entirely the strip --
 * one room, not three. That is the honest steady state: unreachableRooms() answers []
 * because a door there is buildable, and reachable() omits it because none is hung.
 */

import type { Rect, Suite } from "@/geo/rooms";
import type { Opening, Wall } from "@/geo/walls";
import { RADIUS, canPass, walkContext, type Vec2, type WalkCtx } from "./walk";

/**
 * The room every other room is entered from.
 *
 * rooms.ts's unreachableRooms() hard-codes this same id as its flood-fill seed and
 * explains why. Named here so that the two places that depend on the hall being the
 * hub say the same word, and so that a suite whose hall is renamed fails visibly in
 * one place rather than quietly routing nothing.
 */
export const HUB = "hall";

/**
 * How far off a doorway's band a waypoint stands, ft: the walker's radius plus a
 * quarter of a foot.
 *
 * The radius is what it takes to be clear of the band at all -- a waypoint any nearer
 * is a waypoint inside the wall. The extra quarter foot is margin, and it is a quarter
 * rather than a tenth or a half because a quarter foot is the smallest distance
 * anything in this project positions to: collide.ts's grid is half a foot, so half a
 * grid step is the worst case a snapped piece can sit off a wall, and the same
 * three inches is a visible offset in the plan and an invisible detour in the walk.
 *
 * NOT collide.ts's GRID / 2 imported. The magnitudes coincide and the meanings do not
 * -- one is furniture placement, this is a standing position -- and drag.ts's
 * DOOR_CLEARANCE docblock records what happens when a coincidence is written as a
 * dependency: correcting one value moves something it was never about.
 */
export const STANDOFF_MARGIN = 0.25;

const EPS = 1e-9;

/** A place a viewer can be sent to by name. */
export type Place = {
  /** the room id */
  id: string;
  /** the room's own label, for the HUD and the live region */
  label: string;
  p: Vec2;
};

/** A walkable doorway, with a standing position on each side. */
export type Threshold = {
  /** the opening's id */
  id: string;
  wallId: string;
  /** the two rooms it joins, in the opening's own order */
  rooms: [string, string];
  /** the middle of the clear opening, inside the band */
  centre: Vec2;
  /** a standing position on each side, in the same order as `rooms` */
  at: [Vec2, Vec2];
};

/**
 * Where to stand in a room: its centre.
 *
 * The centre and not an inset or a corner, because it is the one point in a rectangle
 * that is as far from every wall as possible, so it is the point most likely to have
 * room for the walker in a room a slider has shrunk, and it is the point every segment
 * of a route can reach in a straight line without leaving the room -- a rectangle is
 * convex, so the segment between any two interior points is interior.
 *
 * It is NOT guaranteed clear of the walls: a room narrower than the walker's diameter
 * has no clear point at all, and inventing one here would hide that. route() reports
 * the geometry it found and walk.ts's clearance() is what answers the question.
 */
export function standIn(room: Rect): Vec2 {
  return { u: room.u + room.du / 2, v: room.v + room.dv / 2 };
}

/**
 * Which axis a band runs along. buildOpenings()'s tie-break, `du > dv`, copied for the
 * reason walk.ts's runsAlongV() and drag.ts's doorZone() both copy it: `offset` is
 * measured along whichever axis that function called long, and for a square band the
 * two answers differ.
 */
function runsAlongV(w: Wall): boolean {
  return !(w.du > w.dv);
}

/**
 * The two standing positions either side of one doorway.
 *
 * WHICH ROOM IS ON WHICH SIDE is measured, not assumed: the room whose centre sits on
 * the low side of the band's thin axis gets the low waypoint. cutaway.ts's outerFace()
 * decides the analogous question the same way and records what happens when a band's
 * sides are inferred from the suite's middle instead -- the step over the K bump came
 * out with its normal pointing into K, and a camera on the wrong side dropped the
 * wrong wall. Here the symptom would be worse and quieter: the two waypoints swapped,
 * so a route into a room would start by walking away from it.
 */
function thresholdOf(w: Wall, o: Opening, rooms: Rect[], radius: number): Threshold | null {
  const [a, b] = o.connects;
  if (a === undefined || b === undefined) return null;
  const ra = rooms.find((r) => r.id === a);
  const rb = rooms.find((r) => r.id === b);
  if (!ra || !rb) return null;

  const alongV = runsAlongV(w);
  const thinLo = alongV ? w.u : w.v;
  const thinHi = alongV ? w.u + w.du : w.v + w.dv;
  const mid = (thinLo + thinHi) / 2;
  const standoff = radius + STANDOFF_MARGIN;

  const along = (alongV ? w.v : w.u) + o.offset + o.width / 2;
  const low: Vec2 = alongV
    ? { u: thinLo - standoff, v: along }
    : { u: along, v: thinLo - standoff };
  const high: Vec2 = alongV
    ? { u: thinHi + standoff, v: along }
    : { u: along, v: thinHi + standoff };
  const centre: Vec2 = alongV ? { u: mid, v: along } : { u: along, v: mid };

  const onThin = (r: Rect) => (alongV ? r.u + r.du / 2 : r.v + r.dv / 2);
  const aIsLow = onThin(ra) < mid;

  return {
    id: o.id,
    wallId: w.id,
    rooms: [a, b],
    centre,
    at: aIsLow ? [low, high] : [high, low],
  };
}

/**
 * Every doorway the walker can actually get through.
 *
 * Filtered by canPass(), so a 0.5 ft gap is not an edge of this graph even though
 * walk.ts still cuts the hole in the band -- the two agree and neither is derived from
 * the other, which is why tests/walk.test.ts and tests/route.test.ts check them
 * separately. Windows are excluded by canPass() as well; the suite entry is excluded
 * because "outside" is not a room this model has, which is the same reason walk.ts
 * leaves that band whole.
 */
export function thresholds(suite: Suite, radius = RADIUS): Threshold[] {
  const ctx = walkContext(suite, radius);
  return thresholdsIn(ctx, radius);
}

/** thresholds() for a context already built. FirstPerson holds one per params. */
export function thresholdsIn(ctx: WalkCtx, radius = RADIUS): Threshold[] {
  const byId = new Map(ctx.walls.map((w) => [w.id, w]));
  const out: Threshold[] = [];
  for (const o of ctx.openings) {
    if (!canPass(o, radius)) continue;
    const w = byId.get(o.wallId);
    // Loud rather than silent, in the manner of drag.ts's doorsBlockedBy(): an opening
    // naming a wall the suite has no wall for means openings and walls from two
    // different builds, and skipping it would drop one doorway from the graph while
    // every assertion about the others still passed.
    if (!w) {
      throw new Error(
        `route: opening ${o.id} names wall ${o.wallId}, which this suite has no such wall in. ` +
          "the walls and the openings must come from one buildWalls().",
      );
    }
    const t = thresholdOf(w, o, ctx.rooms, radius);
    if (t) out.push(t);
  }
  return out;
}

/** room id -> the doorways off it. */
function graphOf(ts: Threshold[]): Map<string, Threshold[]> {
  const g = new Map<string, Threshold[]>();
  for (const t of ts) {
    for (const id of t.rooms) {
      const list = g.get(id);
      if (list) list.push(t);
      else g.set(id, [t]);
    }
  }
  return g;
}

/**
 * Every room a walker can reach from the hall, hall included, in the suite's own room
 * order.
 *
 * Seeded from HUB for the reason unreachableRooms() is: the hall is what every room
 * here is entered from. Over doorways rather than shared walls, which is where this
 * and unreachableRooms() part company -- see the header, and the unknown strip.
 */
export function reachable(suite: Suite, radius = RADIUS): string[] {
  const g = graphOf(thresholds(suite, radius));
  const seen = new Set<string>();
  if (suite.rooms.some((r) => r.id === HUB)) seen.add(HUB);
  const queue = [...seen];
  while (queue.length > 0) {
    const at = queue.shift()!;
    for (const t of g.get(at) ?? []) {
      const next = t.rooms[0] === at ? t.rooms[1] : t.rooms[0];
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return suite.rooms.filter((r) => seen.has(r.id)).map((r) => r.id);
}

/** The named places a reduced-motion viewer can be sent to, hall first. */
export function places(suite: Suite, radius = RADIUS): Place[] {
  const ids = new Set(reachable(suite, radius));
  return suite.rooms
    .filter((r) => ids.has(r.id))
    .sort((a, b) => (a.id === HUB ? -1 : b.id === HUB ? 1 : 0))
    .map((r) => ({ id: r.id, label: r.label, p: standIn(r) }));
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.u - a.u, b.v - a.v);
}

/**
 * The rooms a walk from one to the other passes through, in order, or null.
 *
 * Dijkstra over the doorway graph, weighted by the distance actually walked --
 * room centre to the near waypoint, through the opening, out to the far centre -- and
 * not by hop count. With seven rooms the two answers almost always agree; where they
 * do not, the shorter walk is the one a person would take, and hop count would happily
 * send someone the long way round a suite whose sliders had made one route twice the
 * length of another.
 *
 * Null for an id that is not a room, and null when no chain of doorways joins them.
 * `from === to` is a path of one, which is a walk of zero length rather than an error:
 * a viewer asking to be sent where they already are should stay there.
 */
export function routeRooms(
  from: string,
  to: string,
  suite: Suite,
  radius = RADIUS,
): string[] | null {
  const rooms = new Map(suite.rooms.map((r) => [r.id, r]));
  if (!rooms.has(from) || !rooms.has(to)) return null;
  if (from === to) return [from];

  const g = graphOf(thresholds(suite, radius));
  const cost = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();

  for (;;) {
    // Linear scan for the nearest unfinished node. Seven rooms; a heap would be more
    // code than the whole function.
    let at: string | null = null;
    let best = Infinity;
    for (const [id, c] of cost) {
      if (done.has(id) || c >= best) continue;
      best = c;
      at = id;
    }
    if (at === null) break;
    if (at === to) break;
    done.add(at);

    const here = rooms.get(at)!;
    for (const t of g.get(at) ?? []) {
      const next = t.rooms[0] === at ? t.rooms[1] : t.rooms[0];
      if (done.has(next)) continue;
      const there = rooms.get(next);
      if (!there) continue;
      const side = t.rooms[0] === at ? 0 : 1;
      const near = t.at[side]!;
      const far = t.at[1 - side]!;
      const w =
        dist(standIn(here), near) + dist(near, far) + dist(far, standIn(there));
      const c = best + w;
      if (c < (cost.get(next) ?? Infinity)) {
        cost.set(next, c);
        prev.set(next, at);
      }
    }
  }

  if (!cost.has(to)) return null;
  const out = [to];
  while (out[0] !== from) {
    const p = prev.get(out[0]!);
    if (p === undefined) return null;
    out.unshift(p);
  }
  return out;
}

/**
 * A walkable path between two rooms, through the doorways, as waypoints.
 *
 * docs/phases/P7-P8.md's contract. The shape is
 *
 *   centre(from), [ near side of door, far side of door, centre of the next room ]...
 *
 * so a two-room walk is four points and a three-room walk is seven.
 *
 * WHY EVERY INTERMEDIATE ROOM CENTRE IS IN IT, WHICH IS A DETOUR ON PURPOSE
 * The property that matters is that each SEGMENT is clear, and the cheap way to get it
 * is to keep every segment inside one convex rectangle. A room is a Rect, so it is
 * convex, and its centre and a doorway waypoint on its own side are both interior
 * points -- so the segment between them is interior too, with no case analysis and no
 * spline. Cutting the corner instead, straight from one doorway to the next, is shorter
 * and crosses whatever happens to be in between: in the hall that is nothing, but the
 * hall is 4.5 ft wide and the walker is 1.5 ft across, and the diagonal it would cut
 * between bedroom A's door and bedroom B's door runs 18 ft of that. The detour costs a
 * few feet of walking; the shortcut costs the guarantee.
 *
 * WHY BOTH SIDES OF EVERY DOORWAY ARE IN IT
 * One waypoint at the middle of the opening is not enough. The segments into and out of
 * it arrive at an angle, and a segment that ends inside the band has already been in
 * the band -- which is where the jambs are. Two waypoints, one standoff clear of each
 * face on the opening's own centreline, make the crossing itself perpendicular to the
 * band and no wider than the opening.
 *
 * WHAT IT DOES NOT PROMISE. These are waypoints, not a guarantee about the walker: a
 * room narrower than the walker's own diameter has no clear point in it at all, which a
 * slider can produce, and this returns its centre anyway rather than pretending the
 * suite is different. walk.ts's clearance() is the function that answers that, and
 * step() is what keeps a walker following this out of the plaster regardless.
 */
export function route(
  from: string,
  to: string,
  suite: Suite,
  radius = RADIUS,
): Vec2[] | null {
  const chain = routeRooms(from, to, suite, radius);
  if (!chain) return null;

  const rooms = new Map(suite.rooms.map((r) => [r.id, r]));
  const ts = thresholds(suite, radius);
  const out: Vec2[] = [standIn(rooms.get(chain[0]!)!)];

  for (let i = 0; i + 1 < chain.length; i++) {
    const a = chain[i]!;
    const b = chain[i + 1]!;
    // The shortest doorway between this pair, when there is more than one. Two rooms
    // joined twice is not in the default suite and is not forbidden by anything in
    // rooms.ts either, so picking rather than assuming costs one comparison.
    let pick: Threshold | null = null;
    let bestLen = Infinity;
    for (const t of ts) {
      // null rather than -1 for "this threshold does not join a and b": `side < 0` does
      // not narrow a numeric literal union, so -1 stayed in the type and indexing the
      // `at` tuple with it is a compile error. A null sentinel narrows.
      const side: 0 | 1 | null =
        t.rooms[0] === a && t.rooms[1] === b ? 0 : t.rooms[0] === b && t.rooms[1] === a ? 1 : null;
      if (side === null) continue;
      const near = t.at[side]!;
      const far = t.at[side === 0 ? 1 : 0]!;
      const len = dist(out[out.length - 1]!, near) + dist(near, far);
      if (len < bestLen) {
        bestLen = len;
        pick = side === 0 ? t : { ...t, rooms: [t.rooms[1], t.rooms[0]], at: [t.at[1], t.at[0]] };
      }
    }
    if (!pick) return null;
    out.push(pick.at[0], pick.at[1], standIn(rooms.get(b)!));
  }

  // Consecutive duplicates would be a zero-length segment, which is harmless to walk
  // and awkward to assert about. A room whose centre coincides with its own doorway
  // standoff is what produces one, and a slider can.
  return out.filter((p, i) => i === 0 || dist(p, out[i - 1]!) > EPS);
}
