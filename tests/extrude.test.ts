import { describe, it, expect } from "vitest";
import { extrude, normalizeRing, type Extrusion } from "@/geo/extrude";
import { fromThree, signedArea, type Vec3 } from "@/geo/frames";
import campus from "@/data/campus.json";
import weld from "@/data/weld.json";

type Ring = number[][];

const weldRing = weld.rings[0] as Ring;

/**
 * Every ring the project actually renders, with the height it renders at.
 * Keyed by index, not by name: "Smith Campus Center" appears twice in
 * campus.json as two parts of one multipart complex, and only one of the two is
 * malformed, so a name-keyed exclusion list would quietly skip a healthy ring.
 */
const fixtures: { key: string; name: string; ring: Ring; height: number }[] = [
  ...campus.buildings.map((b, i) => ({
    key: `campus[${i}] ${b.name}`,
    name: b.name,
    ring: b.ring as Ring,
    height: b.height_ft,
  })),
  {
    key: "weld.json",
    name: "weld.json",
    ring: weldRing,
    height: weld.meta.height_ft,
  },
];

/**
 * Two ArcGIS rings are not simple polygons: they touch themselves, so the same
 * position appears at two different places in the loop. Measured on the
 * normalised rings -- Smith Campus Center repeats 2 vertices of 84 and has 3
 * proper edge crossings, Hampden Hall repeats 3 of 29. Nothing a triangulator
 * can do makes a pinched polygon watertight or gives it a well-defined outside,
 * so those two invariants are checked on the other 35 rings. The set is derived
 * rather than hard-coded, and asserted below, so it cannot rot silently if the
 * data is refetched.
 */
const nonSimple = fixtures.filter(({ ring }) => {
  const loop = normalizeRing(ring).slice(0, -1);
  return new Set(loop.map((p) => `${p[0]!},${p[1]!}`)).size !== loop.length;
});

const simple = fixtures.filter((f) => !nonSimple.includes(f));

/** A closed counter-clockwise 20 x 30 ft rectangle in the site frame. */
const RECT: Ring = [
  [0, 0],
  [20, 0],
  [20, 30],
  [0, 30],
  [0, 0],
];

/** A regular 12-gon of circumradius 40 ft, counter-clockwise. Convex on purpose:
 *  the centroid test below is only meaningful for a convex ring. */
const DODECAGON: Ring = (() => {
  const pts: Ring = [];
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * 2 * Math.PI;
    pts.push([40 * Math.cos(t), 40 * Math.sin(t)]);
  }
  pts.push([pts[0]![0]!, pts[0]![1]!]);
  return pts;
})();

const reversed = (ring: Ring): Ring => ring.slice().reverse();

// --- readers over the triangle soup, so the tests look at the real output ---

const vertexCount = (g: Extrusion) => g.positions.length / 3;
const triangleCount = (g: Extrusion) => g.indices.length / 3;

function vertex(g: Extrusion, i: number): Vec3 {
  return [g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!];
}

function normal(g: Extrusion, i: number): Vec3 {
  return [g.normals[i * 3]!, g.normals[i * 3 + 1]!, g.normals[i * 3 + 2]!];
}

function triangles(g: Extrusion): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let t = 0; t < g.indices.length; t += 3) {
    out.push([g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!]);
  }
  return out;
}

/**
 * Signed volume of the triangle soup, by the divergence theorem: each triangle
 * forms a tetrahedron with the origin and V = sum of det[v0,v1,v2]/6. Positive
 * only when the surface is closed and every face points outward, so this one
 * number catches a flipped normal, a missing cap and a wrong winding at once.
 */
function meshVolume(g: Extrusion): number {
  let v = 0;
  for (const [i0, i1, i2] of triangles(g)) {
    const a = vertex(g, i0);
    const b = vertex(g, i1);
    const c = vertex(g, i2);
    v +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  return v;
}

function triangleArea(g: Extrusion, tri: [number, number, number]): number {
  const a = vertex(g, tri[0]);
  const b = vertex(g, tri[1]);
  const c = vertex(g, tri[2]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
  return (
    Math.hypot(
      u[1] * w[2] - u[2] * w[1],
      u[2] * w[0] - u[0] * w[2],
      u[0] * w[1] - u[1] * w[0],
    ) / 2
  );
}

/**
 * Every directed edge in a closed, consistently oriented manifold appears
 * exactly once, and so does its opposite. Edges are keyed by position rather
 * than by index because faces deliberately do not share vertices.
 */
function edgeLedger(g: Extrusion) {
  const key = (i: number) => vertex(g, i).join(",");
  const directed = new Map<string, number>();
  for (const tri of triangles(g)) {
    const k = [key(tri[0]), key(tri[1]), key(tri[2])];
    for (let e = 0; e < 3; e++) {
      const d = `${k[e]}|${k[(e + 1) % 3]}`;
      directed.set(d, (directed.get(d) ?? 0) + 1);
    }
  }
  let repeated = 0;
  let unpaired = 0;
  for (const [d, count] of directed) {
    if (count !== 1) repeated++;
    const [a, b] = d.split("|");
    if ((directed.get(`${b}|${a}`) ?? 0) !== 1) unpaired++;
  }
  return { edges: directed.size, repeated, unpaired };
}

/** Crossing-number point-in-polygon on an open loop. Local so this file does
 *  not depend on collide.ts, which is being written in parallel. */
function pointInLoop(loop: Ring, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]!;
    const b = loop[j]!;
    if (
      a[1]! > y !== b[1]! > y &&
      x < ((b[0]! - a[0]!) * (y - a[1]!)) / (b[1]! - a[1]!) + a[0]!
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** The n side quads, in emission order: roof and floor take 2n vertices first. */
function sideQuads(g: Extrusion, n: number) {
  const quads: { normal: Vec3; base: number }[] = [];
  for (let e = 0; e < n; e++) {
    const base = 2 * n + e * 4;
    quads.push({ normal: normal(g, base), base });
  }
  return quads;
}

// ---------------------------------------------------------------- normalizeRing

describe("normalizeRing", () => {
  it("makes all 36 campus rings counter-clockwise, which is the bug it exists for", () => {
    // tests/data.test.ts asserts the data really is mixed: 35 clockwise, 1
    // counter-clockwise. Without this pass that one building renders black.
    expect(campus.buildings).toHaveLength(36);
    const before = campus.buildings.filter((b) => signedArea(b.ring) > 0).length;
    expect(before).toBe(1); // the defect is still present in the data

    for (const b of campus.buildings) {
      expect(signedArea(normalizeRing(b.ring)), `${b.name} winding`).toBeGreaterThan(0);
    }
  });

  it("reverses without reshaping: enclosed area is preserved exactly", () => {
    // Measured: the largest absolute discrepancy across all 37 rings is
    // 1.5e-11 sq ft, i.e. double-precision summation noise, so 1e-6 sq ft is a
    // ceiling with five orders of margin and would still catch a dropped vertex
    // (the smallest real vertex contributes 1.5e-2 sq ft).
    for (const { name, ring } of fixtures) {
      const before = Math.abs(signedArea(ring));
      const after = signedArea(normalizeRing(ring));
      expect(Math.abs(after - before), `${name} area`).toBeLessThan(1e-6);
    }
  });

  it("returns a closed ring, because signedArea needs the closing edge", () => {
    for (const { name, ring } of fixtures) {
      const r = normalizeRing(ring);
      expect(r[0], `${name} closed`).toEqual(r[r.length - 1]);
    }
  });

  it("collapses the 12 coincident vertices measured in the source data", () => {
    // 8 in Smith Campus Center, 2 in Grays Hall, 2 in Hampden Hall. A zero
    // length edge makes a zero-area quad whose normal is 0/0 = NaN, and one NaN
    // kills the draw call, so this is load-bearing rather than tidiness.
    let dropped = 0;
    for (const { ring } of fixtures) {
      const loop = normalizeRing(ring).slice(0, -1);
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        expect(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!)).toBeGreaterThan(0);
      }
    }
    for (const { ring } of fixtures) {
      const open = ring.slice(0, -1);
      for (let i = 0; i < open.length; i++) {
        const a = open[i]!;
        const b = open[(i + 1) % open.length]!;
        if (a[0] === b[0] && a[1] === b[1]) dropped++;
      }
    }
    expect(dropped).toBe(12);
  });

  it("drops vertices that lie on the straight line between their neighbours", () => {
    // Measured: 7 exactly-collinear triples survive de-duplication. Left in,
    // ear clipping emits cap triangles of 3e-14 sq ft.
    for (const { name, ring } of fixtures) {
      const loop = normalizeRing(ring).slice(0, -1);
      for (let i = 0; i < loop.length; i++) {
        const a = loop[(i + loop.length - 1) % loop.length]!;
        const b = loop[i]!;
        const c = loop[(i + 1) % loop.length]!;
        const twiceArea =
          (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
        const forward =
          (b[0]! - a[0]!) * (c[0]! - b[0]!) + (b[1]! - a[1]!) * (c[1]! - b[1]!);
        // A straight-through collinear vertex must be gone. A doubling-back one
        // is allowed to stay: removing it would delete a spike, not a no-op.
        expect(
          Math.abs(twiceArea) > 1e-6 || forward <= 0,
          `${name} vertex ${i} is a redundant collinear point`,
        ).toBe(true);
      }
    }
  });

  it("sends a ring and its reversal to the same loop", () => {
    const a = normalizeRing(RECT);
    const b = normalizeRing(reversed(RECT));
    expect(signedArea(a)).toBeCloseTo(600, 9);
    expect(signedArea(b)).toBeCloseTo(600, 9);
    // Same cycle, possibly rotated. Compare as sorted vertex sets plus area.
    const asSet = (r: Ring) =>
      r
        .slice(0, -1)
        .map((p) => `${p[0]!},${p[1]!}`)
        .sort();
    expect(asSet(a)).toEqual(asSet(b));
  });

  it("does not mutate its input", () => {
    const cw = reversed(RECT);
    const snapshot = JSON.stringify(cw);
    normalizeRing(cw);
    expect(JSON.stringify(cw)).toBe(snapshot);
  });

  it("refuses a ring that encloses nothing", () => {
    expect(() => normalizeRing([[0, 0], [5, 5], [0, 0]])).toThrow(/collapses/);
  });

  it("identifies exactly the two ArcGIS rings that are not simple polygons", () => {
    // Guards the exclusion list used by the watertight and outward-normal tests
    // below. If the data is refetched and these are fixed, or a third appears,
    // this fails and the exclusions get revisited.
    expect(nonSimple.map((f) => f.name).sort()).toEqual([
      "Hampden Hall",
      "Smith Campus Center",
    ]);
    expect(simple).toHaveLength(35);
  });
});

// ------------------------------------------------------------ counts and shape

describe("extrude emits exactly the triangles the ring implies", () => {
  it("matches 6n vertices, 4n-4 triangles and 12n-12 indices on every ring", () => {
    for (const { name, ring, height } of fixtures) {
      const n = normalizeRing(ring).length - 1;
      const g = extrude(ring, height);
      expect(vertexCount(g), `${name} vertices`).toBe(6 * n);
      expect(g.normals.length, `${name} normals`).toBe(g.positions.length);
      expect(g.indices.length, `${name} indices`).toBe(12 * n - 12);
      expect(triangleCount(g), `${name} triangles`).toBe(4 * n - 4);
      // Nothing may index past the end of the position buffer.
      for (const i of g.indices) expect(i).toBeLessThan(6 * n);
    }
  });

  it("puts 24 vertices and 12 triangles on a box, checked by hand", () => {
    // n = 4: 4 roof + 4 floor + 16 wall vertices; 2 + 2 + 8 triangles.
    const g = extrude(RECT, 10);
    expect(vertexCount(g)).toBe(24);
    expect(triangleCount(g)).toBe(12);
    expect(g.indices.length).toBe(36);
  });

  it("emits no degenerate triangle anywhere", () => {
    // Both bounds measured, and the gap between them is narrower than it looks.
    //
    //   1.5e-2 sq ft  smallest genuine triangle across all 37 rings, a cap
    //                 sliver in Smith Campus Center
    //   3.8e-5 sq ft  smallest triangle once normalizeRing stops removing
    //                 collinear vertices, i.e. the bug this is here to catch
    //
    // 1e-3 sits 15x under the first and 26x over the second. The obvious
    // "anything above zero" threshold does NOT work: the offending cap triangle
    // is 3e-14 sq ft in double precision, but quantising its corners onto the
    // Float32 grid (2.4e-5 ft at the worst coordinate, 649.6 ft) inflates it to
    // 3.8e-5, so a threshold below that is measurably unable to fail.
    for (const { name, ring, height } of fixtures) {
      const g = extrude(ring, height);
      let smallest = Infinity;
      for (const tri of triangles(g)) {
        smallest = Math.min(smallest, triangleArea(g, tri));
      }
      expect(smallest, `${name} smallest triangle`).toBeGreaterThan(1e-3);
    }
  });

  it("spans exactly base to base+height and nothing outside it", () => {
    const g = extrude(weldRing, 25.4, 60);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < vertexCount(g); i++) {
      const y = vertex(g, i)[1];
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    // Weld's eaves at 60.0 ft and ridge at 85.4 ft, audit section 2a.
    expect(lo).toBeCloseTo(60, 4);
    expect(hi).toBeCloseTo(85.4, 4);
  });

  it("refuses a non-positive height rather than emitting flat quads", () => {
    expect(() => extrude(RECT, 0)).toThrow(/height must be positive/);
    expect(() => extrude(RECT, -5)).toThrow(/height must be positive/);
  });
});

// -------------------------------------------------------- the divergence check

describe("signed volume equals footprint area x height", () => {
  /**
   * The strongest single check available. Expected volume is computed from
   * frames.signedArea on the raw ring, so it shares no code with extrude.
   *
   * Tolerance: the spec asks for 0.5%. Measured worst case across all 37 rings
   * is 3.6e-7 relative (Holworthy Hall), which is Float32 position rounding, so
   * 0.5% carries roughly 14,000x margin. Any flipped face, missing cap or
   * unnormalised winding moves this by tens of percent at least.
   */
  const TOLERANCE = 0.005;

  it("holds for all 36 campus buildings", () => {
    for (const { name, ring, height } of fixtures) {
      const want = Math.abs(signedArea(ring)) * height;
      const got = meshVolume(extrude(ring, height));
      expect(Math.abs(got - want) / want, `${name} volume`).toBeLessThan(TOLERANCE);
      expect(got, `${name} volume sign`).toBeGreaterThan(0);
    }
  });

  it("holds for Weld's real 59-point ring at its published height", () => {
    // 7,779.62 sq ft footprint (tests/data.test.ts) x 87.01 ft = 676,904.7 cu ft.
    const want = 7779.62 * 87.01;
    const got = meshVolume(extrude(weldRing, weld.meta.height_ft));
    expect(got / want).toBeCloseTo(1, 5);
    expect(got).toBeCloseTo(676_904.7, -1);
  });

  it("is unaffected by where the base sits", () => {
    // The floor cap is what makes this true. Without it the tetrahedron sum only
    // happens to be right when the missing face lies in the plane y = 0.
    const want = Math.abs(signedArea(weldRing)) * 60;
    for (const base of [0, -13, 25.5, 100]) {
      const got = meshVolume(extrude(weldRing, 60, base));
      expect(Math.abs(got - want) / want, `base ${base}`).toBeLessThan(TOLERANCE);
    }
  });

  it("gives a clockwise ring the same positive volume as its reversal", () => {
    // The 1-in-36 case, isolated. Both must land on 20 x 30 x 10 = 6,000 cu ft.
    expect(signedArea(RECT)).toBeGreaterThan(0);
    expect(signedArea(reversed(RECT))).toBeLessThan(0);
    expect(meshVolume(extrude(RECT, 10))).toBeCloseTo(6000, 3);
    expect(meshVolume(extrude(reversed(RECT), 10))).toBeCloseTo(6000, 3);
  });

  it("gives every campus ring the same volume as its reversal", () => {
    for (const { name, ring, height } of fixtures) {
      const a = meshVolume(extrude(ring, height));
      const b = meshVolume(extrude(reversed(ring), height));
      expect(b / a, `${name} reversed`).toBeCloseTo(1, 6);
    }
  });
});

// -------------------------------------------------------------------- normals

describe("normals", () => {
  it("are unit length everywhere", () => {
    for (const { name, ring, height } of fixtures) {
      const g = extrude(ring, height);
      for (let i = 0; i < vertexCount(g); i++) {
        const [x, y, z] = normal(g, i);
        // Float32 unit vectors: measured error stays under 1e-7.
        expect(Math.hypot(x, y, z), `${name} normal ${i}`).toBeCloseTo(1, 6);
      }
    }
  });

  it("points the roof up and the floor down", () => {
    for (const { name, ring, height } of fixtures) {
      const n = normalizeRing(ring).length - 1;
      const g = extrude(ring, height);
      for (let i = 0; i < n; i++) {
        expect(normal(g, i), `${name} roof normal ${i}`).toEqual([0, 1, 0]);
      }
      for (let i = n; i < 2 * n; i++) {
        expect(normal(g, i), `${name} floor normal ${i}`).toEqual([0, -1, 0]);
      }
    }
  });

  it("keeps every side normal horizontal and square to its own wall", () => {
    for (const { name, ring, height } of fixtures) {
      const loop = normalizeRing(ring).slice(0, -1);
      const n = loop.length;
      const g = extrude(ring, height);
      for (const [e, quad] of sideQuads(g, n).entries()) {
        const a = loop[e]!;
        const b = loop[(e + 1) % n]!;
        const site = fromThree(quad.normal);
        expect(site.z, `${name} wall ${e} tilts`).toBeCloseTo(0, 9);
        const along =
          site.x * (b[0]! - a[0]!) + site.y * (b[1]! - a[1]!);
        expect(along, `${name} wall ${e} not perpendicular`).toBeCloseTo(0, 4);
      }
    }
  });

  it("points every side normal away from the centroid, on convex rings", () => {
    // Only stated for convex rings, and deliberately so. 19 of the 37 real
    // rings are non-convex -- Weld is a dumbbell with two projecting wing zones
    // and a narrow waist (audit section 2a) -- and on a dumbbell the wing's
    // inward-facing end wall legitimately points back at the centroid. Measured:
    // that test fails on 4 of Weld's 56 walls for purely geometric reasons. The
    // real rings get the stronger check in the next test instead.
    for (const [label, ring] of [["rectangle", RECT], ["dodecagon", DODECAGON]] as const) {
      for (const r of [ring, reversed(ring)]) {
        const loop = normalizeRing(r).slice(0, -1);
        const n = loop.length;
        const cx = loop.reduce((s, p) => s + p[0]!, 0) / n;
        const cy = loop.reduce((s, p) => s + p[1]!, 0) / n;
        const g = extrude(r, 12);
        for (const [e, quad] of sideQuads(g, n).entries()) {
          const a = loop[e]!;
          const b = loop[(e + 1) % n]!;
          const site = fromThree(quad.normal);
          const dot =
            site.x * ((a[0]! + b[0]!) / 2 - cx) +
            site.y * ((a[1]! + b[1]!) / 2 - cy);
          expect(dot, `${label} wall ${e} faces inward`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("steps every side normal out of the footprint, on every simple real ring", () => {
    // The non-convex generalisation of "points away from the centroid": stepping
    // off the middle of a wall along its normal must leave the polygon, and
    // stepping the other way must stay inside. Catches a flipped wall on a
    // dumbbell, which the centroid test cannot.
    //
    // Probe distance 0.001 ft: the shortest edge in the data is 0.1 ft, so the
    // probe stays well inside its own face, and it is 40x the worst Float32
    // coordinate rounding (2.4e-5 ft at 649.6 ft). Measured: zero failures
    // across 35 rings and 698 walls, and every failure at any probe distance
    // from 1e-4 to 0.02 ft was in one of the two non-simple rings.
    const PROBE = 0.001;
    let walls = 0;
    for (const { key: name, ring, height } of simple) {
      const loop = normalizeRing(ring).slice(0, -1);
      const n = loop.length;
      const g = extrude(ring, height);
      for (const [e, quad] of sideQuads(g, n).entries()) {
        const a = loop[e]!;
        const b = loop[(e + 1) % n]!;
        const mx = (a[0]! + b[0]!) / 2;
        const my = (a[1]! + b[1]!) / 2;
        const site = fromThree(quad.normal);
        walls++;
        expect(
          pointInLoop(loop, mx + site.x * PROBE, my + site.y * PROBE),
          `${name} wall ${e}: outward probe landed inside`,
        ).toBe(false);
        expect(
          pointInLoop(loop, mx - site.x * PROBE, my - site.y * PROBE),
          `${name} wall ${e}: inward probe landed outside`,
        ).toBe(true);
      }
    }
    expect(walls).toBe(698);
  });
});

// ----------------------------------------------------------------- watertight

describe("watertight", () => {
  it("closes Weld's real 59-point footprint", () => {
    // 59 closed points normalise to 56 distinct vertices: 2 straight-through
    // collinear ones removed, plus the closing duplicate.
    const loop = normalizeRing(weldRing);
    expect(weldRing).toHaveLength(59);
    expect(loop).toHaveLength(57);

    const g = extrude(weldRing, weld.meta.height_ft);
    const { edges, repeated, unpaired } = edgeLedger(g);
    expect(repeated).toBe(0); // no directed edge used twice
    expect(unpaired).toBe(0); // every directed edge has its opposite
    // 4n-4 = 220 triangles x 3 directed edges, all distinct.
    expect(edges).toBe(3 * (4 * 56 - 4));
  });

  it("closes every simple campus ring, at any base", () => {
    for (const { name, ring, height } of simple) {
      for (const base of [0, -13]) {
        const { repeated, unpaired } = edgeLedger(extrude(ring, height, base));
        expect(repeated, `${name} base ${base} repeated edge`).toBe(0);
        expect(unpaired, `${name} base ${base} unpaired edge`).toBe(0);
      }
    }
  });

  it("closes a box, counted by hand", () => {
    const g = extrude(RECT, 10);
    // 12 triangles x 3 = 36 directed edges, 18 undirected, each used both ways.
    expect(edgeLedger(g)).toEqual({ edges: 36, repeated: 0, unpaired: 0 });
  });
});
