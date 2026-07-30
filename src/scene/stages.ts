/**
 * Camera keyframes for the six stages, in feet, three.js world space.
 *
 * Origin is Weld's centroid and one unit is one foot, matching frames.ts. The
 * whole run is 4,000 ft out down to 2 ft inside a bedroom -- about 2,000:1, well
 * within float32, which only loses depth precision past roughly 1e5:1.
 *
 * Stage 0 is the exception. Earth at foot scale would be 2.1e7 ft in radius, so
 * the globe lives in its own scene at unit scale and stage 0 -> 1 is a hard cut.
 * Stages 1 -> 5 are one continuous move.
 */

import { buildSuite } from "@/geo/rooms";
import { suiteToThree, floorLevel, WELD } from "@/geo/place";
import type { SuiteParams } from "@/geo/rooms";
import type { Vec3 } from "@/geo/frames";
import type { StageId } from "@/state/store";

export type Keyframe = { position: Vec3; target: Vec3; fov: number };

const EYE = 5 + 10 / 12; // 5 ft 10 in

/**
 * Vertical field of view for the approach to the gable, degrees.
 *
 * Named because the stand-off distance is derived from it. The two were independent
 * numbers once and the distance quietly stopped framing the building.
 */
const GABLE_FOV = 50;

/**
 * How much taller than the ridge the frame must be, as a multiple.
 *
 * 1.35 leaves the roof clear of the top edge and some ground at the bottom, so the
 * gable reads as a building end rather than as a crop of one.
 */
const GABLE_FRAMING = 1.35;

/**
 * Where the camera sits and looks for each stage.
 *
 * Stages 4 and 5 depend on the suite params, because both are positioned
 * relative to bedroom B, which moves when a dimension slider moves.
 */
export function keyframes(params: SuiteParams): Record<StageId, Keyframe> {
  const suite = buildSuite(params);
  const bedB = suite.rooms.find((r) => r.id === "bedB")!;
  const floor = floorLevel(1);

  // Outside the gable, far enough back that Weld reads as a building.
  //
  // This used to sit 40 ft out at eye height, and that was a wall rather than a
  // shot. At the 50 degree vertical fov below, 40 ft frames 0.93 * 40 = 37 ft of a
  // building 85.4 ft to the ridge, centred on a 17.8 ft eye -- so the frame held a
  // slice of brick from the ground to about 36 ft, no roof, no sky, no silhouette.
  // The journey gate caught it as "stage 4 is a flat wash", 3 distinct tones, and
  // the gate was right: a featureless wall lit by a sun with shadows off IS a
  // smooth gradient. The bug was the framing, not the render.
  //
  // So the distance is derived from what has to fit rather than chosen: the ridge
  // height plus headroom, divided by the tangent of the half fov. Written as a
  // function of GABLE_FOV so the two cannot drift apart, which is how the 40
  // survived a change of fov in the first place.
  const gableBack =
    (WELD.ridge * GABLE_FRAMING) / (2 * Math.tan(((GABLE_FOV / 2) * Math.PI) / 180));
  const gableOutside = suiteToThree(
    bedB.u + bedB.du / 2,
    params.sectionLength + gableBack,
    floor + WELD.ridge / 2,
    params,
  );
  // Into bedroom B, but aimed high enough that the approach looks at the building
  // and not at the ground in front of it. The blend to stage 5 brings the eye down.
  const insideBedB = suiteToThree(
    bedB.u + bedB.du / 2,
    bedB.v + bedB.dv - 4,
    floor + WELD.ridge / 4,
    params,
  );
  // Stage 5 stands just inside bedroom B, back to the gable, looking south down
  // the room.
  //
  // It deliberately does NOT stand in the hall, even though the hall is the
  // better shot. A straight camera path from bedroom B to the hall passes through
  // the partition between them, and at t = 0.7 the camera ended up half a foot
  // from that wall -- exactly the near plane -- so every face clipped and the
  // frame went completely empty. Routing a path through the doorway needs a
  // spline and collision, which is P7's first-person work.
  // Diagonally across the room, from the inner corner toward the gable window.
  //
  // Centred-and-facing-a-wall was the first attempt and it is geometrically
  // correct but a useless shot: standing 7 ft from a 16 ft wall in a 10 ft room,
  // that wall fills the entire frame. A diagonal shows two walls, the floor, and
  // the room's actual depth.
  const inBedB = suiteToThree(bedB.u + 2.5, bedB.v + 2.5, floor + EYE, params);
  const bedBTarget = suiteToThree(
    bedB.u + bedB.du - 2,
    bedB.v + bedB.dv - 1,
    floor + EYE - 2,
    params,
  );

  return {
    0: { position: [0, 0, 2.6], target: [0, 0, 0], fov: 45 },
    1: { position: [1500, 2600, 2600], target: [0, 40, 0], fov: 45 },
    2: { position: [420, 620, 620], target: [0, 30, 0], fov: 45 },
    3: { position: [150, 110, 190], target: [0, 42, 0], fov: 45 },
    4: { position: gableOutside, target: insideBedB, fov: GABLE_FOV },
    5: { position: inBedB, target: bedBTarget, fov: 62 },
  };
}

/** Straight-line blend between two keyframes, used across the threshold. */
export function blend(a: Keyframe, b: Keyframe, t: number): Keyframe {
  const k = Math.min(1, Math.max(0, t));
  const mix = (p: Vec3, q: Vec3): Vec3 => [
    p[0] + (q[0] - p[0]) * k,
    p[1] + (q[1] - p[1]) * k,
    p[2] + (q[2] - p[2]) * k,
  ];
  return {
    position: mix(a.position, b.position),
    target: mix(a.target, b.target),
    fov: a.fov + (b.fov - a.fov) * k,
  };
}

/**
 * Where the crossing cuts under reduced motion.
 *
 * Halfway, so the camera and the shell change on the SAME frame: any other value
 * gives a frame with the camera already inside and the wall still there, or the
 * wall gone and the camera still outside, and both read as a glitch rather than as
 * a cut.
 *
 * Exported because Threshold.tsx cuts its scanline sweep at the same instant and
 * currently declares its own HARD_CUT = 0.5 to do it. Two constants at one value is
 * one too many: the sweep and the camera have to cut together or the wall's
 * dissolve and the step through it disagree by a frame. Threshold.tsx should import
 * this, and until it does the two have to be moved together.
 */
export const REDUCED_CUT = 0.5;

/**
 * Opacity of Weld's exterior shell and of the interior, across the threshold.
 *
 * The windows overlap on purpose: the exterior is gone by t = 0.7 and the
 * interior is fully up by 0.9, but the interior starts at 0.4, so no frame shows
 * neither. A gap there is what a viewer reads as a flicker.
 *
 * `reduced` replaces both ramps with one hard cut. It is a third argument with a
 * default rather than a rewrite of the signature because every existing caller and
 * every assertion in tests/stages.test.ts is about the full-motion ramps, and those
 * are the ones that must not move.
 */
export function thresholdOpacity(
  stage: StageId,
  t: number,
  reduced = false,
): { shell: number; interior: number } {
  if (stage < 4) return { shell: 1, interior: 0 };
  if (stage > 4) return { shell: 0, interior: 1 };
  // No crossfade at all, not a fast one. MASTER.md allows a 120 ms crossfade at a
  // stage change, but a dissolve is what the threshold IS -- fading it quickly is
  // still the effect the guideline exists to switch off.
  if (reduced) {
    return t < REDUCED_CUT ? { shell: 1, interior: 0 } : { shell: 0, interior: 1 };
  }
  const ramp = (x: number, lo: number, hi: number) =>
    Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return {
    shell: 1 - ramp(t, 0.2, 0.7),
    interior: ramp(t, 0.4, 0.9),
  };
}

/**
 * The keyframe the camera should hold, for a stage and its progress.
 *
 * Stage 4 is the only stage with a path rather than a place -- it runs from outside
 * the gable to inside bedroom B -- so it is the only stage this does anything to.
 *
 * REDUCED MOTION IS A JUMP CUT, and this is where that is true. The crossing is not
 * walked more quickly; it is not walked. The return value is kf[4] before the cut
 * and kf[5] after it, so the only camera positions that occur anywhere in the
 * stage-4 sequence are two of the six keyframes and nothing between them ever
 * exists to be rendered. Snapping in CameraRig would not be enough on its own: the
 * camera would still visit every interpolated position, one per slider event, and
 * an interpolated position arrived at instantly is still an interpolated position.
 *
 * Observable from outside via window.__cam.path -- see CameraRig.
 */
export function cameraKeyframe(
  kf: Record<StageId, Keyframe>,
  stage: StageId,
  t: number,
  reduced = false,
): Keyframe {
  if (stage !== 4) return kf[stage];
  if (reduced) return t < REDUCED_CUT ? kf[4] : kf[5];
  return blend(kf[4], kf[5], t);
}

/** Which stages need the campus, Weld's shell, and the interior mounted. */
export function visibility(stage: StageId): {
  globe: boolean;
  campus: boolean;
  weld: boolean;
  interior: boolean;
} {
  return {
    globe: stage === 0,
    campus: stage >= 1 && stage <= 3,
    weld: stage >= 2 && stage <= 4,
    // Mounted a stage early so its geometry is warm before the threshold needs it.
    interior: stage >= 3,
  };
}
