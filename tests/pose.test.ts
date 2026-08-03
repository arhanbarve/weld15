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
import { journeyPose, ORBIT_DECAY_SPAN } from "@/scene/pose";
import type { StageId } from "@/state/store";

/**
 * The equivalence fence P13 (docs/phases/P13-PRELOAD.md section 2.5) asks for: journeyPose
 * is a LIFT of CameraRig's old inline `want` branch (minus the walker case), not a rewrite,
 * and this pins the two equal at every (stage, t, reduced, orbit) combination the old branch
 * distinguished, so the branch could be deleted from CameraRig with nothing observable
 * changing. If this ever fails, the extraction drifted from the pose the app actually renders.
 *
 * STILL VALID FOR STAGES 3, 4 AND 5, AND FOR EVERY STAGE WHEN `orbit` IS NULL OR OWNED BY A
 * DIFFERENT STAGE: `orbitSeedT` (added for the frozen-zoom fix below) is read only by
 * pathStagePose's stage 0-2 branch, so this reference implementation still describes those
 * cases exactly. Stages 0-2 with an orbit the CURRENT stage owns are covered by their own
 * describe block below instead, since that is precisely the behaviour that changed.
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
            const got = journeyPose(kf, stage, t, reduced, c.orbit, c.orbitStage, null);
            const want = oldWant(kf, stage, t, reduced, c.orbit, c.orbitStage);
            expect(got).toEqual(want);
          });
        }
        // The orbit-belongs-to-this-stage case, at stages 3-4 (unaffected by orbitSeedT)
        // plus 5 (never reads orbit at all). Stages 0-2 move to their own block below.
        if (stage === 3 || stage === 4 || stage === 5) {
          it(`stage ${stage}, t=${t}, reduced=${reduced}, orbit owned by this stage`, () => {
            const got = journeyPose(kf, stage, t, reduced, SOME_ORBIT, stage, null);
            const want = oldWant(kf, stage, t, reduced, SOME_ORBIT, stage);
            expect(got).toEqual(want);
          });
        }
      }
    }
  }
});

/**
 * The fix: a stage 0-2 orbit fades back to the live path pose as t moves on from where it
 * was seeded, instead of holding forever and popping when the stage itself changes.
 *
 * dragging never touches rangeFt (CameraRig's onMove passes it through unchanged), so before
 * this fix a drag froze the camera's distance from its target at whatever the path pose was
 * at the moment of the drag -- further wheel notches kept advancing t but the rendered pose
 * stayed pinned to it, reading as a zoom that had stopped working, until the stage itself
 * changed and orbitStage stopped matching, at which point the pose fell back to the bare
 * path pose on a single frame: a hard pop rather than the drag wearing off.
 */
describe("stage 0-2: a held orbit fades back to the path pose as t moves past its seed", () => {
  const stages: (0 | 1 | 2)[] = [0, 1, 2];

  for (const stage of stages) {
    it(`stage ${stage}: freshly seeded (t === orbitSeedT) matches the old always-held pose`, () => {
      const t = 0.5;
      const got = journeyPose(kf, stage, t, false, SOME_ORBIT, stage, t);
      const want = orbitKeyframe(cameraKeyframe(kf, stage, t, false), SOME_ORBIT, clampForStage(stage));
      expect(got).toEqual(want);
    });

    it(`stage ${stage}: t moved a full ORBIT_DECAY_SPAN past the seed matches the bare path pose`, () => {
      const seedT = 0.2;
      const t = seedT + ORBIT_DECAY_SPAN;
      const got = journeyPose(kf, stage, t, false, SOME_ORBIT, stage, seedT);
      const want = cameraKeyframe(kf, stage, t, false);
      expect(got).toEqual(want);
    });

    it(`stage ${stage}: t moved further still matches the bare path pose (decay does not reverse)`, () => {
      const seedT = 0.1;
      const t = seedT + ORBIT_DECAY_SPAN * 3;
      const got = journeyPose(kf, stage, t, false, SOME_ORBIT, stage, seedT);
      const want = cameraKeyframe(kf, stage, t, false);
      expect(got).toEqual(want);
    });

    it(`stage ${stage}: halfway through the decay window matches the exact smoothstep blend`, () => {
      const seedT = 0.3;
      const t = seedT + ORBIT_DECAY_SPAN / 2;
      const got = journeyPose(kf, stage, t, false, SOME_ORBIT, stage, seedT);
      const base = cameraKeyframe(kf, stage, t, false);
      const held = orbitKeyframe(base, SOME_ORBIT, clampForStage(stage));
      // Same smoothstep shape funnel() uses, reimplemented locally rather than imported --
      // this test's job is to catch an accidental change to the fade's actual shape, not to
      // exercise its own copy of it against itself.
      const u = 1 - Math.min(1, Math.abs(t - seedT) / ORBIT_DECAY_SPAN);
      const strength = u * u * (3 - 2 * u);
      const want = transitPose(base, held, MASSING_CENTER, strength);
      expect(got).toEqual(want);
    });

    it(`stage ${stage}: t moved BACKWARD past the seed decays the same as moving forward`, () => {
      // The master scrubber can move t backward, and a drag wearing off should not care
      // which direction t moved away from the seed -- see orbitStrength's own Math.abs.
      const seedT = 0.6;
      const t = seedT - ORBIT_DECAY_SPAN;
      const got = journeyPose(kf, stage, t, false, SOME_ORBIT, stage, seedT);
      const want = cameraKeyframe(kf, stage, t, false);
      expect(got).toEqual(want);
    });
  }
});
