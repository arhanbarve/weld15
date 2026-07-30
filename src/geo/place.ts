/**
 * Placing the suite inside Weld Hall.
 *
 * rooms.ts works in the suite frame, which knows nothing about the building.
 * This module is the only thing that knows where in Weld the suite actually
 * sits, and it is what makes params.facade mean something -- until this existed
 * that field was declared and consumed by nothing, which a verification pass
 * caught before P2 tried to render.
 *
 * FRAMES, outermost first
 *   site      x east, y north, feet, origin at Weld's centroid  (frames.ts)
 *   building  u across, v along the 13.2 deg axis, same origin  (frames.ts)
 *   suite     u inward from the facade, v north from the south wall  (rooms.ts)
 *
 * WHERE THE SUITE SITS
 * Weld 15 is the fifth suite on the first floor, in the north half of the
 * corridor (Crimson 12 Sept 1951 and 22 Nov 1983, plus the housing portal's
 * "entryway Weld 1"). The 1875 specification decomposes the building's 143 ft
 * length as 44 ft end section, 15 ft stair hall, 25 ft porch, 15 ft stair hall,
 * 44 ft end section. Our suite occupies the north end section, so its v = 0 lies
 * 44 ft south of the gable's interior face and its v = sectionLength touches it.
 *
 * See docs/FINAL-LAYOUT.md for why, and for the runner-up arrangement.
 */

import weld from "@/data/weld.json";
import { siteToBuilding, buildingToSite, toThree, type Building, type Site, type Vec3 } from "./frames";
import { provideFacadeStep, type Rect, type SuiteParams, type Suite } from "./rooms";

/** Weld's own dimensions, from weld.json so there is one source of truth. */
export const WELD = {
  length: weld.meta.length_ft,
  gableWidth: weld.meta.width_ft_gable_end_north,
  clearWidth: weld.meta.clear_width_gable_end_ft,
  masonry: 1.5,
  /** floors are 12 ft apart; the first floor sits one storey above the basement */
  floorToFloor: weld.meta.floor_to_floor_ft,
  eaves: weld.meta.eave_height_ft,
  ridge: weld.meta.ridge_height_ft,
} as const;

/** Distance along the axis from the centroid to the gable's INTERIOR face. */
export const GABLE_INNER_V = WELD.length / 2 - WELD.masonry;

/** Half the clear width, i.e. the interior face of either long facade. */
export const CLEAR_HALF_U = WELD.clearWidth / 2;

/**
 * Suite frame to building frame.
 *
 * With the east facade: suite u = 0 is the east interior face, so building u
 * decreases as we move inward. With the west facade it increases. Suite v =
 * sectionLength touches the gable, so building v = GABLE_INNER_V there.
 */
export function suiteToBuilding(su: number, sv: number, params: SuiteParams): Building {
  const east = params.facade === "east";
  return {
    u: east ? CLEAR_HALF_U - su : -CLEAR_HALF_U + su,
    v: GABLE_INNER_V - (params.sectionLength - sv),
  };
}

export function suiteToSite(su: number, sv: number, params: SuiteParams): Site {
  return buildingToSite(suiteToBuilding(su, sv, params));
}

/** Suite frame plus a height to three.js world space. */
export function suiteToThree(su: number, sv: number, z: number, params: SuiteParams): Vec3 {
  const s = suiteToSite(su, sv, params);
  return toThree(s.x, s.y, z);
}

/**
 * WHERE THE FACADE STEPS, AND WHY THE MEASUREMENT LIVES IN THIS MODULE
 *
 * Weld is a dumbbell (audit sec 2a, weld.json shape_note). Measured off the ring
 * below, its east wall stands at building u 30.61 south of v 48.45 and at u 25.44
 * north of it, so the wings project 5.17 ft; on the west the same step is 5.30 ft.
 * The suite's 44 ft section runs from building v 26.15 to 70.15, so it CROSSES that
 * step, and rooms.ts models one straight facade line at suite u = 0. Consequence,
 * measured against the suite's own masonry mid-plane at building u 25.25: the
 * unknown strip, the bathroom and bedroom B sit in the end zone and miss the real
 * wall by 0.19 ft, which is right, while the common room and K sit in the wing zone
 * and miss it by 5.36 ft, which is why the common room's "facade window" is not on
 * an exterior wall at all.
 *
 * rooms.ts's params.wingStep exists to follow that step, and it needs two numbers
 * this module is the only one that can produce: how far the wall moves, and where
 * along the suite's own v it moves. So the derivation is HERE, and it is handed to
 * rooms.ts by provideFacadeStep() at the bottom of this file rather than imported
 * from there -- rooms.ts's own docblock on measuredFacadeStep carries the reason.
 * Three routes to the measurement were available and two are worse:
 *
 *   import ringStations() from weldGeometry.ts   REFUSED. It would be the same
 *     measurement, already written, but weldGeometry.ts imports this module, so
 *     importing it back is a cycle whose top-level MAX_SECTION_LENGTH would read
 *     GABLE_INNER_V before this module had assigned it. Worse, weldGeometry.ts
 *     imports three, and rooms.ts importing this module would then pull three into
 *     the pure geometry layer. That rule is not negotiable, so this is not either.
 *   a literal 5.2 in rooms.ts                   REFUSED. docs/DIMENSION-AUDIT.md
 *     sec 1 is a list of what typing a measured number into a second file costs.
 *   a third module both could import                Nothing to argue against, and
 *     it is where this belongs if a third caller ever wants it. Not taken now
 *     because the brief for this change allows two files to be edited and creating
 *     one is not one of them.
 *
 * What is duplicated by that choice is small and stated: facadeReachAt() is
 * spansAt() from weldGeometry.ts narrowed to "how far does the footprint reach on
 * one side", and facadeZones() is ringStations() with the width replaced by that
 * reach. The two epsilons below are the same numbers, for the same reason, and if
 * the ring is ever replaced both files have to be looked at.
 */

/**
 * Two ring vertices whose v differ by less than this are one zone boundary, ft.
 * weldGeometry.ts's STATION_EPS, and the same argument: a wall that should be
 * perpendicular to the axis wobbles by up to 0.15 ft in this ring because the
 * coordinates are published to a tenth of a foot, and the shortest real feature is
 * the 23 ft end zone.
 */
const ZONE_EPS = 1;

/** Two adjacent slices whose facade-side reach agrees within this are one zone, ft. */
const PLATEAU_EPS = 1;

/**
 * The ring in the building frame, closing vertex dropped.
 *
 * NOT normalizeRing()'d, unlike weldGeometry.ts's copy. That would drag
 * geo/extrude.ts in for nothing: normalizeRing fixes winding and drops degenerate
 * edges, and a ray cast across the polygon cares about neither -- a zero-length
 * edge contributes no crossing and a reversed loop crosses the same line the same
 * number of times.
 */
const RING_B: Building[] = (weld.rings[0] as number[][])
  .slice(0, -1)
  .map((p) => siteToBuilding({ x: p[0]!, y: p[1]! }));

/**
 * How far the footprint reaches from u = 0 on one facade's side, at v = const, ft.
 *
 * Measured from the suite's own centreline rather than taken as half the width, for
 * the reason weldGeometry.ts's centrelineHalfWidth() gives: this ring's mid-line is
 * 0.47 ft west of the published centroid the suite is anchored on, so the two sides
 * are not mirror images and half a width is neither of them.
 *
 * The crossing rule is half-open, the same one collide.ts's pointInPolygon uses, so
 * a line through a vertex crosses once rather than twice or not at all.
 */
function facadeReachAt(v: number, facade: SuiteParams["facade"]): number {
  const east = facade === "east";
  let reach = -Infinity;
  for (let i = 0; i < RING_B.length; i++) {
    const a = RING_B[i]!;
    const c = RING_B[(i + 1) % RING_B.length]!;
    if (a.v > v === c.v > v) continue;
    const u = a.u + ((c.u - a.u) * (v - a.v)) / (c.v - a.v);
    reach = Math.max(reach, east ? u : -u);
  }
  return reach;
}

type FacadeZone = { v0: number; v1: number; reach: number };

/**
 * The facade side of the footprint as a run of constant-reach zones, south to north.
 *
 * Boundaries are the ring's own vertex positions along the axis, near-coincident
 * ones merged, and the reach is ray-cast at a slice's MIDPOINT rather than read off
 * a vertex -- so a wall 0.1 ft out of square does not invent a zone. Adjacent
 * slices of equal reach then merge, which is what turns thirty-odd slices into the
 * dumbbell's handful of zones.
 *
 * Each merged zone is re-measured at its own midpoint. The east end-zone wall runs
 * from u 25.50 at v 48.5 to 25.38 at v 72.2 -- it tapers by an eighth of a foot over
 * 24 ft -- and the middle of the zone is the least arbitrary place to read a wall
 * that is not quite straight. Reading the first slice's value instead, as
 * ringStations() does, would put the step at 5.11 ft rather than 5.17.
 */
function facadeZones(facade: SuiteParams["facade"]): FacadeZone[] {
  const cuts: number[] = [];
  for (const v of RING_B.map((p) => p.v).sort((a, b) => a - b)) {
    const last = cuts[cuts.length - 1];
    if (last !== undefined && v - last < ZONE_EPS) continue;
    cuts.push(v);
  }

  const out: FacadeZone[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const v0 = cuts[i]!;
    const v1 = cuts[i + 1]!;
    const reach = facadeReachAt((v0 + v1) / 2, facade);
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.reach - reach) < PLATEAU_EPS) {
      prev.v1 = v1;
      continue;
    }
    out.push({ v0, v1, reach });
  }
  return out.map((z) => ({ ...z, reach: facadeReachAt((z.v0 + z.v1) / 2, facade) }));
}

/**
 * The step in one facade, in the building frame: where it is and how big it is.
 *
 * "Where" is the zone boundary nearest the gable the suite hangs off, because that
 * is the only step the suite's 44 ft can reach -- the next one south is the waist,
 * 50.25 ft back, past maxSectionLength(). "How big" is the difference of the two
 * zones' reaches, so a ring with no step at all yields zero rather than a
 * fabricated projection.
 */
function ringFacadeStep(facade: SuiteParams["facade"]): { v: number; projection: number } {
  const zones = facadeZones(facade);
  const i = zones.findIndex((z) => z.v0 <= GABLE_INNER_V && z.v1 >= GABLE_INNER_V);
  const anchor = zones[i];
  const outboard = zones[i - 1];
  if (!anchor || !outboard) return { v: GABLE_INNER_V, projection: 0 };
  return { v: anchor.v0, projection: Math.max(0, outboard.reach - anchor.reach) };
}

/**
 * Measured once per facade at import. Both sides, because facade is a toggle and a
 * lazy cache keyed on it would be two lines of bookkeeping for two multiplications.
 */
const RING_FACADE_STEP = {
  east: ringFacadeStep("east"),
  west: ringFacadeStep("west"),
} as const;

export type FacadeStep = {
  /**
   * Suite-frame v of the step. A room whose whole v range lies below this is in the
   * projecting wing zone; a room that spans it straddles the step.
   */
  v: number;
  /** How far the wing's outer wall stands outboard of the end zone's, ft. */
  projection: number;
};

/**
 * The building's facade step, in the suite's own frame.
 *
 * The v conversion is suiteToBuilding()'s inverse and has to stay that: the step is
 * fixed in the building and the suite's v = 0 moves with sectionLength, so a longer
 * section pushes the step further north in suite terms. Writing the suite-frame
 * figure out as a constant would be right at 44 ft and wrong at every other value
 * the slider can take.
 */
export function facadeStep(params: SuiteParams): FacadeStep {
  const step = RING_FACADE_STEP[params.facade];
  return {
    v: params.sectionLength - (GABLE_INNER_V - step.v),
    projection: step.projection,
  };
}

/**
 * Hand the measurement to rooms.ts, once, as this module loads.
 *
 * PUSHED rather than pulled, which is the one surprising line in either file.
 * rooms.ts's own docblock on measuredFacadeStep carries the reason and the error
 * message: node cannot resolve this module's specifiers, tests/drift.test.ts runs
 * two generator scripts that import rooms.ts in plain node, and a value import the
 * other way takes both of them down. Everything that renders a stepped suite --
 * Suite.tsx, stages.ts, weldGeometry.ts -- imports this module already, so the
 * registration has happened before any of them can call buildSuite().
 */
provideFacadeStep(facadeStep);

/** The four corners of a suite-frame rect, in site feet. */
export function rectCornersSite(r: Rect, params: SuiteParams): Site[] {
  return [
    [r.u, r.v],
    [r.u + r.du, r.v],
    [r.u + r.du, r.v + r.dv],
    [r.u, r.v + r.dv],
  ].map(([u, v]) => suiteToSite(u!, v!, params));
}

/**
 * Floor level of the suite, in feet above the building's base.
 *
 * The first floor is one storey up from the basement. Cambridge GIS gives 60 ft
 * to the eaves over five floors, so 12 ft per floor.
 */
export function floorLevel(floor = 1): number {
  return floor * WELD.floorToFloor;
}

/** Every room corner of a placed suite, in site feet. Used by the fit test. */
export function suiteCornersSite(suite: Suite): { id: string; site: Site }[] {
  return suite.rooms.flatMap((r) =>
    rectCornersSite(r, suite.params).map((site) => ({ id: r.id, site })),
  );
}

/**
 * Which compass azimuth the suite's rooms look out over, for solar.ts.
 * The building's axis is 13.2 deg east of north, so the east facade's outward
 * normal is 13.2 + 90 and the west facade's is 13.2 - 90.
 */
export function facadeAzimuth(params: SuiteParams): number {
  const axis = weld.meta.long_axis_deg_e_of_n;
  return params.facade === "east" ? axis + 90 : axis - 90;
}

/** The north gable's outward normal azimuth. */
export function gableAzimuth(): number {
  return weld.meta.long_axis_deg_e_of_n;
}

export { siteToBuilding };
