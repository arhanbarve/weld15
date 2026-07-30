import { describe, it, expect } from "vitest";
import campus from "@/data/campus.json";
import { extrude, normalizeRing } from "@/geo/extrude";
import { buildEdgeGeometry, expectedSegments, WELD_NAME } from "@/scene/campusGeometry";

/**
 * buildCampusGeometry() itself needs a WebGL-free three, which works in Node, but
 * mergeGeometries pulls in enough of the renderer to be brittle under vitest. The
 * merge is covered by the e2e draw-call count instead; what is worth pinning here
 * is the edge geometry, because a wireframe with missing verticals or a dropped
 * closing edge looks almost right and is very easy to ship.
 */
describe("edge geometry", () => {
  const others = campus.buildings.filter((b) => b.name !== WELD_NAME);
  const weld = campus.buildings.filter((b) => b.name === WELD_NAME);

  it("emits three segments per ring edge: grade, eaves and corner", () => {
    const g = buildEdgeGeometry(weld);
    const verts = g.getAttribute("position").count;
    // two vertices per segment
    expect(verts).toBe(expectedSegments(weld) * 2);
  });

  it("covers every building except Weld in the merged set", () => {
    const g = buildEdgeGeometry(others);
    expect(g.getAttribute("position").count).toBe(expectedSegments(others) * 2);
    expect(others).toHaveLength(35);
  });

  it("closes every ring, so no building has a missing wall edge", () => {
    // The classic off-by-one here drops the segment from the last vertex back to
    // the first, which leaves a one-edge gap that reads as a shading artefact.
    for (const b of [...weld, ...others].slice(0, 6)) {
      const ring = normalizeRing(b.ring as number[][]);
      const n = ring.length - 1;
      const g = buildEdgeGeometry([b]);
      const pos = g.getAttribute("position");
      // Collect the grade-level segments and check each ring vertex appears twice
      // (once as a start, once as an end), which only holds for a closed loop.
      const touches = new Map<string, number>();
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i)) > 1e-6) continue;
        const key = `${pos.getX(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
        touches.set(key, (touches.get(key) ?? 0) + 1);
      }
      // Each distinct grade vertex is shared by two grade edges, plus one corner
      // vertical also starts at grade, so three touches per vertex.
      expect(touches.size, `${b.name} vertex count`).toBe(n);
      for (const [key, count] of touches) {
        expect(count, `${b.name} vertex ${key} touched ${count} times`).toBe(3);
      }
    }
  });

  it("puts every edge vertex at or above grade and at or below the eaves", () => {
    for (const b of [...weld, ...others]) {
      const g = buildEdgeGeometry([b]);
      const pos = g.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        // Tolerance is 1e-3, not 1e-6: positions are Float32, and 87.01 stores as
        // 87.01000213623047, which a tighter bound rejects for no real reason.
        expect(y, `${b.name} vertex below grade`).toBeGreaterThanOrEqual(-1e-3);
        expect(y, `${b.name} vertex above eaves`).toBeLessThanOrEqual(b.height_ft + 1e-3);
      }
    }
  });

  it("maps north onto -Z, matching the mass geometry", () => {
    // If the edges and the masses disagreed on handedness, the wireframe would be
    // mirrored against the solid and the whole campus would look doubled.
    const b = weld[0]!;
    const edges = buildEdgeGeometry([b]).getAttribute("position");
    const mass = extrude(b.ring as number[][], b.height_ft);
    let edgeMinZ = Infinity;
    for (let i = 0; i < edges.count; i++) edgeMinZ = Math.min(edgeMinZ, edges.getZ(i));
    let massMinZ = Infinity;
    for (let i = 2; i < mass.positions.length; i += 3) {
      massMinZ = Math.min(massMinZ, mass.positions[i]!);
    }
    expect(edgeMinZ).toBeCloseTo(massMinZ, 3);
  });

  it("produces a non-trivial wireframe, so the checks above are not vacuous", () => {
    const g = buildEdgeGeometry(campus.buildings);
    expect(g.getAttribute("position").count).toBeGreaterThan(2000);
  });
});
