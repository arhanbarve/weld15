"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
// three-stdlib exports the older name; three's own copy calls it mergeGeometries.
import { mergeBufferGeometries } from "three-stdlib";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { tryMove, type DragResult } from "@/geo/drag";
import { pieceBox, type Piece } from "@/geo/furniture";
import { floorLevel, suiteToThree } from "@/geo/place";
import type { Suite, SuiteParams } from "@/geo/rooms";
import type { Opening } from "@/geo/walls";
import { cameraInSuite } from "./cutaway";
import { SCAN } from "./materials";

/**
 * Moving the furniture with a pointer: click to select, drag to move, and a ghost
 * that says in advance whether the drop will be taken.
 *
 * PRESENTATIONAL. This file does not import @/state/store and must not. Every
 * attempt leaves through onResult and the integrator decides what to do with it,
 * for the reason docs/phases/P6-UI.md gives: the store is being rewritten in the
 * same window, so a component that reads a field which does not exist yet cannot be
 * type-checked by the person writing it. It also means the e2e gates can drive this
 * layer at any state without reaching into zustand.
 *
 * NO MATHS OF ITS OWN. Legality, snapping and the door rule are drag.ts's
 * tryMove(); the footprint is furniture.ts's pieceBox(); the world-to-suite inverse
 * is cutaway.ts's cameraInSuite(). What is left here is a pointer, two meshes and
 * the bookkeeping of one gesture.
 *
 * WHAT IT COSTS IN DRAW CALLS, WHICH IS THE CONSTRAINT
 * Suite plus Furniture already spend 15 of the suite's budget of 25 (Suite.tsx's
 * header; Perf.tsx publishes the count). So this layer adds:
 *
 *   0   enabled, nothing selected -- the hit plane's material carries
 *       visible = false, and WebGLRenderer.projectObject() skips a mesh whose
 *       MATERIAL is invisible before it ever reaches the render list. The OBJECT
 *       stays visible, which is what keeps it raycastable: three's Raycaster does
 *       not consult object.visible either, but R3F's event system walks
 *       state.internal.interaction and an object hidden from three's own traversal
 *       is a thing to reason about rather than a thing to rely on. Material-level
 *       invisibility needs no such argument -- it is exactly "do not draw this".
 *   1   a piece is selected: the outline.
 *   2   mid-drag: the outline, plus the ghost.
 *
 * WHY THERE IS NO HIT MESH PER PIECE
 * furniture.ts places 29 pieces at the defaults. One invisible box each is 29 draw
 * calls -- more than the whole suite's budget -- for geometry nobody ever sees.
 * Furniture.tsx already refused the same trade for the visible boxes and batched by
 * kind instead. Here the answer is better still: one plane at floorLevel(1) carries
 * the handlers, the intersection is converted into the suite frame, and the pieces
 * are hit-tested arithmetically against pieceBox(). That is the same rectangle
 * comparison collide.ts does on every pointer move already, and it costs nothing.
 *
 * THE PRICE OF THAT, STATED RATHER THAN HIDDEN
 * You pick a piece by pointing at the FLOOR it stands on, not at its own top face.
 * Pointing at the top of a 6 ft bookcase from a low camera projects to a floor
 * point somewhere behind it, so the pick can miss. Two things keep it usable: at
 * stage 5 the camera looks down into the room rather than along it, and the grab
 * offset is captured in the same projected frame -- so whatever parallax the first
 * pick has, it is CONSTANT through the gesture and cancels out of the delta. The
 * piece therefore tracks the pointer exactly even when the initial pick point was
 * not where the eye thought it was. A per-piece hit mesh would fix the pick and
 * blow the budget; the budget wins.
 *
 * THE FRAME, AND WHY IT CANNOT DRIFT
 * The pointer arrives as a three.js world point on the plane, and every question
 * asked of it is in the suite frame -- u inward from the facade, v north along the
 * section. The suite sits on a 13.2 degree axis (frames.ts), so a screen-space
 * delta is not a substitute for a real ray, which docs/phases/P6.md's risk table
 * says in as many words. The inverse is cameraInSuite(), which is named for a
 * camera and is general: it projects any world point onto suiteToThree()'s own
 * basis. Writing a second inverse here is the one thing this file must not do --
 * frames.ts warns that a wrong inverse mirrors the whole building invisibly, and a
 * second copy is only ever compared against itself. The forward direction is
 * suiteToThree() and the yaw arrives as a prop from Suite.tsx's suiteBasis(), so
 * the round trip is the mapping tests/place.test.ts and
 * tests/suite-transform.test.ts already pin, in both directions, with nothing new
 * to get wrong.
 *
 * WHY THE KEYBOARD IS NOT HERE
 * nudge() and tryRotate() are the arrow keys' and the rotate button's path, and
 * both live on the panel where a focusable control can carry them -- P6-UI.md gives
 * Panel.tsx onRotate and onNudge for exactly this. A canvas cannot be tabbed to and
 * a second key handler in here would be a second place for the keyboard path to
 * disagree with the pointer path about legality. drag.ts's "one code path, two
 * inputs" is the whole point; this file is one of the two inputs.
 */

/**
 * The suite's own selection hue, MASTER.md's `--focus` (#5EA6EB, mirrored in
 * app/globals.css). Not from materials(): that palette is FINISHES -- plaster, oak,
 * masonry, glazing -- and the ghost and the outline are chrome that happens to be
 * drawn in the scene rather than in the DOM. materials() deliberately hands out lit
 * MeshStandardMaterials and neither of these should be lit: a selection marker that
 * dims when the sun moves is a selection marker you can lose.
 */
const FOCUS = "#5EA6EB";

/**
 * How the refused ghost differs from the accepted one, and why it is not only hue.
 *
 * design-system/MASTER.md's checklist says colour is never the sole indicator, and a
 * ghost has no text to carry the word the way Provenance.tsx's chip does. So the
 * refusal changes FORM as well: the accepted ghost is a translucent solid, the
 * refused one is the same box drawn as wireframe, which reads as a crossed-out cage
 * in greyscale and to a colour-blind viewer alike. The hue then reinforces it --
 * `--focus` for a placement that will be taken, `--mark` (#E4526F, materials.ts's
 * SCAN.mark) for one that will not.
 *
 * The third signal is not in this file at all and is the one that actually names the
 * problem: onResult carries the reason and the ids it hit, and H words it into
 * Panel.tsx's `notice`, which is announced. Colour, form, word.
 */
const GHOST_OPACITY_OK = 0.4;
const GHOST_OPACITY_NO = 0.9;

/**
 * How much bigger than the piece the ghost is drawn, ft. A quarter of an inch.
 *
 * Not styling. A gesture begins with the candidate ON the piece's own anchor -- the
 * press has not moved yet, and a short drag inside a wall's snap catchment comes back
 * to it -- so the ghost's six faces would be exactly coplanar with the piece's and
 * z-fight, which reads as the furniture flickering rather than as a preview of it.
 * Growing the ghost puts every face clear of the one behind it at every candidate,
 * including that one. It is a hundredth of the grid, so it cannot be mistaken for
 * the piece being a different size.
 */
const GHOST_SWELL = 0.02;

/** Selection outline: band width, lift off the floor, and rib height, all ft. */
const OUTLINE_W = 0.2;
const OUTLINE_LIFT = 0.01;
const OUTLINE_H = 0.05;

/**
 * How far past the suite the hit plane reaches, as a multiple of the suite's own
 * longest dimension.
 *
 * Generous on purpose. The plane is what keeps a gesture alive: a pointer dragged
 * off the end of it stops producing intersections, and R3F then delivers the
 * captured hit from the moment of the press instead, which freezes the ghost where
 * it last was. Four times the section length is 176 ft at the defaults, well past
 * anywhere the stage-5 camera can point, and an unrendered plane of any size costs
 * nothing.
 */
const PLANE_SPAN = 4;

/** Float slack. Same rationale as collide.ts's EPSILON, which is not exported. */
const EPS = 1e-9;

export type DragLayerProps = {
  enabled: boolean;
  params: SuiteParams;
  /**
   * buildSuite(params), and it has to be that same pair: the suite decides what is
   * legal and the params decide where the ghost is drawn, so a mismatched pair
   * refuses moves in one room while painting the ghost in another.
   */
  suite: Suite;
  pieces: Piece[];
  /**
   * buildWalls(suite).openings. drag.ts rebuilds the walls from the suite and
   * throws if an opening names a wall the suite has no wall for, rather than
   * silently dropping the door check for that one door.
   */
  openings: Opening[];
  yaw: number; // suiteBasis(params).yaw, passed in
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** every attempt, accepted or refused. H commits or words the refusal. */
  onResult: (id: string, r: DragResult) => void;
};

/**
 * drag.ts's own vocabulary, pulled out of DragResult rather than retyped. A reason
 * added there then has to be handled here instead of being quietly stringified.
 */
type Refusal = Extract<DragResult, { ok: false }>["reason"];
type Snap = Extract<DragResult, { ok: true }>["snapped"];

/** The live candidate, in suite feet: where the ghost stands and how it reads. */
type Ghost = {
  u: number;
  v: number;
  ok: boolean;
  reason: Refusal | null;
  against: string[];
};

/** One gesture in flight. */
type Grab = {
  id: string;
  pointerId: number;
  /** where in the piece it was grabbed, suite feet, so the piece does not jump */
  offU: number;
  offV: number;
};

/** What went out through onResult last, flattened for a Playwright assertion. */
export type DragAttempt = {
  id: string;
  ok: boolean;
  /** accepted: where it landed and how it snapped */
  u?: number;
  v?: number;
  snapped?: Snap;
  /** refused: why, and what it hit */
  reason?: Refusal;
  against?: string[];
};

/**
 * window.__drag, for the e2e gates.
 *
 * Same device as CameraRig's window.__cam and Perf's window.__perf: a WebGL canvas
 * has no DOM to query and this component renders inside <Canvas>, so it can carry no
 * data-testid at all. What it can do is publish exactly what it believes, which is
 * strictly more useful for the gates that matter -- gate 3 wants "the rejection is
 * visible and the piece did not move", and `ghost.ok === false` with `last.ok ===
 * false` plus an unchanged `pieces` entry is that sentence, checkable.
 *
 * screenOf() is here so a gate can drive a REAL pointer drag rather than a
 * simulated one. Aiming Playwright's mouse at a piece means knowing where that
 * piece is on screen, which needs the camera; without it a test would have to
 * reimplement the projection or poke this component's internals. It is the forward
 * mapping this file already uses, composed with the camera R3F already has, and it
 * bypasses nothing: the events it lets a test aim are ordinary pointer events
 * arriving through R3F's raycaster.
 */
export type DragProbe = {
  enabled: boolean;
  selected: string | null;
  /** the piece under the button, or null when no gesture is in flight */
  dragging: string | null;
  ghost: Ghost | null;
  last: DragAttempt | null;
  /** every attempt that reached onResult, and how many of them were refused */
  attempts: number;
  refusals: number;
  /** every piece as this layer sees it, in suite feet */
  pieces: { id: string; u: number; v: number; yaw: number }[];
  /** a suite-frame floor point as CSS pixels in the viewport */
  screenOf: (u: number, v: number) => { x: number; y: number };
  /** the inverse this layer runs on every pointer move, exposed as it stands */
  suiteOf: (x: number, y: number, z: number) => { u: number; v: number };
};

/**
 * R3F replaces the event's `target` with its own capture shim at runtime, but
 * ThreeEvent inherits `target` from the DOM PointerEvent it is built on, where it is
 * an EventTarget. Hence the cast, in one place with the reason attached.
 *
 * The capture matters and is not belt-and-braces. Without it a pointerup over the
 * HUD, or outside the window, never reaches the plane's handler and the gesture
 * sticks: the ghost hangs in the room until the next press. With it R3F keeps the
 * pressed object in its capturedMap and delivers the press-time intersection when
 * the ray no longer finds the plane, so the up is always seen and the worst symptom
 * is a ghost that stops following.
 */
type CaptureTarget = {
  setPointerCapture: (id: number) => void;
  releasePointerCapture: (id: number) => void;
};
function captureTarget(e: ThreeEvent<PointerEvent>): CaptureTarget {
  return e.target as unknown as CaptureTarget;
}

/** Anchors apart by more than float noise. */
function moved(a: { u: number; v: number }, b: { u: number; v: number }): boolean {
  return Math.abs(a.u - b.u) > EPS || Math.abs(a.v - b.v) > EPS;
}

/**
 * The piece standing on a suite-frame floor point, if any.
 *
 * A linear scan over 29 rectangles, which is cheaper than anything with an index
 * would be at this size and is the same containment arithmetic collide.ts uses. The
 * first hit wins and that is not a tie-break: a legal arrangement has no two pieces
 * sharing floor, because placeIsLegal() is what put them there. Touching edges are
 * legal (collide.ts's overlaps() wants positive shared area), so a point exactly on
 * a shared edge belongs to whichever piece comes first in the list -- a quarter-inch
 * ambiguity on a 0.5 ft grid, and either answer is a piece the user is pointing at.
 */
function pieceAt(pieces: Piece[], p: { u: number; v: number }): Piece | null {
  for (const q of pieces) {
    const b = pieceBox(q);
    if (p.u >= b.u && p.u <= b.u + b.du && p.v >= b.v && p.v <= b.v + b.dv) return q;
  }
  return null;
}

/**
 * One suite-frame box as a positioned BufferGeometry.
 *
 * Suite.tsx's slabGeometry() without the oak UV scaling: position from
 * suiteToThree(), rotation from the suite yaw, so a box cannot drift from the plan
 * however the params move.
 */
function slab(
  r: { u: number; v: number; du: number; dv: number },
  y0: number,
  y1: number,
  yaw: number,
  params: SuiteParams,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(r.du, y1 - y0, r.dv);
  const c = suiteToThree(r.u + r.du / 2, r.v + r.dv / 2, (y0 + y1) / 2, params);
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(c[0], c[1], c[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return g;
}

/**
 * The selected piece's outline: four ribs straddling its footprint edge, merged into
 * one geometry.
 *
 * Merged for the same reason Suite.tsx merges its wall bands -- four meshes would be
 * four draw calls for one marker. Straddling rather than outside, so the outline
 * reads as the piece's own edge rather than as a second object beside it; the inner
 * half disappears under the piece, which is what makes the outer half read as an
 * outline at all.
 *
 * A LineSegments over EdgesGeometry was the obvious alternative and is one draw call
 * too. It is refused because a hairline is one device pixel wide whatever the
 * distance, so it thins to nothing on the piece nearest the camera -- the one being
 * selected -- and three's linewidth is capped at 1 on every WebGL platform, so there
 * is no knob for it. A rib has a real width in feet and behaves like the room it is
 * in.
 *
 * The two ribs along v are dropped for a piece narrower than the band itself, which
 * a slider that shrinks a room can produce; the two along u are always emitted, so
 * the marker never vanishes entirely.
 */
function outlineGeometry(p: Piece, yaw: number, params: SuiteParams): THREE.BufferGeometry {
  const b = pieceBox(p);
  const y0 = floorLevel(1) + OUTLINE_LIFT;
  const y1 = y0 + OUTLINE_H;
  const half = OUTLINE_W / 2;

  const bands = [
    { u: b.u - half, v: b.v - half, du: b.du + OUTLINE_W, dv: OUTLINE_W },
    { u: b.u - half, v: b.v + b.dv - half, du: b.du + OUTLINE_W, dv: OUTLINE_W },
  ];
  const between = b.dv - OUTLINE_W;
  if (between > EPS) {
    bands.push({ u: b.u - half, v: b.v + half, du: OUTLINE_W, dv: between });
    bands.push({ u: b.u + b.du - half, v: b.v + half, du: OUTLINE_W, dv: between });
  }

  const parts = bands.map((r) => slab(r, y0, y1, yaw, params));
  const merged = mergeBufferGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("DragLayer: mergeBufferGeometries returned null for the outline");
  merged.computeBoundingSphere();
  return merged;
}

/**
 * The four materials this layer paints with, built once per mount and disposed on
 * unmount.
 *
 * Same rule as useSuitePalette() in Suite.tsx and useFurniturePalette() in
 * Furniture.tsx: a material written inline in a render body is rebuilt on every
 * render, and each one compiles a shader program and holds GPU memory until the GC
 * gets round to it. These are not clones of materials() singletons because none of
 * them is a finish -- see FOCUS above -- so they are built here, which is the one
 * place in the file that is allowed to.
 *
 * MeshBasicMaterial throughout: unlit. Every one of these is chrome, and chrome that
 * takes the room's light stops being legible at exactly the moment the room gets
 * interesting. DoubleSide because the camera stands inside the suite and inside the
 * ghost, and a FrontSide box seen from within is invisible -- the trap Suite.tsx
 * paid for once already. depthWrite off on the two translucent ones, the second trap
 * in that header: a half-transparent mesh that writes depth occludes whatever is
 * drawn after it.
 */
function useChrome() {
  const mats = useMemo(() => {
    const m = {
      /** the hit plane. Invisible MATERIAL, visible object: see the header. */
      hit: new THREE.MeshBasicMaterial({ visible: false }),
      ghostOk: new THREE.MeshBasicMaterial({
        color: FOCUS,
        transparent: true,
        opacity: GHOST_OPACITY_OK,
        depthWrite: false,
      }),
      ghostNo: new THREE.MeshBasicMaterial({
        color: SCAN.mark,
        wireframe: true,
        transparent: true,
        opacity: GHOST_OPACITY_NO,
        depthWrite: false,
      }),
      outline: new THREE.MeshBasicMaterial({ color: FOCUS }),
    };
    for (const x of Object.values(m)) x.side = THREE.DoubleSide;
    return m;
  }, []);

  useEffect(() => {
    return () => {
      for (const x of Object.values(mats)) x.dispose();
    };
  }, [mats]);

  return mats;
}

export function DragLayer({
  enabled,
  params,
  suite,
  pieces,
  openings,
  yaw,
  selected,
  onSelect,
  onResult,
}: DragLayerProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);

  const [grab, setGrab] = useState<Grab | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [log, setLog] = useState<{ last: DragAttempt | null; attempts: number; refusals: number }>({
    last: null,
    attempts: 0,
    refusals: 0,
  });

  /**
   * The result the ghost is currently showing, kept as a ref rather than derived
   * again on release.
   *
   * THE TRAP THIS AVOIDS, which drag.ts's header names as the specific failure:
   * furniture that lands somewhere the ghost was not. Re-running tryMove() on the
   * pointerup point instead would be a second evaluation of a slightly different
   * point -- pointerup carries its own coordinates, and on a captured pointer that
   * has left the plane it carries the press-time ones. Committing the object the
   * ghost was drawn from means the drop IS the ghost, by construction.
   */
  const live = useRef<{ id: string; r: DragResult } | null>(null);

  const chrome = useChrome();

  const plane = useMemo(() => {
    if (!enabled) return null;
    const span = PLANE_SPAN * Math.max(params.sectionLength, params.legDepth);
    const c = suiteToThree(params.legDepth / 2, params.sectionLength / 2, floorLevel(1), params);
    return {
      geometry: new THREE.PlaneGeometry(span, span),
      position: new THREE.Vector3(c[0], c[1], c[2]),
    };
  }, [enabled, params]);

  useEffect(() => {
    return () => plane?.geometry.dispose();
  }, [plane]);

  /** One unit cube, scaled per instance by the ghost's own extents. */
  const unitBox = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => {
    return () => unitBox.dispose();
  }, [unitBox]);

  /**
   * The outline is rebuilt when the selected piece's own numbers change, NOT when the
   * `pieces` array changes identity.
   *
   * The distinction is load-bearing rather than tidy. setGhost() re-renders this
   * component on every pointer move, and `pieces` is a prop this file does not
   * control: an integrator who writes `pieces={layout(buildSuite(params))}` in the
   * JSX hands over a fresh array sixty times a second. Keyed on the array, that is
   * four BoxGeometries built, merged and disposed per frame for a marker that has not
   * moved -- the geometry-in-a-render-body leak Suite.tsx's header warns about,
   * arriving through the back door. `selKey` names everything outlineGeometry() reads
   * off the piece, so the memo is exact and not merely cheaper.
   */
  const sel = pieces.find((q) => q.id === selected) ?? null;
  const selKey = sel ? `${sel.id}|${sel.u}|${sel.v}|${sel.du}|${sel.dv}|${sel.yaw}` : "";
  const outline = useMemo(
    () => (enabled && sel ? outlineGeometry(sel, yaw, params) : null),
    // sel is intentionally absent: selKey is its every field this reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, selKey, yaw, params],
  );

  useEffect(() => {
    return () => outline?.dispose();
  }, [outline]);

  /** A gesture cannot outlive the layer being switched off. */
  useEffect(() => {
    if (enabled) return;
    live.current = null;
    setGrab(null);
    setGhost(null);
  }, [enabled]);

  /**
   * Ask drag.ts about a candidate anchor, and work out what the ghost should show.
   *
   * The accepted ghost stands at the SNAPPED position tryMove() returns, so the
   * ghost is where the piece will actually be. The refused one stands at the raw
   * candidate, because a refusal carries no position -- and running collide.ts's
   * snapToGrid/snapToWalls here to invent one would be a second copy of the
   * composition drag.ts's place() owns, which is the "two rules that agree today and
   * drift apart later" failure its header warns about. So: a refused ghost sits
   * under the pointer, unsnapped, which is honest -- nothing is going to land there
   * anyway.
   */
  const evaluate = (piece: Piece, u: number, v: number): Ghost => {
    const r = tryMove(piece, { u, v }, { suite, pieces, openings });
    live.current = { id: piece.id, r };
    return r.ok
      ? { u: r.piece.u, v: r.piece.v, ok: true, reason: null, against: [] }
      : { u, v, ok: false, reason: r.reason, against: r.against };
  };

  /**
   * The pointer, in suite feet.
   *
   * e.point is where the ray met the hit plane, in three.js world space, and
   * cameraInSuite() is the inverse -- see the header for why it is that function and
   * not a fifth line of sign-sensitive algebra written here.
   */
  const pointOf = (e: ThreeEvent<PointerEvent>) => cameraInSuite([e.point.x, e.point.y, e.point.z], params);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    const p = pointOf(e);
    const hit = pieceAt(pieces, p);

    if (!hit) {
      // Pointing at bare floor. Deselect, and start nothing.
      live.current = null;
      setGrab(null);
      setGhost(null);
      if (selected !== null) onSelect(null);
      return;
    }

    if (hit.id !== selected) onSelect(hit.id);
    captureTarget(e).setPointerCapture(e.pointerId);
    setGrab({ id: hit.id, pointerId: e.pointerId, offU: p.u - hit.u, offV: p.v - hit.v });
    setGhost(evaluate(hit, hit.u, hit.v));
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!grab || e.pointerId !== grab.pointerId) return;
    const piece = pieces.find((q) => q.id === grab.id);
    if (!piece) return;
    const p = pointOf(e);
    setGhost(evaluate(piece, p.u - grab.offU, p.v - grab.offV));
  };

  /**
   * Release: report the attempt, once.
   *
   * WHAT COUNTS AS AN ATTEMPT, AND WHY IT IS THE DROP RATHER THAN THE MOVE
   * onResult could fire on every pointer move -- there is a candidate on every one
   * of them -- and it is refused. H turns a refusal into a worded, announced notice;
   * sixty of those a second is a live region that says nothing and a store that
   * writes on every frame. So a gesture is one attempt: the ghost is the continuous
   * feedback, onResult is the commit. The piece does not move until the drop, which
   * is also what makes a refusal show as "the piece stayed where it was".
   *
   * A press with no real move is a SELECTION, not an attempt, and reports nothing --
   * otherwise clicking a piece to see its name would make H commit an identical
   * position and word a notice about it. The test is on the outcome rather than on
   * the pointer: an accepted candidate that lands the piece where it already stands
   * is not a move, and a refusal always is worth reporting, because you cannot be
   * refused where you already legally are.
   */
  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!grab || e.pointerId !== grab.pointerId) return;
    captureTarget(e).releasePointerCapture(e.pointerId);

    const attempt = live.current;
    const piece = pieces.find((q) => q.id === grab.id);
    live.current = null;
    setGrab(null);
    setGhost(null);
    if (!attempt || !piece || attempt.id !== piece.id) return;

    const r = attempt.r;
    if (r.ok && !moved(r.piece, piece)) return;

    setLog((prev) => ({
      last: r.ok
        ? { id: piece.id, ok: true, u: r.piece.u, v: r.piece.v, snapped: r.snapped }
        : { id: piece.id, ok: false, reason: r.reason, against: r.against },
      attempts: prev.attempts + 1,
      refusals: prev.refusals + (r.ok ? 0 : 1),
    }));
    onResult(piece.id, r);
  };

  /**
   * A cancelled pointer -- the browser taking it away, a touch turning into a
   * scroll -- abandons the gesture and commits nothing. onLostPointerCapture shares
   * the handler and is a no-op after a normal release, because that path clears
   * `grab` before the capture is dropped.
   */
  const onPointerCancel = () => {
    if (!grab) return;
    live.current = null;
    setGrab(null);
    setGhost(null);
  };

  /** Where the ghost box sits in the world, and how big it is. */
  const ghostView = useMemo(() => {
    if (!grab || !ghost) return null;
    const piece = pieces.find((q) => q.id === grab.id);
    if (!piece) return null;
    const b = pieceBox({ ...piece, u: ghost.u, v: ghost.v });
    const floor = floorLevel(1);
    const c = suiteToThree(b.u + b.du / 2, b.v + b.dv / 2, floor + piece.h / 2, params);
    return {
      ok: ghost.ok,
      position: new THREE.Vector3(c[0], c[1], c[2]),
      scale: new THREE.Vector3(
        b.du + GHOST_SWELL,
        piece.h + GHOST_SWELL,
        b.dv + GHOST_SWELL,
      ),
    };
  }, [grab, ghost, pieces, params]);

  /**
   * Publish the probe. Written from an effect rather than during render so that a
   * gate never reads a value from a render React went on to throw away.
   */
  useEffect(() => {
    const screenOf = (u: number, v: number) => {
      const p = suiteToThree(u, v, floorLevel(1), params);
      const ndc = new THREE.Vector3(p[0], p[1], p[2]).project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      return {
        x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-ndc.y * 0.5 + 0.5) * rect.height,
      };
    };
    const probe: DragProbe = {
      enabled,
      selected,
      dragging: grab?.id ?? null,
      ghost,
      last: log.last,
      attempts: log.attempts,
      refusals: log.refusals,
      pieces: pieces.map((p) => ({ id: p.id, u: p.u, v: p.v, yaw: p.yaw })),
      screenOf,
      suiteOf: (x, y, z) => cameraInSuite([x, y, z], params),
    };
    const w = window as unknown as { __drag?: DragProbe };
    w.__drag = probe;
    return () => {
      if (w.__drag === probe) delete w.__drag;
    };
  }, [enabled, selected, grab, ghost, log, pieces, params, camera, gl]);

  if (!enabled || !plane) return null;

  return (
    <group>
      {/* The only object in the scene carrying pointer handlers. Nothing else needs
          stopPropagation() against it, and it needs none against anything else. */}
      <mesh
        name="drag-hit-plane"
        geometry={plane.geometry}
        material={chrome.hit}
        position={plane.position}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
      />
      {outline ? (
        <mesh name="drag-outline" geometry={outline} material={chrome.outline} />
      ) : null}
      {ghostView ? (
        <mesh
          name="drag-ghost"
          geometry={unitBox}
          material={ghostView.ok ? chrome.ghostOk : chrome.ghostNo}
          position={ghostView.position}
          rotation={[0, yaw, 0]}
          scale={ghostView.scale}
        />
      ) : null}
    </group>
  );
}
