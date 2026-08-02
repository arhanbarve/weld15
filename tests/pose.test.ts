import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import { keyframes, cameraKeyframe, REDUCED_CUT, type Keyframe } from "@/scene/stages";
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
} from "@/scene/orbit";
import { journeyPose } from "@/scene/pose";
import type { StageId } from "@/state/store";

/**
 * The equivalence fence P13 (docs/phases/P13-PRELOAD.md section 2.5) asks for: journeyPose
 * is a LIFT of CameraRig's old inline `want` branch (minus the walker case), not a rewrite,
 * and this pins the two equal at every (stage, t, reduced, orbit) combination the old branch
 * distinguished, so the branch could be deleted from CameraRig with nothing observable
 * changing. If this ever fails, the extraction drifted from the pose the app actually renders.
 */
function oldWant(
  kf: Record<StageId, Keyframe>,
  stage: StageId,
  t: number,
  reduced: boolean,
  orbit: Orbit | null,
  orbitStage: StageId | null,
): Keyframe {
  const transit = reduced ? (t < REDUCED_CUT ? 0 : 1) : t;
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

const kf = keyframes(DEFAULT_PARAMS);

const SOME_ORBIT: Orbit = { headingDeg: 37, pitchDeg: 40, rangeFt: 200 };

describe("journeyPose matches the old CameraRig branch it replaced", () => {
  const stages: StageId[] = [0, 1, 2, 3, 4, 5];
  const ts = [0, 0.25, 0.5, 0.75, 1];
  const cases: { orbit: Orbit | null; orbitStage: StageId | null }[] = [
    { orbit: null, orbitStage: null },
    { orbit: SOME_ORBIT, orbitStage: null }, // orbit set but on no stage: never applies
  ];

  for (const stage of stages) {
    for (const t of ts) {
      for (const reduced of [false, true]) {
        for (const c of cases) {
          it(`stage ${stage}, t=${t}, reduced=${reduced}, orbit=${c.orbit ? "set" : "null"}@${c.orbitStage}`, () => {
            const got = journeyPose(kf, stage, t, reduced, c.orbit, c.orbitStage);
            const want = oldWant(kf, stage, t, reduced, c.orbit, c.orbitStage);
            expect(got).toEqual(want);
          });
        }
        // The orbit-belongs-to-this-stage case, at every stage that actually reads it (0-4).
        if (stage !== 5) {
          it(`stage ${stage}, t=${t}, reduced=${reduced}, orbit owned by this stage`, () => {
            const got = journeyPose(kf, stage, t, reduced, SOME_ORBIT, stage);
            const want = oldWant(kf, stage, t, reduced, SOME_ORBIT, stage);
            expect(got).toEqual(want);
          });
        }
      }
    }
  }
});
