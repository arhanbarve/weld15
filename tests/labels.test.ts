import { describe, it, expect } from "vitest";
import { latLonToSite, WELD_ORIGIN } from "@/geo/frames";
import { PLACE_TABLE, chipOpacity } from "@/scene/Labels";
import { HIGH_CONTRAST_GAIN, MASS_MAX, MASS_MIN, massOpacity } from "@/scene/Campus";

/** The altitudes the descent actually visits, log-spaced from the Yard to well past orbit. */
const SWEEP = Array.from({ length: 400 }, (_, i) => 150 * Math.pow(10, (i / 399) * 5.4));

describe("the progressive place labels", () => {
  it("runs outermost to innermost, with each band inside the last", () => {
    // A table out of order would still "work" -- each chip reads its own band -- but the descent
    // would name Boston before New England, so the ordering is the content.
    for (let i = 1; i < PLACE_TABLE.length; i++) {
      const prev = PLACE_TABLE[i - 1]!;
      const here = PLACE_TABLE[i]!;
      expect(here.in, `${here.label} appears before ${prev.label}`).toBeLessThan(prev.in);
      expect(here.out, `${here.label} leaves before ${prev.label}`).toBeLessThan(prev.out);
    }
  });

  it("gives every band a descending pair", () => {
    for (const p of PLACE_TABLE) {
      expect(p.in, `${p.label}`).toBeGreaterThan(p.out);
    }
  });

  it("overlaps consecutive bands, so no altitude is unlabelled", () => {
    // THE PROPERTY THAT MATTERS. A gap between two bands is a stretch of the descent with no place
    // name at all, which is exactly the "empty thing" complaint P9 exists to answer, in miniature.
    for (let i = 1; i < PLACE_TABLE.length; i++) {
      const outer = PLACE_TABLE[i - 1]!;
      const inner = PLACE_TABLE[i]!;
      expect(inner.in, `${inner.label} starts after ${outer.label} has gone`).toBeGreaterThan(outer.out);
    }
  });

  it("has at least one chip up at every altitude between the Yard and orbit", () => {
    const lo = PLACE_TABLE[PLACE_TABLE.length - 1]!.out;
    const hi = PLACE_TABLE[0]!.in;
    for (const alt of SWEEP) {
      if (alt < lo * 1.6 || alt > hi * 0.7) continue;
      const best = Math.max(...PLACE_TABLE.map((p) => chipOpacity(alt, p)));
      expect(best, `nothing labelled at alt ${alt.toFixed(0)}`).toBeGreaterThan(0.1);
    }
  });

  it("clamps every chip to [0,1] and shows none outside its own band", () => {
    for (const p of PLACE_TABLE) {
      for (const alt of SWEEP) {
        const a = chipOpacity(alt, p);
        expect(a, `${p.label} at ${alt}`).toBeGreaterThanOrEqual(0);
        expect(a, `${p.label} at ${alt}`).toBeLessThanOrEqual(1);
      }
      expect(chipOpacity(p.in * 1.01, p), `${p.label} above its band`).toBe(0);
      expect(chipOpacity(p.out * 0.99, p), `${p.label} below its band`).toBe(0);
    }
  });

  it("reaches full opacity somewhere inside each band", () => {
    // A chip that never quite arrives is a chip nobody reads.
    for (const p of PLACE_TABLE) {
      const mid = Math.exp((Math.log(p.in) + Math.log(p.out)) / 2);
      expect(chipOpacity(mid, p), `${p.label} at its own midpoint`).toBeCloseTo(1, 6);
    }
  });

  it("places each name on the thing it names, in site feet", () => {
    // Every position goes through the same latLonToSite() the footprints and the imagery went
    // through, so this checks the DIRECTIONS are right -- which is what a mirror would break.
    const at = (label: string) => {
      const p = PLACE_TABLE.find((q) => q.label === label)!;
      return latLonToSite(p.lat, p.lon);
    };
    // Boston is east and south of Weld.
    expect(at("Boston").x).toBeGreaterThan(0);
    expect(at("Boston").y).toBeLessThan(0);
    // Central Square is east of Weld and very slightly south.
    expect(at("Cambridge").x).toBeGreaterThan(0);
    // The continent is far west and far north.
    expect(at("North America").x).toBeLessThan(-1e6);
    expect(at("North America").y).toBeGreaterThan(1e5);
    // Harvard Yard has TWO requirements pulling opposite ways, and both are asserted because
    // satisfying one alone is how the chip ended up on top of Weld's own label in the first place:
    // it must be in the Yard (Weld is in the Yard, so within a few hundred feet), and it must be far
    // enough from Weld that the two chips never overlap on screen. 555 ft, in the Old Yard.
    const yard = Math.hypot(at("Harvard Yard").x, at("Harvard Yard").y);
    expect(yard, "Harvard Yard label has drifted out of the Yard").toBeLessThan(900);
    expect(yard, "Harvard Yard label is close enough to collide with Weld's chip").toBeGreaterThan(300);
    // And in the Old Yard specifically, which is west and north of Weld.
    expect(at("Harvard Yard").x).toBeLessThan(0);
    expect(at("Harvard Yard").y).toBeGreaterThan(0);
  });

  it("does not duplicate Weld's own chip", () => {
    // Campus.tsx already mounts "Weld Hall" tied to highlightWeld. A second one here would
    // double-label the building at stages 2 and 3.
    expect(PLACE_TABLE.map((p) => p.label)).not.toContain("Weld Hall");
  });

  it("keeps Boston's label off Weld, which is the point of using real coordinates", () => {
    const boston = PLACE_TABLE.find((p) => p.label === "Boston")!;
    const d = latLonToSite(boston.lat, boston.lon);
    // Downtown Crossing is about 3 miles from the Yard; anything under a mile would mean the label
    // had been parked on Weld for convenience.
    expect(Math.hypot(d.x, d.y)).toBeGreaterThan(5_280);
    expect(boston.lat).not.toBe(WELD_ORIGIN.lat);
  });
});

/**
 * The mass opacity ramp, which lives in Campus.tsx but is a pure function of altitude.
 *
 * Tested here rather than in a file of its own because it is the same question this file is about:
 * what the campus looks like at a given height. Campus.tsx exports the function precisely so this
 * can be asserted without a renderer.
 */
describe("the mass opacity ramp", () => {
  it("sits on MASTER.md's token at the top of the ramp", () => {
    // --mass is 0.10. Above 40,000 ft the massing band is zero, so the ramp is at its floor and the
    // campus is exactly as translucent as the design system says.
    expect(massOpacity(60_000, false)).toBeCloseTo(MASS_MIN, 9);
    expect(massOpacity(1e7, false)).toBeCloseTo(MASS_MIN, 9);
  });

  it("reaches its ceiling by the Yard and holds it inward", () => {
    for (const alt of [3_000, 815, 400, 110, 18]) {
      expect(massOpacity(alt, false), `alt ${alt}`).toBeCloseTo(MASS_MAX, 9);
    }
  });

  it("rises monotonically as the camera descends", () => {
    let prev = -1;
    for (const alt of [1e6, 100_000, 40_000, 20_000, 16_332, 8_000, 4_000, 815, 110]) {
      const a = massOpacity(alt, false);
      expect(a, `alt ${alt}`).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
  });

  it("is partway up at stage 1 and full at stage 2", () => {
    // The two stops the ramp actually has to look right at. Stage 1 is alt 16,332, stage 2 is 815.
    const s1 = massOpacity(16_332, false);
    expect(s1).toBeGreaterThan(MASS_MIN);
    expect(s1).toBeLessThan(MASS_MAX);
    expect(massOpacity(815, false)).toBeCloseTo(MASS_MAX, 9);
  });

  it("raises the whole ramp by MASTER.md's own high-contrast ratio", () => {
    // The token pair is 0.10 and 0.22, so the ratio is 2.2 and section 6.9 asks for the ceiling to
    // move in the same proportion. Applied to both ends rather than only the top, so the floor is
    // the high-contrast token exactly.
    expect(massOpacity(1e6, true)).toBeCloseTo(MASS_MIN * HIGH_CONTRAST_GAIN, 9);
    expect(massOpacity(1e6, true)).toBeCloseTo(0.22, 9);
    expect(massOpacity(110, true)).toBeCloseTo(MASS_MAX * HIGH_CONTRAST_GAIN, 9);
  });

  it("never exceeds 1, even in high contrast", () => {
    for (const alt of [1e7, 40_000, 815, 110, 1]) {
      expect(massOpacity(alt, true), `alt ${alt}`).toBeLessThanOrEqual(1);
    }
  });

  it("stays translucent enough to be a cyanotype", () => {
    // THE CONSTRAINT THAT STOPS THIS BECOMING SOLID BLOCKS. Section 6.9 asked for full occlusion of
    // the photographed roof, which needs about 0.81 -- and at 0.81 the campus is not line work over
    // translucent mass any more. Campus.tsx records the arithmetic; this is the guard rail, so a
    // later attempt to "finish" the occlusion fails a test instead of quietly changing the look.
    expect(MASS_MAX).toBeLessThan(0.5);
    expect(massOpacity(110, false)).toBeLessThan(0.5);
  });
});
