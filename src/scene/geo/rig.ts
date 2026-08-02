/**
 * The camera as a geodetic rig: lat/lon/heading/pitch/range instead of scattered
 * site-frame position/target math.
 *
 * docs/phases/P11-PHOTOREAL.md section 2.3. `GeoPose` is the one shape every stage's
 * shot is meant to become; `poseToKeyframe`/`keyframeToPose` are the exact conversion to
 * and from the existing `Keyframe` (stages.ts) that `CameraRig.tsx` already knows how to
 * turn into a three.js camera, so nothing downstream of a `Keyframe` has to change to
 * gain this model. `clampPose` is the geodetic-rig equivalent of orbit.ts's
 * `clampOrbit` -- same shape, same idempotence, pitch/range instead of polar/radius.
 *
 * FRAMES. `headingDeg` is a compass bearing, degrees east of north, of the camera AS
 * SEEN FROM the target -- the same convention orbit.ts's `azimuthDeg` uses
 * (`Math.atan2(east, north)`), and wrapped the same way, to (-180, 180]. `pitchDeg` is
 * measured from the target's local horizontal, 0 level and 90 straight down; this is
 * orbit.ts's `polarDeg` (measured from straight up) restated as `pitchDeg = 90 - polarDeg`
 * -- see the table in P11-PHOTOREAL.md section 2.3. `rangeFt` is camera-to-target
 * distance, so together (heading, pitch, range) are the same spherical coordinate
 * `orbitKeyframe`/`orbitOf` already use, just centred on a geodetic target instead of a
 * site-frame one.
 *
 * ONE LOCAL ENU PER TARGET, APPROXIMATED BY THE SITE FRAME'S OWN AXES, NOT A SECOND
 * GLOBAL TRANSFORM. `geo/frame.ts`'s site frame (+X east, +Y up, -Z north, per
 * `frames.ts`'s `toThree` and orbit.ts's own header) is already a flat local-tangent-
 * plane approximation, built once at WELD_ORIGIN. Every stage target in this app sits
 * within a few thousand feet of that origin (Harvard Yard, Cambridge at most), so this
 * module reuses those same three site-frame directions as the target's own local ENU
 * rather than re-deriving a fresh `weldBasis()`-style basis centred on each target: at
 * this scale the two agree to well inside the project's own foot-level tolerances, and a
 * second per-target basis would be answering a precision question nobody asked while
 * duplicating machinery `geo/frame.ts` already owns. See this module's own file-level
 * comment in the P11 task notes for why a literal per-target `weldBasis()` was
 * considered and set aside.
 *
 * `targetFt` is passed straight through to `geodeticToSite`/`siteToGeodetic`'s own
 * height-above-the-WGS-84-ellipsoid parameter. That is a stated approximation of "height
 * above grade" (the two differ by geoid undulation and real terrain elevation), taken
 * because WELD_ORIGIN's own ellipsoid height already stands for grade at y = 0 (proved
 * by tests/geoFrame.test.ts) and nothing in this project models terrain elevation
 * separately -- introducing one just for this field would be, again, a second transform
 * this module does not need.
 *
 * THREE-FREE, like geo/frame.ts: no `three` import. `Keyframe` is pulled in as a
 * type-only import, which TypeScript erases entirely, so this module has no runtime
 * dependency on stages.ts (or on anything stages.ts itself imports) at all.
 */

import { normalizeAngle } from "@/geo/frames";
import { geodeticToSite, siteToGeodetic } from "./frame";
import type { Keyframe } from "../stages";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * One camera shot, expressed geodetically: what it looks at (lat/lon/targetFt) and how
 * it looks at it (heading/pitch/range), plus the lens.
 */
export type GeoPose = {
  /** Latitude of what the camera looks at, degrees. */
  lat: number;
  /** Longitude of what the camera looks at, degrees. */
  lon: number;
  /** Height of the look-at target above grade, ft. See this file's header on the
   *  ellipsoid-height approximation this stands for. */
  targetFt: number;
  /** Compass bearing of the camera FROM the target, degrees east of north. */
  headingDeg: number;
  /** Degrees below the target's local horizontal the camera sits at. 90 = straight down. */
  pitchDeg: number;
  /** Camera-to-target distance, ft. */
  rangeFt: number;
  /** Vertical field of view, degrees -- carried through unchanged. */
  fov: number;
};

/** Clamp limits for a GeoPose's pitch and range, the geodetic-rig equivalent of
 *  orbit.ts's OrbitClamp. */
export type PoseClamp = {
  minRangeFt: number;
  maxRangeFt: number;
  minPitchDeg: number;
  maxPitchDeg: number;
};

function within(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Heading wrapped to (-180, 180], idempotently. Same reasoning as orbit.ts's own
 * wrapAzimuth: the in-range short circuit is load bearing, not defensive, because
 * normalizeAngle's add-then-subtract loses a bit for about one input in a hundred and
 * clampPose is applied every frame to state it has already clamped.
 */
function wrapHeading(deg: number): number {
  if (deg > -180 && deg <= 180) return deg;
  return normalizeAngle(deg);
}

/**
 * A GeoPose, as a Keyframe: the target's site-frame position via geodeticToSite, then
 * the camera offset from it by rangeFt along the direction heading/pitch imply in the
 * target's local ENU -- which this file's header explains is approximated by the site
 * frame's own east/up/north axes.
 *
 * Mirrors orbit.ts's orbitKeyframe exactly, coordinate for coordinate, with pitch (from
 * horizontal) standing in for polar (from straight up): horizontal = range * cos(pitch),
 * up = range * sin(pitch), east/north split by heading the same way azimuth splits them
 * there.
 */
export function poseToKeyframe(p: GeoPose): Keyframe {
  const target = geodeticToSite(p.lat, p.lon, p.targetFt);
  const pitch = p.pitchDeg * DEG;
  const heading = p.headingDeg * DEG;
  const horizontal = p.rangeFt * Math.cos(pitch);
  const up = p.rangeFt * Math.sin(pitch);
  const east = horizontal * Math.sin(heading);
  const north = horizontal * Math.cos(heading);
  return {
    // north is -Z, per frames.ts toThree -- the same sign orbitKeyframe uses, for the
    // same reason: getting it wrong mirrors every shot about Weld's long axis.
    position: [target[0] + east, target[1] + up, target[2] - north],
    target,
    fov: p.fov,
  };
}

/**
 * The GeoPose a Keyframe already sits at. Exact inverse of poseToKeyframe: mirrors
 * orbit.ts's orbitOf, reading the target's geodetic location off siteToGeodetic and the
 * heading/pitch/range off the camera's offset from it in the same east/up/north split.
 */
export function keyframeToPose(k: Keyframe): GeoPose {
  const { lat, lon, hFt } = siteToGeodetic(k.target);
  const east = k.position[0] - k.target[0];
  const up = k.position[1] - k.target[1];
  const north = k.target[2] - k.position[2];
  const horizontal = Math.hypot(east, north);
  const rangeFt = Math.hypot(east, up, north);
  return {
    lat,
    lon,
    targetFt: hFt,
    headingDeg: Math.atan2(east, north) * RAD,
    pitchDeg: Math.atan2(up, horizontal) * RAD,
    rangeFt,
    fov: k.fov,
  };
}

/**
 * A GeoPose forced into a PoseClamp's pitch/range limits. Idempotent, same as orbit.ts's
 * clampOrbit: heading is wrapped (never clamped, same as azimuth there -- there is no
 * stage in this app that limits which way you may look), pitch and range are clamped to
 * the given range, and lat/lon/targetFt/fov pass through untouched -- clamping constrains
 * how the camera stands off the target, not what it is looking at.
 */
export function clampPose(p: GeoPose, c: PoseClamp): GeoPose {
  return {
    lat: p.lat,
    lon: p.lon,
    targetFt: p.targetFt,
    headingDeg: wrapHeading(p.headingDeg),
    pitchDeg: within(p.pitchDeg, c.minPitchDeg, c.maxPitchDeg),
    rangeFt: within(p.rangeFt, c.minRangeFt, c.maxRangeFt),
    fov: p.fov,
  };
}
