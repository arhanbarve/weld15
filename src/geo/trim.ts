/**
 * Baseboard, picture rail and cornice for one wall face's solid stretches.
 *
 * Three-free, like sash.ts. u is along the wall's run (0..along), v = 0 at
 * the wall's own face with v NEGATIVE proud into the room, y absolute
 * height. Suite.tsx places these exactly as it places sash parts: pick the
 * room-facing side(s) of the band, mirror v across the band's thickness when
 * the room face is the band's high edge.
 *
 * P14 adds door casing, a hung-open leaf and a threshold strip -- the "later
 * pass" the note above used to point to. `doorCasingParts()` is the window
 * casing's shape (two jambs and a head, no bottom member) applied to a door
 * instead; `doorLeafParts()` is the part that DOES need per-door swing
 * geometry, and it earns its own section below rather than joining
 * `trimParts()`, because a leaf is chiral -- it swings toward one specific
 * room -- while everything else in this file is drawn identically on
 * whichever face asks for it.
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

/**
 * Door casing width and proud distance, matching sash.ts's CASING_W/CASING_PR
 * exactly so a door and a window speak one language.
 *
 * Duplicated rather than imported. sash.ts is the source of the numbers, but
 * this module's own no-imports-from-sibling-geo-files convention (matched by
 * furniture.ts's DOOR_CLEARANCE, deliberately re-derived rather than imported
 * from drag.ts for the same reason: a value pulled from a file that is really
 * about a different concern is a dependency this project keeps choosing not
 * to take) is why these are their own constants and not `import { CASING_W }
 * from "./sash"`. Their equality is asserted in tests/trim.test.ts.
 */
const DOOR_CASING_W = 0.35;
const DOOR_CASING_PR = 0.05;

/**
 * The architrave round a door opening: two jamb legs and a head, in the
 * door's own local frame -- u along the clear width (0..width), v proud of
 * the room face (negative), y absolute height. No bottom member: a door
 * reaches the floor, so there is no sill for a fourth leg to sit under,
 * exactly as sashParts() omits one for the same reason on a window's sill
 * board.
 */
export function doorCasingParts(width: number, doorH: number): TrimPart[] {
  return [
    {
      u: -DOOR_CASING_W, v: -DOOR_CASING_PR, du: DOOR_CASING_W, dv: DOOR_CASING_PR,
      y0: 0, y1: doorH + DOOR_CASING_W, material: "joinery",
    },
    {
      u: width, v: -DOOR_CASING_PR, du: DOOR_CASING_W, dv: DOOR_CASING_PR,
      y0: 0, y1: doorH + DOOR_CASING_W, material: "joinery",
    },
    {
      u: -DOOR_CASING_W, v: -DOOR_CASING_PR, du: width + 2 * DOOR_CASING_W, dv: DOOR_CASING_PR,
      y0: doorH, y1: doorH + DOOR_CASING_W, material: "joinery",
    },
  ];
}

/** Oak strip across a doorway at floor level, spanning the wall's own thickness. */
const THRESHOLD_H = 0.05;

/** One board, in the door's own local frame, u along the clear width, v across the wall. */
export function thresholdParts(width: number, wallThickness: number): TrimPart[] {
  return [{ u: 0, v: 0, du: width, dv: wallThickness, y0: 0, y1: THRESHOLD_H, material: "joinery" }];
}

// --- the door leaf ----------------------------------------------------
//
// Every interior door in this suite is passable -- walk.ts and route.ts both
// treat a doorway as clear -- so the leaf is drawn HUNG OPEN against its
// jamb. A closed leaf standing in a doorway the code will still walk through
// is geometry telling a lie about the route; see this file's header. The one
// exception is the suite's own entry, which walk.ts's solidsOf() deliberately
// never cuts -- Suite.tsx (P14 row 3) draws that one leaf closed instead, by
// passing a small `openDeg`.

/** How far a leaf swings open, degrees, measured from flush-in-the-doorway. ASSUMED. */
const OPEN_DEG = 100;

/** Leaf thickness, ft. ASSUMED, ordinary for a period six-panel door. */
const LEAF_T = 0.14;

/** Clearance between the leaf's edge and each jamb, ft, so it doesn't clip the casing. ASSUMED. */
const LEAF_GAP = 0.08;

/** Which jamb, walking from u = 0, the leaf is hinged to. ASSUMED per door; see Suite.tsx. */
export type Hinge = "low" | "high";

/**
 * A leaf part, plus the extra rotation `trimParts()`'s plain boxes never need.
 * Matches Suite.tsx's own `Slab.turn` field exactly, so the caller hands it
 * straight through: `turn` rotates the box about ITS OWN centre, on top of
 * the wall's yaw, which is what makes the closed-form derivation below work
 * -- see the function's own doc for the geometry.
 */
export type LeafPart = TrimPart & { turn: number };

/**
 * The leaf, hung open, in the door's own local frame: u along the clear
 * width (0 at the near jamb, width at the far one), v proud of the room face
 * (negative, matching every other proud part in this file and in sash.ts),
 * y absolute height.
 *
 * THE GEOMETRY, CLOSED-FORM RATHER THAN A RUNTIME PIVOT
 * A leaf swings about its hinge -- a vertical line at one jamb -- not about
 * its own centre, which is the axis Suite.tsx's slabGeometry() rotates every
 * Slab.turn about. Composing "rotate about an arbitrary pivot" was the other
 * way to do this and was not taken: it would need a second transform this
 * project's Slab pipeline does not have anywhere else. Instead, the leaf's
 * CENTRE POINT after opening is computed directly by trigonometry, and `turn`
 * is set to the angle that orients the box (whose own local axis already
 * runs along its du, i.e. along u before any rotation) to match. Rotating a
 * box of the right size about ITS OWN centre, once that centre is already the
 * correct point, is identical to rotating it about its hinge -- the two
 * differ only by the translation this function has already done.
 *
 * Let `hingeU` be the hinge's position along u, `sign` be +1 for a low-side
 * hinge and -1 for a high-side one (the leaf's closed direction, measured
 * from the hinge, is +u for a low hinge and -u for a high one), and
 * `openRad` the swing angle. The closed direction is (sign, 0); opening
 * swings the free edge toward more negative v (into the room, matching this
 * file's own "proud is negative" convention), so the direction after opening
 * is (sign * cos(openRad), -sin(openRad)). The centre sits half the leaf's
 * own width out along that direction, and the box's rotation is the angle of
 * that direction relative to +u -- which is -openRad for a low hinge, and
 * (openRad - PI) for a high one, worked out in tests/trim.test.ts by
 * checking the free edge lands exactly `leafW` from the hinge at every angle
 * this project uses, rather than trusted from the derivation alone.
 *
 * ONE BOX, NOT A RAISED SIX-PANEL DOOR
 * A flush leaf rather than stiles, rails and panels -- unlike sash.ts's
 * window, which earns the extra joinery because the glass it holds is real
 * geometry a viewer looks through. A door leaf is seen edge-on or at a
 * shallow angle for most of the time anyone is near one, and no source gives
 * Weld's actual door design regardless; the ASSUMED single slab is the
 * simpler of two equally invented answers.
 */
export function doorLeafParts(width: number, doorH: number, hinge: Hinge, openDeg = OPEN_DEG): LeafPart[] {
  const leafW = width - 2 * LEAF_GAP;
  if (leafW <= 0) return [];
  const openRad = (openDeg * Math.PI) / 180;
  const sign = hinge === "low" ? 1 : -1;
  const hingeU = hinge === "low" ? LEAF_GAP : width - LEAF_GAP;
  const dirU = sign * Math.cos(openRad);
  const dirV = -Math.sin(openRad);
  const cu = hingeU + dirU * (leafW / 2);
  const cv = dirV * (leafW / 2);
  const turn = hinge === "low" ? -openRad : openRad - Math.PI;
  return [
    {
      u: cu - leafW / 2, v: cv - LEAF_T / 2, du: leafW, dv: LEAF_T,
      y0: 0, y1: doorH, material: "joinery", turn,
    },
  ];
}
