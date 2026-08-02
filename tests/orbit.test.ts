import { describe, it, expect } from "vitest";
import weld from "@/data/weld.json";
import { pointInPolygon } from "@/geo/collide";
import { WELD } from "@/geo/place";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import {
  STAGE3_CLAMP,
  STAGE4_CLAMP,
  MASSING_CENTER,
  WELD_FOOTPRINT_RADIUS,
  clampOrbit,
  orbitKeyframe,
  orbitOf,
  stage4OrbitKeyframe,
  type Orbit,
} from "@/scene/orbit";
import { keyframes, type Keyframe } from "@/scene/stages";

/**
 * P11 (task 7): reparametrized from `{ azimuthDeg, polarDeg, radius }` to
 * `{ headingDeg, pitchDeg, rangeFt }`, matching store.ts's new Orbit shape and
 * geo/rig.ts's GeoPose field names -- see orbit.ts's own header for the exact
 * substitution (`pitchDeg = 90 - polarDeg`, `headingDeg` identical to the old
 * `azimuthDeg`, `rangeFt` identical to the old `radius`).
 *
 * EVERY NUMERIC ASSERTION THIS FILE MADE BEFORE STILL HOLDS, under the substitution.
 * `headingDeg`/`rangeFt` values are copied verbatim from the old `azimuthDeg`/`radius`
 * fixtures, because they are literally the same quantity under the same convention.
 * `polarDeg` values are replaced by `90 - polarDeg` so that the WILD/sweep fixtures probe
 * the identical physical camera positions as before (a polar sweep of -90..270 becomes a
 * pitch sweep of -180..180, a polar clamp of 15..88 becomes a pitch clamp of 2..75), and
 * every assertion about the RESULT (position, range-from-target, "never below grade",
 * "never inside the massing", "clamped to the stage-3 range") is unchanged prose with
 * renamed fields -- nothing here is loosened; see orbit.ts's own header for the algebraic
 * proof that the substitution reproduces the old arithmetic exactly.
 */

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
 * hand that assertion passes for the wrong reason. maxPitchDeg has to hold the
 * camera above ANY target at or above grade, so the test uses one at zero.
 */
const gradeBase: Keyframe = { position: [200, 100, 200], target: [0, 0, 0], fov: 45 };

/**
 * Every axis out of range, both directions, plus the wrap traps.
 *
 * `pitchDeg` fixtures are `90 - <the old polarDeg fixture>`, coordinate for coordinate,
 * so this sweeps exactly the same physical positions the old `polarDeg` fixtures did.
 */
const WILD: Orbit[] = [
  { headingDeg: 0, pitchDeg: 45, rangeFt: 200 }, // polarDeg 45
  { headingDeg: 141.7, pitchDeg: 15.7, rangeFt: 251.4 }, // polarDeg 74.3
  { headingDeg: 900, pitchDeg: 45, rangeFt: 200 }, // polarDeg 45
  { headingDeg: -900, pitchDeg: 45, rangeFt: 200 }, // polarDeg 45
  { headingDeg: 180, pitchDeg: 45, rangeFt: 200 }, // polarDeg 45
  { headingDeg: -180, pitchDeg: 45, rangeFt: 200 }, // polarDeg 45
  // Heading wraps to 154.26292496143347, and wrapping THAT with the raw modulo drops an
  // ulp. See wrapHeading in orbit.ts.
  { headingDeg: -205.73707503856653, pitchDeg: 45, rangeFt: 200 },
  { headingDeg: -220.9455132280036, pitchDeg: 45, rangeFt: 200 },
  { headingDeg: 0, pitchDeg: 90, rangeFt: 200 }, // polarDeg 0
  { headingDeg: 0, pitchDeg: 150, rangeFt: 200 }, // polarDeg -60
  { headingDeg: 0, pitchDeg: 0, rangeFt: 200 }, // polarDeg 90
  { headingDeg: 0, pitchDeg: -89, rangeFt: 200 }, // polarDeg 179
  { headingDeg: 0, pitchDeg: -180, rangeFt: 200 }, // polarDeg 270
  { headingDeg: 0, pitchDeg: 45, rangeFt: 0 },
  { headingDeg: 0, pitchDeg: 45, rangeFt: -400 },
  { headingDeg: 0, pitchDeg: 45, rangeFt: 5000 },
  { headingDeg: 1e6, pitchDeg: 1e6, rangeFt: 1e6 },
  { headingDeg: -1e6, pitchDeg: -1e6, rangeFt: -1e6 },
];

/** Orbit requests spanning and overshooting the clamp on every axis. */
function sweep(): Orbit[] {
  const out: Orbit[] = [];
  for (let headingDeg = -360; headingDeg <= 360; headingDeg += 13) {
    // pitchDeg = 90 - polarDeg for each of the old polarDeg samples
    // [-90, -1, 0, 5, 15, 30, 45, 60, 74.3, 88, 90, 120, 179, 260].
    for (const pitchDeg of [180, 91, 90, 85, 75, 60, 45, 30, 15.7, 2, 0, -30, -89, -170]) {
      for (const rangeFt of [-100, 0, 1, 60, 114.9, 200, 251.4, 344.7, 1000, 1e5]) {
        out.push({ headingDeg, pitchDeg, rangeFt });
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
      expect(Math.hypot(p[0]!, p[1]!)).toBeLessThan(STAGE3_CLAMP.minRangeFt);
    }
    expect(STAGE3_CLAMP.minRangeFt).toBeGreaterThan(WELD_FOOTPRINT_RADIUS);
  });

  it("clears the ridge as well as the footprint", () => {
    // A near limit that cleared the plan but not the height would let a top-down
    // orbit end up inside the roof.
    expect(STAGE3_CLAMP.minRangeFt).toBeGreaterThan(WELD.ridge);
  });

  it("stops well inside the Yard shot", () => {
    // Stage 2 IS the wide shot. If stage 3 can retreat to stage 2's range there
    // are two stages showing the same thing and the descent stalls.
    const yardRange = dist(kf[2].position, kf[2].target);
    expect(STAGE3_CLAMP.maxRangeFt).toBeLessThan(yardRange / 2);
  });

  it("brackets the stage-3 base keyframe", () => {
    // If the clamp did not already contain the base orbit, simply enabling the
    // orbit would jerk the camera before the user touched anything.
    const o = orbitOf(base);
    expect(o.rangeFt).toBeGreaterThan(STAGE3_CLAMP.minRangeFt);
    expect(o.rangeFt).toBeLessThan(STAGE3_CLAMP.maxRangeFt);
    expect(o.pitchDeg).toBeGreaterThan(STAGE3_CLAMP.minPitchDeg);
    expect(o.pitchDeg).toBeLessThan(STAGE3_CLAMP.maxPitchDeg);
    expect(clampOrbit(o)).toEqual(o);
  });

  it("never lets the eye reach the horizon", () => {
    // Above 0 the camera is strictly above its target. That is the whole
    // guarantee behind "no view of an underside that does not exist".
    expect(STAGE3_CLAMP.minPitchDeg).toBeGreaterThan(0);
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
      expect(c.rangeFt, where).toBeGreaterThanOrEqual(STAGE3_CLAMP.minRangeFt);
      expect(c.rangeFt, where).toBeLessThanOrEqual(STAGE3_CLAMP.maxRangeFt);
      expect(c.pitchDeg, where).toBeGreaterThanOrEqual(STAGE3_CLAMP.minPitchDeg);
      expect(c.pitchDeg, where).toBeLessThanOrEqual(STAGE3_CLAMP.maxPitchDeg);
      expect(c.headingDeg, where).toBeGreaterThan(-180);
      expect(c.headingDeg, where).toBeLessThanOrEqual(180);
    }
  });

  it("leaves an in-range orbit untouched", () => {
    const o: Orbit = { headingDeg: -37.5, pitchDeg: 27.75, rangeFt: 210.75 }; // pitchDeg = 90 - 62.25
    expect(clampOrbit(o)).toEqual(o);
  });

  it("honours a caller's clamp instead of the stage-3 one", () => {
    const tight = { minRangeFt: 400, maxRangeFt: 500, minPitchDeg: 40, maxPitchDeg: 50 };
    const c = clampOrbit({ headingDeg: 20, pitchDeg: 10, rangeFt: 120 }, tight);
    expect(c.rangeFt).toBe(400);
    expect(c.pitchDeg).toBe(40);
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

  it("stands at exactly the clamped range from the target", () => {
    for (const o of sweep()) {
      const got = orbitKeyframe(base, o);
      expect(dist(got.position, got.target), JSON.stringify(o)).toBeCloseTo(
        clampOrbit(o).rangeFt,
        6,
      );
    }
  });

  it("honours an in-range range request exactly", () => {
    for (const rangeFt of [115, 160, 251.4, 300, 344]) {
      const got = orbitKeyframe(base, { headingDeg: 33, pitchDeg: 35, rangeFt }); // pitchDeg = 90 - 55
      expect(dist(got.position, got.target)).toBeCloseTo(rangeFt, 6);
    }
  });

  it("reads heading as a compass bearing", () => {
    // 0 due north of the target, 90 due east -- the site frame's convention, with
    // north at -Z. Fixes the orbit's handedness independently of the round trip.
    const north = orbitKeyframe(base, { headingDeg: 0, pitchDeg: 30, rangeFt: 200 }); // pitchDeg = 90 - 60
    expect(north.position[0]).toBeCloseTo(base.target[0], 6);
    expect(north.position[2]).toBeLessThan(base.target[2] - 100);

    const east = orbitKeyframe(base, { headingDeg: 90, pitchDeg: 30, rangeFt: 200 });
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
    // sphere test at some headings and is still in the building.
    for (const o of sweep()) {
      const p = orbitKeyframe(base, o).position;
      const inPlan = pointInPolygon([p[0], -p[2]], ring);
      expect(!inPlan || p[1] > WELD.ridge, JSON.stringify(o)).toBe(true);
    }
  });

  it("stops short of a plan view", () => {
    // At the top of the orbit the camera must still stand off to one side: the
    // horizontal offset is at least a fifth of the vertical one, which at pitch 75
    // (polar 15) leaves the 60 ft facades projecting 15.5 ft against a 143 ft roof.
    // Nearer to straight down (pitch 90) and the elevation is gone.
    const p = orbitKeyframe(base, { headingDeg: 0, pitchDeg: 120, rangeFt: 200 }).position; // pitchDeg = 90 - (-30)
    const flat = Math.hypot(p[0] - base.target[0], p[2] - base.target[2]);
    const up = p[1] - base.target[1];
    expect(up).toBeGreaterThan(0);
    expect(flat / up).toBeGreaterThan(0.2);
  });

  it("clamps a request that would fly past the Yard", () => {
    const got = orbitKeyframe(base, { headingDeg: 0, pitchDeg: 45, rangeFt: 1e5 });
    expect(dist(got.position, got.target)).toBeCloseTo(STAGE3_CLAMP.maxRangeFt, 6);
  });
});

describe("STAGE4_CLAMP", () => {
  it("keeps the same near limit as stage 3, for the same footprint-and-ridge reason", () => {
    expect(STAGE4_CLAMP.minRangeFt).toBe(STAGE3_CLAMP.minRangeFt);
    expect(STAGE4_CLAMP.minRangeFt).toBeGreaterThan(WELD_FOOTPRINT_RADIUS);
    expect(STAGE4_CLAMP.minRangeFt).toBeGreaterThan(WELD.ridge);
  });

  it("stops well short of stage 3's own range", () => {
    // Twice GABLE_BACK lets the viewer pull back to see Weld whole without
    // reaching the range where Weld stops being the subject.
    expect(STAGE4_CLAMP.maxRangeFt).toBeLessThan(STAGE3_CLAMP.maxRangeFt);
    expect(STAGE4_CLAMP.maxRangeFt).toBeGreaterThan(STAGE4_CLAMP.minRangeFt);
  });

  it("never lets the eye reach the horizon, same as stage 3", () => {
    expect(STAGE4_CLAMP.minPitchDeg).toBeGreaterThan(0);
  });
});

describe("stage4OrbitKeyframe", () => {
  const kf4 = kf[4];
  /** kf[4]'s own orbit, about MASSING_CENTER -- NOT about kf4.target. */
  const seed = orbitOf({ position: kf4.position, target: MASSING_CENTER, fov: kf4.fov });

  it("reproduces kf[4] exactly at its own seed orbit", () => {
    // The round trip that proves the seed is right: a viewer who never drags
    // must see precisely today's kf[4], not a nearby approximation.
    const got = stage4OrbitKeyframe(kf4, seed);
    for (let i = 0; i < 3; i++) expect(got.position[i]).toBeCloseTo(kf4.position[i]!, 6);
    expect(got.target).toEqual(kf4.target);
    expect(got.fov).toBe(kf4.fov);
  });

  it("brackets kf[4]'s own seed orbit inside the clamp", () => {
    // If the clamp did not already contain it, enabling the orbit would jerk
    // the camera before the viewer touched anything -- the same guarantee
    // STAGE3_CLAMP's "brackets the stage-3 base keyframe" test makes.
    expect(seed.rangeFt).toBeGreaterThan(STAGE4_CLAMP.minRangeFt);
    expect(seed.rangeFt).toBeLessThan(STAGE4_CLAMP.maxRangeFt);
    expect(seed.pitchDeg).toBeGreaterThan(STAGE4_CLAMP.minPitchDeg);
    expect(seed.pitchDeg).toBeLessThan(STAGE4_CLAMP.maxPitchDeg);
  });

  it("always looks at kf[4].target, whatever the orbit request", () => {
    // The one thing every dragged pose must agree on: the pivot for the RANGE
    // clamp is MASSING_CENTER, but where the camera looks never moves off
    // insideBedB, or the crossing at t = 1 would not land on kf[4].
    for (const o of [...WILD, ...sweep()]) {
      expect(stage4OrbitKeyframe(kf4, o).target).toEqual(kf4.target);
      expect(stage4OrbitKeyframe(kf4, o).fov).toBe(kf4.fov);
    }
  });

  it("stands at exactly the clamped range from MASSING_CENTER, not from kf4.target", () => {
    // The property STAGE4_CLAMP's own header exists to prove: this is an
    // equality, not the on-axis inequality STAGE3_CLAMP's minRangeFt relies on,
    // because the clamp is applied with MASSING_CENTER as the pivot directly.
    for (const o of sweep()) {
      const p = stage4OrbitKeyframe(kf4, o).position;
      const fromCentre = Math.hypot(p[0] - MASSING_CENTER[0], p[1] - MASSING_CENTER[1], p[2] - MASSING_CENTER[2]);
      expect(fromCentre, JSON.stringify(o)).toBeCloseTo(clampOrbit(o, STAGE4_CLAMP).rangeFt, 6);
    }
  });

  it("never puts the eye at or below grade", () => {
    for (const o of sweep()) {
      expect(stage4OrbitKeyframe(kf4, o).position[1], JSON.stringify(o)).toBeGreaterThan(0);
    }
  });

  it("never sits inside the footprint radius of the origin", () => {
    for (const o of sweep()) {
      const p = stage4OrbitKeyframe(kf4, o).position;
      expect(Math.hypot(p[0], p[1], p[2]), JSON.stringify(o)).toBeGreaterThanOrEqual(
        STAGE4_CLAMP.minRangeFt - 1e-6,
      );
      expect(Math.hypot(p[0], p[1], p[2])).toBeGreaterThan(WELD_FOOTPRINT_RADIUS);
    }
  });

  it("never sits inside Weld's real massing", () => {
    for (const o of sweep()) {
      const p = stage4OrbitKeyframe(kf4, o).position;
      const inPlan = pointInPolygon([p[0], -p[2]], ring);
      expect(!inPlan || p[1] > WELD.ridge, JSON.stringify(o)).toBe(true);
    }
  });
});

describe("orbitOf", () => {
  it("inverts orbitKeyframe for in-range orbits", () => {
    for (let headingDeg = -175; headingDeg <= 180; headingDeg += 11) {
      // pitchDeg = 90 - polarDeg for the old [16, 30, 45, 74.3, 87] polarDeg samples.
      for (const pitchDeg of [74, 60, 45, 15.7, 3]) {
        for (const rangeFt of [120, 200, 340]) {
          const o = { headingDeg, pitchDeg, rangeFt };
          const back = orbitOf(orbitKeyframe(base, o));
          expect(back.headingDeg, JSON.stringify(o)).toBeCloseTo(headingDeg, 6);
          expect(back.pitchDeg, JSON.stringify(o)).toBeCloseTo(pitchDeg, 6);
          expect(back.rangeFt, JSON.stringify(o)).toBeCloseTo(rangeFt, 6);
        }
      }
    }
  });

  it("reads the stage-3 keyframe as a south-east view from 230 ft", () => {
    // Anchors the convention against a keyframe someone else wrote: stage 3
    // stands east and south of Weld, above the eaves, looking back at it.
    //
    // 230.46 ft at pitch 45, where this read 251.44 ft at pitch 15.69 before P12. Both
    // numbers are kf[3]'s, and kf[3] moved: stages.ts now derives it from obliqueDrop()
    // like stages 0-2 instead of standing at the hand-placed [150, 110, 190], because
    // geo/frame.ts's datum put Google's tiles at their real height and that pose turned out
    // to sit level with Widener's roof. The CONVENTION this case exists to anchor is
    // unchanged and still asserted: east and south of Weld is a heading between 90 and 180,
    // and the camera is above what it looks at.
    const o = orbitOf(base);
    expect(o.rangeFt).toBeCloseTo(230.46, 1);
    expect(o.headingDeg).toBeGreaterThan(90);
    expect(o.headingDeg).toBeLessThan(180);
    expect(o.pitchDeg).toBeCloseTo(45, 1);
  });
});
