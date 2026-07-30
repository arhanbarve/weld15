/**
 * Weld Hall's exterior masses: the shell, a real gabled roof, the towers the data
 * will not support, and the window bays.
 *
 * WHY THIS REPLACES roofGeometry()
 * geometry.ts's roofGeometry() fans every eaves vertex to one apex point. On a
 * 56-vertex ring that is a 56-sided cone, which P2 shipped knowing it was a
 * placeholder. A gable is the same fan with the apex replaced by a LINE: every
 * eaves edge rises to the ridge at its own v, so the top of the roof is the
 * segment u = RIDGE_U rather than a point. That one change is the whole module's
 * geometric idea.
 *
 * WHY THE BUILDING FRAME
 * The ring is a 59-point GIS polygon rotated 13.2 deg off north, and reasoning
 * about a ridge on it in the site frame is how this goes wrong: the ridge is not
 * parallel to any ring edge, to any axis, or to any bounding box. Rotated into the
 * building frame (frames.ts, u across and v along the 13.2 deg axis) the ring is
 * rectilinear to within 0.15 ft and the ridge is trivially the line u = RIDGE_U.
 * Every roof vertex is computed there and converted out through buildingToSite /
 * toThree, so the bearing is exact by construction rather than by adjustment.
 *
 * WHY THE PITCH CHANGES ALONG THE BUILDING, AND WHY THAT IS NOT A BODGE
 * Weld is a dumbbell (audit sec 2a, weld.json shape_note): 51.8 ft at the gable
 * ends, 62.2 ft across the wings, 46.9 ft at the waist, measured off this ring by
 * ringStations() below. Three facts are fixed by data -- eaves 60.0 ft, ridge
 * 85.4 ft, and that footprint -- and no single-pitch roof satisfies all three:
 *
 *   one pitch, level ridge   -> the roof plane crosses 60 ft at a fixed distance
 *                               from the ridge, so it lands 2.3 ft outside the
 *                               waist walls and 5.3 ft inside the wing walls
 *   one pitch, no overhang   -> the ridge dips to 83.2 ft over the waist
 *   cross gables over wings  -> needs a wing ridge height, which no source gives
 *
 * The third is the only one that looks like the real building, and it is the one
 * that would require inventing a dimension, so it is refused (see the findings for
 * P4). What is built instead: the eaves follow the real ring exactly, the ridge is
 * level at 85.4 ft over the whole 142.9 ft, and the pitch therefore steepens over
 * the waist (47.1 deg) and flattens over the wings (39.2 deg). The change of pitch
 * shows up as a vertical triangle above each wing side wall, up to 6.1 ft tall,
 * which the same edge-fan emits with no special case. Every number in the roof is
 * read from weld.json or measured off the ring; none is chosen.
 *
 * WHY THE BAY REVEALS SIT AT THE MASONRY MID-PLANE
 * place.ts anchors the suite on a 49 ft clear width centred on u = 0, so its
 * exterior masonry face lands at u = 26.0 while this ring's east wall is at
 * u = 25.44 relative to the same origin -- the 52.0 ft Cambridge figure against
 * the 51.8 ft Harvard ArcGIS ring, plus the ring's own 0.47 ft off-centre. A bay
 * centred on the wall's outer face is therefore OUTSIDE the shell. Centring on the
 * wall's mid-thickness puts it inside, and is also what a reveal is.
 */

import * as THREE from "three";
import weld from "@/data/weld.json";
import { normalizeRing } from "@/geo/extrude";
import {
  buildingToSite,
  siteToBuilding,
  toThree,
  type Building,
  type Vec3,
} from "@/geo/frames";
import { buildSuite, DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import { WELD, floorLevel, suiteToBuilding } from "@/geo/place";
import { extrudedGeometry } from "./geometry";

export type WeldMasses = {
  /** the 59-point ring extruded to eaves (60 ft) */
  walls: THREE.BufferGeometry;
  /** gabled, ridge along the 13.2 deg long axis, 85.4 ft */
  roof: THREE.BufferGeometry;
  /** the ring's two narrow slivers, carried above the eaves */
  towers: THREE.BufferGeometry;
  /** window reveals, one box per opening of kind "window" */
  bays: THREE.BufferGeometry;
};

/** A window reveal in the building frame: centre, opening width, opening height. */
export type BayRect = { u: number; v: number; w: number; h: number };

/** One measured slice of the footprint along the long axis. */
export type Station = {
  /** building-frame v of the slice's south and north ends */
  v0: number;
  v1: number;
  /** total footprint width across the slice, ft */
  width: number;
  /** the inside u intervals at the slice's midpoint; more than one means a lobe */
  spans: [number, number][];
};

/**
 * Two ring vertices whose v differ by less than this belong to the same station
 * boundary, in feet. Measured: a wall that should be perpendicular to the axis
 * wobbles by up to 0.15 ft in this ring (the north gable spans v = 72.15 to
 * 72.25) because the coordinates are given to a tenth of a foot. The shortest
 * genuine station in weld.json's shape_note is the 23 ft end zone, so 1 ft sits an
 * order of magnitude below the shortest real feature and above the noise.
 */
const STATION_EPS = 1;

/**
 * Two adjacent slices whose widths differ by less than this are one station, ft.
 * Same reasoning: the wing projection is 5.2 ft, the digitisation noise is 0.15.
 */
const PLATEAU_EPS = 1;

/**
 * A ring lobe narrower than this is a tower sliver rather than a wing, ft. From
 * docs/phases/P4-P5.md, which sets it at "under ~14 ft"; the narrowest station
 * this ring actually has is the 46.9 ft waist.
 */
const LOBE_MAX_WIDTH = 14;

/** Weld's own ring, normalised: counter-clockwise, no degenerate edges. */
const RING = normalizeRing(weld.rings[0] as number[][]);

/** The same ring without the repeated closing vertex. */
const LOOP: [number, number][] = RING.slice(0, -1).map((p) => [p[0]!, p[1]!]);

/** The ring in the building frame, vertex for vertex with LOOP. */
const LOOP_B: Building[] = LOOP.map(([x, y]) => siteToBuilding({ x, y }));

/**
 * The ridge's u in the building frame: the mid-line of the ring's own u extent.
 *
 * Not 0. The site origin is Weld's centroid as published, but this ring's u extent
 * runs -31.63 to 30.70, so its mid-line is 0.47 ft west of the origin. Taking the
 * measured mid-line is what makes the two roof planes the same pitch; taking u = 0
 * would leave the west slope a foot longer than the east one.
 */
export const RIDGE_U = midU(LOOP_B);

function midU(pts: Building[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    if (p.u < lo) lo = p.u;
    if (p.u > hi) hi = p.u;
  }
  return (lo + hi) / 2;
}

/**
 * Weld's exterior, as four geometries.
 *
 * `params` only reaches the bays: the shell and the roof come from the GIS ring
 * and are the same whatever the suite sliders do.
 */
export function buildWeld(params: SuiteParams = DEFAULT_PARAMS): WeldMasses {
  return {
    walls: extrudedGeometry(weld.rings[0] as number[][], WELD.eaves),
    roof: gableRoof(),
    towers: towerGeometry(),
    bays: bayGeometry(params),
  };
}

/**
 * The gable: every eaves edge fanned up to the ridge LINE at its own v.
 *
 * Edges that run along the building (the long facades) become sloping roof
 * planes. Edges that run across it (the two gable ends, and the four wing side
 * walls) become vertical triangles, because their two ridge points collapse onto
 * one another -- which is exactly the triangular gable wall that closes each end.
 * No branch distinguishes the two cases; the geometry does it.
 */
function gableRoof(): THREE.BufferGeometry {
  const b = new Builder();

  for (let i = 0; i < LOOP.length; i++) {
    const a = LOOP[i]!;
    const c = LOOP[(i + 1) % LOOP.length]!;
    const av = LOOP_B[i]!;
    const cv = LOOP_B[(i + 1) % LOOP.length]!;

    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const len = Math.hypot(dx, dy);
    // Interior lies left of travel on a counter-clockwise ring, so the outward
    // horizontal is the right-hand perpendicular. Same formula as extrude.ts's
    // side walls, so the roof and the shell cannot disagree on which way is out.
    const outward = toThree(dy / len, -dx / len, 0);

    b.quad(
      toThree(a[0], a[1], WELD.eaves),
      toThree(c[0], c[1], WELD.eaves),
      ridgePoint(cv.v),
      ridgePoint(av.v),
      outward,
    );
  }

  return b.build();
}

/** The point on the ridge at a given position along the building. */
function ridgePoint(v: number): Vec3 {
  const s = buildingToSite({ u: RIDGE_U, v });
  return toThree(s.x, s.y, WELD.ridge);
}

/**
 * Slice the footprint across the long axis and measure each slice.
 *
 * Boundaries are every ring vertex's v, with near-coincident ones merged, and the
 * width is ray-cast at each slice's midpoint rather than read off a vertex, so a
 * wall that is 0.1 ft out of square does not invent a station. Adjacent slices of
 * the same width are then merged, which is what turns 30-odd intervals into the
 * five-station dumbbell weld.json describes.
 */
export function ringStations(): Station[] {
  const vs = LOOP_B.map((p) => p.v).sort((x, y) => x - y);
  const cuts: number[] = [];
  for (const v of vs) {
    const last = cuts[cuts.length - 1];
    if (last !== undefined && v - last < STATION_EPS) continue;
    cuts.push(v);
  }

  const out: Station[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const v0 = cuts[i]!;
    const v1 = cuts[i + 1]!;
    const spans = spansAt((v0 + v1) / 2);
    const width = spans.reduce((a, s) => a + (s[1] - s[0]), 0);
    const prev = out[out.length - 1];
    // Merge into the previous station if it is the same width AND the same number
    // of pieces: a slice that gained a second span is a lobe, not a plateau.
    if (prev && prev.spans.length === spans.length && Math.abs(prev.width - width) < PLATEAU_EPS) {
      prev.v1 = v1;
      continue;
    }
    out.push({ v0, v1, width, spans });
  }
  return out;
}

/** The inside u intervals of the footprint on the line v = const. */
function spansAt(v: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < LOOP_B.length; i++) {
    const a = LOOP_B[i]!;
    const c = LOOP_B[(i + 1) % LOOP_B.length]!;
    // Half-open, same rule as collide.ts's pointInPolygon: an edge owns its lower
    // endpoint and not its upper one, so a line through a vertex crosses once.
    if (a.v > v === c.v > v) continue;
    xs.push(a.u + ((c.u - a.u) * (v - a.v)) / (c.v - a.v));
  }
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i]!, xs[i + 1]!]);
  return out;
}

/**
 * The ring's narrow lobes: candidate staircase towers, measured not indexed.
 *
 * A tower carried above the eaves would show up either as a station narrower than
 * LOBE_MAX_WIDTH or as a second span inside a station. This ring has neither: its
 * five stations are 51.8 / 62.2 / 46.9 / 62.2 / 51.8 ft, each one piece. So this
 * returns [] on the real data, and towerGeometry() returns nothing.
 */
export function narrowLobes(): Station[] {
  return ringStations().filter(
    (s) => s.width < LOBE_MAX_WIDTH || s.spans.some(([lo, hi]) => hi - lo < LOBE_MAX_WIDTH),
  );
}

/**
 * The two staircase towers, which are not in the data.
 *
 * The 1875 specification is explicit that Weld has "two central staircase halls
 * ... lighted and ventilated each by a lantern or louvre which rises above the
 * roof", and MACRIS CAM.184 describes a skyline broken by two staircase towers. So
 * the towers are real. They are not measurable here:
 *
 *   - weld.rings[0] yields no lobe under 14 ft (narrowLobes() is empty)
 *   - weld.rings[1] and [2] ARE two narrow slivers, and they sit where the two
 *     central stair halls should be -- building v 34.6 to 43.0 and -40.3 to -32.8,
 *     one either side of the ridge -- but they measure 0.31 and 0.22 ft wide and
 *     1.23 and 0.81 sq ft. That is the same class of degenerate ArcGIS sliver as
 *     the three that took the campus count from 39 to 36 (audit sec 1 row 11).
 *
 * Extruding a 0.3 ft sliver needs a plan width and a height above the ridge, and
 * neither exists in weld.json, in the 1875 text, or anywhere else in this project.
 * Inventing them is the failure mode the dimension audit exists to prevent, so
 * this stays empty and the gap is reported instead.
 */
function towerGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(0), 3));
  return g;
}

/**
 * Window reveals in the building frame, one per opening of kind "window".
 *
 * Taken from buildWalls() verbatim -- same wall, same offset, same width -- so the
 * exterior bay and the interior window are the one hole. Recentring them here
 * would look better and would break exactly that.
 */
export function bayRects(params: SuiteParams = DEFAULT_PARAMS): BayRect[] {
  return bays(params).map(({ u, v, w, h }) => ({ u, v, w, h }));
}

type Bay = BayRect & {
  /** the wall's own thickness, ft: how deep the reveal cuts */
  through: number;
  /** whether the opening's width runs along the building or across it */
  alongV: boolean;
};

function bays(params: SuiteParams): Bay[] {
  const suite = buildSuite(params);
  const { walls, openings } = buildWalls(suite);
  const byId = new Map(walls.map((w) => [w.id, w]));
  const out: Bay[] = [];

  for (const o of openings) {
    if (o.kind !== "window") continue;
    const wall = byId.get(o.wallId);
    if (!wall) continue;

    // The wall's long axis is the one the offset runs along; the short one is its
    // thickness, and the reveal is centred through it.
    const alongV = wall.dv > wall.du;
    const through = alongV ? wall.du : wall.dv;
    const mid = o.offset + o.width / 2;
    const su = alongV ? wall.u + through / 2 : wall.u + mid;
    const sv = alongV ? wall.v + mid : wall.v + through / 2;

    const b = suiteToBuilding(su, sv, params);
    out.push({ u: b.u, v: b.v, w: o.width, h: params.ceiling, through, alongV });
  }
  return out;
}

/** One reveal box per bay, cut through the wall at the suite's floor level. */
function bayGeometry(params: SuiteParams): THREE.BufferGeometry {
  const b = new Builder();
  const y0 = floorLevel(1);
  for (const bay of bays(params)) {
    const du = bay.alongV ? bay.through : bay.w;
    const dv = bay.alongV ? bay.w : bay.through;
    b.box({ u: bay.u, v: bay.v }, du, dv, y0, y0 + bay.h);
  }
  return b.build();
}

/** A building-frame direction as a unit vector in three.js space. */
function dirThree(d: Building): Vec3 {
  const s = buildingToSite(d);
  const v = toThree(s.x, s.y, 0);
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Triangle soup with unshared vertices and one flat normal per quad.
 *
 * Unshared for the reason extrude.ts gives: averaging normals across a corner
 * rounds off exactly the edges the massing is made of. Per QUAD rather than per
 * triangle because the fan quads over the gable ends are near-degenerate -- their
 * two ridge points are under 0.1 ft apart -- and the second triangle's own normal is
 * numerical noise, while Newell's sum over the whole quad is stable.
 */
class Builder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private idx: number[] = [];

  /**
   * A quad, wound so its normal agrees with `outward`.
   *
   * The winding is decided against a reference direction rather than derived by
   * hand, because the site frame is y-north and three.js is y-up: the handedness
   * flips in that swap, and a sign guessed wrong there inverts every face in the
   * building while leaving the silhouette correct.
   */
  quad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, outward: Vec3): void {
    const n = newell([p0, p1, p2, p3]);
    const dot = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2];
    // Loud rather than partial: a quad whose plane is perpendicular to its own
    // outward reference means the caller's reference is wrong, and guessing the
    // winding there is how a mass ends up inside out.
    if (!(Math.abs(dot) > 1e-6)) {
      throw new Error("weldGeometry: quad normal is perpendicular to its outward reference");
    }
    const flip = dot < 0;
    const nn: Vec3 = flip ? [-n[0], -n[1], -n[2]] : n;
    const q = flip ? [p3, p2, p1, p0] : [p0, p1, p2, p3];

    const base = this.pos.length / 3;
    for (const p of q) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nn[0], nn[1], nn[2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** An axis-aligned box in the BUILDING frame, between two heights. */
  box(c: Building, du: number, dv: number, y0: number, y1: number): void {
    const signs: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const corners = signs.map(([su, sv]) =>
      buildingToSite({ u: c.u + (su * du) / 2, v: c.v + (sv * dv) / 2 }),
    );
    const lo = corners.map((s) => toThree(s.x, s.y, y0));
    const hi = corners.map((s) => toThree(s.x, s.y, y1));
    const uh = dirThree({ u: 1, v: 0 });
    const vh = dirThree({ u: 0, v: 1 });
    const neg = (d: Vec3): Vec3 => [-d[0], -d[1], -d[2]];

    this.quad(lo[0]!, lo[3]!, hi[3]!, hi[0]!, neg(uh));
    this.quad(lo[1]!, lo[2]!, hi[2]!, hi[1]!, uh);
    this.quad(lo[0]!, lo[1]!, hi[1]!, hi[0]!, neg(vh));
    this.quad(lo[2]!, lo[3]!, hi[3]!, hi[2]!, vh);
    this.quad(lo[0]!, lo[1]!, lo[2]!, lo[3]!, [0, -1, 0]);
    this.quad(hi[0]!, hi[1]!, hi[2]!, hi[3]!, [0, 1, 0]);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Newell's method: the area-weighted normal of a polygon, stable when it is thin. */
function newell(ps: Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i]!;
    const b = ps[(i + 1) % ps.length]!;
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const len = Math.hypot(x, y, z);
  if (!(len > 0)) throw new Error("weldGeometry: degenerate quad has no normal");
  return [x / len, y / len, z / len];
}
