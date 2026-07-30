"use client";

import { WELD_ORIGIN } from "@/geo/frames";

/**
 * Stage 0, at unit scale in its own scene graph.
 *
 * Earth at the project's foot scale would be 2.1e7 ft in radius, which would wreck
 * depth precision for everything else, so stage 0 -> 1 is the one hard cut in the
 * sequence. Grey-box: a sphere and a marker at Weld's real latitude and longitude.
 */
export function Globe({ visible }: { visible: boolean }) {
  // Spherical to cartesian, radius 1, with +Y north and the prime meridian on +X.
  const lat = (WELD_ORIGIN.lat * Math.PI) / 180;
  const lon = (WELD_ORIGIN.lon * Math.PI) / 180;
  const r = 1.01;
  const marker: [number, number, number] = [
    r * Math.cos(lat) * Math.cos(lon),
    r * Math.sin(lat),
    -r * Math.cos(lat) * Math.sin(lon),
  ];

  return (
    <group visible={visible}>
      <mesh>
        <sphereGeometry args={[1, 48, 32]} />
        <meshStandardMaterial color="#0c3260" roughness={0.9} metalness={0} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.004, 48, 32]} />
        <meshBasicMaterial color="#8fc4f2" wireframe transparent opacity={0.28} />
      </mesh>
      <mesh position={marker}>
        <sphereGeometry args={[0.022, 16, 12]} />
        <meshBasicMaterial color="#e4526f" />
      </mesh>
    </group>
  );
}
