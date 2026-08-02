import { describe, it, expect } from "vitest";
import {
  NORTH_END_V0,
  NORTH_STAIR_V0,
  PORCH_V0,
  LOGGIA_DEPTH_FT,
  LOGGIA_WIDTH_FT,
  loggiaFootprint,
  stairHallFootprint,
  stairSteps,
  corridorFootprint,
  suiteEntryBuildingV,
  suiteEntryStandingPositions,
  FLOOR_TO_FLOOR_FT,
} from "@/geo/common";
import { DEFAULT_PARAMS, buildSuite } from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import { GABLE_INNER_V, CLEAR_HALF_U } from "@/geo/place";
import weld from "@/data/weld.json";

const EPS = 1e-6;

describe("the sourced chain", () => {
  it("derives each boundary from the one before it by exactly the named span", () => {
    expect(NORTH_END_V0).toBeCloseTo(GABLE_INNER_V - 44, 9);
    expect(NORTH_STAIR_V0).toBeCloseTo(NORTH_END_V0 - 15, 9);
    expect(PORCH_V0).toBeCloseTo(NORTH_STAIR_V0 - 25, 9);
  });

  it("matches the 1875 text's own five-part total for the length weld.json separately measured off the GIS ring", () => {
    // NOT a claim that continuing the chain south of the porch lands exactly
    // on -GABLE_INNER_V: the 1875 text's 44+15+25+15+44 sums to the EXTERIOR
    // 143 ft in extreme_dimensions_ft (weld.json's own primary source), while
    // GABLE_INNER_V is an INTERIOR figure (exterior length minus one
    // masonry thickness); doubling an interior half does not recover an
    // exterior total, and this module never relies on the chain reaching the
    // south gable -- only the north-side boundaries rooms.ts already uses.
    expect(weld.meta.primary_source_1875.extreme_dimensions_ft[0]).toBe(143);
    expect(44 + 15 + 25 + 15 + 44).toBe(143);
  });

  it("puts the suite's own north end section exactly where rooms.ts already says it is", () => {
    // rooms.ts's own header: "our suite occupies the north end section, so
    // its v = 0 lies 44 ft south of the gable's interior face". At the
    // default sectionLength (44), suite v=0 IS the north end section's own
    // south wall.
    expect(NORTH_END_V0).toBeCloseTo(GABLE_INNER_V - DEFAULT_PARAMS.sectionLength, 9);
  });
});

describe("the loggia", () => {
  it("is 25 ft wide, the same 25 ft as the chain's central porch", () => {
    expect(LOGGIA_WIDTH_FT).toBe(25);
  });

  it("is 21 ft deep, per weld.json's own main_entrance figure", () => {
    expect(LOGGIA_DEPTH_FT).toBe(21);
    expect(weld.meta.primary_source_1875.main_entrance).toContain("21 x 25");
  });

  it("sits west of Weld's real west wall at the porch, not at the end sections' wider figure", () => {
    const floor = 12;
    const loggia = loggiaFootprint(floor);
    // The building's own shape_note: "NARROW waist of 41-48 ft in the middle"
    // -- so the west wall here should be well inboard of the end sections'
    // 24.5 ft half-width (CLEAR_HALF_U), i.e. this measured a DIFFERENT,
    // narrower figure rather than reusing the wrong one. West is negative u,
    // so "inboard of 24.5" and "further than half the waist floor" both
    // constrain the MAGNITUDE, in opposite directions on the signed value.
    const wallU = loggia.u + loggia.du;
    expect(wallU).toBeGreaterThan(-24.5);
    expect(wallU).toBeLessThan(-15); // half of 41 ft waist, generous floor
    expect(loggia.dv).toBe(LOGGIA_WIDTH_FT);
    expect(loggia.v).toBe(PORCH_V0);
    expect(loggia.y1).toBe(floor);
  });

  it("spans the same v range as the chain's porch, centred there", () => {
    const loggia = loggiaFootprint(12);
    expect(loggia.v).toBeCloseTo(PORCH_V0, 9);
    expect(loggia.v + loggia.dv).toBeCloseTo(PORCH_V0 + 25, 9);
  });
});

describe("the north stair hall", () => {
  it("is 15 x 31 ft, per weld.json's own stair_hall_ft", () => {
    const hall = stairHallFootprint(12);
    expect(hall.dv).toBe(15);
    expect(hall.du).toBe(31);
  });

  it("is centred on the building's own axis, per '\"central\"' in the source", () => {
    const hall = stairHallFootprint(12);
    expect(hall.u + hall.du / 2).toBeCloseTo(0, 9);
  });

  it("sits immediately south of the suite's own north end section", () => {
    const hall = stairHallFootprint(12);
    expect(hall.v + hall.dv).toBeCloseTo(NORTH_END_V0, 9);
  });
});

describe("the stair", () => {
  const steps = stairSteps(FLOOR_TO_FLOOR_FT);

  it("reaches the full floor-to-floor rise, and only that", () => {
    const top = Math.max(...steps.map((s) => s.y1));
    expect(top).toBeCloseTo(FLOOR_TO_FLOOR_FT, 6);
    expect(FLOOR_TO_FLOOR_FT).toBe(weld.meta.floor_to_floor_ft);
  });

  it("climbs monotonically -- every step at least as high as the one before it", () => {
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.y1).toBeGreaterThanOrEqual(steps[i - 1]!.y1 - EPS);
    }
  });

  it("stays within the stair hall's own footprint, across the axis", () => {
    const hall = stairHallFootprint(FLOOR_TO_FLOOR_FT);
    for (const s of steps) {
      expect(s.u).toBeGreaterThanOrEqual(hall.u - EPS);
      expect(s.u + s.du).toBeLessThanOrEqual(hall.u + hall.du + EPS);
    }
  });

  it("has no zero-or-negative extent step", () => {
    for (const s of steps) {
      expect(s.du).toBeGreaterThan(0);
      expect(s.dv).toBeGreaterThan(0);
      expect(s.y1).toBeGreaterThan(s.y0);
    }
  });
});

describe("the suite entry, in building terms", () => {
  it("sits inside the suite's own north end section, not at its boundary", () => {
    const v = suiteEntryBuildingV(DEFAULT_PARAMS);
    // rooms.ts places the suite from NORTH_END_V0 to GABLE_INNER_V; the entry
    // is partway up the hall (buildOpenings() offsets it 1 ft north of the
    // hall's own south wall), so it must be strictly inside that range, not
    // coincident with either end.
    expect(v).toBeGreaterThan(NORTH_END_V0);
    expect(v).toBeLessThan(GABLE_INNER_V);
  });

  it("moves when a slider that affects the hall's own position moves", () => {
    // NOT hallWidth: that slider moves the hall's u (how deep it reaches),
    // never its v -- d4's suite-v comes from hallV0 (commonAlong + partition)
    // and from sectionLength directly, neither of which hallWidth touches.
    // commonAlong shifts hallV0 itself, so it is the one that has to move
    // this.
    const a = suiteEntryBuildingV(DEFAULT_PARAMS);
    const b = suiteEntryBuildingV({ ...DEFAULT_PARAMS, commonAlong: DEFAULT_PARAMS.commonAlong + 1 });
    expect(a).not.toBeCloseTo(b, 3);
  });

  it("lands inside the actual d4 opening's own width, not just somewhere plausible", () => {
    // Independent of suiteEntryBuildingV()'s own internals: build the suite's
    // walls directly, find d4 by name, and check the reported v falls inside
    // that opening's real span rather than merely inside the section.
    const suite = buildSuite(DEFAULT_PARAMS);
    const { walls, openings } = buildWalls(suite);
    const entry = openings.find((o) => o.kind === "door" && o.connects[1] === "outside")!;
    const wall = walls.find((w) => w.id === entry.wallId)!;
    const svLo = wall.v + entry.offset;
    const svHi = svLo + entry.width;
    const buildingVLo = GABLE_INNER_V - (DEFAULT_PARAMS.sectionLength - svLo);
    const buildingVHi = GABLE_INNER_V - (DEFAULT_PARAMS.sectionLength - svHi);
    const v = suiteEntryBuildingV(DEFAULT_PARAMS);
    expect(v).toBeGreaterThanOrEqual(Math.min(buildingVLo, buildingVHi) - EPS);
    expect(v).toBeLessThanOrEqual(Math.max(buildingVLo, buildingVHi) + EPS);
  });
});

describe("the spine corridor", () => {
  it("runs from the stair hall's own north wall to the suite's entry, and no further", () => {
    const entryV = suiteEntryBuildingV(DEFAULT_PARAMS);
    const hall = stairHallFootprint(12);
    const corridor = corridorFootprint(entryV, 12);
    const hallNorthWall = hall.v + hall.dv;
    expect(Math.min(corridor.v, corridor.v + corridor.dv)).toBeCloseTo(
      Math.min(hallNorthWall, entryV),
      6,
    );
    expect(Math.max(corridor.v, corridor.v + corridor.dv)).toBeCloseTo(
      Math.max(hallNorthWall, entryV),
      6,
    );
  });

  it("is centred on the building's own axis, matching the stair hall it connects to", () => {
    const corridor = corridorFootprint(suiteEntryBuildingV(DEFAULT_PARAMS), 12);
    expect(corridor.u + corridor.du / 2).toBeCloseTo(0, 9);
  });

  it("has a real, positive length at the shipped params", () => {
    const corridor = corridorFootprint(suiteEntryBuildingV(DEFAULT_PARAMS), 12);
    expect(corridor.dv).toBeGreaterThan(5);
    expect(corridor.dv).toBeLessThan(40);
  });
});

describe("the entry's standing positions", () => {
  it("puts the hall side and corridor side one standoff clear of each of the wall's own two faces", () => {
    const { hallSide, corridorSide } = suiteEntryStandingPositions(DEFAULT_PARAMS);
    // hallSide is suite-frame; convert corridorSide (building-frame) back
    // through suiteToBuilding's own inverse (place.ts's formula, re-derived
    // here rather than imported, so this checks the actual relationship
    // rather than reusing the same code path suiteEntryStandingPositions()
    // itself used) to compare both sides in ONE frame.
    const east = DEFAULT_PARAMS.facade === "east";
    const corridorAsSuiteU = east ? CLEAR_HALF_U - corridorSide.u : corridorSide.u + CLEAR_HALF_U;
    // The two standoffs are measured from the wall's own two faces, which
    // are the wall's thickness (0.5 ft here) apart -- so the u distance
    // between the two standing positions is 2 * standoff (1 ft) PLUS that
    // thickness, not 2 ft on its own. The suite's own wall thickness is a
    // param (params.partition), so it is read from the suite's own wall
    // rather than assumed.
    const suite = buildSuite(DEFAULT_PARAMS);
    const { walls, openings } = buildWalls(suite);
    const entry = openings.find((o) => o.kind === "door" && o.connects[1] === "outside")!;
    const wall = walls.find((w) => w.id === entry.wallId)!;
    expect(Math.abs(corridorAsSuiteU - hallSide.u)).toBeCloseTo(2 + wall.du, 6);
  });

  it("agrees with corridorFootprint()'s own entryV on where the corridor side sits", () => {
    const { corridorSide } = suiteEntryStandingPositions(DEFAULT_PARAMS);
    const entryV = suiteEntryBuildingV(DEFAULT_PARAMS);
    expect(corridorSide.v).toBeCloseTo(entryV, 6);
  });

  it("puts the hall side inside the hall's own footprint", () => {
    const suite = buildSuite(DEFAULT_PARAMS);
    const hall = suite.rooms.find((r) => r.id === "hall")!;
    const { hallSide } = suiteEntryStandingPositions(DEFAULT_PARAMS);
    expect(hallSide.u).toBeGreaterThanOrEqual(hall.u);
    expect(hallSide.u).toBeLessThanOrEqual(hall.u + hall.du);
    expect(hallSide.v).toBeGreaterThanOrEqual(hall.v);
    expect(hallSide.v).toBeLessThanOrEqual(hall.v + hall.dv);
  });
});
