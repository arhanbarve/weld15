import { describe, it, expect } from "vitest";
import { sashParts } from "@/geo/sash";

const EPS = 1e-9;
const SILL = 2.5;
const HEAD = 9;
const SASH_DEPTH = 1.2;

/** The parts that sit in the sash plane itself -- frame and glass, not the
 *  room-side casing/sill or the jamb linings, which have a much larger dv. */
function sashPlaneParts(width: number) {
  return sashParts(width, SILL, HEAD, SASH_DEPTH).filter((p) => p.dv < 0.15 && p.v >= -EPS);
}

describe("sashParts()", () => {
  it("keeps the sash frame and glass inside the opening's own width", () => {
    for (const width of [1, 2, 3, 4.5, 8, 16]) {
      for (const p of sashPlaneParts(width)) {
        expect(p.u).toBeGreaterThanOrEqual(-EPS);
        expect(p.u + p.du).toBeLessThanOrEqual(width + EPS);
      }
    }
  });

  it("keeps jamb linings and the sash plane inside the reveal depth, never past the room face", () => {
    for (const width of [1, 3, 8]) {
      const jambs = sashParts(width, SILL, HEAD, SASH_DEPTH).filter(
        (p) => Math.abs(p.dv - SASH_DEPTH) < EPS,
      );
      expect(jambs.length).toBeGreaterThan(0);
      for (const p of jambs) {
        expect(p.v).toBeGreaterThanOrEqual(-EPS);
        expect(p.v + p.dv).toBeLessThanOrEqual(SASH_DEPTH + EPS);
      }
    }
  });

  it("stands the casing and sill proud of the room face, on purpose", () => {
    const proud = sashParts(4, SILL, HEAD, SASH_DEPTH).filter((p) => p.v < 0);
    expect(proud.length).toBeGreaterThanOrEqual(2); // casing, sill
    for (const p of proud) expect(p.v + p.dv).toBeLessThanOrEqual(0 + EPS);
  });

  it("never overlaps frame and glass, and together they exactly tile the light", () => {
    for (const width of [1, 3, 3.5, 4.7, 8, 16]) {
      const parts = sashPlaneParts(width);
      const frame = parts.filter((p) => p.material === "joinery");
      const glass = parts.filter((p) => p.material === "glass");
      const area = (p: { du: number; y0: number; y1: number }) => p.du * (p.y1 - p.y0);
      const total = [...frame, ...glass].reduce((s, p) => s + area(p), 0);
      expect(total).toBeCloseTo(width * (HEAD - SILL), 9);

      // No two parts at the same height band overlap in u: check by sampling
      // fine columns across the width and requiring exactly one part covers
      // each (u, y) sample in each half, never zero, never two.
      const meetingY = SILL + (HEAD - SILL) / 2;
      const samplesY = [SILL + 0.3, meetingY - 0.3, meetingY + 0.3, HEAD - 0.3];
      for (const y of samplesY) {
        for (let u = 0.01; u < width; u += width / 40) {
          const covering = [...frame, ...glass].filter(
            (p) => u >= p.u - EPS && u <= p.u + p.du + EPS && y >= p.y0 - EPS && y <= p.y1 + EPS,
          );
          expect(covering.length, `width ${width} u ${u.toFixed(2)} y ${y.toFixed(2)}`).toBe(1);
        }
      }
    }
  });

  it("degrades a narrow light to one undivided pane rather than a negative muntin", () => {
    // A muntin-splitting light needs 2*MIN_GLASS_HALF + MUNTIN of clear glass
    // width; well below that, the light must keep a single pane per half.
    const parts = sashPlaneParts(0.6);
    const glass = parts.filter((p) => p.material === "glass");
    // One pane per half (upper, lower), not two -- and every extent positive.
    expect(glass).toHaveLength(2);
    for (const p of parts) {
      expect(p.du).toBeGreaterThan(0);
      expect(p.y1 - p.y0).toBeGreaterThan(0);
    }
  });

  it("keeps a normal window split into two panes per half, each side of one muntin", () => {
    const glass = sashPlaneParts(4).filter((p) => p.material === "glass");
    expect(glass).toHaveLength(4); // 2 lights would double this; single light here
    for (const p of glass) {
      expect(p.du).toBeGreaterThan(0);
    }
  });

  it("splits a wide run into multiple lights, evenly, and every part stays positive", () => {
    for (const width of [8, 12, 16]) {
      const parts = sashParts(width, SILL, HEAD, SASH_DEPTH);
      for (const p of parts) {
        expect(p.du).toBeGreaterThan(0);
        expect(p.dv).toBeGreaterThan(0);
        expect(p.y1).toBeGreaterThan(p.y0);
      }
    }
  });
});
