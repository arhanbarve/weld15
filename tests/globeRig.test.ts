import { describe, it, expect } from "vitest";
import { WELD_ORIGIN } from "@/geo/frames";
import { GLOBE_FAR_RATIO, R_EARTH_FT, globeClipFloor, nearFar } from "@/scene/altitude";
import {
  aboveHorizon,
  assertRigVisible,
  geoToSite,
  globeRig,
  spinPose,
  weldBasis,
  type Vec3,
} from "@/scene/globeRig";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Altitudes the globe is actually drawn at: from just above the fade-out to well past orbit. */
const FLIGHT = [
  40_000, 60_000, 99_000, 250_000, 1e6, 5e6, 2.09e7, 3.3443570e7, 1e8,
];

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

describe("the proxy sphere subtends the real Earth's angular size", () => {
  /**
   * THE INVARIANCE, checked rather than asserted in prose.
   *
   * asin(R / d) with d = R * (len / R_EARTH) is asin(R_EARTH / len): the proxy radius
   * cancels. So whatever radius the schedule hands out, the sphere covers exactly the same
   * solid angle as the real Earth would from the same altitude. That is the entire reason
   * this construction is allowed to exist, and if it ever stops holding the globe is simply
   * the wrong size on screen.
   */
  it("matches asin(R_EARTH / (alt + R_EARTH)) at every altitude in the flight", () => {
    for (const alt of FLIGHT) {
      const truth = Math.asin(R_EARTH_FT / (alt + R_EARTH_FT)) * RAD;
      expect(globeRig([0, alt, 0]).angularRadiusDeg, `alt ${alt}`).toBeCloseTo(truth, 9);
    }
  });

  it("is unchanged when the proxy radius is changed by hand", () => {
    // The same construction at three arbitrary radii, none of them the schedule's. If the
    // image depended on the radius, these would differ.
    const alt = 99_000;
    const at = (radius: number) => {
      const d = radius * ((alt + R_EARTH_FT) / R_EARTH_FT);
      return Math.asin(radius / d) * RAD;
    };
    const ref = globeRig([0, alt, 0]).angularRadiusDeg;
    for (const r of [1, 5_000, 500_000, 1e9]) {
      expect(at(r), `radius ${r}`).toBeCloseTo(ref, 9);
    }
  });

  it("fills the frame at stage 0, which is what kf0's 1.6 Earth radii was chosen for", () => {
    // 1.6 R_EARTH of altitude means 2.6 R_EARTH from the centre, so the half-angle is
    // asin(1/2.6) = 22.6 degrees and a 45 degree vertical fov just contains it. That is the
    // shot the unit-scale kf0 framed at position [0, 0, 2.6], and it has to survive the move
    // to foot scale unchanged.
    const alt = 1.6 * R_EARTH_FT;
    const half = globeRig([0, alt, 0]).angularRadiusDeg;
    expect(half).toBeCloseTo(Math.asin(1 / 2.6) * RAD, 6);
    // 22.6198 degrees against a half-fov of 22.5, so the limb is cropped by a tenth of a
    // degree top and bottom. That is "the globe just fills the frame" in P9.md's table at
    // section 2.1, and it is worth pinning the SIGN of it: the disc is very slightly larger
    // than the frame, not very slightly smaller, so stage 0 has no background showing above
    // and below the Earth. A later change of fov that flipped this would put two bands of
    // void into the first frame the viewer ever sees.
    expect(half).toBeGreaterThan(45 / 2);
    expect(half - 45 / 2).toBeLessThan(0.2);
  });
});

describe("the rig fits inside the frustum wherever the globe is drawn", () => {
  it("clears the near plane and stays inside the far plane across the flight", () => {
    for (const alt of FLIGHT) {
      expect(assertRigVisible(alt), `alt ${alt}`).toBeNull();
    }
  });

  it("reports a failure below the floor rather than silently vanishing", () => {
    // The failure mode this guard exists for: an Earth that is simply absent looks exactly
    // like a texture that did not load, so the debugging goes to the wrong place.
    const floor = globeClipFloor();
    expect(assertRigVisible(floor * 0.5)).toMatch(/near plane/);
    expect(assertRigVisible(floor * 1.5)).toBeNull();
  });

  it("puts the radius at far/8 and the surface where altitude.ts says", () => {
    for (const alt of FLIGHT) {
      const rig = globeRig([0, alt, 0]);
      const { far } = nearFar(alt);
      expect(rig.radius, `radius at ${alt}`).toBeCloseTo(far / GLOBE_FAR_RATIO, 6);
      expect(rig.cameraToSurface, `surface at ${alt}`).toBeCloseTo(
        rig.radius * (alt / R_EARTH_FT),
        3,
      );
      expect(rig.cameraToBack).toBeCloseTo(rig.distanceToCentre + rig.radius, 6);
    }
  });

  it("reproduces the surface distances printed in P9.md section 3.3", () => {
    const rows: [number, number][] = [
      [3.344e7, 799_915],
      [99_000, 2_368],
      [60_000, 890],
      [40_000, 403],
      [20_000, 101],
    ];
    for (const [alt, surface] of rows) {
      expect(globeRig([0, alt, 0]).cameraToSurface / surface, `alt ${alt}`).toBeCloseTo(1, 2);
    }
  });
});

describe("the centre is placed along the true local vertical", () => {
  it("sits directly below a camera that is directly overhead", () => {
    const alt = 1e6;
    const rig = globeRig([0, alt, 0]);
    expect(rig.centre[0]).toBeCloseTo(0, 6);
    expect(rig.centre[2]).toBeCloseTo(0, 6);
    // BELOW THE CAMERA, not below grade. The proxy centre is 523,921 ft under a camera at
    // 1,000,000 ft, so it lands at y = +476,079 -- far above where Earth's real centre would
    // be at -20,902,231. That is the construction working, not a bug: the sphere is a small
    // near object standing in for a huge far one, and expecting its centre underground is
    // the mistake this assertion is written to rule out.
    expect(rig.centre[1]).toBeLessThan(alt);
    expect(alt - rig.centre[1]).toBeCloseTo(rig.distanceToCentre, 3);
    expect(rig.centre[1]).toBeGreaterThan(-R_EARTH_FT);
  });

  it("stays on the line from the camera to the real Earth centre when off nadir", () => {
    // Every stop below the top of the descent is off nadir -- stage 1 looks down at an
    // angle -- so this is the case that actually ships, not an edge case.
    const cam: Vec3 = [12_000, 28_000, 19_000];
    const rig = globeRig(cam);
    const toReal: Vec3 = [-cam[0], -R_EARTH_FT - cam[1], -cam[2]];
    const toProxy: Vec3 = [
      rig.centre[0] - cam[0],
      rig.centre[1] - cam[1],
      rig.centre[2] - cam[2],
    ];
    // Same direction: the cosine between them is 1.
    expect(dot(toReal, toProxy) / (len(toReal) * len(toProxy))).toBeCloseTo(1, 12);
  });

  it("derives alt from the camera's y by default, matching altitude.ts's definition", () => {
    const cam: Vec3 = [500, 28_000, 900];
    expect(globeRig(cam).radius).toBeCloseTo(globeRig(cam, 28_000).radius, 9);
  });
});

describe("the frame rotation", () => {
  const basis = weldBasis();

  it("is orthonormal", () => {
    for (const [k, v] of Object.entries(basis)) {
      expect(len(v as Vec3), `|${k}|`).toBeCloseTo(1, 12);
    }
    expect(dot(basis.x, basis.y)).toBeCloseTo(0, 12);
    expect(dot(basis.y, basis.z)).toBeCloseTo(0, 12);
    expect(dot(basis.z, basis.x)).toBeCloseTo(0, 12);
  });

  it("is right-handed, which is what stops the Earth being mirrored", () => {
    // frames.ts:13-17 warns that a frame mistake mirrors the building invisibly. The same
    // mistake here mirrors the Earth, and a mirrored Blue Marble is not obviously wrong at a
    // glance -- so it is checked rather than eyeballed.
    const c = cross(basis.x, basis.y);
    expect(c[0]).toBeCloseTo(basis.z[0], 12);
    expect(c[1]).toBeCloseTo(basis.z[1], 12);
    expect(c[2]).toBeCloseTo(basis.z[2], 12);
  });

  it("puts Weld at the top of the sphere", () => {
    // Weld's own outward normal, in geocentric coords, must come out as site +Y. In the site
    // frame Weld is at the origin and Earth's centre is at (0, -R, 0), so the proxy's north
    // pole IS Weld and this is the identity that says so.
    const f = WELD_ORIGIN.lat * DEG;
    const l = WELD_ORIGIN.lon * DEG;
    const up: Vec3 = [Math.cos(f) * Math.cos(l), Math.sin(f), -Math.cos(f) * Math.sin(l)];
    const site = geoToSite(up, basis);
    expect(site[0]).toBeCloseTo(0, 12);
    expect(site[1]).toBeCloseTo(1, 12);
    expect(site[2]).toBeCloseTo(0, 12);
  });

  it("sends the geographic north pole toward site -Z, i.e. true north", () => {
    // place.test.ts:72 asserts the suite goes to three space "with north on -Z". The globe
    // has to agree with it or the photograph and the massing point different ways.
    const site = geoToSite([0, 1, 0], basis);
    expect(site[2]).toBeLessThan(0);
    // Due north: no east/west component at all.
    expect(site[0]).toBeCloseTo(0, 12);
    // AND ITS ELEVATION ABOVE THE LOCAL HORIZONTAL IS THE LATITUDE, not the co-latitude.
    // This is the same identity that puts Polaris at your latitude above the horizon, and it
    // is asserted here because getting it the other way round -- which is the natural mistake,
    // since the pole is at the co-latitude away from the zenith -- tips the globe by 5.25
    // degrees at Weld and would be very hard to see.
    expect(Math.asin(site[1]) * RAD).toBeCloseTo(WELD_ORIGIN.lat, 9);
  });

  it("sends a point one degree east of Weld to +X", () => {
    const f = WELD_ORIGIN.lat * DEG;
    const l = (WELD_ORIGIN.lon + 1) * DEG;
    const east: Vec3 = [Math.cos(f) * Math.cos(l), Math.sin(f), -Math.cos(f) * Math.sin(l)];
    const site = geoToSite(east, basis);
    expect(site[0]).toBeGreaterThan(0);
    // Still essentially at the top, one degree away.
    expect(site[1]).toBeGreaterThan(Math.cos(2 * DEG));
  });

  it("is the identity at latitude 0, longitude 0 up to the north/south flip", () => {
    // A hand-checkable case, since every term in weldBasis() collapses: east = (0,0,-1),
    // up = (1,0,0), south = (0,-1,0).
    const b = weldBasis(0, 0);
    expect(b.x).toEqual([-0, 0, -1]);
    expect(b.y[0]).toBeCloseTo(1, 12);
    expect(b.z[1]).toBeCloseTo(-1, 12);
  });
});

/**
 * P10 step 7: spinning the camera about Earth's centre, at stage 0.
 *
 * EARTH_CENTRE is spinPose's own pivot and is not exported, so it is recomputed here as
 * [0, -R_EARTH_FT, 0] -- the same point globeRig()'s `dy = -R_EARTH_FT - cameraPos[1]`
 * measures from, per spinPose's own docblock.
 */
describe("spinPose", () => {
  const EARTH_CENTRE: Vec3 = [0, -R_EARTH_FT, 0];
  const dist = (p: Vec3, c: Vec3) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
  const P: Vec3 = [1000, 5_000_000, 2000];
  const T: Vec3 = [0, 42, 0];

  it("is the identity when the spin is zero, for every k", () => {
    for (const k of [0, 0.25, 0.6, 1]) {
      const out = spinPose(P, T, { yawDeg: 0, pitchDeg: 0 }, k);
      expect(out.position, `k=${k}`).toEqual(P);
      expect(out.target, `k=${k}`).toEqual(T);
    }
  });

  it("is the identity when k is zero, for every spin", () => {
    const spins = [
      { yawDeg: 30, pitchDeg: 10 },
      { yawDeg: -180, pitchDeg: -60 },
      { yawDeg: 720, pitchDeg: 80 },
    ];
    for (const spin of spins) {
      const out = spinPose(P, T, spin, 0);
      expect(out.position, JSON.stringify(spin)).toEqual(P);
      expect(out.target, JSON.stringify(spin)).toEqual(T);
    }
  });

  it("preserves |position - centre| to 1e-9 relative, so altitude does not drift", () => {
    const before = dist(P, EARTH_CENTRE);
    const spins = [
      { yawDeg: 12, pitchDeg: 5 },
      { yawDeg: 200, pitchDeg: -70 },
      { yawDeg: -400, pitchDeg: 80 },
    ];
    for (const spin of spins) {
      for (const k of [0.3, 1]) {
        const out = spinPose(P, T, spin, k);
        const after = dist(out.position, EARTH_CENTRE);
        expect(
          Math.abs(after - before) / before,
          `${JSON.stringify(spin)} k=${k}`,
        ).toBeLessThan(1e-9);
      }
    }
  });

  it("puts the camera on the far side at yaw 180", () => {
    // On the site Y axis so the rotation, which is about site +Z, is an exact antipode
    // rather than a general point that a single-axis flip would not fully invert.
    const alt = 1.5 * R_EARTH_FT;
    const p: Vec3 = [0, alt, 0];
    const before: Vec3 = [p[0] - EARTH_CENTRE[0], p[1] - EARTH_CENTRE[1], p[2] - EARTH_CENTRE[2]];
    const out = spinPose(p, T, { yawDeg: 180, pitchDeg: 0 }, 1);
    const after: Vec3 = [
      out.position[0] - EARTH_CENTRE[0],
      out.position[1] - EARTH_CENTRE[1],
      out.position[2] - EARTH_CENTRE[2],
    ];
    const cosine =
      (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) /
      (Math.hypot(...before) * Math.hypot(...after));
    expect(cosine).toBeCloseTo(-1, 9);
  });

  it("clamps pitchDeg at plus or minus 80 degrees", () => {
    const atLimit = spinPose(P, T, { yawDeg: 0, pitchDeg: 80 }, 1);
    const beyond = spinPose(P, T, { yawDeg: 0, pitchDeg: 200 }, 1);
    expect(beyond.position[0]).toBeCloseTo(atLimit.position[0], 6);
    expect(beyond.position[1]).toBeCloseTo(atLimit.position[1], 6);
    expect(beyond.position[2]).toBeCloseTo(atLimit.position[2], 6);

    const atNegLimit = spinPose(P, T, { yawDeg: 0, pitchDeg: -80 }, 1);
    const beyondNeg = spinPose(P, T, { yawDeg: 0, pitchDeg: -200 }, 1);
    expect(beyondNeg.position[0]).toBeCloseTo(atNegLimit.position[0], 6);
    expect(beyondNeg.position[1]).toBeCloseTo(atNegLimit.position[1], 6);
    expect(beyondNeg.position[2]).toBeCloseTo(atNegLimit.position[2], 6);
  });
});

describe("aboveHorizon", () => {
  it("is true on the sub-camera point and false on the antipode", () => {
    expect(aboveHorizon(1, 100, 1000)).toBe(true);
    expect(aboveHorizon(-1, 100, 1000)).toBe(false);
  });

  it("flips exactly at acos(radius / distance)", () => {
    const radius = 100;
    const distance = 1000;
    const boundary = radius / distance;
    expect(aboveHorizon(boundary, radius, distance)).toBe(false);
    expect(aboveHorizon(boundary + 1e-9, radius, distance)).toBe(true);
    expect(aboveHorizon(boundary - 1e-9, radius, distance)).toBe(false);
  });
});
