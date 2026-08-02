import * as THREE from "three";
import { normalizeRing } from "@/geo/extrude";

export const WELD_NAME = "Weld Hall";

/**
 * P11 §0.5 RETIRES THE CAGE THIS FILE USED TO BUILD. Through P10, `buildCampusGeometry()`
 * merged every building but Weld into one mass (retired earlier, see below) and built
 * Weld's own box plus a wireframe -- `buildEdgeGeometry()` -- that emitted, per ring edge, a
 * grade segment, an eaves segment AND a vertical at the corner. Weld's 56-edge footprint made
 * that 56 verticals plus two 56-segment rings, drawn at ~2.2 px through drei's <Line>: measured
 * by pixel inspection of the stage-2 frame, they merge into opaque white panels at the gable
 * ends of a 143 ft building. That is not a tuning bug in the width or the colour, it is the
 * shape -- a cage of closely-spaced near-parallel lines reads as a solid at any width worth
 * drawing -- so the fix is dropping the eaves ring and the verticals rather than thinning them.
 *
 * `buildEdgeGeometry()`, `buildCampusGeometry()` and `expectedSegments()` had exactly one
 * caller each: Campus.tsx's highlight, nothing else (P10 already retired the box-extruded fill
 * for every building but Weld and its wireframe, `others`/`otherEdges`, in favour of
 * CampusMesh.tsx's real geometry -- see git history for that trim). With the highlight gone
 * to WeldMarker.tsx, none of the three has a caller left, so all three are deleted rather than
 * kept unused. `buildGroundRingGeometry()` below is what WeldMarker.tsx draws instead: the
 * SAME ring-extraction this file always did (`normalizeRing` over campus.json's footprint),
 * emitting only the grade segment a flat ground ring needs.
 */

/**
 * The flat ground outline a footprint ring needs: one segment per ring edge, at grade, no
 * eaves and no corner verticals.
 *
 * Still returned as a flat position list for LineSegmentsGeometry rather than as a line
 * strip, matching the reason `buildEdgeGeometry()` used to give: LineSegments2 is what
 * honours pixel width -- gl.lineWidth is capped at 1 on every major platform and silently
 * ignored.
 */
export function buildGroundRingGeometry(buildings: { ring: unknown }[]): THREE.BufferGeometry {
  const pts: number[] = [];

  for (const b of buildings) {
    const ring = normalizeRing(b.ring as number[][]);
    const n = ring.length - 1; // last point repeats the first
    for (let i = 0; i < n; i++) {
      const a = ring[i]!;
      const c = ring[(i + 1) % n]!;
      pts.push(a[0]!, 0, -a[1]!, c[0]!, 0, -c[1]!);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * Segment count for a set of buildings: one per ring edge, now that the ground ring is the
 * only segment `buildGroundRingGeometry()` emits.
 *
 * Counts the NORMALISED ring, not the raw one. normalizeRing drops duplicate and
 * degenerate vertices -- Weld's 59-point ring reduces to 57 -- so counting the raw
 * ring overstates the total and the first version of the test failed by exactly
 * that difference.
 */
export function expectedGroundSegments(buildings: { ring: unknown }[]): number {
  return buildings.reduce(
    (a, b) => a + (normalizeRing(b.ring as number[][]).length - 1),
    0,
  );
}

/** LineSegmentsGeometry wants point pairs; buildGroundRingGeometry's buffer is a flat position list. */
export function toPointPairs(g: THREE.BufferGeometry): [number, number, number][] {
  const pos = g.getAttribute("position");
  const out: [number, number, number][] = [];
  for (let i = 0; i < pos.count; i++) {
    out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  }
  return out;
}
