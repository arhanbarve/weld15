"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LAST_STAGE, useStore, type StageId } from "@/state/store";
import { keyframes, cameraKeyframe, REDUCED_CUT, funnel, FUNNEL_START, SHELL_GONE } from "./stages";
import { firstPersonPose } from "./FirstPerson";
import {
  clampOrbit,
  orbitKeyframe,
  orbitOf,
  STAGE3_CLAMP,
  STAGE4_CLAMP,
  stage4OrbitKeyframe,
  stage4Pose,
  transitPose,
  MASSING_CENTER,
  type Orbit,
  type OrbitClamp,
} from "./orbit";
import { nearFar } from "./altitude";
import { fromJourney, toJourney } from "./journey";
import { spinPose } from "./globeRig";

/**
 * Drives the camera from the stage machine, and gives stage 3 a free orbit.
 *
 * Reduced motion is a BRANCH, not a shorter duration: it snaps to the keyframe
 * rather than easing toward it. Shortening the fly would still fly, which is what
 * the guideline actually prohibits. The stage 4 -> 5 crossing needs a second branch
 * on top of that, and it lives in stages.ts cameraKeyframe, because snapping alone
 * would still take the camera through every interpolated position -- one per slider
 * event -- and an interpolated position arrived at instantly is still one.
 *
 * THERE IS ONE MORE SOURCE OF A CAMERA POSE SINCE P7, and this file is still the only
 * WRITER of one. When the store holds a walker, the pose comes from FirstPerson.tsx's
 * firstPersonPose() instead of from a keyframe, and it is copied rather than eased --
 * see the branch in the frame loop. Two components writing camera.position is the bug
 * that ends in a camera oscillating between two answers on alternate frames, so
 * FirstPerson advances the walker and puts it in the store and this reads it back.
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

/** Share of the whole journey per notch of wheel. 50 notches end to end. */
const SCRUB_PER_NOTCH = 0.02;

/**
 * How long `scrubbing` is held after the last wheel notch, ms.
 *
 * A wheel gesture has no pointerup to clear it on, unlike the master scrubber's own
 * pointerdown/pointerup pair (Hud.tsx's onScrubbing). Held rather than toggled per notch so a
 * steady flick of several notches in a row reads as one continuous hold rather than flickering
 * the flag off between them; reset on every notch so the hold always covers 120 ms of stillness
 * after the gesture actually stops.
 */
const SCRUB_HOLD_MS = 120;

/**
 * How far the camera must move for window.__cam to record a new position, ft.
 *
 * Well under the 2 ft the eased approach covers in one frame from a stage away, and
 * well over the float noise in copying the same keyframe twice. Under reduced
 * motion the copy is exact, so the path stays at length 1 and there is nothing for
 * a tolerance to swallow.
 */
const MOVE_EPS = 0.01;

/** MASSING_CENTER as a Vector3, built once rather than per frame. */
const MASSING_CENTER_V3 = new THREE.Vector3(...MASSING_CENTER);

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
 *
 * `center` and `clamp` are now parameters, not stage 3's constants baked in, so
 * stage 4 can reuse this against MASSING_CENTER and STAGE4_CLAMP rather than
 * against the look-at target and STAGE3_CLAMP -- see orbit.ts's STAGE4_CLAMP
 * for why stage 4's radius guarantee has to be measured from MASSING_CENTER
 * and not from kf[4].target.
 */
function keepOutsideMassing(
  position: THREE.Vector3,
  center: THREE.Vector3,
  clamp: OrbitClamp = STAGE3_CLAMP,
): void {
  const away = position.clone().sub(center);
  const r = away.length();
  if (r < 1e-6) return;
  const want = Math.min(clamp.maxRadius, Math.max(clamp.minRadius, r));
  if (Math.abs(want - r) < 1e-9) return;
  position.copy(center).add(away.multiplyScalar(want / r));
}

type CamProbe = {
  stage: StageId;
  t: number;
  reduced: boolean;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  /**
   * Altitude above Weld's grade, ft, and the near and far planes it produced.
   *
   * On the probe because altitude is THE parameter of the descent since P9 -- altitude.ts's
   * header sets that out -- and a gate that wants to know which ground quad should be up, or
   * whether the globe should still be visible, needs the number the scene actually used
   * rather than one recomputed from a keyframe it hopes the camera reached. `alt` is
   * camera.position.y by definition, and it is published anyway because a reader of
   * window.__cam should not have to know that.
   */
  alt: number;
  near: number;
  far: number;
  /**
   * Whether the pose came from the walker rather than from a keyframe.
   *
   * On the same probe as the position it explains, because a gate reading a camera inside
   * the suite cannot otherwise tell "the stage-5 shot" from "somebody standing there".
   */
  firstPerson: boolean;
  /**
   * Journey parameter, 0 at orbit to 1 standing in the hall. journey.ts's toJourney(stage, t,
   * params) -- the same projection the master scrubber reads and writes, published here so a
   * gate can watch it move continuously without importing the mapping itself.
   */
  u: number;
  /**
   * The cut counter this file's un-settle effect now watches instead of `stage`.
   *
   * On the probe so a continuity gate can assert it did NOT change across a scrub -- the whole
   * point of this step -- without reconstructing store.ts's bookkeeping in test code.
   */
  cuts: number;
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
  const setHighContrast = useStore((s) => s.setHighContrast);
  const orbit = useStore((s) => s.orbit);
  const setOrbit = useStore((s) => s.setOrbit);
  const globeSpin = useStore((s) => s.globeSpin);
  const setGlobeSpin = useStore((s) => s.setGlobeSpin);
  const setJourney = useStore((s) => s.setJourney);
  const setScrubbing = useStore((s) => s.setScrubbing);
  const cuts = useStore((s) => s.cuts);
  const scrubbing = useStore((s) => s.scrubbing);

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

  /**
   * The contrast preference, mirrored unconditionally.
   *
   * Moved from Hud.tsx (P10 step 6), which also deleted the contrast toggle button --
   * the seed used to be overridable by a button press via a `contrastChosen` guard, and
   * there is no button left to out-vote the media query. This is a straight mirror of the
   * OS preference, exactly like prefers-reduced-motion above.
   */
  useEffect(() => {
    const mq = window.matchMedia("(prefers-contrast: more)");
    setHighContrast(mq.matches);
    const onChange = () => setHighContrast(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setHighContrast]);

  /**
   * A subscription to WHETHER somebody is walking, not to where they are.
   *
   * The selector returns a boolean, so this re-renders on the two transitions rather than
   * on the sixty writes a second FirstPerson makes while a key is down.
   */
  const walking = useStore((s) => s.firstPerson !== null);

  /**
   * Un-settle on a CUT, not on a stage change, and on entering or leaving first person, so the
   * next frame places the camera rather than easing toward it.
   *
   * `stage` alone stopped being the right trigger once the master scrubber arrived: a scrubbed
   * stage change (setJourney, which does NOT bump `cuts`) is meant to be continuous, because the
   * poses on either side of every stage boundary are already geometrically identical --
   * descentPath() pins each leg's last stop to the next stage's keyframe object, so there was
   * never a geometry gap to paper over. The old jump was never about geometry; it was this
   * effect force-restarting the ease on every tick of a drag that was already smooth. `cuts`
   * only increments on a genuine jump -- setStage, next, prev, skipToSuite, enterFirstPerson,
   * leaveFirstPerson (see store.ts) -- so watching it instead leaves a scrub alone.
   *
   * The first-person half of the original reasoning is unchanged and still holds. An eased
   * return from wherever the viewer walked to the stage-5 keyframe would be a straight
   * line through whatever stands in between -- which is precisely the defect P7 paid back:
   * stages.ts recorded a straight camera path from bedroom B to the hall passing through
   * the partition and standing half a foot off it, at the near plane, with the frame going
   * empty. A viewer who walks into bedroom A and presses Escape would fly the same line.
   * So leaving is a cut, on purpose -- and enterFirstPerson/leaveFirstPerson both bump `cuts`.
   */
  useEffect(() => {
    settled.current = false;
    path.current = [];
  }, [cuts, walking]);

  /**
   * Pointer drag and wheel, at every stage but the last.
   *
   * ONE EFFECT, DISPATCHING ON STAGE, replacing the stage-3-only effect this used to be.
   * The listeners are still attached and removed with the stage, whatever they do at it, so a
   * stage change always tears down exactly the right set:
   *
   *   stage 0        drag turns the globe (writes `globeSpin`); wheel scrubs the journey.
   *   stages 1, 2    no drag; wheel scrubs the journey.
   *   stages 3, 4    drag orbits (writes `orbit`); wheel changes the orbit radius.
   *   stage 5        not mounted at all -- the interior is not a zoom, and the walker owns
   *                  the pointer (FirstPerson.tsx's own pointer-lock handling must not
   *                  compete with a second listener on the same canvas).
   *
   * MERGE NOTE (P10 integration). Two branches wrote this effect. `p10-ux` made the wheel scrub
   * the whole descent everywhere except stage 3, and gave stage 0 a drag; `p10-fidelity` gave
   * stage 4 an orbit drag of its own, "just like how in section three you're able to drag".
   * Both survive, and the rule that reconciles them is one line: A STAGE YOU CAN ORBIT OWNS THE
   * WHEEL FOR ITS RADIUS, and every other stage scrubs. Stage 4 is therefore the one row that
   * moved between the two specs -- it was in `p10-ux`'s scrub list and is in the orbit list here,
   * because a stage that can be dragged round and not zoomed is a half-built control. The master
   * scrubber (JourneyBar) still drives stage 4's threshold sweep, which is what the wheel gave up.
   *
   * The current orbit/spin is read from the store on each event rather than closed over.
   * Several pointermove events land between two React renders, and a closure over the
   * rendered value would apply all of them to the same starting angle -- which reads as a
   * drag that fights back.
   *
   * clampOrbit is applied here and the store is left to hold whatever it is given. orbit.ts
   * derived and brute-force verified those limits; a second clamp anywhere else is a second
   * thing to keep in step with them. globeSpin has NO clamp on write: spinPose (globeRig.ts)
   * clamps pitchDeg on read, which is where the lookAt degeneracy actually bites, so the drag
   * is free to keep accumulating past it rather than needing a matching clamp here.
   *
   * STAGE 4'S SEED IS NOT orbitOf(kf[4]). Stage 4's orbit is about MASSING_CENTER, not about
   * kf[4].target (insideBedB) -- see orbit.ts's STAGE4_CLAMP and stage4OrbitKeyframe for why
   * applying MASS_RADIUS-style clamping about the wrong pivot fails to keep the camera outside
   * the massing at all. So the seed has to be orbitOf() of kf[4]'s own position measured from
   * MASSING_CENTER, the same seeding tests/orbit.test.ts uses to prove stage4OrbitKeyframe
   * reproduces kf[4] exactly before any drag.
   */
  useEffect(() => {
    if (stage === LAST_STAGE) return;
    const el = gl.domElement;
    const kf = keyframes(params);
    const clamp: OrbitClamp = stage === 4 ? STAGE4_CLAMP : STAGE3_CLAMP;
    const seed = (): Orbit =>
      stage === 4
        ? orbitOf({ position: kf[4].position, target: MASSING_CENTER, fov: kf[4].fov })
        : orbitOf(kf[3]);
    const currentOrbit = () => useStore.getState().orbit ?? seed();
    const currentSpin = () => useStore.getState().globeSpin ?? { yawDeg: 0, pitchDeg: 0 };

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let scrubTimeout: ReturnType<typeof setTimeout> | undefined;

    const perPx = () => DRAG_TURN_DEG / Math.max(1, el.clientHeight);

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Only stages 0, 3 and 4 have anything for a drag to do; 1 and 2 are fixed shots
      // that scrub on the wheel alone.
      if (stage !== 0 && stage !== 3 && stage !== 4) return;
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
      if (stage === 3 || stage === 4) {
        const o = currentOrbit();
        // Signs are OrbitControls', which is also what "the surface under the cursor
        // follows the cursor" gives: dragging right walks the camera round to the
        // west, so azimuth rises; dragging down lifts it toward a plan, and polar is
        // measured from straight up, so polar falls.
        setOrbit(
          clampOrbit(
            {
              azimuthDeg: o.azimuthDeg + dx,
              polarDeg: o.polarDeg - dy,
              radius: o.radius,
            },
            clamp,
          ),
        );
      } else {
        // stage === 0. Same signs as the orbit drag above, on the same "surface under
        // the cursor follows the cursor" convention: dragging right turns the globe so
        // the marker moves right with it, and dragging down tips the near pole toward
        // the viewer -- see tests/e2e/wheel-and-spin.spec.ts's sign check.
        const g = currentSpin();
        setGlobeSpin({ yawDeg: g.yawDeg + dx, pitchDeg: g.pitchDeg - dy });
      }
    };

    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };

    const onWheel = (e: WheelEvent) => {
      // Not passive, because the page must not scroll under the gesture. The
      // listener is registered with { passive: false } for the same reason.
      e.preventDefault();
      if (stage === 3 || stage === 4) {
        const o = currentOrbit();
        setOrbit(
          clampOrbit(
            {
              ...o,
              radius: o.radius * Math.pow(ZOOM_PER_NOTCH, e.deltaY / 100),
            },
            clamp,
          ),
        );
        return;
      }
      // Stages 0, 1 and 2: the wheel scrubs the whole journey instead, in the same
      // "down/forward is deeper" direction the master scrubber's own slider moves in.
      const s = useStore.getState();
      const u = toJourney(s.stage, s.t, params);
      const next = Math.min(1, Math.max(0, u + (e.deltaY / 100) * SCRUB_PER_NOTCH));
      const { stage: ns, t: nt } = fromJourney(next, params);
      setJourney(ns, nt);
      // Held rather than toggled on pointerdown/up, because a wheel gesture has neither.
      // Without the hold, CameraRig's ease (step 3) fights each notch as it lands and the
      // scrub reads as syrupy instead of smooth.
      setScrubbing(true);
      if (scrubTimeout !== undefined) clearTimeout(scrubTimeout);
      scrubTimeout = setTimeout(() => setScrubbing(false), SCRUB_HOLD_MS);
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
      if (scrubTimeout !== undefined) clearTimeout(scrubTimeout);
    };
  }, [stage, gl, params, setOrbit, setGlobeSpin, setJourney, setScrubbing]);

  useFrame((_, delta) => {
    const kf = keyframes(params);
    /**
     * The walker, read at frame time rather than subscribed to.
     *
     * getState() and not a useStore selector, because FirstPerson writes this sixty times
     * a second while a key is down and a subscription would re-render this component on
     * every one of them. FirstPerson's own useFrame runs first -- it is mounted first in
     * Experience.tsx -- so what is read here was written this frame, not last.
     */
    const walker = stage === LAST_STAGE ? useStore.getState().firstPerson : null;
    // Reduced motion for the stage 3 -> 4 transit below: cameraKeyframe's own reduced
    // branch does not fire for stage 3, since stage 3 has no path of its own to jump
    // within. This gives the transit the same jump-at-midpoint shape stage 4's crossing
    // already has, so under reduced motion stage 3 is either exactly the orbit or exactly
    // kf[4] and nothing geometrically between.
    const transit = reduced ? (t < REDUCED_CUT ? 0 : 1) : t;
    const want =
      walker !== null
        ? { ...firstPersonPose(walker, params), fov: kf[LAST_STAGE].fov }
        : stage === 3
          ? // Stage 3 is a PLACE at t = 0 and a TRANSIT above it. The transit starts from
            // whatever the viewer orbited to rather than from a fixed pose, so scrubbing on
            // from stage 3 leaves from where they were standing; at t = 1 it is kf[4]
            // exactly, the first stop of stage 4's own path, so the next boundary is not a
            // cut either. Interpolated in SPHERICAL coordinates about MASSING_CENTER
            // (orbit.ts's transitPose), not cartesian: a straight position blend dipped
            // inside MASS_RADIUS at t ~= 0.58 even though both ends clear it, since a chord
            // between two points outside a sphere can still cut through the middle.
            transitPose(orbitKeyframe(kf[3], orbit ?? orbitOf(kf[3])), kf[4], MASSING_CENTER, transit)
          : stage === 4
            ? // stage4Pose is BY IDENTITY cameraKeyframe(kf, 4, t, reduced) when orbit is
              // null -- the regression fence tests/stages.test.ts pins -- so this branch
              // is always taken at stage 4 rather than only when orbit is set.
              stage4Pose(kf, t, reduced, orbit ? stage4OrbitKeyframe(kf[4], orbit) : null)
            : cameraKeyframe(kf, stage, t, reduced);

    /**
     * Stage 0's turn, applied on top of the keyframe/path pose above.
     *
     * (1 - t), NOT a constant, because stage 0 is itself a descent (P9a) and this pose is
     * the top of it. At t = 0 the globe is a place and the full turn shows; at t = 1 the
     * camera has reached kf[1] -- Cambridge's own top -- and k = 0 collapses the spin to
     * nothing, so however far the globe was turned, the descent still lands where stages.ts
     * aimed it rather than wherever the turn last left off. globeRig.ts's spinPose carries
     * the rest of the reasoning.
     */
    const posed =
      stage === 0 && globeSpin
        ? { ...want, ...spinPose(want.position, want.target, globeSpin, 1 - t) }
        : want;

    const wantPos = new THREE.Vector3(...posed.position);
    const wantTarget = new THREE.Vector3(...posed.target);

    // COPIED, NEVER EASED, while somebody is walking. The walker IS the camera: an
    // exponential approach to it would lag every step and every turn by a few frames,
    // which reads as walking on ice rather than as a smooth camera. It is also what makes
    // goToPlace() a jump cut -- the reduced-motion alternative to walking is one change of
    // position, and an ease would put a fly back in between.
    //
    // `scrubbing` joins this branch for the same reason: while the master scrubber is
    // held, the control being dragged IS the camera, and an exponential approach to it
    // would lag the hand by the same fraction of a second the walker would be lagged by.
    if (walker !== null || reduced || scrubbing || !settled.current) {
      camera.position.copy(wantPos);
      target.current.copy(wantTarget);
      camera.fov = posed.fov;
      camera.updateProjectionMatrix();
      settled.current = true;
    } else {
      // Exponential approach, framerate independent. No bounce, no elastic.
      const k = 1 - Math.exp(-delta * 3.2);
      camera.position.lerp(wantPos, k);
      target.current.lerp(wantTarget, k);
      if (Math.abs(camera.fov - posed.fov) > 0.01) {
        camera.fov += (posed.fov - camera.fov) * k;
        camera.updateProjectionMatrix();
      }
      // Only while stage 3 IS a place, i.e. t === 0. Above that the pose is the transit to
      // kf[4], which deliberately leaves STAGE3_CLAMP's envelope on its way to a stand-off
      // 124 ft out, and forcing the radius back inside it would pin the camera to the orbit
      // sphere and stall the move.
      if (stage === 3 && t === 0) keepOutsideMassing(camera.position, target.current);
      // Stage 4's equivalent: only while the funnel has not yet fully resolved onto
      // the path (funnel(t) < 1), and measured from MASSING_CENTER with STAGE4_CLAMP
      // -- not from target.current, which is kf[4].target (insideBedB) and not the
      // point stage 4's own radius guarantee is centred on. Once funnel(t) reaches 1
      // the pose is the path's exactly, which is already inside the building by
      // design, and correcting it back outside would fight the crossing itself.
      else if (stage === 4 && orbit && funnel(t) < 1) {
        keepOutsideMassing(camera.position, MASSING_CENTER_V3, STAGE4_CLAMP);
      }
    }

    camera.lookAt(target.current);

    /**
     * The near and far planes, from the altitude the camera actually ended up at.
     *
     * AFTER the position is settled or eased, not before, so the planes match the frame being
     * drawn rather than the frame requested. Experience.tsx's <Canvas camera={...}> still
     * supplies the initial values; from the first frame onward they come from here.
     *
     * Both are held constant below 200 ft by altitude.ts's schedule, so stages 3, 4 and 5 get
     * exactly the 0.5 and 25,000 they have always had -- including while somebody walks, which
     * is the case that matters, since stages.ts:161-177 records a measured clip at 0.40 ft
     * from a wall band at the low end of the hallWidth slider. This must not become a
     * function of anything but altitude, or that guarantee stops being one.
     *
     * updateProjectionMatrix() is called only when a plane actually moves. It is not free --
     * it rebuilds the projection matrix and dirties the frustum -- and during a dwell nothing
     * moves at all, so the common case does no work. The 1e-6 is well under any change a
     * single frame of the ease can produce and well over float noise in recomputing the same
     * logarithm twice.
     */
    const wantPlanes = nearFar(camera.position.y);
    if (
      Math.abs(camera.near - wantPlanes.near) > 1e-6 ||
      Math.abs(camera.far - wantPlanes.far) > 1e-6
    ) {
      camera.near = wantPlanes.near;
      camera.far = wantPlanes.far;
      camera.updateProjectionMatrix();
    }

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
      alt: camera.position.y,
      near: camera.near,
      far: camera.far,
      firstPerson: walker !== null,
      u: toJourney(stage, t, params),
      cuts,
      path: p,
    };
    (window as unknown as { __cam?: CamProbe }).__cam = probe;
  });

  return null;
}
