"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore, type StageId } from "@/state/store";
import { keyframes, cameraKeyframe } from "./stages";
import { clampOrbit, orbitKeyframe, orbitOf, STAGE3_CLAMP } from "./orbit";

/**
 * Drives the camera from the stage machine, and gives stage 3 a free orbit.
 *
 * Reduced motion is a BRANCH, not a shorter duration: it snaps to the keyframe
 * rather than easing toward it. Shortening the fly would still fly, which is what
 * the guideline actually prohibits. The stage 4 -> 5 crossing needs a second branch
 * on top of that, and it lives in stages.ts cameraKeyframe, because snapping alone
 * would still take the camera through every interpolated position -- one per slider
 * event -- and an interpolated position arrived at instantly is still one.
 */

/**
 * Degrees of orbit per pixel of drag, at a 1000 px tall viewport.
 *
 * A full screen height is one full turn, which is OrbitControls' own rate
 * (2 * pi radians per clientHeight) and therefore the rate a hand already expects.
 * Divided by the live clientHeight so the feel does not change with the window.
 */
const DRAG_TURN_DEG = 360;

/** Radius multiplier per notch of wheel. 100 is one notch of deltaY in Chrome. */
const ZOOM_PER_NOTCH = 1.08;

/**
 * How far the camera must move for window.__cam to record a new position, ft.
 *
 * Well under the 2 ft the eased approach covers in one frame from a stage away, and
 * well over the float noise in copying the same keyframe twice. Under reduced
 * motion the copy is exact, so the path stays at length 1 and there is nothing for
 * a tolerance to swallow.
 */
const MOVE_EPS = 0.01;

/**
 * Positions kept per stage. The question the probe answers is about the first
 * moments after a stage change, so it keeps the FIRST N and then stops -- a ring
 * buffer would throw away exactly the frames that matter.
 */
const MAX_PATH = 240;

/**
 * Push an eased camera position back outside the massing.
 *
 * clampOrbit guarantees the DESTINATION is legal. It says nothing about the path,
 * and the path is a straight line in Cartesian space: lerping between two points at
 * the same radius cuts the chord, so a large polar or azimuth move dips inside the
 * sphere both ends sit on. Measured during the keyboard work -- a 20 degree polar
 * sweep took the radius to 112.8 ft against a minRadius of 114.9, so the camera
 * spent a few frames roughly 2 ft inside the envelope that exists to keep it out of
 * the building. Small, but minRadius is precisely the "not inside Weld" guarantee,
 * and a guarantee that holds only at the endpoints is not one.
 *
 * Fixed by correcting the radius rather than by lerping in spherical space: the
 * Cartesian lerp is what makes an azimuth wrap take the short way round, and moving
 * to spherical to fix a 2 ft error would trade it for a camera that spins the long
 * way through 359 degrees. Direction is left exactly as the ease produced it.
 *
 * Pre-existing, and true of the pointer drag as much as of the keys.
 */
function keepOutsideMassing(position: THREE.Vector3, target: THREE.Vector3): void {
  const away = position.clone().sub(target);
  const r = away.length();
  if (r < 1e-6) return;
  const want = Math.min(
    STAGE3_CLAMP.maxRadius,
    Math.max(STAGE3_CLAMP.minRadius, r),
  );
  if (Math.abs(want - r) < 1e-9) return;
  position.copy(target).add(away.multiplyScalar(want / r));
}

type CamProbe = {
  stage: StageId;
  t: number;
  reduced: boolean;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  /**
   * Distinct camera positions since the last stage change, oldest first.
   *
   * This is the whole reduced-motion hook, and it exists because the gate in
   * docs/phases/P4-P5.md -- "no intermediate camera position between stage 4 and
   * 5" -- is a statement about a sequence of frames, which a screenshot cannot
   * show and Playwright cannot read out of React state. Under reduced motion this
   * holds at most two entries across the entire crossing and both are keyframes;
   * under full motion it fills up.
   */
  path: [number, number, number][];
};

export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const stage = useStore((s) => s.stage);
  const t = useStore((s) => s.t);
  const params = useStore((s) => s.params);
  const reduced = useStore((s) => s.reducedMotion);
  const setReduced = useStore((s) => s.setReducedMotion);
  const orbit = useStore((s) => s.orbit);
  const setOrbit = useStore((s) => s.setOrbit);

  const target = useRef(new THREE.Vector3());
  const settled = useRef(false);
  const path = useRef<[number, number, number][]>([]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setReduced]);

  useEffect(() => {
    settled.current = false;
    path.current = [];
  }, [stage]);

  /**
   * Pointer drag and wheel, at stage 3 only.
   *
   * Every other stage is a fixed shot and must stay one, so the listeners are
   * attached and removed with the stage rather than gated inside a handler that
   * runs on every move regardless.
   *
   * The current orbit is read from the store on each event rather than closed over.
   * Several pointermove events land between two React renders, and a closure over
   * the rendered value would apply all of them to the same starting orbit -- which
   * reads as a drag that fights back.
   *
   * clampOrbit is applied here and the store is left to hold whatever it is given.
   * orbit.ts derived and brute-force verified those limits; a second clamp anywhere
   * else is a second thing to keep in step with them.
   */
  useEffect(() => {
    if (stage !== 3) return;
    const el = gl.domElement;
    const base = keyframes(params)[3];
    const current = () => useStore.getState().orbit ?? orbitOf(base);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const perPx = () => DRAG_TURN_DEG / Math.max(1, el.clientHeight);

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const k = perPx();
      const dx = (e.clientX - lastX) * k;
      const dy = (e.clientY - lastY) * k;
      lastX = e.clientX;
      lastY = e.clientY;
      const o = current();
      // Signs are OrbitControls', which is also what "the surface under the cursor
      // follows the cursor" gives: dragging right walks the camera round to the
      // west, so azimuth rises; dragging down lifts it toward a plan, and polar is
      // measured from straight up, so polar falls.
      setOrbit(
        clampOrbit({
          azimuthDeg: o.azimuthDeg + dx,
          polarDeg: o.polarDeg - dy,
          radius: o.radius,
        }),
      );
    };

    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      // Not passive, because the page must not scroll under the gesture. The
      // listener is registered with { passive: false } for the same reason.
      e.preventDefault();
      const o = current();
      setOrbit(
        clampOrbit({
          ...o,
          radius: o.radius * Math.pow(ZOOM_PER_NOTCH, e.deltaY / 100),
        }),
      );
    };

    // Touch drags need this or the browser claims the gesture and pointermove never
    // arrives. The body already has overflow hidden, so nothing is lost by it.
    const priorTouchAction = el.style.touchAction;
    el.style.touchAction = "none";

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.style.touchAction = priorTouchAction;
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel);
    };
  }, [stage, gl, params, setOrbit]);

  useFrame((_, delta) => {
    const kf = keyframes(params);
    const want =
      stage === 3
        ? orbitKeyframe(kf[3], orbit ?? orbitOf(kf[3]))
        : cameraKeyframe(kf, stage, t, reduced);

    const wantPos = new THREE.Vector3(...want.position);
    const wantTarget = new THREE.Vector3(...want.target);

    if (reduced || !settled.current) {
      camera.position.copy(wantPos);
      target.current.copy(wantTarget);
      camera.fov = want.fov;
      camera.updateProjectionMatrix();
      settled.current = true;
    } else {
      // Exponential approach, framerate independent. No bounce, no elastic.
      const k = 1 - Math.exp(-delta * 3.2);
      camera.position.lerp(wantPos, k);
      target.current.lerp(wantTarget, k);
      if (Math.abs(camera.fov - want.fov) > 0.01) {
        camera.fov += (want.fov - camera.fov) * k;
        camera.updateProjectionMatrix();
      }
      if (stage === 3) keepOutsideMassing(camera.position, target.current);
    }

    camera.lookAt(target.current);

    const p = path.current;
    const last = p[p.length - 1];
    if (
      p.length < MAX_PATH &&
      (last === undefined ||
        Math.hypot(camera.position.x - last[0], camera.position.y - last[1], camera.position.z - last[2]) >
          MOVE_EPS)
    ) {
      p.push([camera.position.x, camera.position.y, camera.position.z]);
    }

    const probe: CamProbe = {
      stage,
      t,
      reduced,
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [target.current.x, target.current.y, target.current.z],
      fov: camera.fov,
      path: p,
    };
    (window as unknown as { __cam?: CamProbe }).__cam = probe;
  });

  return null;
}
