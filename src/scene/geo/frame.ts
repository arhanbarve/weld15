/**
 * ECEF <-> site <-> geodetic, reconciled in one place.
 *
 * P11 replaces the false invariant `alt = camera.position.y` (correct only for a camera
 * directly over Weld's local vertical -- see globeRig.ts's spinPose docblock for the
 * measured failure) with a real geodetic definition of altitude: height above the WGS-84
 * ellipsoid. This module is where that gets computed, and it is the one place that knows
 * how the site frame (feet, origin at Weld, +X east / +Y up / -Z north -- frames.ts) relates
 * to ECEF (metres, origin at Earth's centre) and to geodetic lat/lon/height.
 *
 * THE COMPOSITE TRANSFORM this module makes possible, per docs/phases/P11-PHOTOREAL.md
 * section 2.1, is
 *
 *   M_ecef->site = S . R . T
 *
 *   T  translate by -ECEF(WELD_ORIGIN, at grade -- WELD_GRADE_H_FT below)
 *   R  rotate ECEF -> site (east -> +X, up -> +Y, north -> -Z)
 *   S  scale metres -> feet (3.280839895)
 *
 * WHERE y = 0 IS. Weld's GRADE, which is 64 ft below the WGS-84 ellipsoid at this site --
 * see WELD_GRADE_H_FT, which carries the measurement and the bug it fixes. Every height in
 * this module's public surface (`geodeticToSite`'s hFt, `siteToGeodetic`'s hFt,
 * `altitudeOf`) is a height above that datum rather than above the ellipsoid, so the rest
 * of the project keeps its one meaning of "up from the ground" and the ellipsoid is named
 * in exactly one constant.
 *
 * `R` is exactly `weldBasis()`'s basis -- moved here verbatim from globeRig.ts, not
 * rewritten -- which tests/globeRig.test.ts already proves orthonormal, right-handed and
 * correctly oriented. One wrinkle: weldBasis()'s own docblock states its three vectors in a
 * Y-UP GEOCENTRIC convention (Y through the north pole, X through the prime meridian, east
 * toward -Z) because that is the layout three.js's own SphereGeometry vertices use, whereas
 * ECEF proper (what geodesy, and later 3d-tiles-renderer, actually use) has Z through the
 * pole and Y ninety degrees east of X along the equator. The two conventions name the SAME
 * three physical directions (verified: substituting either formula for "up" gives
 * (cos f cos l, cos f sin l, sin f) up to which axis is called what), so converting between
 * them is a fixed axis permutation, `stdToYup`/`yupToStd` below, applied before/after the
 * unchanged weldBasis() dot products. No rotation math is duplicated or rewritten; this is
 * bookkeeping about which axis is labelled what.
 *
 * WGS-84: a = 6,378,137.0 m, f = 1/298.257223563 (e^2 = f(2-f)). Geodetic-to-ECEF is the
 * closed-form standard formula; ECEF-to-geodetic is Bowring's iteration (converges to double
 * precision in well under ten steps for any height this project uses, including orbit
 * altitudes ~2e7 ft), in the same fixed-point style altitude.ts's globeClipFloor() already
 * uses elsewhere in this codebase.
 *
 * THREE-FREE, like altitude.ts, orbit.ts, walk.ts and journey.ts: no `three` import, so this
 * runs in plain node and a sign error costs a second to catch rather than a screenshot.
 */

import { WELD_ORIGIN } from "@/geo/frames";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export type Vec3 = [number, number, number];
export type Basis = { x: Vec3; y: Vec3; z: Vec3 };

/**
 * The rotation that puts Weld's latitude and longitude at the top of the sphere.
 *
 * Moved verbatim from globeRig.ts -- see that file's history for the derivation. Re-exported
 * from there too, so existing callers of `weldBasis` from "./globeRig" keep working
 * unchanged; this is the canonical copy.
 */
export function weldBasis(
  lat: number = WELD_ORIGIN.lat,
  lon: number = WELD_ORIGIN.lon,
): Basis {
  const f = lat * DEG;
  const l = lon * DEG;
  const east: Vec3 = [-Math.sin(l), 0, -Math.cos(l)];
  const up: Vec3 = [Math.cos(f) * Math.cos(l), Math.sin(f), -Math.cos(f) * Math.sin(l)];
  const north: Vec3 = [-Math.sin(f) * Math.cos(l), Math.cos(f), Math.sin(f) * Math.sin(l)];
  return { x: east, y: up, z: [-north[0], -north[1], -north[2]] };
}

/** A Y-up-geocentric direction, resolved into its site-frame (east/up/south) components. */
function geoToSite(v: Vec3, basis: Basis): Vec3 {
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return [dot(basis.x, v), dot(basis.y, v), dot(basis.z, v)];
}

/**
 * Inverse of geoToSite: a site-frame vector, rebuilt as a Y-up-geocentric direction. Exact
 * for an orthonormal basis, since the inverse of the matrix whose COLUMNS are basis.x/y/z is
 * its transpose, and this is that transpose applied as a linear combination of the columns.
 */
function siteToGeo(v: Vec3, basis: Basis): Vec3 {
  return [
    v[0] * basis.x[0] + v[1] * basis.y[0] + v[2] * basis.z[0],
    v[0] * basis.x[1] + v[1] * basis.y[1] + v[2] * basis.z[1],
    v[0] * basis.x[2] + v[1] * basis.y[2] + v[2] * basis.z[2],
  ];
}

/**
 * Standard ECEF (Z through the north pole, X through 0N/0E) written in weldBasis()'s Y-up
 * convention (Y through the pole, east toward -Z), and back. A fixed rotation by 90 degrees
 * about the standard-ECEF X axis -- orthonormal, determinant +1 -- not an approximation.
 */
function stdToYup(v: Vec3): Vec3 {
  return [v[0], v[2], -v[1]];
}
function yupToStd(v: Vec3): Vec3 {
  return [v[0], -v[2], v[1]];
}

/** WGS-84 ellipsoid. */
const WGS84_A = 6_378_137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

/** Metres per foot, the same constant frames.ts's toThree/fromThree family uses. */
const FEET_PER_METRE = 3.280839895;

/** Geodetic to standard ECEF, metres. The closed-form formula. */
function geodeticToEcefStd(latDeg: number, lonDeg: number, hMeters: number): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [
    (n + hMeters) * cosLat * Math.cos(lon),
    (n + hMeters) * cosLat * Math.sin(lon),
    (n * (1 - WGS84_E2) + hMeters) * sinLat,
  ];
}

/**
 * Standard ECEF, metres, to geodetic. Bowring's fixed-point iteration: an initial latitude
 * guess, then alternately refining height and latitude until both stop moving. Capped at 30
 * steps as a belt for a schedule this well-conditioned; in practice it settles in under ten,
 * even at the ~2e7 ft orbit altitudes this project's descent starts from.
 */
function ecefStdToGeodetic(p: Vec3): { lat: number; lon: number; hMeters: number } {
  const [x, y, z] = p;
  const lon = Math.atan2(y, x);
  const r = Math.hypot(x, y);
  let lat = Math.atan2(z, r * (1 - WGS84_E2));
  let h = 0;
  for (let i = 0; i < 30; i++) {
    const sinLat = Math.sin(lat);
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
    const newH = r / Math.cos(lat) - n;
    const newLat = Math.atan2(z, r * (1 - (WGS84_E2 * n) / (n + newH)));
    const settled = Math.abs(newLat - lat) < 1e-15 && Math.abs(newH - h) < 1e-9;
    lat = newLat;
    h = newH;
    if (settled) break;
  }
  return { lat: lat * RAD, lon: lon * RAD, hMeters: h };
}

/**
 * Weld's grade, as a height above the WGS-84 ellipsoid, ft. THE DATUM THIS WHOLE FRAME
 * HANGS ON, and the number that was missing.
 *
 * originEcefStd() passed 0 here through P11, i.e. it anchored the site frame on the
 * ELLIPSOID rather than on the ground, while its own comment said "at grade". That is
 * harmless as long as nothing else in the scene knows where the real ground is -- the
 * parametric campus was self-consistent about y = 0 being grade, so the error was
 * unobservable. Google's Photorealistic 3D Tiles are the thing that knows: they arrive in
 * real ECEF, so their Cambridge landed 64 ft BELOW the model's own grade plane and every
 * parametric thing in the scene (Weld's shell, WeldMarker's ring and pin, the carve prism
 * in tilesCarve.ts, every camera keyframe's aim height) floated above the photogrammetry
 * by that much. tilesCarve's prism was the quiet half of the same bug: it spans grade - 5
 * ft up to the ridge, so 64 ft too high it covered the AIR over Weld's roof and could
 * never have removed Google's own Weld at the threshold.
 *
 * MEASURED, FROM TWO INDEPENDENT PUBLIC DATASETS, AT EXACTLY WELD_ORIGIN
 * (42.3739244, -71.1171195):
 *
 *   USGS EPQS (1 m 3DEP)      H = 8.240 m orthometric, NAVD88
 *   NOAA NGS GEOID12B         N = -27.763 m (stated error 0.048 m)
 *   h = H + N                   = -19.523 m = -64.05 ft
 *
 * NAVD88 + GEOID12B produces a NAD83(2011) ellipsoid height and Google's tiles are
 * ITRF/WGS-84, and those two frames differ by one to two metres in height across CONUS --
 * so the geodetic figure was taken as a starting point and then CHECKED against the surface
 * Google actually renders, by scripts/measure-align.mjs. It samples every loaded tile's
 * vertices in site space at stage 3 (779 meshes, 1,572 tiles, settled) and reports the
 * ground as a per-cell 10th percentile on a 20 ft grid, medianed over cells:
 *
 *   ring 35-75 ft, hugging Weld       grade at  +1.7 ft
 *   ring 80-160 ft, out in the yard   grade at  -1.3 ft
 *   highest vertex over the footprint         +82.2 ft   (weld.json's ridge: 85.4)
 *
 * SO THE VALUE IS NOT TUNED FURTHER, AND THAT IS THE MEASUREMENT'S OWN CONCLUSION. The two
 * rings bracket zero: Cambridge's ground rises about 3 ft over the 100 ft from the yard to
 * Weld's walls, and this project's grade is ONE FLAT PLANE, so no constant makes both rings
 * zero. What is left is a slope, not an offset, and shifting the datum to null one ring
 * would only move the error into the other. The sign that remains is the safe one: grade
 * sits 1.7 ft ABOVE Google's ground at the building, so WeldMarker's ring lies on top of
 * the photogrammetry rather than buried inside it.
 *
 * The ridge line is the independent check and it passes: 82.2 ft of mesh over a building
 * whose ridge is 85.4 ft, from photogrammetry that rounds slate ridges off, is agreement --
 * a datum still 64 ft out would have put that number near 146.
 *
 * NOT SPELT AS A NEGATIVE ALTITUDE ANYWHERE ELSE. Everything above ground in this project
 * is expressed in feet above grade -- weld.json's 85.4 ft ridge, place.ts's floorLevel(),
 * geo/rig.ts's `targetFt` ("height of the target above grade") -- so this is the ONE place
 * the ellipsoid is mentioned, and geodeticToSite/siteToGeodetic below convert at the
 * boundary so no caller has to know.
 */
export const WELD_GRADE_H_FT = -64.05;

/** WELD_ORIGIN, at grade, in standard ECEF metres. The translation T. */
function originEcefStd(): Vec3 {
  return geodeticToEcefStd(
    WELD_ORIGIN.lat,
    WELD_ORIGIN.lon,
    WELD_GRADE_H_FT / FEET_PER_METRE,
  );
}

/** ECEF (standard, metres) to the site frame (feet). */
export function ecefToSite(p: Vec3): Vec3 {
  const origin = originEcefStd();
  const rel: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
  const siteMeters = geoToSite(stdToYup(rel), weldBasis());
  return [
    siteMeters[0] * FEET_PER_METRE,
    siteMeters[1] * FEET_PER_METRE,
    siteMeters[2] * FEET_PER_METRE,
  ];
}

/** The site frame (feet) to ECEF (standard, metres). Exact inverse of ecefToSite. */
export function siteToEcef(p: Vec3): Vec3 {
  const siteMeters: Vec3 = [p[0] / FEET_PER_METRE, p[1] / FEET_PER_METRE, p[2] / FEET_PER_METRE];
  const rel = yupToStd(siteToGeo(siteMeters, weldBasis()));
  const origin = originEcefStd();
  return [origin[0] + rel[0], origin[1] + rel[1], origin[2] + rel[2]];
}

/**
 * Geodetic lat/lon (degrees) and height ABOVE WELD'S GRADE (feet) to the site frame.
 *
 * `hFt` is measured from the datum WELD_GRADE_H_FT names, not from the ellipsoid, and the
 * conversion happens here so that no caller has to hold both. That is what every caller
 * already meant: geo/rig.ts's `targetFt` is documented as "height of the target above
 * grade", and stages.ts builds its keyframes out of aim heights (40, 30, 42 ft) that are
 * heights above the ground. Before the datum existed the two readings agreed numerically,
 * because grade was assumed to be the ellipsoid; now they differ by 64 ft and this is the
 * boundary where that is reconciled.
 */
export function geodeticToSite(lat: number, lon: number, hFt: number): Vec3 {
  return ecefToSite(
    geodeticToEcefStd(lat, lon, (hFt + WELD_GRADE_H_FT) / FEET_PER_METRE),
  );
}

/** The site frame (feet) to geodetic lat/lon (degrees) and height above Weld's grade (feet). */
export function siteToGeodetic(p: Vec3): { lat: number; lon: number; hFt: number } {
  const { lat, lon, hMeters } = ecefStdToGeodetic(siteToEcef(p));
  return { lat, lon, hFt: hMeters * FEET_PER_METRE - WELD_GRADE_H_FT };
}

/**
 * Height above WELD'S GRADE, in feet. THE definition of altitude from P11 on -- correct for
 * any camera position, not only one on Weld's local vertical, which is the defect this
 * module exists to fix (see docs/phases/P11-PHOTOREAL.md section 0.1).
 *
 * ABOVE GRADE RATHER THAN ABOVE THE ELLIPSOID, which is a correction to the datum and NOT
 * to this function: every number this feeds -- altitude.ts's BANDS, its NEAR_FAR_STOPS
 * schedule, CameraRig's window.__cam.alt, the fly-down's decades -- was measured and tuned
 * against a camera height read off the site frame's own y, back when grade and the
 * ellipsoid were assumed to be the same surface. Keeping altitude anchored on grade is what
 * leaves every one of those figures meaning exactly what it meant before, so moving the
 * datum moves the tiles into place without touching a single tuned constant.
 * tests/geoFrame.test.ts's `altitudeOf([0, h, 0]) === h` still holds for that reason.
 */
export function altitudeOf(p: Vec3): number {
  return siteToGeodetic(p).hFt;
}
