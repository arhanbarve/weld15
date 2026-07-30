"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "@/state/store";
import { keyframes, blend } from "./stages";

/**
 * Drives the camera from the stage machine.
 *
 * Reduced motion is a BRANCH, not a shorter duration: it snaps to the keyframe
 * rather than easing toward it. Shortening the fly would still fly, which is what
 * the guideline actually prohibits.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const stage = useStore((s) => s.stage);
  const t = useStore((s) => s.t);
  const params = useStore((s) => s.params);
  const reduced = useStore((s) => s.reducedMotion);
  const setReduced = useStore((s) => s.setReducedMotion);

  const target = useRef(new THREE.Vector3());
  const settled = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setReduced]);

  useEffect(() => {
    settled.current = false;
  }, [stage]);

  useFrame((_, delta) => {
    const kf = keyframes(params);
    // Stage 4 blends between standing outside the gable and being inside.
    const want = stage === 4 ? blend(kf[4], kf[5], t) : kf[stage];

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
    }

    camera.lookAt(target.current);
  });

  return null;
}
