import { describe, it, expect } from "vitest";
import type * as THREE from "three";
import weld from "@/data/weld.json";
import { pointInPolygon } from "@/geo/collide";
import { fromThree, siteToBuilding, normalizeAngle } from "@/geo/frames";
import { buildSuite, DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import { WELD, CLEAR_HALF_U, GABLE_INNER_V, floorLevel } from "@/geo/place";
import { buildWeld, bayRects, ringStations, narrowLobes, RIDGE_U } from "@/scene/weldGeometry";

/**
 * What these are for.
 *
 * P2's roofGeometry() fanned every eaves vertex to one apex, i.e. a 56-sided cone,
 * and nothing in the test suite could tell. A cone and a gable have the same
 * silhouette from three of the four cardinal directions and the same pixel
 * coverage from all of them, so this has to be pinned on the vertices rather than
 * in a screenshot. The four assertions that matter: the ridge is a LINE, that line
 * runs along the 13.2 deg axis, nothing is below grade or above 85.4 ft, and every
 * window bay lands inside Weld's real footprint.
 *
 * Tolerance is 1e-3 throughout, not 1e-6: positions are Float32, and 85.4 stores as
 * 85.40000152587891.
 */

const RING = weld.rings[0] as number[][];
const EPS = 1e-3;

type Tri = [Pt, Pt, Pt];
type Pt = { x: number; y: number; z: number; u: number; v: number };

function point(g: THREE.BufferGeometry, i: number): Pt {
  const p = g.getAttribute("position");
  const x = p.getX(i);
  const y = p.getY(i);
  const z = p.getZ(i);
  const s = fromThree([x, y, z]);
  const b = siteToBuilding({ x: s.x, y: s.y });
  return { x, y, z, u: b.u, v: b.v };
}

function vertices(g: THREE.BufferGeometry): Pt[] {
  const n = g.getAttribute("position").count;
  return Array.from({ length: n }, (_, i) => point(g, i));
}

function triangles(g: THREE.BufferGeometry): Tri[] {
  const idx = g.getIndex();
  if (!idx) throw new Error("geometry has no index");
  const out: Tri[] = [];
  for (let i = 0; i < idx.count; i += 3) {
    out.push([point(g, idx.getX(i)), point(g, idx.getX(i + 1)), point(g, idx.getX(i + 2))]);
  }
  return out;
}

function area(t: Tri): number {
  const ax = t[1].x - t[0].x, ay = t[1].y - t[0].y, az = t[1].z - t[0].z;
  const bx = t[2].x - t[0].x, by = t[2].y - t[0].y, bz = t[2].z - t[0].z;
  return Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) / 2;
}

const masses = buildWeld();
const roof = vertices(masses.roof);
const ringV = RING.map(([x, y]) => siteToBuilding({ x: x!, y: y! }).v);
const V_MIN = Math.min(...ringV);
const V_MAX = Math.max(...ringV);

describe("the footprint, measured", () => {
  // A positive control. "No tower lobes" is only worth anything if the thing that
  // looked for them can find the features that ARE there.
  const stations = ringStations();

  it("reproduces the dumbbell weld.json describes: narrow, wide, narrow, wide, narrow", () => {
    expect(stations).toHaveLength(5);
    const w = stations.map((s) => s.width);
    // ends and waist narrower than the two wing zones between them
    expect(w[0]!).toBeLessThan(w[1]!);
    expect(w[2]!).toBeLessThan(w[1]!);
    expect(w[2]!).toBeLessThan(w[3]!);
    expect(w[4]!).toBeLessThan(w[3]!);
    // the waist is the narrowest part of the building, which is the correction in
    // audit sec 1 row 13 -- getting this backwards is a documented past error
    expect(Math.min(...w)).toBe(w[2]);
  });

  it("puts every station's width inside the five-dataset range in audit sec 2a", () => {
    // waist 41.4 low, wings 64.1 high, across MassGIS / Cambridge / OSM
    for (const s of stations) {
      expect(s.width, `station v ${s.v0.toFixed(1)}..${s.v1.toFixed(1)}`).toBeGreaterThan(41);
      expect(s.width, `station v ${s.v0.toFixed(1)}..${s.v1.toFixed(1)}`).toBeLessThan(65);
    }
    // The stations cover the whole building. Not to the foot: a station boundary is
    // the first vertex of a merged cluster, and the gable end's own vertices spread
    // over 0.1 ft of v because the coordinates are given to a tenth.
    expect(stations[0]!.v0 - V_MIN).toBeLessThan(1);
    expect(V_MAX - stations[4]!.v1).toBeLessThan(1);
  });

  it("finds no narrow lobe, so the towers are not in this ring", () => {
    expect(narrowLobes()).toEqual([]);
    // every station is one piece: a tower carried above the eaves would be a
    // second span, and there is none
    for (const s of stations) expect(s.spans).toHaveLength(1);
    expect(masses.towers.getAttribute("position").count).toBe(0);
  });

  it("shows why: weld.json's other two rings are sub-foot slivers", () => {
    // These sit where the 1875 text puts the two central stair halls, but they are
    // degenerate ArcGIS parts -- the same class as the three slivers that took the
    // campus count from 39 to 36 (audit sec 1 row 11). No usable plan dimension.
    const aux = weld.rings.slice(1);
    expect(aux).toHaveLength(2);
    for (const r of aux) {
      const us = r.map(([x, y]) => siteToBuilding({ x: x!, y: y! }).u);
      expect(Math.max(...us) - Math.min(...us)).toBeLessThan(1);
    }
  });
});

describe("the roof is a gable, not a cone", () => {
  const ridge = roof.filter((p) => Math.abs(p.y - WELD.ridge) <= EPS);

  it("carries a ridge LINE: many distinct vertices at 85.4 ft, not one apex", () => {
    const distinct = new Set(ridge.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`));
    expect(distinct.size).toBeGreaterThan(2);
    // and it is a line, not a cluster: it spans the whole building
    const vs = ridge.map((p) => p.v);
    expect(Math.max(...vs) - Math.min(...vs)).toBeGreaterThan(V_MAX - V_MIN - 1);
  });

  it("holds every ridge vertex on one line across the building frame", () => {
    for (const p of ridge) expect(p.u, `ridge vertex at v ${p.v.toFixed(1)}`).toBeCloseTo(RIDGE_U, 3);
  });

  it("runs the ridge within 1 degree of the long axis", () => {
    const vs = ridge.map((p) => p.v);
    const a = ridge[vs.indexOf(Math.min(...vs))]!;
    const b = ridge[vs.indexOf(Math.max(...vs))]!;
    const sa = fromThree([a.x, a.y, a.z]);
    const sb = fromThree([b.x, b.y, b.z]);
    // compass bearing, degrees east of north, of the ridge segment
    const bearing = (Math.atan2(sb.x - sa.x, sb.y - sa.y) * 180) / Math.PI;
    expect(Math.abs(normalizeAngle(bearing - weld.meta.long_axis_deg_e_of_n))).toBeLessThan(1);
  });

  it("closes each end with a VERTICAL triangular gable wall, not a hip", () => {
    // A hip closes the end with sloping planes and leaves no vertical face at all;
    // the P2 cone leaves none either. The area of the vertical face at each end is
    // therefore the assertion that separates a gable from both.
    for (const [name, vEnd] of [["south", V_MIN], ["north", V_MAX]] as const) {
      const at = triangles(masses.roof).filter((t) =>
        t.every((p) => Math.abs(p.v - vEnd) < 1),
      );
      expect(at.length, `${name} gable triangles`).toBeGreaterThan(0);
      const us = at.flatMap((t) => t.map((p) => p.u)).filter((u) => Math.abs(u - RIDGE_U) > 1);
      const base = Math.max(...us) - Math.min(...us);
      const want = (base * (WELD.ridge - WELD.eaves)) / 2;
      const got = at.reduce((a, t) => a + area(t), 0);
      // A gable wall is base x rise / 2. The 2% headroom is the twist: the end wall
      // is not exactly perpendicular to the axis (its vertices spread over 0.1 ft
      // of v), so the fan quads are ruled rather than planar and carry ~5 sq ft
      // more than a flat triangle. A hip or the P2 cone leaves NO vertical face at
      // all, so this stays discriminating at any tolerance under 100%.
      expect(got, `${name} gable area vs ${want.toFixed(0)} sq ft`).toBeGreaterThan(want * 0.99);
      expect(got, `${name} gable area vs ${want.toFixed(0)} sq ft`).toBeLessThan(want * 1.02);
    }
  });

  it("keeps the same pitch either side, so the ridge sits over the middle", () => {
    // Guards RIDGE_U. Using u = 0 rather than the ring's measured mid-line would
    // leave the west slope most of a foot longer than the east one.
    const end = roof.filter((p) => p.v > V_MAX - 1 && Math.abs(p.y - WELD.eaves) <= EPS);
    const east = Math.max(...end.map((p) => p.u)) - RIDGE_U;
    const west = RIDGE_U - Math.min(...end.map((p) => p.u));
    expect(Math.abs(east - west)).toBeLessThan(0.5);
  });

  it("lands its eaves exactly on the shell's top ring", () => {
    // The roof and the walls are built from the same normalised ring by different
    // code paths. If they disagreed there would be a gap all the way round.
    const wallTop = vertices(masses.walls)
      .filter((p) => Math.abs(p.y - WELD.eaves) <= EPS)
      .map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`);
    const eaves = roof.filter((p) => Math.abs(p.y - WELD.eaves) <= EPS);
    expect(eaves.length).toBeGreaterThan(50);
    const top = new Set(wallTop);
    for (const p of eaves) {
      expect(top.has(`${p.x.toFixed(2)},${p.z.toFixed(2)}`), `eaves vertex u ${p.u.toFixed(1)} v ${p.v.toFixed(1)} is off the wall top`).toBe(true);
    }
  });

  it("puts roof surface on both sides of the ridge", () => {
    // A single shed plane would satisfy every height assertion above.
    expect(roof.some((p) => p.u > RIDGE_U + 10)).toBe(true);
    expect(roof.some((p) => p.u < RIDGE_U - 10)).toBe(true);
  });

  it("carries a unit normal on every vertex", () => {
    // A NaN in a normal buffer silently discards the draw call, and the fan quads
    // over the gable ends are near-degenerate: their two ridge points are 0.03 ft
    // apart, so a per-triangle normal there would be noise or NaN.
    for (const g of [masses.roof, masses.bays]) {
      const n = g.getAttribute("normal");
      for (let i = 0; i < n.count; i++) {
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
      }
    }
  });
});

describe("nothing below grade, nothing above the ridge", () => {
  it("holds every vertex of every mass between 0 and 85.4 ft", () => {
    for (const [name, g] of Object.entries(masses)) {
      const p = g.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        expect(y, `${name} vertex ${i} below grade`).toBeGreaterThanOrEqual(-EPS);
        expect(y, `${name} vertex ${i} above the ridge`).toBeLessThanOrEqual(WELD.ridge + EPS);
      }
    }
  });

  it("keeps the shell under the eaves and the roof above them", () => {
    const wall = vertices(masses.walls).map((p) => p.y);
    expect(Math.max(...wall)).toBeCloseTo(WELD.eaves, 2);
    expect(Math.min(...roof.map((p) => p.y))).toBeCloseTo(WELD.eaves, 2);
  });
});

describe("window bays agree with the interior openings", () => {
  const windowsOf = (p: SuiteParams) =>
    buildWalls(buildSuite(p)).openings.filter((o) => o.kind === "window");

  it("emits one reveal per window opening", () => {
    const wins = windowsOf(DEFAULT_PARAMS);
    expect(wins.length).toBeGreaterThan(0);
    const rects = bayRects();
    expect(rects).toHaveLength(wins.length);
    expect(rects.map((r) => r.w)).toEqual(wins.map((o) => o.width));
    // six faces, four vertices each, per box
    expect(masses.bays.getAttribute("position").count).toBe(wins.length * 24);
  });

  /**
   * Centre AND both ends of the opening, because the centre alone is a loose gate.
   * Measured: the facade bay's centre has 5.3 ft of slack, since it sits in the
   * wing zone where the ring is 62 ft wide, but its far end reaches v = 52.15 into
   * the 51.8 ft north end zone and clears the ring's east wall by 0.22 ft. Checking
   * the ends is what makes this catch a quarter-foot error rather than a five-foot
   * one.
   */
  function assertInsideRing(params: SuiteParams, label: string) {
    const wins = windowsOf(params);
    const { walls } = buildWalls(buildSuite(params));
    const rects = bayRects(params);
    expect(rects.length, label).toBe(wins.length);
    rects.forEach((r, i) => {
      const w = walls.find((x) => x.id === wins[i]!.wallId)!;
      const alongV = w.dv > w.du;
      for (const t of [-0.5, 0, 0.5]) {
        const u = r.u + (alongV ? 0 : t * r.w);
        const v = r.v + (alongV ? t * r.w : 0);
        const s = buildingToSiteRef(u, v);
        expect(
          pointInPolygon([s.x, s.y], RING),
          `${label} ${wins[i]!.id} at u ${u.toFixed(2)} v ${v.toFixed(2)}`,
        ).toBe(true);
      }
    });
  }

  it("puts every bay, end to end, inside Weld's real 59-point ring", () => {
    for (const face of ["east", "west"] as const) {
      assertInsideRing({ ...DEFAULT_PARAMS, facade: face }, face);
    }
  });

  it("stays inside the ring as the sliders move the suite", () => {
    const rnd = mulberry32(20260729);
    for (let i = 0; i < 200; i++) {
      const params: SuiteParams = {
        ...DEFAULT_PARAMS,
        // 44 is the 1875-derived floor; below it bedroom B loses its depth
        sectionLength: 44 + rnd() * 16,
        legDepth: 20 + rnd() * 3,
        ceiling: 9 + rnd() * 2,
        facade: rnd() < 0.5 ? "east" : "west",
        // masonry is held at its sourced 1.5 ft on purpose -- see the next test,
        // which measures how little room it has to move
      };
      assertInsideRing(params, `set ${i}`);
    }
  });

  /**
   * The half foot the whole bay question turns on, pinned.
   *
   * place.ts anchors the suite on weld.json's 49 ft clear width centred on u = 0.
   * The shell is the Harvard ArcGIS ring, whose north-end east wall is at u = 25.44
   * -- 51.8 ft wide and 0.47 ft off-centre, against Cambridge's 52.0. So the
   * modelled masonry face at u = 24.5 + masonry runs OUT of the shell, and the
   * reveal only fits because it is centred on the wall's mid-plane.
   *
   * These three numbers are measurements, not choices. They are here so that a
   * later change to place.ts, to weld.json or to the ring reports itself instead of
   * quietly pushing the bays through the wall.
   */
  it("has under half a foot of headroom between place.ts and the ring", () => {
    const eastWall = (v: number) => {
      // where the ring's east boundary sits at this v, in the building frame
      let u = -Infinity;
      for (let d = 0; d < 40; d += 0.005) {
        const s = buildingToSiteRef(24.5 + d, v);
        if (!pointInPolygon([s.x, s.y], RING)) break;
        u = 24.5 + d;
      }
      return u;
    };
    // the tightest point of any bay: the facade opening's north end
    const r = bayRects()[0]!;
    const vEnd = r.v + r.w / 2;
    const wall = eastWall(vEnd);
    expect(wall).toBeCloseTo(25.44, 1);

    // the mid-plane clears it, but only just
    expect(wall - r.u).toBeGreaterThan(0);
    expect(wall - r.u).toBeLessThan(0.3);

    // the wall's OUTER face does not clear it at all: a reveal box drawn to the
    // full masonry thickness pokes ~0.6 ft through the shell
    const outer = 24.5 + DEFAULT_PARAMS.masonry;
    expect(outer - wall).toBeGreaterThan(0.5);

    // and the mid-plane itself leaves the ring once masonry passes ~1.9 ft
    const breaks = 2 * (wall - 24.5);
    expect(breaks).toBeGreaterThan(DEFAULT_PARAMS.masonry);
    expect(breaks).toBeLessThan(2);
  });

  it("lands each bay inside the wall band that carries its opening", () => {
    // The independent half of "the same hole in the same wall": go back through
    // place.ts by hand and check the bay is within the opening's own extent, not
    // merely somewhere in the building.
    const params = DEFAULT_PARAMS;
    const { walls, openings } = buildWalls(buildSuite(params));
    const wins = openings.filter((o) => o.kind === "window");
    const rects = bayRects(params);
    wins.forEach((o, i) => {
      const w = walls.find((x) => x.id === o.wallId)!;
      const r = rects[i]!;
      const su = CLEAR_HALF_U - r.u;
      const sv = params.sectionLength - (GABLE_INNER_V - r.v);
      expect(su, `${o.id} u`).toBeGreaterThanOrEqual(w.u - 1e-9);
      expect(su, `${o.id} u`).toBeLessThanOrEqual(w.u + w.du + 1e-9);
      expect(sv, `${o.id} v`).toBeGreaterThanOrEqual(w.v - 1e-9);
      expect(sv, `${o.id} v`).toBeLessThanOrEqual(w.v + w.dv + 1e-9);
      const along = w.dv > w.du ? sv - w.v : su - w.u;
      expect(along, `${o.id} along the wall`).toBeCloseTo(o.offset + o.width / 2, 6);
    });
  });

  it("cuts the reveals at the suite's own floor and ceiling", () => {
    const y = vertices(masses.bays).map((p) => p.y);
    expect(Math.min(...y)).toBeCloseTo(floorLevel(1), 2);
    expect(Math.max(...y)).toBeCloseTo(floorLevel(1) + DEFAULT_PARAMS.ceiling, 2);
  });
});

/** East facade only; the test needs the inverse of place.ts, not a second copy. */
function buildingToSiteRef(u: number, v: number): { x: number; y: number } {
  const a = (weld.meta.long_axis_deg_e_of_n * Math.PI) / 180;
  return { x: u * Math.cos(a) + v * Math.sin(a), y: -u * Math.sin(a) + v * Math.cos(a) };
}

/** Seeded so a failing param set is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
