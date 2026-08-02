import { describe, it, expect } from "vitest";
import { GROUND_LEVELS, quadOf } from "@/scene/imagery";
import { layerOpacity } from "@/scene/altitude";
import { FALLBACK_LEVELS, PICK } from "@/scene/FallbackGround";

/**
 * FallbackGround.tsx renders inside <Canvas>, and this repo has no jsdom / @testing-library —
 * every other test here is either a pure-logic vitest test (altitude.test.ts, imagery.test.ts,
 * campusGeometry.test.ts) or a Playwright e2e spec (tests/e2e/*.spec.ts) that drives a real
 * WebGL context. A render-level smoke test of a react-three-fiber component is not idiomatic in
 * this codebase, so what is pinned here is the one thing FallbackGround.tsx adds that is pure
 * and testable: which imagery levels decision 10 (P11) restricts the fallback to.
 */
describe("FallbackGround is restricted to L3/L4, per P11 decision 10", () => {
  it("asks for exactly L3 and L4, and nothing from L0/L1/L2", () => {
    expect(FALLBACK_LEVELS).toEqual(["L3", "L4"]);
    expect(FALLBACK_LEVELS).not.toContain("L0");
    expect(FALLBACK_LEVELS).not.toContain("L1");
    expect(FALLBACK_LEVELS).not.toContain("L2");
  });

  it("is a subset of what Ground.tsx's own level list covers", () => {
    for (const id of FALLBACK_LEVELS) {
      expect(GROUND_LEVELS as readonly string[]).toContain(id);
    }
  });

  it("still nests: L4 sits strictly inside L3", () => {
    const l3 = quadOf("L3")!;
    const l4 = quadOf("L4")!;
    expect(l4.width).toBeLessThan(l3.width);
    expect(l4.height).toBeLessThan(l3.height);
  });

  it("picks the L3/L4 opacity bands (q3/q4), not q1/q2", () => {
    // A sample altitude where every band differs, so a mis-wired PICK entry (e.g. L4 reading
    // o.q3) would fail rather than passing by coincidence at an altitude where two bands agree.
    const o = layerOpacity(2_000);
    expect(PICK.L3(o)).toBe(o.q3);
    expect(PICK.L4(o)).toBe(o.q4);
    expect(o.q3).not.toBe(o.q4);
  });
});
