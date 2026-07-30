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
import type { Rect, SuiteParams, Suite } from "./rooms";

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
