import { describe, it, expect } from "vitest";
import { trimParts, RAIL_H } from "@/geo/trim";

const ALONG = 20;
const CEILING = 10.75;
// A door at u 4..7, a window at u 12..16 whose head (9 ft) is above RAIL_H.
const DOOR_SPANS: [number, number][] = [
  [0, 4],
  [7, ALONG],
];
const RAIL_SPANS: [number, number][] = [
  [0, 12],
  [16, ALONG],
];

describe("trimParts()", () => {
  it("runs the baseboard everywhere except across a doorway", () => {
    const parts = trimParts(DOOR_SPANS, RAIL_SPANS, ALONG, CEILING).filter(
      (p) => p.y1 <= 0.62 + 1e-9,
    );
    const covered = parts.reduce((sum, p) => sum + p.du, 0);
    expect(covered).toBeCloseTo(ALONG - 3, 9); // the 4..7 door gap, 3 ft wide
    for (const p of parts) {
      // Never inside the door gap.
      expect(p.u >= 7 || p.u + p.du <= 4).toBe(true);
    }
  });

  it("runs the picture rail across a doorway, but not across a tall window", () => {
    const parts = trimParts(DOOR_SPANS, RAIL_SPANS, ALONG, CEILING).filter(
      (p) => Math.abs(p.y0 - RAIL_H) < 1e-9,
    );
    // Covers u 4..7 (the door), which the baseboard does not.
    expect(parts.some((p) => p.u <= 4 + 1e-9 && p.u + p.du >= 7 - 1e-9)).toBe(true);
    const covered = parts.reduce((sum, p) => sum + p.du, 0);
    expect(covered).toBeCloseTo(ALONG - 4, 9); // the 12..16 window gap, 4 ft wide
  });

  it("runs the cornice the wall's full length, undivided by either opening", () => {
    const cornice = trimParts(DOOR_SPANS, RAIL_SPANS, ALONG, CEILING).filter(
      (p) => p.material === "plaster",
    );
    expect(cornice).toHaveLength(1);
    expect(cornice[0]!.u).toBe(0);
    expect(cornice[0]!.du).toBe(ALONG);
    expect(cornice[0]!.y1).toBe(CEILING);
  });

  it("stands every piece proud of the wall face, into the room, never past it", () => {
    for (const p of trimParts(DOOR_SPANS, RAIL_SPANS, ALONG, CEILING)) {
      expect(p.v).toBeLessThan(0);
      expect(p.v + p.dv).toBeLessThanOrEqual(1e-9);
      expect(p.du).toBeGreaterThan(0);
      expect(p.dv).toBeGreaterThan(0);
      expect(p.y1).toBeGreaterThan(p.y0);
    }
  });

  it("keeps the baseboard below the rail, and the rail below the cornice", () => {
    const base = trimParts(DOOR_SPANS, RAIL_SPANS, ALONG, CEILING).filter((p) => p.y0 === 0);
    const rail = trimParts(DOOR_SPANS, RAIL_SPANS, ALONG, CEILING).filter(
      (p) => Math.abs(p.y0 - RAIL_H) < 1e-9,
    );
    const cornice = trimParts(DOOR_SPANS, RAIL_SPANS, ALONG, CEILING).filter(
      (p) => p.material === "plaster",
    );
    expect(Math.max(...base.map((p) => p.y1))).toBeLessThan(Math.min(...rail.map((p) => p.y0)));
    expect(Math.max(...rail.map((p) => p.y1))).toBeLessThan(cornice[0]!.y0);
  });
});
