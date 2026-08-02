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
 * `orbit`/`orbitStage` are the SAME pair CameraRig reads off the store: a live drag/orbit
 * only applies when `orbitStage === stage` (see CameraRig's own comment on that gate). A
 * caller with no live orbit -- P13's preloader, every sampled pose -- passes `orbit: null`
 * and gets exactly the stage's own default framing.
 */
export function journeyPose(
  kf: Record<StageId, Keyframe>,
  stage: StageId,
  t: number,
  reduced: boolean,
  orbit: Orbit | null,
  orbitStage: StageId | null,
): Keyframe {
  // Reduced motion for the stage 3 -> 4 transit: cameraKeyframe's own reduced branch does
  // not fire for stage 3, since stage 3 has no path of its own to jump within. This gives
  // the transit the same jump-at-midpoint shape stage 4's crossing already has.
  const transit = reduced ? (t < REDUCED_CUT ? 0 : 1) : t;

  // Stages 0-2: the stage's own path pose, orbited (heading/pitch only) if a live drag
  // belongs to THIS stage.
  const pathStagePose = (s: 0 | 1 | 2): Keyframe => {
    const base = cameraKeyframe(kf, s, t, reduced);
    return orbit && orbitStage === s ? orbitKeyframe(base, orbit, clampForStage(s)) : base;
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
