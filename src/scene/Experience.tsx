"use client";

import { Canvas } from "@react-three/fiber";
import { useStore } from "@/state/store";
import { visibility, thresholdOpacity } from "./stages";
import { CameraRig } from "./CameraRig";
import { Globe } from "./Globe";
import { Campus } from "./Campus";
import { WeldExterior } from "./WeldExterior";
import { Suite } from "./Suite";
import { Hud } from "@/ui/Hud";

/**
 * P2 grey-box vertical slice: the whole journey, ugly but complete.
 *
 * Materials, lighting design and post-processing are deliberately absent. The
 * point of this phase is to find out whether the through-the-wall threshold works
 * at all, before anything is polished around it.
 */
export default function Experience() {
  const stage = useStore((s) => s.stage);
  const t = useStore((s) => s.t);
  const params = useStore((s) => s.params);

  const vis = visibility(stage);
  const { shell, interior } = thresholdOpacity(stage, t);

  return (
    <>
      <div style={{ position: "fixed", inset: 0 }}>
        <Canvas
          camera={{ position: [0, 0, 2.6], fov: 45, near: 0.5, far: 25_000 }}
          dpr={[1, 2]}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          aria-label="Three-dimensional descent from orbit to the interior of Weld 15"
        >
          <color attach="background" args={["#06203f"]} />
          {/* A hemisphere light means no face is ever unlit. Without it the
              north gable is backlit and, at partial opacity during the
              threshold, blends down to almost the background -- which made the
              dissolve read as a flat colour wash rather than a wall going away.
              Real lighting design is P4; this only guarantees every face reads. */}
          <hemisphereLight args={["#cfe4f2", "#0c3260", 0.75]} />
          <ambientLight intensity={0.35} />
          <directionalLight position={[900, 1400, 700]} intensity={1.0} />
          <directionalLight position={[-500, 400, -900]} intensity={0.55} />

          <CameraRig />

          <Globe visible={vis.globe} />
          <Campus visible={vis.campus} highlightWeld={stage >= 2} />
          <WeldExterior visible={vis.weld} opacity={shell} />
          <Suite visible={vis.interior} opacity={interior} params={params} />
        </Canvas>
      </div>
      <Hud />
    </>
  );
}
