"use client";

import { Canvas } from "@react-three/fiber";
import { useStore } from "@/state/store";
import { visibility, thresholdOpacity } from "./stages";
import { CameraRig } from "./CameraRig";
import { Lighting } from "./Lighting";
import { Globe } from "./Globe";
import { Campus } from "./Campus";
import { WeldExterior } from "./WeldExterior";
import { Suite } from "./Suite";
import { Effects } from "./Effects";
import { Perf } from "./Perf";
import { Hud } from "@/ui/Hud";

/**
 * The whole journey, from orbit to a bedroom in Weld 15.
 *
 * This file only decides what is mounted and with what opacity. Everything that
 * has an opinion lives elsewhere: the camera in CameraRig and stages.ts, the light
 * and the sky in Lighting, the geometry in its own components.
 *
 * Two things are NOT mounted here and both are deliberate. Furniture is mounted by
 * Suite, because it is fitted to the same rooms Suite builds and mounting it beside
 * Suite would need the params twice. Threshold is mounted by WeldExterior, because
 * the sweep is a property of the shell it dissolves.
 *
 * `shadows="soft"` is PCFSoftShadowMap. It costs nothing today -- Lighting records
 * why no mesh casts a shadow yet -- and it is set here because the shadow map type
 * is a renderer setting, not a light's.
 */
export default function Experience() {
  const stage = useStore((s) => s.stage);
  const t = useStore((s) => s.t);
  const params = useStore((s) => s.params);
  const reduced = useStore((s) => s.reducedMotion);
  const cutaway = useStore((s) => s.cutaway);

  const vis = visibility(stage);
  const { shell, interior } = thresholdOpacity(stage, t, reduced);

  return (
    <>
      <div style={{ position: "fixed", inset: 0 }}>
        <Canvas
          camera={{ position: [0, 0, 2.6], fov: 45, near: 0.5, far: 25_000 }}
          dpr={[1, 2]}
          shadows="soft"
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          aria-label="Three-dimensional descent from orbit to the interior of Weld 15"
        >
          {/* Lighting attaches the scene background as well as the lights: what is
              beyond the glass is a daylight decision, and it is the same threshold
              ramp that drives the dissolve. */}
          <Lighting />

          <CameraRig />
          <Perf />

          <Globe visible={vis.globe} />
          <Campus visible={vis.campus} highlightWeld={stage >= 2} />
          <WeldExterior visible={vis.weld} opacity={shell} />
          <Suite
            visible={vis.interior}
            opacity={interior}
            params={params}
            ceiling={!cutaway}
          />

          <Effects />
        </Canvas>
      </div>
      <div className="vignette" aria-hidden="true" />
      <Hud />
    </>
  );
}
