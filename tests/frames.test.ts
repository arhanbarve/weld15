import { describe, it, expect } from "vitest";
import weld from "@/data/weld.json";
import {
  WELD_ORIGIN,
  WELD_AXIS_DEG,
  latLonToSite,
  siteToLatLon,
  siteToBuilding,
  buildingToSite,
  toThree,
  fromThree,
  azimuthToBuilding,
  normalizeAngle,
  ringBounds,
  signedArea,
} from "@/geo/frames";

describe("WGS84 <-> site", () => {
  it("puts the origin at zero", () => {
    const s = latLonToSite(WELD_ORIGIN.lat, WELD_ORIGIN.lon);
    expect(s.x).toBeCloseTo(0, 9);
    expect(s.y).toBeCloseTo(0, 9);
  });

  it("round trips", () => {
    const ll = { lat: 42.3752, lon: -71.1188 };
    const back = siteToLatLon(latLonToSite(ll.lat, ll.lon));
    expect(back.lat).toBeCloseTo(ll.lat, 10);
    expect(back.lon).toBeCloseTo(ll.lon, 10);
  });

  it("puts increasing latitude to the north and increasing longitude to the east", () => {
    expect(latLonToSite(WELD_ORIGIN.lat + 0.001, WELD_ORIGIN.lon).y).toBeGreaterThan(0);
    expect(latLonToSite(WELD_ORIGIN.lat, WELD_ORIGIN.lon + 0.001).x).toBeGreaterThan(0);
  });
});

describe("site <-> building", () => {
  it("round trips", () => {
    const p = { x: 123.4, y: -56.7 };
    const back = buildingToSite(siteToBuilding(p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });

  it("maps the building's own axis direction onto +v with no u component", () => {
    // A point 100 ft along the building axis: 13.2 deg east of north.
    const a = (WELD_AXIS_DEG * Math.PI) / 180;
    const along = { x: 100 * Math.sin(a), y: 100 * Math.cos(a) };
    const b = siteToBuilding(along);
    expect(b.u).toBeCloseTo(0, 6);
    expect(b.v).toBeCloseTo(100, 6);
  });

  it("collapses Weld's rotated bounding box, confirming the 13.2 degree axis", () => {
    // The real check on WELD_AXIS_DEG. In site frame the ring's axis-aligned box
    // is 82.8 x 150.9 only because the building is rotated. Rotating into the
    // building frame must shrink the cross-building extent substantially; a
    // wrong axis would not.
    const ring = weld.rings[0] as number[][];
    const rotated = ring.map((p) => {
      const b = siteToBuilding({ x: p[0]!, y: p[1]! });
      return [b.u, b.v];
    });
    const site = ringBounds(ring);
    const bldg = ringBounds(rotated);

    expect(site.width).toBeCloseTo(82.8, 0);
    expect(site.height).toBeCloseTo(150.9, 0);

    // 62.3 ft is Weld at its widest, across the projecting wings in the middle
    // third. NOT 54 ft: that figure was my own estimate off an OpenStreetMap
    // edge and it was wrong. A brute-force sweep confirms 13.1 deg minimises
    // this width at 62.31 ft, so Harvard's 13.2 is right to a tenth.
    expect(bldg.width).toBeCloseTo(62.3, 0);
    expect(bldg.height).toBeCloseTo(142.9, 0);
  });

  it("finds the north gable end 51.8 ft wide, which is what the suite has to fit in", () => {
    // Weld is not a plain rectangle. The end bays are narrower than the middle,
    // and the suite sits at the north end, so the end width is the number that
    // governs the room layout. Slice the polygon at stations inward from the
    // north gable and measure.
    const ring = weld.rings[0] as number[][];
    const pts = ring.slice(0, -1).map((p) => {
      const b = siteToBuilding({ x: p[0]!, y: p[1]! });
      return [b.u, b.v] as [number, number];
    });
    const vMax = Math.max(...pts.map((p) => p[1]));

    const widthAt = (v0: number) => {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [u1, v1] = pts[i]!;
        const [u2, v2] = pts[(i + 1) % pts.length]!;
        if ((v1 - v0) * (v2 - v0) < 0) {
          xs.push(u1 + ((v0 - v1) / (v2 - v1)) * (u2 - u1));
        }
      }
      return xs.length >= 2 ? Math.max(...xs) - Math.min(...xs) : null;
    };

    // Uniform 51.8 ft across the whole depth the suite occupies.
    for (const d of [1, 5, 10, 15, 19]) {
      expect(widthAt(vMax - d), `width ${d} ft in from the gable`).toBeCloseTo(51.8, 0);
    }

    // And it steps out to the wings past about 23 ft, which independently
    // corroborates a band roughly 20 ft deep: the narrow end zone is 23 ft, and
    // 20 ft came from the resident's "15-20 ft" range by a separate route entirely.
    expect(widthAt(vMax - 25)).toBeCloseTo(62.2, 0);
  });
});

describe("three.js frame", () => {
  it("round trips", () => {
    const v = toThree(12, 34, 56);
    const back = fromThree(v);
    expect(back.x).toBe(12);
    expect(back.y).toBe(34);
    expect(back.z).toBe(56);
  });

  it("sends north to -Z and up to +Y, which is the mirror trap", () => {
    // If this ever flips, the whole building mirrors, and mirroring is already a
    // live ambiguity in this project so the error would be invisible by eye.
    expect(toThree(0, 100, 0)).toEqual([0, 0, -100]); // 100 ft north
    expect(toThree(100, 0, 0)).toEqual([100, 0, 0]); // 100 ft east
    expect(toThree(0, 0, 100)).toEqual([0, 100, 0]); // 100 ft up
  });
});

describe("angles", () => {
  it("wraps to (-180, 180]", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(190)).toBeCloseTo(-170, 9);
    expect(normalizeAngle(-190)).toBeCloseTo(170, 9);
    expect(normalizeAngle(540)).toBeCloseTo(180, 9);
  });

  it("expresses the north gable's normal as zero in the building frame", () => {
    // The gable faces compass azimuth 13.2, which is 0 in building terms.
    expect(azimuthToBuilding(WELD_AXIS_DEG)).toBeCloseTo(0, 9);
    expect(azimuthToBuilding(WELD_AXIS_DEG + 90)).toBeCloseTo(90, 9);
  });
});

describe("signedArea", () => {
  it("is positive counter-clockwise and negative clockwise", () => {
    const ccw = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    expect(signedArea(ccw)).toBeCloseTo(100, 9);
    expect(signedArea([...ccw].reverse())).toBeCloseTo(-100, 9);
  });

  it("measures Weld's footprint at about 7,780 sq ft", () => {
    expect(Math.abs(signedArea(weld.rings[0] as number[][]))).toBeCloseTo(7779.6, 0);
  });
});
