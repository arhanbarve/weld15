/**
 * How to draw a sphere 20,902,231 ft in radius without ever having a scene 20,902,231 ft
 * across.
 *
 * THIS IS THE KEY DESIGN MOVE OF P9 and the reason none of the standard globe-renderer
 * machinery -- logarithmic depth buffers, origin recentring, floating-origin scene graphs --
 * appears anywhere in this project. Read it before changing anything here.
 *
 * A perspective projection is invariant under a uniform scaling of the whole scene about
 * the camera. Scale a sphere's radius and the camera-to-centre distance by the same factor
 * and the image is pixel-identical: the angular radius subtended is
 * asin(R / d), and R and d appear only as a ratio. So the Earth does not have to be drawn
 * at Earth's size. It has to be drawn at Earth's ANGULAR size, and that is a much smaller
 * object placed much closer.
 *
 * The proxy radius is tied to `far` rather than fixed, and that is not decoration. The
 * first draft of P9 used a constant GLOBE_R = 5000 ft and it is wrong: at alt = 99,000 ft
 * that puts the sphere's surface 23.7 ft from a camera whose near plane is 100 ft, so the
 * globe is clipped away entirely at exactly the altitude it still has to be visible. Tying
 * it to far keeps the whole construction inside the frustum at every altitude in the
 * schedule. altitude.ts's globeClipAlt() derives where the rule finally expires (4,180 ft,
 * against a fade that finishes at 40,000) and assertRigVisible() below checks it rather
 * than trusting that the two tables agree.
 *
 * The other two properties that make this work live in Globe.tsx, not here, because they
 * are material settings:
 *
 *   - depthTest: false, depthWrite: false, renderOrder: -1. The sphere is a BACKDROP. It
 *     never depth-composites against anything, because by the altitude at which anything
 *     else is on screen it is flat to within a pixel behind it.
 *   - therefore near and far never have to span both scales. They only ever serve the
 *     foot-scale content, which is what altitude.ts's schedule assumes.
 *
 * IF YOU FIND YOURSELF ADDING logarithmicDepthBuffer: true TO THE <Canvas>, you have
 * departed from this design. Stop and re-read the paragraph above. Log depth would also
 * have to be reconciled with the EffectComposer in Effects.tsx, which is a second problem
 * this construction simply does not create.
 *
 * THREE-FREE, like altitude.ts. This module returns numbers -- a radius, a centre, a basis
 * -- and Globe.tsx turns them into a mesh. tests/place.test.ts asserts the import graph.
 */

import { WELD_ORIGIN } from "@/geo/frames";
import { GLOBE_FAR_RATIO, R_EARTH_FT, globeClipAlt, nearFar } from "./altitude";

const DEG = Math.PI / 180;

export type Vec3 = [number, number, number];

/**
 * The site frame's three axes, written in GEOCENTRIC coordinates.
 *
 * Two frames are in play and mixing them up mirrors the Earth, so both are named here:
 *
 *   GEOCENTRIC   +Y through the north pole, +X through the prime meridian, east toward -Z.
 *                This is the convention Globe.tsx has used for its marker since P2 and it
 *                is also how a three.js SphereGeometry's own vertices are laid out.
 *   SITE         +X east, +Y up, -Z toward true north at Weld. frames.ts and place.ts.
 *
 * `x`, `y`, `z` are the site frame's east, up and SOUTH directions -- south, because
 * place.ts puts building north on -Z -- each expressed as a geocentric unit vector.
 *
 * WHICH DIRECTION THE ROTATION GOES, because this is the part that gets inverted by
 * accident. Handing these three to three.js's Matrix4.makeBasis() builds the matrix whose
 * COLUMNS they are, and that matrix maps SITE -> GEOCENTRIC. The globe mesh needs the other
 * way round, so Globe.tsx transposes it. geoToSite() below is the same map written out as
 * three dot products, and it is what the tests check against.
 */
export type Basis = { x: Vec3; y: Vec3; z: Vec3 };

/**
 * A geocentric direction, in site coordinates.
 *
 * Three dot products, because for an orthonormal basis the inverse is the transpose and the
 * transpose applied to a vector is exactly "dot it with each column".
 */
export function geoToSite(v: Vec3, basis: Basis): Vec3 {
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return [dot(basis.x, v), dot(basis.y, v), dot(basis.z, v)];
}

export type GlobeRig = {
  /** Proxy radius, ft. Not Earth's radius; see the header. */
  radius: number;
  /** Centre of the proxy sphere, site frame, ft. */
  centre: Vec3;
  /** Camera to proxy centre, ft. */
  distanceToCentre: number;
  /** Camera to the nearest point of the proxy's surface, ft. Must exceed `near`. */
  cameraToSurface: number;
  /** Camera to the far side of the proxy, ft. Must stay inside `far`. */
  cameraToBack: number;
  /** Angular radius of the sphere as seen from the camera, degrees. Scale-invariant. */
  angularRadiusDeg: number;
  /** Rotation from the geocentric frame to the site frame. */
  basis: Basis;
};

/**
 * The rotation that puts Weld's latitude and longitude at the top of the sphere.
 *
 * In the site frame Weld's origin is (0, 0, 0) and Earth's centre is (0, -R, 0), so Weld is
 * by construction at the proxy's north pole -- "up" at Weld is the outward normal. The
 * basis is therefore the local east / up / south triad at WELD_ORIGIN, written in
 * geocentric coordinates:
 *
 *   up    =  ( cos f cos l,  sin f, -cos f sin l)     the outward normal at (f, l)
 *   north =  (-sin f cos l,  cos f,  sin f sin l)     d(up)/df
 *   east  =  (-sin l,        0,     -cos l)           d(up)/dl, normalised
 *
 * and the site frame's +Z is SOUTH, because place.ts puts building north on -Z. Verified
 * right-handed in tests/globeRig.test.ts by asserting x cross y = z rather than by trusting
 * the sign I wrote here, since a mirrored globe is exactly the class of silent error
 * frames.ts:13-17 warns about.
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

/**
 * The proxy sphere for a camera at `alt` feet above Weld's grade.
 *
 * `cameraPos` is the real camera position in the site frame. The centre is placed along the
 * direction from the camera toward the REAL Earth centre at (0, -R_EARTH_FT, 0), so the
 * construction stays correct when the camera is off to one side rather than directly
 * overhead -- which it is at every stop except the very top of the descent.
 */
export function globeRig(cameraPos: Vec3, alt = cameraPos[1]): GlobeRig {
  const { far } = nearFar(alt);
  const radius = far / GLOBE_FAR_RATIO;

  // Toward the real Earth centre, from wherever the camera actually is.
  const dx = 0 - cameraPos[0];
  const dy = -R_EARTH_FT - cameraPos[1];
  const dz = 0 - cameraPos[2];
  const len = Math.hypot(dx, dy, dz) || 1;

  // The real camera-to-centre distance, scaled by radius/R_EARTH_FT. Written as
  // len/R_EARTH_FT rather than as (1 + alt/R_EARTH_FT) so that an off-nadir camera is
  // handled by the same line; the two agree to seven figures at every stop in the descent.
  const distanceToCentre = radius * (len / R_EARTH_FT);
  const centre: Vec3 = [
    cameraPos[0] + (dx / len) * distanceToCentre,
    cameraPos[1] + (dy / len) * distanceToCentre,
    cameraPos[2] + (dz / len) * distanceToCentre,
  ];

  return {
    radius,
    centre,
    distanceToCentre,
    cameraToSurface: distanceToCentre - radius,
    cameraToBack: distanceToCentre + radius,
    angularRadiusDeg:
      distanceToCentre > radius
        ? (Math.asin(radius / distanceToCentre) * 180) / Math.PI
        : 90,
    basis: weldBasis(),
  };
}

/**
 * Is the rig actually inside the frustum at this altitude?
 *
 * Called by Globe.tsx in development rather than trusted. The band table in altitude.ts and
 * the near/far schedule are maintained separately, and the failure mode when they disagree
 * is that the Earth silently vanishes for part of the descent -- which looks like a texture
 * that failed to load, so the hours go into the wrong place. Better to say so.
 */
export function assertRigVisible(alt: number): string | null {
  const { near, far } = nearFar(alt);
  const rig = globeRig([0, alt, 0], alt);
  if (rig.cameraToSurface <= near) {
    return `globe proxy clipped by the near plane at alt=${alt.toFixed(0)}: surface at ${rig.cameraToSurface.toFixed(2)} ft, near=${near.toFixed(2)} ft (rule expires below ${globeClipAlt(alt).toFixed(0)} ft)`;
  }
  if (rig.cameraToBack >= far) {
    return `globe proxy clipped by the far plane at alt=${alt.toFixed(0)}: back at ${rig.cameraToBack.toFixed(0)} ft, far=${far.toFixed(0)} ft`;
  }
  return null;
}
