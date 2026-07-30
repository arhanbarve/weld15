"use client";

import { useMemo } from "react";
import campus from "@/data/campus.json";
import { extrudedGeometry } from "./geometry";

/**
 * The 36 buildings around Weld, extruded to their real heights.
 *
 * Grey-box: flat materials, one mesh per building. That is 36 draw calls, which
 * P3 merges into one. Recorded rather than optimised now so P3 has a baseline.
 */
export function Campus({ visible, highlightWeld }: { visible: boolean; highlightWeld: boolean }) {
  const items = useMemo(
    () =>
      campus.buildings.map((b) => ({
        name: b.name,
        weld: b.name === "Weld Hall",
        geometry: extrudedGeometry(b.ring as number[][], b.height_ft),
      })),
    [],
  );

  return (
    <group visible={visible}>
      {items.map((b, i) => (
        <mesh key={`${b.name}-${i}`} geometry={b.geometry}>
          <meshStandardMaterial
            color={b.weld && highlightWeld ? "#ffffff" : "#8fc4f2"}
            roughness={0.7}
            metalness={0}
            // Weld reads brighter than its neighbours; hue alone is not enough,
            // which the accessibility gate in design-system/MASTER.md requires.
            emissive={b.weld && highlightWeld ? "#5EA6EB" : "#000000"}
            emissiveIntensity={b.weld && highlightWeld ? 0.35 : 0}
            transparent
            opacity={b.weld ? 0.95 : 0.55}
          />
        </mesh>
      ))}
      <gridHelper args={[3000, 60, "#0c3260", "#0c3260"]} position={[0, -0.5, 0]} />
    </group>
  );
}
