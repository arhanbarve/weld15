import { describe, it, expect } from "vitest";
import weld from "@/data/weld.json";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import { pointInPolygon } from "@/geo/collide";
import { siteToBuilding, signedArea } from "@/geo/frames";
import {
  suiteToBuilding,
  suiteToSite,
  suiteToThree,
  suiteCornersSite,
  rectCornersSite,
  facadeAzimuth,
  gableAzimuth,
  floorLevel,
  GABLE_INNER_V,
  CLEAR_HALF_U,
  WELD,
} from "@/geo/place";

const ring = weld.rings[0] as number[][];

describe("suite to building frame", () => {
  it("puts the suite's north edge on the gable's interior face", () => {
    const p = DEFAULT_PARAMS;
    const b = suiteToBuilding(0, p.sectionLength, p);
    expect(b.v).toBeCloseTo(GABLE_INNER_V, 6);
  });

  it("puts the suite's south edge one section length back from the gable", () => {
    const p = DEFAULT_PARAMS;
    const b = suiteToBuilding(0, 0, p);
    expect(b.v).toBeCloseTo(GABLE_INNER_V - p.sectionLength, 6);
  });

  it("puts u = 0 on the facade's interior face, on whichever side", () => {
    expect(suiteToBuilding(0, 0, { ...DEFAULT_PARAMS, facade: "east" }).u).toBeCloseTo(
      CLEAR_HALF_U,
      6,
    );
    expect(suiteToBuilding(0, 0, { ...DEFAULT_PARAMS, facade: "west" }).u).toBeCloseTo(
      -CLEAR_HALF_U,
      6,
    );
  });

  it("moves inward from the facade in opposite directions for east and west", () => {
    // The whole point of the facade toggle. If these had the same sign the
    // mirror option would be a no-op.
    const east = suiteToBuilding(10, 0, { ...DEFAULT_PARAMS, facade: "east" }).u;
    const west = suiteToBuilding(10, 0, { ...DEFAULT_PARAMS, facade: "west" }).u;
    expect(east).toBeLessThan(CLEAR_HALF_U);
    expect(west).toBeGreaterThan(-CLEAR_HALF_U);
    expect(Math.sign(east)).not.toBe(Math.sign(west));
  });

  it("round trips through the site frame", () => {
    const p = DEFAULT_PARAMS;
    const b = suiteToBuilding(7, 19, p);
    const s = suiteToSite(7, 19, p);
    const back = siteToBuilding(s);
    expect(back.u).toBeCloseTo(b.u, 9);
    expect(back.v).toBeCloseTo(b.v, 9);
  });

  it("sends the suite to three.js space with north on -Z", () => {
    const p = DEFAULT_PARAMS;
    const v = suiteToThree(0, p.sectionLength, floorLevel(1), p);
    expect(v).toHaveLength(3);
    expect(v[1]).toBeCloseTo(12, 6); // first floor, 12 ft up
    // the gable end is toward building north, which in three space is -Z-ish
    expect(v[2]).toBeLessThan(0);
  });
});

describe("the suite actually fits inside Weld", () => {
  // This is the integration test the project did not have. It composes rooms.ts,
  // place.ts, collide.ts, frames.ts and the real GIS footprint. Every one of
  // those could pass its own unit tests while the suite still landed in the car
  // park.

  it("has a footprint polygon with real area, so the test is not vacuous", () => {
    expect(Math.abs(signedArea(ring))).toBeGreaterThan(7000);
  });

  it("puts every room corner inside Weld's real 59-point footprint, east facade", () => {
    const suite = buildSuite({ ...DEFAULT_PARAMS, facade: "east" });
    const outside = suiteCornersSite(suite).filter(
      (c) => !pointInPolygon([c.site.x, c.site.y], ring),
    );
    expect(
      outside.map((o) => `${o.id} at ${o.site.x.toFixed(1)},${o.site.y.toFixed(1)}`),
    ).toEqual([]);
  });

  it("puts every room corner inside Weld's real footprint, west facade too", () => {
    const suite = buildSuite({ ...DEFAULT_PARAMS, facade: "west" });
    const outside = suiteCornersSite(suite).filter(
      (c) => !pointInPolygon([c.site.x, c.site.y], ring),
    );
    expect(
      outside.map((o) => `${o.id} at ${o.site.x.toFixed(1)},${o.site.y.toFixed(1)}`),
    ).toEqual([]);
  });

  it("catches a suite pushed deliberately out of the building", () => {
    // Proves the containment test above can fail. Weld's clear width at the
    // gable is 49 ft, so a suite reaching 64 ft inward from one facade must
    // punch out the far wall. 40 ft was NOT enough: measured from the east
    // facade it lands 19.5 ft past the centreline, still inside a 49 ft span,
    // which is exactly why the first version of this test passed vacuously.
    const suite = buildSuite({
      ...DEFAULT_PARAMS,
      bedDepth: 60,
      legDepth: 65,
      commonDeep: 64,
    });
    const outside = suiteCornersSite(suite).filter(
      (c) => !pointInPolygon([c.site.x, c.site.y], ring),
    );
    expect(outside.length).toBeGreaterThan(0);
  });

  it("keeps the wall bands inside the footprint as well", () => {
    const suite = buildSuite();
    const { walls } = buildWalls(suite);
    // Exclude the exterior masonry: it is the building's own wall, so it sits ON
    // the boundary and its outer face is legitimately at or outside the polygon.
    const inner = walls.filter((w) => w.kind === "partition");
    const escaped: string[] = [];
    for (const w of inner) {
      for (const site of rectCornersSite(
        { ...w, id: w.id, label: w.id, kind: "unknown", windows: [] },
        suite.params,
      )) {
        if (!pointInPolygon([site.x, site.y], ring)) escaped.push(w.id);
      }
    }
    expect([...new Set(escaped)]).toEqual([]);
  });
});

describe("facade orientation feeds solar.ts", () => {
  it("gives the east facade an azimuth 90 degrees off the building axis", () => {
    const axis = weld.meta.long_axis_deg_e_of_n;
    expect(facadeAzimuth({ ...DEFAULT_PARAMS, facade: "east" })).toBeCloseTo(axis + 90, 6);
    expect(facadeAzimuth({ ...DEFAULT_PARAMS, facade: "west" })).toBeCloseTo(axis - 90, 6);
    expect(gableAzimuth()).toBeCloseTo(axis, 6);
  });

  it("puts the east facade at 103.2 degrees, a morning wall", () => {
    // 13.2 + 90. Used by the sun tests; recorded here so the two agree.
    expect(facadeAzimuth({ ...DEFAULT_PARAMS, facade: "east" })).toBeCloseTo(103.2, 6);
  });
});

describe("building constants come from weld.json, not from prose", () => {
  it("reads the verified envelope", () => {
    expect(WELD.length).toBeCloseTo(143.3, 6);
    expect(WELD.gableWidth).toBeCloseTo(52.0, 6);
    expect(WELD.clearWidth).toBeCloseTo(49.0, 6);
    expect(WELD.floorToFloor).toBeCloseTo(12.0, 6);
    expect(WELD.eaves).toBeCloseTo(60.0, 6);
    expect(WELD.ridge).toBeCloseTo(85.4, 6);
  });

  it("stacks floors 12 ft apart", () => {
    expect(floorLevel(1)).toBeCloseTo(12, 6);
    expect(floorLevel(5)).toBeCloseTo(60, 6);
    // and the fifth floor level lands on the eaves, which is the cross-check
    // that made 12 ft credible in the first place
    expect(floorLevel(5)).toBeCloseTo(WELD.eaves, 6);
  });
});
