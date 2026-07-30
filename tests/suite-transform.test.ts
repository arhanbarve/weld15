import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import { suiteToThree, floorLevel } from "@/geo/place";
import { suiteBasis, rectCentre } from "@/scene/Suite";
import { pointInPolygon } from "@/geo/collide";
import { fromThree } from "@/geo/frames";
import weld from "@/data/weld.json";

const ring = weld.rings[0] as number[][];

/**
 * These exist because the first version of Suite.tsx put everything in one
 * rotated group and negated local coordinates by hand. The negations were wrong,
 * the rooms landed outside the building, and stage 5 rendered as a single grey
 * plane -- which the e2e coverage gate happily passed. A frame can be 42% covered
 * with 10 distinct colours and still be garbage, so the geometry needs pinning
 * here, where it can be checked exactly rather than photographed.
 */
describe("suite basis", () => {
  const params = DEFAULT_PARAMS;
  const { uDir, vDir, yaw } = suiteBasis(params);

  it("gives orthogonal, horizontal basis vectors", () => {
    expect(uDir.dot(vDir)).toBeCloseTo(0, 9);
    expect(uDir.y).toBeCloseTo(0, 9);
    expect(vDir.y).toBeCloseTo(0, 9);
    expect(uDir.length()).toBeCloseTo(1, 9);
    expect(vDir.length()).toBeCloseTo(1, 9);
  });

  it("derives a yaw that sends a box's local axes onto the suite frame", () => {
    // A Y-rotation sends +x to (cos, 0, -sin) and +z to (sin, 0, cos). Both must
    // land on the suite's own axes, or every box is rotated wrongly.
    const q = new THREE.Euler(0, yaw, 0);
    const x = new THREE.Vector3(1, 0, 0).applyEuler(q);
    const z = new THREE.Vector3(0, 0, 1).applyEuler(q);
    expect(x.angleTo(uDir)).toBeCloseTo(0, 6);
    expect(z.angleTo(vDir)).toBeCloseTo(0, 6);
  });

  it("matches the building's 13.2 degree axis", () => {
    const axis = (weld.meta.long_axis_deg_e_of_n * Math.PI) / 180;
    // vDir runs along the building toward the gable; its angle off -Z (world
    // north) must be the building's own rotation.
    const north = new THREE.Vector3(0, 0, -1);
    expect(vDir.angleTo(north)).toBeCloseTo(axis, 3);
  });
});

describe("room placement in the world", () => {
  const params = DEFAULT_PARAMS;
  const suite = buildSuite(params);
  const floor = floorLevel(1);

  it("centres every room exactly where suiteToThree says it should be", () => {
    for (const r of suite.rooms) {
      const want = suiteToThree(r.u + r.du / 2, r.v + r.dv / 2, floor, params);
      const got = rectCentre(r, floor, params);
      expect(got.x, `${r.id} x`).toBeCloseTo(want[0], 9);
      expect(got.y, `${r.id} y`).toBeCloseTo(want[1], 9);
      expect(got.z, `${r.id} z`).toBeCloseTo(want[2], 9);
    }
  });

  it("puts every room centre inside Weld's real footprint", () => {
    // The check the grey-plane bug would have failed. Room centres landing
    // outside the building is precisely what happened.
    const outside = suite.rooms
      .map((r) => ({ id: r.id, c: rectCentre(r, floor, params) }))
      .filter(({ c }) => {
        const p = fromThree([c.x, c.y, c.z]);
        return !pointInPolygon([p.x, p.y], ring);
      })
      .map(({ id }) => id);
    expect(outside).toEqual([]);
  });

  it("keeps the rooms within a sane distance of the building centroid", () => {
    // Weld is 143 x 51 ft, so nothing in it can be more than about 80 ft from the
    // centroid. A transform sign error typically throws geometry hundreds of feet.
    for (const r of suite.rooms) {
      const c = rectCentre(r, floor, params);
      expect(Math.hypot(c.x, c.z), `${r.id} is ${Math.hypot(c.x, c.z).toFixed(0)} ft out`).toBeLessThan(90);
    }
  });

  it("stacks floors and walls at the right heights", () => {
    const c = rectCentre(suite.rooms[0]!, floor + params.ceiling / 2, params);
    expect(c.y).toBeCloseTo(floor + params.ceiling / 2, 9);
  });

  it("moves every room when the facade flips", () => {
    const east = buildSuite({ ...params, facade: "east" });
    const west = buildSuite({ ...params, facade: "west" });
    for (let i = 0; i < east.rooms.length; i++) {
      const a = rectCentre(east.rooms[i]!, floor, { ...params, facade: "east" });
      const b = rectCentre(west.rooms[i]!, floor, { ...params, facade: "west" });
      expect(a.distanceTo(b), `${east.rooms[i]!.id} did not move`).toBeGreaterThan(1);
    }
  });
});
