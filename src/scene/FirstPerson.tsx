"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { buildSuite, type SuiteParams } from "@/geo/rooms";
import { floorLevel, suiteToThree } from "@/geo/place";
import type { Vec3 } from "@/geo/frames";
import { LAST_STAGE, useStore, type FirstPerson as Walker } from "@/state/store";
import {
  EYE,
  NO_INPUT,
  clearance,
  roomAt,
  walk,
  walkContext,
  type WalkCtx,
  type WalkInput,
} from "./walk";

/**
 * Standing up in the suite and walking it.
 *
 * WHAT THIS FILE IS AND IS NOT. walk.ts is the maths -- a bearing, a radius, and a step
 * that cannot pass through a wall -- and it is three-free on purpose. This is the other
 * half: the keys, the pointer, the suite-to-world conversion, and the frame loop. It does
 * NOT move the camera. CameraRig owns camera.position and writes it every frame, and two
 * writers of one transform is the bug that ends with a camera that jitters between two
 * answers, so this component advances the walker and puts it in the store, and CameraRig
 * reads it back through firstPersonPose() below. The order matters and it is bought by
 * mount order in Experience.tsx: this component's useFrame runs before CameraRig's, so the
 * camera is never a frame behind the input.
 *
 * THE SIGN OF A TURN IS READ OFF THE BASIS, NOT CHOSEN. See screenTurnSign(). The suite to
 * world map is a rotation on the east facade and a REFLECTION on the west, so a bearing
 * that turns right on one turns left on the other, and the only way to get both is to
 * measure the map rather than to look at a screenshot of the default.
 *
 * THE EYE IS LEVEL, and there is no pitch anywhere in this file. walk.ts's WalkState is a
 * position and a bearing; a pitch would be camera state with no counterpart in the maths,
 * invisible to walk(), to roomAt(), and to anything that describes where the viewer is.
 * What that costs is measured rather than waved away: at EYE = 5 ft 10 in with stage 5's
 * 62 degree vertical field, the frame reaches 31 degrees below level, so the floor enters
 * it 5.83 / tan(31) = 9.7 ft ahead and the 10 ft 9 in ceiling enters it 8.2 ft ahead. Both
 * surfaces are therefore in the frame from about ten feet on, which is less than the length
 * of every room in the suite.
 *
 * POINTER LOCK IS AN ENHANCEMENT AND NOT THE INTERFACE. Everything here is reachable from
 * the keyboard alone -- W A S D or the arrow keys to walk and turn, Q and E to sidestep,
 * Escape to leave -- because pointer lock is a mouse affordance and MASTER.md requires a
 * keyboard equivalent for every canvas interaction. The lock is requested on a click on
 * the canvas, which is a user gesture as the API demands, and its failure is not an error:
 * a browser that refuses it leaves a walker that works.
 */

/**
 * How far ahead of the walker the camera's look-at point is placed, ft.
 *
 * Only the DIRECTION matters to lookAt(), so the magnitude is free; 10 ft is the scale of
 * a room in this suite, which keeps the vector well clear of float noise at eye height and
 * puts the point inside the room rather than a thousand feet through the wall, where a
 * reader of window.__cam.target would have to divide to see where the viewer is facing.
 */
const LOOK_AHEAD = 10;

/**
 * The largest dt one frame of walking is allowed to be, seconds.
 *
 * walk.ts does not clamp and does not need to: step() cuts any displacement into
 * SUBSTEP-sized pieces, so a 30 second dt from a backgrounded tab is 160 substeps and no
 * tunnelling. What it is NOT is wanted -- 30 s at SPEED is 120 ft of walking nobody asked
 * for, which at this suite's scale is out of the building and back.
 *
 * 1/10 s rather than 1/60, because a clamp that bites on real frames would make the
 * walking speed depend on the renderer. The slowest median frame this project has recorded
 * is 85 ms, under SwiftShader in the e2e environment (tests/e2e/threshold.spec.ts; Perf.tsx
 * explains why software rendering is that slow), so 100 ms is above every frame the gates
 * actually produce. At SPEED = 4 ft/s it caps one frame's travel at 0.4 ft, which is under
 * the walker's own radius.
 */
const MAX_DT = 0.1;

/**
 * Degrees of turn per pixel of locked pointer movement, at a 1280 px wide viewport.
 *
 * CameraRig's DRAG_TURN_DEG on the axis a horizontal look actually uses: a full viewport
 * across is one full turn, which is OrbitControls' own rate and therefore the rate a hand
 * in this app already expects. Divided by the live clientWidth so the feel does not change
 * with the window. At 1280 px it is 0.28 deg/px, so turning to look back down the hall is
 * 640 px of mouse.
 */
const LOOK_TURN_DEG = 360;

/** Keys, and what each one asks walk() for. Held state, not a stream of events. */
const FORWARD_KEYS: Record<string, number> = {
  w: 1,
  W: 1,
  ArrowUp: 1,
  s: -1,
  S: -1,
  ArrowDown: -1,
};

/**
 * A and D TURN rather than sidestep, which is the one place this departs from the WASD
 * convention, and it is deliberate.
 *
 * The convention pairs A/D with a mouse for turning, and pointer lock is exactly what a
 * keyboard-only viewer does not have. A walker who cannot turn cannot leave the room they
 * started in -- every door off this hall is in one wall -- so turning is the function that
 * has to be on the keys, and sidestepping is the one that can move to Q and E. The arrow
 * keys are mapped identically, because an arrow key is what somebody who has never played
 * a first-person game will press.
 */
const TURN_KEYS: Record<string, number> = {
  a: -1,
  A: -1,
  ArrowLeft: -1,
  d: 1,
  D: 1,
  ArrowRight: 1,
};

/** Q and E sidestep, in screen terms: +1 is to the viewer's right. */
const STRAFE_KEYS: Record<string, number> = { q: -1, Q: -1, e: 1, E: 1 };

/**
 * Which way a rising bearing turns ON SCREEN: +1 to the viewer's right, -1 to the left.
 *
 * READ OFF suiteToThree()'s OWN BASIS, which is the whole point of this function and the
 * reason it is not a constant. place.ts's suiteToBuilding() negates u for the east facade
 * and not for the west, while frames.ts's toThree() negates v for both -- so the composed
 * map is a rotation on one facade and a reflection on the other, and a reflection reverses
 * the sense of every rotation in it. cutaway.ts's cameraInSuite() and Suite.tsx's
 * suiteBasis() invert the same map the same way, by projecting onto the basis rather than
 * by writing the algebra out, so this is the third instance of one habit rather than a new
 * trick.
 *
 * THE ARITHMETIC. walk.ts's bearing 0 faces +v and a rising bearing turns toward +u, so
 * d(forward)/d(heading) at 0 is the +u basis vector. In three's world with Y up, the
 * viewer's right-hand direction for a forward f is cross(f, up), which for f = (fx, 0, fz)
 * is (-fz, 0, fx). So a rising bearing turns to the right exactly when the +u basis vector
 * has a positive component along the right-hand of the +v basis vector.
 *
 * MEASURED, both facades, at the default params: the basis comes out
 * eu = (-0.973579, -0.228351), ev = (0.228351, -0.973579) on the east and
 * eu = (+0.973579, +0.228351), ev the same on the west, in world (x, z). The determinant
 * of [eu ev] is therefore +1 on the east and -1 on the west -- exactly the rotation and
 * the reflection -- and this function returns -1 and +1. Sanity, in words: on the east
 * facade u runs inward, i.e. westward, so a viewer facing north who turns toward +u turns
 * to their LEFT; on the west facade u runs eastward and the same turn is to their right.
 */
export function screenTurnSign(params: SuiteParams): 1 | -1 {
  const o = suiteToThree(0, 0, 0, params);
  const eu = suiteToThree(1, 0, 0, params);
  const ev = suiteToThree(0, 1, 0, params);
  const ux = eu[0] - o[0];
  const uz = eu[2] - o[2];
  const vx = ev[0] - o[0];
  const vz = ev[2] - o[2];
  return ux * -vz + uz * vx > 0 ? 1 : -1;
}

/**
 * The walker as a camera pose: where it stands, and a point it is looking at.
 *
 * Exported because CameraRig is the only writer of the camera and this is the conversion
 * it needs. The height is not the walker's business -- walk.ts drops height on the way in
 * and says why -- so it is applied here, once: the first floor's level plus an eye.
 */
export function firstPersonPose(
  walker: Walker,
  params: SuiteParams,
): { position: Vec3; target: Vec3 } {
  const eye = floorLevel(1) + EYE;
  const ahead = {
    u: walker.p.u + Math.sin(walker.heading) * LOOK_AHEAD,
    v: walker.p.v + Math.cos(walker.heading) * LOOK_AHEAD,
  };
  return {
    position: suiteToThree(walker.p.u, walker.p.v, eye, params),
    target: suiteToThree(ahead.u, ahead.v, eye, params),
  };
}

/**
 * What a gate can read from outside, and why it is a separate publisher from window.__cam.
 *
 * Same device as window.__drag: the thing under test is inside a canvas, and a walker
 * leaves no element behind. What matters here is that the position is published in the
 * SUITE's own frame, in feet, so that tests/e2e/walk.spec.ts can check it against
 * src/geo/collide.ts and src/geo/walls.ts in node rather than trusting a second opinion
 * computed in the page -- edit.spec.ts's header records why a probe that grades its own
 * homework is a weakness. `clearance` and `room` are the app's own answers and are used
 * for identity and bookkeeping, exactly as __drag's ids are.
 */
type WalkProbe = {
  active: boolean;
  u: number;
  v: number;
  heading: number;
  room: string | null;
  /** ft from the walker's edge to the nearest wall band; negative means inside one. */
  clearance: number;
  /** whether pointer lock is engaged on the canvas, which headless Chromium may refuse. */
  locked: boolean;
  /** +1 if a rising bearing turns to the viewer's right on this facade. */
  turnSign: number;
  /** keys currently held, for a gate that needs to know its own press landed. */
  keys: string[];
  /** frames advanced since first person came on, so a gate can wait for one. */
  frames: number;
};

export function FirstPerson() {
  const gl = useThree((s) => s.gl);
  const stage = useStore((s) => s.stage);
  const params = useStore((s) => s.params);
  // A BOOLEAN selector rather than the walker itself. This component writes the walker
  // sixty times a second while a key is down, and subscribing to the object would
  // re-render on every one of those writes; `!== null` changes twice per visit.
  const active = useStore((s) => s.firstPerson !== null) && stage === LAST_STAGE;
  const setWalk = useStore((s) => s.setWalk);

  const held = useRef(new Set<string>());
  const pendingDx = useRef(0);
  const frames = useRef(0);
  const locked = useRef(false);
  /**
   * One WalkCtx per params, built on demand.
   *
   * walk.ts's header is explicit: walkContext() walks a grid and merges rectangles, and it
   * must be memoised per params and never built per frame. Lazily rather than in a useMemo
   * because this component is mounted at every stage and most visitors never walk -- a
   * useMemo would rebuild it on every one of the fifteen sliders' pointer moves whether
   * anyone was standing in the room or not.
   */
  const ctx = useRef<{ params: SuiteParams; ctx: WalkCtx } | null>(null);
  const contextFor = (p: SuiteParams): WalkCtx => {
    if (ctx.current?.params !== p) ctx.current = { params: p, ctx: walkContext(buildSuite(p)) };
    return ctx.current.ctx;
  };

  const turnSign = useMemo(() => screenTurnSign(params), [params]);

  /**
   * The keys, on the window, and only while first person is on.
   *
   * Attached with the mode rather than gated inside a handler, which is the pattern
   * CameraRig's stage-3 pointer listeners and Hud.tsx's orbit group already use: a
   * listener that is present but declines to act is a listener the next owner of that key
   * has to discover.
   *
   * The form-field guard is Hud.tsx's, for its reason: every dimension in the panel is a
   * range input and ranges use the arrow keys to change their own value, so claiming
   * ArrowLeft while one has focus would make the sliders unusable by keyboard. That is the
   * exact accessibility failure this project keeps finding.
   */
  useEffect(() => {
    if (!active) return;
    const isField = (el: EventTarget | null) => {
      const e = el as HTMLElement | null;
      const tag = e?.tagName;
      return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || !!e?.isContentEditable;
    };
    const onDown = (e: KeyboardEvent) => {
      // Escape's own handling used to leave first person here; that action is gone --
      // standing is a property of being at stage 5, not a mode this key stops. Step 4
      // wires Escape to pointer lock alone; until then it falls through to the browser's
      // own default, which is why there is no branch for it in this handler any more.
      if (isField(e.target)) return;
      if (!(e.key in FORWARD_KEYS || e.key in TURN_KEYS || e.key in STRAFE_KEYS)) return;
      // Ours now. Without this the arrow keys scroll the page on a browser whose body is
      // not the overflow-hidden one this app ships.
      e.preventDefault();
      held.current.add(e.key);
    };
    const onUp = (e: KeyboardEvent) => held.current.delete(e.key);
    // A key held while the window loses focus would otherwise never see its keyup, and the
    // walker would carry on walking into a wall for as long as the tab was in the
    // background. Measured as a real failure mode in this app's own e2e runs, where a
    // press and a context switch are one action.
    const onBlur = () => held.current.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      held.current.clear();
    };
  }, [active]);

  /**
   * Pointer lock, and the two ways it can go wrong.
   *
   * REQUESTED FROM A CLICK, because the API requires a user gesture and a component
   * mounting is not one. A click on the canvas is the conventional "click to look around",
   * and it is additive: the keys already work, so a browser that refuses the lock -- which
   * headless Chromium may -- costs the mouse and nothing else.
   *
   * THE PROMISE IS CAUGHT. requestPointerLock() returns a promise in current Chrome and
   * rejects when the document is not permitted to lock, and an unhandled rejection is a
   * console error -- which tests/e2e/journey.spec.ts fails the whole run on. So the
   * refusal is swallowed here rather than allowed to become an error somewhere it reads
   * as a bug in the app.
   *
   * LOSING THE LOCK LEAVES FIRST PERSON, which is the one non-obvious choice. Escape is
   * how a browser releases a pointer lock, and it does not deliver that keypress to the
   * page -- so with the two treated separately, Escape would exit the lock and leave the
   * viewer still walking, and a second Escape would be needed to get out. Two presses is
   * how "Escape gets you out" becomes folklore. One press, one exit.
   */
  useEffect(() => {
    if (!active) return;
    const el = gl.domElement;
    const onPointerDown = () => {
      if (document.pointerLockElement === el) return;
      const r = (el as HTMLCanvasElement).requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === "function") {
        (r as Promise<void>).catch(() => {
          // Refused. The keys still walk; see the docblock.
        });
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (document.pointerLockElement !== el) return;
      pendingDx.current += e.movementX;
    };
    const onLockChange = () => {
      const now = document.pointerLockElement === el;
      // Losing the lock used to leave first person entirely; that action is gone, so this
      // is a no-op placeholder until Step 4 wires it to setPointerLocked() instead.
      locked.current = now;
    };
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerlockchange", onLockChange);
      if (document.pointerLockElement === el) document.exitPointerLock();
      locked.current = false;
      pendingDx.current = 0;
    };
  }, [active, gl]);

  useEffect(() => {
    if (active) frames.current = 0;
  }, [active]);

  useFrame((_, delta) => {
    const walker = useStore.getState().firstPerson;
    if (!active || !walker) {
      (window as unknown as { __walk?: WalkProbe }).__walk = {
        active: false,
        u: 0,
        v: 0,
        heading: 0,
        room: null,
        clearance: 0,
        locked: false,
        turnSign,
        keys: [],
        frames: frames.current,
      };
      return;
    }

    const ctxNow = contextFor(params);
    const keys = [...held.current];
    let forward = 0;
    let turn = 0;
    let strafe = 0;
    for (const k of keys) {
      forward += FORWARD_KEYS[k] ?? 0;
      turn += TURN_KEYS[k] ?? 0;
      strafe += STRAFE_KEYS[k] ?? 0;
    }
    // Both of these are asks for a SCREEN direction, and both cross the same reflection:
    // walk.ts's +turn adds to the bearing and its +strafe walks along bearing + 90, and
    // the second is the derivative of the first, so one sign converts both.
    const input: WalkInput =
      forward === 0 && turn === 0 && strafe === 0
        ? NO_INPUT
        : {
            forward: Math.max(-1, Math.min(1, forward)),
            turn: Math.max(-1, Math.min(1, turn)) * turnSign,
            strafe: Math.max(-1, Math.min(1, strafe)) * turnSign,
            pitch: 0,
          };

    // The pointer's contribution is a displacement rather than a rate, so it is applied to
    // the bearing directly instead of through TURN_RATE. walk() wraps whatever it is
    // handed, so an unwrapped bearing going in comes out wrapped.
    const dx = pendingDx.current;
    pendingDx.current = 0;
    const perPx = (LOOK_TURN_DEG * Math.PI) / 180 / Math.max(1, gl.domElement.clientWidth);
    const looked = walker.heading + dx * perPx * turnSign;

    const dt = Math.min(MAX_DT, Math.max(0, delta));
    const next = walk({ p: walker.p, heading: looked, pitch: walker.pitch }, input, dt, ctxNow);
    frames.current++;

    // Written only when something actually changed, so an idle viewer costs no store
    // notifications at all -- the subscription in UrlSync publishes on every one of them.
    const moved =
      next.p.u !== walker.p.u || next.p.v !== walker.p.v || next.heading !== walker.heading;
    const room = moved ? roomAt(next.p, ctxNow) : walker.room;
    if (moved) setWalk({ p: next.p, heading: next.heading, pitch: next.pitch, room });

    (window as unknown as { __walk?: WalkProbe }).__walk = {
      active: true,
      u: next.p.u,
      v: next.p.v,
      heading: next.heading,
      room,
      clearance: clearance(next.p, ctxNow),
      locked: document.pointerLockElement === gl.domElement,
      turnSign,
      keys,
      frames: frames.current,
    };
  });

  return null;
}
