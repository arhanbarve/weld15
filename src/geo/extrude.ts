/**
 * Footprint ring plus a height to triangle soup.
 *
 * This module exists because of one measured defect in the source data. P0 found
 * campus.json carries **35 clockwise rings and 1 counter-clockwise one** (see
 * docs/DIMENSION-AUDIT.md §1 row 11 and the winding assertion in
 * tests/data.test.ts). Extrude a ring without normalising its winding and that
 * one building gets inward-facing side quads: with back-face culling on it
 * renders black, and nothing in the scene says why. So normalizeRing is not a
 * tidiness pass, it is the reason the module has a seam at all.
 *
 * No three.js here. Everything comes back as plain typed arrays, in THREE space
 * via frames.toThree, so the geometry stays testable in Node. P2 wraps these in
 * a BufferGeometry; that is the only thing P2 has to add.
 *
 * The output is a **closed solid**: roof cap, floor cap, side walls. The floor
 * earns its place twice over -- a closed surface is what makes the
 * divergence-theorem volume check in tests/extrude.test.ts valid at any base
 * height rather than only at base 0, and it stops a building being see-through
 * from underneath once the camera can drop below grade.
 *
 * Vertices are never shared between faces. Each face carries its own copies so
 * it can carry its own normal; averaging normals across a building's corners
 * would round off exactly the edges the massing is made of. That fixes the
 * counts, for a normalised ring of n vertices:
 *
 *   vertices   6n       n roof + n floor + 4 per side quad
 *   triangles  4n - 4   2(n-2) per cap + 2 per side quad
 *   indices    12n - 12
 *
 * Those are asserted, because a triangulator that quietly drops an ear is the
 * failure this project has already been bitten by twice in its render tests.
 */

import { toThree } from "@/geo/frames";

export type Extrusion = {
  /** xyz triples in THREE space (x east, y up, z south), feet */
  positions: Float32Array;
  /** unit normals, one per position */
  normals: Float32Array;
  /** triangle indices into positions/normals */
  indices: Uint32Array;
};

/** A ring vertex in the site frame: x east, y north, feet. */
type Pt = [number, number];

/**
 * Two consecutive vertices closer than this are the same vertex, in feet.
 * Measured: the shortest genuine edge anywhere in campus.json or weld.json is
 * 0.1 ft, and the 12 coincident vertices in the data (8 in Smith Campus Center,
 * 2 in Grays, 2 in Hampden) are bit-identical, so anything between 0 and 0.1
 * separates them. 1e-6 sits five orders below the shortest real edge.
 */
const VERTEX_EPS = 1e-6;

/**
 * Twice the triangle area, sq ft, below which three consecutive vertices count
 * as collinear. Measured: 7 exactly-collinear triples survive de-duplication in
 * campus.json + weld.json, and the smallest genuinely non-degenerate cap
 * triangle across all 37 rings is 1.5e-2 sq ft. 1e-6 is 30,000x below that, so
 * this only ever removes vertices that add nothing.
 */
const COLLINEAR_EPS = 1e-6;

/**
 * Force a ring to a single canonical form: counter-clockwise by shoelace, no
 * coincident vertices, no vertices that sit on the straight line between their
 * neighbours.
 *
 * Closed in, closed out. campus.json, weld.json and frames.signedArea all use
 * the repeated-first-point convention, so returning an open ring would silently
 * cost every downstream shoelace its closing edge. Open input is accepted too;
 * the wrap-around de-duplication handles both.
 *
 * The de-duplication is not defensive coding for a hypothetical. A zero-length
 * edge yields a zero-area side quad whose normal is 0/0 = NaN, and one NaN in a
 * position buffer discards the whole draw call. Collinear vertices are removed
 * for the cap: they are the only thing standing between the ear clipper and
 * emitting triangles of 3e-14 sq ft, which is the "silent degenerate triangle"
 * this module is supposed to make impossible.
 */
export function normalizeRing(ring: number[][]): number[][] {
  const loop = ringLoop(ring);
  const first = loop[0]!;
  return [...loop, [first[0], first[1]]];
}

/** normalizeRing without the closing duplicate: n distinct vertices, CCW. */
function ringLoop(ring: number[][]): Pt[] {
  const pts: Pt[] = [];
  for (const p of ring) {
    const x = p[0]!;
    const y = p[1]!;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(x - last[0], y - last[1]) <= VERTEX_EPS) continue;
    pts.push([x, y]);
  }
  // The closing vertex, and any run of copies of it.
  while (pts.length > 1) {
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > VERTEX_EPS) break;
    pts.pop();
  }

  // Removing one collinear vertex can make a neighbour collinear in turn, so
  // this has to run to a fixed point rather than in a single pass.
  let removed = true;
  while (removed && pts.length > 3) {
    removed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]!;
      const b = pts[i]!;
      const c = pts[(i + 1) % pts.length]!;
      if (Math.abs(cross(a, b, c)) > COLLINEAR_EPS) continue;
      // Only drop a vertex the path passes straight through. A vertex where the
      // path doubles back on itself is also collinear, and removing it would
      // delete a spike rather than a no-op, so it stays and stays visible.
      const forward =
        (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (forward <= 0) continue;
      pts.splice(i, 1);
      removed = true;
      break;
    }
  }

  if (pts.length < 3) {
    throw new Error(
      `extrude: ring collapses to ${pts.length} distinct vertices, which encloses no area`,
    );
  }

  // Shoelace over the closed ring. Reverse in place if clockwise: this is the
  // 1-in-36 case that renders black without it.
  let twiceArea = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  if (twiceArea < 0) pts.reverse();

  return pts;
}

/** Twice the signed area of triangle abc. Positive when abc turns left. */
function cross(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/**
 * Ear clipping, O(n^2). Returns n-2 index triples wound the same way as the
 * input, which normalizeRing guarantees is counter-clockwise.
 *
 * No library, because the footprints are simple polygons and the largest is 84
 * vertices after normalisation -- a dependency would buy robustness we can
 * measure we do not need.
 *
 * Containment uses a **strictly interior** test. Measured: the usual inclusive
 * test (a vertex lying exactly on a candidate ear's edge blocks the ear) stalls
 * on Smith Campus Center with 17 vertices left and on Hampden Hall with 15,
 * because both ArcGIS rings touch themselves. Strict interior clears both and
 * still leaves the smallest emitted triangle at 1.5e-2 sq ft.
 */
function earClip(pts: Pt[]): [number, number, number][] {
  const live = pts.map((_, i) => i);
  const tris: [number, number, number][] = [];

  while (live.length > 3) {
    let clipped = false;
    for (let i = 0; i < live.length; i++) {
      const ia = live[(i + live.length - 1) % live.length]!;
      const ib = live[i]!;
      const ic = live[(i + 1) % live.length]!;
      const a = pts[ia]!;
      const b = pts[ib]!;
      const c = pts[ic]!;
      if (cross(a, b, c) <= 0) continue; // reflex or collinear: not an ear

      let blocked = false;
      for (const j of live) {
        if (j === ia || j === ib || j === ic) continue;
        const p = pts[j]!;
        if (cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      tris.push([ia, ib, ic]);
      live.splice(i, 1);
      clipped = true;
      break;
    }
    // Loud rather than partial. A cap short of n-2 triangles is a hole in the
    // roof, and a hole in the roof is exactly the kind of defect that survived
    // two generations of this project's render assertions.
    if (!clipped) {
      throw new Error(
        `extrude: ear clipping stalled with ${live.length} vertices left; ring is probably self-intersecting`,
      );
    }
  }

  tris.push([live[0]!, live[1]!, live[2]!]);
  return tris;
}

/**
 * A footprint ring and a height to a closed triangle soup in THREE space.
 *
 * `base` is the up-coordinate of the floor, in feet; the roof lands at
 * base + height. It defaults to 0 because campus.json heights are measured from
 * grade, but Weld's massing needs an eaves box at 0 and a roof above it (audit
 * §2a: eave 60.0 ft, ridge 85.4 ft), which is what a non-zero base is for.
 */
export function extrude(
  ring: number[][],
  height: number,
  base = 0,
): Extrusion {
  if (!(height > 0)) {
    throw new Error(`extrude: height must be positive, got ${height}`);
  }

  const pts = ringLoop(ring);
  const n = pts.length;
  const top = base + height;
  const cap = earClip(pts);

  const positions = new Float32Array(6 * n * 3);
  const normals = new Float32Array(6 * n * 3);
  const indices = new Uint32Array(12 * n - 12);
  let v = 0;
  let i = 0;

  const push = (p: readonly [number, number, number], nrm: readonly [number, number, number]) => {
    positions[v * 3] = p[0];
    positions[v * 3 + 1] = p[1];
    positions[v * 3 + 2] = p[2];
    normals[v * 3] = nrm[0];
    normals[v * 3 + 1] = nrm[1];
    normals[v * 3 + 2] = nrm[2];
    return v++;
  };

  // Roof. A counter-clockwise triple in the site frame comes out of toThree
  // counter-clockwise seen from above, which is front-facing in three.js, so the
  // ear clipper's order is used as-is.
  const roof = v;
  const UP = [0, 1, 0] as const;
  for (const p of pts) push(toThree(p[0], p[1], top), UP);
  for (const t of cap) {
    indices[i++] = roof + t[0];
    indices[i++] = roof + t[1];
    indices[i++] = roof + t[2];
  }

  // Floor. Same triangles, reversed, so they face down.
  const floor = v;
  const DOWN = [0, -1, 0] as const;
  for (const p of pts) push(toThree(p[0], p[1], base), DOWN);
  for (const t of cap) {
    indices[i++] = floor + t[2];
    indices[i++] = floor + t[1];
    indices[i++] = floor + t[0];
  }

  // Side walls, one independent quad per edge.
  for (let e = 0; e < n; e++) {
    const a = pts[e]!;
    const b = pts[(e + 1) % n]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    // Interior lies left of travel on a counter-clockwise ring, so the outward
    // normal is the right-hand perpendicular (dy, -dx). VERTEX_EPS already
    // guarantees len > 0.1 ft, so this cannot divide by zero.
    const nrm = toThree(dy / len, -dx / len, 0);
    const ab = push(toThree(a[0], a[1], base), nrm);
    const bb = push(toThree(b[0], b[1], base), nrm);
    const bt = push(toThree(b[0], b[1], top), nrm);
    const at = push(toThree(a[0], a[1], top), nrm);
    indices[i++] = ab;
    indices[i++] = bb;
    indices[i++] = bt;
    indices[i++] = ab;
    indices[i++] = bt;
    indices[i++] = at;
  }

  return { positions, normals, indices };
}
