/**
 * Where the sun is over Weld Hall, and which of its faces that lights.
 *
 * The algorithm is NOAA's, from the Global Monitoring Laboratory solar
 * calculator (https://gml.noaa.gov/grad/solcalc/), which is itself a
 * transcription of Jean Meeus, "Astronomical Algorithms" 2nd ed., ch. 25. It is
 * accurate to well under a minute of arc for dates near now, which is orders of
 * magnitude better than we need: the real uncertainty in "is this window in the
 * sun" is the elms in the Yard and the roofline of Grays across the way.
 *
 * TIME ZONES. Every function here takes a `Date` and reads it as the *instant*
 * it is — only UTC accessors are used, never local ones — so results never
 * depend on the machine's TZ. Cambridge is UTC-5 in winter and UTC-4 on
 * daylight time, so callers holding a wall clock must convert first:
 *
 *   9am on 21 June (EDT)      -> new Date("2026-06-21T13:00:00Z")
 *   9am on 21 December (EST)  -> new Date("2026-12-21T14:00:00Z")
 *
 * That is the whole convention, and tests/solar.test.ts pins it with a case
 * that only passes under this reading.
 *
 * REFRACTION. NOAA's sheet also publishes an elevation corrected for
 * atmospheric refraction; we return the geometric altitude of the sun's centre
 * instead. Three reasons: refraction is ~0.5 deg right at the horizon and
 * depends on pressure and temperature we do not have; the analytic identities
 * this module is tested against (noon altitude = 90 - lat + declination, and
 * cos(sunrise azimuth) = sin(declination) / cos(lat)) hold for the geometric
 * angle and not the refracted one; and half a degree at the horizon is far
 * below the error already introduced by the trees.
 */

import { WELD_ORIGIN, normalizeAngle } from "@/geo/frames";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

export type SunPosition = {
  /** Degrees above the horizon. Negative while the sun is down. */
  altitudeDeg: number;
  /** Degrees clockwise from true north: 90 is east, 180 south, 270 west. */
  azimuthDeg: number;
};

/**
 * Julian centuries since J2000.0 (2000-01-01 12:00 TT), the argument every
 * polynomial below is expressed in.
 *
 * 2440587.5 is the Julian Day of the Unix epoch, so this is exact arithmetic on
 * the Date's instant. It ignores the ~70 s of TT-UTC, worth 3e-5 deg of solar
 * longitude, i.e. nothing.
 */
function julianCentury(date: Date): number {
  return (date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545) / 36_525;
}

/** Geometric mean longitude of the sun, degrees. */
function meanLongDeg(t: number): number {
  return mod360(280.46646 + t * (36_000.76983 + t * 0.0003032));
}

/** Geometric mean anomaly of the sun, degrees. */
function meanAnomalyDeg(t: number): number {
  return 357.52911 + t * (35_999.05029 - 0.0001537 * t);
}

/** Sun's equation of the centre, degrees: the elliptical-orbit correction that
 *  turns the mean longitude into the true one. */
function equationOfCentreDeg(t: number): number {
  const m = meanAnomalyDeg(t) * DEG;
  return (
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289
  );
}

/** Apparent longitude of the sun, degrees: true longitude less aberration and
 *  the nutation in longitude. */
function apparentLongDeg(t: number): number {
  const trueLong = meanLongDeg(t) + equationOfCentreDeg(t);
  return trueLong - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * DEG);
}

/** Obliquity of the ecliptic, degrees, corrected for nutation. About 23.4365
 *  now, which is what caps the solstice declination near 23.44. */
function obliquityDeg(t: number): number {
  const mean =
    23 +
    (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  return mean + 0.00256 * Math.cos((125.04 - 1934.136 * t) * DEG);
}

/**
 * Declination of the sun in degrees: +23.44 at the June solstice, 0 at the
 * equinoxes, -23.44 in December. This is the one number that drives everything
 * seasonal about Weld's daylight, so it is exported in its own right.
 */
export function solarDeclinationDeg(date: Date): number {
  const t = julianCentury(date);
  return (
    Math.asin(
      Math.sin(obliquityDeg(t) * DEG) * Math.sin(apparentLongDeg(t) * DEG),
    ) * RAD
  );
}

/**
 * Equation of time in minutes: apparent solar time minus mean solar time. Runs
 * from about -14 min in February to +16 min in early November, which is why
 * solar noon at Weld wanders over half an hour across the year.
 */
function equationOfTimeMin(t: number): number {
  const eps = obliquityDeg(t) * DEG;
  const l0 = meanLongDeg(t) * DEG;
  const m = meanAnomalyDeg(t) * DEG;
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const y = Math.tan(eps / 2) ** 2;
  return (
    4 *
    RAD *
    (y * Math.sin(2 * l0) -
      2 * e * Math.sin(m) +
      4 * e * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * e * e * Math.sin(2 * m))
  );
}

/**
 * Altitude and azimuth of the sun as seen from a point on the ground. Defaults
 * to Weld Hall's centroid, which is the only place this project cares about.
 *
 * `date` is read as an instant in UTC. See the module header.
 */
export function sunPosition(
  date: Date,
  lat: number = WELD_ORIGIN.lat,
  lon: number = WELD_ORIGIN.lon,
): SunPosition {
  const t = julianCentury(date);
  const decl = solarDeclinationDeg(date) * DEG;
  const phi = lat * DEG;

  // Minutes since UTC midnight. UTC accessors only: see the module header.
  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60_000;

  // True solar time, minutes. 4 min of rotation per degree of longitude; the
  // zone offset term of NOAA's formula is zero because we are already in UTC.
  const trueSolar = mod(utcMinutes + equationOfTimeMin(t) + 4 * lon, 1440);

  // Hour angle, degrees: 0 at solar noon, negative in the morning. trueSolar/4
  // lies in [0, 360), so this lands in [-180, 180) without a second branch.
  const ha = (trueSolar / 4 - 180) * DEG;

  const cosZenith =
    Math.sin(phi) * Math.sin(decl) +
    Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(clampUnit(cosZenith));

  // Azimuth from the spherical cosine rule on the polar triangle. The acos
  // gives an angle from due south with no sense of east or west, so the sign of
  // the hour angle decides which side of the meridian we are on: morning
  // (ha < 0) folds to the east half, afternoon to the west.
  const c = clampUnit(
    (Math.sin(phi) * Math.cos(zenith) - Math.sin(decl)) /
      (Math.cos(phi) * Math.sin(zenith)),
  );
  const fromSouth = Math.acos(c) * RAD;
  const azimuthDeg =
    ha > 0 ? mod(fromSouth + 180, 360) : mod(540 - fromSouth, 360);

  return { altitudeDeg: 90 - zenith * RAD, azimuthDeg };
}

/**
 * Is a facade in direct sun?
 *
 * `facadeAzimuthDeg` is the outward normal of the wall, degrees clockwise from
 * north — so Weld's north gable is WELD_AXIS_DEG (13.2) and the long east wall
 * is 103.2. A wall is lit when the sun is up and within 90 deg of that normal;
 * beyond 90 the sun is behind the plane of the wall and it is in shade.
 *
 * This is a self-shading test on an isolated box. It knows nothing about Grays,
 * Matthews, or the trees, so it is an upper bound on the real daylight.
 */
export function isFacadeLit(
  facadeAzimuthDeg: number,
  sun: { altitudeDeg: number; azimuthDeg: number },
): boolean {
  if (sun.altitudeDeg <= 0) return false;
  return Math.abs(normalizeAngle(sun.azimuthDeg - facadeAzimuthDeg)) < 90;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function mod360(a: number): number {
  return mod(a, 360);
}

/** Guard the acos arguments. Both ratios reach exactly +/-1 at solar noon and
 *  at the horizon, where rounding can push them a few ulps outside the domain
 *  and turn the whole answer into NaN. */
function clampUnit(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x;
}
