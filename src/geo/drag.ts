/**
 * Moving the furniture: what happens when someone drags a bed, or nudges it with
 * an arrow key, or turns it a quarter.
 *
 * Pure arithmetic in the suite frame, like rooms.ts, collide.ts and furniture.ts.
 * No three.js, no state, no DOM -- which is what lets the whole rule set be
 * property-tested in Node over hundreds of randomised suites instead of being
 * inspected in a browser. Scene code turns a DragResult into a ghost colour and a
 * live announcement; nothing in here knows that a pointer exists.
 *
 * SUITE FRAME (same as rooms.ts)
 *   u = feet inward from the outer facade
 *   v = feet north along the end section
 *
 * WHAT THIS MODULE ADDS TO collide.ts, AND WHAT IT DELIBERATELY DOES NOT
 *   collide.ts already answers "is this rectangle legal in this room" and already
 *   owns the snapping, with GRID = 0.5 and WALL_SNAP = 1. Both are used here as
 *   they stand. A second snapping rule is the specific failure to avoid: two
 *   rules that agree today and drift apart later are worse than the coarser of
 *   the two, because the disagreement shows up as furniture that lands somewhere
 *   the ghost was not.
 *
 *   What is new is the door. collide.ts cannot see openings and is not going to:
 *   placeIsLegal() is handed a Rect and a list of boxes and nothing at all that
 *   locates a doorway. So somebody has to hold furniture and doorways in the same
 *   thought, and there are two places that do. furniture.ts is the other one --
 *   doorLandings() there keeps the default fit-out out of the landings by
 *   construction, its header records why importing walls.ts turned out to be safe
 *   after all -- and the split between them is the same one furniture.ts draws
 *   between a recipe and a gate: that module aims a designed arrangement clear of
 *   the doors, this module refuses any move that would put a piece back in one.
 *
 * WHY blocks-door IS A REJECTION AND NOT A WARNING
 *   unreachableRooms() exists in rooms.ts because a suite whose rooms cannot be
 *   entered is a failure this geometry can produce silently: every rect is legal,
 *   every area closes, and one room has no way in. A dresser parked across the
 *   only door to the bathroom is that same failure one scale down, and it is
 *   equally invisible to placeIsLegal(), which knows nothing about openings. So it
 *   is refused, and `against` names the door and the two rooms it joins, so the UI
 *   can say what was hit rather than snapping the piece back in silence.
 *
 * THE DEFAULT FIT-OUT SATISFIES THIS RULE, AND DID NOT ALWAYS
 *   Measured at the defaults, layout() stands no piece in any of the suite's five
 *   doorway landings. That is not luck and it is not this module's doing:
 *   furniture.ts was made door-aware for exactly this reason, and
 *   tests/drag.test.ts asserts the empty list rather than assuming it.
 *
 *   The stronger claim holds too, and it is the one a user meets first: every piece in
 *   the default fit-out can be put back where it stands. It is stronger because this
 *   module judges the position it is HANDED, and the position a re-drop hands it is the
 *   piece's own anchor SNAPPED -- so a piece clear of every landing by less than
 *   GRID / 2, on an anchor off the grid, is legal where it stands and refused when
 *   dropped there. That was the sofa: anchor u 15.25, far edge exactly on d3's boundary
 *   at u 18, snapped to 15.5 and a quarter foot inside the landing. furniture.ts closed
 *   it by landing the designed anchor on the grid, where snapToGrid() is the identity,
 *   and K's own chair is why that is the general rule rather than a patch -- it stands
 *   exactly ON the same boundary with no margin at all and re-drops for that reason
 *   alone. tests/drag.test.ts asserts the whole fit-out, not just the two.
 *
 *   IT DID NOT ALWAYS, and that is why the rule is enforced on the position a piece
 *   is HANDED and not only on the ones a designer chose. layout() used to be blind to
 *   openings and stood six pieces across three of the five doors: both bedroom A
 *   desks and both bedroom B desks flush against the inner wall at u 14 to 16, inside
 *   the bedroom doors' u 14 to 18.5 landings; the sofa square across K's door, its
 *   back against the very wall the door is in; and one of K's own chairs a quarter
 *   foot into that same landing from the other side. Five of the six could not be
 *   dragged along their own doorway at all, because tryMove() judges the placement it
 *   is given on its own merits and not the change from the last one.
 *
 *   Judging the delta instead -- "no worse than before" -- was considered then and is
 *   still refused: it makes an illegal state permanently legal for whoever inherits
 *   it, which is how that clash survived P5 in the first place. The consequence of
 *   refusing it is the point. A position this module is asked about need not have
 *   come from a recipe: furniture.ts's rescue scan puts pieces where no recipe chose,
 *   and a slider can move a wall under a piece that was placed flush against it. The
 *   door rule applies to those the same as to the designed ones, and it has to,
 *   because the designed ones are the only arrangement anybody ever checked by eye.
 *
 * ONE CODE PATH, TWO INPUTS
 *   nudge() and tryRotate() call the same private place() tryMove() calls. There
 *   is no keyboard branch, so there is nothing for a keyboard branch to get wrong
 *   about legality or about snapping: every position either input can produce is a
 *   position place() produced.
 *
 *   What the keyboard is allowed its own opinion about is how far a keypress asks
 *   to go, and nudge() uses it -- see its own note. The consequence for the
 *   equivalence: out in the open, where no wall's catchment is in reach, four
 *   nudges of one grid step still land exactly where one 2 ft drag lands, and
 *   tests/drag.test.ts asserts that rather than assuming it. Within a catchment
 *   they no longer compose, because a nudge asks for the first distance that gets
 *   somewhere and a drag asks for the distance it was given. The same test says
 *   where that parts company and by how much.
 *
 * WHAT IT WILL NOT DO: MOVE A PIECE BETWEEN ROOMS
 *   A Piece names its room and this module never changes that field, so a drag
 *   that leaves the room is `outside-room` rather than a transfer. Same reason
 *   furniture.ts drops a bed it cannot place instead of reassigning it to the
 *   other bedroom: occupancy is per room, and this module is not where it is
 *   decided. A caller that wants a transfer sets `room` first and then asks.
 */

import {
  GRID,
  WALL_SNAP,
  containedBy,
  overlaps,
  placeIsLegal,
  snapToGrid,
  snapToWalls,
  type Box,
} from "./collide";
import { pieceBox, type Piece } from "./furniture";
import type { Suite } from "./rooms";
import { buildWalls, type Opening, type Wall } from "./walls";

export type DragCtx = {
  suite: Suite;
  /** everything currently placed, the dragged piece included; matched out by id */
  pieces: Piece[];
  /** buildWalls()'s openings for this same suite. Windows are ignored. */
  openings: Opening[];
};

export type DragResult =
  | { ok: true; piece: Piece; snapped: "grid" | "wall" | "none" }
  /**
   * `against` is always non-empty and always ids, so the UI can name what it hit:
   * the ids of the pieces overlapped for `collision`, the room the piece left for
   * `outside-room`, and for `blocks-door` each blocked door followed by the rooms
   * it joins -- `["d1", "hall", "bath"]` reads as "that blocks the way from the
   * hall to the bathroom".
   */
  | { ok: false; reason: "collision" | "outside-room" | "blocks-door"; against: string[] };

export type NudgeDir = "u+" | "u-" | "v+" | "v-";

/**
 * Clear floor a doorway needs on each side, ft. ASSUMED, and the only number in
 * this file that is.
 *
 * Nothing in this project sources it. What bounds it:
 *
 *   below  BED_CLEARANCE is 2 ft, from the phase spec, for the floor you need
 *          beside a bed to get into it. Getting through a doorway is not an
 *          easier act than getting into a bed, so 2 ft is a floor and not a
 *          midpoint.
 *   above  the hall is 4.5 ft wide. A landing as deep as the hall would make the
 *          corridor unfurnishable by its own rule, so the figure has to stay well
 *          under that; and bedroom A has 3.167 ft of depth spare over its
 *          bed-dresser-chair-desk band, so a landing deeper than that would
 *          condemn the designed arrangement rather than describe it.
 *
 * Deliberately NOT `BED_CLEARANCE` imported. The two numbers are equal by
 * coincidence of magnitude, not by derivation -- one is about a bed's long side
 * and the other about a doorway -- and furniture.ts's withFrame() records what
 * happens when a coincidence is written as a dependency: correcting one value
 * moves something it was never about.
 *
 * What the choice between 2 and 3 ft costs, re-measured at the defaults now that
 * layout() is door-aware and builds to whatever this number says: at 3 ft the whole
 * fit-out still places -- 29 pieces, all legal, none in a landing -- so nothing is
 * caught either way and this is a question of floor rather than of walkability. What
 * it spends is depth. The bedroom desks come a further foot off the far wall to u 9,
 * which is enough to take each dresser's designed slot at the foot of its bed: the
 * four of them are rescued a quarter-turned instead. The bedroom chairs follow their
 * desks and stay clear of the landing either way, at u 11.25 to 12.75 against a
 * landing starting at u 14 here, and a foot further in against one starting at 13.
 */
export const DOOR_CLEARANCE = 2;

/** Float slack. Same rationale as collide.ts's EPSILON, which is not exported. */
const EPS = 1e-9;

/**
 * How many grid steps one keypress may ask for before nudge() gives up. Derived,
 * not chosen: the smallest whole number of steps whose distance clears a wall's
 * snap catchment, floor(1 / 0.5) + 1 = 3 at the current constants.
 *
 * Both halves of that are load-bearing. floor() rather than ceil() because the
 * step that lands exactly ON the catchment boundary is still caught -- snapAxis()
 * tests `> threshold`, so the boundary belongs to the wall -- and the + 1 is what
 * carries the offer past it. At WALL_SNAP = 1 and GRID = 0.5 that is 1.5 ft, which
 * is the first distance a piece flush against a wall can be offered and keep.
 *
 * What bounds it above is that it is a keypress: 3 steps is 1.5 ft, and a piece
 * that travels further than that on one arrow key has stopped being nudged. What
 * bounds it below is that anything smaller cannot get off a wall at all, which is
 * the defect this exists for. It follows WALL_SNAP and GRID down on its own, so
 * whoever revisits either in collide.ts does not have to find this number too.
 */
export const MAX_NUDGE_STEPS = Math.floor(WALL_SNAP / GRID) + 1;

const QUARTER: Record<0 | 90 | 180 | 270, 0 | 90 | 180 | 270> = {
  0: 90,
  90: 180,
  180: 270,
  270: 0,
};

const STEP: Record<NudgeDir, [number, number]> = {
  "u+": [GRID, 0],
  "u-": [-GRID, 0],
  "v+": [0, GRID],
  "v-": [0, -GRID],
};

/** Drag a piece to a new anchor, keeping its yaw. */
export function tryMove(piece: Piece, to: { u: number; v: number }, ctx: DragCtx): DragResult {
  return place(piece, to, piece.yaw, ctx);
}

/**
 * Turn a piece a quarter clockwise, about its own u, v corner.
 *
 * The anchor is the corner and not the visual centre, because that is what
 * footprintOf() means by rot and collide.ts's header explains why: keeping the
 * anchor fixed is what makes the footprint a plain projection onto the world
 * axes. A UI that would rather spin the piece about its middle composes that
 * translation itself and asks tryMove() for the result.
 */
export function tryRotate(piece: Piece, ctx: DragCtx): DragResult {
  return place(piece, { u: piece.u, v: piece.v }, QUARTER[piece.yaw], ctx);
}

/**
 * Keyboard equivalent of a drag: one grid step, or the smallest whole number of
 * grid steps that actually moves the piece. The 90 degree turn is tryRotate(),
 * which the same key handler calls.
 *
 * A step from an off-grid anchor lands on the grid rather than a step beyond it,
 * because tryMove() snaps and this goes through tryMove(). That is the intended
 * behaviour and not an accident of reuse: the alternative is a keyboard path that
 * can reach positions the pointer path cannot.
 *
 * WHY IT RETRIES AT ALL
 *   WALL_SNAP is 1 ft and a grid step is 0.5, so one step away from a wall a piece
 *   is already flush against lands inside that wall's catchment and snapToWalls()
 *   puts it straight back. Two steps land at 1.0 ft, which snapAxis() still catches
 *   -- its test is `> threshold`. 1.5 ft is the first offer that survives, and a
 *   keypress worth one grid step can never make it. Measured before this loop
 *   existed: bedroom A's first bed, flush against the room's south wall, could not
 *   be moved off it by any number of "v+" presses, and the common room's bookcase,
 *   half a foot off the facade, answered four consecutive "u+" nudges with u = 0.
 *   design-system/MASTER.md asks for a keyboard equivalent of every canvas
 *   interaction, and an arrow key that visibly refuses to move is not one.
 *
 * WHY THAT IS NOT A SECOND SNAPPING RULE
 *   Every attempt is the same place() the pointer path uses, so the piece can only
 *   land where a drag to that same target would also have put it, and there is
 *   still exactly one snapping rule and one legality gate in this module. What the
 *   retry changes is how far a keypress ASKS to go, which is the keyboard's own
 *   business -- the pointer says how far by moving. An exemption for "stepping away
 *   from the wall I am snapped to" would have been the second rule P6 forbids, and
 *   is refused for that reason and not for this one.
 *
 *   The WALL_SNAP > GRID relation that causes all of it is untouched and this does
 *   not resolve it -- it makes the keyboard usable in spite of it. Whoever revisits
 *   WALL_SNAP in collide.ts is revisiting the cause; MAX_NUDGE_STEPS is derived
 *   from it and needs no separate edit.
 *
 * THE TRAP, AND IT WAS HIT: WHICH REFUSAL COMES BACK
 *   The refusal returned is the FIRST attempt's, not the cap's. A dresser nudged
 *   into the piece beside it is refused three times over, and by 3 steps it has
 *   reached a second piece as well -- `against` grows from one id to two. The
 *   reason a keyboard user needs is the near one they are actually stopped by, so
 *   the first attempt is what stands. Same for a step INTO a wall: all three
 *   offers are pulled back flush, none of them move, and the first result -- ok,
 *   flush, unchanged -- is exactly the clamp that behaviour always was.
 *
 * TWO CONSEQUENCES OF THE SHARED SNAP, NOT OF THIS LOOP
 *   A piece standing inside a catchment but not flush goes flush on the first
 *   press, even pressing away from the wall: the bookcase at u = 0.5 answers "u+"
 *   with u = 0, because that is where a drag to u = 1 lands too, and 0 differs from
 *   0.5 so the loop stops there. The press after it escapes to 1.5.
 *
 *   And a piece can be carried over an obstacle small enough to fit inside the
 *   escape: overlapped at 1.0 ft and clear at 1.5 ft is possible for an obstacle
 *   whose far edge is within 1.5 ft of the mover's near edge. Bounded by the cap
 *   and by nothing else, which is the price of asking every offer up to it rather
 *   than stopping at the first refusal -- and stopping there would leave a piece
 *   walled in by anything standing 1 ft off it.
 */
export function nudge(piece: Piece, dir: NudgeDir, ctx: DragCtx): DragResult {
  const [du, dv] = STEP[dir];
  const offer = (steps: number) =>
    place(piece, { u: piece.u + steps * du, v: piece.v + steps * dv }, piece.yaw, ctx);

  const first = offer(1);
  if (first.ok && moved(first.piece, piece)) return first;
  for (let steps = 2; steps <= MAX_NUDGE_STEPS; steps++) {
    const r = offer(steps);
    if (r.ok && moved(r.piece, piece)) return r;
  }
  return first;
}

/**
 * The one path. Snap, then gate, then classify the refusal.
 *
 * placeIsLegal() is the gate and is called as-is; the branch below only works out
 * WHICH of its refusals this was, by asking whether anything is actually
 * overlapped. That ordering matters: if collide.ts grows a fourth way to be
 * illegal, this returns ok: false with the nearest reason rather than quietly
 * letting the placement through, which is what re-implementing its checks here to
 * get better messages would have done. "Too big for the room" lands on
 * `outside-room`, which is exact rather than a rounding -- a piece wider than its
 * room cannot be contained by it either.
 */
function place(
  piece: Piece,
  to: { u: number; v: number },
  yaw: Piece["yaw"],
  ctx: DragCtx,
): DragResult {
  const room = ctx.suite.rooms.find((r) => r.id === piece.room);
  // A piece naming a room the suite does not have is what a slider that deletes a
  // room leaves behind. It has nowhere legal to go, and saying so with the id it
  // named is more use than saying "no room".
  if (!room) return { ok: false, reason: "outside-room", against: [piece.room] };

  const raw: Box = { u: to.u, v: to.v, du: piece.du, dv: piece.dv, rot: yaw };
  const grid = snapToGrid(raw);
  const flush = snapToWalls(grid, room);
  // Wall snap runs second and is allowed to override, per collide.ts's header, so
  // it is also the one to report: a piece that snapped to a wall usually snapped
  // to the grid on the way there, and "wall" is the more informative of the two.
  const snapped = moved(flush, grid) ? "wall" : moved(grid, raw) ? "grid" : "none";
  const cand: Piece = { ...piece, u: flush.u, v: flush.v, yaw };
  const box = pieceBox(cand);

  // Every other piece in the suite, not just this room's. A superset of what
  // placeIsLegal() needs -- rooms do not overlap, so a piece contained by its own
  // room cannot reach into another's -- but it costs nothing and it is the
  // arrangement that survives a piece whose `room` field is wrong.
  const others = ctx.pieces.filter((o) => o.id !== piece.id);
  if (!placeIsLegal(box, room, others.map(pieceBox)).ok) {
    // Containment is the discriminator, not the overlap list, and the order was
    // wrong first time round: turning the common room's sofa a quarter swings it out
    // through the wall into K, and the honest answer is that it left the common room
    // -- not that it collided with furniture in a room it has no business reaching.
    // The case that argued it was the sofa at its old anchor, 3.25 ft out and landing
    // on two of K's chairs so that the overlap list was non-empty and the ordering
    // decided the answer. The sofa has since been pulled 2 ft back off K's door and
    // now swings 1.25 ft out and reaches nothing, so the argument no longer has its
    // own example -- the ordering is unchanged, because what it is about is which
    // refusal is true and not how far the piece went. With containment settled first,
    // an empty overlap list is impossible here: placeIsLegal only has three ways to
    // refuse and too-big implies not-contained.
    if (!containedBy(box, room)) {
      return { ok: false, reason: "outside-room", against: [room.id] };
    }
    return {
      ok: false,
      reason: "collision",
      against: others.filter((o) => overlaps(box, pieceBox(o))).map((o) => o.id),
    };
  }

  const blocked = doorsBlockedBy(box, ctx);
  if (blocked.length > 0) return { ok: false, reason: "blocks-door", against: blocked };

  return { ok: true, piece: cand, snapped };
}

/**
 * Anchors apart by more than float noise. Typed to the two fields it reads rather
 * than to Box, so nudge() can ask it about a Piece without building a Box to throw
 * away -- an anchor is an anchor whichever record it arrived in.
 */
function moved(a: { u: number; v: number }, b: { u: number; v: number }): boolean {
  return Math.abs(a.u - b.u) > EPS || Math.abs(a.v - b.v) > EPS;
}

/**
 * The doors this footprint stands in the way of: the door's own id, then the rooms
 * it joins, for each one.
 *
 * The walls are rebuilt from the suite rather than taken from the caller, because
 * an Opening carries a wallId and nothing else that locates it, and a wall list
 * passed in alongside could disagree with the suite it is being measured against.
 * Measured, it costs 0.11 ms for the default suite -- under a tenth of a frame at
 * 60 Hz, on the pointer-move path -- and it is skipped entirely for a suite with no
 * doors.
 */
function doorsBlockedBy(box: Box, ctx: DragCtx): string[] {
  const doors = ctx.openings.filter((o) => o.kind === "door");
  if (doors.length === 0) return [];
  const walls = buildWalls(ctx.suite).walls;
  const out: string[] = [];
  for (const d of doors) {
    const w = walls.find((x) => x.id === d.wallId);
    if (!w) {
      // Loud rather than silent, in the manner of rooms.ts's stepOntoTheWing: a
      // door whose wall cannot be found is openings and suite from two different
      // builds, and skipping it would drop the door check for that door alone
      // while every assertion about the others still passed.
      throw new Error(
        `drag: opening ${d.id} names wall ${d.wallId}, which this suite has no such wall in. ` +
          "ctx.openings must come from buildWalls(ctx.suite).",
      );
    }
    if (overlaps(box, doorZone(w, d))) out.push(d.id, ...d.connects);
  }
  // A door and the rooms it joins can repeat across two blocked doors -- both
  // bedroom doors name the hall -- and a list that says "hall" twice reads as a
  // bug in the UI that prints it.
  return [...new Set(out)];
}

/**
 * The clear floor a door needs: its width along the wall, by DOOR_CLEARANCE deep
 * on BOTH sides of the band.
 *
 * Both sides, so the question "which room is this door's landing in" never has to
 * be asked -- a door joins two rooms and is blocked from either. The piece's own
 * containment is what keeps that from over-reaching: it can only ever be standing
 * on one side.
 *
 * THE TRAP: `offset` is measured along the BAND, from the band's origin corner,
 * and bands merge -- the one carrying bedroom A's door runs the room's full 10 ft
 * and the one carrying the suite entry runs 31.5 ft, past the hall at both ends.
 * So the zone has to be built off the wall's own origin and axis. The axis
 * tie-break is buildOpenings()'s exactly, `du > dv`, and it is copied rather than
 * inferred because for a square band the two answers differ and only one of them
 * agrees with where the door was actually put.
 */
function doorZone(w: Wall, o: Opening): Box {
  const alongV = !(w.du > w.dv);
  const c = DOOR_CLEARANCE;
  return alongV
    ? { u: w.u - c, v: w.v + o.offset, du: w.du + 2 * c, dv: o.width }
    : { u: w.u + o.offset, v: w.v - c, du: o.width, dv: w.dv + 2 * c };
}
