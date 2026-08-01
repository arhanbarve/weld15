import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeGeometry, decodeStrings, leafNodes, toSiteFeet, BUFFER_STRIDE } from "@/scene/i3s";

/**
 * A synthetic node buffer in geometryDefinitions[1]'s layout: 8-byte header, then
 * non-interleaved position/normal/uv0/color/uvRegion, then per-feature featureId and faceRange.
 */
function fixture(vertexCount: number, featureCount: number): Buffer {
  const b = Buffer.alloc(8 + vertexCount * BUFFER_STRIDE + featureCount * 16);
  b.writeUInt32LE(vertexCount, 0);
  b.writeUInt32LE(featureCount, 4);
  return b;
}

describe("the buffer layout is guarded", () => {
  it("accepts a buffer whose length matches the header", () => {
    expect(() => decodeGeometry(fixture(3, 1))).not.toThrow();
  });

  it("throws on a buffer whose length does not", () => {
    const b = fixture(3, 1).subarray(0, 40);
    expect(() => decodeGeometry(b)).toThrow(/length/i);
  });

  it("has a stride of 44 bytes per vertex", () => {
    // 12 position + 12 normal + 8 uv0 + 4 color + 8 uvRegion. This arithmetic is what proved the
    // layout during diagnosis: 8 + 960*44 + 1*16 = 42,264, which is exactly what the service
    // returned for Weld Hall.
    expect(BUFFER_STRIDE).toBe(44);
    expect(8 + 960 * BUFFER_STRIDE + 1 * 16).toBe(42_264);
  });
});

describe("leafNodes", () => {
  it("keeps meshes with no children and drops parents that also carry a mesh", () => {
    const nodes = [
      { index: 0, mesh: { geometry: { resource: 0, vertexCount: 9, featureCount: 1 } }, children: [1] },
      { index: 1, mesh: { geometry: { resource: 5, vertexCount: 9, featureCount: 1 } } },
      { index: 2, children: [] },
    ];
    // It is a MESH PYRAMID: parents carry a coarser copy of their children. Taking them would draw
    // every building twice.
    expect(leafNodes(nodes).map((n) => n.index)).toEqual([1]);
  });
});

describe("toSiteFeet", () => {
  const WELD = { lon: -71.1171195, lat: 42.3739244 };

  it("puts the origin at the origin", () => {
    const [x, y, z] = toSiteFeet([WELD.lon, WELD.lat, 0], WELD);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("treats z as metres and xy as degrees", () => {
    // 10 m of elevation is 32.808 ft. The mixed-unit convention is invisible if you assume
    // otherwise, which is why it is asserted.
    const [, , z] = toSiteFeet([WELD.lon, WELD.lat, 10], WELD);
    expect(z).toBeCloseTo(32.8084, 3);
  });

  it("puts north at +y and east at +x", () => {
    const [, north] = toSiteFeet([WELD.lon, WELD.lat + 0.001, 0], WELD);
    const [east] = toSiteFeet([WELD.lon + 0.001, WELD.lat, 0], WELD);
    expect(north).toBeGreaterThan(0);
    expect(east).toBeGreaterThan(0);
    // A degree of longitude at this latitude is shorter than a degree of latitude.
    expect(east).toBeLessThan(north);
  });
});

describe("decodeStrings", () => {
  it("reads I3S's length-prefixed UTF-8 attribute block", () => {
    const names = ["Weld Hall", "Grays Hall"];
    const encoded = names.map((n) => Buffer.from(n + "\0", "utf8"));
    const total = encoded.reduce((a, e) => a + e.length, 0);
    const b = Buffer.alloc(8 + names.length * 4 + total);
    b.writeUInt32LE(names.length, 0);
    b.writeUInt32LE(total, 4);
    let o = 8;
    for (const e of encoded) { b.writeUInt32LE(e.length, o); o += 4; }
    for (const e of encoded) { e.copy(b, o); o += e.length; }
    expect(decodeStrings(b)).toEqual(names);
  });
});
