import { describe, it, expect } from "vitest";
import { WELD_ORIGIN } from "@/geo/frames";
import {
  altitudeOf,
  ecefToSite,
  geodeticToSite,
  siteToEcef,
  siteToGeodetic,
  weldBasis,
  WELD_GRADE_H_FT,
  type Vec3,
} from "@/scene/geo/frame";

const DEG = Math.PI / 180;

/** WGS-84, duplicated from frame.ts's own constants -- this file checks frame.ts against
 *  an independently written formula, not against itself, so it does not import them. */
const WGS84_A = 6_378_137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const FEET_PER_METRE = 3.280839895;

describe("geodeticToSite puts WELD_ORIGIN at the site origin", () => {
  it("maps (WELD_ORIGIN, 0 ft) to [0, 0, 0] within 0.01 ft", () => {
    const p = geodeticToSite(WELD_ORIGIN.lat, WELD_ORIGIN.lon, 0);
    expect(p[0]).toBeCloseTo(0, 2);
    expect(p[1]).toBeCloseTo(0, 2);
    expect(p[2]).toBeCloseTo(0, 2);
  });
});

describe("geodeticToSite sends due east to +X", () => {
  it("a point 100 ft due east of WELD_ORIGIN, same height, lands near [100, 0, 0]", () => {
    // "Due east" here means: along the parallel circle through WELD_ORIGIN, at WELD_ORIGIN's
    // geodetic latitude -- computed independently of frame.ts, from the WGS-84 prime-vertical
    // radius of curvature N(lat) and the parallel's own radius N(lat)*cos(lat). At 100 ft this
    // differs from the true local-tangent east direction by a curvature term of order
    // (100 ft / R)^2 * R, a few thousandths of a foot, well inside the 0.01 ft budget.
    const lat = WELD_ORIGIN.lat * DEG;
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
    const parallelRadius = n * Math.cos(lat);
    const arcMeters = 100 / FEET_PER_METRE;
    const dLonRad = arcMeters / parallelRadius;
    const lonEast = WELD_ORIGIN.lon + dLonRad / DEG;

    const p = geodeticToSite(WELD_ORIGIN.lat, lonEast, 0);
    expect(p[0]).toBeCloseTo(100, 2);
    expect(p[1]).toBeCloseTo(0, 2);
    expect(p[2]).toBeCloseTo(0, 2);
  });

  it("equivalently: siteToGeodetic([100, 0, 0]) sits ~100 ft east of WELD_ORIGIN", () => {
    const g = siteToGeodetic([100, 0, 0]);
    // Height is unchanged.
    expect(g.hFt).toBeCloseTo(0, 2);
    // Latitude is (to this precision) unchanged; the displacement is due east.
    expect(g.lat).toBeCloseTo(WELD_ORIGIN.lat, 6);
    // The longitude delta, converted back to feet along the parallel, is ~100.
    const lat = WELD_ORIGIN.lat * DEG;
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
    const parallelRadius = n * Math.cos(lat);
    const dLonRad = (g.lon - WELD_ORIGIN.lon) * DEG;
    const arcMeters = dLonRad * parallelRadius;
    expect(arcMeters * FEET_PER_METRE).toBeCloseTo(100, 1);
  });
});

describe("the site frame is anchored on Weld's grade, not on the ellipsoid", () => {
  /**
   * THE BUG THIS PINS. originEcefStd() passed a height of 0 through P11, so the frame hung
   * off the WGS-84 ellipsoid while every other file in the project treated y = 0 as the
   * ground. Google's tiles arrive in real ECEF and are the only thing in the scene that
   * knows where the ground actually is, so the whole parametric model floated 64 ft above
   * the photogrammetry. These cases fail if the datum is ever taken back out.
   *
   * Written against WELD_GRADE_H_FT rather than against a literal -64.05, because the
   * shipped value is tuned to Google's own rendered surface (see frame.ts) and a test that
   * restated it would have to be edited every time the surface was re-measured. What is
   * asserted is the RELATIONSHIP -- ellipsoid heights and grade heights differ by exactly
   * the datum, in the right direction -- plus the sign and rough size of the datum itself,
   * which is what would actually regress.
   */
  it("the datum is a real depression below the ellipsoid, tens of feet, not zero", () => {
    expect(WELD_GRADE_H_FT).toBeLessThan(-30);
    expect(WELD_GRADE_H_FT).toBeGreaterThan(-100);
  });

  it("a point at ellipsoid height 0 stands WELD_GRADE_H_FT above the site's own grade", () => {
    // Built independently of frame.ts: WELD_ORIGIN at ellipsoid height 0, straight through
    // the WGS-84 closed form into ECEF, then asked where the site frame puts it.
    const lat = WELD_ORIGIN.lat * DEG;
    const lon = WELD_ORIGIN.lon * DEG;
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
    const onEllipsoid: Vec3 = [
      n * Math.cos(lat) * Math.cos(lon),
      n * Math.cos(lat) * Math.sin(lon),
      n * (1 - WGS84_E2) * Math.sin(lat),
    ];
    const p = ecefToSite(onEllipsoid);
    expect(p[0]).toBeCloseTo(0, 2);
    expect(p[2]).toBeCloseTo(0, 2);
    // Grade is BELOW the ellipsoid here, so the ellipsoid surface is above y = 0 by |datum|.
    expect(p[1]).toBeCloseTo(-WELD_GRADE_H_FT, 1);
  });

  it("geodeticToSite reads its height as feet above grade", () => {
    // Weld's ridge, 85.4 ft above grade, over Weld's own origin: straight up, y = 85.4.
    const ridge = geodeticToSite(WELD_ORIGIN.lat, WELD_ORIGIN.lon, 85.4);
    expect(ridge[0]).toBeCloseTo(0, 2);
    expect(ridge[1]).toBeCloseTo(85.4, 2);
    expect(ridge[2]).toBeCloseTo(0, 2);
  });

  it("siteToGeodetic round-trips a height above grade unchanged", () => {
    const g = siteToGeodetic([0, 85.4, 0]);
    expect(g.hFt).toBeCloseTo(85.4, 2);
    expect(g.lat).toBeCloseTo(WELD_ORIGIN.lat, 6);
    expect(g.lon).toBeCloseTo(WELD_ORIGIN.lon, 6);
  });
});

describe("altitudeOf agrees with the site-frame height straight up from Weld", () => {
  it("altitudeOf([0, h, 0]) === h within 1 ft, across six decades", () => {
    const heights = [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000];
    for (const h of heights) {
      const p: Vec3 = [0, h, 0];
      expect(altitudeOf(p), `h=${h}`).toBeCloseTo(h, 0);
    }
  });
});

describe("siteToEcef and ecefToSite are exact inverses", () => {
  it("siteToEcef(ecefToSite(p)) is identity to 1e-6 ft, including at orbit-scale distances", () => {
    // ~6,096,012 m is ~2e7 ft, the descent's stated orbit-altitude scale -- included because
    // precision at that magnitude is a named project risk (P11-PHOTOREAL.md section 6.1).
    const points: Vec3[] = [
      [0, 0, 0],
      [6_378_137, 0, 0],
      [0, 6_378_137, 0],
      [1_000, -2_000, 500],
      [1_000_000, 2_000_000, -3_000_000],
      [6_096_012, 6_096_012, 6_096_012],
      [-6_096_012, 3_000_000, -1_500_000],
    ];
    for (const p of points) {
      const out = siteToEcef(ecefToSite(p));
      for (let i = 0; i < 3; i++) {
        const errFt = Math.abs(out[i]! - p[i]!) * FEET_PER_METRE;
        expect(errFt, `component ${i} of ${JSON.stringify(p)}`).toBeLessThan(1e-6);
      }
    }
  });

  it("also round-trips ecefToSite(siteToEcef(p)) for site-frame points at orbit altitude", () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [100, 200, -300],
      [0, 2.09e7, 0],
      [5_000_000, 2e7, -5_000_000],
    ];
    for (const p of points) {
      const out = ecefToSite(siteToEcef(p));
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(out[i]! - p[i]!), `component ${i} of ${JSON.stringify(p)}`).toBeLessThan(
          1e-6,
        );
      }
    }
  });
});

describe("weldBasis is re-exported unchanged from geo/frame", () => {
  it("still puts Weld at the top of the sphere (Y-up geocentric convention)", () => {
    const f = WELD_ORIGIN.lat * DEG;
    const l = WELD_ORIGIN.lon * DEG;
    const up: Vec3 = [Math.cos(f) * Math.cos(l), Math.sin(f), -Math.cos(f) * Math.sin(l)];
    const basis = weldBasis();
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    expect(dot(basis.x, up)).toBeCloseTo(0, 12);
    expect(dot(basis.y, up)).toBeCloseTo(1, 12);
    expect(dot(basis.z, up)).toBeCloseTo(0, 12);
  });
});
