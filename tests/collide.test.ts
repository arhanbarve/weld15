import { describe, it, expect } from "vitest";
import weld from "@/data/weld.json";
import { buildSuite, type Rect } from "@/geo/rooms";
import { ringBounds, signedArea } from "@/geo/frames";
import {
  GRID,
  WALL_SNAP,
  type Box,
  overlaps,
  pointInPolygon,
  containedBy,
  snapToGrid,
  snapToWalls,
  footprintOf,
  placeIsLegal,
} from "@/geo/collide";

const suite = buildSuite();
const room = (id: string): Rect => {
  const r = suite.rooms.find((x) => x.id === id);
  if (!r) throw new Error(`no room ${id}`);
  return r;
};

/** Bedroom A at the defaults: 16 ft deep by 10 ft along the hall, at v = 15.5. */
const bedA = room("bedA");

/**
 * Harvard's dorm mattress is an extra-long twin, 38 x 80 inches. Kept as exact
 * twelfths rather than the rounded 3.17 x 6.67 so that flush placements come out
 * exactly flush and the "touching is legal" rule is tested on real arithmetic.
 */
const MAT_W = 38 / 12; // 3.1666...
const MAT_L = 80 / 12; // 6.6666...
const mattress = (u: number, v: number, rot?: 0 | 90 | 180 | 270): Box => ({
  u,
  v,
  du: MAT_W,
  dv: MAT_L,
  rot,
});

/** Same deterministic pseudo-random generator style as tests/rooms.test.ts. */
const makeRnd = (seed0: number) => {
  let seed = seed0;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
};

const ring = weld.rings[0] as number[][];

describe("overlaps", () => {
  it("is symmetric, over a sweep that produces both answers", () => {
    const rnd = makeRnd(20260729);
    let hits = 0;
    let misses = 0;
    for (let i = 0; i < 400; i++) {
      const rots: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];
      const box = (): Box => ({
        u: rnd() * 10,
        v: rnd() * 10,
        du: 0.5 + rnd() * 4,
        dv: 0.5 + rnd() * 4,
        rot: rots[Math.floor(rnd() * 4)]!,
      });
      const a = box();
      const b = box();
      const ab = overlaps(a, b);
      expect(overlaps(b, a), `iteration ${i}`).toBe(ab);
      if (ab) hits++;
      else misses++;
    }
    // Guard against a vacuous sweep: the symmetry claim is only worth anything
    // if both branches were exercised. Measured at this seed: 67 overlapping,
    // 333 clear. Bounds set well under those, but the generator is deterministic
    // so they cannot drift.
    expect(hits).toBeGreaterThan(25);
    expect(misses).toBeGreaterThan(100);
  });

  it("does not call two mattresses pushed flush together an overlap", () => {
    // The shared edge is exact: 15.5 + 38/12 is the same double on both sides,
    // so the measured shared extent is 0.0, not merely small.
    const a = mattress(0, bedA.v, 90);
    const fa = footprintOf(a);
    const b = mattress(0, fa.v + fa.dv, 90);
    const fb = footprintOf(b);
    const sharedV = Math.min(fa.v + fa.dv, fb.v + fb.dv) - Math.max(fa.v, fb.v);
    expect(sharedV).toBe(0);
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(b, a)).toBe(false);
  });

  it("counts a box wholly inside another as an overlap, both ways round", () => {
    const big: Box = { u: 0, v: 0, du: 10, dv: 10 };
    const small: Box = { u: 3, v: 3, du: 2, dv: 2 };
    expect(overlaps(big, small)).toBe(true);
    expect(overlaps(small, big)).toBe(true);
  });

  it("sees a collision only once rotation swings a piece into the other", () => {
    // Two mattresses in a line along u. Unrotated they are 3.17 ft wide in u and
    // clear each other; turned broadside the first spans 6.67 ft and reaches in.
    const a = mattress(0, 0);
    const b = mattress(4, 0);
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps({ ...a, rot: 90 }, b)).toBe(true);
  });

  it("honours the epsilon argument", () => {
    const a: Box = { u: 0, v: 0, du: 2, dv: 2 };
    const b: Box = { u: 1.9, v: 0, du: 2, dv: 2 }; // 0.1 ft of shared floor
    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(a, b, 0.2)).toBe(false); // slack wider than the overlap
  });
});

describe("footprintOf", () => {
  it("swaps du and dv for quarter turns and leaves them alone otherwise", () => {
    const b: Box = { u: 1, v: 2, du: 3, dv: 7 };
    expect(footprintOf({ ...b, rot: 0 })).toMatchObject({ du: 3, dv: 7 });
    expect(footprintOf(b)).toMatchObject({ du: 3, dv: 7 }); // rot undefined = 0
    expect(footprintOf({ ...b, rot: 180 })).toMatchObject({ du: 3, dv: 7 });
    expect(footprintOf({ ...b, rot: 90 })).toMatchObject({ du: 7, dv: 3 });
    expect(footprintOf({ ...b, rot: 270 })).toMatchObject({ du: 7, dv: 3 });
  });

  it("keeps the anchor and the area, and is idempotent", () => {
    const b: Box = { u: 1, v: 2, du: MAT_W, dv: MAT_L, rot: 90 };
    const f = footprintOf(b);
    expect(f.u).toBe(1);
    expect(f.v).toBe(2);
    expect(f.du * f.dv).toBeCloseTo(MAT_W * MAT_L, 12);
    expect(footprintOf(f)).toEqual(f);
    expect(f.rot).toBe(0);
  });
});

describe("pointInPolygon on Weld's real footprint", () => {
  it("has the fixture this suite assumes: 59 points, closed ring", () => {
    expect(ring.length).toBe(59);
    expect(ring[0]).toEqual(ring[58]);
  });

  /** Area centroid, from the shoelace moments. Uses frames.ts for the area. */
  const area = signedArea(ring);
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    const cross = a[0]! * b[1]! - b[0]! * a[1]!;
    cx += (a[0]! + b[0]!) * cross;
    cy += (a[1]! + b[1]!) * cross;
  }
  cx /= 6 * area;
  cy /= 6 * area;
  const centroid: [number, number] = [cx, cy];
  const bounds = ringBounds(ring);
  const winding = Math.sign(area);

  it("puts the centroid inside", () => {
    expect(pointInPolygon(centroid, ring)).toBe(true);
    // And independently corroborates frames.ts's claim that the site origin IS
    // Weld's centroid: the shoelace centroid lands 0.98 ft from (0, 0).
    expect(Math.hypot(cx, cy)).toBeLessThan(1.5);
  });

  it("puts a point 200 ft away outside, in every direction", () => {
    // Weld's bounding box is 82.8 x 150.9 ft, so 200 ft from the centroid clears
    // it on every heading.
    for (let k = 0; k < 8; k++) {
      const th = (k * Math.PI) / 4;
      const p: [number, number] = [cx + 200 * Math.cos(th), cy + 200 * Math.sin(th)];
      expect(pointInPolygon(p, ring), `heading ${k}`).toBe(false);
    }
  });

  it("separates just-inside from just-outside at all 58 edges", () => {
    // A quarter foot, chosen against the measured shortest edge of 1.118 ft: an
    // offset that small cannot tunnel across a thin feature to the far side.
    const lengths = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      lengths.push(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!));
    }
    expect(Math.min(...lengths)).toBeCloseTo(1.118, 3);

    const d = 0.25;
    let tested = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i]!;
      const b = ring[i + 1]!;
      const ex = b[0]! - a[0]!;
      const ey = b[1]! - a[1]!;
      const len = Math.hypot(ex, ey);
      if (len === 0) continue; // the repeated closing vertex
      // Left normal of the edge direction points into a counter-clockwise ring;
      // Weld's ring is clockwise in the y-north site frame (signedArea < 0), so
      // the winding sign is what fixes "inward" rather than a guess.
      const nx = (-ey / len) * winding;
      const ny = (ex / len) * winding;
      const mx = (a[0]! + b[0]!) / 2;
      const my = (a[1]! + b[1]!) / 2;
      expect(pointInPolygon([mx + nx * d, my + ny * d], ring), `inside edge ${i}`).toBe(true);
      expect(pointInPolygon([mx - nx * d, my - ny * d], ring), `outside edge ${i}`).toBe(false);
      tested++;
    }
    expect(tested).toBe(58);
  });

  it("gets the vertex-degenerate rays right, which is where ray casting breaks", () => {
    /**
     * A horizontal ray whose y is exactly a vertex's y hits two edges at one
     * point; an implementation that counts both flips parity twice and reports
     * the wrong answer. Weld's ring is quantised to a tenth of a foot, so this
     * is the common case, not a corner case: 58 probes share a vertex's y
     * exactly.
     *
     * The oracle is a genuinely different implementation -- crossing count along
     * a ray at 0.5 radians, which no vertex of this ring lies on. The test also
     * proves the oracle is not itself degenerate: the closest any of these rays
     * passes to a vertex is 0.0081 in edge-parameter units.
     */
    const obliqueRay = (px: number, py: number): { inside: boolean; margin: number } => {
      const dx = Math.cos(0.5);
      const dy = Math.sin(0.5);
      let crossings = 0;
      let margin = 1;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i]!;
        const b = ring[i + 1]!;
        const ex = b[0]! - a[0]!;
        const ey = b[1]! - a[1]!;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue; // ray parallel to the edge
        const ax = a[0]! - px;
        const ay = a[1]! - py;
        const t = (ax * ey - ay * ex) / den; // along the ray
        const s = (ax * dy - ay * dx) / den; // along the edge, wanted in [0, 1)
        if (t <= 0) continue;
        margin = Math.min(margin, Math.abs(s), Math.abs(s - 1));
        if (s >= 0 && s < 1) crossings++;
      }
      return { inside: crossings % 2 === 1, margin };
    };

    let worstMargin = 1;
    let insideCount = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const vy = ring[i]![1]!;
      // Two probes per vertex, both on that vertex's exact y: one on the
      // building's mid-width line, one well west of the whole footprint.
      const probes: [number, number][] = [
        [cx, vy],
        [bounds.minX - 10, vy],
      ];
      for (const p of probes) {
        const o = obliqueRay(p[0], p[1]);
        worstMargin = Math.min(worstMargin, o.margin);
        expect(pointInPolygon(p, ring), `vertex ${i} probe ${p[0]},${p[1]}`).toBe(o.inside);
        if (o.inside) insideCount++;
      }
    }
    expect(worstMargin).toBeGreaterThan(1e-3);
    // Non-vacuity: the 116 probes are not all one answer. Measured: 54 of the 58
    // mid-width probes are inside (four sit beyond the narrowing gable tips) and
    // none of the 58 far-west probes are, which is exactly the double-count trap
    // -- a ray from outside crosses each of those vertices and must still come
    // back even.
    expect(insideCount).toBe(54);
  });

  it("recovers the footprint area by Monte Carlo, which no inverted test could", () => {
    const rnd = makeRnd(20260729);
    const N = 20000;
    let hits = 0;
    for (let i = 0; i < N; i++) {
      const px = bounds.minX + rnd() * bounds.width;
      const py = bounds.minY + rnd() * bounds.height;
      if (pointInPolygon([px, py], ring)) hits++;
    }
    const boxArea = bounds.width * bounds.height;
    const estimate = (hits / N) * boxArea;
    const truth = Math.abs(area);
    // Measured relative error at this seed and N: -0.175%. The bound is set at
    // 0.5%, which is loose enough for the sampling noise and far tighter than
    // any of the failure modes: always-inside gives +60.6% (the whole 12,494
    // sq ft box), always-outside -100%, and an inverted test -39.4%.
    expect(Math.abs(estimate - truth) / truth).toBeLessThan(0.005);
    expect(truth).toBeCloseTo(7779.6, 0);
  });
});

describe("containedBy", () => {
  it("accepts a piece exactly filling the room, flush on all four walls", () => {
    expect(containedBy({ u: bedA.u, v: bedA.v, du: bedA.du, dv: bedA.dv }, bedA)).toBe(true);
  });

  it("rejects a piece larger than the room", () => {
    expect(containedBy({ u: bedA.u, v: bedA.v, du: bedA.du + 1, dv: bedA.dv }, bedA)).toBe(false);
    expect(containedBy({ u: bedA.u, v: bedA.v, du: 12, dv: 12 }, bedA)).toBe(false);
  });

  it("rejects a piece hanging over each of the four edges in turn", () => {
    const inside: Box = { u: 6, v: 19, du: 4, dv: 4 };
    expect(containedBy(inside, bedA)).toBe(true);
    expect(containedBy({ ...inside, u: -0.5 }, bedA)).toBe(false); // through the facade
    expect(containedBy({ ...inside, u: 13 }, bedA)).toBe(false); // 17 > 16, into the hall
    expect(containedBy({ ...inside, v: 15 }, bedA)).toBe(false); // south partition
    expect(containedBy({ ...inside, v: 22 }, bedA)).toBe(false); // 26 > 25.5, north
  });

  it("measures the rotated extent, not the stored one", () => {
    const m = mattress(12, bedA.v);
    expect(containedBy(m, bedA)).toBe(true); // 3.17 ft of u left at u = 12
    expect(containedBy({ ...m, rot: 90 }, bedA)).toBe(false); // needs 6.67, has 4
  });
});

describe("snapToGrid", () => {
  it("puts every room edge in the default suite on the grid, which is why 0.5 ft", () => {
    // If this ever fails, grid snap can no longer reach flush contact and the
    // 0.5 ft choice documented in collide.ts stops being justified.
    for (const r of suite.rooms) {
      for (const e of [r.u, r.v, r.u + r.du, r.v + r.dv]) {
        expect(Math.abs(e / GRID - Math.round(e / GRID)), `${r.id} edge ${e}`).toBeLessThan(1e-12);
      }
    }
    expect(GRID).toBe(0.5);
  });

  it("rounds the anchor to the nearest half foot and leaves size and rotation alone", () => {
    const snapped = snapToGrid({ u: 1.23, v: 15.9, du: MAT_W, dv: MAT_L, rot: 90 });
    expect(snapped.u).toBe(1);
    expect(snapped.v).toBe(16);
    expect(snapped.du).toBe(MAT_W); // a 38 inch mattress stays 38 inches
    expect(snapped.dv).toBe(MAT_L);
    expect(snapped.rot).toBe(90);
  });

  it("takes a coarser grid when asked", () => {
    expect(snapToGrid({ u: 1.3, v: 0, du: 1, dv: 1 }, 1).u).toBe(1);
    expect(snapToGrid({ u: 1.3, v: 0, du: 1, dv: 1 }).u).toBe(1.5);
  });

  it("can push an overhanging piece further out, which is why wall snap runs after", () => {
    // Documented in collide.ts. -0.3 ft rounds away from the wall, not to it.
    expect(snapToGrid({ u: -0.3, v: 20, du: 2, dv: 2 }).u).toBe(-0.5);
  });
});

describe("snapToWalls", () => {
  const flushCases: [string, Box, "u" | "v", number][] = [
    ["facade wall at u = 0", mattress(0.4, 19, 90), "u", 0],
    ["hall wall at u = 16", mattress(16 - MAT_L - 0.4, 19, 90), "u", 16 - MAT_L],
    ["south partition at v = 15.5", mattress(8, 15.9, 90), "v", 15.5],
    ["north partition at v = 25.5", mattress(8, 25.5 - MAT_W - 0.5, 90), "v", 25.5 - MAT_W],
  ];

  for (const [name, box, axis, want] of flushCases) {
    it(`pulls a piece flush to the ${name}`, () => {
      const out = snapToWalls(box, bedA);
      expect(out[axis]).toBeCloseTo(want, 12);
      const f = footprintOf(out);
      // Flush means zero clearance against that wall, measured either side.
      const gap =
        axis === "u"
          ? Math.min(f.u - bedA.u, bedA.u + bedA.du - (f.u + f.du))
          : Math.min(f.v - bedA.v, bedA.v + bedA.dv - (f.v + f.dv));
      expect(gap).toBeCloseTo(0, 12);
      expect(containedBy(out, bedA)).toBe(true);
      expect(out.rot).toBe(90);
      expect(out.du).toBe(MAT_W);
    });
  }

  it("leaves a piece alone in the middle of the room", () => {
    const m = mattress(8, 20, 90);
    expect(snapToWalls(m, bedA)).toEqual(m);
  });

  it("does not reach past its threshold", () => {
    // 1.5 ft from the facade is more than the 1 ft catchment, so it stays put.
    const m = mattress(1.5, 20, 90);
    expect(snapToWalls(m, bedA).u).toBe(1.5);
    expect(WALL_SNAP).toBe(1);
    // ... but a wider catchment does pick it up.
    expect(snapToWalls(m, bedA, 2).u).toBe(0);
  });

  it("pulls a piece that is part way into the wall back out flush", () => {
    const m = mattress(-0.3, 15.2, 90);
    expect(containedBy(m, bedA)).toBe(false);
    const out = snapToWalls(m, bedA);
    expect(out.u).toBe(0);
    expect(out.v).toBe(15.5);
    expect(containedBy(out, bedA)).toBe(true);
  });

  it("never moves a piece that fitted into a position that does not", () => {
    const rnd = makeRnd(31415926);
    const rots: (0 | 90 | 180 | 270)[] = [0, 90, 180, 270];
    let moved = 0;
    for (let i = 0; i < 400; i++) {
      const rot = rots[Math.floor(rnd() * 4)]!;
      const probe: Box = { u: 0, v: 0, du: 1 + rnd() * 6, dv: 1 + rnd() * 6, rot };
      const f = footprintOf(probe);
      // Sizes are capped at 7 ft so every box fits Bedroom A's 16 x 10 somewhere.
      expect(f.du, `iteration ${i}`).toBeLessThanOrEqual(bedA.du);
      expect(f.dv, `iteration ${i}`).toBeLessThanOrEqual(bedA.dv);
      const box: Box = {
        ...probe,
        u: bedA.u + rnd() * (bedA.du - f.du),
        v: bedA.v + rnd() * (bedA.dv - f.dv),
      };
      expect(containedBy(box, bedA), `iteration ${i} setup`).toBe(true);
      const out = snapToWalls(box, bedA);
      expect(containedBy(out, bedA), `iteration ${i}`).toBe(true);
      if (out.u !== box.u || out.v !== box.v) moved++;
    }
    // Non-vacuity: the invariant is only interesting if snapping actually moved
    // things. Measured at this seed: 170 of the 400 boxes were pulled to a wall.
    expect(moved).toBeGreaterThan(100);
  });
});

describe("placeIsLegal", () => {
  it("returns no reason when the placement is fine", () => {
    const r = placeIsLegal(mattress(0, bedA.v, 90), bedA, []);
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
  });

  it("gives the UI a usable reason for each way a placement can fail", () => {
    const tooBig = placeIsLegal({ u: 0, v: bedA.v, du: 12, dv: 12 }, bedA, []);
    const overhang = placeIsLegal(mattress(13, bedA.v, 90), bedA, []);
    const collide = placeIsLegal(mattress(0, 17, 90), bedA, [mattress(0, bedA.v, 90)]);

    for (const [what, r] of [
      ["too big", tooBig],
      ["overhang", overhang],
      ["collide", collide],
    ] as const) {
      expect(r.ok, what).toBe(false);
      expect(r.reason, what).toBeTruthy();
      // The reason is shown next to the drag ghost, so it has to name the room.
      expect(r.reason, what).toContain("Bedroom A");
    }

    expect(tooBig.reason).toBe(
      "Too big for Bedroom A: needs 12 x 12 ft, the room is 16 x 10 ft",
    );
    expect(overhang.reason).toBe("Sticks out through the Bedroom A wall");
    expect(collide.reason).toBe("Overlaps something already in Bedroom A");
    // Three distinct messages, because the three fixes are different.
    expect(new Set([tooBig.reason, overhang.reason, collide.reason]).size).toBe(3);
  });

  it("reports the piece's rotated size in the too-big message", () => {
    // A 3.17 x 12 ft plank fits Bedroom A's 16 ft depth turned but not upright.
    const plank: Box = { u: 0, v: bedA.v, du: MAT_W, dv: 12 };
    expect(placeIsLegal({ ...plank, rot: 90 }, bedA, []).ok).toBe(true);
    expect(placeIsLegal(plank, bedA, []).reason).toBe(
      "Too big for Bedroom A: needs 3.2 x 12 ft, the room is 16 x 10 ft",
    );
  });
});

describe("two Harvard mattresses in Bedroom A", () => {
  // 38 x 80 in, Harvard's published dorm mattress, in a room that buildSuite()
  // makes 16 x 10 ft from the resident's stated "10 x 16".
  it("has the room this test assumes", () => {
    expect([bedA.du, bedA.dv]).toEqual([16, 10]);
    expect(bedA.v).toBe(15.5);
    expect(MAT_W * MAT_L).toBeCloseTo(21.111, 3);
  });

  it("fits two of them legally, side by side and flush, when both are turned", () => {
    // Head to the facade wall, which is where the windows are: each mattress
    // then spans 6.67 ft of the room's 16 ft depth and 3.17 ft of its 10 ft run.
    const first = mattress(0, bedA.v, 90);
    const f1 = footprintOf(first);
    const second = mattress(0, f1.v + f1.dv, 90);

    expect(placeIsLegal(first, bedA, [])).toEqual({ ok: true });
    expect(placeIsLegal(second, bedA, [first])).toEqual({ ok: true });
    expect(containedBy(first, bedA)).toBe(true);
    expect(containedBy(second, bedA)).toBe(true);
    expect(overlaps(first, second)).toBe(false);

    // Flush, and with 3.67 ft of the along-hall run still spare.
    expect(second.v).toBeCloseTo(18.6667, 4);
    const used = 2 * MAT_W;
    expect(used).toBeCloseTo(6.3333, 4);
    expect(bedA.dv - used).toBeCloseTo(3.6667, 4);

    // Both survive the snapping the drop handler applies, still legal.
    for (const m of [first, second]) {
      const dropped = snapToWalls(snapToGrid(m), bedA);
      expect(placeIsLegal(dropped, bedA, []).ok).toBe(true);
    }
  });

  it("rejects a third mattress laid across the first two", () => {
    const first = mattress(0, bedA.v, 90);
    const f1 = footprintOf(first);
    const second = mattress(0, f1.v + f1.dv, 90);
    const third = mattress(0, 17, 90); // 1.5 ft up the first, so it clips both

    // The third is inside the room; the only thing wrong with it is the clash.
    expect(containedBy(third, bedA)).toBe(true);
    expect(overlaps(third, first)).toBe(true);
    expect(overlaps(third, second)).toBe(true);
    // Real, visible overlaps rather than float dust: 1.667 ft and 1.500 ft.
    const f3 = footprintOf(third);
    const f2 = footprintOf(second);
    expect(Math.min(f1.v + f1.dv, f3.v + f3.dv) - Math.max(f1.v, f3.v)).toBeCloseTo(1.6667, 4);
    expect(Math.min(f2.v + f2.dv, f3.v + f3.dv) - Math.max(f2.v, f3.v)).toBeCloseTo(1.5, 4);

    const r = placeIsLegal(third, bedA, [first, second]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("Overlaps something already in Bedroom A");
  });

  it("only fits two because they are turned: upright, the 10 ft run holds one", () => {
    // This is what rotation is for. Unrotated a mattress eats 6.67 ft of the
    // 10 ft along-hall run, so a second stacked beyond it runs 3.33 ft past the
    // north partition.
    const first = mattress(0, bedA.v);
    const second = mattress(0, bedA.v + MAT_L);
    expect(containedBy(first, bedA)).toBe(true);
    expect(containedBy(second, bedA)).toBe(false);
    expect(second.v + MAT_L - (bedA.v + bedA.dv)).toBeCloseTo(3.3333, 4);
    expect(placeIsLegal(second, bedA, [first]).reason).toBe(
      "Sticks out through the Bedroom A wall",
    );
  });
});
