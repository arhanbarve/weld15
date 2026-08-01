/**
 * A real double-hung window, in one opening's own local frame.
 *
 * Three-free, like pieces.ts. Coordinates: u along the opening's clear width
 * (0 to `width`), v across the wall's thickness with v = 0 the ROOM face and v
 * increasing INTO the wall, y absolute height above the floor the opening sits
 * in (sill to head, matching walls.ts's SILL_H/HEAD_H convention). Casing and
 * the sill board are proud of the room face, so their v is negative on
 * purpose -- they stand IN the room, not in the wall.
 *
 * Every dimension below is ASSUMED: no source gives Weld's sash a light
 * pattern or a joinery profile. 2-over-2 is ordinary for the building's
 * contemporaries and revisable in one constant (LIGHT_SPACING/LIGHT_MAX).
 */

export type SashMaterial = "joinery" | "glass";

/** A box in the opening's own frame: origin at the room face, before any yaw. */
export type SashPart = {
  u: number;
  v: number;
  du: number;
  dv: number;
  y0: number;
  y1: number;
  material: SashMaterial;
};

/** A single light's clear width, ft, and the rhythm they sit on. Both ASSUMED. */
const LIGHT_SPACING = 3.5;
const LIGHT_MAX = 3;

const STILE = 0.17; // sash stile and rail width, ASSUMED standard joinery
const MEETING = 0.25; // the meeting rail, thicker than the others
const MUNTIN = 0.06; // glazing bar; one vertical per sash half gives 2-over-2
const SASH_T = 0.09; // sash thickness, in the wall's depth direction
const GLASS_T = 0.02;
const CASING_W = 0.35; // architrave round the opening, room side
const CASING_PR = 0.05; // how far it stands proud of the plaster
const SILL_PR = 0.12; // sill board projection into the room
const SILL_NOSE = 0.04; // its nosing, projecting further still, at the sill line only

/**
 * The narrowest a single glass pane may be after a muntin splits a light in
 * two. Below it, the light keeps one undivided pane instead -- a slider that
 * shrinks a room can make an opening arbitrarily narrow, and a muntin has to
 * degrade before its two panes go negative.
 */
const MIN_GLASS_HALF = 0.15;

/** One light's sash frame, muntin(s) and glass, u-local to that light (0..lightW). */
function lightParts(lightW: number, sill: number, head: number, sashV: number): SashPart[] {
  const parts: SashPart[] = [];
  const glassU0 = STILE;
  const glassU1 = lightW - STILE;
  const meetingY = sill + (head - sill) / 2;

  // Sash frame: 2 stiles, top rail, bottom rail, the meeting rail between the
  // two hung sashes.
  parts.push({ u: 0, v: sashV, du: STILE, dv: SASH_T, y0: sill, y1: head, material: "joinery" });
  parts.push({ u: lightW - STILE, v: sashV, du: STILE, dv: SASH_T, y0: sill, y1: head, material: "joinery" });
  parts.push({ u: glassU0, v: sashV, du: glassU1 - glassU0, dv: SASH_T, y0: sill, y1: sill + STILE, material: "joinery" });
  parts.push({ u: glassU0, v: sashV, du: glassU1 - glassU0, dv: SASH_T, y0: head - STILE, y1: head, material: "joinery" });
  parts.push({
    u: glassU0, v: sashV, du: glassU1 - glassU0, dv: SASH_T,
    y0: meetingY - MEETING / 2, y1: meetingY + MEETING / 2, material: "joinery",
  });

  const canSplit = glassU1 - glassU0 >= 2 * MIN_GLASS_HALF + MUNTIN;
  const glassZ = { v: sashV + SASH_T / 2 - GLASS_T / 2, dv: GLASS_T };
  const halves: [number, number][] = [
    [sill + STILE, meetingY - MEETING / 2],
    [meetingY + MEETING / 2, head - STILE],
  ];
  for (const [y0, y1] of halves) {
    if (canSplit) {
      const muntinU = (glassU0 + glassU1) / 2 - MUNTIN / 2;
      parts.push({ u: muntinU, v: sashV, du: MUNTIN, dv: SASH_T, y0, y1, material: "joinery" });
      parts.push({ u: glassU0, ...glassZ, du: muntinU - glassU0, y0, y1, material: "glass" });
      parts.push({ u: muntinU + MUNTIN, ...glassZ, du: glassU1 - (muntinU + MUNTIN), y0, y1, material: "glass" });
    } else {
      parts.push({ u: glassU0, ...glassZ, du: glassU1 - glassU0, y0, y1, material: "glass" });
    }
  }
  return parts;
}

/**
 * The parts of a real window filling one opening: casing and a sill board
 * proud of the room face, jamb linings across the visible reveal, and one or
 * more double-hung lights at `sashDepth` into the wall.
 *
 * `sashDepth` is how far into the wall (from the room face, v = 0) the sash
 * itself sits -- Suite.tsx derives this from the wall's own thickness and the
 * asymmetric reveal paneLow() already computes. Only the room-facing portion
 * of the reveal is lined: what lies beyond the sash is not this phase's
 * concern (see docs/phases/P10.md sec 5.2).
 */
export function sashParts(width: number, sill: number, head: number, sashDepth: number): SashPart[] {
  const n = Math.min(LIGHT_MAX, Math.max(1, Math.round(width / LIGHT_SPACING)));
  const lightW = width / n;
  const parts: SashPart[] = [];

  parts.push({
    u: -CASING_W, v: -CASING_PR, du: width + 2 * CASING_W, dv: CASING_PR,
    y0: sill - CASING_W, y1: head + CASING_W, material: "joinery",
  });
  parts.push({
    u: -CASING_W, v: -SILL_PR - SILL_NOSE, du: width + 2 * CASING_W, dv: SILL_PR + SILL_NOSE,
    y0: sill - SILL_NOSE, y1: sill, material: "joinery",
  });
  const jambT = 0.05;
  parts.push({ u: -jambT, v: 0, du: jambT, dv: sashDepth, y0: sill, y1: head, material: "joinery" });
  parts.push({ u: width, v: 0, du: jambT, dv: sashDepth, y0: sill, y1: head, material: "joinery" });
  parts.push({ u: 0, v: 0, du: width, dv: sashDepth, y0: head, y1: head + jambT, material: "joinery" });

  for (let i = 0; i < n; i++) {
    for (const part of lightParts(lightW, sill, head, sashDepth)) {
      parts.push({ ...part, u: part.u + i * lightW });
    }
  }
  return parts;
}
