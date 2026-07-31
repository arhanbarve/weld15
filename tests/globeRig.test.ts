import { describe, it, expect } from "vitest";
import { WELD_ORIGIN } from "@/geo/frames";
import { GLOBE_FAR_RATIO, R_EARTH_FT, globeClipFloor, nearFar } from "@/scene/altitude";
import {
  assertRigVisible,
  geoToSite,
  globeRig,
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
