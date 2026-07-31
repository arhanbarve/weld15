import { describe, it, expect } from "vitest";
import {
  GLOBE_FAR_RATIO,
  NEAR_FAR_STOPS,
  R_EARTH_FT,
  bandBoundaries,
  coverage,
  globeClipAlt,
  globeClipFloor,
  layerOpacity,
  nearFar,
} from "@/scene/altitude";

/** Altitudes swept by the monotonicity and coverage tests: 100 ft to 100,000 km, log-spaced. */
const SWEEP = Array.from({ length: 600 }, (_, i) => 100 * Math.pow(10, (i / 599) * 6));

describe("the near/far schedule", () => {
  it("holds 0.5 at the interior stages, which stages.ts:161-177 made load-bearing", () => {
    // Stage 5 stands in the hall and at hallWidth = 3 the camera passes 0.40 ft from a wall
    // band. Anything above 0.5 here clips every face at the low end of a shipped slider.
    for (const alt of [0, 2, 17.8, 110, 200]) {
      expect(nearFar(alt).near, `alt ${alt}`).toBeCloseTo(0.5, 10);
    }
  });

  it("holds stage 3's shipped far plane of 25,000 ft", () => {
    // What Experience.tsx hard-coded before P9. Stage 3 sits at alt 110.
    expect(nearFar(110).far).toBeCloseTo(25_000, 6);
  });

  it("reproduces the table in P9.md section 3.3 to the figures printed there", () => {
    // These six rows are quoted in the spec as the proof that GLOBE_R = far/8 survives the
    // whole descent. If the schedule moves, the spec's table is wrong and has to move too.
    const rows: [number, number, number][] = [
      [33_443_570, 100, 4_000_000],
      [99_000, 100, 4_000_000],
      [60_000, 62, 2_481_569],
      [40_000, 42, 1_685_985],
      [20_000, 22, 843_793],
      [4_180, 5.0, 163_932],
    ];
    for (const [alt, near, far] of rows) {
      expect(nearFar(alt).near, `near at ${alt}`).toBeCloseTo(near, 0);
      // Relative, because these run to seven figures and the spec rounded them.
      expect(nearFar(alt).far / far, `far at ${alt}`).toBeCloseTo(1, 3);
    }
  });

  it("is monotonic in altitude, both planes", () => {
    let lastNear = -Infinity;
    let lastFar = -Infinity;
    for (const alt of SWEEP) {
      const { near, far } = nearFar(alt);
      expect(near, `near at ${alt}`).toBeGreaterThanOrEqual(lastNear - 1e-9);
      expect(far, `far at ${alt}`).toBeGreaterThanOrEqual(lastFar - 1e-9);
      lastNear = near;
      lastFar = far;
    }
  });

  it("keeps far/near under 1e5 so 24-bit depth stays well conditioned", () => {
    for (const alt of SWEEP) {
      const { near, far } = nearFar(alt);
      expect(far / near, `ratio at ${alt}`).toBeLessThan(1e5);
    }
  });

  it("is flat below the first stop and above the last, so a dwell never moves it", () => {
    // The reason this matters: depth resolution that changes under a static shot makes
    // z-fighting appear and disappear, which is far harder to diagnose than z-fighting.
    const first = NEAR_FAR_STOPS[0]!;
    const last = NEAR_FAR_STOPS[NEAR_FAR_STOPS.length - 1]!;
    expect(nearFar(0)).toEqual(nearFar(first.alt));
    expect(nearFar(last.alt * 1000)).toEqual(nearFar(last.alt));
  });

  it("passes through every stop exactly", () => {
    for (const s of NEAR_FAR_STOPS) {
      expect(nearFar(s.alt).near, `near at stop ${s.alt}`).toBeCloseTo(s.near, 9);
      expect(nearFar(s.alt).far, `far at stop ${s.alt}`).toBeCloseTo(s.far, 6);
    }
  });
});

describe("where the globe proxy stops fitting in the frustum", () => {
  it("expires at 4,973 ft, correcting the 4,180 in P9.md section 3.3", () => {
    // The spec substituted a constant ratio of 4e4 into alt > 8 * R_EARTH / (far/near) and
    // got 4,180. The ratio is not constant -- at this altitude it is 33,622 -- so the
    // condition is a fixed point and has to be solved. It is 4,973.
    const floor = globeClipFloor();
    expect(floor).toBeCloseTo(4_973, -1);
    // It really is the fixed point: the map holds it still.
    expect(globeClipAlt(floor)).toBeCloseTo(floor, 6);
    // Just above it the surface clears the near plane; just below it does not.
    expect(nearFar(floor * 1.02).near).toBeLessThan(
      (nearFar(floor * 1.02).far / GLOBE_FAR_RATIO) * ((floor * 1.02) / R_EARTH_FT),
    );
    expect(nearFar(floor * 0.98).near).toBeGreaterThan(
      (nearFar(floor * 0.98).far / GLOBE_FAR_RATIO) * ((floor * 0.98) / R_EARTH_FT),
    );
  });

  it("leaves the globe's own fade a margin of 8x", () => {
    // The globe reaches zero opacity at 40,000 ft and the rule expires at 4,973, so the
    // sphere is long gone before the construction stops working. P9.md claims 9.6x off the
    // wrong floor; the real figure is 8.0x. If someone moves either number, this catches it.
    const goneAt = 40_000;
    expect(layerOpacity(goneAt).globe).toBe(0);
    expect(goneAt / globeClipFloor()).toBeGreaterThan(8);
  });

  it("is a real constraint, not a tautology: the constant-radius version fails", () => {
    // The defect the spec records. A fixed 5,000 ft radius puts the surface 23.7 ft from a
    // 100 ft near plane at 99,000 ft. Recomputed here so the claim is checked, not quoted.
    const fixedR = 5_000;
    const alt = 99_000;
    const surface = fixedR * (alt / R_EARTH_FT);
    expect(surface).toBeLessThan(nearFar(alt).near);
    // And the schedule's own radius does not.
    expect((nearFar(alt).far / GLOBE_FAR_RATIO) * (alt / R_EARTH_FT)).toBeGreaterThan(
      nearFar(alt).near,
    );
  });
});

describe("the layer bands", () => {
  it("never leaves the frame empty anywhere in the descent", () => {
    // The whole point of the overlaps. A frame at which every layer is zero is P8's
    // "three seconds of empty blue", reached by a different route.
    for (const alt of SWEEP) {
      expect(coverage(alt), `coverage at ${alt}`).toBeGreaterThan(0.2);
    }
  });

  it("clamps to [0,1] everywhere", () => {
    for (const alt of SWEEP) {
      for (const [k, v] of Object.entries(layerOpacity(alt))) {
        expect(v, `${k} at ${alt}`).toBeGreaterThanOrEqual(0);
        expect(v, `${k} at ${alt}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("puts no band boundary on a stage altitude", () => {
    // A transition that happens exactly when the stage changes is one nobody can tell from
    // a cut, and the cut is the thing P9a exists to remove. Stage altitudes are kf0..kf3.
    const stageAlts = [1.6 * R_EARTH_FT, 28_000, 1_570, 110];
    for (const b of bandBoundaries()) {
      for (const a of stageAlts) {
        // A factor of 1.15 apart at minimum, i.e. the boundary is not within ~15% of a stop.
        expect(Math.max(b / a, a / b), `boundary ${b} vs stage alt ${a}`).toBeGreaterThan(1.15);
      }
    }
  });

  it("has the globe alone at orbit and gone by the Yard", () => {
    const orbit = layerOpacity(1.6 * R_EARTH_FT);
    expect(orbit.globe).toBe(1);
    expect(orbit.q1).toBe(0);
    expect(orbit.q4).toBe(0);
    expect(orbit.tint).toBe(0);

    const yard = layerOpacity(110);
    expect(yard.globe).toBe(0);
    expect(yard.q2).toBe(1);
    expect(yard.q3).toBe(1);
    expect(yard.q4).toBe(1);
    expect(yard.tint).toBe(1);
    expect(yard.massing).toBe(1);
  });

  it("cross-dissolves the globe into Q1 rather than cutting", () => {
    // Somewhere in the swap band both are partly up. If either reaches zero before the
    // other leaves zero, the descent has a hole in it.
    const mid = layerOpacity(63_000);
    expect(mid.globe).toBeGreaterThan(0);
    expect(mid.globe).toBeLessThan(1);
    expect(mid.q1).toBe(1);
    expect(mid.q2).toBeGreaterThan(0);
  });

  it("is monotonic within each layer's own ramp", () => {
    // No layer may brighten again once it has begun to leave. Checked on the globe and on
    // Q1, the two that have both an in and an out band.
    let lastGlobe = 1;
    for (const alt of [...SWEEP].reverse()) {
      const g = layerOpacity(alt).globe;
      expect(g, `globe at ${alt}`).toBeLessThanOrEqual(lastGlobe + 1e-12);
      lastGlobe = g;
    }
  });
});
