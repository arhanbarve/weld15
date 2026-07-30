import { describe, it, expect } from "vitest";
import weld from "@/data/weld.json";
import { pointInPolygon } from "@/geo/collide";
import { WELD } from "@/geo/place";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import {
  STAGE3_CLAMP,
  WELD_FOOTPRINT_RADIUS,
  clampOrbit,
  orbitKeyframe,
  orbitOf,
  type Orbit,
} from "@/scene/orbit";
import { keyframes, type Keyframe } from "@/scene/stages";

const kf = keyframes(DEFAULT_PARAMS);
/** The keyframe the orbit is an offset from. */
const base = kf[3];
const ring = weld.rings[0] as number[][];
const DEG = Math.PI / 180;

const dist = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);

/**
 * A target sitting exactly at grade.
 *
 * Not a keyframe stages.ts produces -- stage 3 aims 42 ft up the facade -- but it
 * is the worst case for "never below grade", and with 42 ft of target height in
 * hand that assertion passes for the wrong reason. maxPolarDeg has to hold the
 * camera above ANY target at or above grade, so the test uses one at zero.
 */
const gradeBase: Keyframe = { position: [200, 100, 200], target: [0, 0, 0], fov: 45 };

/** Every axis out of range, both directions, plus the wrap traps. */
const WILD: Orbit[] = [
  { azimuthDeg: 0, polarDeg: 45, radius: 200 },
  { azimuthDeg: 141.7, polarDeg: 74.3, radius: 251.4 },
  { azimuthDeg: 900, polarDeg: 45, radius: 200 },
  { azimuthDeg: -900, polarDeg: 45, radius: 200 },
  { azimuthDeg: 180, polarDeg: 45, radius: 200 },
  { azimuthDeg: -180, polarDeg: 45, radius: 200 },
  // Wraps to 154.26292496143347, and wrapping THAT with the raw modulo drops an
  // ulp. See wrapAzimuth in orbit.ts.
  { azimuthDeg: -205.73707503856653, polarDeg: 45, radius: 200 },
  { azimuthDeg: -220.9455132280036, polarDeg: 45, radius: 200 },
  { azimuthDeg: 0, polarDeg: 0, radius: 200 },
  { azimuthDeg: 0, polarDeg: -60, radius: 200 },
  { azimuthDeg: 0, polarDeg: 90, radius: 200 },
  { azimuthDeg: 0, polarDeg: 179, radius: 200 },
  { azimuthDeg: 0, polarDeg: 270, radius: 200 },
  { azimuthDeg: 0, polarDeg: 45, radius: 0 },
  { azimuthDeg: 0, polarDeg: 45, radius: -400 },
  { azimuthDeg: 0, polarDeg: 45, radius: 5000 },
  { azimuthDeg: 1e6, polarDeg: 1e6, radius: 1e6 },
  { azimuthDeg: -1e6, polarDeg: -1e6, radius: -1e6 },
];

/** Orbit requests spanning and overshooting the clamp on every axis. */
function sweep(): Orbit[] {
  const out: Orbit[] = [];
  for (let azimuthDeg = -360; azimuthDeg <= 360; azimuthDeg += 13) {
    for (const polarDeg of [-90, -1, 0, 5, 15, 30, 45, 60, 74.3, 88, 90, 120, 179, 260]) {
      for (const radius of [-100, 0, 1, 60, 114.9, 200, 251.4, 344.7, 1000, 1e5]) {
        out.push({ azimuthDeg, polarDeg, radius });
      }
    }
  }
  return out;
}

describe("STAGE3_CLAMP", () => {
  it("takes the footprint radius from Weld's own ring", () => {
    // Stated as a property of the max rather than recomputed with the same
    // reduce, so the test is not just the implementation typed twice.
    let touched = false;
    for (const p of ring) {
      const r = Math.hypot(p[0]!, p[1]!);
      expect(r).toBeLessThanOrEqual(WELD_FOOTPRINT_RADIUS + 1e-9);
      if (Math.abs(r - WELD_FOOTPRINT_RADIUS) < 1e-9) touched = true;
    }
    expect(touched, "no ring vertex is at the stated radius").toBe(true);
  });

  it("keeps the near limit outside the whole footprint", () => {
    // Not just outside on average: every vertex of the ring, including the wing
    // corners, has to be inside the sphere the camera orbits on.
    for (const p of ring) {
      expect(Math.hypot(p[0]!, p[1]!)).toBeLessThan(STAGE3_CLAMP.minRadius);
    }
    expect(STAGE3_CLAMP.minRadius).toBeGreaterThan(WELD_FOOTPRINT_RADIUS);
  });

  it("clears the ridge as well as the footprint", () => {
    // A near limit that cleared the plan but not the height would let a top-down
    // orbit end up inside the roof.
    expect(STAGE3_CLAMP.minRadius).toBeGreaterThan(WELD.ridge);
  });

  it("stops well inside the Yard shot", () => {
    // Stage 2 IS the wide shot. If stage 3 can retreat to stage 2's range there
    // are two stages showing the same thing and the descent stalls.
    const yardRange = dist(kf[2].position, kf[2].target);
    expect(STAGE3_CLAMP.maxRadius).toBeLessThan(yardRange / 2);
  });

  it("brackets the stage-3 base keyframe", () => {
    // If the clamp did not already contain the base orbit, simply enabling the
    // orbit would jerk the camera before the user touched anything.
    const o = orbitOf(base);
    expect(o.radius).toBeGreaterThan(STAGE3_CLAMP.minRadius);
    expect(o.radius).toBeLessThan(STAGE3_CLAMP.maxRadius);
    expect(o.polarDeg).toBeGreaterThan(STAGE3_CLAMP.minPolarDeg);
    expect(o.polarDeg).toBeLessThan(STAGE3_CLAMP.maxPolarDeg);
    expect(clampOrbit(o)).toEqual(o);
  });

  it("never lets the eye reach the horizon", () => {
    // Under 90 the camera is strictly above its target. That is the whole
    // guarantee behind "no view of an underside that does not exist".
    expect(STAGE3_CLAMP.maxPolarDeg).toBeLessThan(90);
  });
});

describe("clampOrbit", () => {
  it("is idempotent", () => {
    for (const o of WILD) {
      const once = clampOrbit(o);
      expect(clampOrbit(once), JSON.stringify(o)).toEqual(once);
    }
  });

  it("brings every axis back into range", () => {
    for (const o of [...WILD, ...sweep()]) {
      const c = clampOrbit(o);
      const where = JSON.stringify(o);
      expect(c.radius, where).toBeGreaterThanOrEqual(STAGE3_CLAMP.minRadius);
      expect(c.radius, where).toBeLessThanOrEqual(STAGE3_CLAMP.maxRadius);
      expect(c.polarDeg, where).toBeGreaterThanOrEqual(STAGE3_CLAMP.minPolarDeg);
      expect(c.polarDeg, where).toBeLessThanOrEqual(STAGE3_CLAMP.maxPolarDeg);
      expect(c.azimuthDeg, where).toBeGreaterThan(-180);
      expect(c.azimuthDeg, where).toBeLessThanOrEqual(180);
    }
  });

  it("leaves an in-range orbit untouched", () => {
    const o: Orbit = { azimuthDeg: -37.5, polarDeg: 62.25, radius: 210.75 };
    expect(clampOrbit(o)).toEqual(o);
  });

  it("honours a caller's clamp instead of the stage-3 one", () => {
    const tight = { minRadius: 400, maxRadius: 500, minPolarDeg: 40, maxPolarDeg: 50 };
    const c = clampOrbit({ azimuthDeg: 20, polarDeg: 80, radius: 120 }, tight);
    expect(c.radius).toBe(400);
    expect(c.polarDeg).toBe(50);
  });
});

describe("orbitKeyframe", () => {
  it("reproduces the base keyframe at the base orbit", () => {
    // The round trip through spherical and back is the mirror test. A sign error
    // on north, or east and north swapped, survives every magnitude assertion in
    // this file and shows up only here.
    const got = orbitKeyframe(base, orbitOf(base));
    for (let i = 0; i < 3; i++) expect(got.position[i]).toBeCloseTo(base.position[i]!, 6);
    expect(got.target).toEqual(base.target);
    expect(got.fov).toBe(base.fov);
  });

  it("keeps the base's target and fov", () => {
    // The odd fov is deliberate. Every stage 1-3 keyframe uses 45, so a base whose
    // fov happens to be 45 cannot tell "carried through" from "hard-coded".
    for (const b of [base, { ...base, fov: 33.5 }]) {
      for (const o of WILD) {
        const got = orbitKeyframe(b, o);
        expect(got.target).toEqual(b.target);
        expect(got.fov).toBe(b.fov);
      }
    }
  });

  it("stands at exactly the clamped radius from the target", () => {
    for (const o of sweep()) {
      const got = orbitKeyframe(base, o);
      expect(dist(got.position, got.target), JSON.stringify(o)).toBeCloseTo(
        clampOrbit(o).radius,
        6,
      );
    }
  });

  it("honours an in-range radius request exactly", () => {
    for (const radius of [115, 160, 251.4, 300, 344]) {
      const got = orbitKeyframe(base, { azimuthDeg: 33, polarDeg: 55, radius });
      expect(dist(got.position, got.target)).toBeCloseTo(radius, 6);
    }
  });

  it("reads azimuth as a compass bearing", () => {
    // 0 due north of the target, 90 due east -- the site frame's convention, with
    // north at -Z. Fixes the orbit's handedness independently of the round trip.
    const north = orbitKeyframe(base, { azimuthDeg: 0, polarDeg: 60, radius: 200 });
    expect(north.position[0]).toBeCloseTo(base.target[0], 6);
    expect(north.position[2]).toBeLessThan(base.target[2] - 100);

    const east = orbitKeyframe(base, { azimuthDeg: 90, polarDeg: 60, radius: 200 });
    expect(east.position[2]).toBeCloseTo(base.target[2], 6);
    expect(east.position[0]).toBeGreaterThan(base.target[0] + 100);
  });

  it("never puts the eye at or below grade", () => {
    for (const b of [base, gradeBase, kf[5]]) {
      for (const o of sweep()) {
        expect(orbitKeyframe(b, o).position[1], JSON.stringify(o)).toBeGreaterThan(0);
      }
    }
  });

  it("never sits inside the footprint radius of the origin", () => {
    for (const b of [base, gradeBase]) {
      for (const o of sweep()) {
        const p = orbitKeyframe(b, o).position;
        expect(Math.hypot(p[0], p[1], p[2]), JSON.stringify(o)).toBeGreaterThan(
          WELD_FOOTPRINT_RADIUS,
        );
      }
    }
  });

  it("never sits inside Weld's real massing", () => {
    // The distance-from-origin check above is a sphere; this one is the actual
    // 59-point ring. A camera 100 ft from the centroid and 20 ft up satisfies the
    // sphere test at some azimuths and is still in the building.
    for (const o of sweep()) {
      const p = orbitKeyframe(base, o).position;
      const inPlan = pointInPolygon([p[0], -p[2]], ring);
      expect(!inPlan || p[1] > WELD.ridge, JSON.stringify(o)).toBe(true);
    }
  });

  it("stops short of a plan view", () => {
    // At the top of the orbit the camera must still stand off to one side: the
    // horizontal offset is at least a fifth of the vertical one, which at 15 deg
    // leaves the 60 ft facades projecting 15.5 ft against a 143 ft roof. Nearer
    // to straight down and the elevation is gone.
    const p = orbitKeyframe(base, { azimuthDeg: 0, polarDeg: -30, radius: 200 }).position;
    const flat = Math.hypot(p[0] - base.target[0], p[2] - base.target[2]);
    const up = p[1] - base.target[1];
    expect(up).toBeGreaterThan(0);
    expect(flat / up).toBeGreaterThan(0.2);
  });

  it("clamps a request that would fly past the Yard", () => {
    const got = orbitKeyframe(base, { azimuthDeg: 0, polarDeg: 45, radius: 1e5 });
    expect(dist(got.position, got.target)).toBeCloseTo(STAGE3_CLAMP.maxRadius, 6);
  });
});

describe("orbitOf", () => {
  it("inverts orbitKeyframe for in-range orbits", () => {
    for (let azimuthDeg = -175; azimuthDeg <= 180; azimuthDeg += 11) {
      for (const polarDeg of [16, 30, 45, 74.3, 87]) {
        for (const radius of [120, 200, 340]) {
          const o = { azimuthDeg, polarDeg, radius };
          const back = orbitOf(orbitKeyframe(base, o));
          expect(back.azimuthDeg, JSON.stringify(o)).toBeCloseTo(azimuthDeg, 6);
          expect(back.polarDeg, JSON.stringify(o)).toBeCloseTo(polarDeg, 6);
          expect(back.radius, JSON.stringify(o)).toBeCloseTo(radius, 6);
        }
      }
    }
  });

  it("reads the stage-3 keyframe as a south-east view from 251 ft", () => {
    // Anchors the convention against a keyframe someone else wrote: stage 3
    // stands east and south of Weld, above the eaves, looking back at it.
    const o = orbitOf(base);
    expect(o.radius).toBeCloseTo(251.44, 1);
    expect(o.azimuthDeg).toBeGreaterThan(90);
    expect(o.azimuthDeg).toBeLessThan(180);
    expect(o.polarDeg).toBeCloseTo(74.31, 1);
  });
});
