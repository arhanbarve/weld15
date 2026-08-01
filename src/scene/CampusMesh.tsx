"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import manifest from "@/data/buildings-manifest.json";

/**
 * Harvard's campus, as Harvard models it.
 *
 * LOADED IMPERATIVELY AND NOT WITH useGLTF, and src/scene/imagery.ts's header is the reason: R3F
 * wraps <Canvas>'s children in a Suspense whose fallback throws, so a scene child that suspends
 * suspends the CANVAS, up to the "LOADING WELD 15" screen outside it. P8 measured that at 2.5 s of
 * the whole UI disappearing and coming back. A 1.1 MB GLB is exactly the thing that warning was
 * written for. So: a loader in an effect, and nothing rendered until it arrives.
 *
 * NOTHING IS DRAWN WHILE IT LOADS. Not a placeholder, not a wireframe. The ground is already
 * underneath at every altitude this is mounted at, so an empty frame is a frame with a photograph
 * in it rather than a hole.
 */
export function CampusMesh({ visible }: { visible: boolean }) {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let live = true;
    let loaded: THREE.BufferGeometry | null = null;
    new GLTFLoader().load(manifest.file, (gltf) => {
      const mesh = gltf.scene.getObjectByProperty("type", "Mesh") as THREE.Mesh | undefined;
      if (!mesh) return;
      loaded = mesh.geometry;
      if (!live) {
        loaded.dispose();
        return;
      }
      setGeo(loaded);
    });
    return () => {
      live = false;
      loaded?.dispose();
    };
  }, []);

  if (!geo) return null;

  return (
    <mesh geometry={geo} visible={visible}>
      <meshStandardMaterial color="#b06a4a" roughness={0.9} metalness={0} />
    </mesh>
  );
}
