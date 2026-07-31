import { describe, it, expect } from "vitest";
import { sunPosition, solarDeclinationDeg, isFacadeLit, subsolarPoint } from "@/geo/solar";
import {
  WELD_ORIGIN,
  WELD_AXIS_DEG,
  azimuthToBuilding,
  normalizeAngle,
} from "@/geo/frames";

/**
 * Every fixture in this file is derived from first principles, not scraped off a
 * sunrise website. Two identities do all the work:
 *
 *   altitude at solar noon    = 90 - latitude + declination
 *   cos(azimuth at sunrise)   = sin(declination) / cos(latitude)
 *
 * The first is just the definition of the zenith angle on the meridian; the
 * second is the hour-angle formula evaluated at altitude 0. Both are exact for
 * the geometric altitude of the sun's centre, which is what src/geo/solar.ts
 * returns. Nothing here can rot, and nothing here needs a source I cannot check.
 *
 * Where the tolerances come from: declination is only exactly +/-23.44 at the
 * solstice instant and exactly 0 at the equinox instant, and the moments we
 * sample (solar noon, sunrise) are hours away from those. That is worth a few
 * hundredths of a degree, so 0.15 deg on altitudes and 0.5 deg on azimuths.
 */

const LAT = WELD_ORIGIN.lat; // 42.3739244

/** Weld's north gable, outward normal, degrees clockwise from north. */
const GABLE_AZ = WELD_AXIS_DEG; // 13.2
/** The long east wall. The suite's rooms face this way. */
const EAST_AZ = WELD_AXIS_DEG + 90; // 103.2
/** The long west wall, and the south gable, for contrast. */
const WEST_AZ = WELD_AXIS_DEG + 270;
const SOUTH_AZ = WELD_AXIS_DEG + 180;

const SUMMER = "2026-06-21";
const EQUINOX = "2026-03-20";
const WINTER = "2026-12-21";

/** The three days the analytic identities are pinned on, with the declination
 *  each is standing in for and the two figures that follow from it. */
const FIXTURES = [
  {
    day: SUMMER,
    decl: 23.44,
    noonAltitude: 71.07, //  90 - 42.3739 + 23.44
    sunriseAzimuth: 57.4, // acos( sin( 23.44) / cos(42.3739) )
  },
  {
    day: EQUINOX,
    decl: 0,
    noonAltitude: 47.63, //  90 - 42.3739 +  0
    sunriseAzimuth: 90.0, // acos( 0                          )
  },
  {
    day: WINTER,
    decl: -23.44,
    noonAltitude: 24.19, //  90 - 42.3739 - 23.44
    sunriseAzimuth: 122.6, // acos( sin(-23.44) / cos(42.3739) )
  },
] as const;

const DEG = Math.PI / 180;

/** Assert |actual - expected| < tol, with a message that names the number. */
function within(actual: number, expected: number, tol: number, what: string) {
  expect(
    Math.abs(actual - expected),
    `${what}: got ${actual.toFixed(4)}, want ${expected} +/- ${tol}`,
  ).toBeLessThan(tol);
}

function startOfUtcDay(dayIso: string): number {
  return Date.parse(`${dayIso}T00:00:00Z`);
}

/** The UTC instant of maximum altitude on a given UTC day. Minute scan, then a
 *  ternary search, because altitude is not unimodal across a whole UTC day
 *  here: 00:00 UTC in Cambridge is the previous evening. */
function solarNoon(dayIso: string): Date {
  const start = startOfUtcDay(dayIso);
  let best = start;
  let bestAlt = -Infinity;
  for (let m = 0; m < 1440; m++) {
    const t = start + m * 60_000;
    const a = sunPosition(new Date(t)).altitudeDeg;
    if (a > bestAlt) {
      bestAlt = a;
      best = t;
    }
  }
  let lo = best - 60_000;
  let hi = best + 60_000;
  for (let i = 0; i < 60; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (
      sunPosition(new Date(a)).altitudeDeg < sunPosition(new Date(b)).altitudeDeg
    ) {
      lo = a;
    } else {
      hi = b;
    }
  }
  return new Date((lo + hi) / 2);
}

/** The UTC instant of the first upward zero crossing of altitude on a UTC day,
 *  bisected to well under an arcsecond so the azimuth read there is the
 *  altitude-0 azimuth the analytic identity describes. */
function sunrise(dayIso: string): Date {
  const start = startOfUtcDay(dayIso);
  for (let m = 0; m < 1440; m++) {
    let lo = start + m * 60_000;
    let hi = lo + 60_000;
    if (
      sunPosition(new Date(lo)).altitudeDeg < 0 &&
      sunPosition(new Date(hi)).altitudeDeg >= 0
    ) {
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        if (sunPosition(new Date(mid)).altitudeDeg < 0) lo = mid;
        else hi = mid;
      }
      return new Date((lo + hi) / 2);
    }
  }
  throw new Error(`no sunrise on ${dayIso}`);
}

/** How many minutes of the UTC day a facade with this outward normal is in
 *  direct sun, sampled once a minute. */
function litMinutes(dayIso: string, facadeAzimuthDeg: number): number {
  const start = startOfUtcDay(dayIso);
  let n = 0;
  for (let m = 0; m < 1440; m++) {
    if (isFacadeLit(facadeAzimuthDeg, sunPosition(new Date(start + m * 60_000))))
      n++;
  }
  return n;
}

describe("solarDeclinationDeg", () => {
  it("reaches the obliquity of the ecliptic at the solstices and zero at the equinox", () => {
    // Declination is bounded by the obliquity, 23.4365 deg in 2026, and touches
    // it only at the solstice instant; it is zero only at the equinox instant,
    // and the March 2026 equinox is 14:46 UTC while declination moves 0.4 deg a
    // day there. Sampling at solar noon is hours off both, hence 0.05.
    for (const { day, decl } of FIXTURES) {
      within(solarDeclinationDeg(solarNoon(day)), decl, 0.05, `${day} declination`);
    }
  });

  it("stays inside +/-23.44 all year and gets there twice", () => {
    // Catches a dropped or mis-scaled obliquity term, which a single-date test
    // would not: get eps wrong and the extremes move but the equinox does not.
    let min = Infinity;
    let max = -Infinity;
    for (let d = 0; d < 365; d++) {
      const decl = solarDeclinationDeg(
        new Date(Date.UTC(2026, 0, 1, 12) + d * 86_400_000),
      );
      if (decl < min) min = decl;
      if (decl > max) max = decl;
    }
    within(max, 23.44, 0.02, "annual max declination");
    within(min, -23.44, 0.02, "annual min declination");
  });
});

describe("altitude and azimuth at solar noon", () => {
  for (const { day, noonAltitude } of FIXTURES) {
    it(`puts the sun ${noonAltitude} deg up and due south on ${day}`, () => {
      const noon = solarNoon(day);
      const sun = sunPosition(noon);
      // 90 - latitude + declination. This is the whole test: get the hour angle
      // or the zenith formula wrong and this number moves by degrees.
      within(sun.altitudeDeg, noonAltitude, 0.15, `${day} noon altitude`);
      // Due south. Fails immediately if azimuth is measured from south, or
      // counted anticlockwise, or offset by the building axis.
      within(sun.azimuthDeg, 180, 0.5, `${day} noon azimuth`);
    });
  }

  it("spans 46.9 deg between the solstices, which is twice the obliquity", () => {
    const summer = sunPosition(solarNoon(SUMMER)).altitudeDeg;
    const winter = sunPosition(solarNoon(WINTER)).altitudeDeg;
    within(summer - winter, 2 * 23.44, 0.1, "solstice-to-solstice noon swing");
  });
});

describe("azimuth at sunrise", () => {
  for (const { day, sunriseAzimuth } of FIXTURES) {
    it(`has the sun clear the horizon at azimuth ${sunriseAzimuth} on ${day}`, () => {
      const sun = sunPosition(sunrise(day));
      expect(Math.abs(sun.altitudeDeg)).toBeLessThan(1e-4);
      within(sun.azimuthDeg, sunriseAzimuth, 0.5, `${day} sunrise azimuth`);
      // Sunrise is in the eastern half. A mirrored azimuth convention would put
      // this at 360 minus the fixture and every noon test would still pass.
      expect(sun.azimuthDeg).toBeLessThan(180);
    });
  }
});

describe("time zone convention: a Date is an instant in UTC", () => {
  // src/geo/solar.ts reads only UTC accessors, so callers must convert Cambridge
  // wall clock themselves (UTC-5 standard, UTC-4 daylight). These tests exist
  // because the module would look plausible while being four or five hours out.

  it("puts solar noon 4h44m after 12:00 UTC, as 71.1 deg of west longitude demands", () => {
    // 4 minutes of rotation per degree: 71.1171195 * 4 = 284.5 min after
    // 12:00 UTC, i.e. 16:44:28 UTC for mean solar noon. The equation of time
    // shifts apparent noon by at most about 16.5 min either way across the year.
    const meanNoonMin = 720 + 4 * -WELD_ORIGIN.lon;
    within(meanNoonMin, 1004.47, 0.01, "mean solar noon, minutes past 00:00 UTC");

    for (const day of [SUMMER, EQUINOX, WINTER]) {
      const noon = solarNoon(day);
      const minutes =
        (noon.getTime() - startOfUtcDay(day)) / 60_000;
      within(minutes, meanNoonMin, 17, `${day} solar noon, minutes past 00:00 UTC`);
    }
  });

  it("reads 12:00Z as morning and 22:00Z as evening on the June solstice", () => {
    // 12:00 UTC is 08:00 EDT and 22:00 UTC is 18:00 EDT. Between them these two
    // pin the offset from both sides: a module that quietly added Cambridge's
    // 4 hours would put 12:00Z before sunrise, and one that subtracted them
    // would put 22:00Z after sunset.
    const morning = sunPosition(new Date("2026-06-21T12:00:00Z"));
    expect(morning.altitudeDeg).toBeGreaterThan(20);
    expect(morning.azimuthDeg).toBeLessThan(180);

    const evening = sunPosition(new Date("2026-06-21T22:00:00Z"));
    expect(evening.altitudeDeg).toBeGreaterThan(15);
    expect(evening.azimuthDeg).toBeGreaterThan(180);
  });

  it("has the sun below the horizon at Cambridge local midnight", () => {
    // Local midnight is 04:00Z on daylight time and 05:00Z on standard time.
    const midnights = [
      "2026-06-22T04:00:00Z",
      "2026-03-20T04:00:00Z",
      "2026-09-23T04:00:00Z",
      "2026-12-21T05:00:00Z",
      "2026-01-15T05:00:00Z",
    ];
    for (const iso of midnights) {
      const sun = sunPosition(new Date(iso));
      expect(sun.altitudeDeg, `altitude at ${iso}`).toBeLessThan(-15);
    }
  });

  it("does not depend on how the Date was written", () => {
    const a = sunPosition(new Date("2026-06-21T16:46:20Z"));
    const b = sunPosition(new Date(Date.UTC(2026, 5, 21, 16, 46, 20)));
    expect(a).toEqual(b);
  });
});

describe("the equation of time", () => {
  // Everything else here is a geometry fixture, and geometry fixtures are blind
  // to a time shift: drop the equation of time entirely and every altitude and
  // azimuth above still lands within tolerance, because solar noon just moves.
  // This block is what pins it. It is checked against its own analytic envelope
  // rather than a table of dates.
  //
  //   obliquity term amplitude   = tan^2(eps/2) rad = 9.86 min of time
  //   eccentricity term amplitude = 2e         rad = 7.66 min of time
  //
  // with eps = 23.4365 and e = 0.016709, converted at 4 min per degree. So
  // apparent noon can be no more than 17.52 min from mean noon, ever.

  const MEAN_NOON_MIN = 720 + 4 * -WELD_ORIGIN.lon;
  const ENVELOPE_MIN = (Math.tan((23.4365 / 2) * DEG) ** 2 + 2 * 0.016708634) * 4 * (180 / Math.PI);

  it("has an envelope of 17.5 min set by the obliquity and the eccentricity", () => {
    within(ENVELOPE_MIN, 17.52, 0.01, "equation of time envelope");
  });

  it("swings apparent noon across most of that envelope and averages out to mean noon", () => {
    // Sampled every third day: the extremes are stationary points so a coarse
    // grid loses less than a hundredth of a minute.
    const offsets: number[] = [];
    for (let d = 0; d < 365; d += 3) {
      const day = new Date(Date.UTC(2026, 0, 1) + d * 86_400_000)
        .toISOString()
        .slice(0, 10);
      offsets.push((solarNoon(day).getTime() - startOfUtcDay(day)) / 60_000 - MEAN_NOON_MIN);
    }
    const max = Math.max(...offsets);
    const min = Math.min(...offsets);
    const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;

    // Never outside the analytic envelope. This is a hard bound, not a fit.
    expect(Math.max(Math.abs(max), Math.abs(min))).toBeLessThan(ENVELOPE_MIN);
    // And it really does swing: 31.2 min peak to peak in 2026. The 20 min floor
    // is well under that and well over the 0 a missing or mis-scaled equation of
    // time would give.
    expect(max - min).toBeGreaterThan(20);
    // Mean solar time is by definition the average of apparent solar time.
    within(mean, 0, 0.5, "annual mean offset of apparent noon from mean noon");
    // Apparent noon runs early in autumn and late in winter, not the reverse.
    expect(min).toBeLessThan(-14);
    expect(max).toBeGreaterThan(12);
  });
});

describe("sunPosition defaults and other latitudes", () => {
  it("defaults to Weld Hall's centroid", () => {
    const d = new Date("2026-06-21T14:00:00Z");
    expect(sunPosition(d)).toEqual(
      sunPosition(d, WELD_ORIGIN.lat, WELD_ORIGIN.lon),
    );
  });

  it("puts the noon sun due north in the southern hemisphere", () => {
    // The azimuth branch must not assume the sun is south at noon. At -42.374
    // on the June solstice the noon altitude mirrors to 90 - 42.374 - 23.44 and
    // the sun stands due north.
    const noonish = new Date("2026-06-21T16:46:20Z");
    const sun = sunPosition(noonish, -LAT, WELD_ORIGIN.lon);
    within(sun.altitudeDeg, 90 - LAT - 23.44, 0.15, "mirrored noon altitude");
    within(normalizeAngle(sun.azimuthDeg), 0, 0.5, "mirrored noon azimuth");
  });

  it("puts the equinox noon sun overhead at the equator", () => {
    const sun = sunPosition(solarNoon(EQUINOX), 0, WELD_ORIGIN.lon);
    within(sun.altitudeDeg, 90, 0.15, "equatorial equinox noon altitude");
  });
});

describe("isFacadeLit", () => {
  it("is false whenever the sun is down, however well aimed", () => {
    expect(isFacadeLit(GABLE_AZ, { altitudeDeg: -0.1, azimuthDeg: GABLE_AZ })).toBe(
      false,
    );
    expect(isFacadeLit(GABLE_AZ, { altitudeDeg: 0, azimuthDeg: GABLE_AZ })).toBe(
      false,
    );
    expect(isFacadeLit(GABLE_AZ, { altitudeDeg: 0.1, azimuthDeg: GABLE_AZ })).toBe(
      true,
    );
  });

  it("cuts off at exactly 90 deg from the outward normal", () => {
    const up = (azimuthDeg: number) => ({ altitudeDeg: 10, azimuthDeg });
    expect(isFacadeLit(GABLE_AZ, up(GABLE_AZ + 89.9))).toBe(true);
    expect(isFacadeLit(GABLE_AZ, up(GABLE_AZ + 90))).toBe(false);
    expect(isFacadeLit(GABLE_AZ, up(GABLE_AZ + 90.1))).toBe(false);
    expect(isFacadeLit(GABLE_AZ, up(GABLE_AZ - 89.9))).toBe(true);
    expect(isFacadeLit(GABLE_AZ, up(GABLE_AZ - 90))).toBe(false);
  });

  it("wraps across north rather than clipping at 0/360", () => {
    // The gable's lit band runs from -76.8 to 103.2, so most of it is on the
    // 283..360 side of the compass. Naive subtraction without normalizeAngle
    // gets these wrong.
    const up = (azimuthDeg: number) => ({ altitudeDeg: 10, azimuthDeg });
    expect(isFacadeLit(GABLE_AZ, up(300))).toBe(true); // -60 from north
    expect(isFacadeLit(GABLE_AZ, up(283.3))).toBe(true); // just inside -76.8
    expect(isFacadeLit(GABLE_AZ, up(283.1))).toBe(false); // just outside
  });

  it("agrees with the building frame: lit means the sun is within 90 deg of +v", () => {
    // azimuthToBuilding turns a compass bearing into degrees off the gable's
    // outward normal, so the gable test must be exactly |that| < 90.
    for (let az = 0.35; az < 360; az += 1) {
      expect(
        isFacadeLit(GABLE_AZ, { altitudeDeg: 5, azimuthDeg: az }),
        `azimuth ${az}`,
      ).toBe(Math.abs(azimuthToBuilding(az)) < 90);
    }
  });

  it("lights exactly one of the gable and the south wall at a time", () => {
    for (let az = 0.35; az < 360; az += 1) {
      const sun = { altitudeDeg: 5, azimuthDeg: az };
      expect(
        isFacadeLit(GABLE_AZ, sun) !== isFacadeLit(SOUTH_AZ, sun),
        `azimuth ${az}`,
      ).toBe(true);
    }
  });
});

describe("the north gable is not a dark wall", () => {
  /**
   * CORRECTION OF RECORD. I told the client the suite "gets almost no direct
   * sunlight" because it faces north. That was wrong, and these tests exist to
   * make it impossible to say again.
   *
   * Weld's north gable faces azimuth 13.2, not 0, and a wall is lit out to
   * 90 deg either side of its normal, so the gable is in sun for any sun
   * azimuth in (-76.8, 103.2). Cambridge's summer sunrise is at azimuth 57.4,
   * which is inside that band, so the gable is lit from the moment the sun
   * comes up until mid-morning, and again from early evening to sunset. Only in
   * winter, when sunrise has moved round to 122.6, does the gable go dark for
   * the whole day.
   *
   * The switch is where the sunrise azimuth equals 103.2, i.e. where
   * sin(declination) = cos(103.2) * cos(42.3739) -> declination = -9.71 deg.
   */

  const CROSSOVER_DECL = -9.7121;

  it("has its lit band bounded by the 13.2 deg axis, not by due north", () => {
    within(normalizeAngle(GABLE_AZ - 90), -76.8, 0.001, "band start");
    within(normalizeAngle(GABLE_AZ + 90), 103.2, 0.001, "band end");
  });

  it("derives the crossover declination of -9.71 deg from the band edge", () => {
    // Invert cos(sunrise azimuth) = sin(declination) / cos(latitude) at the
    // 103.2 deg edge of the band.
    const decl =
      (Math.asin(Math.cos(EAST_AZ * DEG) * Math.cos(LAT * DEG)) * 180) /
      Math.PI;
    within(decl, CROSSOVER_DECL, 0.001, "crossover declination");

    // And the same identity forward: at that declination sunrise is exactly on
    // the gable's edge, so a hair more declination lights it and a hair less
    // does not.
    const sunriseAzAt = (declDeg: number) =>
      (Math.acos(Math.sin(declDeg * DEG) / Math.cos(LAT * DEG)) * 180) /
      Math.PI;
    within(sunriseAzAt(CROSSOVER_DECL), 103.2, 0.01, "sunrise azimuth at crossover");
    expect(sunriseAzAt(CROSSOVER_DECL + 0.5)).toBeLessThan(103.2);
    expect(sunriseAzAt(CROSSOVER_DECL - 0.5)).toBeGreaterThan(103.2);
  });

  it("IS lit at sunrise on 21 June", () => {
    const sun = sunPosition(sunrise(SUMMER));
    within(sun.azimuthDeg, 57.4, 0.5, "June sunrise azimuth");
    expect(sun.azimuthDeg).toBeLessThan(103.2);
    expect(isFacadeLit(GABLE_AZ, sun)).toBe(true);
  });

  it("is NOT lit at sunrise on 21 December", () => {
    const sun = sunPosition(sunrise(WINTER));
    within(sun.azimuthDeg, 122.6, 0.5, "December sunrise azimuth");
    expect(sun.azimuthDeg).toBeGreaterThan(103.2);
    expect(isFacadeLit(GABLE_AZ, sun)).toBe(false);
  });

  it("gets about six and a half hours of direct sun on the June solstice", () => {
    // 399 minutes when this was written: roughly 05:13-09:47 EDT on the
    // north-east flank and 18:30-20:25 EDT on the north-west. Bounded on both
    // sides so it cannot pass by returning something absurd.
    const minutes = litMinutes(SUMMER, GABLE_AZ);
    expect(minutes).toBeGreaterThan(330);
    expect(minutes).toBeLessThan(450);
  });

  it("gets none at all on the December solstice", () => {
    expect(litMinutes(WINTER, GABLE_AZ)).toBe(0);
    // The rest of the building still does, so a zero here is not a dead
    // isFacadeLit.
    expect(litMinutes(WINTER, SOUTH_AZ)).toBeGreaterThan(400);
    expect(litMinutes(WINTER, EAST_AZ)).toBeGreaterThan(250);
  });

  it("catches morning sun from late February to mid October and not outside", () => {
    // Declination passes -9.71 twice a year, on 23/24 February and 18/19
    // October in 2026. The inner dates below sit about half a degree of azimuth
    // either side of each crossing, which pins the crossing to a day and a half.
    // Deliberately NOT 2026-02-23 or 2026-10-18: those fall within 0.004 deg of
    // the band edge, so a test on them would encode rounding, not astronomy.
    const lit = ["2026-02-24", "2026-02-28", "2026-03-04", "2026-10-12", "2026-10-17"];
    const dark = ["2026-01-15", "2026-02-14", "2026-02-22", "2026-10-19", "2026-11-15"];

    for (const day of lit) {
      const at = sunrise(day);
      const sun = sunPosition(at);
      const label = `${day} sunrise az ${sun.azimuthDeg.toFixed(2)}`;
      expect(solarDeclinationDeg(at), label).toBeGreaterThan(CROSSOVER_DECL);
      expect(isFacadeLit(GABLE_AZ, sun), label).toBe(true);
    }
    for (const day of dark) {
      const at = sunrise(day);
      const sun = sunPosition(at);
      const label = `${day} sunrise az ${sun.azimuthDeg.toFixed(2)}`;
      expect(solarDeclinationDeg(at), label).toBeLessThan(CROSSOVER_DECL);
      expect(isFacadeLit(GABLE_AZ, sun), label).toBe(false);
    }
  });

  it("also takes evening sun in June, on the north-west side of the band", () => {
    // 19:00 EDT = 23:00 UTC, azimuth about 290, which is -83 off the gable
    // normal and so still inside the band. Nothing about a "north" wall would
    // predict this.
    const sun = sunPosition(new Date("2026-06-21T23:00:00Z"));
    expect(sun.altitudeDeg).toBeGreaterThan(5);
    expect(sun.azimuthDeg).toBeGreaterThan(270);
    expect(isFacadeLit(GABLE_AZ, sun)).toBe(true);
  });
});

describe("the east facade, which the suite's rooms face", () => {
  // Outward normal 103.2, so lit for sun azimuths in (13.2, 193.2): everything
  // from a little east of north round to just past due south. That is a morning
  // wall in every season and never an afternoon one.

  it("takes strong sun mid-morning in June", () => {
    const sun = sunPosition(new Date("2026-06-21T12:00:00Z")); // 08:00 EDT
    expect(sun.altitudeDeg).toBeGreaterThan(25);
    expect(isFacadeLit(EAST_AZ, sun)).toBe(true);
  });

  it("takes none in the late afternoon in June even though the sun is high", () => {
    const sun = sunPosition(new Date("2026-06-21T21:00:00Z")); // 17:00 EDT
    // The sun is still 30 deg up: the wall is dark because it faces the wrong
    // way, not because it is late.
    expect(sun.altitudeDeg).toBeGreaterThan(30);
    expect(isFacadeLit(EAST_AZ, sun)).toBe(false);
    expect(isFacadeLit(WEST_AZ, sun)).toBe(true);
  });

  it("takes morning sun and no afternoon sun in December too", () => {
    const morning = sunPosition(new Date("2026-12-21T14:00:00Z")); // 09:00 EST
    expect(morning.altitudeDeg).toBeGreaterThan(10);
    expect(isFacadeLit(EAST_AZ, morning)).toBe(true);

    const afternoon = sunPosition(new Date("2026-12-21T20:00:00Z")); // 15:00 EST
    expect(afternoon.altitudeDeg).toBeGreaterThan(5); // sun still up
    expect(isFacadeLit(EAST_AZ, afternoon)).toBe(false);
  });

  it("runs about eight hours in June and five and a half in December", () => {
    // 472 and 320 minutes when this was written.
    const june = litMinutes(SUMMER, EAST_AZ);
    expect(june).toBeGreaterThan(420);
    expect(june).toBeLessThan(510);

    const december = litMinutes(WINTER, EAST_AZ);
    expect(december).toBeGreaterThan(280);
    expect(december).toBeLessThan(350);
  });
});

/**
 * The subsolar point, added in P9 so the globe can be lit by the real sun.
 *
 * Same rule as the rest of this file: every fixture is an identity, not a table. Three do
 * all the work here.
 *
 *   the sun is at altitude 90 exactly at the subsolar point
 *   at 12:00 UTC the subsolar longitude is minus a quarter of the equation of time
 *   the subsolar latitude IS the declination, so it is capped at the obliquity
 *
 * The first is the strong one, and it is not circular even though both sides come out of
 * solar.ts: sunPosition() computes an hour angle from the clock, the equation of time and
 * the longitude, and a zenith from that hour angle and the latitude. It returns 90 only if
 * the longitude subsolarPoint() produced cancels the first three terms AND the latitude it
 * produced equals the declination. Either sign flipped, and the altitude comes out wrong by
 * tens of degrees.
 */
describe("the subsolar point", () => {
  /** A year of instants, deliberately not on the hour and not on the solstices. */
  const YEAR = Array.from(
    { length: 73 },
    (_, i) => new Date(Date.UTC(2026, 0, 1 + i * 5, (i * 7) % 24, (i * 13) % 60)),
  );

  it("is the point at which the sun is exactly overhead", () => {
    // FIVE PLACES AND NOT MORE, AND THE REASON IS acos, NOT THE ASTRONOMY. At the subsolar
    // point cosZenith is 1 by construction, and acos is at its worst exactly there: an error
    // of one double ulp in the cosine, 2.2e-16, comes out as sqrt(2 * 2.2e-16) = 2.1e-8 rad
    // of zenith angle, i.e. 1.2e-6 degrees. The worst case over a year of instants measures
    // 8.5e-7 degrees, which is three milliarcseconds and a factor of two inside that bound.
    // It is the classic cancellation in acos near 1, it is not an error in either function,
    // and tightening this assertion would be pinning a float artefact.
    for (const d of YEAR) {
      const { lat, lon } = subsolarPoint(d);
      expect(sunPosition(d, lat, lon).altitudeDeg, d.toISOString()).toBeCloseTo(90, 5);
    }
  });

  it("sits a quarter degree west of Greenwich per minute the sun is early, at 12:00 UTC", () => {
    // WHERE THE SIGN OF THE LONGITUDE IS PINNED, and the fixtures are the equation of time's
    // own extremes, which are textbook and independent of this codebase:
    //
    //   ~11 Feb   EoT about -14.2 min (apparent noon LATE)   so the sun is EAST,  lon > 0
    //   ~14 May   EoT about  +3.7 min                        slightly west
    //   ~3 Nov    EoT about +16.4 min (apparent noon EARLY)   so the sun is WEST,  lon < 0
    //
    // lon = -EoT/4 degrees. The three expected values are +3.55, -0.93 and -4.10. Getting the
    // sign of the term backwards would swap February and November, which is a 7.6 degree
    // error in the terminator's position -- half an hour of daylight, and visible.
    const cases: [string, number][] = [
      ["2026-02-11T12:00:00Z", +3.55],
      ["2026-05-14T12:00:00Z", -0.93],
      ["2026-11-03T12:00:00Z", -4.1],
    ];
    for (const [iso, expected] of cases) {
      const { lon } = subsolarPoint(new Date(iso));
      // Within a quarter degree, i.e. within a minute of the equation of time, which is the
      // precision the published extremes are quoted to.
      expect(lon, iso).toBeGreaterThan(expected - 0.25);
      expect(lon, iso).toBeLessThan(expected + 0.25);
    }
  });

  it("travels west at fifteen degrees an hour", () => {
    const a = subsolarPoint(new Date("2026-09-15T12:00:00Z"));
    const b = subsolarPoint(new Date("2026-09-15T15:00:00Z"));
    // Three hours later, 45 degrees further west -- but NOT exactly 45, and the residual is
    // the physics rather than the arithmetic. Measured: -45.0111 degrees. The equation of
    // time drifts while the clock runs, and 0.0111 degrees is 0.045 minutes of it over three
    // hours, which is the right order for mid-September when EoT is moving fastest (about
    // 20 seconds a day). A test that demanded exactly -45 would be asserting that apparent
    // and mean solar time advance together, which is the one thing the equation of time
    // exists to say they do not.
    expect(normalizeAngle(b.lon - a.lon)).toBeCloseTo(-45, 1);
    expect(Math.abs(normalizeAngle(b.lon - a.lon) + 45)).toBeLessThan(0.05);
    expect(b.lat).toBeCloseTo(a.lat, 1);
  });

  it("crosses the tropics and no further", () => {
    const lats = YEAR.map((d) => subsolarPoint(d).lat);
    expect(Math.max(...lats)).toBeGreaterThan(23);
    expect(Math.max(...lats)).toBeLessThan(23.44);
    expect(Math.min(...lats)).toBeLessThan(-23);
    expect(Math.min(...lats)).toBeGreaterThan(-23.44);
  });

  it("agrees with the exported declination, which is the same number", () => {
    for (const d of YEAR) {
      expect(subsolarPoint(d).lat).toBe(solarDeclinationDeg(d));
    }
  });

  it("stays in [-180, 180], like every other longitude in the project", () => {
    for (const d of YEAR) {
      const { lon } = subsolarPoint(d);
      expect(lon, d.toISOString()).toBeGreaterThan(-180.0000001);
      expect(lon, d.toISOString()).toBeLessThanOrEqual(180);
    }
  });

  it("puts the sun over the Pacific at Cambridge's default 9am, not over Cambridge", () => {
    // The store's default is 2026-09-15 at 09:00 local, which is 13:00 UTC on daylight time.
    // Solar noon at Weld's longitude is about 16:50 UTC, so at 13:00 the sun is still well
    // to the east of it -- over the Atlantic, around 16 degrees west. What this rules out is
    // a globe lit as though the store's wall clock were already UTC, which would put the
    // terminator four hours wrong and is exactly the mistake solar.ts's header warns about.
    const { lat, lon } = subsolarPoint(new Date("2026-09-15T13:00:00Z"));
    expect(lat).toBeGreaterThan(2);
    expect(lat).toBeLessThan(4);
    expect(lon).toBeGreaterThan(-20);
    expect(lon).toBeLessThan(-12);
    // And Weld is therefore in daylight but not at noon.
    const atWeld = sunPosition(new Date("2026-09-15T13:00:00Z"));
    expect(atWeld.altitudeDeg).toBeGreaterThan(20);
    expect(atWeld.azimuthDeg).toBeLessThan(180); // still east of south
  });
});
