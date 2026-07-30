/**
 * Cutaway: which walls to take away so the plan can be read from outside.
 *
 * The problem is P6's, not P4's. Once the suite is a thing you can change, you
 * have to be able to LOOK at what you changed, and a closed box of 1.5 ft masonry
 * shows nothing from outside. Four modes answer that, and only one of them is
 * interesting:
 *
 *   none       nothing hidden. The room as built.
 *   roofOff    the ceiling plate goes; every wall stays. Read the plan from above.
 *   wallsDown  the wall between the camera and the room it is looking into drops.
 *   section    one vertical plane; everything on the camera's side of it goes.
 *
 * NO THREE.JS, and the camera arrives as a plain Vec3 for that reason. rooms.ts,
 * collide.ts and orbit.ts all manage without three and this module needs less
 * maths than any of them: every wall band is axis aligned in the suite frame, so
 * every question here is a dot product with a unit axis, which is one
 * multiplication. What is bought by staying out of three is that the sign errors
 * below are catchable in Node in a second rather than visible only as a picture
 * that looks subtly wrong. orbit.ts's docblock makes the same argument at length.
 *
 * FRAMES. Walls are in the suite frame (u inward from the facade, v north along
 * the section). The camera is in three.js world space, where Y is up and north is
 * -Z -- see frames.ts, which warns that a mistake in that swap mirrors the whole
 * building invisibly. cameraInSuite() below inverts the mapping by projecting onto
 * suiteToThree()'s own basis rather than by writing the inverse algebra out, so the
 * only mapping in play is the one place.test.ts already pins. Suite.tsx's
 * suiteBasis() takes the same route for the same reason.
 *
 * The camera's HEIGHT is dropped on the way in. Every wall band is a vertical
 * prism, so no height can change which side of a vertical plane the camera is on.
 *
 * WHAT A CALLER HAS TO PROVIDE BESIDES A HUE
 * design-system/MASTER.md: colour is never the sole indicator. A cutaway control
 * that marks the active mode with a tint and nothing else fails that, and the mode
 * is not recoverable from the canvas either -- the scene is a picture with no
 * accessible name for "the north wall is missing". So the UI owes, at minimum:
 *   - the mode's WORD, rendered, the way Provenance.tsx's chip carries GIVEN /
 *     DERIVED / INFERRED rather than relying on chip colour;
 *   - selection expressed structurally, aria-pressed or a radio group, so the
 *     active mode survives a stylesheet that renders every button identically;
 *   - a live-region announcement on change, because the thing that changed is the
 *     geometry and a screen reader gets nothing from a WebGL canvas;
 *   - the canvas text alternative updated to name the mode, for the same reason.
 * None of that can live here. It is written down here because this module is where
 * the modes are defined and the requirement is easiest to lose at the seam.
 */

import { suiteToThree } from "@/geo/place";
import { buildSuite, type Rect, type SuiteParams } from "@/geo/rooms";
import type { Vec3 } from "@/geo/frames";
import type { Wall } from "@/geo/walls";

export type CutawayMode = "none" | "roofOff" | "wallsDown" | "section";

/** Every mode, in the order a control should offer them: least to most removed. */
export const CUTAWAY_MODES: readonly CutawayMode[] = [
  "none",
  "roofOff",
  "wallsDown",
  "section",
];

/**
 * How far past a wall the camera must travel before a dropped wall comes back, ft.
 *
 * "A couple of feet", per the phase brief, and the units matter: this is a distance
 * in the suite frame, not an angle or a frame count, so it holds equally whether the
 * camera is crossing slowly or being dragged. See hiddenWalls() for the trigger.
 */
export const WALL_HOLD_FT = 2;

const EPS = 1e-9;

const NONE: ReadonlySet<string> = new Set();

/**
 * The camera in suite-frame feet.
 *
 * Projection onto the basis rather than an inverse written by hand. suiteToBuilding()
 * negates u on the east facade and buildingToSite() rotates by 13.2 deg, so the
 * inverse is four lines of sign-sensitive algebra that would be a second copy of
 * place.ts's mapping -- and a wrong second copy is invisible, because it is only ever
 * compared against itself. The basis is orthonormal (a reflection, a rotation and
 * toThree()'s axis swap are all isometries of the horizontal plane), so a dot product
 * IS the inverse, exactly, with no matrix.
 */
export function cameraInSuite(camera: Vec3, params: SuiteParams): { u: number; v: number } {
  const o = suiteToThree(0, 0, 0, params);
  const eu = suiteToThree(1, 0, 0, params);
  const ev = suiteToThree(0, 1, 0, params);
  const dx = camera[0] - o[0];
  const dz = camera[2] - o[2];
  return {
    u: dx * (eu[0] - o[0]) + dz * (eu[2] - o[2]),
    v: dx * (ev[0] - o[0]) + dz * (ev[2] - o[2]),
  };
}

/**
 * The section plane, as a suite-frame u.
 *
 * A LONGITUDINAL cut on the hall's centreline, u = legDepth - hallWidth / 2, and the
 * plane is derived rather than picked because there is exactly one plane in this
 * geometry that the suite itself distinguishes.
 *
 * rooms.ts's unreachableRooms() seeds its flood fill from "hall" and not from any
 * other room, because the hall is what every other room is entered from -- that is a
 * fact about this suite's circulation graph, not a convention. So the hall's own
 * centreline is the only plane that runs through or immediately past every opening
 * buildOpenings() emits: the three hall doors in the resident's order, the suite entry off
 * the stair hall, and K's door through the common room. A section on it shows the
 * bedroom / bathroom / bedroom sequence, which is the thing about Weld 15 that a
 * section is for.
 *
 * The two candidates refused. A cut across the leg (v = const) lands between rooms
 * or through one arbitrary room and shows a single cross-section, telling you the
 * ceiling height and nothing about the sequence. The midpoint of the 44 ft section
 * (v = sectionLength / 2) is arithmetically tidy and geometrically meaningless -- at
 * the defaults it falls inside bedroom A, 6.5 ft from that room's own wall, for no
 * reason connected to anything.
 *
 * Derived from params, so a leg-depth or hall-width slider moves the cut with the
 * hall instead of leaving it stranded in a bedroom.
 */
export function sectionPlaneU(params: SuiteParams): number {
  return params.legDepth - params.hallWidth / 2;
}

/**
 * Whether the ceiling plate is drawn.
 *
 * roofOff hides NO walls, which is why it needs this: the ceiling is not a Wall --
 * Suite.tsx builds it from suiteFootprint() and already has a `ceiling` prop for it.
 * So the mode is expressed as a wall set that is deliberately empty plus this flag,
 * and the integrator wires the flag to the prop.
 *
 * True for section, which is not an oversight. The section's cut face is a vertical
 * plane; the ceiling on the far side of it is part of what the cut exposes, and
 * dropping it would turn a section into a section-plus-roof-off.
 */
export function ceilingVisible(mode: CutawayMode): boolean {
  return mode !== "roofOff";
}

/** The outward-facing plane of a perimeter band: a unit axis normal and its offset. */
type OuterFace = {
  /** unit outward normal in the suite frame. Exactly one component is non-zero. */
  nu: number;
  nv: number;
  /** where the outward face sits on the axis the normal runs along, suite feet */
  offset: number;
  /** the band's centre, for the sideways test in hiddenWalls() */
  cu: number;
  cv: number;
};

/**
 * Which face of a perimeter band looks out of the suite.
 *
 * Null for anything that is not a perimeter band, and that restriction is what makes
 * the sign question well posed rather than a simplification. A grid-derived band
 * divides two interior rooms (walls.ts: classify() returns "partition" for all of
 * them, because they live in the gaps BETWEEN rooms) so it has two inward faces and
 * no outward one; asking which way its normal points has no answer. Only the bands
 * perimeterWalls() emits have open space or another suite on one side.
 *
 * WHICH SIDE IS OUTSIDE is read off the rooms the band touches, exactly as
 * Suite.tsx's paneLow() reads it to decide which way a window reveal deepens. `between`
 * is safe here in a way walls.ts warns it is not safe for wallBetween(): the caution
 * there is that a long band lists every room it merely runs PAST, which breaks a
 * lookup for the pair it divides. For a perimeter band every room it runs past is on
 * the interior side, so the mean of them is unambiguously inside and the more rooms
 * the better.
 *
 * THE TRAP, HIT AND RECORDED: the first version used the suite's own middle,
 * (legDepth / 2, sectionLength / 2), instead of the touched rooms. That is right for
 * five of the six perimeter bands and wrong for the step where the K bump meets the
 * leg. The suite is an L, the L's centroid is not inside the bump, and the step band
 * at v = 12..12.5 therefore came out with its normal pointing SOUTH, into K, so a
 * camera off the north gable kept a band it should have dropped and a camera to the
 * south dropped one it should have kept. The params centre survives only as the
 * fallback for a band that touches no room at all, which a slider closing a room to
 * zero can produce.
 */
function outerFace(w: Wall, rooms: Rect[], params: SuiteParams): OuterFace | null {
  if (w.perimeter !== true) return null;

  // The normal runs along whichever axis the band is thin in. Same discriminator as
  // Suite.tsx's bandAxis(), which resolves the square case the same way.
  const alongV = w.dv >= w.du;
  const lo = alongV ? w.u : w.v;
  const hi = alongV ? w.u + w.du : w.v + w.dv;
  const mid = (lo + hi) / 2;

  const centres = w.between
    .map((id) => rooms.find((r) => r.id === id))
    .filter((r): r is Rect => r !== undefined)
    .map((r) => (alongV ? r.u + r.du / 2 : r.v + r.dv / 2));
  const inside =
    centres.length > 0
      ? centres.reduce((a, b) => a + b, 0) / centres.length
      : alongV
        ? params.legDepth / 2
        : params.sectionLength / 2;

  // Interior on the low side means the outward direction is the high one, and the
  // outward face is then the band's high edge.
  const positive = inside < mid;
  const offset = positive ? hi : lo;
  const sign = positive ? 1 : -1;
  return {
    nu: alongV ? sign : 0,
    nv: alongV ? 0 : sign,
    offset,
    cu: w.u + w.du / 2,
    cv: w.v + w.dv / 2,
  };
}

/**
 * How far the camera is on the outward side of a band, and how squarely, in feet.
 *
 * Two margins, both distances, and the smaller one wins:
 *
 *   beyond    the camera is past the band's OUTER face. The outer face and not the
 *             mid-plane or the inner one, because "between the camera and the room"
 *             is true exactly when the camera has cleared the whole thickness -- a
 *             camera standing inside 1.5 ft of masonry is not outside the building.
 *   squarely  the camera is more in front of the band than off along it. Without this
 *             term the sign test alone drops any band whose normal merely leans
 *             toward the camera: at the defaults a camera 60 ft off the facade also
 *             dropped the step over the K bump, 26 ft away edge-on, because the
 *             camera does sit north of it. That is the "and ONLY the near wall" half
 *             of the requirement, and it is a separate failure from the sign.
 *
 * Returning one scalar rather than two booleans is what lets one hold distance in
 * hiddenWalls() cover both boundaries: the plane crossing and the diagonal where a
 * corner hands over from one face to the next both flicker, and both are measured
 * here in the same feet.
 */
function outwardMargin(f: OuterFace, cam: { u: number; v: number }): number {
  const du = cam.u - f.cu;
  const dv = cam.v - f.cv;
  const beyond = f.nu !== 0 ? f.nu * (cam.u - f.offset) : f.nv * (cam.v - f.offset);
  const squarely =
    f.nu !== 0 ? f.nu * du - Math.abs(dv) : f.nv * dv - Math.abs(du);
  return Math.min(beyond, squarely);
}

/**
 * Which walls to hide, given the mode and where the camera is.
 *
 * HYSTERESIS, AND WHY IT IS A PARAMETER AND NOT MODULE STATE
 * A wall whose margin sits at zero drops and returns on alternate frames, which
 * reads as a flickering hole. The fix is a Schmitt trigger: drop at margin > 0, and
 * hold a dropped wall down until the camera is WALL_HOLD_FT past, margin < -2.
 *
 * That needs the previous answer, and there were two places to keep it. A module-level
 * mutable set is fewer characters at the call site and was rejected: it makes the
 * result depend on history the signature does not mention, so calling this twice with
 * identical arguments can return different sets, and the "stable when the same input
 * is passed twice" test could not even be phrased. It also silently couples any two
 * callers -- a second viewport, or two tests in a file -- to each other. So `prev` is
 * an argument, the function stays pure, and the hold is exercised by handing it a set
 * rather than by driving a camera around in the right order. The caller keeps one
 * `useRef`, which is where per-frame render state belongs anyway.
 *
 * `prev` is read but never trusted: ids come only from `walls`, so a stale set naming
 * a band a slider has since removed cannot leak an id into the result.
 *
 * Hysteresis applies to wallsDown alone. none and roofOff have no boundary to cross.
 * section's boundary is a single global sign -- which half of the building is nearer --
 * and holding the wrong half visible for two feet past the crossing is not flicker
 * suppression, it is showing the wrong half; the degenerate case, a camera hovering
 * exactly in the cut plane, i.e. standing in the hall, is handled below by hiding
 * nothing.
 */
export function hiddenWalls(
  walls: Wall[],
  mode: CutawayMode,
  camera: Vec3,
  params: SuiteParams,
  prev: ReadonlySet<string> = NONE,
): Set<string> {
  const out = new Set<string>();
  if (mode === "none" || mode === "roofOff") return out;

  const cam = cameraInSuite(camera, params);

  if (mode === "section") {
    const plane = sectionPlaneU(params);
    const side = cam.u - plane;
    // Camera in the cut plane: neither half is the near one. Hide nothing rather
    // than pick, which is also what stops the set flipping about a coin toss.
    if (Math.abs(side) < EPS) return out;
    for (const w of walls) {
      // Wholly on the camera's side. A band the plane passes through is the cut face
      // itself and stays: this module hides whole bands and cannot split one, so
      // clipping it is the renderer's business, not a reason to drop it.
      const near = side > 0 ? w.u > plane - EPS : w.u + w.du < plane + EPS;
      if (near) out.add(w.id);
    }
    return out;
  }

  // wallsDown
  const rooms = buildSuite(params).rooms;
  for (const w of walls) {
    const f = outerFace(w, rooms, params);
    if (f === null) continue;
    const threshold = prev.has(w.id) ? -WALL_HOLD_FT : 0;
    if (outwardMargin(f, cam) > threshold) out.add(w.id);
  }
  return out;
}
