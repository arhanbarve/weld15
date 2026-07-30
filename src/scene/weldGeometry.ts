/**
 * Weld Hall's exterior masses: the shell, a real gabled roof, two roof features
 * whose identity is unsettled, and the window bays.
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
 * WHY THE ROOF FEATURES SHIP WITH THREE DIFFERENT TAGS
 * An earlier revision emitted an empty geometry here and said so, on the ground that
 * extruding the ring's two slivers needs a plan width and a height above the ridge
 * and neither is in any source. That was right about the size and wrong to throw
 * away the position. But a later revision then over-corrected and called these the
 * 1875 staircase lanterns, which the evidence does not support:
 *
 *   sliver position  DERIVED. weld.rings[1] and [2] are two sub-foot slivers whose
 *                    centroids land at building u -9.87 and +9.09, symmetric about
 *                    the ridge to within 0.2 ft. That symmetry is real, it is the
 *                    only positional evidence in any of the five datasets, and
 *                    refusing to draw anything discarded it.
 *   identity         INFERRED AND CONTESTED. The 1875 text describes two CENTRAL
 *                    staircase halls with lanterns, and its own
 *                    143 = 44 + 15 + 25 + 15 + 44 chain puts those at v 12.3 to
 *                    27.3. These slivers sit at v +40.2 and -37.8, inside the 44 ft
 *                    end sections, 13 to 28 ft off that band and not central by any
 *                    reading -- so the position argues AGAINST the lantern reading
 *                    rather than for it. MACRIS names clustered chimney shafts in
 *                    the same sentence as the towers, and two symmetric near-ridge
 *                    features in the wing bays fit that at least as well. An earlier
 *                    draft of this comment claimed the ridge-straddle "is what two
 *                    central staircase halls means across a 62 ft building"; that
 *                    was a rationalisation and it is withdrawn. weld.json's
 *                    meta.towers.identification carries the full argument, and
 *                    TOWER_CONTROLS.name is "Roof feature" so the UI states the
 *                    measurement rather than the guess.
 *   size             INFERRED, and it stays inferred. The slivers are 0.31 and
 *                    0.22 ft wide -- the same class of degenerate ArcGIS part as the
 *                    three that took the campus count from 39 to 36 (audit sec 1
 *                    row 11) -- so their u extent is digitisation noise, not a wall
 *                    line.
 *
 * Neither feature falls inside Weld 15's own footprint: the north one is across the
 * ridge in the neighbouring suite's half and the south one is in the far end
 * section, so nothing in the suite's geometry depends on any of this.
 *
 * The project's answer to an inferred dimension is not to refuse it; it is to ship
 * it as a control carrying an INFERRED chip. That is what happened to the ceiling
 * height and to the bathroom's depth, and it is what P6 exists for. So the two
 * guesses live in weld.json under meta.towers with their basis written out, are
 * re-exported here as TOWER_CONTROLS for a slider to render, and are PARAMETERS of
 * towerGeometry() rather than constants inside it. Being wrong then costs a drag.
 * What is not acceptable is a guessed number presented as measured, so neither
 * number appears in this file as a literal.
 *
 * WHY sectionLength HAS A CEILING AND WHY THE CEILING IS NOT MEASURED IN THIS FILE
 * place.ts hangs the suite off the north gable and anchors it on a 49 ft clear
 * width, and Weld's waist is 46.9 ft across, so past a certain section length the
 * suite is wider than the building it is in. maxSectionLength() measures where that
 * happens -- 50.25 ft south of the anchor -- and that is the number P6's
 * sectionLength slider has to clamp to. It used to be derived here, off
 * ringStations(); it is now derived in place.ts and re-exported below, because
 * state/url.ts needs it too and this module imports three. The re-export's own
 * docblock has the argument.
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
  /** the two roof features, seated on the roof and capped above the ridge */
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
 * and are the same whatever the suite sliders do. `towers` is a second argument
 * rather than a field of SuiteParams because it describes the building, not the
 * suite, and because SuiteParams is a fixed interface three other modules build
 * against. Both are defaulted, so buildWeld() and buildWeld(params) still mean
 * what they meant.
 */
export function buildWeld(
  params: SuiteParams = DEFAULT_PARAMS,
  towers: TowerParams = TOWER_DEFAULTS,
): WeldMasses {
  return {
    walls: extrudedGeometry(weld.rings[0] as number[][], WELD.eaves),
    roof: gableRoof(),
    towers: towerGeometry(towers),
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
 * The clamp on sectionLength, re-exported from where it can actually live.
 *
 * It was derived here, off ringStations(), and it reads as if it belongs here. It
 * cannot: state/url.ts validates a shared link against it, and importing it from this
 * module put three.js into the state layer -- which is a layering rule with teeth,
 * because tests/drift.test.ts runs scripts/emit-*.mjs in plain node and three in the
 * reachable set is an ERR_MODULE_NOT_FOUND at import. So the derivation moved to
 * geo/place.ts, which is three-free and already marches this ring for the facade step,
 * and its docblock there carries the measurement, the clamp argument and the trap.
 *
 * Re-exported rather than left for callers to re-point: this is where every scene
 * module and tests/weldGeometry.test.ts have always read it, and the number is the
 * same number.
 */
export { maxSectionLength, MAX_SECTION_LENGTH } from "@/geo/place";

/**
 * The height of the roof surface over a point in the building frame.
 *
 * The same interpolation gableRoof() draws, read the other way round: on the line
 * v = const the roof runs straight from the eaves at the footprint's boundary up
 * to the ridge, so the height is linear in the distance from RIDGE_U as a fraction
 * of that side's own run. The run is measured per v, which is what makes this
 * correct on a dumbbell -- over the wings it is 31.1 ft and over the waist 23.4,
 * and a single averaged pitch would sit feet off in both places.
 *
 * Throws outside the footprint rather than clamping. A tower whose plan corner has
 * left the building has no roof under it, and returning the eaves height there
 * would seat it on thin air while every height assertion still passed.
 */
export function roofHeightAt(u: number, v: number): number {
  const span = spansAt(v).find(([lo, hi]) => u >= lo && u <= hi);
  if (!span) {
    throw new Error(`weldGeometry: u ${u.toFixed(2)} v ${v.toFixed(2)} is outside the footprint`);
  }
  // The eaves edge on this point's own side of the ridge.
  const bound = u < RIDGE_U ? span[0] : span[1];
  const run = Math.abs(RIDGE_U - bound);
  const t = Math.min(Math.abs(u - RIDGE_U) / run, 1);
  return WELD.ridge - (WELD.ridge - WELD.eaves) * t;
}

/**
 * The ring's narrow lobes: candidate staircase towers, measured not indexed.
 *
 * A tower carried above the eaves would show up either as a station narrower than
 * LOBE_MAX_WIDTH or as a second span inside a station. This ring has neither: its
 * five stations are 51.8 / 62.2 / 46.9 / 62.2 / 51.8 ft, each one piece. So this
 * returns [] on the real data, and the towers come from weld.rings[1] and [2]
 * instead -- see towerCentres(). Kept, and kept tested, as the positive control:
 * "the towers are not in ring[0]" is worth nothing unless the thing that looked
 * for them can find the wings that ARE there.
 */
export function narrowLobes(): Station[] {
  return ringStations().filter(
    (s) => s.width < LOBE_MAX_WIDTH || s.spans.some(([lo, hi]) => hi - lo < LOBE_MAX_WIDTH),
  );
}

/** The two dimensions of a staircase lantern that no source gives. Feet. */
export type TowerParams = {
  /** plan width, square in the building frame */
  width: number;
  /** how far the cap clears WELD.ridge */
  heightAboveRidge: number;
};

/**
 * What a P6 slider needs to render one of these without a second copy of the
 * number: the value, a range, the tag, and the basis in one line.
 *
 * The values come from weld.json, the bases are abridged from the same block, and
 * the two upper bounds are SOURCED numbers rather than picked ones -- the 1875
 * stair hall's short dimension for the width, since a lantern cannot be wider than
 * the well it lights, and Cambridge's 12.0 ft floor-to-floor for the height, since
 * a roof feature that reaches a full storey is a storey. The lower bounds are the
 * degenerate cases: the sliver's own measured u extent, 0.31 ft, which is what the
 * data literally contains, and a rise of zero, which is the no-lantern case that
 * the 1875 wording -- "rises above the roof" -- is the only thing to rule out. Both
 * ends of both sliders are therefore somebody's claim rather than a round number.
 */
export const TOWER_CONTROLS = {
  provenance: "INFERRED",
  /**
   * What the UI must call them, and why it is not "staircase tower".
   *
   * The 1875 text does describe two stair-hall lanterns, and it is tempting to
   * label these as those. The positions say otherwise: that text calls the halls
   * CENTRAL and its own 143 ft chain puts them at v 12.3 to 27.3, while these two
   * features sit at v +40.2 and -37.8, inside the end sections. Symmetric about the
   * ridge, certainly -- which is why they are modelled -- but not central, and
   * MACRIS mentions clustered chimney shafts in the same sentence as the towers,
   * which fits two near-ridge features in the wing bays at least as well.
   *
   * So the label states the measurement and not the guess. weld.json's
   * `towers.identification` carries the full argument.
   */
  name: "Roof feature",
  identification: weld.meta.towers.identification,
  width: {
    value: weld.meta.towers.plan_width_ft_estimate,
    min: weld.meta.towers.positions[0]!.sliver_u_extent_ft,
    max: weld.meta.primary_source_1875.stair_hall_ft[0]!,
    unit: "ft",
    label: "Roof feature plan width",
    basis: weld.meta.towers.plan_width_basis,
  },
  heightAboveRidge: {
    value: weld.meta.towers.height_above_ridge_ft_estimate,
    min: 0,
    max: weld.meta.floor_to_floor_ft,
    unit: "ft",
    label: "Roof feature rise above the ridge",
    basis: weld.meta.towers.height_above_ridge_basis,
  },
} as const;

/** The inferred defaults, read from weld.json so the guess is stated in one place. */
export const TOWER_DEFAULTS: TowerParams = {
  width: TOWER_CONTROLS.width.value,
  heightAboveRidge: TOWER_CONTROLS.heightAboveRidge.value,
};

/** One staircase lantern's plan centre, measured off its own sliver. */
export type TowerCentre = {
  /** which end of the building the sliver sits toward */
  id: "north" | "south";
  /** which weld.rings entry it was measured from */
  ring: number;
} & Building;

/**
 * Where the two lanterns are: the centroid of each sliver, in the building frame.
 *
 * DERIVED, not indexed and not typed in. weld.json's meta.towers.positions records
 * the answer and the test asserts the record still matches, but this is the
 * computation and the record is downstream of it.
 *
 * The centroid is the mean of the sliver's distinct vertices. Both slivers are
 * TRIANGLES, so that mean IS the area centroid exactly, and it gets there without
 * dividing by their 1.23 and 0.81 sq ft. The test comes at the same two points by
 * the shoelace route instead, which agrees to a thousandth of a foot today and
 * would part company the moment either ring gained a fourth vertex -- at which
 * point the vertex mean stops being the centroid and this function is wrong.
 *
 * Recorded because it will look like an error later: in u the two land either side
 * of the ridge, as "two central staircase halls" requires, but in v they land at
 * +40.2 and -37.8, out in the projecting wing zones rather than in the stair-hall
 * band that the 1875 chain 143 = 44 + 15 + 25 + 15 + 44 puts at v 12.4 to 27.4 and
 * place.ts builds the suite against. The slivers are still the only positional
 * evidence in any of the five datasets, and MACRIS puts gabled projections on both
 * facades at just these stations, so they are used as they are. Do not quietly
 * move the towers onto the chain and call it a correction.
 */
export function towerCentres(): TowerCentre[] {
  return [1, 2].map((i) => {
    const ring = weld.rings[i] as number[][];
    // Drop the repeated closing vertex; what is left is the triangle itself.
    const pts = ring.slice(0, -1).map((p) => siteToBuilding({ x: p[0]!, y: p[1]! }));
    const u = pts.reduce((a, p) => a + p.u, 0) / pts.length;
    const v = pts.reduce((a, p) => a + p.v, 0) / pts.length;
    return { id: v > 0 ? "north" : "south", ring: i, u, v };
  });
}

/**
 * The two roof features: a mass per sliver, seated on the slate and capped above
 * the ridge.
 *
 * Sliver position DERIVED, identity INFERRED AND CONTESTED, size INFERRED -- see the
 * module header for all three and for why the lantern reading is a candidate rather
 * than the answer, and weld.json meta.towers for the basis of each number.
 *
 * WHERE THE BASE SITS, AND WHY IT IS NOT THE EAVES
 * The features stand out on the slope, 9.4 and 9.6 ft off the ridge, where the roof
 * has already fallen ~7.7 ft below it. Seating them at the eaves would bury 15 ft
 * of each one inside the roof; seating them at the roof height under their CENTRE
 * would leave a wedge of daylight under the downhill wall, because the slate falls
 * 6.5 ft across a 7.9 ft plan at this pitch. So the base is the roof height at the
 * LOWEST of the four plan corners: the downhill wall meets the slate exactly and
 * the other three are buried, which is the way round that cannot show a gap.
 *
 * Built with Builder.box() rather than by hand, for the reason its own docblock
 * gives: it winds every face against an outward reference in the building frame, so
 * the lanterns cannot disagree with the shell about which way is out. The bottom
 * cap is emitted too -- it is invisible under the slate, and it is what makes the
 * mass closed for the same divergence-theorem volume check extrude.ts relies on.
 */
function towerGeometry(p: TowerParams = TOWER_DEFAULTS): THREE.BufferGeometry {
  const b = new Builder();
  const top = WELD.ridge + p.heightAboveRidge;
  for (const c of towerCentres()) {
    b.box({ u: c.u, v: c.v }, p.width, p.width, towerBase(c, p.width), top);
  }
  return b.build();
}

/** The roof height under a lantern's lowest plan corner. */
function towerBase(c: Building, width: number): number {
  const signs: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  return Math.min(
    ...signs.map(([su, sv]) => roofHeightAt(c.u + (su * width) / 2, c.v + (sv * width) / 2)),
  );
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
