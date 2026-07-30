/**
 * Free orbit at stage 3, as pure spherical maths.
 *
 * The shell is single-sided and the masses have no underside, so an orbit that
 * lets the camera drop below grade renders Weld as a hole in the ground rather
 * than as a building. Every limit in STAGE3_CLAMP exists to keep the camera in
 * the region where the model is still a building.
 *
 * The two RADII are derived: both come out of weld.json's ring and ridge, and
 * they move if the building's dimensions do. The two POLAR limits are not. They
 * are chosen constants with a supporting calculation -- the only limit the
 * geometry actually forces is polar < 90, and 88 and 15 are framing decisions
 * inside that. Said plainly here because an earlier draft of this comment
 * claimed all four were derived, and treating a choice as a source is the single
 * most repeated error in docs/DIMENSION-AUDIT.md. If Weld's dimensions ever
 * change, the radii follow and the angles do not.
 *
 * No three.js import, for the reason rooms.ts and extrude.ts have none: this runs
 * in Node under vitest, where a spherical-to-cartesian sign error costs a second
 * to catch. The same error in a shader-side rig is a mirrored building, and
 * mirroring is already a live ambiguity in this project -- frames.ts says so --
 * which makes it exactly the class of bug a screenshot will not reveal.
 *
 * FRAMES. `azimuthDeg` is a compass bearing in the site frame, degrees east of
 * north, the same convention as WELD_AXIS_DEG and solar.ts: azimuth 13.2 looks
 * onto the north gable, 103.2 onto the east facade. `polarDeg` is measured from
 * straight up, three.js Spherical's phi, so 0 is a plan and 90 is level with the
 * target. The conversion into three's y-up / z-south basis happens once, in
 * orbitKeyframe, and orbitOf inverts it so the pair can be round-trip tested.
 */

import weld from "@/data/weld.json";
import { normalizeAngle } from "@/geo/frames";
import { WELD } from "@/geo/place";
import type { Keyframe } from "./stages";

export type Orbit = { azimuthDeg: number; polarDeg: number; radius: number };

export type OrbitClamp = {
  minRadius: number;
  maxRadius: number;
  minPolarDeg: number;
  maxPolarDeg: number;
};

/**
 * The footprint's circumscribing radius about the centroid, from Weld's own ring.
 *
 * 76.9 ft, at the north gable's west corner -- NOT at a wing corner, which is the
 * intuition Weld's dumbbell plan invites. The wings reach 31.5 ft across but sit
 * only 30 ft along the axis, while the gable ends sit 72 ft along it, so the ends
 * win on distance from the centroid by 45 ft.
 */
export const WELD_FOOTPRINT_RADIUS = (weld.rings[0] as number[][]).reduce(
  (max, p) => Math.max(max, Math.hypot(p[0]!, p[1]!)),
  0,
);

/**
 * Radius of the smallest centroid-centred sphere containing the whole massing:
 * the farthest ring vertex carried up to the ridge.
 *
 * No real point of the building is at that corner -- the roof has already sloped
 * back to the eaves by the time it reaches a gable corner -- so the conservatism
 * of the envelope IS the camera's clearance, and there is no separate clearance
 * figure to invent.
 */
const MASS_RADIUS = Math.hypot(WELD_FOOTPRINT_RADIUS, WELD.ridge);

/**
 * Stage 3's orbit limits: 114.9 to 344.7 ft, 15 to 88 degrees off vertical.
 *
 * minRadius = MASS_RADIUS. A camera that far from a target on the building's
 * vertical axis is outside the massing at every azimuth and every polar, because
 * |position| >= radius whenever the target sits above the centroid. It also
 * happens to frame the building: at the 45 deg fov stages 1-3 use, the 85.4 ft
 * ridge subtends 41 deg and the 143.3 ft length 64 deg, so Weld fills the frame
 * without reaching its edges.
 *
 * maxRadius = three times that. The factor is a camera decision, not a
 * measurement: stage 2 reads the Yard from 953 ft, and 345 ft is far enough
 * inside that for Weld to stay the subject rather than becoming one building
 * among the campus's 36.
 *
 * maxPolarDeg = 88, not 90, because under 90 the camera is strictly above its
 * target and therefore above grade for any target at or above grade -- which is
 * the only guarantee that keeps the undersideless masses from showing. The 2 deg
 * of margin also keeps the ground grid off the centre line of the frame, where it
 * reads as a hard horizontal seam.
 *
 * minPolarDeg = 15, not 0. At 15 deg the 60 ft facades still project to 15.5 ft
 * against a 143 ft roof plan, so the elevation reads; any nearer to straight down
 * and the shot is a plan of the roof with the building's height thrown away.
 */
export const STAGE3_CLAMP: OrbitClamp = {
  minRadius: MASS_RADIUS,
  maxRadius: MASS_RADIUS * 3,
  minPolarDeg: 15,
  maxPolarDeg: 88,
};

const DEG = Math.PI / 180;

function within(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Azimuth wrapped to (-180, 180], idempotently.
 *
 * The in-range short circuit is load-bearing, not defensive. normalizeAngle
 * computes ((deg + 180) % 360) - 180, and for about one input in a hundred the
 * add-then-subtract loses a bit: -205.73707503856653 wraps to 154.26292496143347
 * and wrapping THAT yields ...344, one ulp lower. clampOrbit is applied every
 * frame to state it has already clamped, so a drift of one ulp per frame is a
 * value that never settles.
 */
function wrapAzimuth(deg: number): number {
  if (deg > -180 && deg <= 180) return deg;
  return normalizeAngle(deg);
}

/** Spherical orbit state, forced into the clamp. Idempotent. */
export function clampOrbit(o: Orbit, clamp: OrbitClamp = STAGE3_CLAMP): Orbit {
  return {
    azimuthDeg: wrapAzimuth(o.azimuthDeg),
    polarDeg: within(o.polarDeg, clamp.minPolarDeg, clamp.maxPolarDeg),
    radius: within(o.radius, clamp.minRadius, clamp.maxRadius),
  };
}

/**
 * A spherical orbit about a keyframe's target, as a keyframe.
 *
 * The target and fov are the base's: orbiting changes where you stand, not what
 * you are looking at, so stage 3 keeps aiming at the point stages.ts chose.
 */
export function orbitKeyframe(
  base: Keyframe,
  o: Orbit,
  clamp: OrbitClamp = STAGE3_CLAMP,
): Keyframe {
  const c = clampOrbit(o, clamp);
  const phi = c.polarDeg * DEG;
  const flat = c.radius * Math.sin(phi);
  const east = flat * Math.sin(c.azimuthDeg * DEG);
  const north = flat * Math.cos(c.azimuthDeg * DEG);
  const up = c.radius * Math.cos(phi);

  return {
    // north is -Z, per frames.ts toThree. Getting this sign wrong mirrors the
    // whole orbit about the building's long axis and nothing on screen says so.
    position: [base.target[0] + east, base.target[1] + up, base.target[2] - north],
    target: [base.target[0], base.target[1], base.target[2]],
    fov: base.fov,
  };
}

/**
 * The orbit a keyframe already sits at. Inverse of orbitKeyframe.
 *
 * Needed to seed the orbit state from stages.ts: an orbit that starts anywhere
 * other than the base keyframe makes the camera jump on the first drag.
 */
export function orbitOf(kf: Keyframe): Orbit {
  const east = kf.position[0] - kf.target[0];
  const up = kf.position[1] - kf.target[1];
  const north = kf.target[2] - kf.position[2];
  const radius = Math.hypot(east, up, north);
  return {
    azimuthDeg: Math.atan2(east, north) / DEG,
    polarDeg: Math.acos(within(up / radius, -1, 1)) / DEG,
    radius,
  };
}
