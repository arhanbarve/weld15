import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import { keyframes, blend, thresholdOpacity, visibility } from "@/scene/stages";
import { pointInPolygon } from "@/geo/collide";
import { fromThree } from "@/geo/frames";
import weld from "@/data/weld.json";
import type { StageId } from "@/state/store";

const kf = keyframes(DEFAULT_PARAMS);
const ring = weld.rings[0] as number[][];
const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

describe("keyframes", () => {
  it("defines all six stages", () => {
    for (const s of [0, 1, 2, 3, 4, 5] as StageId[]) {
      expect(kf[s], `stage ${s}`).toBeDefined();
      expect(kf[s].position).toHaveLength(3);
      expect(kf[s].fov).toBeGreaterThan(20);
      expect(kf[s].fov).toBeLessThan(90);
    }
  });

  it("descends monotonically from Cambridge to the suite", () => {
    // The whole premise of the sequence. If any stage is further out than the one
    // before it, the descent reads as a stumble.
    const range = ([1, 2, 3, 4, 5] as StageId[]).map((s) =>
      dist(kf[s].position, kf[s].target),
    );
    for (let i = 1; i < range.length; i++) {
      expect(range[i]!, `stage ${i + 1} is not closer than stage ${i}`).toBeLessThan(range[i - 1]!);
    }
  });

  it("stays inside float32's comfortable depth range", () => {
    const far = dist(kf[1].position, kf[1].target);
    const near = dist(kf[5].position, kf[5].target);
    expect(far / near).toBeLessThan(1e5);
    expect(far).toBeLessThan(25_000); // camera far plane
  });

  it("puts the suite-interior camera inside Weld's real footprint", () => {
    // Composes stages, place, collide and the GIS data. A keyframe that looked
    // fine numerically could still stand in the car park.
    const p = fromThree(kf[5].position);
    expect(pointInPolygon([p.x, p.y], ring)).toBe(true);
  });

  it("starts the threshold outside Weld and ends it inside", () => {
    const out = fromThree(kf[4].position);
    const inTarget = fromThree(kf[4].target);
    expect(pointInPolygon([out.x, out.y], ring)).toBe(false);
    expect(pointInPolygon([inTarget.x, inTarget.y], ring)).toBe(true);
  });

  it("stands the interior camera at eye height on the first floor", () => {
    // 12 ft floor-to-floor, plus 5 ft 10 in of person.
    expect(kf[5].position[1]).toBeCloseTo(12 + 5 + 10 / 12, 6);
  });

  it("moves the threshold keyframe when the room it aims at moves", () => {
    // Proves stages.ts is parametric rather than holding baked numbers.
    //
    // Note which param: NOT sectionLength. The threshold is anchored to the
    // gable, and the gable does not move when the section gets longer -- the
    // section extends southward instead. An earlier version of this test used
    // sectionLength and was asserting a bug rather than a feature.
    const deeper = keyframes({ ...DEFAULT_PARAMS, bedDepth: 20 });
    expect(dist(deeper[4].position, kf[4].position)).toBeGreaterThan(1);
  });

  it("leaves the threshold keyframe alone when the section lengthens", () => {
    // The gable is fixed by the building, so it must not drift.
    const longer = keyframes({ ...DEFAULT_PARAMS, sectionLength: 50 });
    expect(dist(longer[4].position, kf[4].position)).toBeLessThan(0.01);
  });

  it("mirrors the interior camera when the facade flips", () => {
    const west = keyframes({ ...DEFAULT_PARAMS, facade: "west" });
    expect(dist(west[5].position, kf[5].position)).toBeGreaterThan(10);
  });
});

describe("blend", () => {
  // Component-wise, not toEqual: blend computes p + (q - p) * k, which yields
  // signed zero for some components at k = 0, and toEqual distinguishes 0 from -0.
  const sameAs = (got: readonly number[], want: readonly number[]) => {
    for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i]!, 9);
  };

  it("returns the endpoints at 0 and 1", () => {
    sameAs(blend(kf[3], kf[4], 0).position, kf[3].position);
    sameAs(blend(kf[3], kf[4], 1).position, kf[4].position);
  });

  it("clamps outside 0..1", () => {
    sameAs(blend(kf[3], kf[4], -5).position, kf[3].position);
    sameAs(blend(kf[3], kf[4], 9).position, kf[4].position);
  });

  it("lands halfway at 0.5", () => {
    const mid = blend(kf[3], kf[4], 0.5);
    for (let i = 0; i < 3; i++) {
      expect(mid.position[i]).toBeCloseTo((kf[3].position[i]! + kf[4].position[i]!) / 2, 6);
    }
  });
});

describe("threshold opacity", () => {
  it("hides the interior before the threshold and the shell after it", () => {
    expect(thresholdOpacity(2, 0)).toEqual({ shell: 1, interior: 0 });
    expect(thresholdOpacity(5, 0)).toEqual({ shell: 0, interior: 1 });
  });

  it("never leaves a frame showing neither shell nor interior", () => {
    // A gap here is what a viewer reads as a flicker. Sampled finely because the
    // failure would be a couple of frames wide.
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const { shell, interior } = thresholdOpacity(4, t);
      expect(shell + interior, `at t=${t.toFixed(2)}`).toBeGreaterThan(0.25);
    }
  });

  it("crosses over: shell falls, interior rises, both monotonic", () => {
    let prevShell = 2;
    let prevInterior = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const { shell, interior } = thresholdOpacity(4, t);
      expect(shell).toBeLessThanOrEqual(prevShell + 1e-9);
      expect(interior).toBeGreaterThanOrEqual(prevInterior - 1e-9);
      prevShell = shell;
      prevInterior = interior;
    }
    expect(thresholdOpacity(4, 1).shell).toBeCloseTo(0, 6);
    expect(thresholdOpacity(4, 1).interior).toBeCloseTo(1, 6);
  });
});

describe("visibility", () => {
  it("shows the globe only at stage 0", () => {
    expect(visibility(0).globe).toBe(true);
    for (const s of [1, 2, 3, 4, 5] as StageId[]) expect(visibility(s).globe).toBe(false);
  });

  it("mounts the interior a stage before the threshold needs it", () => {
    // Warming the geometry avoids a hitch at the moment of transition.
    expect(visibility(3).interior).toBe(true);
    expect(visibility(2).interior).toBe(false);
  });

  it("always has something to render", () => {
    for (const s of [0, 1, 2, 3, 4, 5] as StageId[]) {
      const v = visibility(s);
      expect(v.globe || v.campus || v.weld || v.interior, `stage ${s} renders nothing`).toBe(true);
    }
  });
});
