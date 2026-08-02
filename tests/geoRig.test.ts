import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import { keyframes } from "@/scene/stages";
import type { Keyframe } from "@/scene/stages";
import { poseToKeyframe, keyframeToPose, type GeoPose } from "@/scene/geo/rig";
import { siteToGeodetic } from "@/scene/geo/frame";

/**
 * isclose, numpy-style: |a - b| <= atol + rtol * |b|. A single relative tolerance is
 * the wrong tool here -- lat/lon/heading/pitch all legitimately pass through zero for
 * some of the 10,000 random poses below, where a purely relative check divides by
 * (near) nothing and either explodes or is vacuously satisfied. atol is the floor: the
 * measured round-trip error of geo/frame.ts's own siteToEcef/ecefToSite pair
 * (tests/geoFrame.test.ts: < 1e-6 ft, absolute) propagated through one geodetic
 * round trip, plus margin.
 */
function isClose(a: number, b: number, atol: number, rtol = 1e-9): boolean {
  return Math.abs(a - b) <= atol + rtol * Math.abs(b);
}

function assertClose(a: number, b: number, atol: number, label: string) {
  expect(isClose(a, b, atol), `${label}: ${a} vs ${b}, diff ${Math.abs(a - b)}`).toBe(true);
}

/** Deterministic LCG, same recipe as tests/collide.test.ts, tests/drag.test.ts,
 *  tests/furniture.test.ts, tests/route.test.ts and tests/rooms.test.ts -- so this
 *  property test is reproducible without pulling in a new dependency for one file. */
function makeRnd(seed0: number) {
  let seed = seed0;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/**
 * A random GeoPose, avoiding the two configurations where heading and range are not
 * independently recoverable from a position: pitch = +/-90 (camera directly over or
 * under the target, so heading is undefined) and range = 0 (camera AT the target, so
 * neither heading nor pitch is defined). Both are single points in a continuous domain
 * -- probability zero from a uniform draw -- but pitch is kept a fixed 0.1 deg off the
 * poles anyway so the test is not relying on a measure-zero argument to avoid a flake.
 *
 * lat/lon/targetFt are built by picking a random SITE-FRAME point within a few thousand
 * feet of the origin and running it through siteToGeodetic, rather than drawing lat/lon
 * directly and letting them land anywhere on Earth. That is this module's own stated
 * domain (this file's header: "every stage target in this app sits within a few
 * thousand feet of [WELD_ORIGIN]"), and it is not merely a matter of taste: a target far
 * from the origin (measured, a target one degree of lat/lon away, ~270,000 ft out) puts
 * poseToKeyframe's `target` at that magnitude, and keyframeToPose recovers a SMALL
 * heading-bearing offset (rangeFt can be a couple of feet, at a pitch near +/-90 where
 * the horizontal component shrinks further) by subtracting position - target -- two
 * ~1e5-1e8 ft numbers -- which is exactly where float64's ~1e-16 relative epsilon
 * produces absolute noise (~1e-11 to ~1e-8 ft, measured) large enough to move a tiny
 * horizontal offset's heading by ~1e-7 degrees. That was reproduced directly (a target
 * built from lat = WELD_ORIGIN.lat +/- 1 degree failed this test at a 3e-7 degree
 * heading error) and is a real property of IEEE 754 subtraction, not a defect in
 * poseToKeyframe/keyframeToPose -- it is exactly why the module is scoped to targets
 * near Harvard Yard rather than anywhere on the globe. rangeFt is NOT bounded the same
 * way -- the camera can legitimately be orbit-far (stage 0 sits ~3.1e7 ft up) while
 * still looking at a target pinned near the origin, which is exactly this app's own six
 * shots, and that combination (near target, far camera) is unaffected by the pathology
 * above because it is the TARGET's absolute magnitude that has to stay modest, not the
 * camera's.
 */
function randomPose(rnd: () => number): GeoPose {
  const targetSite: [number, number, number] = [
    -5_000 + rnd() * 10_000,
    -500 + rnd() * 5_500,
    -5_000 + rnd() * 10_000,
  ];
  const { lat, lon, hFt } = siteToGeodetic(targetSite);
  return {
    lat,
    lon,
    targetFt: hFt,
    // (-180, 180], the same principal range Math.atan2 returns -- so the round trip
    // does not have to cross a wrap to match.
    headingDeg: (() => {
      const raw = rnd() * 360;
      return raw <= 180 ? raw : raw - 360;
    })(),
    pitchDeg: -89.9 + rnd() * 179.8,
    // Log-uniform: stage-scale (tens of feet) through orbit-scale (1e7 ft) get equal
    // representation, rather than the huge end of the range dominating a linear draw.
    rangeFt: Math.pow(10, rnd() * 7),
    fov: 5 + rnd() * 165,
  };
}

describe("keyframeToPose(poseToKeyframe(p)) is the identity", () => {
  it("holds for 10,000 random valid poses", () => {
    const rnd = makeRnd(20_260_801);
    let maxLatErr = 0;
    let maxLonErr = 0;
    let maxTargetFtErr = 0;
    let maxHeadingErr = 0;
    let maxPitchErr = 0;
    let maxRangeErr = 0;

    for (let i = 0; i < 10_000; i++) {
      const p = randomPose(rnd);
      const kf = poseToKeyframe(p);
      const back = keyframeToPose(kf);

      assertClose(back.lat, p.lat, 1e-9, `pose ${i} lat`);
      assertClose(back.lon, p.lon, 1e-9, `pose ${i} lon`);
      assertClose(back.targetFt, p.targetFt, 1e-6, `pose ${i} targetFt`);
      assertClose(back.headingDeg, p.headingDeg, 1e-7, `pose ${i} headingDeg`);
      assertClose(back.pitchDeg, p.pitchDeg, 1e-7, `pose ${i} pitchDeg`);
      assertClose(back.rangeFt, p.rangeFt, 1e-6, `pose ${i} rangeFt`);
      expect(back.fov, `pose ${i} fov`).toBe(p.fov);

      maxLatErr = Math.max(maxLatErr, Math.abs(back.lat - p.lat));
      maxLonErr = Math.max(maxLonErr, Math.abs(back.lon - p.lon));
      maxTargetFtErr = Math.max(maxTargetFtErr, Math.abs(back.targetFt - p.targetFt));
      maxHeadingErr = Math.max(maxHeadingErr, Math.abs(back.headingDeg - p.headingDeg));
      maxPitchErr = Math.max(maxPitchErr, Math.abs(back.pitchDeg - p.pitchDeg));
      maxRangeErr = Math.max(maxRangeErr, Math.abs(back.rangeFt - p.rangeFt));
    }

    // Printed rather than just asserted-under: this is the number the P11 report
    // records as "the 10,000-pose test's actual max deviation found".
    // eslint-disable-next-line no-console
    console.log("geoRig 10,000-pose round trip, max abs deviation:", {
      lat: maxLatErr,
      lon: maxLonErr,
      targetFt: maxTargetFtErr,
      headingDeg: maxHeadingErr,
      pitchDeg: maxPitchErr,
      rangeFt: maxRangeErr,
    });
  });
});

describe("every existing stage keyframe round-trips through keyframeToPose/poseToKeyframe", () => {
  const kf = keyframes(DEFAULT_PARAMS);

  const stages: (0 | 1 | 2 | 3 | 4 | 5)[] = [0, 1, 2, 3, 4, 5];

  for (const s of stages) {
    it(`stage ${s} reproduces today's position/target/fov within 0.01 ft`, () => {
      // Only position/target/fov -- kf[s].path (stages 0-2 and 4) is stage machinery
      // this task does not touch; the regression fence is the shot itself.
      const frame: Keyframe = { position: kf[s].position, target: kf[s].target, fov: kf[s].fov };
      const pose = keyframeToPose(frame);
      const back = poseToKeyframe(pose);

      const dPos = Math.hypot(
        back.position[0] - frame.position[0],
        back.position[1] - frame.position[1],
        back.position[2] - frame.position[2],
      );
      const dTarget = Math.hypot(
        back.target[0] - frame.target[0],
        back.target[1] - frame.target[1],
        back.target[2] - frame.target[2],
      );

      // eslint-disable-next-line no-console
      console.log(`geoRig stage ${s} round trip: position ${dPos.toFixed(6)} ft, target ${dTarget.toFixed(6)} ft`);

      expect(dPos, `stage ${s} position`).toBeLessThan(0.01);
      expect(dTarget, `stage ${s} target`).toBeLessThan(0.01);
      expect(back.fov, `stage ${s} fov`).toBeCloseTo(frame.fov, 6);
    });
  }
});
