import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import campus from "@/data/campus.json";
import weld from "@/data/weld.json";

const require = createRequire(import.meta.url);

type Ring = number[][];

/** Shoelace. Positive is counter-clockwise in a y-up frame. */
function signedArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    s += a[0]! * b[1]! - b[0]! * a[1]!;
  }
  return s / 2;
}

function bbox(ring: Ring) {
  const xs = ring.map((p) => p[0]!);
  const ys = ring.map((p) => p[1]!);
  return {
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

describe("campus.json", () => {
  it("carries 36 buildings from Harvard's Facilities3D layer", () => {
    // 39 rings came back from ArcGIS; 3 were degenerate slivers and were removed.
    expect(campus.buildings).toHaveLength(36);
  });

  it("gives every building a real height and a ring that encloses real area", () => {
    for (const b of campus.buildings) {
      expect(b.height_ft, `${b.name} height`).toBeGreaterThan(0);
      expect(b.ring.length, `${b.name} ring length`).toBeGreaterThanOrEqual(5);
      expect(b.ring[0], `${b.name} ring is closed`).toEqual(b.ring[b.ring.length - 1]);
      // 50 sq ft floor. ArcGIS returned three Smith Campus Center slivers of
      // 0.045, 1.0 and 4.7 sq ft; the smallest real ring is 802 sq ft, so the
      // gap is unambiguous. Extruding a sliver yields degenerate triangles.
      expect(Math.abs(signedArea(b.ring)), `${b.name} encloses area`).toBeGreaterThan(50);
    }
  });

  it("includes Weld Hall at its published height", () => {
    const w = campus.buildings.filter((b) => b.name === "Weld Hall");
    expect(w).toHaveLength(1);
    expect(w[0]!.height_ft).toBe(87.01);
  });

  it("has MIXED ring winding, which is why P1 must normalise before extruding", () => {
    // Not a cosmetic detail. After removing the three degenerate slivers, 35
    // rings are clockwise and 1 is counter-clockwise. Extruding without
    // normalising gives that building inverted normals and it renders black.
    // This assertion locks the requirement in place: if the data is ever
    // refetched clean, it fails and tells us the normaliser stopped mattering.
    const ccw = campus.buildings.filter((b) => signedArea(b.ring) > 0).length;
    const cw = campus.buildings.length - ccw;
    expect(ccw).toBe(1);
    expect(cw).toBe(35);
    expect(ccw).toBeGreaterThan(0);
    expect(cw).toBeGreaterThan(0);
  });

  it("places its origin at Weld's centroid", () => {
    expect(campus.meta.origin.lat).toBeCloseTo(42.3739244, 6);
    expect(campus.meta.origin.lon).toBeCloseTo(-71.1171195, 6);
  });
});

describe("weld.json", () => {
  const ring = weld.rings[0] as Ring;

  it("holds the 59-point footprint, closed", () => {
    expect(ring).toHaveLength(59);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("encloses roughly 7,780 sq ft", () => {
    // Less than width x length would suggest, because the ends are narrower
    // than the middle and the facades carry jogs.
    expect(Math.abs(signedArea(ring))).toBeCloseTo(7779.6, 0);
  });

  it("has the axis-aligned bounding box of a rotated building", () => {
    const { w, h } = bbox(ring);
    // Inflated by the 13.2 deg rotation. The true dimensions only appear after
    // rotating into the building frame; see tests/frames.test.ts.
    expect(w).toBeCloseTo(82.8, 0);
    expect(h).toBeCloseTo(150.9, 0);
  });

  it("records the metadata later phases depend on", () => {
    expect(weld.meta.height_ft).toBe(87.01);
    expect(weld.meta.width_ft_gable_end).toBe(51.8);
    expect(weld.meta.clear_width_gable_end_ft).toBe(48.8);
    expect(weld.meta.long_axis_deg_e_of_n).toBe(13.2);
    expect(weld.meta.facility_id).toBe("CA-03374");
  });
});

describe("dependency ceiling", () => {
  it("keeps React on the 19.2 line, because react-three-fiber 9 requires <19.3", () => {
    // The single most fragile pin in the project. R3F 9.6.1 declares
    // react: ">=19 <19.3" while Next 16 accepts ^19.0.0, so nothing but the
    // tilde in package.json stops an install from breaking the renderer.
    const version: string = require("react/package.json").version;
    const [major, minor] = version.split(".");
    expect(`${major}.${minor}`).toBe("19.2");
  });
});
