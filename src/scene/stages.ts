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
import { suiteToThree, floorLevel } from "@/geo/place";
import type { SuiteParams } from "@/geo/rooms";
import type { Vec3 } from "@/geo/frames";
import type { StageId } from "@/state/store";

export type Keyframe = { position: Vec3; target: Vec3; fov: number };

const EYE = 5 + 10 / 12; // 5 ft 10 in

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

  // A point just outside the gable, level with bedroom B's window.
  const gableOutside = suiteToThree(
    bedB.u + bedB.du / 2,
    params.sectionLength + 40,
    floor + EYE,
    params,
  );
  // Just inside bedroom B.
  const insideBedB = suiteToThree(
    bedB.u + bedB.du / 2,
    bedB.v + bedB.dv - 4,
    floor + EYE,
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
    4: { position: gableOutside, target: insideBedB, fov: 50 },
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
 * Opacity of Weld's exterior shell and of the interior, across the threshold.
 *
 * The windows overlap on purpose: the exterior is gone by t = 0.7 and the
 * interior is fully up by 0.9, but the interior starts at 0.4, so no frame shows
 * neither. A gap there is what a viewer reads as a flicker.
 */
export function thresholdOpacity(stage: StageId, t: number): { shell: number; interior: number } {
  if (stage < 4) return { shell: 1, interior: 0 };
  if (stage > 4) return { shell: 0, interior: 1 };
  const ramp = (x: number, lo: number, hi: number) =>
    Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return {
    shell: 1 - ramp(t, 0.2, 0.7),
    interior: ramp(t, 0.4, 0.9),
  };
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
