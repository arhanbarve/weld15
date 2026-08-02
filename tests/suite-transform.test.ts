import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildSuite, DEFAULT_PARAMS, type Rect } from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import { suiteToThree, floorLevel } from "@/geo/place";
import { suiteBasis, rectCentre, doorLeafSlabs, type Slab } from "@/scene/Suite";
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

/**
 * doorLeafSlabs() places a CHIRAL, rotated box -- unlike every other Slab this
 * file's other describe block checks, which are all axis-aligned and so
 * cannot expose a rotation-composition mistake. P14 row 2's placement math
 * needed a real derivation (see Suite.tsx's own doc on `doorLeafSlabs()` for
 * why alongV bands need an extra -90 degrees, and why the high-side room
 * needs `turn` negated), and hand algebra on a 3D rotation composed with a
 * suite-yaw is exactly the kind of thing that can be right on paper and wrong
 * on screen -- confirmed the hard way: an earlier version of this test tried
 * to check the result by converting back to SUITE (u, v) through fromThree(),
 * which undoes only the site<->world step and left every point in SITE
 * (east/north) coordinates instead, comparing them against room rects that
 * are in a different frame entirely. Numbers a hundred feet off is what that
 * looked like, and it would have looked like a real bug in doorLeafSlabs()
 * rather than in the test.
 *
 * So this stays in WORLD space throughout -- the one frame every quantity
 * below is unambiguously already in, since suiteToThree() and slabGeometry()
 * both produce it directly and neither needs to be inverted. A room's
 * footprint becomes a world-space quadrilateral (its four corners run
 * through the SAME suiteToThree() every Slab uses) and pointInPolygon() --
 * already trusted by the "puts every room centre inside Weld's real
 * footprint" test above, there against the building ring -- checks
 * containment directly, no inverse transform anywhere in the chain.
 */
describe("door leaf placement in the world", () => {
  const params = DEFAULT_PARAMS;
  const suite = buildSuite(params);
  const { walls, openings } = buildWalls(suite);
  const floor = floorLevel(1);
  const { yaw } = suiteBasis(params);
  const byId = new Map(suite.rooms.map((r) => [r.id, r]));
  const wallH = params.ceiling;

  /** The exact transform slabGeometry() applies, run on one local point of a
   *  Slab (rather than a whole BufferGeometry), returned in WORLD (x, z). */
  function toWorldXZ(local: THREE.Vector3, s: Slab): { x: number; z: number } {
    const c = suiteToThree(s.u + s.du / 2, s.v + s.dv / 2, (s.y0 + s.y1) / 2, params);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(c[0], c[1], c[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + (s.turn ?? 0), 0)),
      new THREE.Vector3(1, 1, 1),
    );
    const world = local.clone().applyMatrix4(m);
    return { x: world.x, z: world.z };
  }

  /**
   * The two ends of a Slab's own long axis, before any rotation.
   *
   * A door leaf is a thin, long box -- LEAF_T by leafW, roughly 0.14 by 2.8 ft
   * at the defaults -- and WHICH of a Slab's two fields (`du`, `dv`) ends up
   * holding the long dimension depends on the wall's own alongV: Suite.tsx's
   * per-face mapping swaps them so a symmetric part's real width and depth
   * land correctly in suite (u, v), and that swap moves the leaf's length
   * between the box's local X size (`du`) and its local Z size (`dv`) along
   * with it. `BoxGeometry(du, h, dv)` always puts `du` on local X and `dv` on
   * local Z, so the long axis is local X when `du` is bigger and local Z when
   * `dv` is -- picking the wrong one here (assuming local X always) is
   * exactly the bug an earlier version of this test had, and it read as the
   * IMPLEMENTATION being wrong (a "hinge moved 2 ft" failure) when the fault
   * was this helper checking the box's short axis, which barely moves.
   */
  function longAxisEnds(s: Slab): [THREE.Vector3, THREE.Vector3] {
    return s.du >= s.dv
      ? [new THREE.Vector3(-s.du / 2, 0, 0), new THREE.Vector3(s.du / 2, 0, 0)]
      : [new THREE.Vector3(0, 0, -s.dv / 2), new THREE.Vector3(0, 0, s.dv / 2)];
  }

  /** A room's footprint as a world-space quad, corners in suiteToThree()'s own
   *  frame -- the same frame toWorldXZ() returns, so pointInPolygon() can
   *  compare the two directly with no intermediate frame at all. */
  function worldQuad(r: Rect): [number, number][] {
    const corners: [number, number][] = [
      [r.u, r.v],
      [r.u + r.du, r.v],
      [r.u + r.du, r.v + r.dv],
      [r.u, r.v + r.dv],
    ];
    return corners.map(([u, v]) => {
      const w = suiteToThree(u, v, floor, params);
      return [w[0], w[2]] as [number, number];
    });
  }

  const closed = doorLeafSlabs(walls, openings, suite.rooms, floor, wallH, new Set(), 0);
  const open = doorLeafSlabs(walls, openings, suite.rooms, floor, wallH, new Set(), 100);

  /**
   * Which room a door's leaf swings against, mirroring doorLeafSlabs()'s own
   * fallback: every interior door names a real room second (`connects[1]`);
   * the suite's own entry names "outside" (walk.ts's token for the
   * unmodelled stair hall) there, and hangs its leaf against `connects[0]`
   * (the hall) instead, nearly shut -- P14 row 3, ENTRY_AJAR_DEG.
   */
  function targetOf(o: (typeof openings)[number]): Rect | undefined {
    const id = byId.has(o.connects[1] ?? "") ? o.connects[1] : o.connects[0];
    return byId.get(id ?? "");
  }

  const doorsWithLeaves = openings.filter((o) => o.kind === "door" && targetOf(o));
  const entryIdx = doorsWithLeaves.findIndex((o) => !byId.has(o.connects[1] ?? ""));

  it("produces one leaf per door opening -- every door in this suite names a real room on one side or the other", () => {
    expect(open.length).toBe(doorsWithLeaves.length);
    expect(closed.length).toBe(open.length);
    expect(open.length).toBeGreaterThan(0);
  });

  it("hangs the suite's own entry nearly shut, not wide open like the rest", () => {
    expect(entryIdx, "no door in this suite names an unmodelled room").toBeGreaterThanOrEqual(0);
    const [aClosed, bClosed] = worldEnds(closed[entryIdx]!);
    const [aOpen, bOpen] = worldEnds(open[entryIdx]!);
    const distA = Math.hypot(aOpen.x - aClosed.x, aOpen.z - aClosed.z);
    const distB = Math.hypot(bOpen.x - bClosed.x, bOpen.z - bClosed.z);
    const swing = Math.max(distA, distB);
    // A leaf's free end sweeps close to leafW*sin(angle) from its 0 deg pose.
    // At 100 deg (every interior door) that is ~2.8 ft; at ENTRY_AJAR_DEG (12
    // deg) it is ~0.6 ft. Asserting well under the interior figure is the
    // point: the entry reads as barely open, not as a fire door propped wide.
    expect(swing, `entry leaf swung ${swing.toFixed(2)} ft, as far as an interior door`).toBeLessThan(1);
  });

  /** Both ends of a Slab's long axis, in WORLD (x, z), as a fixed-size tuple --
   *  `.map()` on a tuple loses its tuple-ness in TS, which is what made the
   *  call sites destructuring this inline report every element as possibly
   *  undefined. */
  function worldEnds(s: Slab): [{ x: number; z: number }, { x: number; z: number }] {
    const [a, b] = longAxisEnds(s);
    return [toWorldXZ(a, s), toWorldXZ(b, s)];
  }

  it("keeps every leaf's hinge fixed while its free end swings a real distance", () => {
    for (let i = 0; i < open.length; i++) {
      const [aClosed, bClosed] = worldEnds(closed[i]!);
      const [aOpen, bOpen] = worldEnds(open[i]!);
      const distA = Math.hypot(aOpen.x - aClosed.x, aOpen.z - aClosed.z);
      const distB = Math.hypot(bOpen.x - bClosed.x, bOpen.z - bClosed.z);
      expect(Math.min(distA, distB), `leaf ${i}: hinge moved`).toBeLessThan(0.2);
      // The entry swings only ENTRY_AJAR_DEG, not OPEN_DEG -- its own "hangs
      // nearly shut" test above covers the magnitude; this loop still checks
      // its hinge stays put, which does not depend on the angle.
      if (i === entryIdx) continue;
      expect(Math.max(distA, distB), `leaf ${i}: free end barely moved`).toBeGreaterThan(1.5);
    }
  });

  /**
   * Which case (alongV, which side of the band the target room sits on) each
   * emitted leaf actually is, derived the same way Suite.tsx's own
   * roomIsOnLowSide() does -- so this test does not have to hard-code which
   * array index belongs to which door, only assert that every case this
   * suite's doors actually produce is covered by at least one leaf.
   */
  function caseOf(o: (typeof openings)[number]): { alongV: boolean; roomLow: boolean } | null {
    const target = targetOf(o);
    if (!target) return null;
    const w = walls.find((x) => x.id === o.wallId)!;
    const alongV = w.dv >= w.du;
    const mid = alongV ? w.u + w.du / 2 : w.v + w.dv / 2;
    const centre = alongV ? target.u + target.du / 2 : target.v + target.dv / 2;
    return { alongV, roomLow: centre <= mid };
  }

  const cases = doorsWithLeaves.map((o, i) => ({ o, i, c: caseOf(o)! }));
  const seen = new Set(cases.map((c) => `${c.c.alongV}:${c.c.roomLow}`));

  it("this suite's doors exercise both alongV values and both room sides", () => {
    // Confirms the fixture is testing what it claims to: at least one door on
    // an alongV band with its target on the low side, one with it on the
    // high side (the reflection branch), and one on a !alongV band.
    expect(seen.has("true:true"), "no alongV, room-low case").toBe(true);
    expect(seen.has("true:false"), "no alongV, room-high case").toBe(true);
    expect(seen.has("false:true"), "no !alongV, room-low case").toBe(true);
  });

  for (const { o, i, c } of cases) {
    // The entry is excluded here: at only ENTRY_AJAR_DEG (12 deg), the "free"
    // end and the hinge end are both within a foot of the closed pose, and
    // distinguishing which is which by "which moved more" -- fine at the
    // interior doors' full 100 deg swing -- is noise at that scale. Its own
    // "hangs nearly shut" test above checks the magnitude that actually
    // matters for this one door without needing to pick a side.
    if (i === entryIdx) continue;
    it(`${o.id} (${o.connects.join("-")}), alongV=${c.alongV} roomLow=${c.roomLow}: open leaf's free end lands in its target room`, () => {
      const target = targetOf(o)!;
      const quad = worldQuad(target);
      const [aClosed, bClosed] = worldEnds(closed[i]!);
      const [aOpen, bOpen] = worldEnds(open[i]!);
      const distA = Math.hypot(aOpen.x - aClosed.x, aOpen.z - aClosed.z);
      const distB = Math.hypot(bOpen.x - bClosed.x, bOpen.z - bClosed.z);
      const far = distA >= distB ? aOpen : bOpen;
      expect(
        pointInPolygon([far.x, far.z], quad),
        `${o.id}'s free end (${far.x.toFixed(1)}, ${far.z.toFixed(1)}) is not inside ${target.id}`,
      ).toBe(true);
    });
  }
});
