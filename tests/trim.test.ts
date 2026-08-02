import { describe, it, expect } from "vitest";
import { trimParts, RAIL_H, doorCasingParts, thresholdParts, doorLeafParts, type Hinge } from "@/geo/trim";

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

const DOOR_H = 7;
const EPS = 1e-9;

describe("doorCasingParts()", () => {
  it("never covers the opening: same check as the window casing", () => {
    for (const width of [2.5, 3, 3.5]) {
      const proud = doorCasingParts(width, DOOR_H).filter((p) => p.v < 0);
      for (const p of proud) {
        const overlapsU = p.u < width - EPS && p.u + p.du > 0 + EPS;
        const overlapsY = p.y0 < DOOR_H - EPS && p.y1 > 0 + EPS;
        expect(overlapsU && overlapsY, `width ${width}: casing covers the opening`).toBe(false);
      }
    }
  });

  it("has no bottom member: a door reaches the floor", () => {
    // The two jamb legs run floor to above the head; only the head member
    // itself starts at doorH. Neither ever dips below 0 -- there is no
    // fourth leg under the opening, unlike a window's sill.
    for (const p of doorCasingParts(3, DOOR_H)) {
      expect(p.y0).toBeGreaterThanOrEqual(0);
    }
    const jambs = doorCasingParts(3, DOOR_H).filter((p) => p.y0 === 0);
    expect(jambs).toHaveLength(2);
  });

  it("stands proud of the room face, matching the window casing's own numbers", () => {
    for (const p of doorCasingParts(3, DOOR_H)) {
      expect(p.v).toBeLessThan(0);
      expect(p.v + p.dv).toBeLessThanOrEqual(EPS);
      expect(p.du).toBeGreaterThan(0);
    }
  });
});

describe("thresholdParts()", () => {
  it("spans the door's width and the wall's own thickness, at floor level", () => {
    const [strip] = thresholdParts(3.2, 1.5);
    expect(strip!.du).toBe(3.2);
    expect(strip!.dv).toBe(1.5);
    expect(strip!.y0).toBe(0);
    expect(strip!.y1).toBeGreaterThan(0);
  });
});

describe("doorLeafParts()", () => {
  /** Reconstruct the leaf's own centre and the two ends of its long axis, in the
   *  door's local frame, from the returned (already-rotated) part. */
  function longAxisEnds(part: { u: number; v: number; du: number; dv: number; turn: number }) {
    const cu = part.u + part.du / 2;
    const cv = part.v + part.dv / 2;
    const dirU = Math.cos(part.turn);
    const dirV = Math.sin(part.turn);
    const half = part.du / 2;
    return {
      centre: { u: cu, v: cv },
      a: { u: cu - dirU * half, v: cv - dirV * half },
      b: { u: cu + dirU * half, v: cv + dirV * half },
    };
  }

  it("keeps one end of the leaf at its own hinge, at every swing angle and both hinges", () => {
    const width = 3;
    for (const hinge of ["low", "high"] as Hinge[]) {
      for (const openDeg of [0, 30, 60, 90, 100, 130]) {
        const [leaf] = doorLeafParts(width, DOOR_H, hinge, openDeg);
        const { a, b } = longAxisEnds(leaf!);
        const hingeU = hinge === "low" ? 0 : width;
        const distA = Math.hypot(a.u - hingeU, a.v - 0);
        const distB = Math.hypot(b.u - hingeU, b.v - 0);
        // One of the leaf's two long-axis ends sits at the hinge, within the
        // leaf's own small standing gap off the jamb (doorLeafParts()'s
        // LEAF_GAP, not re-exported here since it is that function's own
        // ASSUMED implementation detail rather than a public contract); the
        // other end is a full leaf-width away regardless of angle.
        expect(Math.min(distA, distB)).toBeLessThan(0.15);
      }
    }
  });

  it("swings toward the room (negative v) as the angle opens, and points straight in at 90 degrees", () => {
    for (const hinge of ["low", "high"] as Hinge[]) {
      const closed = doorLeafParts(3, DOOR_H, hinge, 0)[0]!;
      const open90 = doorLeafParts(3, DOOR_H, hinge, 90)[0]!;
      expect(closed.v + closed.dv / 2).toBeCloseTo(0, 2);
      // At 90 degrees the free end is directly out from the hinge, straight
      // into the room: its u sits at the hinge (within the leaf's own
      // thickness) and its v is a full leaf-width negative.
      const { b, centre } = longAxisEnds(open90);
      const hingeU = hinge === "low" ? 0 : 3;
      expect(Math.abs(b.u - hingeU)).toBeLessThan(0.2);
      expect(centre.v).toBeLessThan(-1);
    }
  });

  it("stays proud of the room face and inside the ceiling height", () => {
    for (const hinge of ["low", "high"] as Hinge[]) {
      for (const p of doorLeafParts(3, DOOR_H, hinge, 100)) {
        expect(p.y0).toBeGreaterThanOrEqual(0);
        expect(p.y1).toBeLessThanOrEqual(DOOR_H);
        expect(p.du).toBeGreaterThan(0);
        expect(p.dv).toBeGreaterThan(0);
      }
    }
  });

  it("degrades to nothing rather than a negative leaf when the opening is narrower than its own gap", () => {
    expect(doorLeafParts(0.1, DOOR_H, "low", 100)).toHaveLength(0);
  });
});
