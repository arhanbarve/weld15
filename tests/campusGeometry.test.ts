import { describe, it, expect } from "vitest";
import campus from "@/data/campus.json";
import { extrude, normalizeRing } from "@/geo/extrude";
import { buildGroundRingGeometry, expectedGroundSegments, WELD_NAME } from "@/scene/campusGeometry";

/**
 * P11 §0.5 RETIRED THE THREE-SEGMENTS-PER-EDGE WIREFRAME these tests used to pin -- a grade
 * ring, an eaves ring and a corner vertical, which is exactly the shape that merged into white
 * panels at Weld's gable ends. `buildGroundRingGeometry()` is what replaced it: one segment per
 * ring edge, at grade, nothing above it. What is worth pinning here is unchanged in spirit --
 * a ring with a missing vertical, sorry, a missing SEGMENT, or a dropped closing edge looks
 * almost right and is very easy to ship.
 */
describe("ground ring geometry", () => {
  const others = campus.buildings.filter((b) => b.name !== WELD_NAME);
  const weld = campus.buildings.filter((b) => b.name === WELD_NAME);

  it("emits one segment per ring edge, at grade only", () => {
    const g = buildGroundRingGeometry(weld);
    const verts = g.getAttribute("position").count;
    // two vertices per segment
    expect(verts).toBe(expectedGroundSegments(weld) * 2);
  });

  it("covers every building except Weld in the merged set", () => {
    const g = buildGroundRingGeometry(others);
    expect(g.getAttribute("position").count).toBe(expectedGroundSegments(others) * 2);
    expect(others).toHaveLength(35);
  });

  it("closes every ring, so no building has a missing wall edge", () => {
    // The classic off-by-one here drops the segment from the last vertex back to
    // the first, which leaves a one-edge gap that reads as a shading artefact.
    for (const b of [...weld, ...others].slice(0, 6)) {
      const ring = normalizeRing(b.ring as number[][]);
      const n = ring.length - 1;
      const g = buildGroundRingGeometry([b]);
      const pos = g.getAttribute("position");
      // Every vertex is at grade now, so every position counts. Each distinct ring vertex
      // is shared by two grade edges -- once as a start, once as an end -- which only
      // holds for a closed loop.
      const touches = new Map<string, number>();
      for (let i = 0; i < pos.count; i++) {
        const key = `${pos.getX(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
        touches.set(key, (touches.get(key) ?? 0) + 1);
      }
      expect(touches.size, `${b.name} vertex count`).toBe(n);
      for (const [key, count] of touches) {
        expect(count, `${b.name} vertex ${key} touched ${count} times`).toBe(2);
      }
    }
  });

  it("puts every vertex at grade, not above it", () => {
    for (const b of [...weld, ...others]) {
      const g = buildGroundRingGeometry([b]);
      const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        expect(pos.getY(i), `${b.name} vertex off grade`).toBe(0);
      }
    }
  });

  it("maps north onto -Z, matching the mass geometry", () => {
    // If the ring and the mass disagreed on handedness, WeldMarker's outline would be
    // mirrored against the solid and sit off the building it is meant to trace.
    const b = weld[0]!;
    const ring = buildGroundRingGeometry([b]).getAttribute("position");
    const mass = extrude(b.ring as number[][], b.height_ft);
    let ringMinZ = Infinity;
    for (let i = 0; i < ring.count; i++) ringMinZ = Math.min(ringMinZ, ring.getZ(i));
    let massMinZ = Infinity;
    for (let i = 2; i < mass.positions.length; i += 3) {
      massMinZ = Math.min(massMinZ, mass.positions[i]!);
    }
    expect(ringMinZ).toBeCloseTo(massMinZ, 3);
  });

  it("produces a non-trivial ring, so the checks above are not vacuous", () => {
    const g = buildGroundRingGeometry(campus.buildings);
    expect(g.getAttribute("position").count).toBeGreaterThan(700);
  });
});
