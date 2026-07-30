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
 * triangle, over the eaves and down the wall. Hence `{ progress }` and no axis prop:
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
 * mounts. Taking it as a prop would save the rebuild, but the phase brief fixes this
 * component's props at `{ progress }` and a component whose only required input is a
 * number can be mounted anywhere; so the surface is built once per process and
 * cached at module scope, the same bargain materials() strikes. The cost is one extra
 * buildWeld() at first mount -- whose bays are built and thrown away, which is the
 * ugly part -- and about sixty quads of duplicated vertex data. Neither is worth a
 * looser interface.
 *
 * The merge is what keeps it to ONE draw call. walls and roof carry the same two
 * attributes (position and normal, both Float32, both indexed), which is what
 * mergeBufferGeometries requires, and it copies the floats through unchanged -- so
 * the line's vertices are bit-identical to the shell's and the two are exactly
 * coplanar. That is why the line needs no polygonOffset: at equal depth three's
 * default LessEqualDepth passes, and the line draws on the surface rather than
 * fighting it.
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
import { SCAN } from "./materials";
import { buildWeld, TOWER_CONTROLS } from "./weldGeometry";

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

let surface: THREE.BufferGeometry | null = null;

/**
 * The walls and the roof as one geometry, built once for the life of the process.
 *
 * Neither depends on SuiteParams -- buildWeld's params only reach the bays -- so
 * there is nothing for a slider to invalidate and no reason to rebuild this per
 * mount. Not disposed for the same reason materials() is not: the next mount would
 * find a disposed buffer.
 */
function scanlineSurface(): THREE.BufferGeometry {
  if (surface) return surface;
  const masses = buildWeld();
  const merged = mergeBufferGeometries([masses.walls, masses.roof], false);
  if (!merged) throw new Error("Threshold: mergeBufferGeometries returned null for the sweep surface");
  merged.computeBoundingSphere();
  // The parts were copied, and the two the sweep does not ride were never wanted.
  for (const g of Object.values(masses)) g.dispose();
  surface = merged;
  return surface;
}

/**
 * The scanline crossing Weld as its shell dissolves.
 *
 * `progress` is the dissolve's own ramp -- stages.ts's thresholdOpacity() shell
 * value read the other way up, so 0 is an intact shell and 1 a gone one. It is
 * passed down from WeldExterior rather than recomputed from the store, so the line
 * cannot be a frame out of step with the surface it is drawn on.
 */
export function Threshold({ progress }: { progress: number }) {
  const reduced = useStore((s) => s.reducedMotion);

  const { geometry, material, uniforms } = useMemo(() => {
    const u: LineUniforms = { ...sweepUniforms(), uLineFade: { value: 0 } };
    return { geometry: scanlineSurface(), material: scanlineMaterial(u), uniforms: u };
  }, []);

  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  useMemo(() => {
    uniforms.uSweepY.value = sweepY(progress, reduced);
    uniforms.uLineFade.value = lineFade(progress);
  }, [uniforms, progress, reduced]);

  // Reduced motion has no line, because it has no sweep for one to ride: the shell
  // is opaque, then it is gone at stages.ts's REDUCED_CUT, and MASTER.md asks that
  // crossing to be one cut. A stationary line would be decoration asserting a
  // movement that is not happening.
  if (reduced) return null;
  // Outside the threshold there is nothing to draw, and a mounted mesh at zero alpha
  // still costs its draw call.
  if (progress <= 0 || progress >= 1) return null;

  // renderOrder above the shell: both are transparent and neither writes depth
  // during the threshold, so the order in the transparent pass is what decides
  // whether the line lands on the wall or under it.
  return <mesh geometry={geometry} material={material} renderOrder={1} />;
}
