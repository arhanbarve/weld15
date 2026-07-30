/**
 * Furniture collision, containment and snapping, in the suite frame.
 *
 * This is what makes dragging a bed around Weld 15 feel like moving furniture
 * rather than like editing numbers. Pure arithmetic: no three.js, no DOM, no
 * state. The renderer calls placeIsLegal() on every pointer move and paints the
 * ghost red with the returned reason; it calls snapToGrid() then snapToWalls()
 * on drop.
 *
 * SUITE FRAME (same as rooms.ts)
 *   u = feet inward from the outer facade
 *   v = feet north along the end section
 *
 * WHY CONTAINMENT IN A Rect IS THE SAME THING AS "NOT INSIDE A WALL"
 *   buildSuite() lays rooms out with the partition thickness as a *gap* between
 *   them -- the common room ends at v = 15 and bedroom A starts at v = 15.5,
 *   with the 0.5 ft partition living in between. A Rect is therefore the clear
 *   interior, not the centreline box, so "inside the Rect" already means "clear
 *   of the plaster". That is the whole reason containedBy() needs no wall
 *   thickness argument.
 *
 * WHY A 0.5 FT GRID
 *   Every dimension in DEFAULT_PARAMS that positions a wall -- 44, 21, 4.5, 16,
 *   15, 20, 10, 7.5, 8, 12, 0.5 -- is a multiple of half a foot, so every room
 *   edge in the default suite is too (tests/collide.test.ts asserts this). A
 *   half-foot grid can therefore land a piece exactly flush against any wall in
 *   the default plan, which a 1 ft grid could not do at v = 15.5. Six inches is
 *   also about the coarsest step that still reads as deliberate placement.
 *
 * WHY WALL SNAP IS SEPARATE, AND RUNS SECOND
 *   Once the parametric sliders move off the defaults, walls stop being on the
 *   grid, and grid snap alone leaves a piece up to grid/2 = 0.25 ft off the
 *   wall -- a gap too small to be intentional and too large to look flush.
 *   Wall snap fixes exactly that, so it has to run after grid snap and be
 *   allowed to override it. The 1 ft default threshold clears that 0.25 ft
 *   worst case four times over while staying under the ~1.5 ft you would leave
 *   deliberately for a bedside gap.
 *   Note also that snapToGrid() can push a piece that already overhangs a wall
 *   *further* out (-0.3 rounds to -0.5); snapToWalls() is what pulls it back.
 *
 * ROTATION
 *   Rotation is in 90 degree steps and is anchored at the box's own u, v corner:
 *   footprintOf() swaps du and dv and leaves u, v alone. Keeping the anchor
 *   fixed makes footprintOf a plain idempotent projection onto the world axes,
 *   which is what every other function here needs. A UI that would rather spin
 *   a piece about its visual centre composes its own translation on top; that
 *   is a view concern and it does not belong in the collision maths.
 */

import type { Rect } from "./rooms";

/** A piece of furniture. du, dv are its unrotated extents, anchored at u, v. */
export type Box = {
  u: number;
  v: number;
  du: number;
  dv: number;
  /** degrees clockwise in plan; undefined means 0 */
  rot?: 0 | 90 | 180 | 270;
};

/** Placement grid, ft. See the header for why six inches. */
export const GRID = 0.5;

/** Wall snap catchment, ft. See the header for why one foot. */
export const WALL_SNAP = 1;

/**
 * Float slack, ft. Two orders of magnitude below anything a user could see or
 * intend (the grid is 0.5 ft) and five above the arithmetic noise: an ulp at
 * 100 ft, which is past the far end of the suite, is 2.2e-14 ft.
 */
const EPSILON = 1e-9;

/**
 * The world-axis-aligned rectangle a box actually occupies, with rot applied
 * and then discharged. Idempotent, so everything downstream can call it freely.
 */
export function footprintOf(box: Box): Box {
  const turned = box.rot === 90 || box.rot === 270;
  return {
    u: box.u,
    v: box.v,
    du: turned ? box.dv : box.du,
    dv: turned ? box.du : box.dv,
    rot: 0,
  };
}

/**
 * Do two pieces fight over the same floor?
 *
 * Touching counts as legal, not as a collision: two beds pushed flush against
 * each other is a real dorm arrangement and refusing it would make the drag
 * feel broken. So the test is for a *positive* area of shared floor, and a
 * shared edge gives zero.
 */
export function overlaps(a: Box, b: Box, epsilon = EPSILON): boolean {
  const fa = footprintOf(a);
  const fb = footprintOf(b);
  const sharedU = Math.min(fa.u + fa.du, fb.u + fb.du) - Math.max(fa.u, fb.u);
  const sharedV = Math.min(fa.v + fa.dv, fb.v + fb.dv) - Math.max(fa.v, fb.v);
  return sharedU > epsilon && sharedV > epsilon;
}

/**
 * Crossing-number point-in-polygon, for testing a point against Weld's real GIS
 * footprint (src/data/weld.json, feet in the site frame).
 *
 * This is Franklin's PNPOLY. The half-open comparison (yi > py) !== (yj > py)
 * is the entire trick and it is not decoration: it treats each edge as
 * containing its lower endpoint and excluding its upper one, so a horizontal
 * ray passing exactly through a vertex crosses the two edges meeting there
 * either once or twice as the geometry requires, instead of always twice. Weld's
 * ring has 58 distinct vertices at one-decimal coordinates, so rays that hit a
 * vertex dead on are common rather than pathological -- the test file probes
 * every one of them.
 *
 * A repeated closing vertex (weld.json has one) makes a zero-length edge, which
 * the same comparison discards. Points exactly on the boundary are not
 * classified either way; nothing here asks that question.
 */
export function pointInPolygon(pt: [number, number], ring: number[][]): boolean {
  const px = pt[0];
  const py = pt[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const ay = a[1]!;
    const by = b[1]!;
    if ((ay > py) === (by > py)) continue;
    const ax = a[0]!;
    const bx = b[0]!;
    if (px < ax + ((bx - ax) * (py - ay)) / (by - ay)) inside = !inside;
  }
  return inside;
}

/** Is a piece wholly on this room's clear floor? Flush against a wall counts. */
export function containedBy(inner: Box, outer: Rect): boolean {
  const f = footprintOf(inner);
  return (
    f.u >= outer.u - EPSILON &&
    f.v >= outer.v - EPSILON &&
    f.u + f.du <= outer.u + outer.du + EPSILON &&
    f.v + f.dv <= outer.v + outer.dv + EPSILON
  );
}

/**
 * Round the anchor onto the placement grid. Sizes are left alone: a mattress is
 * 38 inches wide because Harvard bought it that way, and rounding a real
 * dimension to make the arithmetic tidy would be a lie in the model.
 */
export function snapToGrid(box: Box, grid = GRID): Box {
  return {
    ...box,
    u: Math.round(box.u / grid) * grid,
    v: Math.round(box.v / grid) * grid,
  };
}

/**
 * Pull a piece flush against any room wall it is already nearly touching.
 *
 * Each axis is decided on its own, so a piece near a corner goes flush in both
 * directions. Snapping flush can never push a piece out of a room it already
 * fitted in -- the moved edge lands exactly on the wall and the opposite edge
 * moves inward -- which is the invariant that stops a snap from burying
 * furniture in the plaster. It is not a clamp, though: a piece dropped well
 * outside the room stays outside, and placeIsLegal() is what refuses it.
 */
export function snapToWalls(box: Box, room: Rect, threshold = WALL_SNAP): Box {
  const f = footprintOf(box);
  return {
    ...box,
    u: snapAxis(box.u, f.du, room.u, room.du, threshold),
    v: snapAxis(box.v, f.dv, room.v, room.dv, threshold),
  };
}

function snapAxis(
  lo: number,
  size: number,
  roomLo: number,
  roomSize: number,
  threshold: number,
): number {
  const roomHi = roomLo + roomSize;
  const toLo = Math.abs(lo - roomLo);
  const toHi = Math.abs(roomHi - (lo + size));
  if (toLo > threshold && toHi > threshold) return lo;
  // Nearer wall wins; a piece almost as wide as the room is in reach of both.
  return toLo <= toHi ? roomLo : roomHi - size;
}

/**
 * The one call the drag handler makes. The reason is user-facing text, so it
 * names the room and says what is wrong in the terms the person dragging sees.
 */
export function placeIsLegal(
  box: Box,
  room: Rect,
  others: Box[],
): { ok: boolean; reason?: string } {
  const f = footprintOf(box);

  // Distinguished from a simple overhang because the fix is different: no
  // amount of dragging helps, and the UI should say so rather than nag.
  if (f.du > room.du + EPSILON || f.dv > room.dv + EPSILON) {
    return {
      ok: false,
      reason: `Too big for ${room.label}: needs ${ft(f.du)} x ${ft(f.dv)} ft, the room is ${ft(room.du)} x ${ft(room.dv)} ft`,
    };
  }

  if (!containedBy(box, room)) {
    return { ok: false, reason: `Sticks out through the ${room.label} wall` };
  }

  for (const other of others) {
    if (overlaps(box, other)) {
      return { ok: false, reason: `Overlaps something already in ${room.label}` };
    }
  }

  return { ok: true };
}

/** Feet to one decimal, for the reason strings. */
function ft(n: number): string {
  return String(Math.round(n * 10) / 10);
}
