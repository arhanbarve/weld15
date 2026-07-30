"use client";

import { useMemo } from "react";
import weld from "@/data/weld.json";
import { WELD } from "@/geo/place";
import { extrudedGeometry, roofGeometry } from "./geometry";

/**
 * Weld Hall: a 60 ft mass under a pitched roof reaching 85.4 ft.
 *
 * NOT an 87 ft box. Cambridge GIS gives eaves at 60.0 and ridge at 85.4 above
 * grade, and five floors at 12 ft is exactly 60 -- three figures that agree. The
 * 87.01 in Harvard's data is the ridge, and treating it as a flat height makes
 * the building read as a slab.
 *
 * `opacity` is driven by the threshold, which dissolves the shell as the camera
 * pushes through the gable.
 */
export function WeldExterior({ visible, opacity }: { visible: boolean; opacity: number }) {
  const ring = weld.rings[0] as number[][];
  const { walls, roof } = useMemo(
    () => ({
      walls: extrudedGeometry(ring, WELD.eaves),
      roof: roofGeometry(ring, WELD.eaves, WELD.ridge),
    }),
    [ring],
  );

  if (opacity <= 0.001) return null;

  return (
    <group visible={visible}>
      <mesh geometry={walls}>
        <meshStandardMaterial
          color="#8fc4f2"
          roughness={0.75}
          transparent
          opacity={opacity}
          depthWrite={opacity > 0.9}
        />
      </mesh>
      <mesh geometry={roof}>
        <meshStandardMaterial
          color="#5783b4"
          roughness={0.8}
          transparent
          opacity={opacity}
          depthWrite={opacity > 0.9}
        />
      </mesh>
    </group>
  );
}
