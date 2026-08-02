import { describe, it, expect } from "vitest";
import {
  cambridgeInstant,
  easternOffsetHours,
  skyDirection,
  glazingCounts,
  SHADOW_HALF,
  SHADOW_PX,
} from "@/scene/Lighting";
import { WELD_FOOTPRINT_RADIUS } from "@/scene/orbit";
import { sunPosition, isFacadeLit } from "@/geo/solar";
import { DEFAULT_PARAMS, buildSuite } from "@/geo/rooms";
import { facadeAzimuth, gableAzimuth } from "@/geo/place";

/**
 * The three pure functions behind the lighting rig.
 *
 * These exist because both of the errors they can carry are invisible on screen.
 * An hour of daylight-saving error moves the sun by fifteen degrees, which looks
 * like a perfectly plausible time of day; a sign error in the sky direction
 * mirrors the sun east-west, which looks like a perfectly plausible afternoon.
 * Neither shows up as a glitch, and the whole point of driving the light from
 * solar.ts rather than placing it by eye is lost if the conversion into it is
 * wrong.
 *
 * They were originally checked in a throwaway harness during the build. A harness
 * that is deleted afterwards protects nothing, so this is that harness kept.
 */

describe("Cambridge wall clock to instant", () => {
  /**
   * solar.ts reads every Date as the instant it is, using UTC accessors only, and
   * its header pins the convention with two worked examples. These are those
   * examples: if cambridgeInstant disagrees with them, every sun angle in the app
   * is off by an hour somewhere in the year.
   */
  it("reproduces solar.ts's own two worked examples", () => {
    expect(cambridgeInstant("2026-06-21", 9).toISOString()).toBe("2026-06-21T13:00:00.000Z");
    expect(cambridgeInstant("2026-12-21", 9).toISOString()).toBe("2026-12-21T14:00:00.000Z");
  });

  it("puts the 2026 daylight-saving boundaries on the right Sundays", () => {
    // US rule since 2007: second Sunday in March to first Sunday in November.
    // In 2026 those are 8 March and 1 November.
    //
    // The value is hours to ADD to reach UTC -- 5 in winter, 4 on daylight time --
    // NOT the ISO offset, which is its negation. The first version of this test
    // asserted -5 on the strength of the old docstring and failed; the docstring now
    // says which convention it is.
    expect(easternOffsetHours(2026, 3, 7)).toBe(5);
    expect(easternOffsetHours(2026, 3, 8)).toBe(4);
    expect(easternOffsetHours(2026, 10, 31)).toBe(4);
    expect(easternOffsetHours(2026, 11, 1)).toBe(5);
  });

  it("holds the rule across a year where the Sundays fall differently", () => {
    // 2027: 14 March and 7 November. A hard-coded day-of-month would pass 2026
    // and fail here, which is exactly the bug this catches.
    expect(easternOffsetHours(2027, 3, 13)).toBe(5);
    expect(easternOffsetHours(2027, 3, 14)).toBe(4);
    expect(easternOffsetHours(2027, 11, 6)).toBe(4);
    expect(easternOffsetHours(2027, 11, 7)).toBe(5);
  });

  it("carries a fractional hour through, since the control is a slider", () => {
    expect(cambridgeInstant("2026-09-15", 9.25).toISOString()).toBe(
      "2026-09-15T13:15:00.000Z",
    );
  });
});

describe("sun direction in three.js space", () => {
  /**
   * frames.ts maps north onto -Z. If skyDirection disagreed, the sun would rise in
   * the west and every shadow in the model would point the wrong way -- and it
   * would still look like a normal sunny afternoon, which is why this is asserted
   * rather than eyeballed.
   */
  it("puts due south on +Z and the horizon on y = 0", () => {
    const d = skyDirection({ altitudeDeg: 0, azimuthDeg: 180 });
    expect(d.y).toBeCloseTo(0, 6);
    expect(d.z).toBeCloseTo(1, 6);
    expect(d.x).toBeCloseTo(0, 6);
  });

  it("puts due east on +X and due north on -Z", () => {
    const e = skyDirection({ altitudeDeg: 0, azimuthDeg: 90 });
    expect(e.x).toBeCloseTo(1, 6);
    expect(e.z).toBeCloseTo(0, 6);

    const n = skyDirection({ altitudeDeg: 0, azimuthDeg: 0 });
    expect(n.z).toBeCloseTo(-1, 6);
    expect(n.x).toBeCloseTo(0, 6);
  });

  it("puts the zenith straight up and returns a unit vector throughout", () => {
    expect(skyDirection({ altitudeDeg: 90, azimuthDeg: 123 }).y).toBeCloseTo(1, 6);
    for (const alt of [-20, 0, 18, 45, 90]) {
      for (const az of [0, 47, 113, 180, 271, 359]) {
        expect(
          skyDirection({ altitudeDeg: alt, azimuthDeg: az }).length(),
          `alt ${alt} az ${az}`,
        ).toBeCloseTo(1, 6);
      }
    }
  });

  it("sends the sun below the horizon when the altitude is negative", () => {
    expect(skyDirection({ altitudeDeg: -10, azimuthDeg: 90 }).y).toBeLessThan(0);
  });
});

describe("the light agrees with solar.ts about Weld", () => {
  /**
   * The finding solar.ts encodes, restated here through the lighting path: the north
   * gable takes direct sun on the June solstice and none in December. It is the
   * correction to an earlier claim that the suite gets "almost no direct sunlight",
   * so it is worth pinning at the point where it reaches the renderer.
   */
  const gable = gableAzimuth();

  it("lights the north gable on the June solstice and never in December", () => {
    const june = [5, 6, 7, 8, 9].some((h) =>
      isFacadeLit(gable, sunPosition(cambridgeInstant("2026-06-21", h))),
    );
    expect(june, "gable unlit all June solstice morning").toBe(true);

    const december = Array.from({ length: 25 }, (_, h) => h).some((h) =>
      isFacadeLit(gable, sunPosition(cambridgeInstant("2026-12-21", h))),
    );
    expect(december, "gable lit somewhere on 21 December").toBe(false);
  });

  it("lights the suite's facade at the default time, which is why it is the default", () => {
    // The rig defaults to 09:00 on 2026-09-15. That is a choice, not a measurement,
    // and the reason for it is that the facade is lit and the oak grain reads.
    const sun = sunPosition(cambridgeInstant("2026-09-15", 9));
    expect(sun.altitudeDeg).toBeGreaterThan(15);
    expect(isFacadeLit(facadeAzimuth(DEFAULT_PARAMS), sun)).toBe(true);
  });

  it("has the sun in the east in the morning and the west in the afternoon", () => {
    // Catches a mirrored azimuth, which no single-time screenshot would reveal.
    const morning = skyDirection(sunPosition(cambridgeInstant("2026-09-15", 8)));
    const afternoon = skyDirection(sunPosition(cambridgeInstant("2026-09-15", 16)));
    expect(morning.x, "morning sun is not in the east").toBeGreaterThan(0);
    expect(afternoon.x, "afternoon sun is not in the west").toBeLessThan(0);
  });

  it("climbs to midday and falls again, so the hour slider is monotone either side", () => {
    const alt = (h: number) => sunPosition(cambridgeInstant("2026-09-15", h)).altitudeDeg;
    for (let h = 7; h < 12; h++) expect(alt(h + 1), `rising at ${h}`).toBeGreaterThan(alt(h));
    for (let h = 13; h < 18; h++) expect(alt(h + 1), `falling at ${h}`).toBeLessThan(alt(h));
  });
});

describe("shadow frustum covers the building", () => {
  /**
   * The first version of this block asserted `120 > 76.86` from two local literals
   * and never imported anything from Lighting.tsx, so it would have passed with the
   * shadow camera set to any value at all. That is the vacuous gate this project has
   * shipped four times; both constants are now read from the modules that own them.
   */
  it("is wide enough for Weld's whole footprint, read from the rig itself", () => {
    // The ortho half-extent has to clear the building's circumscribing radius, or the
    // far end of Weld casts no shadow -- which reads as a lighting choice rather than
    // as a clipped shadow map, so nothing on screen reports it.
    expect(SHADOW_HALF).toBeGreaterThan(WELD_FOOTPRINT_RADIUS);
    // And with real margin, because a low sun throws shadows well past the caster.
    expect(SHADOW_HALF).toBeGreaterThan(WELD_FOOTPRINT_RADIUS * 1.5);
  });

  it("keeps the shadow texel finer than the wall thickness it has to resolve", () => {
    // A 0.5 ft partition cannot cast a readable shadow if one texel is wider than the
    // partition. 240 ft across 2048 texels is 1.4 in, so the margin is large -- but it
    // is the ratio that matters, and it moves if either constant is touched.
    const texelFt = (2 * SHADOW_HALF) / SHADOW_PX;
    expect(texelFt).toBeLessThan(DEFAULT_PARAMS.partition / 2);
    expect(texelFt * 12).toBeLessThan(2);
  });
});

describe("glazingCounts: the window fill's own P14 row 11 scaling", () => {
  it("counts four facade windows and one gable window at the shipped rooms.ts", () => {
    // rooms.ts's own windows arrays: common1, bedA and the unknown strip each name
    // "facade" once, bedB names both "facade" and "gable" -- four facade rooms, one
    // gable room. Asserted against the actual suite rather than restated as a
    // literal, so a room layout change that moved a window is what breaks this,
    // not a copy of the same assumption.
    const suite = buildSuite(DEFAULT_PARAMS);
    const facadeRooms = suite.rooms.filter((r) => r.windows.includes("facade")).length;
    const gableRooms = suite.rooms.filter((r) => r.windows.includes("gable")).length;
    const counts = glazingCounts(suite);
    expect(counts).toEqual({ facade: facadeRooms, gable: gableRooms });
    expect(counts.facade).toBe(4);
    expect(counts.gable).toBe(1);
  });

  it("gives the more-glazed wall the full-scale fill and the other a proportional cut", () => {
    const { facade, gable } = glazingCounts(buildSuite(DEFAULT_PARAMS));
    const max = Math.max(facade, gable, 1);
    // The facade has more windows at the shipped defaults, so it is the one that
    // should read as scale 1 -- not hard-coded to "facade always wins", the general
    // property Lighting.tsx's own comment argues for.
    expect(facade / max).toBe(1);
    expect(gable / max).toBeCloseTo(0.25, 9);
  });

  it("never divides by zero when a suite has no windows on either wall", () => {
    const empty = { rooms: [{ windows: [] }, { windows: [] }] };
    const counts = glazingCounts(empty);
    expect(counts).toEqual({ facade: 0, gable: 0 });
    const max = Math.max(counts.facade, counts.gable, 1);
    expect(counts.facade / max).toBe(0);
    expect(counts.gable / max).toBe(0);
  });
});
