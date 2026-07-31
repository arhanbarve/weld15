import { describe, it, expect } from "vitest";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import {
  keyframes,
  blend,
  thresholdOpacity,
  visibility,
  cameraKeyframe,
  REDUCED_CUT,
  SHELL_GONE,
} from "@/scene/stages";
import { orbitKeyframe, orbitOf, MASS_RADIUS, MASSING_CENTER, transitPose } from "@/scene/orbit";
import { pointInPolygon } from "@/geo/collide";
import { fromThree } from "@/geo/frames";
import { cameraInSuite } from "@/scene/cutaway";
import { clearance, insideSuite, walkContext, type Vec2 } from "@/scene/walk";
import { HUB } from "@/scene/route";
import { floorLevel } from "@/geo/place";
import weld from "@/data/weld.json";
import type { StageId } from "@/state/store";
import { paramsSweep } from "./journey.test";

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

/**
 * P10's one real geometric gap in the descent: stage 3's pose is `kf[3]` (or wherever the
 * viewer orbited to) and stage 4's path starts at `kf[4]`, 124 ft outside the north gable.
 * Nothing used to interpolate between them. CameraRig now reads
 * `transitPose(orbitKeyframe(kf[3], orbit ?? orbitOf(kf[3])), kf[4], MASSING_CENTER, t)`
 * for stage 3 above t = 0, so this is asserted against transitPose() itself, the same way
 * the crossing above is asserted against blend().
 *
 * transitPose interpolates in SPHERICAL coordinates about MASSING_CENTER rather than in
 * cartesian space -- a first attempt at this step used a raw blend() and it dipped to 108
 * ft against MASS_RADIUS's 114.9, even though both ends sit at 195-251 ft from
 * MASSING_CENTER, because a chord between two points outside a sphere is not guaranteed to
 * stay outside it. Lerping the radius directly, about the sphere's own centre, does not
 * have that failure mode: see orbit.ts's docblock on transitPose for why.
 */
describe("the stage 3 -> 4 transit", () => {
  // Component-wise, not toEqual: floating-point round-trips through orbitOf/orbitKeyframe
  // can differ from the input by a float ulp -- the same reason the "blend" describe above
  // uses toBeCloseTo rather than toEqual.
  const sameAs = (got: readonly number[], want: readonly number[]) => {
    for (let i = 0; i < 3; i++) expect(got[i]).toBeCloseTo(want[i]!, 9);
  };

  // A straight line between two points outside a sphere is not guaranteed to stay outside
  // it -- kf[3]'s orbit sits at radius ~251 ft from MASSING_CENTER against a minRadius of
  // 114.9, and kf[4] sits at ~195 ft -- so this is a real geometric claim about this
  // specific segment, not a tautology. keepOutsideMassing is the function that used to
  // enforce clearance on every eased frame, and CameraRig.tsx now switches it off above
  // t = 0 for exactly this transit, so this test is what stands in its place.
  const clearsMassing = (base: ReturnType<typeof orbitKeyframe>, to: ReturnType<typeof orbitKeyframe>) => {
    for (let t = 0; t <= 1.0001; t += 0.001) {
      const p = transitPose(base, to, MASSING_CENTER, Math.min(1, t)).position;
      const r = Math.hypot(
        p[0]! - MASSING_CENTER[0],
        p[1]! - MASSING_CENTER[1],
        p[2]! - MASSING_CENTER[2],
      );
      expect(r, `t=${t.toFixed(3)}`).toBeGreaterThanOrEqual(MASS_RADIUS);
    }
  };

  it("starts at kf[3]'s orbit pose exactly", () => {
    const base = orbitKeyframe(kf[3], orbitOf(kf[3]));
    const start = transitPose(base, kf[4], MASSING_CENTER, 0);
    sameAs(start.position, base.position);
    sameAs(start.target, base.target);
    expect(start.fov).toBeCloseTo(base.fov, 9);
  });

  it("ends at kf[4], the first stop of stage 4's own path, to 1e-9", () => {
    const base = orbitKeyframe(kf[3], orbitOf(kf[3]));
    const end = transitPose(base, kf[4], MASSING_CENTER, 1);
    sameAs(end.position, kf[4].position);
    sameAs(end.target, kf[4].target);
    expect(end.fov).toBeCloseTo(kf[4].fov, 9);
  });

  it("clears the massing for the whole segment", () => {
    clearsMassing(orbitKeyframe(kf[3], orbitOf(kf[3])), kf[4]);
  });

  it("holds across a sweep of params sets", () => {
    for (const [i, params] of paramsSweep().entries()) {
      const k = keyframes(params);
      const base = orbitKeyframe(k[3], orbitOf(k[3]));
      const start = transitPose(base, k[4], MASSING_CENTER, 0);
      sameAs(start.position, base.position);
      sameAs(start.target, base.target);
      expect(start.fov, `set ${i}`).toBeCloseTo(base.fov, 9);

      const end = transitPose(base, k[4], MASSING_CENTER, 1);
      sameAs(end.position, k[4].position);
      sameAs(end.target, k[4].target);
      expect(end.fov, `set ${i}`).toBeCloseTo(k[4].fov, 9);

      for (let t = 0; t <= 1.0001; t += 0.001) {
        const p = transitPose(base, k[4], MASSING_CENTER, Math.min(1, t)).position;
        const r = Math.hypot(
          p[0]! - MASSING_CENTER[0],
          p[1]! - MASSING_CENTER[1],
          p[2]! - MASSING_CENTER[2],
        );
        expect(r, `set ${i}, t=${t.toFixed(3)}`).toBeGreaterThanOrEqual(MASS_RADIUS);
      }
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

describe("reduced motion", () => {
  const STAGE_POSITIONS = ([0, 1, 2, 3, 4, 5] as StageId[]).map((s) => kf[s].position);
  const isAKeyframe = (p: readonly number[]) =>
    STAGE_POSITIONS.some((q) => dist(p, q) < 1e-9);

  it("visits no position that is not a keyframe, anywhere in the crossing", () => {
    // The gate in docs/phases/P4-P5.md, as a property of the pure function the
    // camera reads. Sampled at every hundredth of the slider's travel, which is
    // its own step, so this is every value stage 4 can actually be asked for.
    const seen: string[] = [];
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const got = cameraKeyframe(kf, 4, t, true);
      expect(isAKeyframe(got.position), `t=${t.toFixed(2)} is an interpolated position`).toBe(
        true,
      );
      seen.push(got.position.join(","));
    }
    // And only two of them: outside the gable, then inside bedroom B.
    expect(new Set(seen).size).toBe(2);
  });

  it("cuts at the same point the shell does", () => {
    // Camera and wall on one frame. Either order apart is a frame with the camera
    // inside a wall that is still standing, or a wall gone with the camera still
    // outside it -- both read as a glitch rather than as a cut.
    const before = REDUCED_CUT - 0.01;
    const after = REDUCED_CUT + 0.01;
    expect(cameraKeyframe(kf, 4, before, true).position).toEqual(kf[4].position);
    expect(cameraKeyframe(kf, 4, after, true).position).toEqual(kf[5].position);
    expect(thresholdOpacity(4, before, true)).toEqual({ shell: 1, interior: 0 });
    expect(thresholdOpacity(4, after, true)).toEqual({ shell: 0, interior: 1 });
  });

  it("still moves through the crossing when motion is allowed", () => {
    // The guard against fixing the reduced path by breaking the normal one.
    //
    // WHAT THIS USED TO ASSERT, AND WHY IT NO LONGER CAN. It pinned the full-motion pose
    // at t = 0.5 to the component-wise MIDPOINT of kf[4] and kf[5], which was a
    // restatement of the implementation -- blend() -- rather than a property of the
    // crossing. Stage 4 is now a polyline through bedroom B's doorway (see the
    // "threshold path" block below), so the halfway pose is not the halfway point and
    // asserting that it is would be asserting the defect back into place. What is
    // actually required of the full-motion path is that it MOVES, continuously, and
    // through poses that are not keyframes -- and that it is clear of the walls, which
    // is the assertion the midpoint check was standing in front of.
    const mid = cameraKeyframe(kf, 4, 0.5, false);
    expect(isAKeyframe(mid.position)).toBe(false);
    // Strictly between the two ends in the direction of travel, and distinct from every
    // neighbouring sample: a function returning one fixed interior pose would satisfy
    // "not a keyframe" on its own.
    const seen = new Set<string>();
    let prev = kf[4].position;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const got = cameraKeyframe(kf, 4, t, false).position;
      seen.add(got.join(","));
      // 10 ft, against a measured largest step of 3.68 ft per 0.02 of t -- which is on
      // the approach, where 0.7 of t covers 129 ft. What this catches is a cut: a branch
      // that snapped to one end or the other would step 129 ft in one sample.
      expect(dist(got, prev), `t=${t.toFixed(2)} did not advance`).toBeLessThan(10);
      prev = got;
    }
    expect(seen.size, "the full-motion path is a sequence, not two poses").toBeGreaterThan(40);
  });

  it("leaves the stages that are places exactly where they were", () => {
    // Stages 3 and 5 are single places, and the flag must not move either of them. This used
    // to cover 0, 1 and 2 as well; since P9 those three are flights, and what reduced motion
    // owes them is the assertion below rather than this one.
    for (const s of [3, 5] as StageId[]) {
      for (const r of [false, true]) {
        for (const t of [0, 0.5, 1]) {
          expect(cameraKeyframe(kf, s, t, r), `stage ${s} reduced=${r} t=${t}`).toEqual(kf[s]);
        }
      }
    }
  });

  it("jump-cuts each descent stage to its own two endpoints and nothing between", () => {
    // The same guarantee the crossing has, extended to the flight. Under reduced motion the
    // only poses stages 0, 1 and 2 can produce are the ends of their own paths -- so the
    // camera visits four positions across the whole descent instead of sweeping three decades
    // of altitude, and CameraRig's window.__cam.path is what proves it from outside.
    for (const s of [0, 1, 2] as StageId[]) {
      const stops = kf[s].path!;
      const first = stops[0]!.frame;
      const last = stops[stops.length - 1]!.frame;
      const seen = new Set<string>();
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const got = cameraKeyframe(kf, s, Math.min(1, t), true);
        seen.add(got.position.join(","));
        const want = t < REDUCED_CUT ? first : last;
        expect(got.position, `stage ${s} at t=${t.toFixed(2)}`).toEqual(want.position);
      }
      expect(seen.size, `stage ${s} visits two poses, not a sweep`).toBe(2);
      // And the far end is the next stage's pose exactly, so the cut lands on a keyframe.
      expect(last.position).toEqual(kf[(s + 1) as StageId].position);
    }
  });

  it("never leaves a frame showing neither shell nor interior", () => {
    // Same requirement as the ramped path, and the reason the cut is a single
    // exchange rather than a fade out followed by a fade in.
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const { shell, interior } = thresholdOpacity(4, t, true);
      expect(shell + interior, `at t=${t.toFixed(2)}`).toBe(1);
    }
  });
});

/**
 * P7's debt: the crossing lands in the hall, and the path to it is clear of the walls.
 *
 * stages.ts carried a comment saying the hall was the better shot and could not be had,
 * because a straight camera path from bedroom B to the hall passes through the partition
 * between them and stood the camera half a foot from it -- at Experience.tsx's near plane
 * of 0.5, so every face clipped and the frame went empty. These are the assertions that
 * make the routed path a guarantee rather than a hope, and the last one is what stops
 * them passing for the wrong reason: it shows the straight line this replaced still
 * fails, at a value the panel's own slider offers.
 */
describe("the threshold path", () => {
  const params = DEFAULT_PARAMS;
  const suite = buildSuite(params);
  const ctx = walkContext(suite);
  /** A world position back in the suite's own frame. cutaway.ts's inverse, not a second one. */
  const inSuite = (p: readonly number[]): Vec2 =>
    cameraInSuite([p[0]!, p[1]!, p[2]!], params);
  const roomAt = (p: Vec2) =>
    suite.rooms.find(
      (r) => p.u >= r.u && p.u <= r.u + r.du && p.v >= r.v && p.v <= r.v + r.dv,
    )?.id ?? null;

  it("ends the descent standing in the hall", () => {
    // The shot the comment always wanted. Named through the same inverse A11yAlt uses to
    // say which room the camera is in, so the description and the geometry cannot
    // disagree about it.
    expect(roomAt(inSuite(kf[5].position))).toBe(HUB);
    // At eye height on the first floor, still: this moved the camera across the suite,
    // not up or down.
    expect(kf[5].position[1] - floorLevel(1)).toBeCloseTo(5 + 10 / 12, 9);
  });

  it("hangs a path off the stages that travel and not off the stages that sit", () => {
    // THIS USED TO READ "off stage 4 and nowhere else", and P9 is why it does not. The
    // descent from orbit is a flight, so stages 0, 1 and 2 now carry paths too; stages 3 and
    // 5 are still places. Stage 3 in particular MUST stay a place -- it is the free orbit,
    // and CameraRig routes it through orbitKeyframe() rather than cameraKeyframe().
    for (const s of [0, 1, 2, 4] as StageId[]) {
      expect(kf[s].path, `stage ${s} travels and needs a path`).toBeDefined();
    }
    for (const s of [3, 5] as StageId[]) {
      expect(kf[s].path, `stage ${s} must be a place, not a path`).toBeUndefined();
    }
    const stops = kf[4].path!;
    // Outside the gable, the crossing, and route()'s four interior waypoints.
    expect(stops.length).toBe(6);
    expect(stops[0]!.at).toBe(0);
    expect(stops[stops.length - 1]!.at).toBe(1);
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]!.at, `stop ${i} is not after stop ${i - 1}`).toBeGreaterThan(
        stops[i - 1]!.at,
      );
    }
    // The ends are the two keyframes themselves, exactly, so the stage boundary cannot
    // show a jump.
    expect(cameraKeyframe(kf, 4, 0).position).toEqual(kf[4].position);
    expect(cameraKeyframe(kf, 4, 1).position).toEqual(kf[5].position);
  });

  it("crosses the plane of the gable exactly when the brick has gone", () => {
    // One number, two things: thresholdOpacity's shell ramp reaches zero at SHELL_GONE
    // and the path's second waypoint sits on the gable's interior face. A camera on the
    // far side of masonry that is still being drawn reads as a glitch.
    expect(thresholdOpacity(4, SHELL_GONE).shell).toBeCloseTo(0, 9);
    const here = inSuite(cameraKeyframe(kf, 4, SHELL_GONE).position);
    expect(here.v).toBeCloseTo(params.sectionLength, 6);
    // Before it, outside the suite; after it, inside.
    expect(insideSuite(inSuite(cameraKeyframe(kf, 4, SHELL_GONE - 0.01).position), ctx)).toBe(
      false,
    );
    expect(insideSuite(inSuite(cameraKeyframe(kf, 4, SHELL_GONE + 0.01).position), ctx)).toBe(
      true,
    );
  });

  it("never passes within the near plane of a wall once it is inside", () => {
    /*
     * The gate the whole phase is for, and the sampling is deliberate on both ends.
     *
     * FROM the third stop, which is route()'s first waypoint -- the centre of bedroom B.
     * Everything before it is the crossing itself: the camera is coming through the
     * gable masonry on purpose, and inside a 1.5 ft band a clearance is negative by
     * definition. So what is asserted is the part of the path that is a WALK.
     *
     * Every 0.0002 of t, which is 1,190 samples over that stretch, because the failure
     * being guarded against is a couple of frames wide -- the recorded one was at a
     * single value of the slider.
     */
    const stops = kf[4].path!;
    const from = stops[2]!.at;
    let worst = Infinity;
    let worstAt = { t: 0, p: { u: 0, v: 0 } as Vec2 };
    for (let t = from; t <= 1.0001; t += 0.0002) {
      const p = inSuite(cameraKeyframe(kf, 4, Math.min(1, t)).position);
      expect(insideSuite(p, ctx), `t=${t.toFixed(4)} left the suite footprint`).toBe(true);
      const c = clearance(p, ctx);
      if (c < worst) {
        worst = c;
        worstAt = { t, p };
      }
    }
    // MEASURED: +0.442 ft at (17.68, 37.66), which is the doorway crossing -- the camera
    // centre passes 1.19 ft from the nearer jamb of a 3 ft door. The bound is 0 rather
    // than the measured figure so that a slider that narrows the door does not fail this
    // for being a different suite, and the number is in the message when it does.
    expect(
      worst,
      `worst clearance ${worst.toFixed(3)} ft at t=${worstAt.t.toFixed(4)}, ` +
        `(${worstAt.p.u.toFixed(2)}, ${worstAt.p.v.toFixed(2)})`,
    ).toBeGreaterThan(0);
    // And nowhere near the near plane: clearance is measured from a 0.75 ft disc's edge,
    // so a clearance of c puts the camera centre c + 0.75 from the wall.
    expect(worst + 0.75, "the camera centre reaches the near plane").toBeGreaterThan(0.5);
  });

  it("is not passing because a straight line would have done", () => {
    /*
     * The non-vacuity check, and it is the reason the route is not decoration.
     *
     * At the shipped params the straight blend from kf[4] to kf[5] happens to clear the
     * bedroom B / hall partition by 0.264 ft, because the gable stand-off is 123.6 ft out
     * and the line is therefore almost parallel to the section. At hallWidth = 3 -- the
     * LOW END OF THE PANEL'S OWN SLIDER, Panel.tsx's `min` -- it does not: the camera
     * centre passes 0.396 ft from that band, inside the 0.5 near plane, which is the
     * defect stages.ts recorded, reproduced from a shipped control.
     *
     * Measured over the part of the line more than a foot south of the gable's interior
     * face, so that what is being measured is a partition and not the wall the camera is
     * deliberately coming through.
     */
    const narrow = { ...DEFAULT_PARAMS, hallWidth: 3 };
    const nkf = keyframes(narrow);
    const nctx = walkContext(buildSuite(narrow));
    const straightWorst = (p: typeof narrow, k: ReturnType<typeof keyframes>, c: typeof nctx) => {
      let worst = Infinity;
      for (let t = 0; t <= 1.0001; t += 0.0002) {
        const at = blend(k[4], k[5], t).position;
        const q = cameraInSuite([at[0]!, at[1]!, at[2]!], p);
        if (!insideSuite(q, c) || q.v > p.sectionLength - 1) continue;
        worst = Math.min(worst, clearance(q, c));
      }
      return worst;
    };
    expect(straightWorst(narrow, nkf, nctx), "the straight line still fails").toBeLessThan(0);
    // The routed path at the same params does not, so what changed is the path and not
    // the suite.
    const stops = nkf[4].path!;
    let routed = Infinity;
    for (let t = stops[2]!.at; t <= 1.0001; t += 0.0002) {
      const at = cameraKeyframe(nkf, 4, Math.min(1, t)).position;
      routed = Math.min(routed, clearance(cameraInSuite([at[0]!, at[1]!, at[2]!], narrow), nctx));
    }
    expect(routed, `routed worst ${routed.toFixed(3)} ft at hallWidth 3`).toBeGreaterThan(0);
  });

  it("memoises on the params object rather than rebuilding per frame", () => {
    // CameraRig calls keyframes() from inside useFrame and the body now calls route(),
    // which builds a WalkCtx -- walk.ts's header says to memoise one per params and never
    // per frame. Identity, not value, for the reason the cache's docblock gives.
    const p = { ...DEFAULT_PARAMS };
    expect(keyframes(p)).toBe(keyframes(p));
    expect(keyframes({ ...DEFAULT_PARAMS })).not.toBe(keyframes({ ...DEFAULT_PARAMS }));
    // And a changed params object is a changed answer, which is what a cache keyed on the
    // wrong thing would break.
    const deeper = keyframes({ ...DEFAULT_PARAMS, sectionLength: 48 });
    expect(dist(deeper[5].position, keyframes(DEFAULT_PARAMS)[5].position)).toBeGreaterThan(1);
  });
});

describe("visibility", () => {
  it("shows the globe only at stage 0", () => {
    expect(visibility(0).globe).toBe(true);
    for (const s of [1, 2, 3, 4, 5] as StageId[]) expect(visibility(s).globe).toBe(false);
  });

  it("mounts the campus at stage 0, because stage 0 is where the ground arrives", () => {
    // P9 CHANGED THIS LINE and it is worth an assertion of its own. Stage 0's path runs from
    // 31,353,347 ft down to stage 1's keyframe at 16,332 ft, so the massing's fade-in at
    // 40,000 ft happens inside stage 0. Mounting the campus only from stage 1 would move the
    // pop from the 0 -> 1 boundary to the moment of mounting rather than removing it.
    expect(visibility(0).campus).toBe(true);
    for (const s of [1, 2, 3] as StageId[]) expect(visibility(s).campus).toBe(true);
    // And still off once the camera is inside, where it would be geometry behind a wall.
    for (const s of [4, 5] as StageId[]) expect(visibility(s).campus).toBe(false);
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
