/**
 * The suite's fit-out: which pieces of furniture stand in which room, and where.
 *
 * Pure arithmetic in the suite frame, like rooms.ts and collide.ts. No three.js,
 * no state, no DOM. Scene code turns a Piece into a mesh; nothing in here knows
 * that meshes exist, which is what lets the whole fit-out be property-tested in
 * Node against 200-odd parameter sets in under a second.
 *
 * SUITE FRAME (same as rooms.ts)
 *   u = feet inward from the outer facade
 *   v = feet north along the end section
 *
 * WHERE THE SIZES COME FROM, AND WHERE THEY DO NOT
 *   One of them is sourced. Harvard's dorm mattress is an extra-long twin,
 *   38 x 80 in; collide.ts's header already treats that as a real measurement
 *   ("a mattress is 38 inches wide because Harvard bought it that way") and
 *   tests/collide.test.ts already places two of them in Bedroom A. Every other
 *   entry in SIZES is a standard-issue guess at a piece Harvard has published no
 *   dimension for, and the table on SIZES marks each one ASSUMED. Do not launder
 *   them into measurements: presenting an inference in the same voice as a
 *   source is the specific failure docs/DIMENSION-AUDIT.md exists to record.
 *
 * WHY THE LAYOUT IS DESIGNED AND THEN GATED, RATHER THAN SEARCHED
 *   Each room has a recipe that computes slots from the room's actual extents,
 *   so the arrangement follows the walls when a slider moves them. But a recipe
 *   alone cannot promise legality once the walls have moved far enough, so every
 *   slot is put through placeIsLegal() before it is accepted. The returned set is
 *   therefore legal by construction, not by inspection, for any Suite whatsoever.
 *
 * WHY IT DEGRADES BY DROPPING AND NEVER BY SHRINKING
 *   A slot that fails the gate is re-tried on collide.ts's 0.5 ft grid, in both
 *   orientations, nearest the designed position first. If nothing legal exists
 *   the piece is dropped. It is never resized: a Harvard bed frame is as long as
 *   the mattress Harvard bought, and quietly making it shorter to fit a slider's
 *   idea of a bedroom would invent a dimension to hide a conflict.
 *
 * THE TRAP THIS ORDERING EXISTS TO AVOID
 *   Beds are emitted before everything else and the rescue scan runs a strict
 *   pass first, because otherwise a desk rescued into the aisle between two beds
 *   is perfectly legal and quietly destroys the 2 ft of getting-in space that is
 *   the whole reason the bedroom arrangement is what it is. Legality is not the
 *   same property as usability, and only one of the two is checkable by
 *   collide.ts.
 *
 * DOORS, AND WHY walls.ts IS SAFE TO IMPORT AFTER ALL
 *   This header used to say the module could not see openings, because importing
 *   walls.ts would break the purity rule -- and it recorded the consequence as a
 *   known clash rather than a defect: both bedroom desks stood flush against the
 *   inner wall at u = 16, covering v [15.5, 19.5] and [21.5, 25.5] of a run ending
 *   at 25.5, leaving one 2 ft gap at [19.5, 21.5], and buildOpenings() makes every
 *   room door 3 ft. No 3 ft door fitted anywhere on that wall. The common room's
 *   sofa stood square across K's door on the same reasoning. That was six pieces in
 *   three of the suite's five interior doors, and it was wrong to file it as a
 *   consequence: unreachableRooms() exists in rooms.ts precisely because a suite
 *   nobody can walk into is a defect this geometry produces silently, and a room
 *   nobody can walk into is that defect one scale down.
 *
 *   The purity worry was misplaced. walls.ts's only import is `import type { Rect,
 *   Suite } from "./rooms"`, which is erased, so it drags in no three.js and no
 *   state, and it does not import this file back, so there is no cycle. It is also
 *   already proven node-loadable on its own: scripts/emit-plan.mjs and
 *   scripts/emit-layout.mjs import it by path in plain node, and tests/drift.test.ts
 *   runs both. The gate that a value import DID break -- rooms.ts importing place.ts,
 *   see measuredFacadeStep there -- broke because place.ts pulls in frames.ts and
 *   weld.json, which node's resolver cannot reach. walls.ts pulls in nothing.
 *
 * WHAT KEEPING A DOORWAY CLEAR ACTUALLY MEANS HERE
 *   doorLandings() turns the opening list into DOOR_CLEARANCE-deep rectangles on
 *   both faces of each door's band, and they are used twice over. The recipes are
 *   handed them in the room's own axes and DESIGN round them -- farLimit() is what
 *   pulled the bedroom desks off the far wall and the common room's sofa off K's --
 *   and accept() refuses them in both its passes, so nothing the rescue scan finds
 *   can stand in a doorway either. Same split as placeIsLegal(): the recipe aims,
 *   the gate guarantees.
 */

import { GRID, footprintOf, overlaps, placeIsLegal, type Box } from "./collide";
import type { Rect, Suite } from "./rooms";
import { buildWalls, type Opening, type Wall } from "./walls";

export type FurnitureKind =
  | "bed"
  | "desk"
  | "chair"
  | "dresser"
  | "sofa"
  | "table"
  | "shelf";

export type Piece = {
  id: string;
  kind: FurnitureKind;
  /** the Rect.id of the room it stands in */
  room: string;
  u: number;
  v: number;
  /**
   * The piece's own extents BEFORE yaw, exactly as SIZES gives them. A Piece is
   * a collide.ts Box with yaw playing rot's part, so footprintOf() is what
   * applies the quarter turn -- pieceBox() does that for you. A mesh rotated by
   * yaw wants these unrotated numbers, so both consumers agree.
   */
  du: number;
  dv: number;
  h: number;
  /**
   * Which way the piece faces, as a clockwise rotation in plan: 0 faces +v, 90
   * faces +u, 180 faces -v, 270 faces -u. A piece with its back to a wall faces
   * away from that wall, which is what makes the value useful to the renderer
   * and not merely a footprint swap.
   */
  yaw: 0 | 90 | 180 | 270;
};

/**
 * Inches to feet, written as a division rather than a multiplication by 1/12.
 * 80 * (1/12) and 80/12 are different doubles in the last bit, and the one that
 * matters is the one tests/collide.test.ts already places two mattresses with.
 */
const inches = (n: number) => n / 12;

/**
 * Harvard's dorm mattress, 38 x 80 in. The one furniture dimension in this file
 * with a source, kept exact rather than rounded to 3.17 x 6.67 so that flush
 * placements come out exactly flush -- the same reason tests/collide.test.ts
 * keeps it in twelfths.
 */
export const MATTRESS = { du: inches(80), dv: inches(38) } as const;

/**
 * The bed frame's allowance beyond the mattress, in, on each of the four sides.
 * ASSUMED, unlike the mattress it holds.
 */
const FRAME_IN = 1;

/**
 * One outer extent of the frame from the mattress extent it has to contain.
 *
 * Computed rather than tabulated because a tabulated 82 x 40 in is only true of
 * MATTRESS by coincidence, and a coincidence drifts silently the moment someone
 * corrects the mattress: the comment claimed the derivation for a while before
 * this function existed, and changing MATTRESS left the layout bit-identical.
 *
 * Back to inches and divided once, not added in feet, for the reason inches() is
 * a division: inches(80) + inches(2) and inches(82) are different doubles in the
 * last bit, and the flush placements the recipes depend on want the second. The
 * round trip out of feet costs nothing: checked, inches(n) * 12 === n exactly for
 * every inch figure this file uses, the mattress's 80 and 38 among them.
 */
const withFrame = (mattress: number) => inches(mattress * 12 + 2 * FRAME_IN);

/**
 * Footprints and heights in feet. du runs across the face you approach the
 * piece from, dv from the wall behind it forward, h upward.
 *
 * | kind    | inches   | basis                                                  |
 * |---------|----------|--------------------------------------------------------|
 * | bed     | 82 x 40  | withFrame(MATTRESS), i.e. FRAME_IN on each side. The    |
 * |         |          | allowance is ASSUMED; the mattress inside it is not.    |
 * | desk    | 48 x 24  | ASSUMED -- a standard-issue dorm desk                   |
 * | chair   | 18 x 18  | ASSUMED -- a stacking desk chair                        |
 * | dresser | 30 x 18  | ASSUMED -- a three-drawer chest                         |
 * | sofa    | 72 x 33  | ASSUMED -- a two-and-a-half-seat common room sofa       |
 * | table   | 48 x 30  | ASSUMED -- one size serving both the common room table  |
 * |         |          | and K's study table, because FurnitureKind has one      |
 * |         |          | "table" and inventing a second kind would be worse      |
 * | shelf   | 36 x 12  | ASSUMED -- a four-shelf bookcase                        |
 *
 * Heights are all ASSUMED. Every one of them is well under the 10.75 ft ceiling
 * DEFAULT_PARAMS derives from the 12 ft floor-to-floor, so none of them can
 * collide with it; the test asserts that rather than trusting it.
 *
 * ASSUMED INVENTORY, AND NOT ONLY ASSUMED DIMENSIONS
 *   The bedroom chairs are this module's own addition. Nothing asks for them:
 *   docs/DIMENSION-AUDIT.md section 3 fixes the per-room inventory at "two beds,
 *   two desks, two dressers per bedroom", and the phase spec names no chair
 *   either. They are here because a desk you cannot sit at is not a desk, which
 *   is a design judgement and not a source. They are not free: at the stated
 *   10 x 16 each chair takes 1.5 ft of the 3.167 ft the arrangement has spare
 *   along the depth, so the two of them spend half of it. Flagged in the same
 *   voice as the dimensions above, because inventing a piece of furniture is the
 *   same kind of invention as inventing a measurement, and only one of the two
 *   has a table to be marked ASSUMED in.
 */
export const SIZES: Record<FurnitureKind, { du: number; dv: number; h: number }> = {
  bed: { du: withFrame(MATTRESS.du), dv: withFrame(MATTRESS.dv), h: inches(24) },
  desk: { du: inches(48), dv: inches(24), h: inches(30) },
  chair: { du: inches(18), dv: inches(18), h: inches(34) },
  dresser: { du: inches(30), dv: inches(18), h: inches(30) },
  sofa: { du: inches(72), dv: inches(33), h: inches(32) },
  table: { du: inches(48), dv: inches(30), h: inches(30) },
  shelf: { du: inches(36), dv: inches(12), h: inches(48) },
};

/**
 * Clear floor a bed needs on one of its long sides, ft. You get into a bed from
 * the side, so this is not decoration; it is the difference between a bedroom
 * and a storage room. Two ft is the figure the phase spec sets.
 */
export const BED_CLEARANCE = 2;

/**
 * Four people in two bedrooms, per the housing assignment in
 * docs/DIMENSION-AUDIT.md section 3, which also fixes the per-room inventory:
 * "two beds, two desks, two dressers per bedroom".
 */
const DEFAULT_BEDS = 4;
const BEDS_PER_BEDROOM = 2;

/**
 * Spacing between a sofa and the table in front of it, and between a table and
 * the chairs around it. Expressed in grid steps on purpose: collide.ts's 0.5 ft
 * grid is this project's unit of deliberate placement, so borrowing it keeps
 * this module from inventing a clearance measurement of its own.
 */
const GAP = 3 * GRID;

/** Float slack. Same rationale as collide.ts's EPSILON, which is not exported. */
const EPS = 1e-9;

/**
 * Clear floor a doorway needs on each side, ft. ASSUMED.
 *
 * A SECOND COPY OF drag.ts's DOOR_CLEARANCE, AND THE TWO MUST STAY EQUAL
 *   The number is the same 2 ft and the landing built from it is the same
 *   rectangle, because a doorway a drag may not block is the same doorway a
 *   default fit-out may not stand in -- if these two disagree, layout() emits an
 *   arrangement that tryMove() will not let anyone put back, which is worse than
 *   either rule alone. drag.ts's header records the bounds the figure sits inside
 *   (BED_CLEARANCE's 2 ft from below, the hall's 4.5 ft width from above).
 *
 *   It is copied rather than imported because drag.ts imports THIS file for
 *   pieceBox, so `import { DOOR_CLEARANCE } from "./drag"` is a cycle. The other
 *   direction -- drag.ts importing it from here -- would work, and is not taken
 *   because it is drag.ts's number: it was reasoned out there against the drag
 *   rule, and this module is the later consumer of it. So: duplicated on purpose,
 *   with the equality asserted in tests/furniture.test.ts rather than trusted.
 */
export const DOOR_CLEARANCE = 2;

/** The world-axis footprint, safe to hand straight to collide.ts. */
export function pieceBox(p: Piece): Box {
  return footprintOf({ u: p.u, v: p.v, du: p.du, dv: p.dv, rot: p.yaw });
}

/**
 * The clear floor one door needs: its width along the wall, by DOOR_CLEARANCE
 * deep on BOTH faces of the band.
 *
 * Both faces, so "which room is this door's landing in" never has to be asked. A
 * piece's own containment is what keeps that from over-reaching -- it can only be
 * standing on one side of the wall.
 *
 * THE TRAP, WHICH drag.ts's doorZone() HIT FIRST: `offset` is measured along the
 * BAND from the band's origin corner, and bands merge. The band carrying bedroom
 * A's door runs the room's whole 10 ft; the one carrying the suite entry runs
 * 31.5 ft, past the hall at both ends. So the zone has to be built off the wall's
 * own origin and axis, and the axis tie-break is copied verbatim from
 * buildOpenings() -- `du > dv` -- because for a square band the two answers
 * differ and only one of them agrees with where the door was actually put.
 */
function doorLanding(w: Wall, o: Opening): Box {
  const alongV = !(w.du > w.dv);
  const c = DOOR_CLEARANCE;
  return alongV
    ? { u: w.u - c, v: w.v + o.offset, du: w.du + 2 * c, dv: o.width }
    : { u: w.u + o.offset, v: w.v - c, du: o.width, dv: w.dv + 2 * c };
}

/**
 * Every doorway landing in the suite, in the suite frame.
 *
 * Windows are skipped: a bookcase under a window is a normal thing to own, and
 * the common room's shelves stand on the facade wall on purpose.
 */
export function doorLandings(suite: Suite): Box[] {
  const { walls, openings } = buildWalls(suite);
  const byId = new Map(walls.map((w) => [w.id, w]));
  const out: Box[] = [];
  for (const o of openings) {
    if (o.kind !== "door") continue;
    const w = byId.get(o.wallId);
    // Both lists come out of the one buildWalls() call, so this cannot miss.
    // drag.ts throws in the same place because it is HANDED its openings by a
    // caller and a mismatch there means two different builds; here there is only
    // one build to disagree with.
    if (!w) continue;
    out.push(doorLanding(w, o));
  }
  return out;
}

/**
 * The deepest strip of clear floor along either of a bed's long sides.
 *
 * Measured as a strip, not as a nearest-neighbour distance: the value is the
 * depth d such that the whole d-by-bed-length rectangle beside the bed is inside
 * the room and empty. That is the question "can you get in", and it is why a
 * dresser standing at the foot of the bed does not count against the side.
 *
 * Two beds sharing one aisle both score the full aisle width, which is correct
 * -- the aisle is the long side of each.
 */
export function bedClearance(bed: Piece, room: Rect, others: Piece[]): number {
  const f = pieceBox(bed);
  // The long axis is whichever extent is greater; the sides we care about are
  // the two parallel to it.
  const alongU = f.du >= f.dv;
  const side = (b: Box) => (alongU ? [b.v, b.v + b.dv] : [b.u, b.u + b.du]) as [number, number];
  const span = (b: Box) => (alongU ? [b.u, b.u + b.du] : [b.v, b.v + b.dv]) as [number, number];
  const roomSide = alongU
    ? ([room.v, room.v + room.dv] as const)
    : ([room.u, room.u + room.du] as const);

  const [lo, hi] = side(f);
  const [spanLo, spanHi] = span(f);
  let below = lo - roomSide[0];
  let above = roomSide[1] - hi;

  for (const o of others) {
    if (o.id === bed.id) continue;
    const g = pieceBox(o);
    const [gSpanLo, gSpanHi] = span(g);
    // Only pieces that actually stand in front of some of the bed's length can
    // block getting in along it.
    if (Math.min(spanHi, gSpanHi) - Math.max(spanLo, gSpanLo) <= EPS) continue;
    const [gLo, gHi] = side(g);
    if (gHi <= lo + EPS) below = Math.min(below, lo - gHi);
    if (gLo >= hi - EPS) above = Math.min(above, gLo - hi);
  }
  return Math.max(below, above);
}

/**
 * Default fit-out for a suite.
 *
 * Bedrooms get a bed, desk, chair and dresser per student; the larger common
 * room gets a sofa, table, two chairs and two bookcases; every other common room
 * is fitted as a study, which at the defaults means K. `opts.beds` is the
 * occupancy, so it drives the desks and dressers too.
 */
export function layout(suite: Suite, opts?: { beds?: number }): Piece[] {
  const wanted = Math.max(0, Math.floor(opts?.beds ?? DEFAULT_BEDS));
  const bedrooms = suite.rooms.filter((r) => r.kind === "bed");
  const commons = suite.rooms.filter((r) => r.kind === "common");

  // The bigger common room is the sitting room, the rest are studies. A size
  // test rather than `id === "k"`: K is the second common room because Harvard
  // records two, not because it is called K, and at every plausible parameter
  // set K's 120 sq ft loses to the common room's 300.
  const sitting = commons.reduce<Rect | undefined>(
    (best, r) => (!best || r.du * r.dv > best.du * best.dv ? r : best),
    undefined,
  );

  // Built once for the whole suite rather than per room, because buildWalls()
  // walks every room to merge the bands and doing that seven times over would be
  // seven times the cost for the same answer.
  const landings = doorLandings(suite);

  const out: Piece[] = [];
  let left = wanted;
  bedrooms.forEach((room, i) => {
    // Bedroom A fills first, which is the door order off the hall. No cap here:
    // bedroomSlots() is the one place that holds the two-to-a-bedroom limit, and
    // a second copy of it would be a rule no test could reach.
    const share = Math.ceil(left / (bedrooms.length - i));
    left -= share;
    out.push(...fitOut(room, landings, (f, keep) => bedroomSlots(f, keep, share)));
  });
  for (const room of commons) {
    out.push(...fitOut(room, landings, room === sitting ? commonSlots : studySlots));
  }
  return out;
}

// --- the room-local frame -------------------------------------------------
//
// Recipes are written in (a, b), where a runs along the room's longer axis and b
// across it. Without that the bedroom arrangement would need writing twice, and
// a slider that made a bedroom longer along the hall than deep would silently
// get the wrong one -- the recipe wants "along the long wall", not "along u".

type LocalFace = "+a" | "-a" | "+b" | "-b";
type WorldFace = "+u" | "-u" | "+v" | "-v";
type Slot = { kind: FurnitureKind; a: number; b: number; faces: LocalFace };
type Frame = { room: Rect; long: "u" | "v"; A: number; B: number };

/**
 * A doorway landing in the room's own a, b axes, clipped to the room's floor.
 *
 * Clipped because a landing straddles the wall by construction, so half of every
 * one of them is in the room on the other side and asking a recipe to dodge that
 * half would cost floor twice over.
 */
type Keep = { a0: number; a1: number; b0: number; b1: number };

const YAW: Record<WorldFace, 0 | 90 | 180 | 270> = {
  "+v": 0,
  "+u": 90,
  "-v": 180,
  "-u": 270,
};

const QUARTER: Record<0 | 90 | 180 | 270, 0 | 90 | 180 | 270> = {
  0: 90,
  90: 180,
  180: 270,
  270: 0,
};

function frameOf(room: Rect): Frame {
  const long = room.du >= room.dv ? "u" : "v";
  return {
    room,
    long,
    A: long === "u" ? room.du : room.dv,
    B: long === "u" ? room.dv : room.du,
  };
}

/**
 * The suite-frame landings that reach this room's floor, in its a, b axes.
 *
 * A landing that misses the room entirely is dropped rather than clipped to
 * nothing, so `keep` is empty for the four rooms this suite furnishes that have
 * only one door each -- and empty is what makes farLimit() return the far wall
 * unchanged, which is the behaviour the recipes had before any of this.
 */
function localLandings(f: Frame, landings: Box[]): Keep[] {
  const r = f.room;
  const out: Keep[] = [];
  for (const z of landings) {
    // Same swap frameOf() makes: a runs along the room's longer axis.
    const [a0, aEnd, b0, bEnd] =
      f.long === "u"
        ? [z.u - r.u, z.u + z.du - r.u, z.v - r.v, z.v + z.dv - r.v]
        : [z.v - r.v, z.v + z.dv - r.v, z.u - r.u, z.u + z.du - r.u];
    const keep = {
      a0: Math.max(0, a0),
      a1: Math.min(f.A, aEnd),
      b0: Math.max(0, b0),
      b1: Math.min(f.B, bEnd),
    };
    if (keep.a1 - keep.a0 > EPS && keep.b1 - keep.b0 > EPS) out.push(keep);
  }
  return out;
}

function worldFace(f: Frame, lf: LocalFace): WorldFace {
  if (f.long === "u") {
    return lf === "+a" ? "+u" : lf === "-a" ? "-u" : lf === "+b" ? "+v" : "-v";
  }
  return lf === "+a" ? "+v" : lf === "-a" ? "-v" : lf === "+b" ? "+u" : "-u";
}

/** The piece's extents measured in the room's own a, b axes. */
function localExtent(f: Frame, kind: FurnitureKind, lf: LocalFace): { ea: number; eb: number } {
  const yaw = YAW[worldFace(f, lf)];
  const s = SIZES[kind];
  const turned = yaw === 90 || yaw === 270;
  const wdu = turned ? s.dv : s.du;
  const wdv = turned ? s.du : s.dv;
  return f.long === "u" ? { ea: wdu, eb: wdv } : { ea: wdv, eb: wdu };
}

function pieceOf(f: Frame, id: string, s: Slot): Piece {
  const sz = SIZES[s.kind];
  return {
    id,
    kind: s.kind,
    room: f.room.id,
    u: f.room.u + (f.long === "u" ? s.a : s.b),
    v: f.room.v + (f.long === "u" ? s.b : s.a),
    du: sz.du,
    dv: sz.dv,
    h: sz.h,
    yaw: YAW[worldFace(f, s.faces)],
  };
}

// --- what a door costs a recipe -------------------------------------------

/**
 * How far along the a axis a recipe may build: the room's far end, pulled back
 * clear of any landing that reaches that wall.
 *
 * Pulled back across the WHOLE run, not only across the door's own width. The
 * narrower reading -- keep the doorway's 3 ft clear and let furniture stand in the
 * corners either side of it -- was worked out for the bedroom and refused, because
 * it closes at exactly nothing to spare: a station's desk and its pulled-out chair
 * stand 3.5 ft off their own wall, two of them are 7 ft, and a 10 ft run less a
 * 3 ft door is 7 ft. A plan that closes exactly is a plan that stops closing the
 * moment a slider moves, and the resident's stated 10 carries a foot of uncertainty in
 * both directions. Keeping the strip clear instead spends depth to buy back the
 * whole run, and the bedroom has 2.667 ft of depth spare against a 2 ft landing.
 *
 * It is also what furnishing a room actually means. Nobody stands a desk six
 * inches to the side of a door swing.
 */
function farLimit(f: Frame, keep: Keep[]): number {
  return keep.reduce((lim, k) => (k.a1 > f.A - EPS ? Math.min(lim, k.a0) : lim), f.A);
}

/**
 * Where a group `depth` ft across b sits: centred, then pushed off centre by
 * whatever a landing in one of the two b walls demands.
 *
 * Only K needs this, and only just: K's door off the common room is in its b = 0
 * wall and is centred on the COMMON ROOM's 15 ft run rather than on K's 12, so it
 * lands opposite one end of the study table and the chair at that end stood 0.25 ft
 * inside the landing. Three inches of shift buys it back and keeps the four chairs
 * symmetric about the table, which rescuing the one chair would not.
 *
 * A room with a door in BOTH b walls gets the second one's answer and is then very
 * likely rescued or dropped by the gate. Not worth arithmetic here: no room in this
 * suite has two, and inventing a rule for a case the geometry does not produce is
 * how a recipe grows branches no test reaches.
 */
function clearOfBWalls(f: Frame, keep: Keep[], depth: number): number {
  let b0 = (f.B - depth) / 2;
  for (const k of keep) {
    if (k.b0 <= EPS) b0 = Math.max(b0, k.b1);
    if (k.b1 > f.B - EPS) b0 = Math.min(b0, k.b0 - depth);
  }
  return b0;
}

// --- the recipes ----------------------------------------------------------

/**
 * Two students to a bedroom, which the housing assignment forces: four people,
 * two bedrooms.
 *
 * ONE LINE PER STUDENT, AGAINST THAT STUDENT'S OWN WALL
 *   bed, then dresser at its foot, then desk, all three with their backs to the
 *   same long wall, and the chair pulled out in front of the desk into the room.
 *   The line runs from the a = 0 wall -- the facade in a bedroom of the default
 *   suite, so heads under the window -- and stops where farLimit() says, which
 *   leaves the strip in front of the hall door clear.
 *
 * DOES IT ACTUALLY FIT, WITH THE DOOR? Yes, and this is the arithmetic for the
 * stated 10 x 16 bedroom, which buildSuite() makes 16 deep by 10 along, with the
 * 3 ft hall door centred in the far end wall:
 *
 *   along the 16 ft depth  measured off the placed footprints of one station, not
 *                          off SIZES: bed 82 in + dresser 30 in + desk 48 in
 *                          = 160 in = 13.333 ft. farLimit() allows 16 - 2 = 14,
 *                          so the line clears the landing by 0.667 ft and the
 *                          desk stands flush against the landing's edge.
 *   across the 10 ft run   two beds at 40 in = 6.667 ft, leaving a 3.333 ft aisle
 *                          between them. That aisle is the long side of both beds
 *                          and BED_CLEARANCE only asks for 2. The desk-and-chair
 *                          pair stands 3.5 ft off its own wall, 0.167 ft past the
 *                          bed, and the two pairs leave 3 ft between them.
 *
 * The dresser contributes 30 in and not 18, which is the trap in reading this
 * arrangement off the table. It faces away(i), so its yaw is 0 or 180 and it is
 * never turned, and the extent that runs along the depth is therefore its du. The
 * desk now faces away(i) too and so contributes its 48 and not its 24 -- that is
 * the change the door forced, and it is why the band grew from 154 in to 160 while
 * the room got easier rather than harder. Only localExtent() knows which extent is
 * which, so the honest way to state the band is to add up what layout() actually
 * placed, which is what the test does.
 *
 * WHY THE DESK TURNED RATHER THAN MOVED
 *   Flush against the far end wall with its 48 in frontage along the run, which is
 *   where it stood before this module could see doors, two desks claim 8 ft of a
 *   10 ft wall and leave one 2 ft gap. Every room door buildOpenings() makes is
 *   3 ft, so no door in that wall can be clear of them wherever it lands -- the
 *   clash was arithmetic, not bad luck. Turned a quarter the same desk claims 2 ft
 *   of the run instead of 4, and there is then a whole clear strip rather than a
 *   gap to thread a door through.
 *
 * SO WHICH CONSTRAINT BINDS NOW
 *   The run still binds first, at 8.667 ft: below that the two beds cannot both
 *   keep their 2 ft side by side, and settle() puts the second one end to end along
 *   the depth instead so that at least the first keeps its clearance. Below
 *   6.667 ft they cannot sit side by side at all. The depth binds second, at
 *   15.333 ft -- band 13.333 plus the 2 ft landing -- which is 0.667 ft inside
 *   the resident's stated one foot of uncertainty on the 16, so a bedroom at the bottom of
 *   that range has its desks rescued rather than designed. Measured over the
 *   randomised sweep and reported there.
 */
function bedroomSlots(f: Frame, keep: Keep[], students: number): Slot[] {
  const n = Math.max(0, Math.min(students, BEDS_PER_BEDROOM));
  const bed = localExtent(f, "bed", "+b");
  const desk = localExtent(f, "desk", "+b");
  // Square, so which way it faces cannot change its extents; asked with the face
  // it gets for station 0 anyway, so the call reads as the piece it describes.
  const chair = localExtent(f, "chair", "-b");
  const dresser = localExtent(f, "dresser", "+b");

  // Station 0 hugs the b = 0 wall, station 1 the far one. Each piece with a wall
  // behind it faces away from that wall, and the chair faces back toward it,
  // which is all the yaw convention means.
  const away = (i: number): LocalFace => (i === 0 ? "+b" : "-b");
  const toward = (i: number): LocalFace => (i === 0 ? "-b" : "+b");
  /** b of a piece standing `depth` ft off station i's own wall. */
  const off = (i: number, depth: number, eb: number) =>
    i === 0 ? depth : f.B - depth - eb;

  // As deep as the door lets it go. With no door in that wall this is flush
  // against it, which is where the desk stood before any of this.
  const deskA = farLimit(f, keep) - desk.ea;

  const out: Slot[] = [];
  // Kind by kind rather than student by student: settle() takes the list in
  // order, so a cramped room keeps both beds before it keeps anyone's dresser.
  for (let i = 0; i < n; i++) {
    out.push({ kind: "bed", a: 0, b: off(i, 0, bed.eb), faces: away(i) });
  }
  for (let i = 0; i < n; i++) {
    out.push({ kind: "desk", a: deskA, b: off(i, 0, desk.eb), faces: away(i) });
  }
  for (let i = 0; i < n; i++) {
    out.push({
      kind: "chair",
      a: deskA + (desk.ea - chair.ea) / 2,
      b: off(i, desk.eb, chair.eb),
      faces: toward(i),
    });
  }
  for (let i = 0; i < n; i++) {
    out.push({ kind: "dresser", a: bed.ea, b: off(i, 0, dresser.eb), faces: away(i) });
  }
  return out;
}

/**
 * Sofa facing the facade window, table in front, chairs flanking, bookcases on the
 * side walls.
 *
 * The sofa's back is to the inner end wall, or as near it as farLimit() allows --
 * and at the defaults it does not allow flush, because K's door is in that wall,
 * centred on the room's 15 ft run. A 6 ft sofa centred on the same run covers
 * v 4.5 to 10.5 of it and the doorway is v 6 to 9, so the sofa stood square across
 * the only way into K. Pulling the whole group back by the 2 ft landing costs
 * nothing the room has a use for: the 20 ft depth then carries shelves at a = 0.5,
 * table at 11 and sofa at 15 to 17.75, with the far 2 ft the way through and the
 * quarter foot before it spent on the grid, for the reason below.
 *
 * WHY THE SOFA STOPS ON THE GRID AND NOT WHERE farLimit() SAYS
 *   A piece the fit-out cannot put back where it already stands is a defect, and it
 *   is what the deepest legal anchor gave: the sofa is 33 in from back to front, so
 *   farLimit() - 2.75 landed it at u 15.25 with its far edge exactly on d3's landing
 *   boundary at u 18. That position is legal -- touching a landing is not standing in
 *   one, for the same reason touching is not colliding -- but 15.25 is a quarter foot
 *   off collide.ts's grid, so drag.ts snapped a re-drop up to 15.5 and carried the far
 *   edge 0.25 ft INTO the landing, and tryMove() refused it: pick the sofa up, put it
 *   down where it was, and the answer was blocks-door.
 *
 *   The exact mirror of what the old k-chair-1 did. That chair stood a quarter foot
 *   INSIDE K's landing and grid snap was what freed it; the sofa stood a quarter foot
 *   short of the boundary and grid snap was what trapped it. Same quarter foot, and
 *   the sign is the whole difference between a defect grid snap hides and one it
 *   creates -- which is why the fix is to land the designed anchor on the grid rather
 *   than to buy clearance. On the grid, snapToGrid() is the identity and a re-drop is
 *   a no-op, whatever the clearance; off the grid, no clearance below GRID / 2 is
 *   enough. The other piece in this suite that stands exactly on a landing boundary,
 *   K's own chair, is safe today for precisely that reason and not by any margin.
 *
 *   Only the sofa needs the step, because a piece backed against farLimit() inherits
 *   the limit's own alignment unless its depth breaks it: a desk is 48 in, a whole
 *   number of grid steps, so bedroomSlots() lands on the grid without asking. This is
 *   the arithmetic to repeat for any future piece whose extent is not.
 *
 *   The step is taken in the SUITE frame and not the room's, because the grid
 *   snapToGrid() rounds to is the suite's. Measured: all seven default rooms have
 *   their corners on it, so the two frames agree here and the distinction costs
 *   nothing -- but where a slider takes a corner off the grid, the frame that decides
 *   whether a re-drop moves the piece is the drag handler's.
 */
function commonSlots(f: Frame, keep: Keep[]): Slot[] {
  const sofa = localExtent(f, "sofa", "-a");
  const table = localExtent(f, "table", "-a");
  const chair = localExtent(f, "chair", "+b");
  const shelf = localExtent(f, "shelf", "+b");

  const origin = f.long === "u" ? f.room.u : f.room.v;
  const deepest = origin + farLimit(f, keep) - sofa.ea;
  const sofaA = Math.floor(deepest / GRID + EPS) * GRID - origin;
  const tableA = sofaA - GAP - table.ea;
  const tableB = (f.B - table.eb) / 2;
  return [
    { kind: "sofa", a: sofaA, b: (f.B - sofa.eb) / 2, faces: "-a" },
    { kind: "table", a: tableA, b: tableB, faces: "-a" },
    { kind: "chair", a: tableA, b: tableB - GRID - chair.eb, faces: "+b" },
    { kind: "chair", a: tableA, b: tableB + table.eb + GRID, faces: "-b" },
    // Bookcases on the two side walls, a grid step off the a = 0 wall, which in
    // the default common room is the facade and therefore the window.
    { kind: "shelf", a: GRID, b: 0, faces: "+b" },
    { kind: "shelf", a: GRID, b: f.B - shelf.eb, faces: "-b" },
  ];
}

/**
 * K as a study: one table with four chairs round it and a bookcase at each end.
 *
 * No desks -- the four desks the phase spec asks for are the four in the
 * bedrooms, one per student, and a fifth would contradict the count.
 *
 * Centred along a and centred across b too, until K's own doorway says otherwise.
 * The group is the table plus a grid step plus a chair on each side, 6.5 ft of
 * K's 10 ft width, so 1.75 ft would fall either side of it -- a quarter foot short
 * of the 2 ft landing on the wall the common room is through. clearOfBWalls()
 * spends 0.25 ft of the other side's 1.75 to buy it, which is the whole cost of
 * making this room door-aware.
 */
function studySlots(f: Frame, keep: Keep[]): Slot[] {
  const table = localExtent(f, "table", "+b");
  const chair = localExtent(f, "chair", "+b");
  const shelf = localExtent(f, "shelf", "+a");

  const tableA = (f.A - table.ea) / 2;
  // The seated group, not the table: a chair pushed into a doorway blocks it just
  // as well as a table would, and it is the chairs that reach nearest the walls.
  const group = table.eb + 2 * (GRID + chair.eb);
  const near = clearOfBWalls(f, keep, group);
  const tableB = near + GRID + chair.eb;
  const far = tableB + table.eb + GRID;
  const ends = [tableA, tableA + table.ea - chair.ea];
  return [
    { kind: "table", a: tableA, b: tableB, faces: "+b" },
    ...ends.map((a): Slot => ({ kind: "chair", a, b: near, faces: "+b" })),
    ...ends.map((a): Slot => ({ kind: "chair", a, b: far, faces: "-b" })),
    { kind: "shelf", a: 0, b: (f.B - shelf.eb) / 2, faces: "+a" },
    { kind: "shelf", a: f.A - shelf.ea, b: (f.B - shelf.eb) / 2, faces: "-a" },
  ];
}

// --- placement ------------------------------------------------------------

function fitOut(
  room: Rect,
  landings: Box[],
  recipe: (f: Frame, keep: Keep[]) => Slot[],
): Piece[] {
  const f = frameOf(room);
  // The recipe gets the landings so it can DESIGN round them; settle() gets them
  // so nothing can be ACCEPTED in one whatever the recipe asked for. Both, on
  // purpose: the same split as placeIsLegal(), where the recipes aim at legal
  // slots and the gate is what makes the result legal by construction.
  const keep = localLandings(f, landings);
  const placed: Piece[] = [];
  const seen = new Map<FurnitureKind, number>();
  for (const s of recipe(f, keep)) {
    const n = seen.get(s.kind) ?? 0;
    seen.set(s.kind, n + 1);
    // Ids count slots, not successes, so a dropped piece does not renumber the
    // ones after it -- the renderer keys instanced meshes off these.
    const settled = settle(pieceOf(f, `${room.id}-${s.kind}-${n}`, s), room, placed, landings);
    if (settled) placed.push(settled);
  }
  return placed;
}

/**
 * Take the designed placement if it stands up, otherwise find the nearest one
 * that does, otherwise drop the piece.
 *
 * The strict pass runs first and in full -- designed slot, then scan -- before
 * the permissive pass gets a look, so a piece will travel across the room to
 * avoid crowding a bed rather than settle for a legal-but-useless spot next
 * door to it.
 */
function settle(want: Piece, room: Rect, placed: Piece[], landings: Box[]): Piece | null {
  const boxes = placed.map(pieceBox);
  for (const strict of [true, false]) {
    if (accept(want, room, placed, boxes, landings, strict)) return want;
    const rescued = scan(want, room, placed, boxes, landings, strict);
    if (rescued) return rescued;
  }
  return null;
}

function accept(
  cand: Piece,
  room: Rect,
  placed: Piece[],
  boxes: Box[],
  landings: Box[],
  strict: boolean,
): boolean {
  if (!placeIsLegal(pieceBox(cand), room, boxes).ok) return false;
  // Checked in BOTH passes, unlike the bed clearance below, because a blocked
  // doorway is not a comfort this module trades away when a room gets tight -- it
  // is the room-scale version of what unreachableRooms() refuses at suite scale,
  // and drag.ts refuses it outright for the same reason. So a piece with nowhere
  // legal to stand clear of a door is dropped, not stood in the door.
  if (blocksADoor(cand, landings)) return false;
  if (!strict) return true;
  // Only the beds already down are checked, and the candidate is not checked
  // against itself. There is no need: a bed's own clearance is greatest with its
  // back flush to a long wall, which is exactly where bedroomSlots() puts it, and
  // turning it cannot help because the room's short side is by definition shorter
  // than the bed. So a rule for the candidate bed could never move one.
  for (const bed of placed) {
    if (bed.kind !== "bed") continue;
    // Skip a bed that is already below its 2 ft, or the strict pass becomes
    // unsatisfiable in a tight room and falls through for everything -- which
    // costs the beds that COULD still have been protected. Measured: in a 16 x 7
    // bedroom, dropping this line takes bed 0 from 2.17 ft down to 1.17.
    if (bedClearance(bed, room, placed) < BED_CLEARANCE - EPS) continue;
    if (bedClearance(bed, room, [...placed, cand]) < BED_CLEARANCE - EPS) return false;
  }
  return true;
}

/**
 * Does this piece stand on any doorway landing?
 *
 * overlaps() and not a containment test, so a piece flush to the edge of a
 * landing is fine: collide.ts counts a shared edge as zero area, which is what
 * makes the desks' new slots -- exactly abutting bedroom A's landing -- legal
 * rather than off by a rounding. drag.ts's doorsBlockedBy() draws the line in the
 * same place with the same call, which is the point.
 */
function blocksADoor(cand: Piece, landings: Box[]): boolean {
  const f = pieceBox(cand);
  return landings.some((z) => overlaps(f, z));
}

/** Sweep the room on the placement grid, both orientations, nearest first. */
function scan(
  want: Piece,
  room: Rect,
  placed: Piece[],
  boxes: Box[],
  landings: Box[],
  strict: boolean,
): Piece | null {
  const cands: Piece[] = [];
  for (const yaw of [want.yaw, QUARTER[want.yaw]]) {
    const probe: Piece = { ...want, yaw };
    const f = pieceBox(probe);
    const maxU = room.u + room.du - f.du;
    const maxV = room.v + room.dv - f.dv;
    // This orientation does not fit the room at all; the other one still might.
    if (maxU < room.u - EPS || maxV < room.v - EPS) continue;
    for (const u of stops(room.u, maxU)) {
      for (const v of stops(room.v, maxV)) cands.push({ ...probe, u, v });
    }
  }
  cands.sort((x, y) => dist2(x, want) - dist2(y, want));
  for (const c of cands) {
    if (accept(c, room, placed, boxes, landings, strict)) return c;
  }
  return null;
}

/**
 * Anchor positions along one axis: collide.ts's grid, plus flush against each
 * wall. The flush pair matters because once a slider moves a wall off the grid
 * the grid can no longer reach it, which is the same gap snapToWalls() exists to
 * close in the drag handler.
 */
function stops(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let x = Math.ceil(lo / GRID) * GRID; x <= hi + EPS; x += GRID) out.push(x);
  const last = out[out.length - 1];
  if (last === undefined || hi - last > EPS) out.push(hi);
  if (out[0]! - lo > EPS) out.unshift(lo);
  return out;
}

function dist2(a: Piece, b: Piece): number {
  return (a.u - b.u) ** 2 + (a.v - b.v) ** 2;
}
