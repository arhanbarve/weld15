"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
// three-stdlib exports the older name; three's own copy calls it mergeGeometries.
import { mergeBufferGeometries } from "three-stdlib";
import { buildSuite, type Rect, type SuiteParams } from "@/geo/rooms";
import { buildWalls, suiteFootprint, type Opening, type Wall } from "@/geo/walls";
import { suiteToThree, floorLevel } from "@/geo/place";
import type { Piece } from "@/geo/furniture";
import type { DragResult } from "@/geo/drag";
import { hiddenWalls, type CutawayMode } from "./cutaway";
import { DragLayer } from "./DragLayer";
import { materials, scaleFloorUv } from "./materials";
import { Furniture } from "./Furniture";

/**
 * Weld 15's interior in daylight: plaster, oak, glazing, and 1.5 ft of masonry
 * with a reveal at every window.
 *
 * WHAT IS DRAWN, AND HOW MANY DRAW CALLS IT COSTS
 * Seven meshes at the defaults, plus eight from <Furniture>. Every one of them is
 * a merge of many boxes: the fifteen wall bands become thirty-one boxes once the
 * openings are cut out of them, and all thirty-one land in two geometries chosen
 * by wall kind, because the kind is what decides the material. One mesh per box
 * would be 31 draw calls for the walls alone against a budget of 25 for the whole
 * suite. The merge is therefore not an optimisation bolted on afterwards; it is
 * why the openings can be cut at all.
 *
 * WHY OPENINGS ARE THREE OR FOUR BOXES AND NEVER A HOLE
 * There is no CSG here and none is wanted. A band with a door in it is emitted as
 * the solid stretch either side plus a lintel over the top; a window adds a sill
 * under it. The four faces of the resulting void are the reveal, and in the 1.5 ft
 * facade masonry that reveal is 1.5 ft deep -- which is most of what makes an
 * 1872 brick building read as brick rather than as a plasterboard set.
 *
 * WHY THE BAND'S OWN THICKNESS AND NOT THE KIND'S NOMINAL FIGURE
 * Each Wall is drawn at the thickness walls.ts measured for it, which for the
 * perimeter bands is exactly params.masonry or params.partition. It is NOT
 * re-derived from w.kind, because the grid-derived bands are the complement of the
 * rooms and some of them are legitimately thicker than a partition: at the
 * defaults the band at u = 20..21 beside the common room is a foot thick, because
 * commonDeep is 20 and legDepth is 21. Substituting the nominal 0.5 ft there would
 * open a half-foot slot down the length of the suite. The kind still decides the
 * material, and so how the reveal reads.
 *
 * TWO TRAPS THIS FILE HAS ALREADY PAID FOR
 * Every material carries side = DoubleSide. The camera stands inside these rooms,
 * a FrontSide box is invisible from within, and a FrontSide interior blanked the
 * entire frame at t = 0.7 once already.
 * At partial opacity depthWrite goes off. A half-transparent mesh that writes
 * depth occludes whatever is drawn after it, so the suite sorted wrong against the
 * dissolving shell during the threshold.
 *
 * WHAT THE OPENING LIST GETS WRONG, AND WHY IT IS RENDERED ANYWAY
 * buildOpenings() centres each face window on its WALL BAND rather than on the
 * room it lights. The facade band is one 44 ft band shared by four rooms, so at the
 * defaults all four facade windows come back at offset 18 with width 8 -- the same
 * span, four times over. Rendering them literally means four coincident panes of a
 * transmissive material fighting for the same depth, so overlapping cuts of the same
 * kind are merged before anything is emitted. What is NOT done is moving them: the
 * exterior's window bays come from the same list, and an interior that quietly
 * disagrees with the facade is worse than an interior that is wrong in the same way.
 * The fix belongs in buildOpenings(); see the report.
 */

/** Floor slab thickness, ft. Reads as a floor in the cutaway rather than as paper. */
const FLOOR_SLAB = 0.3;

/** Ceiling plate thickness, ft. Same reason. */
const CEILING_SLAB = 0.25;

/**
 * Vertical extents of the openings, ft above the finished floor. ALL THREE ARE
 * ASSUMED -- neither weld.json, the 1875 specification nor the phase brief gives a
 * door or a sash dimension, and walls.ts models openings as a width and an offset
 * with no height at all. A 7 ft door and a sill-to-head run of 2.5 to 9.0 ft is
 * ordinary for a room with a 10.75 ft ceiling, which is the whole of the basis.
 * They are clamped to the wall height below, so a slider that drops the ceiling
 * under the head height shortens the window instead of emitting a negative lintel.
 */
const DOOR_H = 7;
const SILL_H = 2.5;
const HEAD_H = 9;

/** Glazing: a nominal single pane, and how far in from the outer face it sits. */
const PANE_T = 0.06;
const PANE_INSET = 0.3;

/**
 * The mark on the unknown room's floor, ft. Two crossed diagonals, raised.
 * See unknownMarkSlabs() for what it is for.
 */
const MARK_W = 0.35;
const MARK_H = 0.05;

/** Float slack. Same rationale as collide.ts's EPSILON, which is not exported. */
const EPS = 1e-9;

/**
 * The suite frame's basis vectors, expressed in three.js world space.
 *
 * An earlier version put every mesh inside one rotated group and negated the
 * local coordinates by hand. The negations were wrong and the rooms landed
 * outside the building, which showed up as a single grey plane filling the frame.
 * Deriving the basis from suiteToThree() instead means the only mapping in play is
 * the one place.ts already tests.
 */
export function suiteBasis(params: SuiteParams) {
  const o = suiteToThree(0, 0, 0, params);
  const du = suiteToThree(1, 0, 0, params);
  const dv = suiteToThree(0, 1, 0, params);
  const uDir = new THREE.Vector3(du[0] - o[0], 0, du[2] - o[2]).normalize();
  const vDir = new THREE.Vector3(dv[0] - o[0], 0, dv[2] - o[2]).normalize();
  // A Y-rotation by yaw sends local +x to (cos, 0, -sin). Solve for yaw from uDir.
  const yaw = Math.atan2(-uDir.z, uDir.x);
  return { origin: o, uDir, vDir, yaw };
}

/** World-space centre of a suite-frame rect at a given height. */
export function rectCentre(r: Rect | Wall, z: number, params: SuiteParams): THREE.Vector3 {
  const c = suiteToThree(r.u + r.du / 2, r.v + r.dv / 2, z, params);
  return new THREE.Vector3(c[0], c[1], c[2]);
}

/**
 * A box in the suite frame: a footprint rect plus the vertical band it fills.
 *
 * `turn` exists for the one thing in the interior that is not axis-aligned, the
 * unknown room's diagonal mark. `boards` asks for the oak grain to be scaled to
 * this box's real size -- see slabGeometry().
 */
type Slab = {
  u: number;
  v: number;
  du: number;
  dv: number;
  y0: number;
  y1: number;
  turn?: number;
  boards?: true;
};

/**
 * One Slab as a positioned BufferGeometry.
 *
 * Position comes from suiteToThree() and rotation from suiteBasis(), so a box
 * cannot drift from the plan however the params move -- the property
 * tests/suite-transform.test.ts pins.
 *
 * The oak grain is scaled HERE and nowhere else. scaleFloorUv() multiplies the UVs
 * already on the geometry, so it is not idempotent and must see each geometry
 * exactly once; a freshly built box that is about to be merged is the only place
 * that is guaranteed. The merge copies the scaled UVs, so one shared oak material
 * at repeat 1 still gives 6 in boards in a 20 ft common room and in a 4.5 ft hall
 * at the same time. Calling it per render instead is what makes a floor read as one
 * enormous board.
 */
function slabGeometry(s: Slab, yaw: number, params: SuiteParams): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(s.du, s.y1 - s.y0, s.dv);
  if (s.boards) scaleFloorUv(g, s.du, s.dv);
  const c = suiteToThree(s.u + s.du / 2, s.v + s.dv / 2, (s.y0 + s.y1) / 2, params);
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(c[0], c[1], c[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + (s.turn ?? 0), 0)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return g;
}

/**
 * Many slabs as one geometry, or null when there are none.
 *
 * The parts are disposed after the copy. They never reach the GPU, so this costs
 * nothing; it is here so that a params change cannot leave a heap of orphaned
 * BufferGeometry behind on every slider tick.
 */
function mergeSlabs(
  slabs: Slab[],
  yaw: number,
  params: SuiteParams,
  what: string,
): THREE.BufferGeometry | null {
  if (slabs.length === 0) return null;
  const parts = slabs.map((s) => slabGeometry(s, yaw, params));
  const merged = mergeBufferGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error(`Suite: mergeBufferGeometries returned null for ${what}`);
  merged.computeBoundingSphere();
  return merged;
}

/** A void cut through a wall band: a span along its length and a vertical range. */
type Cut = { lo: number; hi: number; y0: number; y1: number };

/**
 * Which way a band runs, how long it is, and how thick.
 *
 * Openings measure their offset along the band's long axis, so this is what
 * translates walls.ts's one-dimensional offsets back into the suite frame.
 */
function bandAxis(w: Wall): { alongV: boolean; along: number; thick: number } {
  const alongV = w.dv >= w.du;
  return { alongV, along: alongV ? w.dv : w.du, thick: alongV ? w.du : w.dv };
}

/** A span along a band's length, back as a suite-frame rect. */
function spanRect(w: Wall, lo: number, hi: number, alongV: boolean) {
  return alongV
    ? { u: w.u, v: w.v + lo, du: w.du, dv: hi - lo }
    : { u: w.u + lo, v: w.v, du: hi - lo, dv: w.dv };
}

/**
 * The voids to cut out of one band, overlaps already merged.
 *
 * Merging is load-bearing rather than defensive: at the defaults the facade band
 * carries four windows at the identical span, one per room that declares a facade
 * window, because buildOpenings() centres each on the band. Four coincident
 * transmissive panes z-fight; one pane does not.
 *
 * Doors and windows are merged separately -- they have different heads, and a
 * door merged into a window would acquire a sill.
 */
function cutsFor(w: Wall, openings: Opening[], wallH: number): Cut[] {
  const { along } = bandAxis(w);
  const raw: (Cut & { kind: Opening["kind"] })[] = [];

  for (const o of openings) {
    if (o.wallId !== w.id) continue;
    const lo = Math.max(0, Math.min(along, o.offset));
    const hi = Math.max(lo, Math.min(along, o.offset + o.width));
    if (hi - lo < EPS) continue;
    const y1 = Math.min(wallH, o.kind === "door" ? DOOR_H : HEAD_H);
    const y0 = o.kind === "door" ? 0 : Math.min(SILL_H, y1);
    raw.push({ lo, hi, y0, y1, kind: o.kind });
  }

  raw.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
  const out: (Cut & { kind: Opening["kind"] })[] = [];
  for (const c of raw) {
    const last = out[out.length - 1];
    const same =
      last !== undefined &&
      last.kind === c.kind &&
      Math.abs(last.y0 - c.y0) < EPS &&
      Math.abs(last.y1 - c.y1) < EPS;
    if (same && c.lo <= last.hi + EPS) last.hi = Math.max(last.hi, c.hi);
    else out.push({ ...c });
  }
  return out;
}

/** The stretches of a band's length that stay solid full height. */
function solidSpans(cuts: Cut[], along: number): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  for (const c of cuts) {
    if (c.lo - x > EPS) out.push([x, c.lo]);
    x = Math.max(x, c.hi);
  }
  if (along - x > EPS) out.push([x, along]);
  return out;
}

/**
 * One wall band as three or four boxes per opening: the solid stretches either
 * side, a lintel over each void, and a sill under each window.
 */
function wallSlabs(w: Wall, cuts: Cut[], floor: number, wallH: number): Slab[] {
  const { alongV, along } = bandAxis(w);
  const out: Slab[] = [];

  for (const [lo, hi] of solidSpans(cuts, along)) {
    out.push({ ...spanRect(w, lo, hi, alongV), y0: floor, y1: floor + wallH });
  }
  for (const c of cuts) {
    const r = spanRect(w, c.lo, c.hi, alongV);
    if (c.y0 > EPS) out.push({ ...r, y0: floor, y1: floor + c.y0 });
    if (wallH - c.y1 > EPS) out.push({ ...r, y0: floor + c.y1, y1: floor + wallH });
  }
  return out;
}

/**
 * Where the pane sits across the band's thickness: the low coordinate of the
 * glass, measured on whichever axis the band is thin in.
 *
 * A sash sits toward the OUTER face, and that asymmetry is the point -- it is what
 * leaves 1.2 ft of reveal on the room side of a 1.5 ft masonry wall and only 0.3 ft
 * outside. Which face is outer is derived from the rooms the band touches rather
 * than assumed: the facade band runs at u = -1.5..0 with its rooms at higher u, the
 * gable band at v = 44..45.5 with its room at lower v, so no fixed sign is right
 * for both. A band that touches no room at all gets a centred pane.
 */
function paneLow(w: Wall, rooms: Rect[]): number {
  const { alongV, thick } = bandAxis(w);
  const mid = alongV ? w.u + w.du / 2 : w.v + w.dv / 2;
  const low = alongV ? w.u : w.v;
  const centres = w.between
    .map((id) => rooms.find((r) => r.id === id))
    .filter((r): r is Rect => r !== undefined)
    .map((r) => (alongV ? r.u + r.du / 2 : r.v + r.dv / 2));

  if (centres.length === 0) return mid - PANE_T / 2;
  const inside = centres.reduce((a, b) => a + b, 0) / centres.length;
  return inside > mid
    ? low + PANE_INSET
    : low + thick - PANE_INSET - PANE_T;
}

/** The glass in one band's window voids. Doors get none, which is the point of the split. */
function paneSlabs(w: Wall, cuts: Cut[], rooms: Rect[], floor: number): Slab[] {
  const { alongV } = bandAxis(w);
  const p = paneLow(w, rooms);
  // A window is the cut with a sill under it; a door reaches the floor.
  return cuts
    .filter((c) => c.y0 > EPS)
    .map((c) => ({
      ...(alongV
        ? { u: p, v: w.v + c.lo, du: PANE_T, dv: c.hi - c.lo }
        : { u: w.u + c.lo, v: p, du: c.hi - c.lo, dv: PANE_T }),
      y0: floor + c.y0,
      y1: floor + c.y1,
    }));
}

/**
 * The mark across the unknown room's floor: two ribs corner to corner.
 *
 * One room in the suite is kind "unknown" and has no door, deliberately -- it is
 * 7.5 ft of measured space whose use no source gives, and rooms.ts's
 * unreachableRooms() is told to exempt it for the same reason. Rendering it as an
 * ordinary bedroom would assert the one thing the project refuses to assert, so it
 * gets three signals, none of which is hue on its own:
 *
 *   1. no oak. It is the only room in the suite with an unfinished floor, so it
 *      differs by the presence or absence of board seams and grain, which survives
 *      greyscale and colour blindness alike.
 *   2. this mark, the crossed diagonals a survey draws through a cell it has no
 *      content for.
 *   3. no furniture, because furniture.ts fits out bedrooms and commons only.
 *
 * Corner to corner needs no clipping -- the rib IS the diagonal -- which is why it
 * is an X and not a hatch. A rotation of theta about the vertical sends the rib's
 * own long axis to (cos theta, -sin theta) in the suite's (u, v), so the two
 * diagonals are atan2(-dv, du) and atan2(dv, du).
 */
function unknownMarkSlabs(r: Rect, floor: number): Slab[] {
  const len = Math.hypot(r.du, r.dv);
  const cu = r.u + r.du / 2;
  const cv = r.v + r.dv / 2;
  return [Math.atan2(-r.dv, r.du), Math.atan2(r.dv, r.du)].map((turn) => ({
    u: cu - len / 2,
    v: cv - MARK_W / 2,
    du: len,
    dv: MARK_W,
    y0: floor,
    y1: floor + MARK_H,
    turn,
  }));
}

type SuiteGeometry = {
  oakFloors: THREE.BufferGeometry | null;
  unknownFloor: THREE.BufferGeometry | null;
  unknownMark: THREE.BufferGeometry | null;
  partitions: THREE.BufferGeometry | null;
  masonry: THREE.BufferGeometry | null;
  glazing: THREE.BufferGeometry | null;
  ceiling: THREE.BufferGeometry | null;
  yaw: number;
};

/**
 * The whole interior as at most seven geometries, grouped by the material each
 * needs rather than by what part of the building it is.
 */
function buildSuiteGeometry(params: SuiteParams, hidden: ReadonlySet<string>): SuiteGeometry {
  const suite = buildSuite(params);
  const { walls, openings } = buildWalls(suite);
  const { yaw } = suiteBasis(params);
  const floor = floorLevel(1);
  const wallH = params.ceiling;

  const oak: Slab[] = [];
  const bare: Slab[] = [];
  const mark: Slab[] = [];
  for (const r of suite.rooms) {
    const slab: Slab = {
      u: r.u,
      v: r.v,
      du: r.du,
      dv: r.dv,
      y0: floor - FLOOR_SLAB,
      y1: floor,
    };
    if (r.kind === "unknown") {
      bare.push(slab);
      mark.push(...unknownMarkSlabs(r, floor));
    } else {
      oak.push({ ...slab, boards: true });
    }
  }

  const partitions: Slab[] = [];
  const masonry: Slab[] = [];
  const panes: Slab[] = [];
  for (const w of walls) {
    // A hidden wall is not drawn at all rather than drawn transparent, and its glazing
    // goes with it. Transparency would leave the pane hanging in mid-air where the
    // wall was, and would still cost the draw call and the depth sort that the merge
    // above exists to avoid. cutaway.ts's hysteresis is what stops this rebuilding on
    // alternate frames as the camera crosses a wall's plane.
    if (hidden.has(w.id)) continue;
    const cuts = cutsFor(w, openings, wallH);
    const target = w.kind === "exterior" ? masonry : partitions;
    target.push(...wallSlabs(w, cuts, floor, wallH));
    panes.push(...paneSlabs(w, cuts, suite.rooms, floor));
  }

  /**
   * The ceiling sits at params.ceiling, which IS weld.json's
   * meta.ceiling_height_ft_estimate -- DEFAULT_PARAMS.ceiling carries that 10.75 ft
   * over from the 12 ft floor-to-floor. Taken from the params rather than read back
   * out of weld.json so that a slider cannot separate the ceiling from the tops of
   * the walls it closes.
   *
   * It is the gross footprint, NOT one plate per room.
   *
   * Per-room plates would seam over every partition, and two rects that overlap
   * at the same height z-fight -- which is also why the footprint is used as
   * walls.ts gives it rather than grown by the masonry thickness to cap the
   * perimeter wall tops. The leg and the K bump abut without overlapping. The
   * uncapped 1.5 ft rim over the facade masonry cannot be seen from inside the
   * room, and in the roof-off cutaway it reads as the wall's own thickness, which
   * is worth more than a flush plate.
   */
  const ceilingH = floor + params.ceiling;
  const ceiling: Slab[] = suiteFootprint(suite).map((f) => ({
    u: f.u,
    v: f.v,
    du: f.du,
    dv: f.dv,
    y0: ceilingH,
    y1: ceilingH + CEILING_SLAB,
  }));

  return {
    oakFloors: mergeSlabs(oak, yaw, params, "oak floors"),
    unknownFloor: mergeSlabs(bare, yaw, params, "unknown room floor"),
    unknownMark: mergeSlabs(mark, yaw, params, "unknown room mark"),
    partitions: mergeSlabs(partitions, yaw, params, "partitions"),
    masonry: mergeSlabs(masonry, yaw, params, "exterior walls"),
    glazing: mergeSlabs(panes, yaw, params, "glazing"),
    ceiling: mergeSlabs(ceiling, yaw, params, "ceiling"),
    yaw,
  };
}

/**
 * The five palette materials this component paints with, cloned once.
 *
 * materials() hands out singletons for the life of the process and that is
 * exactly right for what it guarantees: one shader program, one grain texture, no
 * material built inside a render. Two of the properties needed here are not
 * properties of the palette, though. `opacity` is per-frame threshold state, and
 * `side` is a fact about where the camera stands, not about what plaster is. Writing
 * either onto the shared object would push this component's dissolve into every
 * other consumer of the same material.
 *
 * So: clone once per mount, never per render -- a clone in a render body is the
 * same leak as a material in a render body -- and dispose on unmount. A clone
 * copies the texture by reference, so the oak grain is not redrawn, and three
 * caches shader programs by their parameters, so it is not recompiled either.
 */
function useSuitePalette(opacity: number) {
  const pal = useMemo(() => {
    const m = materials();
    const p = {
      oak: m.oak.clone(),
      plaster: m.plaster.clone(),
      masonry: m.masonry.clone(),
      glazing: m.glazing.clone(),
      slate: m.slate.clone(),
    };
    // Every face here is seen from inside a room. FrontSide culls all of them.
    for (const x of Object.values(p)) x.side = THREE.DoubleSide;
    return p;
  }, []);

  useEffect(() => {
    return () => {
      for (const x of Object.values(pal)) x.dispose();
    };
  }, [pal]);

  useMemo(() => {
    for (const x of Object.values(pal)) {
      x.transparent = opacity < 1;
      x.opacity = opacity;
      // depthWrite off below full opacity: a half-transparent mesh that writes
      // depth hides whatever is drawn after it, which is how the suite came to
      // sort wrongly against the dissolving shell.
      x.depthWrite = opacity > 0.99;
    }
  }, [pal, opacity]);

  return pal;
}

const NO_WALLS: ReadonlySet<string> = new Set();

/**
 * Callbacks for a Suite mounted without an editor above it.
 *
 * Module constants rather than inline arrows, so that a Suite rendered read-only --
 * which is every stage before 5, and every test that mounts it for its geometry -- does
 * not hand DragLayer a new function identity on every render and defeat its memos.
 */
const NO_SELECT = () => {};
const NO_RESULT = () => {};

/** Two sets of wall ids, compared by content. */
function sameWalls(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * Which walls the cutaway is currently hiding, from where the camera actually is.
 *
 * The camera position is read per frame because that is the only place it exists --
 * CameraRig writes it directly onto the three.js camera, so there is no store field to
 * subscribe to. What must NOT happen per frame is a React render, and that is what the
 * set comparison is for: hiddenWalls() returns a fresh Set every call, so handing it
 * straight to useState would re-render sixty times a second and rebuild every wall
 * geometry with it.
 *
 * The previous set is fed back in, which is what arms cutaway.ts's hysteresis: a
 * dropped wall stays dropped until the camera is WALL_HOLD_FT past its plane. Without
 * that feedback a camera sitting exactly on a wall's plane would flicker it on and off
 * on alternate frames, and each flip would rebuild the merged geometry.
 */
function useHiddenWalls(
  walls: Wall[],
  mode: CutawayMode,
  params: SuiteParams,
): ReadonlySet<string> {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(NO_WALLS);
  const live = useRef<ReadonlySet<string>>(NO_WALLS);
  const at = useRef<[number, number, number]>([NaN, NaN, NaN]);

  useFrame(({ camera }) => {
    // Nothing at all while the mode is off. hiddenWalls() returns an empty set for
    // "none" and "roofOff" in one comparison, but getting there still costs a call and a
    // set allocation per frame for the two modes that are the common case.
    if (mode === "none" || mode === "roofOff") {
      if (live.current.size > 0) {
        live.current = NO_WALLS;
        setHidden(NO_WALLS);
      }
      return;
    }

    // A quarter of a foot of camera movement before recomputing. hiddenWalls()'s
    // wallsDown branch calls buildSuite() and then walks every band, and doing that on
    // every frame of a stationary camera is pure waste -- measured as a real stall in the
    // e2e run, where SwiftShader is already at a 65 ms frame and a mode change stopped
    // responding to input. A quarter foot is half the drag grid, so no crossing that
    // matters can be skipped, and the hysteresis in cutaway.ts is what handles the case
    // of a camera creeping across a wall plane a hair at a time.
    const p = camera.position;
    const [x, y, z] = at.current;
    if (Math.abs(p.x - x) < 0.25 && Math.abs(p.y - y) < 0.25 && Math.abs(p.z - z) < 0.25) return;
    at.current = [p.x, p.y, p.z];

    const next = hiddenWalls(walls, mode, [p.x, p.y, p.z], params, live.current);
    if (sameWalls(next, live.current)) return;
    live.current = next;
    setHidden(next);
  });

  // A mode change has to recompute even if the camera has not moved an inch, so the
  // remembered position is dropped when the mode does change. Without this, switching
  // from wallsDown to section while parked shows the previous mode's walls.
  useEffect(() => {
    at.current = [NaN, NaN, NaN];
  }, [mode, walls, params]);

  return hidden;
}

/**
 * Weld 15's interior.
 *
 * `cutaway` arrives as a mode rather than as a boolean, and `pieces` as an
 * arrangement rather than being derived: both are store state now, which is what P6
 * bought. The ceiling comes off for every mode except "none" -- not only for
 * "roofOff" -- because a wall dropped by wallsDown or a plane taken out by section
 * still leaves you looking into a room through a lid if the plate stays up.
 */
export function Suite({
  visible,
  opacity,
  params,
  pieces,
  cutaway = "none",
  furniture = true,
  edit = false,
  selected = null,
  onSelect,
  onResult,
  onHiddenWalls,
}: {
  visible: boolean;
  opacity: number;
  params: SuiteParams;
  /** The arrangement, from the store. */
  pieces: Piece[];
  cutaway?: CutawayMode;
  furniture?: boolean;
  /** Whether the pointer can pick up and move a piece. */
  edit?: boolean;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onResult?: (id: string, r: DragResult) => void;
  /** Reported upward so the HUD can say what is currently hidden. */
  onHiddenWalls?: (ids: ReadonlySet<string>) => void;
}) {
  const shape = useMemo(() => {
    const suite = buildSuite(params);
    return { suite, ...buildWalls(suite) };
  }, [params]);
  const hidden = useHiddenWalls(shape.walls, cutaway, params);
  const ceiling = cutaway === "none";
  const geo = useMemo(() => buildSuiteGeometry(params, hidden), [params, hidden]);
  const pal = useSuitePalette(opacity);

  useEffect(() => {
    onHiddenWalls?.(hidden);
  }, [hidden, onHiddenWalls]);

  useEffect(() => {
    return () => {
      for (const g of Object.values(geo)) {
        if (g instanceof THREE.BufferGeometry) g.dispose();
      }
    };
  }, [geo]);

  if (opacity <= 0.001) return null;

  return (
    <group visible={visible}>
      {geo.oakFloors ? <mesh geometry={geo.oakFloors} material={pal.oak} /> : null}
      {geo.unknownFloor ? <mesh geometry={geo.unknownFloor} material={pal.masonry} /> : null}
      {geo.unknownMark ? <mesh geometry={geo.unknownMark} material={pal.slate} /> : null}
      {geo.partitions ? <mesh geometry={geo.partitions} material={pal.plaster} /> : null}
      {geo.masonry ? <mesh geometry={geo.masonry} material={pal.masonry} /> : null}
      {geo.glazing ? <mesh geometry={geo.glazing} material={pal.glazing} /> : null}
      {geo.ceiling ? (
        <mesh geometry={geo.ceiling} material={pal.plaster} visible={ceiling} />
      ) : null}
      {furniture ? (
        <Furniture opacity={opacity} params={params} yaw={geo.yaw} pieces={pieces} />
      ) : null}
      {/* The drag layer is mounted HERE and not in Experience, because DragLayer's
          contract is that its suite, openings, pieces and yaw all describe the same
          params -- drag.ts throws if an opening names a wall the suite has not got.
          This component already holds all four for one `params`, so passing them from
          one place is what makes disagreement impossible rather than merely unlikely.
          `shape` and `geo.yaw` come from the same memo chain the walls were built
          from. */}
      <DragLayer
        enabled={edit && visible && opacity > 0.99}
        params={params}
        suite={shape.suite}
        pieces={pieces}
        openings={shape.openings}
        yaw={geo.yaw}
        selected={selected}
        onSelect={onSelect ?? NO_SELECT}
        onResult={onResult ?? NO_RESULT}
      />
    </group>
  );
}
