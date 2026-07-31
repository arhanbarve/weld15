"use client";

import { WELD_ORIGIN } from "@/geo/frames";

/**
 * Stage 0, at unit scale in its own scene graph.
 *
 * Earth at the project's foot scale would be 2.1e7 ft in radius, which would wreck
 * depth precision for everything else, so stage 0 -> 1 is the one hard cut in the
 * sequence. Grey-box: a sphere and a marker at Weld's real latitude and longitude.
 *
 * P8 ASKED FOR THIS FILE TO BE CODE-SPLIT AND THE MEASUREMENT SAYS NOT TO, so here is the
 * measurement rather than the intention.
 *
 * IMPLEMENTATION-PLAN §9 and P8 both say "globe code-split so it is not in the critical
 * path once you are past it". Built three ways against a production build and compared the
 * emitted chunks -- Next 16.2's Turbopack build no longer prints a size table at all, with
 * or without --experimental-analyze, so the bytes are `.next/static/chunks` on disk:
 *
 *   as shipped                        scene chunk 1,252,534 B    total JS 1,885,152 B
 *   Globe deleted outright            scene chunk 1,251,818 B    -716 B
 *   lazy(() => import("./Globe"))     scene chunk 1,252,102 B    -432 B, total +1,173 B
 *
 * All four builds off one snapshot of the tree, which is what makes the deltas readable --
 * the baseline reproduced byte-identically twice, same chunk hash. The absolute figure moves
 * with the tree and does not matter here: the build at d3036c0 reads 1,253,297 B.
 *
 * So the WHOLE globe is 716 bytes of a 1.25 MB chunk -- 0.06 %, and under 1 kB of the
 * 388 kB that chunk actually transfers gzipped. It is three spheres and one import, and
 * every three class it touches (SphereGeometry, MeshStandardMaterial, MeshBasicMaterial) is
 * used elsewhere in the scene and stays behind. The lazy boundary moves 432 of those 716
 * bytes off the critical path and SHIPS 1,173 MORE in total, because it splits geo/frames
 * into a 703 B chunk of its own that the main bundle still needs and still fetches
 * immediately -- measured at +117 ms, alongside the main chunk -- plus the globe's own
 * 869 B and lazy()'s wiring.
 *
 * AND IT BREAKS THE DESCENT, which was measured and not merely feared. Stage 0 IS the globe
 * and stage 0 is first paint, so "off the critical path" is a contradiction here. Serving
 * the split build in headed Chrome with the globe's chunk delayed 2,500 ms, and sampling
 * with journey.spec.ts's own frame metric: 0.0 % covered / 1 distinct colour at +850 ms
 * through +2,905 ms, then 45.2 % / 566 from +3,313 ms on. Nearly three seconds of empty
 * blue where the Earth should be, and journey.spec.ts's `nonBgPct > 8` fails on every frame
 * in that window.
 *
 * What a split would have to look like to be worth it is the other way round: keep the
 * globe eager and defer the campus and the suite, which are 16.9k and the shadow pass. That
 * is a different change in different files and it is not what §9 asked for. CanvasHost.tsx
 * records the R3F half of the experiment -- what a suspending child of <Canvas> does.
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
