import { describe, it, expect } from "vitest";
import { vegetationMask, recombine, blur } from "@/imagery/hybrid";

const rgba = (r: number, g: number, b: number) => Uint8ClampedArray.from([r, g, b, 255]);

describe("vegetationMask", () => {
  it("is 1 for saturated green and 0 for grey", () => {
    const green = vegetationMask(rgba(60, 130, 55), 1, 1);
    const grey = vegetationMask(rgba(130, 130, 130), 1, 1);
    expect(green[0]).toBe(1);
    expect(grey[0]).toBe(0);
  });

  it("ramps between the thresholds rather than stepping", () => {
    // green excess = G - (R+B)/2. With T0=0 and T1=15, an excess of 7.5 sits at (7.5-0)/15 = 0.5.
    const mid = vegetationMask(rgba(99, 107, 100), 1, 1);
    expect(mid[0]).toBeCloseTo(0.5, 2);
  });
});

describe("recombine", () => {
  it("takes luma from the detail source where the mask is 0", () => {
    // Detail is black, colour source is mid-grey. Mask 0 => output luma is the detail's.
    const out = recombine(rgba(0, 0, 0), rgba(128, 128, 128), 0);
    expect(out[0]).toBeLessThan(8);
    expect(out[1]).toBeLessThan(8);
    expect(out[2]).toBeLessThan(8);
  });

  it("takes luma from the colour source where the mask is 1", () => {
    const out = recombine(rgba(0, 0, 0), rgba(128, 128, 128), 1);
    expect(out[0]).toBeCloseTo(128, -1);
  });

  it("always takes chroma from the colour source", () => {
    // Grey detail, green colour, mask 0: the result must be green, at the detail's brightness.
    const out = recombine(rgba(128, 128, 128), rgba(60, 130, 55), 0);
    expect(out[1]).toBeGreaterThan(out[0]);
    expect(out[1]).toBeGreaterThan(out[2]);
  });

  it("is the identity when both sources are the same pixel", () => {
    const p = rgba(90, 140, 70);
    const out = recombine(p, p, 0);
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(p[i]!, -1);
  });
});

describe("blur", () => {
  it("preserves a constant field", () => {
    const field = new Float32Array(64).fill(0.5);
    const out = blur(field, 8, 8, 2);
    for (const v of out) expect(v).toBeCloseTo(0.5, 5);
  });

  it("spreads an impulse without changing its total", () => {
    // 32x32, impulse at (16,16): with sigma 1.5 the kernel radius is ceil(1.5*3) = 5, so the
    // impulse has 16+ pixels of clearance to every edge and clamping never touches it. That
    // isolates what this test claims to test -- mass conservation -- from clamp behaviour at a
    // boundary, which is a separate (and correct, for a 3072x3072 real plate) concern.
    const field = new Float32Array(32 * 32);
    field[32 * 16 + 16] = 1;
    const out = blur(field, 32, 32, 1.5);
    const total = out.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 2);
    expect(out[32 * 16 + 16]!).toBeLessThan(1);
    expect(out[32 * 16 + 17]!).toBeGreaterThan(0);
  });
});
