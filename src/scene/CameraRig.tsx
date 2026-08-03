"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { LAST_STAGE, useStore, type StageId } from "@/state/store";
import { keyframes, cameraKeyframe, funnel, FUNNEL_START, SHELL_GONE } from "./stages";
import { firstPersonPose } from "./FirstPerson";
import { journeyPose } from "./pose";
import {
  clampForStage,
  clampOrbit,
  orbitOf,
  STAGE3_CLAMP,
  STAGE4_CLAMP,
  MASSING_CENTER,
  type Orbit,
  type PoseClamp,
} from "./orbit";
import { nearFar } from "./altitude";
import { fromJourney, toJourney } from "./journey";
import { altitudeOf } from "./geo/frame";

/**
 * Drives the camera from the stage machine, and gives every stage but the last a free
 * orbit.
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
 *
 * P11 (task 7): ONE DRAG-AND-WHEEL HANDLER, EVERY STAGE BUT THE LAST, replacing the old
 * per-stage split (globe spin at 0, no drag at 1-2, an orbit about the keyframe's own
 * target at 3-4) that docs/phases/P11-PHOTOREAL.md section 0.1/0.2 measures as the source
 * of the stage-0 black-screen and the stage-1/2 "you should be able to drag" complaint.
 * `globeRig.ts`'s spinPose() rotated the camera's POSITION about Earth's true centre,
 * which is a different thing from rotating it about the keyframe's own TARGET at a fixed
 * range: a rotation about Earth's centre mixes yaw into the camera's site-frame y, and
 * altitude.ts's OLD definition (`alt = camera.position.y`) read that y directly, so a big
 * enough yaw sent "altitude" negative -- see the measured table in section 0.1. Orbiting
 * about the keyframe's own target instead (this file's `composePose`, using orbit.ts's
 * orbitKeyframe -- the same function stage 3's orbit already used) keeps y a function of
 * PITCH ALONE (`up = range * sin(pitch)`, independent of heading), and every stage's
 * pitch clamp (orbit.ts's clampForStage) keeps sin(pitch) comfortably positive, so no
 * heading drag can ever collapse the camera toward or through the ground. That is the
 * actual fix; altitude.ts's move to the true ellipsoid height (geo/frame.ts's
 * altitudeOf) is what makes the CLAIM checkable (this file's window.__cam.alt, and
 * tests/e2e/drag-safety.spec.ts's gate), not what makes it true.
 */

/**
 * Degrees of orbit per pixel of drag, at a 1000 px tall viewport.
 *
 * A full screen height is one full turn, which is OrbitControls' own rate
 * (2 * pi radians per clientHeight) and therefore the rate a hand already expects.
 * Divided by the live clientHeight so the feel does not change with the window.
 */
const DRAG_TURN_DEG = 360;

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
 * the same radius cuts the chord, so a large pitch or heading move dips inside the
 * sphere both ends sit on. Measured during the keyboard work -- a 20 degree pitch
 * sweep took the range to 112.8 ft against a minRangeFt of 114.9, so the camera
 * spent a few frames roughly 2 ft inside the envelope that exists to keep it out of
 * the building. Small, but minRangeFt is precisely the "not inside Weld" guarantee,
 * and a guarantee that holds only at the endpoints is not one.
 *
 * Fixed by correcting the range rather than by lerping in spherical space: the
 * Cartesian lerp is what makes a heading wrap take the short way round, and moving
 * to spherical to fix a 2 ft error would trade it for a camera that spins the long
 * way through 359 degrees. Direction is left exactly as the ease produced it.
 *
 * Pre-existing, and true of the pointer drag as much as of the keys.
 *
 * `center` and `clamp` are now parameters, not stage 3's constants baked in, so
 * stage 4 can reuse this against MASSING_CENTER and STAGE4_CLAMP rather than
 * against the look-at target and STAGE3_CLAMP -- see orbit.ts's STAGE4_CLAMP
 * for why stage 4's range guarantee has to be measured from MASSING_CENTER
 * and not from kf[4].target.
 */
function keepOutsideMassing(
  position: THREE.Vector3,
  center: THREE.Vector3,
  clamp: PoseClamp = STAGE3_CLAMP,
): void {
  const away = position.clone().sub(center);
  const r = away.length();
  if (r < 1e-6) return;
  const want = Math.min(clamp.maxRangeFt, Math.max(clamp.minRangeFt, r));
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
   * Height above the WGS-84 ellipsoid, ft -- geo/frame.ts's altitudeOf(camera.position),
   * THE definition of altitude from P11 on (docs/phases/P11-PHOTOREAL.md section 2.2).
   *
   * NO LONGER camera.position.y. That was only ever correct for a camera on Weld's local
   * vertical (x = z = 0), which is precisely the invariant a heading drag now routinely
   * breaks -- this field exists so a gate (tests/e2e/drag-safety.spec.ts) can watch the
   * REAL altitude through a sweep and assert it never goes negative, rather than trusting
   * a coordinate that stopped meaning altitude the moment dragging worked everywhere.
   * `near`/`far` below are unaffected: they still come from nearFar(camera.position.y),
   * unchanged in form -- see that function's own header for why passing `y` alone is
   * still safe.
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
  const orbitStage = useStore((s) => s.orbitStage);
  const orbitSeedT = useStore((s) => s.orbitSeedT);
  const setOrbit = useStore((s) => s.setOrbit);
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
   * empty. So leaving is a cut, on purpose, and enterFirstPerson/leaveFirstPerson both bump
   * `cuts` -- though since P10 there is no button that leaves first person mid-stride any
   * more: standing is a property of stage 5, and the only way `walking` flips is an actual
   * stage change (`[`, a link, a reset), which is exactly the case this effect's own `cuts`
   * bump already covers. `walking` stays in the dependency list as the belt to that braces.
   */
  useEffect(() => {
    settled.current = false;
    path.current = [];
  }, [cuts, walking]);

  /**
   * Pointer drag and wheel, at every stage but the last.
   *
   * ONE HANDLER FOR EVERY STAGE, replacing the old split (globe spin at 0, no drag at
   * 1-2, an orbit at 3-4). The rule, per P11-PHOTOREAL.md section 2.4:
   *
   *   left-drag horizontal   orbit.headingDeg +-
   *   left-drag vertical     orbit.pitchDeg -+, clamped per stage (orbit.ts's clampForStage)
   *   wheel / pinch          advances the journey, the same "down/forward is deeper"
   *                          direction the master scrubber moves in -- at every stage,
   *                          replacing the old split (stages 0-2 scrubbed, 3-4 changed the
   *                          orbit's own radius and left u alone). Zooming in therefore
   *                          descends, continuously, all the way through the stage 3 -> 4
   *                          transit and the threshold -- decision 4/5 in the phase spec,
   *                          and the user's own "you should just be able to zoom in and
   *                          go to the view".
   *
   * The current orbit is read from the store on each event rather than closed over.
   * Several pointermove events land between two React renders, and a closure over the
   * rendered value would apply all of them to the same starting angle -- which reads as a
   * drag that fights back.
   *
   * clampOrbit is applied here and the store is left to hold whatever it is given. orbit.ts
   * derived and brute-force verified those limits; a second clamp anywhere else is a second
   * thing to keep in step with them.
   *
   * SEEDED FROM THE CURRENT POSE, NOT FROM THE STAGE'S FIRST KEYFRAME. Stages 0-2 are paths
   * (kf[stage].path), so the pose at the instant a drag begins is cameraKeyframe(kf, stage,
   * t, reduced) -- wherever the wheel or the scrubber last left it -- not the stage's t = 0
   * stop. Stage 3's seed is kf[3] itself (a place, not a path) and stage 4's is kf[4]'s own
   * orbit about MASSING_CENTER (see orbit.ts's stage4OrbitKeyframe for why that pivot, not
   * kf[4].target, is the one the range clamp is measured from).
   *
   * `orbit && orbitStage === stage` GATES EVERY READ OF THE LIVE ORBIT, not just this
   * effect's seed. store.ts's orbitAfterStage() only clears `orbit` on an ARRIVAL at stage
   * 3 or 4 that disagrees with `orbitStage` -- it has no equivalent rule for 0, 1 or 2,
   * because that store is out of scope for this task and predates every stage but 3/4
   * being draggable. So a drag at stage 1 (orbitStage = 1) followed by a plain stage
   * change to stage 2 would otherwise leave stage 1's heading/pitch live at stage 2's
   * differently-aimed shot. Checking `orbitStage === stage` here, in the one file that
   * reads `orbit` to build a pose, is what keeps that from happening without touching
   * store.ts -- and it costs nothing at stages 3/4, where store.ts already guarantees the
   * two agree whenever `orbit` is non-null.
   */
  useEffect(() => {
    if (stage === LAST_STAGE) return;
    const el = gl.domElement;
    const kf = keyframes(params);

    const seed = (): Orbit => {
      if (stage === 4) return orbitOf({ position: kf[4].position, target: MASSING_CENTER, fov: kf[4].fov });
      if (stage === 3) return orbitOf(kf[3]);
      const st = useStore.getState();
      return orbitOf(cameraKeyframe(kf, stage, st.t, st.reducedMotion));
    };
    const currentOrbit = (): Orbit => {
      const st = useStore.getState();
      return st.orbit && st.orbitStage === stage ? st.orbit : seed();
    };

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let scrubTimeout: ReturnType<typeof setTimeout> | undefined;

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
      const o = currentOrbit();
      // Signs are OrbitControls', which is also what "the surface under the cursor
      // follows the cursor" gives: dragging right walks the camera round to the
      // west, so heading rises; dragging down lifts it toward a plan, and pitch is
      // measured from level, so pitch rises.
      setOrbit(
        clampOrbit(
          { headingDeg: o.headingDeg + dx, pitchDeg: o.pitchDeg + dy, rangeFt: o.rangeFt },
          clampForStage(stage),
        ),
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
  }, [stage, gl, params, setOrbit, setJourney, setScrubbing]);

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

    // Everything but the walker is journeyPose's (scene/pose.ts) job now -- lifted verbatim
    // from this branch, see that file's own header for why and tests/pose.test.ts for the
    // equivalence fence. `orbit`/`orbitStage`/`orbitSeedT` pass straight through: journeyPose
    // reads the exact gate this component always applied (a live orbit only counts when it
    // belongs to the CURRENT stage), plus the seed t its own decay fades the hold against.
    const posed =
      walker !== null
        ? { ...firstPersonPose(walker, params), fov: kf[LAST_STAGE].fov }
        : journeyPose(kf, stage, t, reduced, orbit, orbitStage, orbitSeedT);

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
      // 124 ft out, and forcing the range back inside it would pin the camera to the orbit
      // sphere and stall the move.
      if (stage === 3 && t === 0) keepOutsideMassing(camera.position, target.current);
      // Stage 4's equivalent: only while the funnel has not yet fully resolved onto
      // the path (funnel(t) < 1), and measured from MASSING_CENTER with STAGE4_CLAMP
      // -- not from target.current, which is kf[4].target (insideBedB) and not the
      // point stage 4's own range guarantee is centred on. Once funnel(t) reaches 1
      // the pose is the path's exactly, which is already inside the building by
      // design, and correcting it back outside would fight the crossing itself.
      else if (stage === 4 && orbit && orbitStage === 4 && funnel(t) < 1) {
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
     * STILL nearFar(camera.position.y), unchanged in form -- altitude.ts's own header
     * explains why passing y alone stays safe even now that a camera can be off-vertical:
     * it turns y into the site-frame point [0, y, 0] before asking geo/frame.ts's altitudeOf,
     * which is a no-op for a camera actually on the vertical and otherwise just uses the
     * y a caller already had. window.__cam.alt below is the field that carries the REAL,
     * off-vertical-aware altitude.
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
      alt: altitudeOf([camera.position.x, camera.position.y, camera.position.z]),
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
