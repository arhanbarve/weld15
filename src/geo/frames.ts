/**
 * Coordinate frames and the only sanctioned conversions between them.
 *
 * Four frames are in play and confusing them is how a project like this rots,
 * so every conversion lives here and nowhere else.
 *
 *  WGS84    lat, lon in degrees. The source GIS data only.
 *  Site     x east, y north, in feet, origin at Weld Hall's centroid.
 *           This is how campus.json and weld.json are stored.
 *  Building u across the building, v along it, feet, same origin, rotated so
 *           that +v runs along Weld's long axis (13.2 degrees east of north).
 *  Three    x east, y UP, z south. What the renderer wants.
 *
 * The trap: three.js is Y-up while every plan and every GIS export here is
 * Y-north. A mistake in that swap mirrors the entire building, and mirroring is
 * already a live ambiguity in this project, so a silent mirror would be
 * invisible. Hence toThree/fromThree are round-trip tested in both directions.
 */

export const WELD_ORIGIN = {
  lat: 42.3739244,
  lon: -71.1171195,
} as const;

/** Weld's long axis, degrees east of north. From Harvard's GIS footprint. */
export const WELD_AXIS_DEG = 13.2;

const METRES_PER_DEGREE = 111_320;
const FEET_PER_METRE = 3.280839895;
const FEET_PER_DEGREE_LAT = METRES_PER_DEGREE * FEET_PER_METRE;
const FEET_PER_DEGREE_LON =
  FEET_PER_DEGREE_LAT * Math.cos((42.3739244 * Math.PI) / 180);

export type Site = { x: number; y: number };
export type Building = { u: number; v: number };
export type Vec3 = [number, number, number];

/** WGS84 to site feet, using an equirectangular approximation about the origin.
 *  Over a 1,200 ft campus the error is far below the foot we care about. */
export function latLonToSite(lat: number, lon: number): Site {
  return {
    x: (lon - WELD_ORIGIN.lon) * FEET_PER_DEGREE_LON,
    y: (lat - WELD_ORIGIN.lat) * FEET_PER_DEGREE_LAT,
  };
}

export function siteToLatLon(p: Site): { lat: number; lon: number } {
  return {
    lat: WELD_ORIGIN.lat + p.y / FEET_PER_DEGREE_LAT,
    lon: WELD_ORIGIN.lon + p.x / FEET_PER_DEGREE_LON,
  };
}

const AXIS = (WELD_AXIS_DEG * Math.PI) / 180;
const SIN_A = Math.sin(AXIS);
const COS_A = Math.cos(AXIS);

/**
 * Site to building frame. +v points along the building's long axis (north-ish),
 * +u across it (east-ish). This is a rotation by -axis about the origin.
 */
export function siteToBuilding(p: Site): Building {
  return {
    u: p.x * COS_A - p.y * SIN_A,
    v: p.x * SIN_A + p.y * COS_A,
  };
}

export function buildingToSite(p: Building): Site {
  return {
    x: p.u * COS_A + p.v * SIN_A,
    y: -p.u * SIN_A + p.v * COS_A,
  };
}

/**
 * Site (or any x-east / y-north pair) plus a height to three.js world space.
 * three is Y-up and right-handed, so north maps to -Z.
 */
export function toThree(x: number, y: number, z = 0): Vec3 {
  // negate() rather than -y: negating zero yields -0, which is harmless in
  // three.js but serialises into shared-layout URLs and breaks value equality.
  return [x, z, negate(y)];
}

/** Inverse of toThree. Returns x east, y north, z up. */
export function fromThree(v: Vec3): { x: number; y: number; z: number } {
  return { x: v[0], y: negate(v[2]), z: v[1] };
}

function negate(n: number): number {
  return n === 0 ? 0 : -n;
}

/** Rotate a compass azimuth (degrees clockwise from north) into the building
 *  frame, where 0 means "along +v", i.e. facing the north gable. */
export function azimuthToBuilding(azimuthDeg: number): number {
  return normalizeAngle(azimuthDeg - WELD_AXIS_DEG);
}

/** Wrap to (-180, 180]. */
export function normalizeAngle(deg: number): number {
  let a = ((deg + 180) % 360) - 180;
  if (a <= -180) a += 360;
  return a;
}

/** Axis-aligned bounding box of a ring, in whatever frame the ring is in. */
export function ringBounds(ring: readonly (readonly number[])[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    const x = p[0]!;
    const y = p[1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/** Shoelace area. Positive is counter-clockwise in a y-up (or y-north) frame. */
export function signedArea(ring: readonly (readonly number[])[]): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    s += a[0]! * b[1]! - b[0]! * a[1]!;
  }
  return s / 2;
}
