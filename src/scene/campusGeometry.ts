import * as THREE from "three";
// three-stdlib exports the older name; three's own copy calls it mergeGeometries.
import { mergeBufferGeometries } from "three-stdlib";
import campus from "@/data/campus.json";
import { normalizeRing } from "@/geo/extrude";
import { extrudedGeometry } from "./geometry";

export const WELD_NAME = "Weld Hall";

/**
 * Campus geometry, merged.
 *
 * P2 drew 36 separate building meshes, so 36 draw calls. Merging the masses into
 * one BufferGeometry takes that to 1, and the edges into a second.
 *
 * Weld is deliberately EXCLUDED from the merge. Merging costs the ability to
 * address a single building, and Weld has to be highlighted, so it is worth one
 * extra draw call to keep it separately styleable.
 */
export function buildCampusGeometry(): {
  others: THREE.BufferGeometry;
  weld: THREE.BufferGeometry;
  otherEdges: THREE.BufferGeometry;
  weldEdges: THREE.BufferGeometry;
  counts: { buildings: number; merged: number };
} {
  const others: THREE.BufferGeometry[] = [];
  let weld: THREE.BufferGeometry | null = null;

  for (const b of campus.buildings) {
    const g = extrudedGeometry(b.ring as number[][], b.height_ft);
    if (b.name === WELD_NAME) weld = g;
    else others.push(g);
  }
  if (!weld) throw new Error("campus.json has no Weld Hall");

  const merged = mergeBufferGeometries(others, false);
  if (!merged) throw new Error("mergeBufferGeometries returned null");

  return {
    others: merged,
    weld,
    otherEdges: buildEdgeGeometry(campus.buildings.filter((b) => b.name !== WELD_NAME)),
    weldEdges: buildEdgeGeometry(campus.buildings.filter((b) => b.name === WELD_NAME)),
    counts: { buildings: campus.buildings.length, merged: others.length },
  };
}

type Building = { ring: number[][]; height_ft: number };

/**
 * The wireframe a cyanotype is made of: the footprint at grade, the same at the
 * eaves, and a vertical at every corner.
 *
 * Returned as a flat position list for LineSegmentsGeometry rather than as line
 * strips, because LineSegments2 is what honours pixel width -- gl.lineWidth is
 * capped at 1 on every major platform and silently ignored.
 */
export function buildEdgeGeometry(buildings: { ring: unknown; height_ft: number }[]): THREE.BufferGeometry {
  const pts: number[] = [];

  for (const b of buildings) {
    const ring = normalizeRing(b.ring as number[][]);
    const h = b.height_ft;
    const n = ring.length - 1; // last point repeats the first
    for (let i = 0; i < n; i++) {
      const a = ring[i]!;
      const c = ring[(i + 1) % n]!;
      const ax = a[0]!, az = -a[1]!;
      const cx = c[0]!, cz = -c[1]!;
      // grade
      pts.push(ax, 0, az, cx, 0, cz);
      // eaves
      pts.push(ax, h, az, cx, h, cz);
      // corner
      pts.push(ax, 0, az, ax, h, az);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * Segment count for a set of buildings: three per ring edge.
 *
 * Counts the NORMALISED ring, not the raw one. normalizeRing drops duplicate and
 * degenerate vertices -- Weld's 59-point ring reduces to 57 -- so counting the raw
 * ring overstates the total and the first version of the test failed by exactly
 * that difference.
 */
export function expectedSegments(buildings: { ring: unknown }[]): number {
  return buildings.reduce(
    (a, b) => a + (normalizeRing(b.ring as number[][]).length - 1) * 3,
    0,
  );
}
