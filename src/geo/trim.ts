/**
 * Baseboard, picture rail and cornice for one wall face's solid stretches.
 *
 * Three-free, like sash.ts. u is along the wall's run (0..along), v = 0 at
 * the wall's own face with v NEGATIVE proud into the room, y absolute
 * height. Suite.tsx places these exactly as it places sash parts: pick the
 * room-facing side(s) of the band, mirror v across the band's thickness when
 * the room face is the band's high edge.
 *
 * Scope note: door casing and a hung-open leaf were in the original plan for
 * this step and are dropped here. Both need per-door swing geometry keyed to
 * a specific room, which baseboard/rail/cornice do not -- they run the same
 * regardless of which room borders the wall. Left for a later pass.
 *
 * Every dimension is ASSUMED; period-appropriate for 1872, no source gives
 * Weld's actual mouldings.
 */

export type TrimMaterial = "joinery" | "plaster";

export type TrimPart = {
  u: number;
  v: number;
  du: number;
  dv: number;
  y0: number;
  y1: number;
  material: TrimMaterial;
};

const BASE_H = 0.62;
const BASE_PROUD = 0.06;
/** Also the height Suite.tsx tests a cut's head against to build railSpans. */
export const RAIL_H = 7.0;
const RAIL_T = 0.15;
const RAIL_PROUD = 0.03;
const CORNICE_H = 0.3;
const CORNICE_PROUD = 0.08;

/**
 * `doorSpans` breaks only where a cut reaches the floor (a baseboard runs on
 * under a window's sill); `railSpans` breaks only where a cut's head is
 * ABOVE the rail's own height -- a door's head is exactly RAIL_H, so a door
 * does not interrupt the rail, but a window's 9 ft head does. The cornice,
 * above both, never breaks and takes the wall's whole run.
 */
export function trimParts(
  doorSpans: [number, number][],
  railSpans: [number, number][],
  along: number,
  ceiling: number,
): TrimPart[] {
  const parts: TrimPart[] = [];
  for (const [lo, hi] of doorSpans) {
    parts.push({
      u: lo, v: -BASE_PROUD, du: hi - lo, dv: BASE_PROUD,
      y0: 0, y1: BASE_H, material: "joinery",
    });
  }
  for (const [lo, hi] of railSpans) {
    parts.push({
      u: lo, v: -RAIL_PROUD, du: hi - lo, dv: RAIL_PROUD,
      y0: RAIL_H, y1: RAIL_H + RAIL_T, material: "joinery",
    });
  }
  parts.push({
    u: 0, v: -CORNICE_PROUD, du: along, dv: CORNICE_PROUD,
    y0: ceiling - CORNICE_H, y1: ceiling, material: "plaster",
  });
  return parts;
}
