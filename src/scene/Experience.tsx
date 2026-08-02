"use client";

import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useEffect } from "react";
import { LAST_STAGE, useStore } from "@/state/store";
import { visibility, thresholdOpacity } from "./stages";
import { CameraRig } from "./CameraRig";
import { FirstPerson } from "./FirstPerson";
import { FlyDown } from "./FlyDown";
import { Lighting } from "./Lighting";
import { Globe } from "./Globe";
import { Ground } from "./Ground";
import { Labels } from "./Labels";
import { Campus } from "./Campus";
import { WeldMarker } from "./WeldMarker";
import { FallbackGround } from "./FallbackGround";
import { Tiles } from "./Tiles";
import { WeldExterior } from "./WeldExterior";
import { Suite } from "./Suite";
import { Effects } from "./Effects";
import { Perf } from "./Perf";
import { Hud } from "@/ui/Hud";
import { LoadingBar } from "@/ui/LoadingBar";
import { CUTAWAY_WORDS } from "./cutaway";

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
 * The shadow map type is set here because it is a renderer setting rather than a
 * light's. It was `shadows="soft"`, which is PCFSoftShadowMap, and three r183 deprecated
 * that: the console said "PCFSoftShadowMap has been deprecated. Using PCFShadowMap
 * instead" on every mount, six times over in an e2e run. So it now asks for the map
 * three was silently substituting anyway -- same rendering, no warning, and no
 * dependency on how long the fallback stays in place.
 */

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

/**
 * Whether a Google Maps key is present, decided once at module scope: Next.js inlines
 * `NEXT_PUBLIC_*` env vars at build time, so this is a build-time constant either way and
 * reading it inside the component on every render would just be a slower way to ask the
 * same question.
 *
 * P11 PHASE 1 WIRING, NOT YET THE SWITCH docs/phases/P11-PHOTOREAL.md section 3.1
 * describes: `<Globe>`/`<Ground>`/`<Campus>` stay mounted exactly as before, unconditionally,
 * so the only path anyone can currently test (no key exists yet) is pixel-for-pixel what
 * shipped before this file changed. `<Tiles>` or `<FallbackGround>` mount ALONGSIDE them --
 * `<FallbackGround>` duplicates Ground/Campus's own content, so with no key both the old
 * and the new keyless renderer are on screen at once, which is deliberate for this task and
 * is cleaned up (the old components deleted) in the phase that actually retires them.
 */
const HAS_TILES_KEY = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY);

export default function Experience() {
  const stage = useStore((s) => s.stage);
  const t = useStore((s) => s.t);
  const params = useStore((s) => s.params);
  const reduced = useStore((s) => s.reducedMotion);
  const cutaway = useStore((s) => s.cutaway);
  const pieces = useStore((s) => s.pieces);
  const selected = useStore((s) => s.selected);
  const pointerLocked = useStore((s) => s.pointerLocked);
  const select = useStore((s) => s.select);
  const commit = useStore((s) => s.commit);

  const vis = visibility(stage);
  const { shell, interior } = thresholdOpacity(stage, t, reduced);

  // The canvas has no accessible content of its own -- a screen reader gets nothing at
  // all out of WebGL -- so this label is the only thing that can say what is on
  // screen. cutaway.ts's header asks for the active mode to be named here, and this is
  // that: the mode changes the geometry, and a viewer who cannot see that a wall is
  // missing still has to be told.
  //
  // `.alt` and not `.prose`, because what this builds is an accessible NAME. The table
  // carries a register per call site for that reason; the sentence is the same one this
  // file used to hold, moved rather than reworded.
  const canvasLabel =
    `Three-dimensional descent from orbit to the interior of Weld 15. ` +
    CUTAWAY_WORDS[cutaway].alt;

  return (
    <>
      <div style={{ position: "fixed", inset: 0 }}>
        <Canvas
          camera={{ position: [0, 0, 2.6], fov: 45, near: 0.5, far: 25_000 }}
          dpr={[1, 2]}
          shadows={{ type: THREE.PCFShadowMap }}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
        >
          <CanvasLabel text={canvasLabel} />

          {/* Lighting attaches the scene background as well as the lights: what is
              beyond the glass is a daylight decision, and it is the same threshold
              ramp that drives the dissolve. */}
          <Lighting />

          {/* BEFORE CameraRig, and the order is load-bearing rather than tidy. Both run
              their useFrame at the default priority, so R3F calls them in mount order:
              FirstPerson advances the walker and writes it to the store, then CameraRig
              reads it back and places the camera in the same frame. Mounted the other way
              round the camera would show the previous frame's position, which at 4 ft/s is
              a permanent 0.07 ft of lag and, on a slow frame, a visible one. */}
          <FirstPerson />
          <CameraRig />
          {/* AFTER CameraRig, on the mirror image of the argument that puts FirstPerson before
              it. FlyDown writes `t` to the store and CameraRig reads it, so running it after
              means the camera uses THIS frame's t on the NEXT frame -- one frame of lag, at a
              rate of about a fiftieth of a stage per frame, which is invisible. Running it
              first would be worse than lagging: setT triggers a React render, and a render
              between FlyDown and CameraRig in the same frame would have CameraRig read a t that
              had already moved on, so the flight would advance twice per frame and run at
              double speed. */}
          <FlyDown />
          <Perf />

          {/* GATED ON `!HAS_TILES_KEY`, NOT JUST STAGE -- closing the gap phase 1 deliberately
              left open and phase 5 flagged rather than fixed (docs/phases/P11-PHOTOREAL.md
              section 3.1: "Globe.tsx/Ground.tsx/CampusMesh.tsx retired" was the target
              architecture; until this line, both worlds were mounted at once whenever a key was
              present). Measured, not assumed: with a real key and no gate, this opaque massing
              sits at the same site position as Google's real photogrammetry and occludes it from
              most angles -- confirmed by screenshot diff, hiding this system is what first made
              the live tiles visible at all during phase 1 verification. `vis.globe`/`vis.tiles`
              still narrow it by stage; `!HAS_TILES_KEY` narrows it by world-source on top of
              that, so the keyless fallback path (decision 10) is completely unaffected. */}
          <Globe visible={vis.globe && !HAS_TILES_KEY} />
          {/* AFTER the globe and BEFORE the campus, which is the order they occlude in: the
              globe is a depth-less backdrop behind everything, the ground is a real depth-tested
              surface, and the massing stands on the ground. Mounted on the same stages as
              `tiles` (docs/phases/P11-PHOTOREAL.md §0.7 -- through stage 4 now, not just 3, which
              is the fix for the disappearing-yard bug), because the ground and the buildings on
              it arrive together. */}
          <Ground visible={vis.tiles && !HAS_TILES_KEY} />
          <Campus visible={vis.tiles && !HAS_TILES_KEY} highlightWeld={stage >= 2} />
          {/* Weld's own ground ring + pin. Mounted regardless of HAS_TILES_KEY -- it marks Weld
              against either world, real tiles or fallback, which is the whole point of it.
              Capped at stage 4, one stage further than its old unbounded `stage >= 2` (which left
              it visible at stage 5 with nothing exterior left to mark) -- stage 5 stands inside
              the hall, behind the walls the ring and pin sit outside of, so there is nothing left
              for either to mark from in there. */}
          <WeldMarker visible={stage >= 2 && stage <= 4} />
          {/* `<Tiles>` has no `visible` prop of its own -- it is unconditionally mounted whenever
              a key is present, which is already the "real tiles are visible from orbit all the
              way down" behaviour `tiles`'s own comment in stages.ts argues for, so there is
              nothing to gate here. `<FallbackGround>` does have one, and takes `vis.tiles` like
              Ground and Campus, for the same §0.7 fix -- and is the ONLY world-geometry mounted
              on the keyless path, now that Globe/Ground/Campus are gated off above whenever a key
              is present. */}
          {HAS_TILES_KEY ? <Tiles /> : <FallbackGround visible={vis.tiles} />}
          {/* CONDITIONALLY MOUNTED, not merely made invisible, and that is a measured decision.
              drei's <Html> portals a real DOM node and repositions it every frame; five of them
              kept running at stages 4 and 5, where no place label can be on screen at all, and the
              extra per-frame DOM work was enough to push a11y.spec.ts's throttled-announcement
              measurement past its window. An invisible <Labels> is not free; an unmounted one is.
              NOT `vis.tiles` -- deliberately narrower now that `tiles` extends through stage 4 to
              fix §0.7. Cambridge/Boston place chips have nothing to label once the camera is
              inside the fly-through toward Weld, and mounting them there would reopen the exact
              a11y regression this comment already measured, so this stays the stage window
              `tiles` used to be (`stage <= 3`) rather than following it to 4. */}
          {stage <= 3 ? <Labels /> : null}
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
            // WHAT THIS COSTS, MEASURED RATHER THAN GUESSED, AND P7 CHANGED THE NUMBER.
            // It used to read: stage 5 stands inside bedroom B, so the pointer can only
            // reach bedroom B's furniture -- projecting bedA-bed-0's corner puts it at
            // (1574, -57) on a 1280 x 720 viewport, off the top-right of the screen and
            // behind a wall besides -- and 4 of 29 pieces were in frame at all.
            //
            // Stage 5 now stands in the hall (stages.ts records why), and re-measured the
            // same way -- projecting each piece's anchor through DragLayer's own
            // screenOf() and asking document.elementFromPoint what is on top -- 17 of the
            // 29 are in frame and unobstructed: bedroom A's desk, two chairs and a
            // dresser, all six pieces in the common room, and all seven in K, most of
            // them seen through the doorways down the length of the hall. The 12 that are
            // not are bedroom A's two beds and its other desk and dresser, which project
            // off the left edge, and the whole of bedroom B, which is behind the camera.
            //
            // RE-CONFIRMED AT P10 STEP 11, SAME 17, DIFFERENT OCCLUDER. The dock (Hud.tsx)
            // is now a single fixed panel at top right, `x 1058..1426`, every stage, rather
            // than the roaming per-stage HUD this comment originally measured against --
            // and it happens to sit clear of all 17 reachable anchors' projected positions,
            // so the count did not move. Re-run per piece (`window.__drag`, the same probe
            // `scripts/p10-measure.mjs`'s `reach` section uses) rather than assumed, because
            // P10 also moved the camera controls onto the window and it was not obvious in
            // advance that nothing in the top-right corner would clip a piece the old HUD
            // never stood over.
            //
            // That test is a projection and not a depth test, which is worth saying: a
            // piece can be "unobstructed" by that criterion and still be behind a wall.
            // What it bounds is which pieces the pointer can be aimed at, which is the
            // question this gate is about.
            //
            // The fix is the dollhouse view -- edit from stage 3 with a cutaway on --
            // and it is no longer blocked: WeldExterior reads `cutaway` and cuts the
            // shell, so the brick comes off the half you are looking into.
            //
            // IT IS STILL NOT `stage >= 3 && cutaway !== "none"`, AND THE REASON IS
            // MEASURED. Only `section` opens the suite. From the stage-3 keyframe
            // wallsDown drops 9 of 56 ring edges -- 97.9 ft of the 440.3 ft perimeter,
            // all of it south of v = 19.9, while the suite's own windows are at
            // v 33.7-70.9 -- so it opens the empty half of the building and leaves the
            // suite behind brick. Gating edit on "any cutaway" would put the pointer
            // back to picking pieces the viewer cannot see, which is the bug this
            // comment exists to record. `stage >= 3 && cutaway === "section"` is the
            // honest condition, and turning it on wants a look at what the pointer
            // actually hits from an orbiting camera rather than a one-line change here.
            // AND NOT WHILE THE POINTER IS LOCKED, rather than not while walking. The
            // pointer belongs to look while it is locked and to furniture editing while
            // it is not -- a walker can stand at stage 5 with the mouse still free
            // (before the first double-click, or after an Escape), and there is no
            // reason to refuse editing in that state. The arrow keys follow whatever is
            // selected regardless (FirstPerson.tsx's arrows-yield-to-selection check):
            // selection only ever happens by pointer pick, so a keyboard-only viewer
            // never has one and the walker keeps the arrows throughout. enterFirstPerson()
            // still drops the selection on arrival, so no panel is left offering to move
            // a piece the moment editing becomes unreachable.
            edit={stage === LAST_STAGE && !pointerLocked}
            selected={selected}
            onSelect={select}
            onResult={commit}
          />

          <Effects />
        </Canvas>
      </div>
      <div className="vignette" aria-hidden="true" />
      <LoadingBar />
      <Hud />
    </>
  );
}
