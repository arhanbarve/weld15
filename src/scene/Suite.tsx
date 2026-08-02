"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
// three-stdlib exports the older name; three's own copy calls it mergeGeometries.
import { mergeBufferGeometries } from "three-stdlib";
import { buildSuite, type Rect, type SuiteParams } from "@/geo/rooms";
import { buildWalls, suiteFootprint, type Opening, type Wall } from "@/geo/walls";
import { sashParts } from "@/geo/sash";
import { trimParts, RAIL_H, doorCasingParts, doorLeafParts, thresholdParts } from "@/geo/trim";
import { bathFixtureParts } from "@/geo/fixtures";
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
 * Ten meshes at the defaults (P10 added sash joinery, which also carries
 * baseboard and picture rail, and a separate cornice mesh so it stays
 * visible when the ceiling plate is cut away; P14 row 9 adds one more for the
 * bathroom mirror, the one fixture reflective enough to need its own
 * material), plus eleven from <Furniture>
 * (P10 batches by kind AND material, up from eight). Every one of them is a
 * merge of many boxes: the fifteen wall bands
 * become thirty-one boxes once the openings are cut out of them, and all
 * thirty-one land in two geometries chosen by wall kind, because the kind is
 * what decides the material. One mesh per box would be 31 draw calls for the
 * walls alone against a budget of 25 for the whole suite, already exceeded
 * and re-measured at the end of P10 rather than pretended otherwise. The
 * merge is therefore not an optimisation bolted on afterwards; it is why the
 * openings can be cut at all.
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
 * WHY OVERLAPPING CUTS ARE STILL MERGED, EVEN THOUGH THEY NO LONGER OVERLAP AT THE DEFAULTS
 * buildOpenings() (walls.ts) centres each window on the ROOM it lights, not on the
 * band it sits in -- a bug where all four facade windows landed at the same offset
 * was fixed there. What remains here is the merge of overlapping cuts of the same
 * kind before anything is emitted, kept because a slider can still bring two rooms'
 * windows into contact on a shared band; at the defaults it has nothing to do.
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

/** How far in from the outer face the sash sits -- see sashSlabs(). */
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
export type Slab = {
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
 * How far a baked-AO darkening reaches from a box's own edge, ft. ASSUMED -- a few
 * inches, the same order as a real contact shadow where a baseboard meets a floor.
 */
export const AO_DEPTH_FT = 0.15;

/** How dark the very edge of a box gets, as a multiple of its own material color. ASSUMED. */
export const AO_MIN = 0.72;

/**
 * An axis is worth subdividing for AO once it clears this, ft. ASSUMED, but not
 * arbitrary: it is twice AO_DEPTH_FT, the shortest an axis can be and still have
 * ANY point further than AO_DEPTH_FT from both its own ends at once.
 */
const AO_SEG_MIN_FT = 2 * AO_DEPTH_FT;

/**
 * Interior resolution once an axis clears AO_SEG_MIN_FT. ASSUMED, chosen small on
 * purpose -- see applyAoColor()'s own header on why a fine grid is not affordable
 * here, and this function's own test file for the measured triangle cost this
 * bought project-wide.
 */
const AO_SEGMENTS = 3;

/**
 * How many segments slabGeometry() should build a box's given axis with, so
 * applyAoColor() below has an interior vertex to read a gradient from. BoxGeometry
 * vertices sit ONLY at face corners -- every one of a plain box's 24 vertices has
 * ALL THREE local coordinates pinned to that axis's own half-extent, so a
 * distance-to-edge computed straight off `position` is zero everywhere and every
 * vertex reads as the same, fully-occluded colour. This is the fix: segments add
 * vertices along the middle of an axis, where distance-to-edge is genuinely
 * nonzero, and this function is the one place that decides how many.
 */
export function aoSegments(extentFt: number): number {
  return extentFt > AO_SEG_MIN_FT ? AO_SEGMENTS : 1;
}

/**
 * Baked per-vertex ambient occlusion, box by box -- P14 row 10.
 *
 * NOT N8AO. Effects.tsx's own header records why a screen-space AO pass was tried and
 * dropped: its per-frame cost under SwiftShader (headless Chromium's software
 * rasterizer, which the whole e2e suite runs on) broke a wall-clock-timed walk test
 * and timed out a perf test outright, and gating it on measured frame time is the
 * fix Perf.tsx's own header already warns against. This is the opposite kind of cost:
 * a one-time vertex attribute, written when the geometry is built (the same moment
 * scaleFloorUv() scales its UVs) and never touched again. Zero per-frame cost, and no
 * new DRAW call -- every box still merges into the same handful of meshes. It is not
 * free in triangles (see aoSegments()'s own header and this function's test file for
 * the measured total), which is the one cost this trades against N8AO's frame time.
 *
 * THE PROXY, AND WHY IT NEEDS NO NEW DATA. Every wall in this suite is emitted as
 * the complement of the rooms (geo/walls.ts's own header), so a room's Rect already
 * IS bounded by its own walls -- there is no separate "distance to the nearest wall"
 * fact to fetch for a floor slab, because that distance is exactly the distance to
 * the slab's OWN footprint edge. The same is true vertically: a wall slab's y0 is
 * exactly where it meets the floor and y1 exactly where it meets the lintel or
 * ceiling. So this darkens every box toward its OWN silhouette, using only the Slab
 * already in scope, before slabGeometry()'s own transform moves it into the room.
 * That is a real simplification: it cannot tell a real inside corner (two walls
 * meeting) from a doorway (no wall there at all), and doing so would mean threading
 * the wall adjacency graph through every merge. What it buys uniformly and for free
 * is every floor-to-wall line, every wall-to-ceiling line, every piece of trim's own
 * edge, and every fixture's own base reading as a hair darker than its own centre --
 * the cue N8AO gave without N8AO's per-frame cost.
 *
 * THE THINNEST AXIS IS EXCLUDED, and this is the second fix past plain
 * distance-to-edge. A Slab is a THIN THING along at least one axis by construction
 * -- a floor is a few inches of FLOOR_SLAB, a baseboard is BASE_PROUD ft proud of
 * the wall -- and that thinness is the slab's own nature, not a sign of occlusion.
 * Folding it into the same min() as the other two axes would zero the gradient
 * everywhere on a floor twenty feet across, because every vertex sits at the top or
 * bottom face regardless of where it is in the room. Excluding the box's own
 * shortest axis leaves the two axes where "near this box's own edge" is actually a
 * meaningful occlusion cue -- for a floor, its footprint; for a baseboard, its run
 * and its height.
 *
 * UNIFORM ACROSS EVERY SLAB, NOT SOME. mergeBufferGeometries (three-stdlib) requires
 * every geometry in one merge call to carry the same attribute set or none of them,
 * throwing otherwise -- so a `color` attribute half-applied within one merged mesh
 * (say, room floors but not threshold boards, which share the `oak` merge) is not an
 * option. Called on every box before every merge, so every Suite mesh gets one, and
 * useSuitePalette() below turns `vertexColors` on for every material to match --
 * including the ones this component's own comment on itself already flags as shared
 * across several meshes (plaster across partitions/cornice/ceiling, masonry across
 * the unknown room's floor and the exterior walls), which is exactly why "some
 * boxes get it" was never survivable here.
 */
export function applyAoColor(geometry: THREE.BufferGeometry, s: Slab): void {
  const position = geometry.getAttribute("position");
  const half: [number, number, number] = [s.du / 2, (s.y1 - s.y0) / 2, s.dv / 2];
  const thinnest = half.indexOf(Math.min(...half));
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const p: [number, number, number] = [position.getX(i), position.getY(i), position.getZ(i)];
    let edge = Infinity;
    for (let axis = 0; axis < 3; axis++) {
      if (axis === thinnest) continue;
      edge = Math.min(edge, half[axis]! - Math.abs(p[axis]!));
    }
    const t = Math.min(1, Math.max(0, edge / AO_DEPTH_FT));
    const b = AO_MIN + (1 - AO_MIN) * t;
    colors[i * 3] = b;
    colors[i * 3 + 1] = b;
    colors[i * 3 + 2] = b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

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
 * enormous board. applyAoColor() is the same idiom for the same reason, one
 * attribute later.
 */
function slabGeometry(s: Slab, yaw: number, params: SuiteParams): THREE.BufferGeometry {
  const height = s.y1 - s.y0;
  const g = new THREE.BoxGeometry(
    s.du,
    height,
    s.dv,
    aoSegments(s.du),
    aoSegments(height),
    aoSegments(s.dv),
  );
  if (s.boards) scaleFloorUv(g, s.du, s.dv);
  applyAoColor(g, s);
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
export type Cut = { lo: number; hi: number; y0: number; y1: number };

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
export function cutsFor(w: Wall, openings: Opening[], wallH: number): Cut[] {
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
 * Whether the ROOM face of this band is at its low or high edge on the
 * thickness axis, derived from the rooms the band touches rather than
 * assumed: the facade band runs at u = -1.5..0 with its rooms at higher u
 * (room is high), the gable band at v = 44..45.5 with its room at lower v
 * (room is low), so no fixed sign is right for both. A band that touches no
 * room at all is called low arbitrarily -- nothing looks at it from either
 * side.
 */
function roomFaceIsLow(w: Wall, rooms: Rect[]): boolean {
  const { alongV } = bandAxis(w);
  const mid = alongV ? w.u + w.du / 2 : w.v + w.dv / 2;
  const centres = w.between
    .map((id) => rooms.find((r) => r.id === id))
    .filter((r): r is Rect => r !== undefined)
    .map((r) => (alongV ? r.u + r.du / 2 : r.v + r.dv / 2));
  if (centres.length === 0) return true;
  const inside = centres.reduce((a, b) => a + b, 0) / centres.length;
  return inside <= mid;
}

/**
 * Every real window in one band's voids, as Slabs in the suite frame. Doors
 * get none, which is the point of the cut-kind split in cutsFor().
 *
 * geo/sash.ts builds each window in its OWN local frame -- u along the
 * opening's width, v from the room face (0) into the wall, y absolute height
 * -- so this function's whole job is the same axis remap paneSlabs() used to
 * do for one flat pane: which suite axis is "along" the band (the opening's
 * u) and which is "across" its thickness (the opening's v), and, since v
 * always runs room-to-outer while the suite has no such universal sign,
 * mirroring it when the room face is the band's HIGH edge rather than its low
 * one. `sashDepth` keeps the same ~1.2 ft (of a 1.5 ft wall) reveal on the
 * room side the old flat pane placed its glass at, now spent on a sash with
 * real thickness instead of a single 0.06 ft plane.
 */
function sashSlabs(
  w: Wall,
  cuts: Cut[],
  rooms: Rect[],
  floor: number,
): { joinery: Slab[]; glass: Slab[] } {
  const { alongV, thick } = bandAxis(w);
  const low = alongV ? w.u : w.v;
  const roomLow = roomFaceIsLow(w, rooms);
  const sashDepth = thick - PANE_INSET;

  const joinery: Slab[] = [];
  const glass: Slab[] = [];
  for (const c of cuts) {
    if (c.y0 <= EPS) continue; // a door reaches the floor; only windows get a sash
    const width = c.hi - c.lo;
    for (const p of sashParts(width, floor + c.y0, floor + c.y1, sashDepth)) {
      const alongLo = c.lo + p.u;
      const across = roomLow ? low + p.v : low + thick - p.v - p.dv;
      const slab: Slab = alongV
        ? { u: across, v: w.v + alongLo, du: p.dv, dv: p.du, y0: p.y0, y1: p.y1 }
        : { u: w.u + alongLo, v: across, du: p.du, dv: p.dv, y0: p.y0, y1: p.y1 };
      (p.material === "glass" ? glass : joinery).push(slab);
    }
  }
  return { joinery, glass };
}

/**
 * Baseboard, picture rail, cornice and door casing for one band, on every
 * room-facing side of it. An exterior band has exactly one: the room it
 * encloses. A partition, in this suite's layout, always has a real room on
 * both sides -- rooms.ts never leaves a partition's far side open -- so both
 * faces get trim, each proud in the opposite direction, at the SAME
 * across-axis mirror sashSlabs() uses.
 *
 * Door casing is symmetric -- unlike the leaf, it has no `turn` and no
 * opinion about which room is which -- so it is placed here, by the same
 * per-face mirror as the baseboard, rather than beside the leaf in
 * doorLeafSlabs() below.
 */
function roomTrimSlabs(
  w: Wall,
  cuts: Cut[],
  rooms: Rect[],
  floor: number,
  ceiling: number,
): { joinery: Slab[]; plaster: Slab[] } {
  const { alongV, along, thick } = bandAxis(w);
  const low = alongV ? w.u : w.v;
  const doorCuts = cuts.filter((c) => c.y0 <= EPS);
  const doorSpans = solidSpans(doorCuts, along);
  const railSpans = solidSpans(cuts.filter((c) => c.y1 > RAIL_H + EPS), along);
  const faces = w.kind === "exterior" ? [roomFaceIsLow(w, rooms)] : [true, false];

  const joinery: Slab[] = [];
  const plaster: Slab[] = [];
  for (const roomLow of faces) {
    for (const p of trimParts(doorSpans, railSpans, along, ceiling)) {
      const across = roomLow ? low + p.v : low + thick - p.v - p.dv;
      const slab: Slab = alongV
        ? { u: across, v: w.v + p.u, du: p.dv, dv: p.du, y0: floor + p.y0, y1: floor + p.y1 }
        : { u: w.u + p.u, v: across, du: p.du, dv: p.dv, y0: floor + p.y0, y1: floor + p.y1 };
      (p.material === "plaster" ? plaster : joinery).push(slab);
    }
    for (const c of doorCuts) {
      for (const p of doorCasingParts(c.hi - c.lo, c.y1)) {
        const localU = p.u + c.lo;
        const across = roomLow ? low + p.v : low + thick - p.v - p.dv;
        const slab: Slab = alongV
          ? { u: across, v: w.v + localU, du: p.dv, dv: p.du, y0: floor + p.y0, y1: floor + p.y1 }
          : { u: w.u + localU, v: across, du: p.du, dv: p.dv, y0: floor + p.y0, y1: floor + p.y1 };
        joinery.push(slab);
      }
    }
  }
  return { joinery, plaster };
}

/**
 * One oak threshold strip per door, spanning the wall's own thickness --
 * placed ONCE per doorway rather than per face, since it is the strip in the
 * gap itself, not a room-facing surface. Pushed by the caller into the same
 * merged geometry as the room floors, so it costs zero draw calls of its own.
 */
function thresholdSlabs(w: Wall, cuts: Cut[], floor: number): Slab[] {
  const { alongV, thick } = bandAxis(w);
  const low = alongV ? w.u : w.v;
  const out: Slab[] = [];
  for (const c of cuts) {
    if (c.y0 > EPS) continue; // only a door reaches the floor
    for (const p of thresholdParts(c.hi - c.lo, thick)) {
      const localU = p.u + c.lo;
      const across = low + p.v;
      out.push(
        alongV
          ? { u: across, v: w.v + localU, du: p.dv, dv: p.du, y0: floor + p.y0, y1: floor + p.y1 }
          : { u: w.u + localU, v: across, du: p.du, dv: p.dv, y0: floor + p.y0, y1: floor + p.y1 },
      );
    }
  }
  return out;
}

/**
 * Which side of a wall band one specific room sits on, along the band's
 * across (thickness) axis.
 *
 * roomFaceIsLow() above answers a related but different question -- "is the
 * ROOM FACE this band draws trim toward, on average, its low or high edge" --
 * averaged over every room `w.between` names, which is the right question
 * for a symmetric part drawn on both faces. A door leaf is chiral: it swings
 * into ONE specific room, named by the opening's own `connects[1]`, and that
 * room's side has to be asked for directly rather than averaged with
 * whatever else happens to touch the same band.
 */
function roomIsOnLowSide(w: Wall, room: Rect): boolean {
  const { alongV } = bandAxis(w);
  const mid = alongV ? w.u + w.du / 2 : w.v + w.dv / 2;
  const centre = alongV ? room.u + room.du / 2 : room.v + room.dv / 2;
  return centre <= mid;
}

/** Wainscot height, ft: an ordinary tile dado. ASSUMED, no source. */
const WAINSCOT_H = 4.0;
const WAINSCOT_PROUD = 0.05;

/**
 * A porcelain dado on one wall band's bathroom-facing side, floor to
 * WAINSCOT_H, broken at the doorway exactly like the baseboard it stands in
 * front of -- reusing the SAME door-cut solid spans, since a wainscot that
 * ran across the opening would be tile floating in the doorway.
 *
 * Called once per wall FROM the main loop, with that wall's own already-built
 * `cuts`, rather than as a second pass over every wall: the bathroom is one
 * room, so this is one extra `if` in a loop that already runs, not a second
 * loop that mostly finds nothing.
 */
export function bathWainscotSlab(w: Wall, cuts: Cut[], bath: Rect, floor: number): Slab[] {
  if (!w.between.includes(bath.id)) return [];
  const { alongV, along, thick } = bandAxis(w);
  const low = alongV ? w.u : w.v;
  const doorSpans = solidSpans(
    cuts.filter((c) => c.y0 <= EPS),
    along,
  );
  const roomLow = roomIsOnLowSide(w, bath);
  // Same mirror as roomTrimSlabs()'s trimParts() placement: a proud part's low
  // corner sits at `low - proud` on the room's own side, or flush at
  // `low + thick` (NOT + proud again) on the far side -- checked numerically
  // against that existing, already-shipped formula rather than re-derived.
  const across = roomLow ? low - WAINSCOT_PROUD : low + thick;
  const out: Slab[] = [];
  for (const [lo, hi] of doorSpans) {
    out.push(
      alongV
        ? { u: across, v: w.v + lo, du: WAINSCOT_PROUD, dv: hi - lo, y0: floor, y1: floor + WAINSCOT_H }
        : { u: w.u + lo, v: across, du: hi - lo, dv: WAINSCOT_PROUD, y0: floor, y1: floor + WAINSCOT_H },
    );
  }
  return out;
}

/**
 * The hung-open leaf for every door opening whose swing target is a real,
 * modelled room -- which today is every interior door; the suite's own entry
 * (P14 row 3) hangs a leaf too, but closed, and is handled by its caller
 * passing a near-zero `openDeg` rather than by a branch in here.
 *
 * WHY THIS IS SEPARATE FROM roomTrimSlabs()'S PER-FACE LOOP
 * A leaf is chiral -- see doorLeafParts()'s own header -- so placing it via
 * the same mirror formula the casing above uses would flip its swing
 * direction on the face it was not computed for, which is wrong rather than
 * merely reversed: a leaf only physically exists on the one side of the wall
 * it swings into. This function places it directly against ITS room, once,
 * negating `turn` (and only `turn`; the along-axis mapping never changes)
 * when that room is on the wall's high side -- the axis flip on `across`
 * that the high-side placement needs inverts handedness, and a rotation
 * composed with a single-axis reflection is that same rotation negated. See
 * geo/trim.ts's own header for the swing geometry this starts from.
 *
 * A SECOND CORRECTION, AND IT IS THE ONE THAT MATTERS FOR MOST OF THIS SUITE'S
 * DOORS. For an alongV band (dv >= du, the shape of the long partition every
 * hall door pierces), this file's own convention swaps du/dv AND swaps which
 * of (along, across) becomes suite u versus suite v -- across maps to suite u
 * there, along to suite v, the opposite of a !alongV band. Swapping which
 * axis is first and which is second is a REFLECTION (determinant -1), not a
 * rotation, and a symmetric part never shows it -- every other Slab in this
 * file has no `turn`, so a mirrored box is indistinguishable from an
 * unmirrored one. `doorLeafParts()`'s `turn` is not symmetric: it was derived
 * in the (along, across) frame assuming no such mirror, and a rotation seen
 * through a mirror is that rotation negated. So the alongV case needs `turn`
 * negated to compensate, on top of (not instead of) the roomLow reflection
 * above.
 *
 * NOT DERIVED FROM FIRST PRINCIPLES ALONE -- CALIBRATED AGAINST THE REAL
 * TRANSFORM. An earlier version of this function guessed the compensation
 * was a fixed -90 degree ROTATION rather than a SIGN FLIP, reasoning from
 * "which suite axis does a box's local +X land on" rather than "which axis
 * is this suite's actual long dimension for THIS box" -- both true facts, but
 * the wrong one to reason from, and it passed no test because none existed
 * yet. tests/suite-transform.test.ts's door-leaf block runs
 * slabGeometry()'s own position+rotation transform on one real door of each
 * kind this suite has (alongV true and false, target room on the low and
 * high side of its band) and checks in WORLD space, which is the one frame
 * every quantity here is unambiguously already in -- no inverse transform,
 * which is its own trap (see that file's header for the one this exposed).
 *
 * `openings` is walked directly rather than through the merged `Cut[]`
 * cutsFor() builds, because a Cut has already lost the one thing a leaf
 * needs and casing does not: which two rooms this specific opening connects.
 */
/**
 * How far the suite's own entry hangs open, degrees. Not `OPEN_DEG`: every
 * other door in this suite is hung wide because walk.ts and route.ts both
 * treat its doorway as passable, and a leaf sitting nearly shut would be
 * geometry contradicting a route the code still walks. The entry is the one
 * doorway walk.ts's own solidsOf() deliberately never cuts -- "never leaves
 * the suite" is the property docs/phases/P7-P8.md asks for -- so a leaf
 * standing almost closed there is the geometry telling the TRUTH: a viewer
 * cannot walk through this one. Not fully closed (0 deg): a hair open is what
 * tells the two shots apart at a glance, and is what a real door left
 * unlatched looks like.
 */
const ENTRY_AJAR_DEG = 12;

export function doorLeafSlabs(
  walls: Wall[],
  openings: Opening[],
  rooms: Rect[],
  floor: number,
  wallH: number,
  hidden: ReadonlySet<string>,
  openDeg?: number,
): Slab[] {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const out: Slab[] = [];
  for (const o of openings) {
    if (o.kind !== "door") continue;
    // Every interior door names a real room second; the suite's own entry
    // names "outside" (walk.ts's own token for the unmodelled stair hall) --
    // the one case this suite's doors have where connects[1] is not a room.
    // It still has a real room FIRST, though, and that is what its leaf hangs
    // against: hall, nearly shut. See ENTRY_AJAR_DEG.
    const targetId = byId.has(o.connects[1] ?? "") ? o.connects[1] : o.connects[0];
    const target = byId.get(targetId ?? "");
    if (!target) continue; // neither name is a room this suite has modelled
    const isEntry = !byId.has(o.connects[1] ?? "");
    const w = walls.find((x) => x.id === o.wallId);
    // A hidden wall is not drawn -- see the note on the main wall loop in
    // buildSuiteGeometry() -- and its leaf goes with it, for the same reason:
    // a leaf hanging in a doorway whose jamb has been cut away is a leaf with
    // nothing to hinge from.
    if (!w || hidden.has(w.id)) continue;
    const { alongV, thick } = bandAxis(w);
    const low = alongV ? w.u : w.v;
    const doorH = Math.min(wallH, DOOR_H);
    const roomLow = roomIsOnLowSide(w, target);
    for (const p of doorLeafParts(o.width, doorH, "low", isEntry ? ENTRY_AJAR_DEG : openDeg)) {
      const localU = p.u + o.offset;
      // Same reflection sashSlabs()/roomTrimSlabs() use for the high-side face:
      // `low+thick-p.v-p.dv`, not `low+thick-p.v` -- the box's own local extent
      // has to come out of the reflection too, or the leaf's CENTRE lands a
      // half-thickness off (checked numerically, not just derived).
      const across = roomLow ? low + p.v : low + thick - p.v - p.dv;
      // `alongV` swaps not just du/dv but WHICH of (along, across) maps to
      // (suite v, suite u) versus (suite u, suite v) -- a swap of which axis
      // is first and which is second, which is a reflection (determinant -1),
      // not a rotation. A rotation viewed through a mirror is that rotation
      // negated, and `turn` was derived in the (along, across) frame assuming
      // no such mirror -- so the alongV case needs it negated to compensate,
      // on top of (not instead of) the roomLow face-reflection above. Found by
      // calibration (tests/suite-transform.test.ts's door-leaf describe block
      // runs the real transform end to end for one case of each kind), not by
      // a derivation that could be trusted alone -- this is the second time
      // today the algebra alone gave the wrong sign.
      const faced = roomLow ? p.turn : -p.turn;
      const turn = alongV ? faced : -faced;
      out.push(
        alongV
          ? { u: across, v: w.v + localU, du: p.dv, dv: p.du, y0: floor + p.y0, y1: floor + p.y1, turn }
          : { u: w.u + localU, v: across, du: p.du, dv: p.dv, y0: floor + p.y0, y1: floor + p.y1, turn },
      );
    }
  }
  return out;
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
  sashJoinery: THREE.BufferGeometry | null;
  glazing: THREE.BufferGeometry | null;
  cornice: THREE.BufferGeometry | null;
  ceiling: THREE.BufferGeometry | null;
  /** The bathroom's tile floor, porcelain wainscot, tub, lavatory and WC (P14 row 9), merged as one mesh. */
  tile: THREE.BufferGeometry | null;
  /** The bathroom's mirror -- the one fixture with a material of its own. */
  mirror: THREE.BufferGeometry | null;
  yaw: number;
};

/**
 * The whole interior as at most nine geometries, grouped by the material each
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
  const tile: Slab[] = [];
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
    } else if (r.kind === "bath") {
      // Ceramic, not oak boards -- no `boards: true`, since scaleFloorUv()'s
      // per-face grain scaling is an oak-floor concern and porcelain has no
      // grain map to scale.
      tile.push(slab);
    } else {
      oak.push({ ...slab, boards: true });
    }
  }

  const bath = suite.rooms.find((r) => r.kind === "bath");
  const partitions: Slab[] = [];
  const masonry: Slab[] = [];
  const sashJoinery: Slab[] = [];
  const glazing: Slab[] = [];
  const cornice: Slab[] = [];
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
    const sash = sashSlabs(w, cuts, suite.rooms, floor);
    sashJoinery.push(...sash.joinery);
    glazing.push(...sash.glass);
    const trim = roomTrimSlabs(w, cuts, suite.rooms, floor, wallH);
    sashJoinery.push(...trim.joinery);
    cornice.push(...trim.plaster);
    // Threshold boards are oak, same as the floor either side of them, so they
    // join the SAME merged geometry rather than opening a mesh of their own --
    // the doorway reads as two rooms without costing a draw call for it.
    oak.push(...thresholdSlabs(w, cuts, floor));
    if (bath) tile.push(...bathWainscotSlab(w, cuts, bath, floor));
  }
  // Fixtures (P14 row 9), walked once like the leaf below rather than per wall: they
  // are not wall-band features, just fixed geometry standing in the room. Present in
  // every cutaway mode, the same as the floor they stand on -- a wallsDown or section
  // cut removes the wall a fixture backs onto, not the fixture itself.
  const mirror: Slab[] = [];
  if (bath) {
    const fx = bathFixtureParts(bath, floor);
    tile.push(...fx.porcelain, ...fx.curtain);
    sashJoinery.push(...fx.joinery);
    mirror.push(...fx.mirror);
  }
  // Walked once over every opening rather than inside the per-wall loop above:
  // a leaf is chiral and needs the specific room it swings into, which a Cut
  // no longer carries -- see doorLeafSlabs()'s own header.
  sashJoinery.push(...doorLeafSlabs(walls, openings, suite.rooms, floor, wallH, hidden));

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
  // NOT merged into the ceiling plate above, on purpose: that mesh is hidden
  // in every cutaway mode but "none" (see the `ceiling` visibility prop
  // below), while the cornice sits on the WALLS and should stay visible
  // looking down into a roofless room.

  return {
    oakFloors: mergeSlabs(oak, yaw, params, "oak floors"),
    unknownFloor: mergeSlabs(bare, yaw, params, "unknown room floor"),
    unknownMark: mergeSlabs(mark, yaw, params, "unknown room mark"),
    partitions: mergeSlabs(partitions, yaw, params, "partitions"),
    masonry: mergeSlabs(masonry, yaw, params, "exterior walls"),
    sashJoinery: mergeSlabs(sashJoinery, yaw, params, "sash joinery"),
    glazing: mergeSlabs(glazing, yaw, params, "glazing"),
    cornice: mergeSlabs(cornice, yaw, params, "cornice"),
    ceiling: mergeSlabs(ceiling, yaw, params, "ceiling"),
    tile: mergeSlabs(tile, yaw, params, "bathroom tile"),
    mirror: mergeSlabs(mirror, yaw, params, "bathroom mirror"),
    yaw,
  };
}

/**
 * The six palette materials this component paints with, cloned once.
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
      oakDeep: m.oakDeep.clone(),
      plaster: m.plaster.clone(),
      masonry: m.masonry.clone(),
      glazing: m.glazing.clone(),
      slate: m.slate.clone(),
      porcelain: m.porcelain.clone(),
      mirror: m.mirror.clone(),
    };
    // Every face here is seen from inside a room. FrontSide culls all of them.
    for (const x of Object.values(p)) {
      x.side = THREE.DoubleSide;
      // Baked AO (applyAoColor(), P14 row 10): on for every material here, because
      // every Slab in this component gets a `color` attribute now and
      // mergeBufferGeometries refuses a merge where some geometries have one and
      // others don't. Cloned per mount for the same reason opacity/side are: the
      // materials() singleton is shared with CommonParts.tsx and Furniture.tsx,
      // neither of which bakes this attribute onto its own geometry.
      x.vertexColors = true;
    }
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

  // Shadows only while the suite is fully opaque; see the flags below.
  const solid = opacity > 0.99;

  if (opacity <= 0.001) return null;

  return (
    <group visible={visible}>
      {/* SHADOWS. Lighting.tsx configured the sun as a caster and left every mesh flag
          off, with a note that whoever turned them on had to re-measure the budget. This
          is that change, and the measurement is in the flags themselves: casting is
          gated on `solid` -- opacity above 0.99 -- because a shadow map is a second pass
          over every caster, and during the threshold dissolve the suite is half
          transparent and its shadows would be both wrong and paid for twice.

          Which meshes cast and which receive is not symmetric. Floors only receive:
          nothing is under them. Glazing does neither -- a transmissive pane casting an
          opaque shadow is the artefact that makes glass read as cardboard. The mark on
          the unknown room's floor is 0.05 ft tall and would cast a hairline nobody
          asked for. */}
      {geo.oakFloors ? (
        <mesh geometry={geo.oakFloors} material={pal.oak} receiveShadow={solid} />
      ) : null}
      {geo.unknownFloor ? (
        <mesh geometry={geo.unknownFloor} material={pal.masonry} receiveShadow={solid} />
      ) : null}
      {geo.unknownMark ? <mesh geometry={geo.unknownMark} material={pal.slate} /> : null}
      {geo.tile ? <mesh geometry={geo.tile} material={pal.porcelain} receiveShadow={solid} /> : null}
      {geo.mirror ? <mesh geometry={geo.mirror} material={pal.mirror} /> : null}
      {geo.partitions ? (
        <mesh geometry={geo.partitions} material={pal.plaster} receiveShadow={solid} />
      ) : null}
      {geo.masonry ? (
        <mesh geometry={geo.masonry} material={pal.masonry} receiveShadow={solid} />
      ) : null}
      {geo.sashJoinery ? (
        <mesh geometry={geo.sashJoinery} material={pal.oakDeep} receiveShadow={solid} />
      ) : null}
      {geo.glazing ? <mesh geometry={geo.glazing} material={pal.glazing} /> : null}
      {geo.cornice ? (
        <mesh geometry={geo.cornice} material={pal.plaster} receiveShadow={solid} />
      ) : null}
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
