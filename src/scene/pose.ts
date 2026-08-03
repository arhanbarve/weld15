/**
 * The keyframe-driven camera pose for a given (stage, t, orbit), independent of the walker.
 *
 * EXTRACTED FROM CameraRig.tsx'S `useFrame`, VERBATIM MINUS THE WALKER BRANCH. P13 (docs/
 * phases/P13-PRELOAD.md section 2.5) needs the exact same pose composition CameraRig uses --
 * a preloader that samples a different pose than the one the app will actually render either
 * warms tiles nobody needs or misses ones it does. Duplicating the branch by hand is the
 * drift this project has already paid for elsewhere (LoadingBar's own header states the same
 * principle for a different pair of files), so this is a lift, not a rewrite:
 * tests/pose.test.ts pins it equal to the old inline branch at 40 sampled points before that
 * branch is deleted from CameraRig.
 *
 * WHY MINUS THE WALKER. The walker's pose (FirstPerson.tsx's firstPersonPose) is interior
 * geometry -- stage 5 only, and stage 5 needs no tiles (visibility(stage).tiles is false
 * there, Google's Weld is behind the walls the whole stage). A preloader has nothing to ask
 * this function at stage 5, so the walker case is CameraRig's alone.
 *
 * THREE-FREE, like stages.ts, orbit.ts and journey.ts: this runs in Node under vitest and
 * inside a synthetic preload pass that never touches THREE.Camera directly.
 */
import type { StageId } from "@/state/store";
import { cameraKeyframe, REDUCED_CUT, funnel, type Keyframe } from "./stages";
import {
  clampForStage,
  orbitKeyframe,
  orbitOf,
  STAGE3_CLAMP,
  stage4OrbitKeyframe,
  stage4Pose,
  transitPose,
  MASSING_CENTER,
  type Orbit,
} from "./orbit";

/**
 * How much stage-local t a held orbit takes to fade back to the live path pose, once
 * the wheel resumes past the t it was seeded at. Same order of magnitude as stages.ts's
 * FUNNEL_START-to-SHELL_GONE span (0.55) -- gradual enough to read as easing back to the
 * guided framing rather than a snap, short enough that a few wheel notches clear it.
 */
export const ORBIT_DECAY_SPAN = 0.25;

/**
 * How much of a held orbit still applies, 1 at the seed t and 0 once t has moved
 * ORBIT_DECAY_SPAN away from it -- smoothstep, the same shape funnel() uses, so both
 * ends have zero derivative and neither the drag nor the resumed path starts with a
 * jerk. `Math.abs` because the master scrubber can move t backward as well as the
 * wheel moves it forward, and either direction is "resuming", not just one.
 */
function orbitStrength(t: number, seedT: number): number {
  const progressed = Math.min(1, Math.abs(t - seedT) / ORBIT_DECAY_SPAN);
  const u = 1 - progressed;
  return u * u * (3 - 2 * u);
}

/**
 * `orbit`/`orbitStage` are the SAME pair CameraRig reads off the store: a live drag/orbit
 * only applies when `orbitStage === stage` (see CameraRig's own comment on that gate). A
 * caller with no live orbit -- P13's preloader, every sampled pose -- passes `orbit: null`
 * and gets exactly the stage's own default framing.
 *
 * `orbitSeedT` is the stage-local t the orbit was set at (store.ts's own field of the same
 * name). Stages 0-2 are a path, and wheel zoom is t advancing along it, not `orbit` --
 * DRAGGING NEVER TOUCHES rangeFt (CameraRig's onMove passes it through unchanged), so an
 * orbit held at a frozen distance while t keeps moving read as the zoom having stopped
 * working, and it stayed frozen until the stage itself changed and dropped the orbit
 * outright: a hard pop instead of a drag wearing off. `orbitStrength` fades the held pose
 * back to the live path pose over ORBIT_DECAY_SPAN of t instead, so resuming the wheel
 * after a drag eases back to the guided framing rather than freezing or popping.
 */
export function journeyPose(
  kf: Record<StageId, Keyframe>,
  stage: StageId,
  t: number,
  reduced: boolean,
  orbit: Orbit | null,
  orbitStage: StageId | null,
  orbitSeedT: number | null,
): Keyframe {
  // Reduced motion for the stage 3 -> 4 transit: cameraKeyframe's own reduced branch does
  // not fire for stage 3, since stage 3 has no path of its own to jump within. This gives
  // the transit the same jump-at-midpoint shape stage 4's crossing already has.
  const transit = reduced ? (t < REDUCED_CUT ? 0 : 1) : t;

  // Stages 0-2: the stage's own path pose, orbited (heading/pitch only) if a live drag
  // belongs to THIS stage, faded back to the path pose as t moves on from the drag.
  const pathStagePose = (s: 0 | 1 | 2): Keyframe => {
    const base = cameraKeyframe(kf, s, t, reduced);
    if (!orbit || orbitStage !== s || orbitSeedT === null) return base;
    const strength = orbitStrength(t, orbitSeedT);
    if (strength <= 0) return base;
    const held = orbitKeyframe(base, orbit, clampForStage(s));
    if (strength >= 1) return held;
    return transitPose(base, held, MASSING_CENTER, strength);
  };

  if (stage === 3) {
    return transitPose(
      orbitKeyframe(kf[3], orbit && orbitStage === 3 ? orbit : orbitOf(kf[3]), STAGE3_CLAMP),
      kf[4],
      MASSING_CENTER,
      transit,
    );
  }
  if (stage === 4) {
    return stage4Pose(kf, t, reduced, orbit && orbitStage === 4 ? stage4OrbitKeyframe(kf[4], orbit) : null);
  }
  if (stage === 0 || stage === 1 || stage === 2) {
    return pathStagePose(stage);
  }
  return cameraKeyframe(kf, stage, t, reduced);
}
