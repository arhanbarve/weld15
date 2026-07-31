"use client";

/**
 * The threshold: one horizontal seam that travels down Weld's skin while the shell
 * dissolves, and the bright line that rides on it.
 *
 * This module owns the seam and nothing else. WeldExterior imports sweepY() and
 * attachPaletteSeam() for the shell's own materials and mounts <Threshold> for the
 * line, so there is exactly one definition of where the seam is at a given progress.
 *
 * WHY THE SWEEP RUNS IN WORLD Y AND NOT ALONG THE BUILDING'S v
 * The P4 brief names the prop `axis: "v"` and in the same paragraph suggests "an
 * alpha ramp driven by world Y", and those are two different effects. A plane
 * perpendicular to the building's v axis is PARALLEL to the north gable -- the gable
 * face is one v to within the ring's 0.15 ft wobble -- so such a sweep takes the
 * whole gable in a single frame and there is no sweep across it at all. The camera
 * enters through that gable, so it is the one face that must be crossed rather than
 * switched. World Y crosses it: the seam enters at the ridge, runs down the gable
 * triangle, over the eaves and down the wall. Hence a `progress` and no axis prop:
 * there is only one axis this can be.
 *
 * WHY onBeforeCompile AND NOT clippingPlanes
 * Three reasons, in order of how much they decide it. A clipping plane can only
 * remove, and the seam here has to RECOLOUR (see WeldExterior's palette note), which
 * no plane does. Renderer clipping is switched on by `localClippingEnabled` on the
 * WebGLRenderer, which lives in Experience.tsx's <Canvas gl={...}> -- a file this
 * module must not touch, so a clipping implementation would not work until someone
 * else edited someone else's file. And a plane cuts every material that lists it,
 * which at the threshold includes an interior that is fading UP while this fades
 * down; two ramps sharing one cut is how one of them ends up wrong.
 *
 * WHY THE LINE IS ITS OWN MESH AND NOT PART OF THE SHELL'S SHADER
 * The obvious saving is to brighten the shell's own fragments at the seam and mount
 * nothing here. It does not work: the shell is at partial opacity for the whole
 * threshold and reaches zero at t = 0.7, so a line drawn in the shell's material
 * fades out exactly when the sweep is at its most useful. This mesh is additive and
 * carries its own alpha, so the line holds one brightness from the first frame to
 * the last while the surface under it disappears. It is also the only thing on
 * screen that belongs to neither palette -- it is the instrument, not the building
 * -- which is why it stays SCAN.lineHi throughout.
 *
 * WHY THE SURFACE IS REBUILT HERE
 * The line rides the walls and the roof, which is the same geometry WeldExterior
 * mounts. Taking those buffers as props would save the rebuild and it is not what the
 * sweep needs: it needs them MERGED, which is what keeps this to one mesh, and a merge
 * of two geometries this component did not allocate is two owners for one buffer. So
 * the surface is built here, out of buildWeldCut(), whose bays and roof features are
 * built and thrown away -- the ugly part -- for about sixty quads of duplicated vertex
 * data. What IS taken as a prop is the cut, which is four fields and no buffers.
 *
 * It is no longer cached at module scope, and the cutaway is why. It was, on the argument
 * that neither the walls nor the roof depends on SuiteParams so nothing could invalidate
 * them; a cut can, and does. The surface is memoised on the cut instead and disposed when
 * that changes, which is what WeldExterior already does with its own four parts.
 *
 * WHERE THE CUT COMES FROM, AND WHY IT IS A REQUIRED PROP
 * The sweep has to be built from the geometry the shell is ACTUALLY SHOWING. It was built
 * from the full buildWeld() and knew nothing about the cut, so with a cutaway active the
 * seam and its line rode a gable and walls that were not being drawn: at mode roofOff and
 * progress 0.2 the line was a lit gable standing in the sky over a building whose roof was
 * off. Cosmetic, and visible only while 0 < progress < 1, which is why it outlived the
 * commit that taught the shell about the cut.
 *
 * So `cut` comes down from WeldExterior, which has already computed it for its own four
 * meshes: one hook, one useFrame, one answer for the whole building. REQUIRED and not
 * optional, because a fallback that quietly recomputed is a fallback that can quietly
 * disagree, and there is no second mounter to accommodate -- WeldExterior is the only
 * place this component appears, checked across src, app and tests.
 *
 * The two things one answer buys, both of which a second copy of the hook could only
 * document. weldCut()'s wallsDown branch is HYSTERETIC -- cutaway.ts's WALL_HOLD_FT holds a
 * dropped wall down until the camera is well back inside it -- so it is PATH-DEPENDENT, and
 * two instances whose first sample fell at different points of the flight could hold
 * opposite answers about a wall the camera is loitering beside. And the SuiteParams the cut
 * is derived from are WeldExterior's, which are a defaulted prop there and the store field
 * here; they agree on the current call site and would not for a caller that passed its own.
 * The section plane is derived from them, so that was a latent defect and not a style
 * difference.
 *
 * AND THE PARAMS ARE GONE FROM HERE ENTIRELY, which was the last of it. They only ever
 * reached buildWeldCut() to build the bays, and the bays are thrown away: the two parts the
 * sweep actually rides are shellGeometry() and gableRoof(), and both are marched from
 * weld.json's ring rather than from any dimension. That was asserted in prose here and in
 * WeldExterior's header, which is not evidence, so it is now measured in
 * tests/weldGeometry.test.ts -- "the params reach the bays and nothing else" builds the
 * shell twice across ten differing dimensions and compares every attribute and the index:
 * walls, roof and towers come out byte-identical, and bays do not, so the comparison is not
 * measuring nothing. That test is what makes the store subscription safe to delete, and it
 * is what will fail if someone later makes the shell depend on a dimension.
 *
 * The saving is a real one rather than a tidy-up: with params in the memo's dependencies,
 * every drag of any of the fifteen dimension sliders rebuilt and re-merged the whole shell
 * mid-crossing to produce the identical geometry.
 *
 * The merge is what keeps it to ONE draw call. walls and roof carry the same two
 * attributes (position and normal, both Float32, both indexed), which is what
 * mergeBufferGeometries requires, and it copies the floats through unchanged -- so
 * the line's vertices are bit-identical to the shell's and the two are exactly
 * coplanar. That is why the line needs no polygonOffset: at equal depth three's
 * default LessEqualDepth passes, and the line draws on the surface rather than
 * fighting it.
 *
 * ONE MESH IS NOT ONE SUBMISSION, and the difference was measured off window.__perf while
 * gating this: three renders a transparent DoubleSide material in TWO passes, back faces
 * then front, so this mesh costs 2 of the frame's calls and so does each of the shell's
 * three while the dissolve has them transparent. Stage 4 mid-crossing reads 27 calls at
 * mode none -- 17 for the composer and the fixtures, 10 for five meshes at two passes
 * each -- against the 4 that WeldExterior's header records under reduced motion, where the
 * shell is opaque and this mesh does not exist. The merge is still what keeps the sweep to
 * one mesh; what it cannot do is make a transparent double-sided mesh cost one call.
 *
 * THE TRAP THE CAMERA SETS
 * The camera goes THROUGH this shell. So the seam is a function of world Y and of
 * nothing else: no distance to the camera, no sign of a dot product against the view
 * direction, no backface test. Every one of those inverts as the camera crosses the
 * wall, which is the exact frame the effect exists for. DoubleSide for the same
 * reason -- with DoubleSide and no depth write the line is drawn on the far wall as
 * well as the near one, so it reads twice as bright where the building overlaps
 * itself. That is left alone: a scan that shows you both sides of a surface is
 * telling the truth about what it is.
 *
 * A TRAP IN THE INJECTION ITSELF
 * Material.customProgramCacheKey() defaults to onBeforeCompile.toString(), so two
 * materials whose injected SOURCE is identical share one compiled program and only
 * their uniforms differ. That is what is wanted here -- WeldExterior's three shell
 * materials differ only in two colour uniforms -- but it means the injected source
 * must never depend on a captured value. Bake constants from module scope, as
 * glsl() does below, and pass anything per-material as a uniform. A GLSL string
 * built from a closure variable would silently get the first material's program.
 */

import { useEffect, useMemo } from "react";
import * as THREE from "three";
// three-stdlib exports the older name; three's own copy calls it mergeGeometries.
import { mergeBufferGeometries } from "three-stdlib";
import { useStore } from "@/state/store";
import { WELD } from "@/geo/place";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import { SCAN } from "./materials";
import {
  buildWeldCut,
  TOWER_CONTROLS,
  TOWER_DEFAULTS,
  type WeldCut,
} from "./weldGeometry";

/**
 * Half-width of the crossing, ft: the distance either side of the seam over which
 * one palette gives way to the other and the line is at full strength.
 *
 * Set against the BUILDING's scale rather than against pixels, deliberately. Campus
 * multiplies its stroke widths by devicePixelRatio because its lines are screen-space
 * quads at a fixed distance; this line is painted on a surface the camera closes from
 * 38 ft to about 9 ft during the sweep, so no pixel figure is right for more than one
 * frame of it. Measured over that run at 1280 x 800: three quarters of a foot is a
 * 16 px line where the sweep starts and a band across a third of the frame by the
 * time the camera is at the wall. That widening is not a defect to tune away -- what
 * the last second of the threshold IS is a plane of light passing through you -- but
 * it is why the first figure tried here, a foot with a 4 ft glow, put 16% of the
 * frame at near-white with the bloom pass still to come.
 */
const SWEEP_FEATHER = 0.75;

/** How far the line's glow reaches past the crossing, ft. */
const SWEEP_GLOW = 3;

/** How much of the line's brightness the glow carries. */
const GLOW_STRENGTH = 0.25;

/**
 * Where the seam starts, ft above grade: clear of everything the shell can contain.
 *
 * The ridge plus the roof-feature slider's MAXIMUM rise, not its current value. The
 * seam recolours the roof features as well as the roof, so if it began below their
 * caps they would already be in daylight at progress 0, and P6's slider must not be
 * able to cause that. The price is that at the inferred 6.5 ft rise the seam falls
 * 5.5 ft -- 5.6% of the sweep -- before it touches anything, which is cheaper than a
 * bound that moves with a control.
 */
export const SWEEP_TOP = WELD.ridge + TOWER_CONTROLS.heightAboveRidge.max;

/** Where the seam ends: a feather below grade, so nothing is left half-crossed. */
export const SWEEP_BOTTOM = -SWEEP_FEATHER;

/** The first and last of the sweep, over which the line fades in and out. */
const LINE_FADE = 0.06;

/**
 * The seam's height for a given dissolve progress.
 *
 * Reduced motion returns SWEEP_TOP, which means "nothing has been crossed yet", and
 * that is the honest answer rather than a special case: with no sweep there is no
 * seam, so the shell keeps the scan palette for the whole of its (undissolved) life
 * and the crossing happens in the same frame as the cut.
 */
export function sweepY(progress: number, reduced: boolean): number {
  if (reduced) return SWEEP_TOP;
  const p = Math.min(1, Math.max(0, progress));
  return SWEEP_TOP + (SWEEP_BOTTOM - SWEEP_TOP) * p;
}

/** How strongly the line reads, so it does not pop in at progress 0. */
function lineFade(progress: number): number {
  return Math.min(1, Math.max(0, Math.min(progress, 1 - progress) / LINE_FADE));
}

/** The one piece of state both halves of the effect share. */
export type SweepUniforms = { uSweepY: { value: number } };

export function sweepUniforms(): SweepUniforms {
  return { uSweepY: { value: SWEEP_TOP } };
}

/** GLSL has no implicit int-to-float promotion, so a baked constant needs a point. */
const glsl = (n: number): string => n.toFixed(4);

/** The varying carrying world height into the fragment stage. */
const Y = "vSweepWorldY";

/**
 * Put world height in front of the fragment shader and splice `body` in after the
 * diffuse colour is established.
 *
 * The height is taken after <project_vertex> rather than after <begin_vertex> so it
 * is read from `transformed` once morphing and skinning have had their say. Neither
 * applies to this geometry, but anchoring to the later chunk costs nothing and does
 * not quietly become wrong if it ever does. modelMatrix is applied even though these
 * geometries are already in world space with an identity model matrix, so that a
 * group transform added above them later moves the seam with the building.
 */
function inject(
  shader: { vertexShader: string; fragmentShader: string },
  declarations: string,
  body: string,
): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\nvarying float ${Y};`)
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n  ${Y} = ( modelMatrix * vec4( transformed, 1.0 ) ).y;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>\nvarying float ${Y};\nuniform float uSweepY;\n${declarations}`,
    )
    .replace("#include <color_fragment>", `#include <color_fragment>\n${body}`);
}

/**
 * Make a material carry the palette seam: the scan colour below the line, its own
 * colour above it, and nothing in between but the crossing itself.
 *
 * The daylight end is read off the material rather than passed in, so the caller
 * states one colour and the other stays wherever materials() put it -- there is no
 * second copy of the brick or the slate hex in the exterior.
 *
 * A step and not a fade. The mix() spans 1.5 ft of wall, which is the seam's own
 * width; every fragment further from the line than that is wholly in one palette or
 * wholly in the other. See WeldExterior for why that distinction is the whole point.
 */
export function attachPaletteSeam(
  m: THREE.MeshStandardMaterial,
  u: SweepUniforms,
  scan: THREE.ColorRepresentation,
): void {
  const scanColor = new THREE.Color(scan);
  const dayColor = m.color.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSweepY = u.uSweepY;
    shader.uniforms.uScanColor = { value: scanColor };
    shader.uniforms.uDayColor = { value: dayColor };
    inject(
      shader,
      "uniform vec3 uScanColor;\nuniform vec3 uDayColor;",
      `float swept = smoothstep( uSweepY - ${glsl(SWEEP_FEATHER)}, uSweepY + ${glsl(
        SWEEP_FEATHER,
      )}, ${Y} );
  diffuseColor.rgb = mix( uScanColor, uDayColor, swept );`,
    );
  };
  m.needsUpdate = true;
}

type LineUniforms = SweepUniforms & { uLineFade: { value: number } };

/**
 * The line itself: unlit, additive, and keyed off the same seam height.
 *
 * MeshBasicMaterial because this is light rather than a surface -- there is nothing
 * for a normal to do -- and toneMapped off so the exposure curve does not put the
 * scanner's own brightness back into the building's range. fog off for the same
 * reason. depthWrite off because it sits exactly on a surface it must not occlude.
 */
function scanlineMaterial(u: LineUniforms): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color: SCAN.lineHi,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSweepY = u.uSweepY;
    shader.uniforms.uLineFade = u.uLineFade;
    inject(
      shader,
      "uniform float uLineFade;",
      `float dSweep = abs( ${Y} - uSweepY );
  float core = 1.0 - smoothstep( 0.0, ${glsl(SWEEP_FEATHER)}, dSweep );
  float glow = 1.0 - smoothstep( ${glsl(SWEEP_FEATHER)}, ${glsl(SWEEP_GLOW)}, dSweep );
  diffuseColor.a *= uLineFade * max( core, ${glsl(GLOW_STRENGTH)} * glow );`,
    );
  };
  return m;
}

/**
 * The walls and the roof the cutaway left standing, as one geometry.
 *
 * Null when there is nothing left to ride, which the type allows and this cut cannot
 * currently reach: shellGeometry() always keeps the grade cap, so `walls` survives every
 * mode. The branch is here because the geometry says it can be gone, not because a mode
 * has been found that does it.
 *
 * `towers` is TOWER_DEFAULTS and it does not matter what it is: the roof features are not
 * part of the sweep, so that part is built and thrown away with the bays. P6's slider can
 * move them without invalidating anything here.
 */
/**
 * The surface the line is drawn on: the shell's walls and roof, merged.
 *
 * NO PARAMS ARGUMENT, and DEFAULT_PARAMS is not a stand-in for the live ones -- it is the
 * argument buildWeldCut() requires for a part this function discards. The header explains
 * at length and tests/weldGeometry.test.ts proves it: walls, roof and towers are
 * byte-identical across ten changed dimensions, and only the bays move. Passing the live
 * params instead would be identical output at the cost of putting them in the caller's memo.
 */
function scanlineSurface(cut: WeldCut): THREE.BufferGeometry | null {
  const masses = buildWeldCut(DEFAULT_PARAMS, TOWER_DEFAULTS, cut);
  const ride = [masses.walls, masses.roof].filter((g): g is THREE.BufferGeometry => g !== null);
  const merged = ride.length > 0 ? mergeBufferGeometries(ride, false) : null;
  if (ride.length > 0 && !merged) {
    throw new Error("Threshold: mergeBufferGeometries returned null for the sweep surface");
  }
  merged?.computeBoundingSphere();
  // The parts were copied, and the two the sweep does not ride were never wanted.
  for (const g of Object.values(masses)) g?.dispose();
  return merged;
}

/**
 * The scanline crossing Weld as its shell dissolves.
 *
 * `progress` is the dissolve's own ramp -- stages.ts's thresholdOpacity() shell
 * value read the other way up, so 0 is an intact shell and 1 a gone one. It is
 * passed down from WeldExterior rather than recomputed from the store, so the line
 * cannot be a frame out of step with the surface it is drawn on. `cut` arrives the same
 * way and for the same reason, one layer further out: see the header.
 */
export function Threshold({ progress, cut }: { progress: number; cut: WeldCut }) {
  const reduced = useStore((s) => s.reducedMotion);

  /**
   * Whether the line is drawn at all, and therefore whether its surface is worth having.
   *
   * Two reasons in one flag, and both were already the early returns at the bottom of this
   * function. Reduced motion has no line, because it has no sweep for one to ride: the
   * shell is opaque, then it is gone at stages.ts's REDUCED_CUT, and MASTER.md asks that
   * crossing to be one cut -- a stationary line would be decoration asserting a movement
   * that is not happening. And outside the crossing there is nothing to draw, where a
   * mounted mesh at zero alpha still costs its draw calls.
   *
   * Hoisted above the memos so that the GEOMETRY is skipped as well, not just the mesh,
   * which is where the saving is: ungated, a stage-3 orbit in wallsDown would rebuild a
   * surface nobody sees every time the cut moved, and reduced motion -- which never mounts
   * this mesh at all -- would do it for the whole of stages 2 to 4. The cut itself is free
   * to have, because WeldExterior computes it for its own four meshes regardless.
   */
  const drawn = !reduced && progress > 0 && progress < 1;

  const { material, uniforms } = useMemo(() => {
    const u: LineUniforms = { ...sweepUniforms(), uLineFade: { value: 0 } };
    return { material: scanlineMaterial(u), uniforms: u };
  }, []);

  // Rebuilt when the cut changes and disposed with it, which is the bargain the module
  // cache used to avoid -- see the header. WeldExterior's own parts are handled the same
  // way, and for the same reason: these are this component's buffers and nobody else's.
  const geometry = useMemo(
    () => (drawn ? scanlineSurface(cut) : null),
    [drawn, cut],
  );

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useEffect(() => {
    if (!geometry) return;
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useMemo(() => {
    uniforms.uSweepY.value = sweepY(progress, reduced);
    uniforms.uLineFade.value = lineFade(progress);
  }, [uniforms, progress, reduced]);

  if (!drawn || !geometry) return null;

  // renderOrder above the shell: both are transparent and neither writes depth
  // during the threshold, so the order in the transparent pass is what decides
  // whether the line lands on the wall or under it.
  return <mesh geometry={geometry} material={material} renderOrder={1} />;
}
