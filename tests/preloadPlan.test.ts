import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import { preloadPoses, N_POSES, TOTAL_BATCHES, POSES_PER_BATCH } from "@/scene/preloadPlan";

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

  it("altitude decreases monotonically -- the whole premise of high-to-low batching", () => {
    for (let i = 1; i < poses.length; i++) {
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
});
