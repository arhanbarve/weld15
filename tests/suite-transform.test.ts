import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import { suiteToThree, floorLevel } from "@/geo/place";
import {
  suiteBasis,
  rectCentre,
  doorLeafSlabs,
  cutsFor,
  bathWainscotSlab,
  applyAoColor,
  aoSegments,
  signSlabs,
  AO_DEPTH_FT,
  AO_MIN,
  type Slab,
} from "@/scene/Suite";
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

  const closed = doorLeafSlabs(walls, openings, suite.rooms, floor, wallH, new Set(), 0);
  const open = doorLeafSlabs(walls, openings, suite.rooms, floor, wallH, new Set(), 100);

  const entryOpening = openings.find((o) => o.kind === "door" && !byId.has(o.connects[1] ?? ""));

  /** Both ends of a Slab's long axis, in WORLD (x, z), as a fixed-size tuple --
   *  `.map()` on a tuple loses its tuple-ness in TS, which is what made the
   *  call sites destructuring this inline report every element as possibly
   *  undefined. */
  function worldEnds(s: Slab): [{ x: number; z: number }, { x: number; z: number }] {
    const [a, b] = longAxisEnds(s);
    return [toWorldXZ(a, s), toWorldXZ(b, s)];
  }

  it("produces exactly one leaf -- the suite's own entry -- and none for any interior door", () => {
    expect(entryOpening, "no door in this suite names an unmodelled room").toBeDefined();
    expect(open.length).toBe(1);
    expect(closed.length).toBe(1);
    const interiorDoors = openings.filter((o) => o.kind === "door" && o.id !== entryOpening!.id);
    expect(interiorDoors.length, "this suite should still have interior doorways, just no leaves for them").toBeGreaterThan(0);
  });

  it("hangs the suite's own entry nearly shut, not wide open", () => {
    const [aClosed, bClosed] = worldEnds(closed[0]!);
    const [aOpen, bOpen] = worldEnds(open[0]!);
    const distA = Math.hypot(aOpen.x - aClosed.x, aOpen.z - aClosed.z);
    const distB = Math.hypot(bOpen.x - bClosed.x, bOpen.z - bClosed.z);
    expect(Math.min(distA, distB), "entry leaf: hinge moved").toBeLessThan(0.2);
    const swing = Math.max(distA, distB);
    // A leaf's free end sweeps close to leafW*sin(angle) from its 0 deg pose.
    // At ENTRY_AJAR_DEG (12 deg) that is ~0.6 ft, well under a wide-open
    // door's ~2.8 ft -- the point being that the entry reads as barely open,
    // not as a fire door propped wide.
    expect(swing, `entry leaf swung ${swing.toFixed(2)} ft, as far as a wide-open door`).toBeLessThan(1);
  });
});

/**
 * bathWainscotSlab() places an axis-aligned, non-rotated proud box -- unlike
 * the leaf above, there is no chirality here to get wrong, but the placement
 * formula was still wrong once: an earlier version added WAINSCOT_PROUD a
 * second time on the high-side (far) face, which stood the whole dado a
 * half-inch clear of the wall instead of flush against it. Checked against
 * every wall the bathroom actually touches, both sides represented.
 */
describe("bathroom wainscot placement", () => {
  const params = DEFAULT_PARAMS;
  const suite = buildSuite(params);
  const { walls, openings } = buildWalls(suite);
  const floor = floorLevel(1);
  const wallH = params.ceiling;
  const bath = suite.rooms.find((r) => r.kind === "bath")!;

  function slabsForWall(w: (typeof walls)[number]): Slab[] {
    const cuts = cutsFor(w, openings, wallH);
    return bathWainscotSlab(w, cuts, bath, floor);
  }

  const bathWalls = walls.filter((w) => w.between.includes("bath"));

  it("touches at least one wall on the bathroom's low side and one on its high side", () => {
    // The bath is an interior room with walls on all four sides (rooms.ts:
    // no windows, entered from the hall) -- confirms this fixture exercises
    // both branches of the mirror formula, not just one.
    const sides = bathWalls.map((w) => {
      const alongV = w.dv >= w.du;
      const mid = alongV ? w.u + w.du / 2 : w.v + w.dv / 2;
      const centre = alongV ? bath.u + bath.du / 2 : bath.v + bath.dv / 2;
      return centre <= mid;
    });
    expect(sides.some((s) => s), "no wall with the bath on its low side").toBe(true);
    expect(sides.some((s) => !s), "no wall with the bath on its high side").toBe(true);
  });

  it("stands every board flush with its wall face and proud into the bathroom, never into the wall or past it", () => {
    for (const w of bathWalls) {
      const { alongV, thick } = bandAxis_forTest(w);
      const low = alongV ? w.u : w.v;
      for (const s of slabsForWall(w)) {
        const acrossExtent = alongV ? s.du : s.dv;
        const acrossLo = alongV ? s.u : s.v;
        expect(acrossExtent).toBeCloseTo(WAINSCOT_PROUD_forTest, 9);
        // Flush with one of the band's two faces (low or low+thick), not
        // offset from it -- this is exactly the bug that shipped once.
        const flushLow = Math.abs(acrossLo + acrossExtent - low) < 1e-9;
        const flushHigh = Math.abs(acrossLo - (low + thick)) < 1e-9;
        expect(flushLow || flushHigh, `wall ${w.id}: board not flush (across ${acrossLo})`).toBe(true);
        expect(s.y1 - s.y0).toBeCloseTo(4.0, 9); // WAINSCOT_H
        expect(s.y0).toBe(floor);
        expect(s.du).toBeGreaterThan(0);
        expect(s.dv).toBeGreaterThan(0);
      }
    }
  });

  it("breaks for the doorway, the same way the baseboard does", () => {
    const doorWall = bathWalls.find((w) =>
      openings.some((o) => o.kind === "door" && o.wallId === w.id),
    );
    expect(doorWall, "no door found on a bathroom wall").toBeDefined();
    const slabs = slabsForWall(doorWall!);
    const { alongV, along } = bandAxis_forTest(doorWall!);
    const covered = slabs.reduce((sum, s) => sum + (alongV ? s.dv : s.du), 0);
    expect(covered, "wainscot ran the full wall, ignoring the door").toBeLessThan(along);
  });

  it("touches no other room's floor", () => {
    // Every board's across-position must sit within [low - eps, low+thick +
    // eps] plus the WAINSCOT_PROUD it stands proud by -- i.e. it never
    // reaches more than WAINSCOT_PROUD past either wall face.
    for (const w of bathWalls) {
      const { alongV, thick } = bandAxis_forTest(w);
      const low = alongV ? w.u : w.v;
      for (const s of slabsForWall(w)) {
        const acrossLo = alongV ? s.u : s.v;
        const acrossExtent = alongV ? s.du : s.dv;
        expect(acrossLo).toBeGreaterThanOrEqual(low - WAINSCOT_PROUD_forTest - 1e-9);
        expect(acrossLo + acrossExtent).toBeLessThanOrEqual(low + thick + WAINSCOT_PROUD_forTest + 1e-9);
      }
    }
  });
});

describe("baked ambient occlusion (applyAoColor)", () => {
  /** Exactly what slabGeometry() builds, segments included -- BoxGeometry's plain
   *  24-vertex form has every vertex at a corner (all three local coordinates
   *  pinned to that axis's own half-extent), so a distance-to-edge read off it is
   *  zero everywhere; aoSegments() is what gives an interior vertex to read a
   *  gradient from at all, and building it any other way here would test a shape
   *  slabGeometry() never actually produces. */
  const boxFor = (s: Slab) => {
    const height = s.y1 - s.y0;
    return new THREE.BoxGeometry(s.du, height, s.dv, aoSegments(s.du), aoSegments(height), aoSegments(s.dv));
  };

  const colorsOf = (g: THREE.BufferGeometry) => Array.from({ length: g.getAttribute("color").count }, (_, i) => g.getAttribute("color").getX(i));

  it("adds a color attribute sized to match position", () => {
    const s: Slab = { u: 0, v: 0, du: 4, dv: 3, y0: 0, y1: 1 };
    const g = boxFor(s);
    expect(g.hasAttribute("color")).toBe(false);
    applyAoColor(g, s);
    expect(g.hasAttribute("color")).toBe(true);
    expect(g.getAttribute("color").count).toBe(g.getAttribute("position").count);
  });

  it("stays within [AO_MIN, 1] and is grayscale (r = g = b)", () => {
    const s: Slab = { u: 0, v: 0, du: 4, dv: 3, y0: 0, y1: 8 };
    const g = boxFor(s);
    applyAoColor(g, s);
    const color = g.getAttribute("color");
    for (let i = 0; i < color.count; i++) {
      const r = color.getX(i);
      expect(r).toBeGreaterThanOrEqual(AO_MIN - 1e-9);
      expect(r).toBeLessThanOrEqual(1 + 1e-9);
      expect(color.getY(i)).toBeCloseTo(r, 9);
      expect(color.getZ(i)).toBeCloseTo(r, 9);
    }
  });

  it("darkens a small box (every axis at or under AO_SEG_MIN_FT) toward AO_MIN uniformly", () => {
    // Every axis this small gets exactly 1 segment (aoSegments()'s own threshold),
    // so the box is 8 plain corner vertices with no interior point on any axis --
    // the degenerate case the header's own comment on thin trim/casing predicts,
    // and the reason a "small box" needs no segments at all to render correctly.
    const thin = AO_DEPTH_FT * 1.5;
    const s: Slab = { u: 0, v: 0, du: thin, dv: thin, y0: 0, y1: thin };
    expect(aoSegments(thin)).toBe(1);
    const g = boxFor(s);
    applyAoColor(g, s);
    for (const c of colorsOf(g)) expect(c).toBeCloseTo(AO_MIN, 6);
  });

  it("brightens toward the interior of a large box, away from every edge", () => {
    const big = 10;
    const s: Slab = { u: 0, v: 0, du: big, dv: big, y0: 0, y1: big };
    expect(aoSegments(big)).toBeGreaterThan(1);
    const g = boxFor(s);
    applyAoColor(g, s);
    const colors = colorsOf(g);
    // Every box has at least one true corner (AO_MIN, exactly) and, once its axes
    // clear AO_SEG_MIN_FT, at least one interior vertex genuinely brighter than
    // that -- the two ends of the range this function promises, read off the
    // built geometry rather than assumed.
    expect(Math.min(...colors)).toBeCloseTo(AO_MIN, 6);
    expect(Math.max(...colors)).toBeGreaterThan(AO_MIN + (1 - AO_MIN) * 0.9);
  });

  it("excludes a box's own thinnest axis, so a large thin floor still brightens toward its middle", () => {
    // A floor slab: thin in height (a few inches), wide in u and v. Folding height
    // into the same min() as u/v would pin every vertex to the top or bottom face
    // regardless of where it sits in the room and zero the gradient everywhere --
    // this is the test that would have caught that mistake.
    const s: Slab = { u: 0, v: 0, du: 12, dv: 12, y0: 0, y1: 0.3 };
    const g = boxFor(s);
    applyAoColor(g, s);
    expect(Math.max(...colorsOf(g))).toBeCloseTo(1, 6);
  });

  it("is not idempotent, matching scaleFloorUv()'s own contract -- called exactly once, before merge", () => {
    // A second call sees the SAME position attribute (applyAoColor reads position,
    // not the previous color), so it recomputes an identical result rather than
    // compounding -- unlike scaleFloorUv's multiply-in-place, but still a function
    // whose contract is "once, on a fresh geometry", per its own header.
    const s: Slab = { u: 0, v: 0, du: 4, dv: 3, y0: 0, y1: 2 };
    const g = boxFor(s);
    applyAoColor(g, s);
    const first = colorsOf(g);
    applyAoColor(g, s);
    const second = colorsOf(g);
    expect(second).toEqual(first);
  });
});

/** Local re-derivation of bandAxis()'s two fields this test needs -- that
 *  function is Suite.tsx's own private helper and not worth exporting for a
 *  test that only reads two of its outputs off the same Wall shape. */
function bandAxis_forTest(w: { u: number; v: number; du: number; dv: number }) {
  const alongV = w.dv >= w.du;
  return { alongV, along: alongV ? w.dv : w.du, thick: alongV ? w.du : w.dv };
}

/** Matches Suite.tsx's own WAINSCOT_PROUD -- duplicated for the same reason
 *  furniture.ts's DOOR_CLEARANCE note gives: a value this test checks against
 *  is not a dependency it should import, since the whole point is to catch a
 *  drift between the implementation and what the number is supposed to be. */
const WAINSCOT_PROUD_forTest = 0.05;

describe("signSlabs()", () => {
  const params = DEFAULT_PARAMS;
  const suite = buildSuite(params);
  const { walls, openings } = buildWalls(suite);
  const floor = floorLevel(1);
  const byId = new Map(suite.rooms.map((r) => [r.id, r]));

  const signs = signSlabs(walls, openings, suite.rooms, floor);
  const doors = openings.filter((o) => o.kind === "door");

  it("produces exactly one plaque per door -- the entrance plus every interior doorway", () => {
    expect(signs.length).toBe(doors.length);
    expect(signs.length).toBeGreaterThan(0);
  });

  it("labels the front door \"Entrance\", not a room name", () => {
    const front = signs.find((s) => s.label === "Entrance");
    expect(front, "no plaque reads Entrance").toBeDefined();
    // Exactly one: "outside" only ever appears as one door's connects[1].
    expect(signs.filter((s) => s.label === "Entrance").length).toBe(1);
  });

  it("never labels a plaque \"Hall\" -- the hub is never a door's destination", () => {
    expect(signs.some((s) => s.label === "Hall")).toBe(false);
  });

  it("labels K plainly, not by its full descriptive room label", () => {
    const kSign = signs.find((s) => s.label === "K");
    expect(kSign, "no plaque reads K").toBeDefined();
    expect(signs.some((s) => s.label.includes("second common room"))).toBe(false);
  });

  it("labels every other interior door by its destination room's own label", () => {
    const labels = new Set(signs.map((s) => s.label));
    for (const want of ["Bedroom A", "Bedroom B", "Bathroom", "Common room"]) {
      expect(labels.has(want), `missing plaque for ${want}`).toBe(true);
    }
  });

  it("mounts every plaque on the door's connects[0] (approach) side, standing proud of that wall -- not embedded in it, not on the far side", () => {
    for (const o of doors) {
      const sign = signs.find((s) => {
        const dest = byId.get(o.connects[1] ?? "");
        const want = dest ? (dest.id === "k" ? "K" : dest.label) : "Entrance";
        return s.label === want;
      });
      expect(sign, `no plaque for door ${o.id}`).toBeDefined();
      const w = walls.find((x) => x.id === o.wallId)!;
      const mountRoom = byId.get(o.connects[0]!)!;
      const { alongV, thick } = bandAxis_forTest(w);
      const low = alongV ? w.u : w.v;
      const roomLow = (alongV ? mountRoom.u + mountRoom.du / 2 : mountRoom.v + mountRoom.dv / 2) <= (alongV ? w.u + w.du / 2 : w.v + w.dv / 2);
      const acrossOrigin = alongV ? sign!.slab.u : sign!.slab.v;
      const acrossSize = alongV ? sign!.slab.du : sign!.slab.dv;
      if (roomLow) {
        // Proud OUTWARD from the low face: the whole box sits at or below `low`.
        expect(acrossOrigin + acrossSize).toBeLessThanOrEqual(low + 1e-9);
      } else {
        // Proud outward from the high face: the whole box sits at or beyond `low + thick`.
        expect(acrossOrigin).toBeGreaterThanOrEqual(low + thick - 1e-9);
      }
    }
  });

  it("keeps every plaque's along-axis span within its own wall band", () => {
    for (const o of doors) {
      const w = walls.find((x) => x.id === o.wallId)!;
      const { alongV, along } = bandAxis_forTest(w);
      const dest = byId.get(o.connects[1] ?? "");
      const want = dest ? (dest.id === "k" ? "K" : dest.label) : "Entrance";
      const sign = signs.find((s) => s.label === want)!;
      const alongOrigin = alongV ? sign.slab.v - w.v : sign.slab.u - w.u;
      const alongSize = alongV ? sign.slab.dv : sign.slab.du;
      expect(alongOrigin).toBeGreaterThanOrEqual(-1e-9);
      expect(alongOrigin + alongSize).toBeLessThanOrEqual(along + 1e-9);
    }
  });

  it("mounts every plaque at ordinary reading height, well within the ceiling", () => {
    for (const { slab } of signs) {
      expect(slab.y0).toBeGreaterThan(floor + 3);
      expect(slab.y1).toBeLessThan(floor + params.ceiling);
    }
  });
});
