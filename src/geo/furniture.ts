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
 * WHAT THIS MODULE CANNOT SEE
 *   Doors. Openings live in walls.ts, and importing it would break the purity
 *   rule that keeps this file testable, so nothing here keeps a doorway clear and
 *   a piece can stand across one. In bedroom A at the stated dimensions this is
 *   not an exposure but a clash, and the arithmetic settles it without the
 *   opening list: both desks stand flush against the inner wall at u = 16,
 *   covering v [15.5, 19.5] and [21.5, 25.5] of a run that ends at 25.5, so the
 *   only stretch of that wall not behind a desk is the 2 ft gap at [19.5, 21.5]
 *   -- and buildOpenings() makes every room door 3 ft wide. No 3 ft door fits
 *   anywhere on that wall clear of the desks, wherever it lands.
 *
 *   What the opening list is needed for is which wall the bedroom door is
 *   actually on and which desk therefore has to move, so the fix is P6's
 *   furniture-vs-door work rather than this module's. The layout is left as it is
 *   on purpose: shuffling the desks here to dodge a door whose position this file
 *   cannot read would be guessing, and a known clash is better than a guess.
 */

import { GRID, footprintOf, placeIsLegal, type Box } from "./collide";
import type { Rect, Suite } from "./rooms";

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

/** The world-axis footprint, safe to hand straight to collide.ts. */
export function pieceBox(p: Piece): Box {
  return footprintOf({ u: p.u, v: p.v, du: p.du, dv: p.dv, rot: p.yaw });
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

  const out: Piece[] = [];
  let left = wanted;
  bedrooms.forEach((room, i) => {
    // Bedroom A fills first, which is the door order off the hall. No cap here:
    // bedroomSlots() is the one place that holds the two-to-a-bedroom limit, and
    // a second copy of it would be a rule no test could reach.
    const share = Math.ceil(left / (bedrooms.length - i));
    left -= share;
    out.push(...fitOut(room, (f) => bedroomSlots(f, share)));
  });
  for (const room of commons) {
    out.push(...fitOut(room, room === sitting ? commonSlots : studySlots));
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

// --- the recipes ----------------------------------------------------------

/**
 * Two students to a bedroom, which the housing assignment forces: four people,
 * two bedrooms.
 *
 * DOES IT ACTUALLY FIT? Yes, with room to spare, and this is the arithmetic for
 * the stated 10 x 16 bedroom, which buildSuite() makes 16 deep by 10 along:
 *
 *   across the 10 ft run   two beds at 40 in = 6.667 ft, leaving a 3.333 ft
 *                          aisle between them. That aisle is the long side of
 *                          both beds, and BED_CLEARANCE only asks for 2.
 *   along the 16 ft depth  measured off the placed footprints of one station,
 *                          not off SIZES: bed 82 in + dresser 30 in + chair
 *                          18 in + desk 24 in = 154 in = 12.833 ft, leaving
 *                          3.167 ft of open floor.
 *
 * The dresser contributes 30 in and not 18, which is the trap in reading this
 * arrangement off the table. It faces away(i), so its yaw is 0 or 180 and it is
 * never turned, and the extent that runs along the depth is therefore its du.
 * The desk and the chair face along a and are turned, so theirs is their dv. Only
 * localExtent() knows which, so the honest way to state the band is to add up
 * what layout() actually placed -- which is what the test does.
 *
 * So the run is the binding constraint, and it binds at 8.667 ft: below that the
 * two beds cannot both keep their 2 ft side by side, and settle() puts the second
 * one end to end along the depth instead so that at least the first keeps its
 * clearance. Below 6.667 ft they cannot sit side by side at all. Both thresholds
 * are well outside the resident's stated one foot of uncertainty on the 10.
 *
 * Beds go head to the a = 0 wall, which in a bedroom of the default suite is the
 * facade -- so heads under the window, and the desks take the far end.
 */
function bedroomSlots(f: Frame, students: number): Slot[] {
  const n = Math.max(0, Math.min(students, BEDS_PER_BEDROOM));
  const bed = localExtent(f, "bed", "+b");
  const desk = localExtent(f, "desk", "-a");
  const chair = localExtent(f, "chair", "+a");
  const dresser = localExtent(f, "dresser", "+b");

  // Station 0 hugs the b = 0 wall, station 1 the far one, and each piece faces
  // away from its own wall -- which is all the yaw convention means.
  const wall = (i: number, eb: number) => (i === 0 ? 0 : f.B - eb);
  const away = (i: number): LocalFace => (i === 0 ? "+b" : "-b");

  const out: Slot[] = [];
  // Kind by kind rather than student by student: settle() takes the list in
  // order, so a cramped room keeps both beds before it keeps anyone's dresser.
  for (let i = 0; i < n; i++) {
    out.push({ kind: "bed", a: 0, b: wall(i, bed.eb), faces: away(i) });
  }
  for (let i = 0; i < n; i++) {
    out.push({ kind: "desk", a: f.A - desk.ea, b: wall(i, desk.eb), faces: "-a" });
  }
  for (let i = 0; i < n; i++) {
    out.push({
      kind: "chair",
      a: f.A - desk.ea - chair.ea,
      b: wall(i, desk.eb) + (desk.eb - chair.eb) / 2,
      faces: "+a",
    });
  }
  for (let i = 0; i < n; i++) {
    out.push({ kind: "dresser", a: bed.ea, b: wall(i, dresser.eb), faces: away(i) });
  }
  return out;
}

/** Sofa against the inner end wall, table in front, chairs flanking, bookcases on the side walls. */
function commonSlots(f: Frame): Slot[] {
  const sofa = localExtent(f, "sofa", "-a");
  const table = localExtent(f, "table", "-a");
  const chair = localExtent(f, "chair", "+b");
  const shelf = localExtent(f, "shelf", "+b");

  const sofaA = f.A - sofa.ea;
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
 */
function studySlots(f: Frame): Slot[] {
  const table = localExtent(f, "table", "+b");
  const chair = localExtent(f, "chair", "+b");
  const shelf = localExtent(f, "shelf", "+a");

  const tableA = (f.A - table.ea) / 2;
  const tableB = (f.B - table.eb) / 2;
  const near = tableB - GRID - chair.eb;
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

function fitOut(room: Rect, recipe: (f: Frame) => Slot[]): Piece[] {
  const f = frameOf(room);
  const placed: Piece[] = [];
  const seen = new Map<FurnitureKind, number>();
  for (const s of recipe(f)) {
    const n = seen.get(s.kind) ?? 0;
    seen.set(s.kind, n + 1);
    // Ids count slots, not successes, so a dropped piece does not renumber the
    // ones after it -- the renderer keys instanced meshes off these.
    const settled = settle(pieceOf(f, `${room.id}-${s.kind}-${n}`, s), room, placed);
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
function settle(want: Piece, room: Rect, placed: Piece[]): Piece | null {
  const boxes = placed.map(pieceBox);
  for (const strict of [true, false]) {
    if (accept(want, room, placed, boxes, strict)) return want;
    const rescued = scan(want, room, placed, boxes, strict);
    if (rescued) return rescued;
  }
  return null;
}

function accept(
  cand: Piece,
  room: Rect,
  placed: Piece[],
  boxes: Box[],
  strict: boolean,
): boolean {
  if (!placeIsLegal(pieceBox(cand), room, boxes).ok) return false;
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

/** Sweep the room on the placement grid, both orientations, nearest first. */
function scan(
  want: Piece,
  room: Rect,
  placed: Piece[],
  boxes: Box[],
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
    if (accept(c, room, placed, boxes, strict)) return c;
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
