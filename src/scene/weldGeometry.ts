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
 * WHY THE SHELL IS SPLITTABLE, AND WHAT A CUTAWAY REMOVES
 * P6's cutaway modes exist so the plan can be read from outside, and until this
 * module could leave a part out they could not work: cutaway.ts's hiddenWalls() takes
 * down the interior's own bands and Suite.tsx drops the ceiling plate, but the 1872
 * shell stayed opaque, so from stage 3 there was nothing to look into.
 * WeldExterior.tsx carries the four modes and the draw calls each one costs.
 *
 * A part is removed by NOT EMITTING IT, never by making it transparent. Two measured
 * reasons. tests/e2e/campus.spec.ts gates the whole scene at 30 draw calls and this
 * shell is merged into four meshes to fit that, so a transparent part still costs its
 * call -- and an EMPTY geometry costs one too: three's WebGLRenderer only returns
 * early when the draw count is NEGATIVE (WebGLRenderer.js, `drawCount < 0`), so a
 * zero-length index still reaches gl.drawElements and still increments
 * renderer.info.render.calls. Hence buildWeldCut() returns null for a part that is
 * wholly gone and WeldExterior mounts no mesh for it, which is the shape Suite.tsx's
 * mergeSlabs() already has.
 *
 * WHAT THE PARTS ARE
 * The roof, the two roof features standing on it, one quad per ring edge, the eaves
 * LID over the shell, the grade cap under it, and one box per window bay. The lid
 * belongs to the ROOF rather than to the walls, which is not obvious and is the whole
 * difference between roofOff working and doing nothing: extrude() closes its solid
 * with a cap at the eaves, the gable covers that cap so it is invisible in every other
 * mode, and leaving it up in roofOff would swap the roof for a flat floor over the
 * entire footprint. The grade cap is kept in every mode, because it is what the
 * building stands on and because Suite.tsx keeps the suite's own floors in every mode.
 *
 * The edge quads and the two caps are SELECTED OUT OF ONE extrude() CALL rather than
 * rebuilt here. extrude.ts documents its layout -- n lid vertices, n grade vertices,
 * then four per edge in ring order; n-2 triangles per cap, then two per edge -- so
 * this module asserts that layout and copies the index ranges it wants. Rebuilding the
 * ring here instead would be a second extrusion of the same polygon, free to disagree
 * with the first about winding, about normals and about where the eaves are, and
 * gableRoof() fans off that same ring: a shell built by a second route is how a gap
 * all the way round the eaves appears.
 *
 * The vertices of a dropped part stay in the position buffer, unreferenced. An indexed
 * draw never shades a vertex no triangle names, so the cost is about 4 kB of ring that
 * is not read, and compacting would mean remapping every index for nothing. The
 * bounding sphere is computed over all of them, so a cut shell is culled as if it were
 * whole -- the safe direction, since it can only keep a mesh that would have passed
 * the frustum test anyway.
 *
 * WHY section CLIPS AN EDGE INSTEAD OF DROPPING IT
 * cutaway.ts's section keeps any interior band the plane passes through, on the ground
 * that it cannot split a band and the band IS the cut face. Neither of the two rules
 * available without clipping does for the shell, and the numbers are small enough that
 * they had to be measured rather than argued: at the default params the plane lands at
 * building u = 5.75 and crosses exactly TWO of the ring's 56 edges, the 14.80 ft panel
 * of the north gable and a 6.38 ft one at the south end. Keeping both whole, which is
 * the interior's rule, leaves 7.23 ft of wall standing on the camera's side of the cut
 * -- 5.88 of it in one stub across the south end. Dropping both instead takes 13.95 ft
 * out of the half that is supposed to stay, nearly all of it the north gable, which is
 * the end the suite is at and the end being looked into. So a crossing edge is cut AT
 * the plane and only the far part is emitted. That is 21 ft of the 440 ft perimeter and
 * it is the difference between a section and a section with a stub in it.
 *
 * The split point is interpolated in SITE coordinates from a parameter
 * measured in the BUILDING frame, which is exact rather than approximate: the two
 * frames differ by a rotation, so the point a fraction t along a segment is the same
 * point in both. The clipped quad takes the whole edge's own normal, read back out of
 * the extrusion rather than recomputed, so it cannot disagree with its neighbours
 * about which way is out.
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
import { extrude, normalizeRing } from "@/geo/extrude";
import {
  buildingToSite,
  fromThree,
  siteToBuilding,
  toThree,
  type Building,
  type Vec3,
} from "@/geo/frames";
import { buildSuite, DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import { WELD, floorLevel, suiteToBuilding } from "@/geo/place";
import { cameraInSuite, sectionPlaneU, WALL_HOLD_FT, type CutawayMode } from "./cutaway";

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

/**
 * The same four parts, any of which a cutaway can take away entirely.
 *
 * Mapped off WeldMasses rather than written out, so a fifth part cannot be added to
 * one and forgotten in the other. Null and not an empty geometry: see the header on
 * what an empty index still costs.
 */
export type WeldCutMasses = { [K in keyof WeldMasses]: THREE.BufferGeometry | null };

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
 * Weld's exterior, as four geometries, with nothing cut away.
 *
 * `params` only reaches the bays: the shell and the roof come from the GIS ring
 * and are the same whatever the suite sliders do. `towers` is a second argument
 * rather than a field of SuiteParams because it describes the building, not the
 * suite, and because SuiteParams is a fixed interface three other modules build
 * against. Both are defaulted, so buildWeld() and buildWeld(params) still mean
 * what they meant.
 *
 * Kept as the non-nullable face of buildWeldCut() rather than widened to match it.
 * Threshold.tsx merges walls and roof into its sweep surface and disposes all four,
 * and its own docblock says the sweep rides the whole building; a shell that could
 * arrive half-missing is not what that component is asking for, and it would have to
 * grow four null checks to say so. The assertion below is what makes the narrower
 * type true rather than asserted: NO_CUT keeps every part, and if some later part can
 * come back empty at NO_CUT this throws here instead of reaching a caller as null.
 */
export function buildWeld(
  params: SuiteParams = DEFAULT_PARAMS,
  towers: TowerParams = TOWER_DEFAULTS,
): WeldMasses {
  const m = buildWeldCut(params, towers, NO_CUT);
  for (const [name, g] of Object.entries(m)) {
    if (g === null) throw new Error(`weldGeometry: no ${name} emitted with nothing cut away`);
  }
  return m as WeldMasses;
}

/**
 * Weld's exterior with a cutaway applied: the same four parts, minus what `cut` says.
 *
 * Every removal is a part that is not emitted, and a part that is wholly gone comes
 * back as null so the caller can mount no mesh for it -- the header says what an empty
 * geometry costs instead. `cut` is data rather than a predicate on purpose: WeldExterior
 * memoises this call on it, and a function prop would be a new identity every render.
 */
export function buildWeldCut(
  params: SuiteParams = DEFAULT_PARAMS,
  towers: TowerParams = TOWER_DEFAULTS,
  cut: WeldCut = NO_CUT,
): WeldCutMasses {
  return {
    walls: shellGeometry(cut),
    // The roof features stand ON the slate, 9.4 and 9.6 ft off the ridge and seated
    // well down the slope (see towerGeometry). With the roof gone they would be two
    // boxes hanging in the air over an open building, which reads as a fault rather
    // than as a cutaway, so they go with the surface that carries them.
    roof: cut.roof ? null : gableRoof(),
    towers: cut.roof ? null : towerGeometry(towers),
    bays: bayGeometry(params, cut.bays),
  };
}

/**
 * A cutaway of the shell, expressed as the parts NOT to emit.
 *
 * Two of the four fields are sets of indices rather than of ids, which is the one
 * thing here that differs from hiddenWalls()'s answer. The shell's parts have no ids
 * to name: a ring edge is a position in weld.rings[0] and a bay is a position in the
 * window list buildWalls() emits, and both lists are derived, ordered and rebuilt from
 * the same inputs on every call. `bays` therefore indexes bayRects() order, which is
 * the order bayGeometry() emits in, and both come from bays(params) with the same
 * params -- weldCut() and buildWeldCut() must be handed the same SuiteParams or the
 * cut lands on the wrong window.
 */
export type WeldCut = {
  /** the gabled roof, the two features standing on it, and the eaves lid beneath it */
  roof: boolean;
  /** ring edge indices whose wall quad is not emitted at all */
  walls: ReadonlySet<number>;
  /** bay indices, in bayRects() order, whose reveal is not emitted */
  bays: ReadonlySet<number>;
  /**
   * A half-space in the BUILDING frame that every surviving wall quad is cut back to:
   * a point survives where `keep * (its u - this u) >= 0`, and an edge that crosses the
   * plane is split there. Used by section, and null in every other mode.
   */
  half: { u: number; keep: 1 | -1 } | null;
};

const NO_PARTS: ReadonlySet<number> = new Set();

/** Nothing removed: mode "none", and the default for every caller that has no camera. */
export const NO_CUT: WeldCut = { roof: false, walls: NO_PARTS, bays: NO_PARTS, half: null };

/**
 * The roof, its features and the eaves lid, and nothing else.
 *
 * Mode roofOff's whole answer, and also the answer for the two camera-driven modes in
 * their degenerate case. Exported as a constant because WeldExterior compares cuts by
 * identity first: roofOff needs no camera, so it must not allocate a fresh set per
 * frame and force a re-render with it.
 */
export const ROOF_CUT: WeldCut = { roof: true, walls: NO_PARTS, bays: NO_PARTS, half: null };

/** Two sets of part indices, compared by content. */
export function sameParts(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const i of a) if (!b.has(i)) return false;
  return true;
}

/**
 * Two cuts, compared by content rather than by identity.
 *
 * Beside the type rather than in the component that drives it, because it is a pure
 * predicate over WeldCut and a cut compared wrongly is a shell rebuilt sixty times a
 * second -- which is a claim about this type, testable here, and not about a mesh.
 *
 * weldCut() allocates fresh sets on every call, so identity would report a change every
 * time it is called and rebuild the whole shell with it -- the same trap Suite.tsx's
 * sameWalls() exists for, and the reason that one is content-compared too. The identity
 * check on the front is not redundant: the two camera-free modes return the module
 * constants NO_CUT and ROOF_CUT, so those two settle in one comparison.
 *
 * `half` is compared field by field because it is a fresh object per call as well, and
 * because its two fields are the whole cut for section: a plane that has moved by a
 * slider is a different section even though every set is still empty.
 */
export function sameCut(a: WeldCut, b: WeldCut): boolean {
  if (a === b) return true;
  if (a.roof !== b.roof) return false;
  if ((a.half === null) !== (b.half === null)) return false;
  if (a.half !== null && b.half !== null) {
    if (a.half.u !== b.half.u || a.half.keep !== b.half.keep) return false;
  }
  return sameParts(a.walls, b.walls) && sameParts(a.bays, b.bays);
}

/**
 * A zero this file compares distances in feet against.
 *
 * cutaway.ts's own EPS, and used in the same two places: the degenerate camera sitting
 * exactly in the section plane, and "wholly on the camera's side of it". Not a
 * measurement tolerance -- 1e-9 ft is far below the ring's published tenth of a foot --
 * but the difference between a strict and a non-strict comparison, written where the
 * comparison is.
 */
const EPS = 1e-9;

/**
 * What a cutaway mode takes off the shell, from where the camera is.
 *
 * PURE, and the caller keeps the state, exactly as hiddenWalls() is pure and Suite.tsx
 * keeps its one useRef. The same argument applies for the same reason: with `prev` as
 * an argument the hysteresis can be exercised by handing this a set, calling it twice
 * with the same arguments cannot return two different answers, and two viewports
 * cannot couple through module state.
 *
 * THROTTLING IS THE CALLER'S JOB AND IT IS NOT OPTIONAL. The wallsDown and section
 * branches both walk buildSuite() and buildWalls() by way of bays(), which is the call
 * chain that made hiddenWalls() in a useFrame a measured input stall -- a cutaway mode
 * change stopped responding for longer than a 30 s test would wait (docs/phases/P6-UI.md
 * records it). WeldExterior recomputes only after a quarter foot of camera movement for
 * that reason, and mirrors Suite.tsx's fast path so the two modes that need no camera
 * cost nothing at all.
 *
 * FRAMES, and there are three in one function. The shell is in the BUILDING frame, so
 * that is where every part is tested; the camera arrives in three.js world space and
 * gets there through frames.ts's own fromThree and siteToBuilding, which are the
 * sanctioned pair and round-trip tested in both directions. The section plane is a
 * SUITE-frame u, so it is carried into the building frame through place.ts's own
 * forward map, sampled at two points -- suiteToBuilding negates u on the east facade,
 * and writing that reflection out again here is the hand-rolled second inverse that
 * cutaway.ts and frames.ts both warn mirrors the building invisibly.
 *
 * WHICH SIDE THE CAMERA IS ON is decided by the same expression hiddenWalls() uses, in
 * the suite frame, through cameraInSuite(). That is not belt and braces: if the shell
 * picked its half by any independent route the two cuts could pick opposite halves,
 * and a shell cut disagreeing with the interior's cut reads as a rendering fault
 * rather than as a section.
 */
export function weldCut(
  mode: CutawayMode,
  camera: Vec3,
  params: SuiteParams,
  prev: WeldCut = NO_CUT,
): WeldCut {
  if (mode === "none") return NO_CUT;
  if (mode === "roofOff") return ROOF_CUT;

  const openings = bays(params);

  if (mode === "section") {
    const su = sectionPlaneU(params);
    const u = suiteToBuilding(su, 0, params).u;
    // Which way suite +u runs in building u, sampled off place.ts's map rather than
    // reasoned about: +1 on the west facade, -1 on the east.
    const inward = Math.sign(suiteToBuilding(su + 1, 0, params).u - u) as 1 | -1;
    const side = cameraInSuite(camera, params).u - su;
    // Camera in the cut plane, i.e. standing in the hall: neither half is the near
    // one. hiddenWalls() hides nothing here rather than pick, so nor does this.
    if (Math.abs(side) < EPS) return ROOF_CUT;
    const near = (Math.sign(side) * inward) as 1 | -1;

    const drop = new Set<number>();
    openings.forEach((b, i) => {
      // Wholly on the camera's side, which is hiddenWalls()'s rule for a band. A bay
      // is a box, so its own extent across the plane is what "wholly" measures.
      const half = (b.alongV ? b.through : b.w) / 2;
      if (near * (b.u - u) - half > -EPS) drop.add(i);
    });
    return { roof: true, walls: NO_PARTS, bays: drop, half: { u, keep: -near as 1 | -1 } };
  }

  // wallsDown
  const cam = siteToBuilding(fromThree(camera));
  const walls = new Set<number>();
  for (let i = 0; i < LOOP_B.length; i++) {
    const threshold = prev.walls.has(i) ? -WALL_HOLD_FT : 0;
    if (edgeMargin(i, cam) > threshold) walls.add(i);
  }
  const drop = new Set<number>();
  openings.forEach((b, i) => {
    // A bay goes with the shell wall it is a hole in, found rather than assumed. Left
    // standing, a dropped wall's bay is an 8 x 10.75 ft slab of slate hanging in the
    // hole it was a window in.
    if (walls.has(nearestEdge(b))) drop.add(i);
  });
  return { roof: true, walls, bays: drop, half: null };
}

/**
 * How far the camera is outside one shell edge, and how squarely, in feet.
 *
 * Deliberately the same two-term minimum as cutaway.ts's private outwardMargin(), and
 * for the same two reasons: `beyond` is the distance past the wall's own face, because
 * a camera inside the masonry is not outside the building, and `squarely` is what
 * makes it the NEAR wall rather than any wall whose normal merely leans camera-ward.
 * Their min is one scalar so that one hold distance covers both the plane crossing and
 * the diagonal where a corner hands over from one face to the next.
 *
 * Not imported, because it is not exported and this file must not widen cutaway.ts's
 * surface to reach it -- and it could not be used unchanged anyway. That version takes
 * an axis-aligned band in the suite frame and reads its normal off a sign; this ring's
 * 56 edges point every which way, so the normal comes from the edge direction and the
 * along-edge term uses the edge's own tangent. Written that way the two agree exactly
 * where the interior's bands are axis-aligned, which is everywhere.
 *
 * CONSEQUENCE, MEASURED, AND IT IS THE REASON wallsDown IS NOT THE DOLLHOUSE MODE.
 * From the stage 3 keyframe -- 189 ft east and 151 ft south of the centroid in the
 * building frame, which is the view the dollhouse would be edited from -- this drops the
 * roof and 9 of the 56 edges, 97.9 ft of the 440.3 ft perimeter. Eight of them face east
 * and the ninth faces south, and every one of them lies SOUTH of v = 19.9, because
 * `squarely` is measured from each edge's own midpoint and the camera is 150 ft down the
 * building from the suite. The suite's windows sit at v 33.7 to 70.9. So the shell opens
 * along a stretch of facade with
 * nothing behind it, the four facade bays keep their wall, and NO bay is dropped: what
 * you get is a hole into the south half of a building whose north half is still shut.
 * hiddenWalls() hides no interior band at all from that camera, so the interior is not
 * open either. What opens the suite from there is section, which takes the whole east
 * half including the facade in front of the rooms, or roofOff from above.
 *
 * Loosening the along-edge term for the shell alone is not the fix. It would open the
 * shell and leave the suite's own masonry standing inside it, since hiddenWalls() would
 * still refuse the same bands -- strictly worse than either mode as it stands.
 * tests/weldGeometry.test.ts pins the part of this that matters, that from the stage 3
 * keyframe every dropped edge is south of every bay and no bay comes down, so a keyframe
 * that moved would fail there rather than leave this paragraph quietly wrong.
 */
function edgeMargin(i: number, cam: Building): number {
  const a = LOOP_B[i]!;
  const b = LOOP_B[(i + 1) % LOOP_B.length]!;
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const len = Math.hypot(du, dv);
  const tu = du / len;
  const tv = dv / len;
  // Interior lies left of travel on a counter-clockwise ring, so outward is the
  // right-hand perpendicular -- extrude.ts's side-wall normal and gableRoof()'s, here
  // in the building frame. siteToBuilding is a rotation, so it preserves the winding
  // and the same formula holds without a sign to guess.
  const nu = tv;
  const nv = -tu;
  const mu = cam.u - (a.u + du / 2);
  const mv = cam.v - (a.v + dv / 2);
  const beyond = nu * (cam.u - a.u) + nv * (cam.v - a.v);
  const squarely = nu * mu + nv * mv - Math.abs(tu * mu + tv * mv);
  return Math.min(beyond, squarely);
}

/**
 * The shell wall a bay is a hole in: the nearest ring edge that RUNS THE SAME WAY the
 * bay's own wall does.
 *
 * Distance alone is not enough, and the axis term is not belt and braces -- it was put
 * here by a measurement. The distances from a reveal centred on the suite's masonry
 * mid-plane to its own ring edge run from 0.17 ft (bedroom A's north window) to 5.36
 * (the common room's, out in the wing zone where the ring is 62 ft wide), but the
 * runner-up is as close as 1.16 ft and for bedroom B's south window it is an EXACT TIE:
 * 1.870 ft to a 17 ft facade edge and 1.870 ft to a 3.1 ft north-facing jog beside it,
 * decided by nothing but which one the loop reached first. It reached the jog, and the
 * consequence was visible: from the stage 4 keyframe, square on the north gable, that
 * jog drops and took a facade window with it -- a dark 8 x 10.75 ft panel vanishing out
 * of a facade that is still standing.
 *
 * The axis breaks the tie by the only thing that makes it a tie in the first place. A
 * bay's `alongV` says which way its own wall runs, place.ts maps suite u and v onto
 * building u and v without swapping them, so the ring edge that carries the bay is the
 * one that runs the same way; the jog runs across it and is a different wall. Falls back
 * to the plain nearest if no edge shares the axis, which this ring never does -- it has
 * 56 edges in both -- and which is one comparison rather than a throw for a case a
 * re-digitised ring could reach.
 */
function nearestEdge(bay: Bay): number {
  let best = -1;
  let bestD = Infinity;
  let fallback = 0;
  let fallbackD = Infinity;
  for (let i = 0; i < LOOP_B.length; i++) {
    const a = LOOP_B[i]!;
    const b = LOOP_B[(i + 1) % LOOP_B.length]!;
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const t = Math.max(
      0,
      Math.min(1, ((bay.u - a.u) * du + (bay.v - a.v) * dv) / (du * du + dv * dv)),
    );
    const d = Math.hypot(bay.u - (a.u + t * du), bay.v - (a.v + t * dv));
    if (d < fallbackD) {
      fallbackD = d;
      fallback = i;
    }
    const edgeAlongV = Math.abs(dv) > Math.abs(du);
    if (edgeAlongV !== bay.alongV) continue;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? fallback : best;
}

/**
 * The shell: the ring extruded to the eaves, minus whatever the cut removes.
 *
 * One extrude() call, and then the index ranges the cut leaves standing. The header
 * carries why it is selected rather than rebuilt, why the lid goes with the roof and
 * why the grade cap never goes.
 */
function shellGeometry(cut: WeldCut): THREE.BufferGeometry | null {
  const n = LOOP.length;
  const ex = extrude(weld.rings[0] as number[][], WELD.eaves);
  const capTris = n - 2;
  // extrude.ts's documented layout, asserted rather than trusted: everything below
  // indexes into it, and a change there would otherwise show as a shell missing an
  // arbitrary wall rather than as an error.
  if (ex.positions.length !== 6 * n * 3 || ex.indices.length !== (2 * capTris + 2 * n) * 3) {
    throw new Error("weldGeometry: extrude()'s layout has moved; the shell cut indexes into it");
  }

  const pos = Array.from(ex.positions);
  const nrm = Array.from(ex.normals);
  const idx: number[] = [];
  const copyTris = (from: number, count: number) => {
    for (let k = from * 3; k < (from + count) * 3; k++) idx.push(ex.indices[k]!);
  };

  if (!cut.roof) copyTris(0, capTris);
  copyTris(capTris, capTris);

  for (let e = 0; e < n; e++) {
    if (cut.walls.has(e)) continue;
    const tri = 2 * capTris + 2 * e;
    if (cut.half === null) {
      copyTris(tri, 2);
      continue;
    }

    const a = LOOP_B[e]!;
    const b = LOOP_B[(e + 1) % n]!;
    const sa = cut.half.keep * (a.u - cut.half.u);
    const sb = cut.half.keep * (b.u - cut.half.u);
    if (sa >= 0 && sb >= 0) {
      copyTris(tri, 2);
      continue;
    }
    if (sa <= 0 && sb <= 0) continue;

    // One endpoint each side. The kept part runs from the crossing to whichever end
    // survived, in the edge's own a-to-b order, so extrude()'s winding carries over
    // with no sign to decide.
    const t = sa / (sa - sb);
    const p0 = LOOP[e]!;
    const p1 = LOOP[(e + 1) % n]!;
    const at: [number, number] = [p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])];
    const from = sa > 0 ? p0 : at;
    const to = sa > 0 ? at : p1;

    // The whole edge's own normal, read back out of the extrusion rather than
    // recomputed. Its first side vertex is at 2n + 4e, per the layout asserted above.
    const nv = (2 * n + 4 * e) * 3;
    const normal: Vec3 = [nrm[nv]!, nrm[nv + 1]!, nrm[nv + 2]!];
    const base = pos.length / 3;
    for (const p of [
      toThree(from[0], from[1], 0),
      toThree(to[0], to[1], 0),
      toThree(to[0], to[1], WELD.eaves),
      toThree(from[0], from[1], WELD.eaves),
    ]) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(normal[0], normal[1], normal[2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  if (idx.length === 0) return null;

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
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

/**
 * One reveal box per bay, cut through the wall at the suite's floor level.
 *
 * `drop` names the bays a cutaway has taken away, by index into the same list
 * bayRects() reports. Skipped rather than emitted at zero size, for the reason
 * Suite.tsx skips a hidden band: a degenerate box is a NaN normal waiting to discard
 * the whole draw call, and this one would cost that call either way.
 */
function bayGeometry(
  params: SuiteParams,
  drop: ReadonlySet<number> = NO_PARTS,
): THREE.BufferGeometry | null {
  const b = new Builder();
  const y0 = floorLevel(1);
  let emitted = 0;
  bays(params).forEach((bay, i) => {
    if (drop.has(i)) return;
    const du = bay.alongV ? bay.through : bay.w;
    const dv = bay.alongV ? bay.w : bay.through;
    b.box({ u: bay.u, v: bay.v }, du, dv, y0, y0 + bay.h);
    emitted++;
  });
  return emitted > 0 ? b.build() : null;
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
