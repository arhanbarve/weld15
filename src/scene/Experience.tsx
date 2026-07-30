"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { LAST_STAGE, useStore } from "@/state/store";
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
import type { CutawayMode } from "./cutaway";

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

/**
 * What each cutaway mode has done to the model, in a sentence.
 *
 * A Record over the union rather than a lookup with a fallback, so a fifth mode fails
 * to compile here instead of shipping a canvas that describes the wrong thing.
 */
const CUTAWAY_ALT: Record<CutawayMode, string> = {
  none: "The suite is shown closed, as built.",
  roofOff: "The ceiling is removed, so the plan can be read from above.",
  wallsDown: "The wall between the camera and the room it faces is removed.",
  section: "The model is cut on the hall's centreline and the near half removed.",
};

/**
 * Put the accessible name on the CANVAS, which is the one place it works.
 *
 * `aria-label` passed to <Canvas> does not land on the canvas element. R3F spreads
 * unrecognised props onto its own container div, and the element a screen reader
 * actually meets -- the one with role of img by way of being a graphic -- is the canvas
 * inside it. Measured: the attribute was absent from both the canvas and its parent, so
 * the whole descent had no accessible name at all until this component existed. It was
 * found by an e2e gate asserting the label, not by reading the code, which is the third
 * time in this project that an accessibility property has been written somewhere it has
 * no effect.
 *
 * role="img" goes with it: without a role, a labelled canvas is still an unlabelled
 * graphic to several readers.
 */
function CanvasLabel({ text }: { text: string }) {
  const el = useThree((s) => s.gl.domElement);
  useEffect(() => {
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", text);
  }, [el, text]);
  return null;
}

export default function Experience() {
  const stage = useStore((s) => s.stage);
  const t = useStore((s) => s.t);
  const params = useStore((s) => s.params);
  const reduced = useStore((s) => s.reducedMotion);
  const cutaway = useStore((s) => s.cutaway);
  const pieces = useStore((s) => s.pieces);
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const commit = useStore((s) => s.commit);

  const vis = visibility(stage);
  const { shell, interior } = thresholdOpacity(stage, t, reduced);

  // The canvas has no accessible content of its own -- a screen reader gets nothing at
  // all out of WebGL -- so this label is the only thing that can say what is on
  // screen. cutaway.ts's header asks for the active mode to be named here, and this is
  // that: the mode changes the geometry, and a viewer who cannot see that a wall is
  // missing still has to be told.
  const canvasLabel =
    `Three-dimensional descent from orbit to the interior of Weld 15. ` +
    CUTAWAY_ALT[cutaway];

  return (
    <>
      <div style={{ position: "fixed", inset: 0 }}>
        <Canvas
          camera={{ position: [0, 0, 2.6], fov: 45, near: 0.5, far: 25_000 }}
          dpr={[1, 2]}
          shadows="soft"
          gl={{ antialias: true, preserveDrawingBuffer: true }}
        >
          <CanvasLabel text={canvasLabel} />

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
            pieces={pieces}
            cutaway={cutaway}
            // Editing at the last stage only. The interior is mounted a stage early so
            // its geometry is warm and it is visible through the threshold at stage 4,
            // but at both of those the camera is outside or moving, and a pointer down
            // on a floor plane 40 ft away picks a piece the viewer cannot see. The
            // dimension sliders are not gated this way: correcting a number is
            // meaningful from anywhere, and it is only the pointer pick that needs the
            // camera to be in the room.
            //
            // WHAT THIS COSTS, MEASURED RATHER THAN GUESSED. Stage 5 stands inside
            // bedroom B, so the pointer can only reach bedroom B's furniture: projecting
            // bedA-bed-0's corner puts it at (1574, -57) on a 1280 x 720 viewport, which
            // is off the top-right of the screen and behind a wall besides. The keyboard
            // and the panel's nudge buttons reach whatever is selected, but nothing
            // selects a piece in another room.
            //
            // The fix is the dollhouse view -- edit from stage 3 with a cutaway on --
            // and it is blocked on something real: hiddenWalls() takes down the
            // interior's own walls, and WeldExterior does not read `cutaway` at all, so
            // from outside you are looking at an opaque 1872 brick shell. Editing from
            // there would be dragging pieces you cannot see. Recorded here and in
            // docs/phases/P6.md rather than half-built.
            edit={stage === LAST_STAGE}
            selected={selected}
            onSelect={select}
            onResult={commit}
          />

          <Effects />
        </Canvas>
      </div>
      <div className="vignette" aria-hidden="true" />
      <Hud />
    </>
  );
}
