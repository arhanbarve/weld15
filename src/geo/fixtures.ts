/**
 * Bathroom fixtures, present-day dorm style -- P14 row 9.
 *
 * No source gives Weld 15's bathroom a single plumbing fixture -- the 1875 text never
 * mentions one, and rooms.ts's own header already treats the room as windowless and
 * otherwise undocumented. So this is one documented operation, the same framing
 * materials.ts's own porcelain comment already uses for the room's tile and wainscot:
 * ordinary present-day American fixture footprints (a tub-shower, a lavatory with a
 * mirror over it, a WC, a radiator, a towel rail), not a period reconstruction, sized
 * to populate the room rather than to be exact.
 *
 * FIXED GEOMETRY, NOT Pieces. src/state/url.ts's KIND_ORDER is a Record over the closed
 * FurnitureKind union specifically so that adding a kind fails to compile rather than
 * quietly dropping a field out of every shared link, and "29 pieces" is asserted as a
 * literal in half a dozen tests and comments -- none of that machinery is for something
 * a resident cannot drag through a wall. A bathtub is fixed architecture, the same as
 * the tile floor and wainscot it stands on.
 *
 * THREE-FREE, like sash.ts and trim.ts: no `import * as THREE`, and no import from
 * Suite.tsx (which does import three) even though every part here is structurally a
 * Slab -- that type stays Suite.tsx's own, and this file's `FixturePart` is the
 * three-free twin trim.ts's own `TrimPart` already is for the same reason.
 *
 * LAYOUT, relative to the bath Rect's own (u, v) corner, so it moves with the
 * bathAlong/bathDeep sliders (Panel.tsx: both range 6-8 ft) the way the room itself
 * does:
 *
 *   low-v wall (shared with bedA):      tub/shower, with a curtain across its open face
 *   low-u wall (shared with "unknown"): lavatory + mirror, then the WC, going up the
 *                                       wall from the tub's own corner
 *   high-v wall (shared with bedB):     a single radiator, clear of the WC
 *   high-u wall (the room's one door):  a towel rail, clear of the door's own leaf
 *
 * The one door (walls.ts's door("hall","bath",3)) sits on the high-u face, centred on
 * the room's own v-extent -- so at bathAlong's 6 ft minimum the leaf spans relative
 * v = [1.5, 4.5]. Every footprint below is sized and placed so the v-axis run (tub
 * depth + lavatory width + WC width = 5.5 ft) and the rail's own v-range (relative
 * [0.15, 1.25]) both clear that at 6 ft as well as at the shipped 7.5 ft default;
 * tests/fixtures.test.ts asserts the sum against BATH_ALONG_MIN directly rather than
 * trusting the arithmetic here.
 */

import type { Rect } from "./rooms";

export type FixturePart = {
  u: number;
  v: number;
  du: number;
  dv: number;
  y0: number;
  y1: number;
};

export type BathFixtures = {
  /** Tub, lavatory basin and pedestal, WC bowl and tank: porcelain, same merge as tile/wainscot. */
  porcelain: FixturePart[];
  /** Radiator and towel rail: the same oak-toned merge as door and window trim. */
  joinery: FixturePart[];
  /**
   * The shower curtain: the same porcelain merge as the tub it hangs on, not
   * glazing -- a translucent blue-tinted pane is right for a window and wrong for a
   * vinyl curtain; a plain pale panel reads closer to correct at no extra draw call
   * either way.
   */
  curtain: FixturePart[];
  /** The one part with a material of its own. */
  mirror: FixturePart[];
  /**
   * The plan footprints walk.ts's own collision should treat as solid, in the same
   * `{u,v,du,dv}` shape as a Solid there (no wallId -- that field only exists so a
   * clearance failure can name a wall, and a caller that wants one can synthesise it).
   * A subset of `porcelain`/`joinery`, by plan footprint rather than by array index:
   * the tub, the lavatory's own COUNTERTOP (its pedestal sits entirely inside that
   * same footprint, so the countertop alone covers both), the WC's own BOWL (its
   * tank likewise sits inside the bowl's footprint), and the radiator. Not the
   * mirror, the towel rail or the curtain -- all three are proud of a wall by a few
   * hundredths of a foot, well inside the reach a wall's own solid already keeps the
   * walker's disc clear of, so adding them would not change what the walker can
   * reach.
   */
  solid: FixturePart[];
};

/** Panel.tsx's own bound on both bathAlong and bathDeep. Not imported from there --
 *  this module has no reason to depend on the editing UI, only on the number itself. */
export const BATH_ALONG_MIN = 6;

const WALL_GAP = 0.05; // how proud of a wall face a wall-mounted part stands

const TUB_LEN = 5.0; // along the low-v wall (u axis) -- a standard 60 in alcove tub
const TUB_DEPTH = 2.3; // into the room (v axis) -- a standard ~28 in tub width, plus a hair
const TUB_H = 1.5;
const CURTAIN_H = 6.2;
const CURTAIN_T = 0.03;
const CURTAIN_Y0_FRAC = 0.25; // starts a quarter up the tub's own rim, not at the floor

const LAV_WIDTH = 1.7; // along the low-u wall (v axis)
const LAV_TOP_DEPTH = 1.6; // the countertop, into the room (u axis)
const LAV_BASE_DEPTH = 1.2; // the pedestal/cabinet under it, set back from the top's edge
const LAV_TOP_Y0 = 2.5;
const LAV_TOP_Y1 = 2.9;
const MIRROR_T = 0.03;
const MIRROR_Y0 = 3.3;
const MIRROR_Y1 = 5.9;

const WC_WIDTH = 1.5; // along the low-u wall (v axis)
const WC_DEPTH = 1.8; // into the room (u axis)
const WC_BOWL_H = 1.4;
const WC_TANK_W = 1.2; // narrower than the bowl footprint, centred on it
const WC_TANK_D = 0.35;
const WC_TANK_Y0 = 1.4;
const WC_TANK_Y1 = 2.8;

const RADIATOR_W = 2.0;
const RADIATOR_D = 0.4;
const RADIATOR_H = 2.2;
const RADIATOR_U0 = WC_DEPTH + 0.3; // clear of the WC's own footprint on the low-u wall

const RAIL_LEN = 1.1;
const RAIL_D = 0.12;
const RAIL_V0 = 0.15; // clear of the door's own leaf at bathAlong's 6 ft minimum -- see header
const RAIL_Y0 = 3.0;
const RAIL_Y1 = 3.15;

/**
 * Every fixture the bathroom gets, positioned off the bath Rect's own corner exactly
 * as bathWainscotSlab() already positions the wainscot -- `floor` is the same
 * floorLevel(1) value Suite.tsx threads through every other fixed part.
 */
export function bathFixtureParts(bath: Rect, floor: number): BathFixtures {
  const { u, v, du, dv } = bath;

  // --- the tub, low-v wall, and its curtain ---
  const tubU0 = u + WALL_GAP;
  const tub: FixturePart = { u: tubU0, v, du: TUB_LEN, dv: TUB_DEPTH, y0: floor, y1: floor + TUB_H };
  const curtain: FixturePart[] = [
    {
      u: tubU0,
      // Set back a hair from the tub's own open edge rather than proud of it, so the
      // curtain's thin slice stays inside the tub's own footprint instead of lapping
      // into the lavatory's -- a curtain rod and a pedestal do not actually collide at
      // this scale, but the geometry should not say they do either.
      v: v + TUB_DEPTH - CURTAIN_T,
      du: TUB_LEN,
      dv: CURTAIN_T,
      y0: floor + TUB_H * CURTAIN_Y0_FRAC,
      y1: floor + CURTAIN_H,
    },
  ];

  // --- lavatory + mirror, then the WC, going up the low-u wall from the tub's corner ---
  const lavV0 = v + TUB_DEPTH;
  const lavBase: FixturePart = {
    u,
    v: lavV0,
    du: LAV_BASE_DEPTH,
    dv: LAV_WIDTH,
    y0: floor,
    y1: floor + LAV_TOP_Y0 - 0.1,
  };
  // The countertop's own footprint is wider (u) than its pedestal's, so it alone is
  // what walk.ts needs for collision -- see BathFixtures.solid's own comment.
  const lavTop: FixturePart = {
    u,
    v: lavV0,
    du: LAV_TOP_DEPTH,
    dv: LAV_WIDTH,
    y0: floor + LAV_TOP_Y0,
    y1: floor + LAV_TOP_Y1,
  };
  const mirror: FixturePart[] = [
    { u: u + WALL_GAP, v: lavV0, du: MIRROR_T, dv: LAV_WIDTH, y0: floor + MIRROR_Y0, y1: floor + MIRROR_Y1 },
  ];

  const wcV0 = lavV0 + LAV_WIDTH;
  // The bowl's own footprint contains the tank's (narrower, set back the same amount
  // either side) -- see BathFixtures.solid's own comment.
  const wcBowl: FixturePart = { u, v: wcV0, du: WC_DEPTH, dv: WC_WIDTH, y0: floor, y1: floor + WC_BOWL_H };
  const wcTank: FixturePart = {
    u,
    v: wcV0 + (WC_WIDTH - WC_TANK_W) / 2,
    du: WC_TANK_D,
    dv: WC_TANK_W,
    y0: floor + WC_TANK_Y0,
    y1: floor + WC_TANK_Y1,
  };

  // --- the radiator, high-v wall, clear of the WC's own footprint ---
  const radiator: FixturePart = {
    u: u + RADIATOR_U0,
    v: v + dv - RADIATOR_D - WALL_GAP,
    du: RADIATOR_W,
    dv: RADIATOR_D,
    y0: floor,
    y1: floor + RADIATOR_H,
  };

  // --- the towel rail, high-u wall (the door's own wall) ---
  const rail: FixturePart = {
    u: u + du - WALL_GAP - RAIL_D,
    v: v + RAIL_V0,
    du: RAIL_D,
    dv: RAIL_LEN,
    y0: floor + RAIL_Y0,
    y1: floor + RAIL_Y1,
  };

  return {
    porcelain: [tub, lavBase, lavTop, wcBowl, wcTank],
    joinery: [radiator, rail],
    curtain,
    mirror,
    solid: [tub, lavTop, wcBowl, radiator],
  };
}

// --- ceiling fixtures and radiators for the suite's other rooms -- P14 row 11 ---
//
// Neither is sourced -- the 1875 text describes room dimensions and doors, never
// lighting or heat -- so both are ordinary present-day fittings, the same framing
// this file's own header already gives the bathroom's fixtures. Simpler than the
// bathroom's fit-out on purpose: these rooms are 10-20 ft across, not 6-8, so a
// single small fixture against one wall has no realistic chance of blocking the
// only way through it the way the bathroom's own fixtures could, and neither one
// is added to walk.ts's collision for that reason (bathFixtureSolids() stays
// bathroom-only).

/** Canopy footprint of a flush ceiling fixture, ft square. ASSUMED. */
const CEILING_FIXTURE_W = 1.2;
/** How far the fixture hangs below the ceiling plate, ft. ASSUMED. */
const CEILING_FIXTURE_H = 0.15;
/** Clear of the ceiling plate itself, so the two do not share a face. */
const CEILING_FIXTURE_GAP = 0.05;

/**
 * A flush ceiling fixture centred on a room, one per room. `ceilingY` is the
 * suite's own ceiling height (floor + params.ceiling, the same value Suite.tsx's
 * ceiling plate itself sits at) -- the fixture hangs just under it, not through it.
 */
export function ceilingFixturePart(room: Rect, ceilingY: number): FixturePart {
  const cu = room.u + room.du / 2;
  const cv = room.v + room.dv / 2;
  return {
    u: cu - CEILING_FIXTURE_W / 2,
    v: cv - CEILING_FIXTURE_W / 2,
    du: CEILING_FIXTURE_W,
    dv: CEILING_FIXTURE_W,
    y0: ceilingY - CEILING_FIXTURE_GAP - CEILING_FIXTURE_H,
    y1: ceilingY - CEILING_FIXTURE_GAP,
  };
}

/** A room radiator's footprint, ft -- smaller than the bathroom's, one per room. ASSUMED. */
const ROOM_RADIATOR_W = 2.5;
const ROOM_RADIATOR_D = 0.35;
const ROOM_RADIATOR_H = 2.0;
/** Proud of the facade wall it stands against. */
const ROOM_RADIATOR_GAP = 0.05;

/**
 * A radiator against a room's own facade wall (suite u = 0, every room's own
 * inward-from-the-facade origin -- rooms.ts's own header), centred on the room's
 * v-extent. Only meaningful for a room that actually has a facade wall to stand
 * against; callers filter by `room.windows.includes("facade")` themselves, the
 * same test rooms.ts's own data already uses to say which rooms are on it.
 */
export function roomRadiatorPart(room: Rect, floor: number): FixturePart {
  return {
    u: room.u + ROOM_RADIATOR_GAP,
    v: room.v + room.dv / 2 - ROOM_RADIATOR_W / 2,
    du: ROOM_RADIATOR_D,
    dv: ROOM_RADIATOR_W,
    y0: floor,
    y1: floor + ROOM_RADIATOR_H,
  };
}
