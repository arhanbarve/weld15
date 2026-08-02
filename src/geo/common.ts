/**
 * Weld's own common parts: the west front loggia, the north stair hall, its
 * stair, and the corridor between that stair hall and the suite's own entry.
 *
 * WHERE THIS SITS IN THE PROJECT
 * Everything else that draws Weld is either the suite (rooms.ts/walls.ts, the
 * private rooms Weld 15's own params slide around) or the whole building's
 * shell (weldGeometry.ts, drawn once from weld.json and never subdivided).
 * This is the third thing: the parts of the building EVERY suite on this
 * floor shares -- the entrance, the stair, the corridor -- modelled once,
 * because the suite's own entry (walls.ts's d4) opens into it and P14 gives
 * that opening a real place to open onto rather than a wall of sky.
 *
 * FRAME
 * Building (u across, v along the 13.2 deg axis, frames.ts), the same frame
 * place.ts's own facadeStep() and the suite's own placement work in -- NOT
 * the suite frame, because these parts exist whether or not a suite param
 * ever moves, and outlive any one suite's own u/v origin.
 *
 * THE SOURCED CHAIN
 * weld.json's 1875 primary source gives the building's own 143 ft run as
 * five bays end to end: a 44 ft end section, a 15 x 31 ft stair hall, a
 * 25 ft central porch, another 15 x 31 ft stair hall, another 44 ft end
 * section (rooms.ts's own header already reads the building this way for the
 * suite's placement). The loggia's 25 ft measurement is the SAME 25 ft as
 * the chain's central porch -- the loggia is the porch's own west face, not
 * a separate span -- so `PORCH_V` below is shared between the two.
 *
 * WHAT IS ASSUMED
 * The 1875 text gives no riser or tread for the stair, no corridor width,
 * and no exact wall thickness for these parts -- flagged in the same voice
 * as furniture.ts's SIZES table, not smuggled in as fact. The chain and the
 * loggia/stair-hall footprints ARE sourced, and are kept separate from the
 * assumed figures for that reason.
 */

import weld from "@/data/weld.json";
import type { Building } from "./frames";
import { siteToBuilding } from "./frames";
import { GABLE_INNER_V, WELD } from "./place";
import type { SuiteParams } from "./rooms";
import { buildSuite } from "./rooms";
import { buildWalls } from "./walls";

/** A box in the building frame: footprint plus the vertical band it fills. */
export type Box = { u: number; v: number; du: number; dv: number; y0: number; y1: number };

// --- the sourced chain --------------------------------------------------

/** weld.json primary_source_1875: 44 + 15 + 25 + 15 + 44 = 143. */
const END_SECTION_FT = 44;
const STAIR_HALL_ALONG_FT = 15;
const PORCH_ALONG_FT = 25;

/** Building v of the north end section's south wall -- rooms.ts places the suite from here to GABLE_INNER_V. */
export const NORTH_END_V0 = GABLE_INNER_V - END_SECTION_FT;
/** Building v of the north stair hall's south wall. */
export const NORTH_STAIR_V0 = NORTH_END_V0 - STAIR_HALL_ALONG_FT;
/** Building v of the central porch's south wall (== the loggia's own span). */
export const PORCH_V0 = NORTH_STAIR_V0 - PORCH_ALONG_FT;

/** weld.json stair_hall_ft: [15, 31] -- 15 along the axis (the chain), 31 across it. */
const STAIR_HALL_ACROSS_FT = 31;

// --- the loggia ----------------------------------------------------------

/** weld.json main_entrance: "two arches into a 21 x 25 ft marble-paved loggia". */
export const LOGGIA_DEPTH_FT = 21;
export const LOGGIA_WIDTH_FT = PORCH_ALONG_FT;

/**
 * The ring in the building frame, closing vertex dropped -- the same
 * construction place.ts's own RING_B uses (that copy is private to place.ts;
 * duplicated rather than exported, since it is three lines and this module
 * already has to import weld.json and siteToBuilding for its own reasons).
 */
const RING_B: Building[] = (weld.rings[0] as number[][]).slice(0, -1).map((p) => siteToBuilding({ x: p[0]!, y: p[1]! }));

/**
 * How far Weld's real footprint reaches west of the centreline at a given v,
 * ft -- a ray cast against the ring, half-open so a line through a vertex
 * crosses once. Needed because the loggia sits on the west front at the
 * central porch/waist, where weld.json's own shape_note records the building
 * narrowing to "41-48 ft" -- CLEAR_HALF_U in place.ts is measured for the END
 * sections the suite occupies and is the wrong figure here, so this measures
 * the real wall directly rather than reusing a number sourced for a
 * different zone. Same crossing rule as place.ts's own facadeReachAt(),
 * reimplemented rather than imported because that function is private to
 * place.ts and west-only, single-use here.
 */
function westReachAt(v: number): number {
  let reach = -Infinity;
  for (let i = 0; i < RING_B.length; i++) {
    const a = RING_B[i]!;
    const c = RING_B[(i + 1) % RING_B.length]!;
    if (a.v > v === c.v > v) continue;
    const u = a.u + ((c.u - a.u) * (v - a.v)) / (c.v - a.v);
    reach = Math.max(reach, -u);
  }
  return reach;
}

/**
 * The loggia's floor, one box projecting west from Weld's real west wall at
 * the porch. `u1` (the wall itself) is measured off the ring at the porch's
 * own midpoint rather than assumed equal to the end sections' 24.5 ft half
 * width, which is the mistake the header's own note warns against.
 */
export function loggiaFootprint(floor: number): Box {
  const wallU = -westReachAt(PORCH_V0 + LOGGIA_WIDTH_FT / 2);
  return {
    u: wallU - LOGGIA_DEPTH_FT,
    v: PORCH_V0,
    du: LOGGIA_DEPTH_FT,
    dv: LOGGIA_WIDTH_FT,
    y0: 0,
    y1: floor,
  };
}

// --- the north stair hall --------------------------------------------------

/**
 * The stair hall's floor, centred on the building's own axis (u = 0) --
 * "central, top-lit by lanterns" per the 1875 text, and STAIR_HALL_ACROSS_FT
 * already gives its across-axis span, so centring it is the only placement
 * the source itself supports.
 */
export function stairHallFootprint(floor: number): Box {
  return {
    u: -STAIR_HALL_ACROSS_FT / 2,
    v: NORTH_STAIR_V0,
    du: STAIR_HALL_ACROSS_FT,
    dv: STAIR_HALL_ALONG_FT,
    y0: 0,
    y1: floor,
  };
}

// --- the stair itself -------------------------------------------------

/** One straight flight's worth of stair, as a run of riser boxes. ASSUMED riser/tread -- no source gives Weld's stair a dimension. */
const RISER_FT = 0.65;
const TREAD_FT = 1.0;
const RISERS_PER_FLIGHT = 10; // 10 * 0.65 = 6.5 ft ~= half of a 12 ft rise less landing thickness, ASSUMED
const STAIR_WIDTH_FT = 4; // ASSUMED, ordinary for a service stair of this width era
const LANDING_DEPTH_FT = 4; // ASSUMED

export type StairStep = Box;

/**
 * A dogleg stair inside the stair hall: one flight up, a half landing, a
 * second flight back, reaching `floorToFloor` overall. Modelled as a run of
 * riser-height boxes rather than a ramp, matching this project's own
 * "boxes, never a slope" convention elsewhere (walls.ts's lintels/sills).
 *
 * Placed against the stair hall's own north wall (nearest the suite this
 * project actually visits), running south for the first flight, landing,
 * then north back to grade level... i.e. the first flight climbs AWAY from
 * the suite and the second climbs back toward it, which is what a dogleg
 * inside a hall this shallow (15 ft along the axis) has to do: a single
 * straight flight covering a 12 ft rise at a 7 in riser is roughly 22 ft
 * along its own run, longer than the hall itself.
 */
export function stairSteps(floorToFloor: number): StairStep[] {
  const riser = floorToFloor / (RISERS_PER_FLIGHT * 2);
  const hall = stairHallFootprint(floorToFloor);
  const u0 = hall.u + (hall.du - STAIR_WIDTH_FT) / 2;
  const out: StairStep[] = [];

  // First flight: climbs south to north -> south, treads stacking toward
  // increasing height as v decreases from the hall's north wall.
  let v = hall.v + hall.dv;
  for (let i = 0; i < RISERS_PER_FLIGHT; i++) {
    v -= TREAD_FT;
    out.push({ u: u0, v, du: STAIR_WIDTH_FT, dv: TREAD_FT, y0: 0, y1: riser * (i + 1) });
  }
  const landingY = riser * RISERS_PER_FLIGHT;
  v -= LANDING_DEPTH_FT;
  out.push({ u: u0, v, du: STAIR_WIDTH_FT, dv: LANDING_DEPTH_FT, y0: 0, y1: landingY });

  // Second flight climbs back north, finishing at the floor above.
  for (let i = 0; i < RISERS_PER_FLIGHT; i++) {
    v -= TREAD_FT;
    out.push({ u: u0, v, du: STAIR_WIDTH_FT, dv: TREAD_FT, y0: 0, y1: landingY + riser * (i + 1) });
  }
  return out;
}

// --- the spine corridor -------------------------------------------------

/** ASSUMED corridor width, ft -- no source gives one; centred on the axis, as the stair hall is. */
const CORRIDOR_WIDTH_FT = 6;

/**
 * The corridor between the stair hall and the suite's own entry door,
 * running along v at a fixed width centred on u = 0.
 *
 * `entryV` is the building-v of the suite's entry opening -- measured from
 * the actual suite params via suiteEntryBuildingV() below, NOT assumed equal
 * to the section boundary, because the entry sits partway up the hall
 * (walls.ts's buildOpenings() offsets it `hall.v - inner.v + 1`), not at the
 * section's own south wall.
 */
export function corridorFootprint(entryV: number, floor: number): Box {
  const v0 = NORTH_STAIR_V0 + STAIR_HALL_ALONG_FT; // stair hall's own north wall
  return {
    u: -CORRIDOR_WIDTH_FT / 2,
    v: Math.min(v0, entryV),
    du: CORRIDOR_WIDTH_FT,
    dv: Math.abs(entryV - v0),
    y0: 0,
    y1: floor,
  };
}

/**
 * The building-v of the suite's own entry door, for corridorFootprint()'s
 * `entryV`. Rebuilds the suite and its walls to find d4 -- the one opening
 * `buildOpenings()` (walls.ts) connects to "outside" -- and converts its
 * along-band position to a suite-v, then to building-v via suiteToBuilding()'s
 * own v formula (place.ts): `GABLE_INNER_V - (sectionLength - sv)`.
 *
 * NOT exported as a constant: it depends on params (hallWidth, sectionLength,
 * legDepth all move it), and the whole point of measuring it here rather than
 * assuming the section boundary is that a slider can move it.
 */
export function suiteEntryBuildingV(params: SuiteParams): number {
  const suite = buildSuite(params);
  const { walls, openings } = buildWalls(suite);
  const entry = openings.find((o) => o.kind === "door" && o.connects[1] === "outside");
  if (!entry) throw new Error("common: no suite entry (hall -> outside) opening found");
  const wall = walls.find((w) => w.id === entry.wallId);
  if (!wall) throw new Error("common: entry opening names a wall that does not exist");
  // The entry's wall is the hall's inner (party) wall, which runs along v (its
  // own dv is its length) -- so the opening's along-axis offset maps directly
  // onto suite v, the same way buildOpenings() itself measured it.
  const sv = wall.v + entry.offset + entry.width / 2;
  return GABLE_INNER_V - (params.sectionLength - sv);
}

/** Storeys above grade the stair hall's own floor sits at -- ground floor door hardware, one flight up. */
export const FLOOR_TO_FLOOR_FT = WELD.floorToFloor;
