import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import { preloadPoses, N_POSES, TOTAL_BATCHES, POSES_PER_BATCH } from "@/scene/preloadPlan";
import { toJourney } from "@/scene/journey";

describe("preloadPoses", () => {
  const poses = preloadPoses(DEFAULT_PARAMS);

  it("samples exactly N_POSES poses", () => {
    expect(poses).toHaveLength(N_POSES);
  });

  it("starts at u=0 and ends at u=1", () => {
    expect(poses[0]!.u).toBe(0);
    expect(poses[poses.length - 1]!.u).toBe(1);
  });

  it("u is strictly increasing", () => {
    for (let i = 1; i < poses.length; i++) {
      expect(poses[i]!.u, `pose ${i}`).toBeGreaterThan(poses[i - 1]!.u);
    }
  });

  it("altitude decreases monotonically down to the lowest point of the path", () => {
    // Found rather than assumed to be the last sample: the entry approach (stages.ts's
    // thresholdPath()) is a single eye height the whole way in, so the whole path is
    // monotonic at the shipped params, but this does not hard-code that shape -- a future
    // path with its own climb near the threshold would still only need the part of the
    // premise that always holds: every sample up to the lowest point is strictly lower
    // than the one before it.
    let minIdx = 0;
    for (let i = 1; i < poses.length; i++) {
      if (poses[i]!.altFt < poses[minIdx]!.altFt) minIdx = i;
    }
    for (let i = 1; i <= minIdx; i++) {
      expect(poses[i]!.altFt, `pose ${i}`).toBeLessThan(poses[i - 1]!.altFt);
    }
  });

  it("never samples stage 5 -- there are no tiles to preload there", () => {
    for (const p of poses) {
      expect(p.stage).not.toBe(5);
    }
  });

  it("the last pose is the threshold crossing, not an earlier stop", () => {
    const last = poses[poses.length - 1]!;
    expect(last.stage).toBe(4);
    expect(last.t).toBeCloseTo(1, 3);
  });

  it("assigns every pose to a batch, 0 to TOTAL_BATCHES-1, none empty", () => {
    const counts = new Array(TOTAL_BATCHES).fill(0);
    for (const p of poses) {
      expect(p.batch).toBeGreaterThanOrEqual(0);
      expect(p.batch).toBeLessThan(TOTAL_BATCHES);
      counts[p.batch] += 1;
    }
    for (const c of counts) expect(c).toBeGreaterThan(0);
    expect(TOTAL_BATCHES).toBe(Math.ceil(N_POSES / POSES_PER_BATCH));
  });

  it("batch 0 is the highest-altitude samples (registered first)", () => {
    const batch0 = poses.filter((p) => p.batch === 0);
    const rest = poses.filter((p) => p.batch !== 0);
    const minBatch0 = Math.min(...batch0.map((p) => p.altFt));
    const maxRest = Math.max(...rest.map((p) => p.altFt));
    expect(minBatch0).toBeGreaterThan(maxRest);
  });

  // A "jump to stage N" click (Hud.tsx's stage buttons, and `[`/`]`) resets t to exactly 0
  // and lands the real camera there -- not on whatever u the uniform grid happens to carry
  // nearest that boundary. Without an exact sample at that pose, a settled preload still
  // queues hundreds of fresh tiles the instant the viewer jumps to a stage: measured at
  // stage 2, 538 tiles queued and 22s to settle, straight after `__preload.done` fired. Each
  // stage 1-4 must therefore have a sample at exactly (stage, t=0), not merely a nearby one.
  it("stages 1-4 each have an exact (stage, t=0) sample, for direct stage-jump navigation", () => {
    for (const stage of [1, 2, 3, 4] as const) {
      const uAnchor = toJourney(stage, 0, DEFAULT_PARAMS);
      const exact = poses.find((p) => p.stage === stage && p.t === 0);
      expect(exact, `no exact (stage ${stage}, t=0) sample`).toBeDefined();
      // u is left at its original grid position (batching/ordering untouched); only the
      // pose itself is replaced, so it can land close to but not exactly at uAnchor.
      expect(Math.abs(exact!.u - uAnchor)).toBeLessThan(0.05);
    }
  });
});
