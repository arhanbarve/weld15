"use client";

/**
 * Weld Hall: a 60 ft mass under a gabled roof reaching 85.4 ft.
 *
 * NOT an 87 ft box. Cambridge GIS gives eaves at 60.0 and ridge at 85.4 above
 * grade, and five floors at 12 ft is exactly 60 -- three figures that agree. The
 * 87.01 in Harvard's data is the ridge, and treating it as a flat height makes the
 * building read as a slab.
 *
 * AND NOT A CONE. P2 drew the roof with geometry.ts's roofGeometry(), which fans
 * every eaves vertex to a single apex; on a 56-vertex ring that is a 56-sided cone,
 * shipped knowing it. Everything here now comes from buildWeld(), which replaces the
 * fan's apex point with a ridge LINE and reads every dimension off weld.json or off
 * the ring itself. roofGeometry() has been deleted from geometry.ts, since this
 * rewrite was what made it dead.
 *
 * THE PALETTE, RETIRED RATHER THAN BLENDED (P11 decision 9)
 * Weld is brick with light sandstone belts under a slate roof, and through P10 it
 * appeared at stage 2 wearing a cyanotype at long range that handed off to those
 * real materials as the camera closed -- a handoff rather than a blend, because
 * MASTER.md was explicit that the two must not cross-fade.
 *
 * Now that live Google Photorealistic 3D Tiles render the real world at every
 * altitude (P11), Weld's own parametric shell keeping a second, drawing-style
 * palette for its distant views has no photograph beside it to justify: everything
 * else in frame at stage 2 is already photoreal, so a blue-line-on-blue-ground Weld
 * would be the one wrong thing on screen rather than a coherent "scan of the
 * campus" moment. Locked decision 9: "Retire the cyanotype for the world, keep it
 * for UI. Photoreal at every altitude. Scan palette survives only as chrome." So
 * this shell wears `BRICK` / `SLATE` from materials.ts unconditionally -- every
 * stage, every altitude -- and there is no seam, no progress ramp and no second
 * palette left to hand off from. `attachPaletteSeam`, `SCAN_ROOF` and the altitude
 * ramp that used to drive them are gone with it; `Threshold.tsx`, which existed only
 * to draw the bright line riding that seam, is deleted outright.
 *
 * WHAT DID NOT MOVE. The dissolve is untouched: `opacity`, fed by `shell` from
 * thresholdOpacity()'s stage 3->4 ramp, still fades this shell to nothing as the
 * camera passes through the wall, exactly as before. That crossing was never the
 * palette's -- it is the ONLY thing left that varies the shell's appearance now.
 *
 * DRAW CALLS: four meshes here at mode "none", period -- P11 decision 9 deletes the fifth,
 * <Threshold>'s own scanline mesh, along with the seam it rode. walls, roof, towers and bays
 * are the four geometries buildWeldCut() returns; the towers share the roof's material.
 * Measured at stage 4 with reduced motion, where nothing else is on screen and the
 * composer is off: 4 calls, 416 triangles, which is 220 for the extruded 56-point ring,
 * 112 for the gable's 56 fan quads, 24 for two roof features and 60 for five window
 * bays. Against a budget of 8 that leaves four spare, and the reason not to spend them
 * on a material feature is the one materials() records against `transmission` -- it
 * forces a second full scene render, so it doubles every call rather than adding one.
 * Nothing here has that property and nothing here uses a render target.
 *
 * THAT 8 IS A BUDGET OF MESHES, AND THE MEASUREMENT BESIDE IT IS THE OPAQUE ONE. Reduced
 * motion draws this shell fully opaque, and an opaque mesh is one submission; three submits
 * a TRANSPARENT DoubleSide material twice, back faces then front, and every material here is
 * DoubleSide and goes transparent for the whole dissolve. So those four meshes are 8 calls
 * at the stage 4 mid-crossing and not 4 -- the doubling P10 measured against a fifth,
 * now-deleted mesh applies to these same four alone, which is what the shell's own draw-call
 * cost is against the whole frame's 30, the same ceiling campus.spec.ts gates stages 1 to 3
 * at.
 *
 * A CUTAWAY ONLY EVER LOWERS THAT. Counted off the parts buildWeldCut() returns and
 * asserted in tests/weldGeometry.test.ts rather than reasoned about. Both the stage 3
 * and the stage 4 keyframe give the same four counts, and the triangles are stage 3's:
 *
 *   none       4   416 tris. walls, roof, towers, bays, as before this prop existed.
 *   roofOff    2   226. walls at 166 -- the eaves lid is 54 of the 220 and goes with
 *                  the roof -- and all five bays.
 *   wallsDown  2   208. The roof, and the shell walls the camera is squarely outside.
 *                  Never fewer than 2 from any camera tried: the grade cap keeps the
 *                  walls mesh alive whatever is dropped, and dropping every bay needs
 *                  one camera to be squarely outside both the facade and a gable.
 *   section    1   112. The near half of the shell is cut off at the hall's centreline,
 *                  and from OUTSIDE every bay is in that half -- they are windows in
 *                  the suite's own perimeter and the suite is wholly on the facade side
 *                  of the plane. From inside, behind the hall, the same plane keeps all
 *                  five, so this is 2 there.
 *
 * The number the e2e gate actually sees is larger, because Campus is still mounted at
 * stages 2 and 3: 9 calls at stage 2 under reduced motion, against that test's
 * ceiling of 12.
 *
 * The same table read off window.__perf in a real browser at stage 3, full motion, with
 * Campus mounted and the composer on -- which is the only measurement that shows the
 * geometry actually leaving the renderer rather than leaving a function's return value:
 * 26 calls and 16,899 triangles at none, 24 and 16,709 at roofOff, 24 and 16,691 at
 * wallsDown, 23 and 16,595 at section, and 26 again on returning to none. The three
 * triangle deltas are 190, 208 and 304, i.e. 416 - 226, 416 - 208 and 416 - 112 exactly,
 * so what the unit tests count and what the renderer submits are the same numbers.
 *
 * THREE TRAPS THIS COMPONENT HAS ALREADY PAID FOR
 * Every material is DoubleSide. The camera passes through this shell, and a FrontSide
 * material culled every interior face and blanked the whole frame at t = 0.7 once.
 * depthWrite goes off below full opacity: a half-transparent mesh that writes depth
 * occludes what is drawn after it, and the shell is at partial opacity for the entire
 * threshold, with the interior fading up behind it.
 * And nothing here keys off the camera. Backface culling, a one-sided plane and a
 * distance-to-camera sign all invert at the frame the camera crosses the wall, which
 * is the frame this dissolve exists for.
 *
 * WHAT THE BAYS ACTUALLY LOOK LIKE, WHICH IS NOT QUITE WHAT THEY ARE CALLED
 * bayGeometry() emits a SOLID box per window, centred on the suite's masonry
 * mid-plane. Two consequences, and both were found in the browser rather than read
 * off the geometry. weldGeometry's header records that the suite's exterior face
 * lands at building u = 26.0 while the ring's east wall is at 25.44, so a facade bay
 * stands 0.56 ft PROUD of the shell: it is a reveal by derivation and a projecting
 * surround by the time it is drawn. The gable bays go the other way -- the gable
 * band's outer face is at v = 71.45 against the ring's 72.15, so they sit 0.7 ft
 * inside the wall. That hides them at stages 2 and 3, where the shell is opaque, and
 * does NOT hide them during the threshold, where nothing writes depth: bedroom B's
 * gable bay is the 8 x 10.75 ft rectangle in the middle of the frame as the camera
 * comes in, which is the opening it is about to pass through.
 *
 * So the bays are painted as openings rather than as masonry. The drawing shows an
 * opening as a hole in the ink, which is the ground colour, `void`; in daylight a
 * window seen from outside reads darker than the brick around it, and slate is the
 * only dark the day palette has. Neither end asserts anything the model does not
 * contain -- no sash, no sandstone architrave, no glass. An earlier attempt used
 * lineHi at the scan end and masonry at the daylight end, and it was wrong twice
 * over: MASTER.md reserves lineHi for EDGES and these are 86 sq ft fills, so the
 * facade grew four pale panels that read as delamination rather than as windows.
 *
 * THE CUTAWAY, AND WHY THE SHELL HAD TO LEARN ABOUT IT
 * P6 shipped four cutaway modes that could not work. hiddenWalls() took down the
 * interior's own bands and Suite.tsx dropped the ceiling plate, but this component did
 * not read `cutaway` at all, so from stage 3 the dollhouse view was an opaque 1872
 * brick shell and furniture editing stayed gated to stage 5 -- where the camera stands
 * inside bedroom B and bedroom A's furniture projects off screen entirely.
 * Experience.tsx recorded both, and docs/phases/P6-UI.md's findings record the second.
 *
 * What each mode takes off the shell:
 *
 *   none       nothing.
 *   roofOff    the roof, the two roof features standing on it, and the eaves LID --
 *              extrude() closes the shell with a cap at 60 ft, and leaving that up
 *              would swap the gable for a flat floor over the whole footprint and show
 *              exactly as much of the plan as the roof did. weldGeometry's header has
 *              the argument.
 *   wallsDown  all of the above, plus every shell wall the camera is squarely outside,
 *              plus the window bays those walls carried -- a bay left standing in a
 *              dropped wall is a slab of slate hanging in the hole it was a window in.
 *   section    all of roofOff, plus everything on the camera's side of the hall's
 *              centreline, the plane cutaway.ts derives and the interior already cuts
 *              on. The two ring edges the plane crosses are CUT there rather than kept
 *              whole the way an interior band is, and weldGeometry has the 7.23 ft of
 *              wall stub that measures the difference.
 *
 * WHICH ONE IS THE DOLLHOUSE, WHICH IS NOT THE ONE IT SOUNDS LIKE. From the stage 3
 * keyframe it is SECTION. wallsDown looks like the mode for the job and is not: that
 * camera sits 150 ft down the building from the suite, so the near-wall test drops 9
 * east-facing edges that all lie south of every window and leaves the facade in front of
 * the rooms standing -- a hole into the empty half of the building. hiddenWalls() hides
 * no interior band from there either, so the two cuts at least agree that nothing has
 * opened. section takes the whole east half of the shell and the interior's own w1..w6
 * with it, which is the view furniture could be edited from. edgeMargin() in
 * weldGeometry carries the measurement and the reason it is not a bug to be loosened.
 *
 * WHERE THE CAMERA COMES FROM, AND THE STALL THIS ALREADY PAID FOR ONCE
 * useFrame's own camera, which is the only place it exists -- CameraRig writes straight
 * onto the three.js camera and there is no store field to subscribe to. Recomputed only
 * after a QUARTER FOOT of movement, which is not an optimisation: weldCut()'s two
 * camera-driven branches walk buildSuite() and buildWalls() through bays(), and
 * docs/phases/P6-UI.md records hiddenWalls() in a bare useFrame as a real stall, where a
 * cutaway mode change stopped responding to input for longer than a 30 s test would
 * wait. A quarter foot is half the drag grid, so no crossing that matters is skipped,
 * and cutaway.ts's WALL_HOLD_FT hysteresis -- which weldCut() applies to the shell as
 * well -- is what handles a camera creeping across a wall plane a hair at a time.
 * useHiddenWalls() in Suite.tsx is the precedent and this is deliberately the same
 * shape, down to forgetting the remembered position when the mode changes so a mode
 * switch on a parked camera still recomputes.
 *
 * WHY THE ROOF FEATURES WEAR THE ROOF'S MATERIAL
 * Their identity is inferred and contested -- TOWER_CONTROLS.identification carries
 * the argument, and any user-visible label must be TOWER_CONTROLS.name, "Roof
 * feature", never "staircase tower". Giving them a material of their own would take
 * a side: slated lanterns and clustered brick chimney shafts are both live readings
 * and no source distinguishes them. So they take the slate they stand on, which
 * commits to nothing beyond what they are called.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { type SuiteParams } from "@/geo/rooms";
import { useStore } from "@/state/store";
import { type CutawayMode } from "./cutaway";
import { materials } from "./materials";
import {
  buildWeldCut,
  NO_CUT,
  ROOF_CUT,
  sameCut,
  TOWER_DEFAULTS,
  weldCut,
  type TowerParams,
  type WeldCut,
} from "./weldGeometry";
import { REDUCED_CUT } from "./stages";

/**
 * The three shell materials, cloned once.
 *
 * Clones for the reason Suite.tsx gives: materials() hands out singletons so there
 * is one shader program and one grain texture per process, but `opacity` is per-frame
 * threshold state and `side` is a fact about where the camera stands. Writing either
 * onto the shared object would push this dissolve into every other consumer. Cloned
 * on mount, never per render, and disposed on unmount.
 *
 * P11 decision 9 retires the seam these used to carry (`attachPaletteSeam`,
 * `SCAN_ROOF`): there is no second palette left to hand off from, so each clone just
 * wears materials()'s own daylight colour, unconditionally.
 */
function useShellPalette(opacity: number) {
  const pal = useMemo(() => {
    const m = materials();
    const next = {
      walls: m.brick.clone(),
      roof: m.slate.clone(),
      // Slate again, and not because these are slated: it is the day palette's only
      // dark, and an opening reads dark from outside. See the note on the bays above.
      bays: m.slate.clone(),
    };
    for (const x of Object.values(next)) x.side = THREE.DoubleSide;
    return next;
  }, []);

  useEffect(() => {
    return () => {
      for (const x of Object.values(pal)) x.dispose();
    };
  }, [pal]);

  useMemo(() => {
    for (const x of Object.values(pal)) {
      x.transparent = opacity < 1;
      x.opacity = opacity;
      x.depthWrite = opacity > 0.99;
    }
  }, [pal, opacity]);

  return pal;
}

/**
 * What the cutaway is currently taking off the shell, from where the camera actually is.
 *
 * Deliberately the same shape as Suite.tsx's useHiddenWalls(), down to the quarter foot
 * and the dropped position on a mode change, because it is the same problem one layer
 * out: the camera exists only on the three.js camera object, so it has to be read in a
 * useFrame, and what must not happen per frame is a React render. The header on this
 * component records the stall that bought the throttle.
 *
 * NOT gated on whether the shell is drawn, which is a choice and not an oversight.
 * Suite.tsx runs its hook whatever the interior's opacity is, and gating this one would
 * need `at.current` cleared again the moment the shell came back -- otherwise a parked
 * camera would show a full shell in a cutaway mode until something moved. One frame of
 * uncut brick at the stage 4/5 crossing is worse than a walk of bays() nobody sees.
 *
 * ONE HOOK, ONE ANSWER. Through P10 this cut was also handed down to <Threshold>, so that
 * the seam it drew rode the geometry the shell was actually showing rather than a second,
 * independently-timed answer -- weldCut()'s WALL_HOLD_FT hysteresis is path-dependent, so
 * two hooks whose first sample fell at different points of the flight could disagree about
 * a wall the camera is loitering beside. P11 decision 9 deletes Threshold.tsx along with the
 * seam, so this is now the only consumer of the cut it computes -- the risk the sharing used
 * to guard against no longer has a second hook to apply to, and the hook itself is unchanged.
 */
function useWeldCut(mode: CutawayMode, params: SuiteParams): WeldCut {
  const [cut, setCut] = useState<WeldCut>(NO_CUT);
  const live = useRef<WeldCut>(NO_CUT);
  const at = useRef<[number, number, number]>([NaN, NaN, NaN]);

  useFrame(({ camera }) => {
    // The two modes that need no camera, settled without one. Both answers are module
    // constants, so this costs one comparison per frame and allocates nothing -- the
    // fast path Suite.tsx takes for the same two modes.
    if (mode === "none" || mode === "roofOff") {
      const next = mode === "none" ? NO_CUT : ROOF_CUT;
      if (live.current !== next) {
        live.current = next;
        setCut(next);
      }
      return;
    }

    const p = camera.position;
    const [x, y, z] = at.current;
    if (Math.abs(p.x - x) < 0.25 && Math.abs(p.y - y) < 0.25 && Math.abs(p.z - z) < 0.25) return;
    at.current = [p.x, p.y, p.z];

    const next = weldCut(mode, [p.x, p.y, p.z], params, live.current);
    if (sameCut(next, live.current)) return;
    live.current = next;
    setCut(next);
  });

  // A mode change has to recompute even if the camera has not moved an inch. Same
  // reason Suite.tsx drops its remembered position: without this, switching from
  // wallsDown to section while parked leaves the previous mode's shell standing.
  useEffect(() => {
    at.current = [NaN, NaN, NaN];
  }, [mode, params]);

  return cut;
}

/**
 * Weld's exterior.
 *
 * `visible` and `opacity` are the props Experience already passes and they have not
 * moved. The other two are optional and defaulted, so that P6 can drive the two
 * inferred roof-feature dimensions from a slider without this signature changing
 * again: `towers` is TowerParams, defaulting to the inferred pair weld.json records.
 *
 * `params` falls back to the store rather than to DEFAULT_PARAMS. The bays come from
 * the same opening list the interior is built from, so they have to see the same
 * SuiteParams the interior does; defaulting to the constants would put the facade's
 * windows somewhere the rooms' windows are not the moment a dimension slider moved,
 * and it would take an edit to Experience.tsx to prevent that.
 *
 * `cutaway` falls back to the store for exactly that reason and not for a new one.
 * Experience.tsx already reads the mode and hands it to <Suite>; the shell has to be cut
 * by the SAME mode or the two disagree, and taking it off the store here is what makes
 * that true without a second prop at a call site this component cannot edit. The prop
 * stays optional so a test -- or a future Experience that would rather pass it down
 * beside Suite's -- can drive it directly, which is the shape `params` already has.
 */
export function WeldExterior({
  visible,
  opacity,
  params,
  towers = TOWER_DEFAULTS,
  cutaway,
}: {
  visible: boolean;
  opacity: number;
  params?: SuiteParams;
  towers?: TowerParams;
  cutaway?: CutawayMode;
}) {
  const reduced = useStore((s) => s.reducedMotion);
  const storeParams = useStore((s) => s.params);
  const suiteParams = params ?? storeParams;
  const storeCutaway = useStore((s) => s.cutaway);
  const mode = cutaway ?? storeCutaway;

  const cut = useWeldCut(mode, suiteParams);
  const geo = useMemo(() => buildWeldCut(suiteParams, towers, cut), [suiteParams, towers, cut]);

  useEffect(() => {
    return () => {
      for (const g of Object.values(geo)) g?.dispose();
    };
  }, [geo]);

  /**
   * Reduced motion is a different regime, not the same one with the animation
   * switched off. The shell is drawn FULLY OPAQUE with depth writes on until the
   * crossover and not drawn at all after it: no partial-opacity frames, no sort
   * against the interior. That is the jump-cut MASTER.md asks for.
   *
   * REDUCED_CUT is stages.ts's number and is imported rather than restated, which is
   * what the note on it there asks for. It is the midpoint of the crossing, and
   * stages.ts applies it to `t` to make the shell opacity binary before it ever gets
   * here -- so on the current call site this line is a guard rather than a second
   * cut, and the two cannot separate because both are the same constant applied to
   * the same crossing. It is kept because the guarantee belongs to the component
   * that owns the mesh: a call site that forgets thresholdOpacity's third argument
   * gets a jump cut anyway instead of a dissolve nobody asked for.
   *
   * P11 decision 9 removes the paragraph this docblock used to carry about the
   * palette never reaching brick under reduced motion: there is no palette left to
   * reach, since the shell wears brick and slate unconditionally now. What survives
   * here is the dissolve alone -- opaque, then gone, at this one threshold.
   */
  const shell = reduced ? (1 - opacity < REDUCED_CUT ? 1 : 0) : opacity;

  const pal = useShellPalette(shell);

  if (shell <= 0.001) return null;

  return (
    <group visible={visible}>
      {/* A part the cutaway removed is not mounted at all. An empty geometry would be
          the shorter branch and it is not free: three's renderer only skips a draw when
          the count is NEGATIVE, so a zero-length index still reaches gl.drawElements and
          still spends one of the eight calls this file is budgeted. weldGeometry's
          header carries the measurement. */}
      {geo.walls ? <mesh geometry={geo.walls} material={pal.walls} /> : null}
      {geo.roof ? <mesh geometry={geo.roof} material={pal.roof} /> : null}
      {geo.towers ? <mesh geometry={geo.towers} material={pal.roof} /> : null}
      {geo.bays ? <mesh geometry={geo.bays} material={pal.bays} /> : null}
    </group>
  );
}
