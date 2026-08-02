import { describe, it, expect } from "vitest";
import {
  bathFixtureParts,
  ceilingFixturePart,
  roomRadiatorPart,
  BATH_ALONG_MIN,
  type FixturePart,
} from "@/geo/fixtures";
import { buildSuite, DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import { floorLevel } from "@/geo/place";

const FLOOR = floorLevel(1);
const EPS = 1e-9;

/** All parts across every category, in one flat list, for a whole-fixture-out sweep. */
function allParts(bath: ReturnType<typeof bathFixtureParts>): FixturePart[] {
  return [...bath.porcelain, ...bath.joinery, ...bath.curtain, ...bath.mirror];
}

function bathRoomOf(params: SuiteParams) {
  const suite = buildSuite(params);
  return suite.rooms.find((r) => r.kind === "bath")!;
}

/** The door's own real-world v-span on the bath's high-u wall, from buildWalls() directly
 *  rather than from the header's own restated formula -- this is the check that would
 *  catch the formula and the geometry disagreeing. */
function doorSpan(params: SuiteParams): [number, number] {
  const suite = buildSuite(params);
  const { walls, openings } = buildWalls(suite);
  const entry = openings.find(
    (o) => o.kind === "door" && (o.connects[0] === "bath" || o.connects[1] === "bath"),
  )!;
  const wall = walls.find((w) => w.id === entry.wallId)!;
  return [wall.v + entry.offset, wall.v + entry.offset + entry.width];
}

describe("bathFixtureParts", () => {
  it("returns something in every category at the shipped defaults", () => {
    const bath = bathRoomOf(DEFAULT_PARAMS);
    const f = bathFixtureParts(bath, FLOOR);
    expect(f.porcelain.length).toBeGreaterThan(0);
    expect(f.joinery.length).toBeGreaterThan(0);
    expect(f.curtain.length).toBeGreaterThan(0);
    expect(f.mirror.length).toBeGreaterThan(0);
  });

  it("matches Panel.tsx's own bound on bathAlong and bathDeep", () => {
    expect(BATH_ALONG_MIN).toBe(6);
  });

  for (const [label, patch] of [
    ["shipped defaults", {}],
    ["bathAlong and bathDeep both at their 6 ft minimum", { bathAlong: 6, bathDeep: 6 }],
    ["bathAlong and bathDeep both at their 8 ft maximum", { bathAlong: 8, bathDeep: 8 }],
  ] as const) {
    it(`every part stays inside the room's own footprint, at ${label}`, () => {
      const params = { ...DEFAULT_PARAMS, ...patch };
      const bath = bathRoomOf(params);
      const f = bathFixtureParts(bath, FLOOR);
      for (const p of allParts(f)) {
        expect(p.u, `${label}: u lo`).toBeGreaterThanOrEqual(bath.u - EPS);
        expect(p.u + p.du, `${label}: u hi`).toBeLessThanOrEqual(bath.u + bath.du + EPS);
        expect(p.v, `${label}: v lo`).toBeGreaterThanOrEqual(bath.v - EPS);
        expect(p.v + p.dv, `${label}: v hi`).toBeLessThanOrEqual(bath.v + bath.dv + EPS);
        expect(p.du, `${label}: positive du`).toBeGreaterThan(0);
        expect(p.dv, `${label}: positive dv`).toBeGreaterThan(0);
        expect(p.y1, `${label}: y1 above y0`).toBeGreaterThan(p.y0);
      }
    });

    it(`the towel rail clears the door's own leaf, at ${label}`, () => {
      const params = { ...DEFAULT_PARAMS, ...patch };
      const bath = bathRoomOf(params);
      const f = bathFixtureParts(bath, FLOOR);
      const rail = f.joinery[f.joinery.length - 1]!; // pushed last, see bathFixtureParts()
      const [doorLo, doorHi] = doorSpan(params);
      const clear = rail.v + rail.dv <= doorLo + EPS || rail.v >= doorHi - EPS;
      expect(clear, `${label}: rail [${rail.v}, ${rail.v + rail.dv}] vs door [${doorLo}, ${doorHi}]`).toBe(
        true,
      );
    });
  }

  it("the tub, lavatory and WC run does not exceed bathAlong's own 6 ft minimum", () => {
    // The header's own arithmetic claim, asserted directly rather than trusted: sum the
    // v-extent of every low-u/low-v-wall part and check it against the tightest room
    // this project's own slider can ever produce.
    const bath = bathRoomOf({ ...DEFAULT_PARAMS, bathAlong: BATH_ALONG_MIN, bathDeep: 6 });
    const f = bathFixtureParts(bath, FLOOR);
    const vHigh = Math.max(...f.porcelain.map((p) => p.v + p.dv));
    expect(vHigh).toBeLessThanOrEqual(bath.v + BATH_ALONG_MIN + EPS);
  });

  it("no two fixtures occupy the same footprint, except the two deliberate ones", () => {
    const bath = bathRoomOf(DEFAULT_PARAMS);
    const f = bathFixtureParts(bath, FLOOR);
    /** Two boxes collide only if they overlap in plan (u, v) AND in height (y). */
    const overlapsInPlan = (a: FixturePart, b: FixturePart) => {
      const sep = a.u + a.du <= b.u + EPS || b.u + b.du <= a.u + EPS || a.v + a.dv <= b.v + EPS || b.v + b.dv <= a.v + EPS;
      if (sep) return false;
      return a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS;
    };
    // Two pairs overlap by design, not by accident: the lavatory's countertop stands
    // directly over its own pedestal, and the curtain drapes over the tub's own rim (it
    // was deliberately pulled back from the tub's open edge to sit ON the tub rather
    // than proud past it into the lavatory's own footprint). Every other pair should be
    // clear of every other, keyed by object identity rather than array index so a
    // reordering of bathFixtureParts()'s pushes cannot silently stop checking the right
    // pair.
    const tub = f.porcelain[0]!;
    const pedestal = f.porcelain[1]!;
    const lavTop = f.porcelain[2]!;
    const curtain = f.curtain[0]!;
    const isExpectedPair = (a: FixturePart, b: FixturePart) =>
      (a === pedestal && b === lavTop) ||
      (a === lavTop && b === pedestal) ||
      (a === tub && b === curtain) ||
      (a === curtain && b === tub);
    const parts = allParts(f);
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]!;
        const b = parts[j]!;
        if (isExpectedPair(a, b)) continue;
        expect(overlapsInPlan(a, b), `part ${i} and part ${j} collide`).toBe(false);
      }
    }
  });
});

describe("ceilingFixturePart", () => {
  it("centres a square canopy on the room, hanging just under the ceiling", () => {
    const suite = buildSuite(DEFAULT_PARAMS);
    const bedA = suite.rooms.find((r) => r.id === "bedA")!;
    const ceilingY = FLOOR + DEFAULT_PARAMS.ceiling;
    const p = ceilingFixturePart(bedA, ceilingY);
    expect(p.u + p.du / 2).toBeCloseTo(bedA.u + bedA.du / 2, 9);
    expect(p.v + p.dv / 2).toBeCloseTo(bedA.v + bedA.dv / 2, 9);
    expect(p.du).toBeCloseTo(p.dv, 9); // square
    expect(p.y1).toBeLessThanOrEqual(ceilingY);
    expect(p.y0).toBeLessThan(p.y1);
  });

  it("stays inside every room it is asked for, across every room kind", () => {
    const suite = buildSuite(DEFAULT_PARAMS);
    const ceilingY = FLOOR + DEFAULT_PARAMS.ceiling;
    for (const r of suite.rooms) {
      const p = ceilingFixturePart(r, ceilingY);
      expect(p.u, r.id).toBeGreaterThanOrEqual(r.u - EPS);
      expect(p.u + p.du, r.id).toBeLessThanOrEqual(r.u + r.du + EPS);
      expect(p.v, r.id).toBeGreaterThanOrEqual(r.v - EPS);
      expect(p.v + p.dv, r.id).toBeLessThanOrEqual(r.v + r.dv + EPS);
    }
  });
});

describe("roomRadiatorPart", () => {
  it("stands against the room's own facade wall (suite u = 0's own side), centred in v", () => {
    const suite = buildSuite(DEFAULT_PARAMS);
    const bedA = suite.rooms.find((r) => r.id === "bedA")!;
    expect(bedA.windows).toContain("facade");
    const p = roomRadiatorPart(bedA, FLOOR);
    expect(p.u).toBeGreaterThanOrEqual(bedA.u);
    expect(p.u + p.du).toBeLessThan(bedA.u + bedA.du); // does not reach across the room
    expect(p.v + p.dv / 2).toBeCloseTo(bedA.v + bedA.dv / 2, 9);
    expect(p.y0).toBeCloseTo(FLOOR, 9);
    expect(p.y1).toBeGreaterThan(p.y0);
  });

  it("stays inside every facade room it is asked for", () => {
    const suite = buildSuite(DEFAULT_PARAMS);
    for (const r of suite.rooms.filter((r) => r.windows.includes("facade"))) {
      const p = roomRadiatorPart(r, FLOOR);
      expect(p.u, r.id).toBeGreaterThanOrEqual(r.u - EPS);
      expect(p.u + p.du, r.id).toBeLessThanOrEqual(r.u + r.du + EPS);
      expect(p.v, r.id).toBeGreaterThanOrEqual(r.v - EPS);
      expect(p.v + p.dv, r.id).toBeLessThanOrEqual(r.v + r.dv + EPS);
    }
  });
});
