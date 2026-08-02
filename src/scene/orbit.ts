/**
 * Free orbit at stages 0-4, as pure spherical maths.
 *
 * P11 REPARAMETRIZATION (task 7, docs/phases/P11-PHOTOREAL.md section 2.3-2.4). This module
 * used to hold `{ azimuthDeg, polarDeg, radius }`, three.js Spherical's own `phi`-from-
 * straight-up convention. The store's `Orbit` (src/state/store.ts) is now
 * `{ headingDeg, pitchDeg, rangeFt }` -- geo/rig.ts's `GeoPose` field names, with
 * `pitchDeg = 90 - polarDeg` (0 level, 90 straight down, instead of 0 straight down, 90
 * level). `headingDeg` and `azimuthDeg` are THE SAME NUMBER under the same convention
 * (compass bearing, degrees east of north, `Math.atan2(east, north)`) -- only the vertical
 * angle's sign convention and name changed.
 *
 * THIS IS A RENAME AND A SUBSTITUTION, NOT A REWRITE OF THE GEOMETRY. Substituting
 * `pitch = 90 - polar` into the old formulas (`flat = radius * sin(phi)`, `up = radius *
 * cos(phi)`) gives `horizontal = range * cos(pitch)`, `up = range * sin(pitch)` --
 * algebraically identical to geo/rig.ts's `poseToKeyframe`, just applied to an arbitrary
 * CARTESIAN site-frame target (a keyframe's own `.target`, or MASSING_CENTER) rather than a
 * geodetic lat/lon one. That is why this module does NOT become a thin wrapper over
 * `poseToKeyframe`/`keyframeToPose`/`clampPose`: those functions require a lat/lon and go
 * through `geodeticToSite`/`siteToGeodetic`'s WGS-84 round trip (Bowring's iteration,
 * converged to ~1e-9 m, not to machine epsilon) to get there, and this module's callers --
 * stage 3's orbit about `kf[3].target`, stage 4's about `MASSING_CENTER`, `transitPose`'s
 * interpolation about either -- orbit about a plain Cartesian point that is not, in general,
 * the camera's own look-at target's geodetic projection (MASSING_CENTER is Weld's centroid
 * at grade, not a lat/lon). Going through the geodetic round trip here would buy nothing and
 * would reintroduce ~1e-6 to 1e-9 ft of noise into exactly the numeric assertions
 * (`toBeCloseTo(_, 6)`) tests/orbit.test.ts already makes about this arithmetic -- a real
 * "meaningfully different" case per the task's own carve-out for not forcing the wrap.
 *
 * `OrbitClamp` is gone; every clamp below is `PoseClamp` (geo/rig.ts), reparametrized
 * numerically (`minPitchDeg = 90 - maxPolarDeg`, `maxPitchDeg = 90 - minPolarDeg`) rather
 * than merely renamed -- see STAGE3_CLAMP/STAGE4_CLAMP below for the actual numbers, which
 * land exactly on section 2.4's table (2 to 75 degrees) once the substitution is applied.
 *
 * The shell is single-sided and the masses have no underside, so an orbit that
 * lets the camera drop below grade renders Weld as a hole in the ground rather
 * than as a building. Every limit in STAGE3_CLAMP exists to keep the camera in
 * the region where the model is still a building.
 *
 * The two RANGES are derived: both come out of weld.json's ring and ridge, and
 * they move if the building's dimensions do. The two PITCH limits are not. They
 * are chosen constants with a supporting calculation -- the only limit the
 * geometry actually forces is pitch > 0 (camera strictly above its target), and
 * 2 and 75 are framing decisions inside that. Said plainly here because an earlier
 * draft of this comment claimed all four were derived, and treating a choice as a
 * source is the single most repeated error in docs/DIMENSION-AUDIT.md. If Weld's
 * dimensions ever change, the ranges follow and the angles do not.
 *
 * No three.js import, for the reason rooms.ts and extrude.ts have none: this runs
 * in Node under vitest, where a spherical-to-cartesian sign error costs a second
 * to catch. The same error in a shader-side rig is a mirrored building, and
 * mirroring is already a live ambiguity in this project -- frames.ts says so --
 * which makes it exactly the class of bug a screenshot will not reveal.
 *
 * FRAMES. `headingDeg` is a compass bearing in the site frame, degrees east of
 * north, the same convention as WELD_AXIS_DEG and solar.ts: heading 13.2 looks
 * onto the north gable, 103.2 onto the east facade. `pitchDeg` is measured from the
 * target's local horizontal, geo/rig.ts's own GeoPose convention: 0 level, 90 straight
 * down. The conversion into three's y-up / z-south basis happens once, in
 * orbitKeyframe, and orbitOf inverts it so the pair can be round-trip tested.
 */

import weld from "@/data/weld.json";
import { normalizeAngle } from "@/geo/frames";
import type { Vec3 } from "@/geo/frames";
import { WELD } from "@/geo/place";
import type { StageId } from "@/state/store";
import type { PoseClamp } from "./geo/rig";
import { GABLE_BACK, cameraKeyframe, funnel, REDUCED_CUT, type Keyframe } from "./stages";

export type Orbit = { headingDeg: number; pitchDeg: number; rangeFt: number };

export type { PoseClamp } from "./geo/rig";

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
 * Stage 3's orbit limits: 114.9 to 344.7 ft, 2 to 75 degrees of pitch.
 *
 * minRangeFt = MASS_RADIUS. A camera that far from a target on the building's
 * vertical axis is outside the massing at every heading and every pitch, because
 * |position| >= range whenever the target sits above the centroid. It also
 * happens to frame the building: at the 45 deg fov stages 1-3 use, the 85.4 ft
 * ridge subtends 41 deg and the 143.3 ft length 64 deg, so Weld fills the frame
 * without reaching its edges.
 *
 * maxRangeFt = three times that. The factor is a camera decision, not a
 * measurement: stage 2 reads the Yard from 953 ft, and 345 ft is far enough
 * inside that for Weld to stay the subject rather than becoming one building
 * among the campus's 36.
 *
 * minPitchDeg = 2 (was maxPolarDeg = 88, and pitchDeg = 90 - polarDeg), not 0,
 * because above 0 the camera is strictly above its target and therefore above
 * grade for any target at or above grade -- which is the only guarantee that
 * keeps the undersideless masses from showing. The 2 deg of margin also keeps
 * the ground grid off the centre line of the frame, where it reads as a hard
 * horizontal seam.
 *
 * maxPitchDeg = 75 (was minPolarDeg = 15), not 90. At pitch 75 the 60 ft facades
 * still project to 15.5 ft against a 143 ft roof plan, so the elevation reads;
 * any nearer to straight down (pitch 90) and the shot is a plan of the roof with
 * the building's height thrown away.
 */
export const STAGE3_CLAMP: PoseClamp = {
  minRangeFt: MASS_RADIUS,
  maxRangeFt: MASS_RADIUS * 3,
  minPitchDeg: 2,
  maxPitchDeg: 75,
};

/**
 * Stage 4's own orbit limits.
 *
 * NOT a plain copy of STAGE3_CLAMP's reasoning, even though the numbers rhyme.
 * STAGE3_CLAMP's minRangeFt = MASS_RADIUS is safe because orbitKeyframe()
 * clamps range FROM THE TARGET it is given, and kf[3].target = [0, 42, 0]
 * sits ON the building's vertical axis -- the proof below STAGE3_CLAMP's own
 * declaration depends on that. kf[4].target is insideBedB, a point inside a
 * specific bedroom, nowhere near that axis; clamping range-from-insideBedB
 * to MASS_RADIUS would NOT keep the camera outside the massing sphere
 * centred on MASSING_CENTER -- the same gap transitPose's own docblock warns
 * about for a keyframe's look-at target versus the clamp's real centre.
 *
 * So stage 4's orbit is built by stage4OrbitKeyframe() below, which clamps
 * range about MASSING_CENTER directly (position = MASSING_CENTER +
 * sphericalOffset) and only THEN substitutes kf[4].target as where the
 * camera looks. That makes minRangeFt = MASS_RADIUS an equality, not an
 * inequality that happens to hold for one particular target: position is
 * built AT that range from the origin, so a clamped range of MASS_RADIUS
 * puts the camera exactly MASS_RADIUS from MASSING_CENTER, for any heading
 * and any pitch in range -- no on-axis argument required.
 *
 * maxRangeFt = 2 * GABLE_BACK. CHOSEN: GABLE_BACK is stages.ts's own stand-off
 * for kf[4] (~123.6 ft), and twice it lets the viewer pull back far enough to
 * see Weld's gable whole without reaching stage 3's 344.7 ft, where Weld stops
 * being the subject and becomes one building among the campus's.
 *
 * minPitchDeg / maxPitchDeg = 2 / 75, unchanged, the same argument as stage 3.
 */
export const STAGE4_CLAMP: PoseClamp = {
  minRangeFt: MASS_RADIUS,
  maxRangeFt: 2 * GABLE_BACK,
  minPitchDeg: 2,
  maxPitchDeg: 75,
};

/**
 * Stage 0's orbit limits: pitch 25 to 89, per P11-PHOTOREAL.md section 2.4 -- below 25
 * degrees from 1.5 Earth radii the camera passes behind the limb. Range is not
 * independently drag/wheel-adjustable at this stage (CameraRig.tsx: the wheel drives the
 * journey everywhere, and drag only ever touches heading/pitch), so the range bound here
 * is a wide, permissive placeholder rather than a safety limit -- 1 ft to 1e9 ft spans
 * every altitude this app's descent ever reaches, so it never actually binds; it exists
 * only because clampOrbit's signature always needs a full PoseClamp.
 */
export const STAGE0_CLAMP: PoseClamp = {
  minRangeFt: 1,
  maxRangeFt: 1e9,
  minPitchDeg: 25,
  maxPitchDeg: 89,
};

/**
 * Stages 1 and 2's orbit limits: pitch 20 to 89, per P11-PHOTOREAL.md section 2.4 -- keeps
 * the horizon out of frame, the same argument DESCENT_FOV's docblock in stages.ts already
 * makes for the fixed tilts these stages used before dragging existed. Range is a wide
 * placeholder for the same reason STAGE0_CLAMP's is.
 */
export const STAGE12_CLAMP: PoseClamp = {
  minRangeFt: 1,
  maxRangeFt: 1e9,
  minPitchDeg: 20,
  maxPitchDeg: 89,
};

/**
 * The PoseClamp a given stage drags and wheels within. CameraRig.tsx's single drag
 * handler reads this once per stage rather than switching on the stage id itself, so the
 * per-stage numbers live in exactly one place.
 */
export function clampForStage(stage: StageId): PoseClamp {
  if (stage === 0) return STAGE0_CLAMP;
  if (stage === 1 || stage === 2) return STAGE12_CLAMP;
  if (stage === 4) return STAGE4_CLAMP;
  return STAGE3_CLAMP;
}

/**
 * Stage 4's free-orbit pose: circles MASSING_CENTER, looks at kf[4].target.
 *
 * The pivot for the range clamp (MASSING_CENTER) and the point the camera
 * looks at (kf[4].target, insideBedB) are deliberately DIFFERENT points --
 * exactly the separation transitPose makes between `center` and a keyframe's
 * own `target`. Reuses orbitKeyframe with target = MASSING_CENTER to get a
 * position built at the clamped range from the origin, then swaps in
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
 * Heading wrapped to (-180, 180], idempotently.
 *
 * The in-range short circuit is load-bearing, not defensive. normalizeAngle
 * computes ((deg + 180) % 360) - 180, and for about one input in a hundred the
 * add-then-subtract loses a bit: -205.73707503856653 wraps to 154.26292496143347
 * and wrapping THAT yields ...344, one ulp lower. clampOrbit is applied every
 * frame to state it has already clamped, so a drift of one ulp per frame is a
 * value that never settles.
 */
function wrapHeading(deg: number): number {
  if (deg > -180 && deg <= 180) return deg;
  return normalizeAngle(deg);
}

/** Spherical orbit state, forced into the clamp. Idempotent. */
export function clampOrbit(o: Orbit, clamp: PoseClamp = STAGE3_CLAMP): Orbit {
  return {
    headingDeg: wrapHeading(o.headingDeg),
    pitchDeg: within(o.pitchDeg, clamp.minPitchDeg, clamp.maxPitchDeg),
    rangeFt: within(o.rangeFt, clamp.minRangeFt, clamp.maxRangeFt),
  };
}

/**
 * A spherical orbit about a keyframe's target, as a keyframe.
 *
 * The target and fov are the base's: orbiting changes where you stand, not what
 * you are looking at, so a stage keeps aiming at the point stages.ts chose.
 *
 * pitch = 90 - (three.js Spherical's old phi, measured from straight up), so
 * horizontal = range * cos(pitch) and up = range * sin(pitch) -- see this file's
 * header for the substitution that shows this reproduces the old radius/polar
 * arithmetic exactly, coordinate for coordinate.
 */
export function orbitKeyframe(
  base: Keyframe,
  o: Orbit,
  clamp: PoseClamp = STAGE3_CLAMP,
): Keyframe {
  const c = clampOrbit(o, clamp);
  const pitch = c.pitchDeg * DEG;
  const heading = c.headingDeg * DEG;
  const horizontal = c.rangeFt * Math.cos(pitch);
  const up = c.rangeFt * Math.sin(pitch);
  const east = horizontal * Math.sin(heading);
  const north = horizontal * Math.cos(heading);

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
  const horizontal = Math.hypot(east, north);
  const rangeFt = Math.hypot(east, up, north);
  return {
    headingDeg: Math.atan2(east, north) / DEG,
    pitchDeg: Math.atan2(up, horizontal) / DEG,
    rangeFt,
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
 * STAGE3_CLAMP's own pitch range (see the comment on minRangeFt above); this is the point
 * a guarantee has to be centred on to hold everywhere.
 */
export const MASSING_CENTER: Vec3 = [0, 0, 0];

/** A PoseClamp that clamps nothing, for transitPose below. */
const NO_CLAMP: PoseClamp = {
  minRangeFt: -Infinity,
  maxRangeFt: Infinity,
  minPitchDeg: -Infinity,
  maxPitchDeg: Infinity,
};

/**
 * Interpolate two poses in SPHERICAL coordinates about `center`, not in cartesian space.
 *
 * A straight line between two points outside a sphere is not guaranteed to stay outside
 * it -- the chord can cut through the middle even when both ends clear it. That is
 * exactly what a raw position blend() did for the stage 3 -> 4 transit: it dipped to 108
 * ft against MASS_RADIUS's 114.9 ft, despite both ends sitting at 195-251 ft from
 * MASSING_CENTER. Lerping the RANGE about `center` instead of lerping cartesian position
 * keeps every point on the path at a range between range(from) and range(to) --
 * never outside that range, because range and the two angles are independent
 * coordinates -- so the path's closest approach to `center` is
 * min(range(from), range(to)), which is >= MASS_RADIUS whenever both ends already are.
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
 * extracts (heading, pitch, range) of a position about an arbitrary target -- here
 * `center` rather than the keyframe's own target -- and orbitKeyframe is its exact
 * inverse. NO_CLAMP is passed through because STAGE3_CLAMP's pitch/range ranges are a
 * stage-3-orbit framing decision that this transit deliberately leaves (kf[4] sits
 * nowhere near them), and clamping here would corrupt the interpolation and break the
 * exact-endpoint guarantee at t = 1.
 */
export function transitPose(from: Keyframe, to: Keyframe, center: Vec3, t: number): Keyframe {
  const k = Math.min(1, Math.max(0, t));
  const a = orbitOf({ position: from.position, target: center, fov: from.fov });
  const b = orbitOf({ position: to.position, target: center, fov: to.fov });
  const rangeFt = a.rangeFt + (b.rangeFt - a.rangeFt) * k;
  const pitchDeg = a.pitchDeg + (b.pitchDeg - a.pitchDeg) * k;
  // Shortest way round, same reasoning as wrapHeading above: a straight lerp from a
  // heading of -170 to one of 170 would swing 340 degrees the long way rather than the
  // 20 degrees actually between them.
  const dHeading = wrapHeading(b.headingDeg - a.headingDeg);
  const headingDeg = a.headingDeg + dHeading * k;
  const { position } = orbitKeyframe(
    { position: center, target: center, fov: 0 },
    { headingDeg, pitchDeg, rangeFt },
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
 * minRangeFt -- the identical failure mode transitPose's own docblock records
 * finding for the stage 3 -> 4 transit, and for the identical reason: a
 * chord between two points outside a sphere is not guaranteed to stay
 * outside it. transitPose's range-about-MASSING_CENTER interpolation does
 * not have that failure mode, and `held`'s own range from MASSING_CENTER is
 * already >= MASS_RADIUS by STAGE4_CLAMP's construction, so the blended
 * path's closest approach to MASSING_CENTER is bounded below by
 * min(range(held), range(path)) -- see transitPose's own comment for why.
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
