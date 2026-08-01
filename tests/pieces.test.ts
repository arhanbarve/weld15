import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import { SIZES, type FurnitureKind } from "@/geo/furniture";
import { partsOf, drawnHeight } from "@/geo/pieces";

const KINDS = Object.keys(SIZES) as FurnitureKind[];
const EPS = 1e-9;

describe("partsOf() stays inside the footprint SIZES[kind] declares", () => {
  for (const kind of KINDS) {
    it(`${kind}: every part is contained in plan, and no extent is zero or negative`, () => {
      const { du, dv } = SIZES[kind];
      const parts = partsOf(kind);
      expect(parts.length).toBeGreaterThan(0);
      for (const p of parts) {
        expect(p.du).toBeGreaterThan(0);
        expect(p.dv).toBeGreaterThan(0);
        expect(p.y1).toBeGreaterThan(p.y0);
        expect(p.u).toBeGreaterThanOrEqual(-EPS);
        expect(p.v).toBeGreaterThanOrEqual(-EPS);
        expect(p.u + p.du).toBeLessThanOrEqual(du + EPS);
        expect(p.v + p.dv).toBeLessThanOrEqual(dv + EPS);
      }
    });
  }
});

describe("drawnHeight()", () => {
  it("exceeds the declared frame height for the bed alone", () => {
    expect(drawnHeight("bed")).toBeGreaterThan(SIZES.bed.h);
  });

  for (const kind of KINDS.filter((k) => k !== "bed")) {
    it(`${kind}: matches the declared height, since nothing rises past it`, () => {
      expect(drawnHeight(kind)).toBeCloseTo(SIZES[kind].h, 6);
    });
  }

  for (const kind of KINDS) {
    it(`${kind}: stays well under the suite's 10.75 ft ceiling`, () => {
      expect(drawnHeight(kind)).toBeLessThan(DEFAULT_PARAMS.ceiling);
    });
  }
});

describe("parts occupy a plausible fraction of the piece's bounding volume", () => {
  // A solid block would fail the upper bound; the pre-A1a state -- one box
  // per piece -- is exactly that failure. An empty table fails the lower
  // bound. Both ends are real defects, not arbitrary thresholds.
  for (const kind of KINDS) {
    it(`${kind}: between 8% and 65%`, () => {
      const { du, dv } = SIZES[kind];
      const h = drawnHeight(kind);
      const bbox = du * dv * h;
      const filled = partsOf(kind).reduce(
        (sum, p) => sum + p.du * p.dv * (p.y1 - p.y0),
        0,
      );
      const fraction = filled / bbox;
      expect(fraction).toBeGreaterThan(0.08);
      expect(fraction).toBeLessThan(0.65);
    });
  }
});
