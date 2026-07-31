"use client";

import { useFrame } from "@react-three/fiber";
import { FLY_DOWN_END, useStore } from "@/state/store";
import { keyframes } from "./stages";

/**
 * The automatic descent: advances `t` and steps the stage until the camera reaches Weld Hall.
 *
 * A COMPONENT INSIDE <Canvas> AND NOT A setInterval, because the thing it animates is a camera
 * and the camera is advanced in useFrame. An interval would write `t` on a different clock from
 * the one CameraRig reads it on, so a slow frame would produce a jump rather than a slower move,
 * and a backgrounded tab would either keep flying with no frames drawn or drift apart from the
 * render loop entirely. useFrame's delta is the frame's own elapsed time, which is what makes
 * the descent framerate-independent for free.
 *
 * IT WRITES THE STORE RATHER THAN THE CAMERA. CameraRig is the only writer of camera.position in
 * this app -- its header is explicit that two writers is the bug that ends in a camera
 * oscillating between two answers on alternate frames -- so this drives the same `t` a human
 * dragging the scrubber would drive, and CameraRig turns it into a pose exactly as before.
 * Nothing about the flight is a special case downstream, which is also why the flight is
 * reproducible: every pose it visits is cameraKeyframe(stage, t) for some t, so a gate can hit
 * the same poses by setting numbers.
 *
 * NOT MOUNTED UNDER REDUCED MOTION. See the guard in the frame loop and Hud.tsx, which does not
 * offer the control at all. MASTER.md:93 asks for jump cuts there, and an automatic three-decade
 * descent is the single most motion-heavy thing in the app.
 */

/**
 * Seconds of flight per decade of altitude descended.
 *
 * PER DECADE, WHICH IS THE WHOLE POINT, because the stages are wildly unequal: stage 0 falls
 * through 3.28 decades, stage 1 through 1.32 and stage 2 through 1.06. A fixed duration per
 * stage would descend three times faster during stage 0 than during stage 2 -- in the only
 * measure that matters perceptually, which is the RATE OF CHANGE OF APPARENT SCALE -- and the
 * flight would feel like it slammed on the brakes at Cambridge. Time proportional to decades
 * makes the whole descent one continuous zoom at a constant relative rate.
 *
 * 1.6 s per decade puts the full run from orbit to Weld Hall at about 9 seconds: 5.2 for stage
 * 0, 2.1 for stage 1, 1.7 for stage 2. Long enough to read as a flight rather than a cut, short
 * enough that nobody reaches for the skip control.
 */
const SECONDS_PER_DECADE = 1.6;

/** Never divide by a decade count of zero, whatever a params set does to the keyframes. */
const MIN_DECADES = 0.2;

export function FlyDown() {
  const flying = useStore((s) => s.flying);
  const stage = useStore((s) => s.stage);
  const params = useStore((s) => s.params);
  const reduced = useStore((s) => s.reducedMotion);
  const setT = useStore((s) => s.setT);
  const flyStep = useStore((s) => s.flyStep);
  const setFlying = useStore((s) => s.setFlying);

  useFrame((_, delta) => {
    if (!flying) return;

    // Reduced motion should never have started a flight -- Hud.tsx does not render the button --
    // but the flag can change mid-flight when the OS setting changes, and the honest response to
    // "stop animating things" arriving halfway down is to stop, not to finish the descent.
    if (reduced) {
      setFlying(false);
      return;
    }

    // Past the end, or a stage with nowhere to travel: stop. Stage 3 has no path by design, so
    // arriving there is how the flight ends rather than an error.
    const path = keyframes(params)[stage].path;
    if (stage >= FLY_DOWN_END || !path) {
      setFlying(false);
      return;
    }

    // The stage's own extent, in decades of altitude, read off the path it will actually fly.
    // Derived per frame rather than tabulated because the keyframes depend on the suite params
    // and keyframes() is memoised on their identity, so this is a cache hit and a subtraction.
    const from = path[0]!.frame.position[1];
    const to = path[path.length - 1]!.frame.position[1];
    const decades = Math.max(MIN_DECADES, Math.log10(from / to));

    const next = useStore.getState().t + delta / (decades * SECONDS_PER_DECADE);
    if (next >= 1) {
      // Land exactly on the boundary before stepping, so the last frame of this stage is the
      // stage's own endpoint -- which is the next stage's keyframe object, pinned by
      // descentPath(). Without this the flight would skip from t = 0.97 straight to the next
      // stage and lose the last 3% of the move.
      setT(1);
      flyStep();
      return;
    }
    setT(next);
  });

  return null;
}
