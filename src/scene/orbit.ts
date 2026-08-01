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
import type { Vec3 } from "@/geo/frames";
import { WELD } from "@/geo/place";
import type { StageId } from "@/state/store";
import { GABLE_BACK, cameraKeyframe, funnel, REDUCED_CUT, type Keyframe } from "./stages";

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
export const MASS_RADIUS = Math.hypot(WELD_FOOTPRINT_RADIUS, WELD.ridge);

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

/**
 * Stage 4's own orbit limits.
 *
 * NOT a plain copy of STAGE3_CLAMP's reasoning, even though the numbers rhyme.
 * STAGE3_CLAMP's minRadius = MASS_RADIUS is safe because orbitKeyframe()
 * clamps radius FROM THE TARGET it is given, and kf[3].target = [0, 42, 0]
 * sits ON the building's vertical axis -- the proof below STAGE3_CLAMP's own
 * declaration depends on that. kf[4].target is insideBedB, a point inside a
 * specific bedroom, nowhere near that axis; clamping radius-from-insideBedB
 * to MASS_RADIUS would NOT keep the camera outside the massing sphere
 * centred on MASSING_CENTER -- the same gap transitPose's own docblock warns
 * about for a keyframe's look-at target versus the clamp's real centre.
 *
 * So stage 4's orbit is built by stage4OrbitKeyframe() below, which clamps
 * radius about MASSING_CENTER directly (position = MASSING_CENTER +
 * sphericalOffset) and only THEN substitutes kf[4].target as where the
 * camera looks. That makes minRadius = MASS_RADIUS an equality, not an
 * inequality that happens to hold for one particular target: position is
 * built AT that radius from the origin, so a clamped radius of MASS_RADIUS
 * puts the camera exactly MASS_RADIUS from MASSING_CENTER, for any azimuth
 * and any polar in range -- no on-axis argument required.
 *
 * maxRadius = 2 * GABLE_BACK. CHOSEN: GABLE_BACK is stages.ts's own stand-off
 * for kf[4] (~123.6 ft), and twice it lets the viewer pull back far enough to
 * see Weld's gable whole without reaching stage 3's 344.7 ft, where Weld stops
 * being the subject and becomes one building among the campus's.
 *
 * minPolarDeg / maxPolarDeg = 15 / 88, unchanged, the same argument as stage 3.
 */
export const STAGE4_CLAMP: OrbitClamp = {
  minRadius: MASS_RADIUS,
  maxRadius: 2 * GABLE_BACK,
  minPolarDeg: 15,
  maxPolarDeg: 88,
};

/**
 * Stage 4's free-orbit pose: circles MASSING_CENTER, looks at kf[4].target.
 *
 * The pivot for the radius clamp (MASSING_CENTER) and the point the camera
 * looks at (kf[4].target, insideBedB) are deliberately DIFFERENT points --
 * exactly the separation transitPose makes between `center` and a keyframe's
 * own `target`. Reuses orbitKeyframe with target = MASSING_CENTER to get a
 * position built at the clamped radius from the origin, then swaps in
 * kf4.target for the look-at before returning, the same substitution
 * transitPose's own NO_CLAMP call makes.
 */
export function stage4OrbitKeyframe(kf4: Keyframe, o: Orbit): Keyframe {
  const { position } = orbitKeyframe(
    { position: MASSING_CENTER, target: MASSING_CENTER, fov: kf4.fov },
    o,
    STAGE4_CLAMP,
  );
  return { position, target: kf4.target, fov: kf4.fov };
}

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

/**
 * The actual centre of the sphere MASS_RADIUS bounds: Weld's centroid, at grade.
 *
 * NOT a keyframe's look-at target. kf[3].target sits at [0, 42, 0] -- partway up the
 * building, chosen for framing -- while MASS_RADIUS above is derived from a sphere
 * centred at height 0: the farthest footprint vertex, carried up to the ridge, is
 * hypot(WELD_FOOTPRINT_RADIUS, WELD.ridge) from a centre at grade, not from a centre 42
 * ft up. Centring a clearance guarantee on the look-at target instead only holds within
 * STAGE3_CLAMP's own polar range (see the comment on minRadius above); this is the point
 * a guarantee has to be centred on to hold everywhere.
 */
export const MASSING_CENTER: Vec3 = [0, 0, 0];

/** An OrbitClamp that clamps nothing, for transitPose below. */
const NO_CLAMP: OrbitClamp = {
  minRadius: -Infinity,
  maxRadius: Infinity,
  minPolarDeg: -Infinity,
  maxPolarDeg: Infinity,
};

/**
 * Interpolate two poses in SPHERICAL coordinates about `center`, not in cartesian space.
 *
 * A straight line between two points outside a sphere is not guaranteed to stay outside
 * it -- the chord can cut through the middle even when both ends clear it. That is
 * exactly what a raw position blend() did for the stage 3 -> 4 transit: it dipped to 108
 * ft against MASS_RADIUS's 114.9 ft, despite both ends sitting at 195-251 ft from
 * MASSING_CENTER. Lerping the RADIUS about `center` instead of lerping cartesian position
 * keeps every point on the path at a radius between radius(from) and radius(to) --
 * never outside that range, because radius and the two angles are independent
 * coordinates -- so the path's closest approach to `center` is
 * min(radius(from), radius(to)), which is >= MASS_RADIUS whenever both ends already are.
 *
 * `center` MUST be the real centre MASS_RADIUS is measured from -- MASSING_CENTER above,
 * not either keyframe's own look-at target -- or the guarantee this function exists for
 * does not hold.
 *
 * The look-at target and fov are plain linear lerps, unaffected by `center`: only the
 * camera's POSITION needs the clearance guarantee, and constraining where the camera
 * LOOKS to a sphere would be answering a question nobody asked.
 *
 * Reuses orbitOf/orbitKeyframe rather than reimplementing the spherical maths: orbitOf
 * extracts (azimuth, polar, radius) of a position about an arbitrary target -- here
 * `center` rather than the keyframe's own target -- and orbitKeyframe is its exact
 * inverse. NO_CLAMP is passed through because STAGE3_CLAMP's polar/radius ranges are a
 * stage-3-orbit framing decision that this transit deliberately leaves (kf[4] sits
 * nowhere near them), and clamping here would corrupt the interpolation and break the
 * exact-endpoint guarantee at t = 1.
 */
export function transitPose(from: Keyframe, to: Keyframe, center: Vec3, t: number): Keyframe {
  const k = Math.min(1, Math.max(0, t));
  const a = orbitOf({ position: from.position, target: center, fov: from.fov });
  const b = orbitOf({ position: to.position, target: center, fov: to.fov });
  const radius = a.radius + (b.radius - a.radius) * k;
  const polarDeg = a.polarDeg + (b.polarDeg - a.polarDeg) * k;
  // Shortest way round, same reasoning as wrapAzimuth above: a straight lerp from an
  // azimuth of -170 to one of 170 would swing 340 degrees the long way rather than the
  // 20 degrees actually between them.
  const dAz = wrapAzimuth(b.azimuthDeg - a.azimuthDeg);
  const azimuthDeg = a.azimuthDeg + dAz * k;
  const { position } = orbitKeyframe(
    { position: center, target: center, fov: 0 },
    { azimuthDeg, polarDeg, radius },
    NO_CLAMP,
  );
  const mix = (p: number, q: number) => p + (q - p) * k;
  return {
    position,
    target: [
      mix(from.target[0], to.target[0]),
      mix(from.target[1], to.target[1]),
      mix(from.target[2], to.target[2]),
    ],
    fov: mix(from.fov, to.fov),
  };
}

/**
 * Stage 4's pose, given the free orbit the viewer may have set.
 *
 * `held` is stage4OrbitKeyframe(kf[4], orbit) when the viewer has dragged, or
 * null when they have not.
 *
 * THE BLEND IS transitPose, NOT blend(). A straight cartesian blend() between
 * `held` (an orbit anywhere in STAGE4_CLAMP's range) and the fixed approach
 * path clips into Weld's real massing at some (orbit, t) pairs -- measured,
 * in tests/stages.test.ts, at t ~= 0.36 for an orbit near STAGE4_CLAMP's own
 * minRadius -- the identical failure mode transitPose's own docblock records
 * finding for the stage 3 -> 4 transit, and for the identical reason: a
 * chord between two points outside a sphere is not guaranteed to stay
 * outside it. transitPose's radius-about-MASSING_CENTER interpolation does
 * not have that failure mode, and `held`'s own radius from MASSING_CENTER is
 * already >= MASS_RADIUS by STAGE4_CLAMP's construction, so the blended
 * path's closest approach to MASSING_CENTER is bounded below by
 * min(radius(held), radius(path)) -- see transitPose's own comment for why.
 *
 * `held === null` returns cameraKeyframe(...) BY IDENTITY, the same call
 * with nothing else evaluated -- the regression fence: a viewer who never
 * drags gets precisely today's stage 4, because this function does not do
 * anything different for that case, not because it does the same arithmetic
 * and arrives at the same answer.
 *
 * `funnel(t) >= 1` returns the path pose BY IDENTITY too, not by blending to
 * it. transitPose(a, b, center, 1) reconstructs b's position through a round
 * trip of orbitOf/orbitKeyframe, which agrees with b to a float ulp rather
 * than exactly, and the crossing is the one place a camera position is
 * compared for equality -- by tests/stages.test.ts and by CameraRig's own
 * MOVE_EPS.
 */
export function stage4Pose(
  kf: Record<StageId, Keyframe>,
  t: number,
  reduced: boolean,
  held: Keyframe | null,
): Keyframe {
  const path = cameraKeyframe(kf, 4, t, reduced);
  if (!held) return path;
  // Reduced motion gets the same jump-at-midpoint shape the stage 3 -> 4
  // transit and the threshold crossing both use, for the same reason: under
  // reduced motion nothing geometrically between two poses may ever render.
  const f = reduced ? (t < REDUCED_CUT ? 0 : 1) : funnel(t);
  if (f >= 1) return path;
  if (f <= 0) return held;
  return transitPose(held, path, MASSING_CENTER, f);
}
