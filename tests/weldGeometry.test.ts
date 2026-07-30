import { describe, it, expect } from "vitest";
import type * as THREE from "three";
import weld from "@/data/weld.json";
import { pointInPolygon } from "@/geo/collide";
import { fromThree, siteToBuilding, normalizeAngle } from "@/geo/frames";
import { buildSuite, DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import { WELD, CLEAR_HALF_U, GABLE_INNER_V, floorLevel, suiteCornersSite } from "@/geo/place";
import {
  buildWeld,
  bayRects,
  maxSectionLength,
  ringStations,
  narrowLobes,
  towerCentres,
  MAX_SECTION_LENGTH,
  RIDGE_U,
  TOWER_CONTROLS,
  TOWER_DEFAULTS,
  type Station,
} from "@/scene/weldGeometry";

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

  it("finds no narrow lobe, so the towers are not in THIS ring", () => {
    expect(narrowLobes()).toEqual([]);
    // every station is one piece: a tower carried up through the eaves would be a
    // second span, and there is none
    for (const s of stations) expect(s.spans).toHaveLength(1);
    // so whatever the towers are built from, it is not ring[0]: two boxes, six
    // faces each, four vertices a face
    expect(masses.towers.getAttribute("position").count).toBe(2 * 24);
  });

  it("shows why the towers' SIZE is inferred: the other two rings are sub-foot slivers", () => {
    // These are where the towers' POSITION comes from, and they are also the reason
    // their width cannot come from the same place: degenerate ArcGIS parts, the same
    // class as the three slivers that took the campus count from 39 to 36 (audit sec
    // 1 row 11). A 0.2 ft wall line is digitisation noise.
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
    for (const g of [masses.roof, masses.towers, masses.bays]) {
      const n = g.getAttribute("normal");
      for (let i = 0; i < n.count; i++) {
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 3);
      }
    }
  });
});

/**
 * The two staircase lanterns.
 *
 * The thing being guarded is not "are there two boxes on the roof" -- it is that
 * the half of this feature which IS evidenced stays tied to the evidence while the
 * half that is guessed stays adjustable. So: the plan position is checked against
 * the slivers by a route the module does not use (the shoelace centroid rather than
 * the vertex mean), the seating is checked against the roof geometry itself rather
 * than against the interpolation that built it, and the two inferred numbers are
 * checked to actually move the vertices, because an ignored parameter is a slider
 * that does nothing and a viewer who cannot correct the guess.
 */
describe("the staircase lanterns: position derived, size inferred", () => {
  const towers = vertices(masses.towers);
  const north = towers.filter((p) => p.v > 0);
  const south = towers.filter((p) => p.v < 0);
  const groups = [
    ["north", north] as const,
    ["south", south] as const,
  ];

  /**
   * The area centroid of one auxiliary ring, by shoelace.
   *
   * towerCentres() takes the mean of the three vertices, which for a TRIANGLE is
   * the same point. Coming at it the other way is the check: if either ring ever
   * gains a fourth vertex the two routes part company and this fails, which is the
   * report we want rather than a silently shifted tower.
   */
  function sliverCentroid(i: number): { u: number; v: number; area: number } {
    const pts = (weld.rings[i] as number[][])
      .slice(0, -1)
      .map(([x, y]) => siteToBuilding({ x: x!, y: y! }));
    let a = 0;
    let cu = 0;
    let cv = 0;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k]!;
      const q = pts[(k + 1) % pts.length]!;
      const cross = p.u * q.v - q.u * p.v;
      a += cross;
      cu += (p.u + q.u) * cross;
      cv += (p.v + q.v) * cross;
    }
    return { u: cu / (3 * a), v: cv / (3 * a), area: Math.abs(a / 2) };
  }

  /**
   * The height of the ROOF at a plan point, read off the roof triangles.
   *
   * An independent oracle for the seating: masses.roof is what the renderer will
   * draw, so asking it directly cannot agree with a mistake in the interpolation
   * the towers are seated by. Faces with no plan area -- the vertical gable walls
   * and the wing-side triangles -- are skipped, and the highest containing face
   * wins, because along the eaves a vertical triangle and a sloping one share an
   * edge in plan.
   */
  function roofSurfaceAt(u: number, v: number): number | null {
    let best: number | null = null;
    for (const t of triangles(masses.roof)) {
      const [a, b, c] = t;
      const d = (b.v - c.v) * (a.u - c.u) + (c.u - b.u) * (a.v - c.v);
      if (Math.abs(d) < 1e-6) continue;
      const w1 = ((b.v - c.v) * (u - c.u) + (c.u - b.u) * (v - c.v)) / d;
      const w2 = ((c.v - a.v) * (u - c.u) + (a.u - c.u) * (v - c.v)) / d;
      const w3 = 1 - w1 - w2;
      if (w1 < -1e-9 || w2 < -1e-9 || w3 < -1e-9) continue;
      const y = w1 * a.y + w2 * b.y + w3 * c.y;
      if (best === null || y > best) best = y;
    }
    return best;
  }

  const extent = (ps: Pt[], f: (p: Pt) => number) =>
    Math.max(...ps.map(f)) - Math.min(...ps.map(f));

  it("emits two lanterns, each a real box rather than a collapsed one", () => {
    expect(north).toHaveLength(24);
    expect(south).toHaveLength(24);
    for (const [name, g] of groups) {
      // eight distinct corners, three faces meeting at each
      const distinct = new Set(
        g.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`),
      );
      expect(distinct.size, `${name} corners`).toBe(8);
      expect(extent(g, (p) => p.u), `${name} plan extent across`).toBeCloseTo(
        TOWER_DEFAULTS.width,
        2,
      );
      expect(extent(g, (p) => p.v), `${name} plan extent along`).toBeCloseTo(
        TOWER_DEFAULTS.width,
        2,
      );
      // tall enough to read as a lantern: it clears the ridge AND is seated well
      // down the slope, so its own height is more than the rise above the ridge
      expect(extent(g, (p) => p.y), `${name} height`).toBeGreaterThan(
        TOWER_DEFAULTS.heightAboveRidge,
      );
    }
    // and no degenerate faces anywhere, which is what a NaN normal comes from
    for (const t of triangles(masses.towers)) expect(area(t)).toBeGreaterThan(1e-4);
  });

  it("centres each lantern on the centroid of its own sliver", () => {
    // The DERIVED half. Not "near the middle of the building" -- on the sliver, by
    // an independently computed centroid, to a thousandth of a foot.
    const centres = towerCentres();
    expect(centres).toHaveLength(2);
    for (const c of centres) {
      const want = sliverCentroid(c.ring);
      expect(c.u, `ring[${c.ring}] u`).toBeCloseTo(want.u, 3);
      expect(c.v, `ring[${c.ring}] v`).toBeCloseTo(want.v, 3);
      // and the mass is actually built there
      const g = c.v > 0 ? north : south;
      expect((Math.max(...g.map((p) => p.u)) + Math.min(...g.map((p) => p.u))) / 2).toBeCloseTo(
        want.u,
        2,
      );
      expect((Math.max(...g.map((p) => p.v)) + Math.min(...g.map((p) => p.v))) / 2).toBeCloseTo(
        want.v,
        2,
      );
    }
  });

  it("straddles the ridge, one lantern either side", () => {
    // What "two central staircase halls" means across a 62 ft building, and the
    // one shape claim the slivers genuinely support. Both towers on the west slope
    // would satisfy every other assertion here.
    const cu = towerCentres().map((c) => c.u);
    expect(Math.min(...cu)).toBeLessThan(RIDGE_U);
    expect(Math.max(...cu)).toBeGreaterThan(RIDGE_U);
    // not a coin flip on a rounding error: each sits most of 10 ft off the ridge,
    // and at the default width no vertex of either crosses it
    for (const c of towerCentres()) expect(Math.abs(c.u - RIDGE_U)).toBeGreaterThan(5);
    expect(north.every((p) => p.u < RIDGE_U)).toBe(true);
    expect(south.every((p) => p.u > RIDGE_U)).toBe(true);
  });

  it("keeps every lantern vertex above the eaves and its cap above the ridge", () => {
    for (const [name, g] of groups) {
      const ys = g.map((p) => p.y);
      expect(Math.min(...ys), `${name} base`).toBeGreaterThanOrEqual(WELD.eaves - EPS);
      // the cap is the ridge plus the inferred rise, exactly
      expect(Math.max(...ys), `${name} cap`).toBeCloseTo(
        WELD.ridge + TOWER_DEFAULTS.heightAboveRidge,
        2,
      );
      expect(Math.max(...ys), `${name} cap clears the ridge`).toBeGreaterThan(WELD.ridge + EPS);
      // seated on the slope, not perched on the ridge: the base is below 85.4
      expect(Math.min(...ys), `${name} base is on the slope`).toBeLessThan(WELD.ridge - EPS);
    }
  });

  it("seats each lantern on the slate with no gap under the downhill wall", () => {
    // Checked against the roof triangles, not against roofHeightAt(). The base must
    // be AT the roof under its lowest corner and AT OR BELOW it under the other
    // three; a base taken at the centre instead would leave 3 ft of daylight under
    // the downhill wall, because the slate falls 6.5 ft across a 7.9 ft plan here.
    for (const [name, g] of groups) {
      const base = Math.min(...g.map((p) => p.y));
      // the base is a flat horizontal cut, not a raked one: four corners, one height
      const flat = new Set(
        g.filter((p) => Math.abs(p.y - base) < EPS).map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`),
      );
      expect(flat.size, `${name} base corners`).toBe(4);
      const heights: number[] = [];
      for (const p of g) {
        const h = roofSurfaceAt(p.u, p.v);
        expect(h, `${name} corner u ${p.u.toFixed(2)} v ${p.v.toFixed(2)} is off the roof`).not.toBe(
          null,
        );
        heights.push(h!);
        expect(base, `${name} base under the roof at u ${p.u.toFixed(2)}`).toBeLessThanOrEqual(
          h! + 0.02,
        );
      }
      expect(base, `${name} base vs the lowest slate on its plan`).toBeCloseTo(
        Math.min(...heights),
        1,
      );
    }
  });

  it("lands both lanterns inside Weld's real 59-point ring", () => {
    // The same gate the bays get, for the same reason: a tower whose plan has left
    // the footprint is standing on air, and every height assertion above would
    // still pass.
    for (const [name, g] of groups) {
      for (const p of g) {
        const s = fromThree([p.x, p.y, p.z]);
        expect(
          pointInPolygon([s.x, s.y], RING),
          `${name} corner u ${p.u.toFixed(2)} v ${p.v.toFixed(2)}`,
        ).toBe(true);
      }
    }
  });

  it("moves the geometry when the two inferred numbers are driven", () => {
    // The whole point of tagging them INFERRED: a P6 slider has to change what is
    // drawn. Both parameters are swept, because a mass that honoured the height and
    // ignored the width would pass a height-only check.
    for (const width of [3, 5, TOWER_DEFAULTS.width, 12, 15]) {
      const g = vertices(buildWeld(DEFAULT_PARAMS, { ...TOWER_DEFAULTS, width }).towers);
      const half = g.filter((p) => p.v > 0);
      expect(extent(half, (p) => p.u), `width ${width} across`).toBeCloseTo(width, 2);
      expect(extent(half, (p) => p.v), `width ${width} along`).toBeCloseTo(width, 2);
      // a wider lantern reaches further down the slope, so its base drops
      const base = Math.min(...half.map((p) => p.y));
      expect(base, `width ${width} base`).toBeLessThan(WELD.ridge);
      expect(base, `width ${width} base`).toBeGreaterThanOrEqual(WELD.eaves - EPS);
    }

    const bases = [3, 15].map((width) =>
      Math.min(
        ...vertices(buildWeld(DEFAULT_PARAMS, { ...TOWER_DEFAULTS, width }).towers).map((p) => p.y),
      ),
    );
    expect(bases[1]!, "a 15 ft lantern is seated lower than a 3 ft one").toBeLessThan(
      bases[0]! - 1,
    );

    for (const rise of [0.5, TOWER_DEFAULTS.heightAboveRidge, 12]) {
      const g = vertices(
        buildWeld(DEFAULT_PARAMS, { ...TOWER_DEFAULTS, heightAboveRidge: rise }).towers,
      );
      expect(Math.max(...g.map((p) => p.y)), `rise ${rise}`).toBeCloseTo(WELD.ridge + rise, 2);
    }

    // and the buffers really are different objects with different contents
    const a = buildWeld(DEFAULT_PARAMS, TOWER_DEFAULTS).towers.getAttribute("position").array;
    const b = buildWeld(DEFAULT_PARAMS, { width: 12, heightAboveRidge: 10 }).towers.getAttribute(
      "position",
    ).array;
    expect(a.length).toBe(b.length);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("keeps weld.json's record of the derivation matching the derivation", () => {
    // meta.towers.positions is a RECORD of towerCentres(), so it can go stale in a
    // way no rendered pixel would show. Recomputed here from the rings.
    const recorded = weld.meta.towers.positions;
    expect(recorded).toHaveLength(2);
    for (const r of recorded) {
      const want = sliverCentroid(r.ring);
      expect(r.u_ft, `${r.id} u`).toBeCloseTo(want.u, 3);
      expect(r.v_ft, `${r.id} v`).toBeCloseTo(want.v, 3);
      expect(Math.abs(r.sliver_area_sqft - want.area), `${r.id} area`).toBeLessThan(0.01);
      const pts = (weld.rings[r.ring] as number[][])
        .slice(0, -1)
        .map(([x, y]) => siteToBuilding({ x: x!, y: y! }));
      const us = pts.map((p) => p.u);
      const vs = pts.map((p) => p.v);
      expect(r.sliver_u_extent_ft, `${r.id} sliver u extent`).toBeCloseTo(
        Math.max(...us) - Math.min(...us),
        3,
      );
      expect(r.sliver_v_extent_ft, `${r.id} sliver v extent`).toBeCloseTo(
        Math.max(...vs) - Math.min(...vs),
        3,
      );
    }
    expect(recorded.map((r) => r.id)).toEqual(towerCentres().map((c) => c.id));
  });

  it("exposes both guesses as controls, tagged, bounded and single-sourced", () => {
    // A UI must be able to render the INFERRED chip and the slider without a second
    // copy of either number, because a second copy is how 54 x 151 survived three
    // artifacts (audit sec 1 rows 1-2).
    expect(TOWER_CONTROLS.provenance).toBe("INFERRED");
    expect(TOWER_DEFAULTS.width).toBe(weld.meta.towers.plan_width_ft_estimate);
    expect(TOWER_DEFAULTS.heightAboveRidge).toBe(
      weld.meta.towers.height_above_ridge_ft_estimate,
    );
    for (const key of ["width", "heightAboveRidge"] as const) {
      const c = TOWER_CONTROLS[key];
      expect(c.value, `${key} value`).toBe(TOWER_DEFAULTS[key]);
      expect(c.min, `${key} min`).toBeLessThan(c.value);
      expect(c.max, `${key} max`).toBeGreaterThan(c.value);
      expect(c.basis.length, `${key} basis`).toBeGreaterThan(80);
    }
    // the upper bounds are sourced numbers, not picked ones: the 1875 stair hall's
    // short dimension, and Cambridge's floor-to-floor
    expect(TOWER_CONTROLS.width.max).toBe(weld.meta.primary_source_1875.stair_hall_ft[0]);
    expect(TOWER_CONTROLS.heightAboveRidge.max).toBe(weld.meta.floor_to_floor_ft);
    // and the size is stated to be unsourced where a reader would look
    expect(weld.meta.towers.size_is_not_sourced).toMatch(/NO source/);
    expect(weld.meta.towers.existence_source.quotation).toMatch(/lantern or louvre/);
  });
});

describe("nothing below grade, nothing above the ridge", () => {
  it("holds every vertex of every mass between 0 and 85.4 ft", () => {
    // The towers are the one exception, and the only one: the 1875 text says the
    // lanterns rise ABOVE the roof, so a mass that stopped at 85.4 would be the
    // feature not being modelled. They get their own ceiling in the tower block
    // below, tied to the same parameter that puts them there.
    for (const [name, g] of Object.entries(masses)) {
      if (name === "towers") continue;
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
   * Centre AND both ends of every opening, in the building frame.
   *
   * Three points rather than one, because the centre alone is a loose gate. The
   * four facade bays are spread down the facade now, one per room, and their slack
   * varies by an order of magnitude with where they land: the common room's sits out
   * in the wing zone where the ring is 62 ft wide and clears by 5.36 ft, while
   * bedroom A's centre clears by 5.31 ft and its north end crosses into the 51.8 ft
   * end zone at v = 49.40 and clears by 0.189. Checking the ends is what makes this
   * catch a quarter-foot error rather than a five-foot one.
   *
   * Which axis the ends run along comes from the wall the opening is in -- the facade
   * band runs in v, the gable band in u -- so this cannot be shortcut to "vary v".
   */
  function bayProbes(params: SuiteParams): { id: string; u: number; v: number }[] {
    const wins = windowsOf(params);
    const { walls } = buildWalls(buildSuite(params));
    const rects = bayRects(params);
    expect(rects.length, "one reveal per window opening").toBe(wins.length);
    return rects.flatMap((r, i) => {
      const w = walls.find((x) => x.id === wins[i]!.wallId)!;
      const alongV = w.dv > w.du;
      return [-0.5, 0, 0.5].map((t) => ({
        id: wins[i]!.id,
        u: r.u + (alongV ? 0 : t * r.w),
        v: r.v + (alongV ? t * r.w : 0),
      }));
    });
  }

  /**
   * Where the ring's long wall sits at this v, on the point's own side of the ridge.
   *
   * Marched outward from RIDGE_U rather than from the suite's own clear face. The
   * version this replaces started at u = 24.5 and returned -Infinity the moment that
   * face was itself outside the ring, so "this bay is 2 ft through the wall" and
   * "this bay is 20 ft through the wall" came back as the same unusable number.
   * From the ridge, a point outside the shell gets a NEGATIVE clearance, which is
   * what the cap test needs in order to show the cap can be violated at all.
   */
  function ringWallAt(u: number, v: number): number {
    const dir = u >= RIDGE_U ? 1 : -1;
    let last = NaN;
    for (let t = 0; t < 40; t += 0.005) {
      const p = RIDGE_U + dir * t;
      const s = buildingToSiteRef(p, v);
      if (!pointInPolygon([s.x, s.y], RING)) break;
      last = p;
    }
    // Loud rather than NaN: the ridge line itself is outside the footprint only if
    // the caller has handed over a v off the end of the building, and a NaN
    // clearance would lose every min() it passed through.
    if (!Number.isFinite(last)) {
      throw new Error(`no ring wall at v ${v.toFixed(2)}: the ridge is off the footprint there`);
    }
    return last;
  }

  /** Feet from a point to that wall. Negative means the point is outside the shell. */
  function wallClearance(u: number, v: number): number {
    return (u >= RIDGE_U ? 1 : -1) * (ringWallAt(u, v) - u);
  }

  /**
   * The tightest point of any bay: FOUND across every opening, not taken by index.
   * See the headroom test for what indexing cost.
   */
  function tightestBay(params: SuiteParams) {
    return bayProbes(params)
      .map((p) => ({ ...p, wall: ringWallAt(p.u, p.v), clearance: wallClearance(p.u, p.v) }))
      .reduce((a, b) => (b.clearance < a.clearance ? b : a));
  }

  function assertInsideRing(params: SuiteParams, label: string) {
    for (const p of bayProbes(params)) {
      const s = buildingToSiteRef(p.u, p.v);
      expect(
        pointInPolygon([s.x, s.y], RING),
        `${label} ${p.id} at u ${p.u.toFixed(2)} v ${p.v.toFixed(2)}`,
      ).toBe(true);
    }
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
        // 44 is the 1875-derived floor; below it bedroom B loses its depth. The top
        // was 60, which is 10 ft past what the building will take -- see the cap
        // test below. Sweeping past MAX_SECTION_LENGTH tests suites that cannot
        // exist, and the sweep reported it as a bay failure at 56.6 ft rather than
        // as the placement failure it is.
        sectionLength: 44 + rnd() * (MAX_SECTION_LENGTH - 44),
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
   * The ceiling on sectionLength, and that it is a real one.
   *
   * The sweep above used to run to 60 ft and failed, at 56.6, with a bay 2 ft outside
   * the shell. That was not a test artifact: Weld's waist is 46.9 ft across and the
   * suite is anchored on a 49 ft clear width, so a long enough end section pushes the
   * suite into a part of the building narrower than the suite is wide. The building
   * permits 50.25 ft, maxSectionLength() derives it from the ring, and the sweep now
   * tests that range.
   *
   * Both halves are asserted, because a bound that cannot be violated is not a bound.
   */
  it("caps sectionLength where Weld's waist stops taking the suite", () => {
    // The binding station, found again here rather than trusted. The reach is
    // measured from u = 0, the centreline place.ts anchors on, not as width / 2 --
    // the ring is 0.47 ft off-centre and half the width would spend that margin
    // twice.
    const reach = (s: Station) => {
      const span = s.spans.find(([lo, hi]) => lo <= 0 && hi >= 0)!;
      return Math.min(-span[0], span[1]);
    };
    const stations = ringStations();
    const narrow = stations.filter((s) => reach(s) < CLEAR_HALF_U);
    expect(narrow, "the waist is the only place the building is narrower than the suite")
      .toHaveLength(1);
    const waist = narrow[0]!;
    expect(waist, "and it is station 2 of the dumbbell").toBe(stations[2]);
    expect(waist.width, "the waist, ft").toBeCloseTo(46.89, 1);
    expect(reach(waist), "its reach against the suite's 24.5").toBeCloseTo(23.15, 1);

    // gable anchor south to the waist's north face: 70.15 - 19.90 = 50.25
    expect(MAX_SECTION_LENGTH).toBeCloseTo(GABLE_INNER_V - waist.v1, 9);
    expect(MAX_SECTION_LENGTH).toBeCloseTo(50.25, 1);
    expect(maxSectionLength(), "the exported value is the function's").toBe(MAX_SECTION_LENGTH);
    // and there is a range left for the sweep to sweep
    expect(MAX_SECTION_LENGTH).toBeGreaterThan(DEFAULT_PARAMS.sectionLength);

    // Tight in both directions, bracketed at the ring's own 0.1 ft coordinate
    // resolution rather than at the bound itself. Exactly AT the bound the suite's
    // south corner lands ON the waist's face: the station boundary is the lowest v of
    // a merged cluster and this cluster's four vertices spread over v 19.897 to
    // 19.916, so the bound is 0.017 ft generous and pointInPolygon there turns on a
    // fifth of an inch. A tenth of a foot either side is the finest honest bracket.
    //
    // Checked through place.ts's own transform, not the test's inverse of it: the
    // claim being made is about where place.ts puts the suite.
    const cornersOutside = (sectionLength: number, facade: "east" | "west") =>
      suiteCornersSite(buildSuite({ ...DEFAULT_PARAMS, sectionLength, facade })).filter(
        (c) => !pointInPolygon([c.site.x, c.site.y], RING),
      ).length;
    for (const facade of ["east", "west"] as const) {
      expect(cornersOutside(MAX_SECTION_LENGTH - 0.1, facade), `${facade}, a tenth under`).toBe(0);
      expect(
        cornersOutside(MAX_SECTION_LENGTH + 0.1, facade),
        `${facade}, a tenth over`,
      ).toBeGreaterThan(0);
    }

    // And the bays, which is how this was caught in the first place. AT the cap every
    // bay is still inside, and so it is one foot past: the bays are NOT what binds.
    // The southmost facade window is centred on a 15 ft common room, so it sits 3.5 ft
    // north of the suite's own south wall, and it does not leave the shell until
    // sectionLength passes 53.7 -- which is why the 44-to-60 sweep reported this at
    // 56.6 ft and not at 50.3. The cap is therefore derived from the suite's clear
    // width, which is the thing that actually stops fitting, rather than from where a
    // bay happens to notice 3.5 ft later.
    for (const over of [0, 1]) {
      const at = tightestBay({ ...DEFAULT_PARAMS, sectionLength: MAX_SECTION_LENGTH + over });
      expect(at.clearance, `${over} ft over the cap, ${at.id}`).toBeGreaterThan(0);
    }
    const past = tightestBay({ ...DEFAULT_PARAMS, sectionLength: MAX_SECTION_LENGTH + 4 });
    expect(
      past.clearance,
      `4 ft over the cap, ${past.id} at u ${past.u.toFixed(2)} v ${past.v.toFixed(2)}`,
    ).toBeLessThan(0);
  });

  /**
   * The half foot the whole bay question turns on, pinned.
   *
   * place.ts anchors the suite on weld.json's 49 ft clear width centred on u = 0.
   * The shell is the Harvard ArcGIS ring, whose north-end east wall is at u = 25.44
   * -- 51.8 ft wide and 0.47 ft off-centre, against Cambridge's 52.0. So the
   * modelled masonry face at CLEAR_HALF_U + masonry runs OUT of the shell, and the
   * reveal only fits because it is centred on the wall's mid-plane.
   *
   * These numbers are measurements, not choices. They are here so that a later change
   * to place.ts, to weld.json or to the ring reports itself instead of quietly
   * pushing the bays through the wall.
   *
   * WHAT THIS TEST USED TO GET WRONG, AND IT WAS NOT THE NUMBERS
   * It read bayRects()[0] and called it "the tightest point of any bay". That held
   * only while walls.ts centred every facade window on the wall BAND instead of on
   * the room it lights: all four then came back as one opening at suite v 18 to 26,
   * which lands in the narrow north end zone, which is where u = 25.44 is. With the
   * windows on their own rooms, bayRects()[0] is the common room's, out in a WING
   * station where the ring reaches u = 30.60 -- 5.36 ft of slack, one of the LOOSEST
   * bays in the model. The measurement was still real; the index was the accident.
   * So the bay is now searched for.
   */
  it("has under half a foot of headroom between place.ts and the ring", () => {
    const tight = tightestBay(DEFAULT_PARAMS);

    // the index the old version trusted is now nowhere near the tightest
    const first = bayRects()[0]!;
    expect(
      wallClearance(first.u, first.v + first.w / 2),
      "what bayRects()[0] measures now",
    ).toBeGreaterThan(5);
    // and the tightest bay is in the 51.8 ft north END zone, not out on a wing
    expect(tight.v, `tightest bay ${tight.id}`).toBeGreaterThan(ringStations()[4]!.v0);

    expect(tight.wall, "the ring's east wall there").toBeCloseTo(25.44, 1);

    // The mid-plane clears it, but only just: 0.153 ft. It read 0.22 while all four
    // windows were stacked at v 52.15; both are the same wall at different v, and the
    // difference is the wall's own 0.06 ft of wander over the end zone plus the 15 ft
    // between the two v values.
    expect(tight.clearance).toBeGreaterThan(0);
    expect(tight.clearance).toBeLessThan(0.3);

    // the wall's OUTER face does not clear it at all: a reveal box drawn to the
    // full masonry thickness pokes ~0.6 ft through the shell
    const outer = CLEAR_HALF_U + DEFAULT_PARAMS.masonry;
    expect(outer - tight.wall).toBeGreaterThan(0.5);

    // and the mid-plane itself leaves the ring once masonry passes ~1.8 ft (1.9 under
    // the stacked windows, for the same reason as above)
    const breaks = 2 * (tight.wall - CLEAR_HALF_U);
    expect(breaks).toBeGreaterThan(DEFAULT_PARAMS.masonry);
    expect(breaks).toBeLessThan(2);

    // The west facade has most of a foot, and the asymmetry is RIDGE_U: the ring's
    // mid-line is 0.47 ft west of the origin place.ts anchors on, so the east wall is
    // the near one and the west one is not the same measurement.
    expect(
      tightestBay({ ...DEFAULT_PARAMS, facade: "west" }).clearance,
      "the west facade's tightest bay",
    ).toBeGreaterThan(tight.clearance);
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
