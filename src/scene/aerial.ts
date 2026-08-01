"use client";

/**
 * Sample a georeferenced plate by WORLD POSITION, on top of a lit standard material.
 *
 * This is the campus massing's roof skin: 10b photographs the roofs instead of leaving them a
 * flat translucent colour, and does it without giving up Lighting.tsx's shading -- the sun's
 * direction is the whole reason the campus reads as three-dimensional rather than as coloured
 * shapes.
 *
 * WHY onBeforeCompile AND NOT A ShaderMaterial. A raw ShaderMaterial gives up the shadow map
 * along with the standard lighting model, and the massing has to stay lit. Threshold.tsx's
 * `attachPaletteSeam` solves the identical problem the identical way -- a georeferenced or
 * altitude-driven term spliced into a MeshStandardMaterial's fragment shader -- and is the
 * precedent this file mirrors exactly. This is the second consumer of that idiom, not a new one.
 *
 * WHICH PLATE, AND THIS IS MEASURED. L4 is 1,600 x 1,600 ft at 0.52 ft per texel. campus.json's
 * 36 buildings span x -551.0..597.5 and y -649.6..618.8, so the whole campus sits inside L4 with
 * 150.4 ft of margin on its tightest side (the south, y minimum) -- asserted in
 * tests/imagery.test.ts rather than trusted, because a building whose roof sampled outside the
 * plate would clamp to an edge texel and come out as a smear.
 *
 * THE UV IS (x - minX) / width AND (-z - minY) / height, matching Ground.tsx's
 * `position={[quad.cx, 0, -quad.cy]}`: the plane's +y becomes world -z after its rotation, and
 * world -z is north (place.ts). GETTING THIS SIGN WRONG MIRRORS THE ROOFS AGAINST THE GROUND
 * THEY STAND ON -- verified against a screenshot before this shipped, not just trusted from the
 * formula, and frames.ts:13-17 warns that a mirror in this project is invisible.
 *
 * ROOF VS WALL. The extrusions have flat roofs (extrude.ts's `push(toThree(p[0], p[1], top), UP)`
 * with `UP = [0, 1, 0]`), so a roof normal is y = 1 exactly and a wall normal y = 0 exactly. The
 * smoothstep between them is therefore a clean split with nothing to tune -- it is there so a
 * future non-flat roof degrades to a blend rather than to a hard line. Walls get the photograph
 * darkened and pulled toward a wall tone, because an aerial plate has no wall pixels at all: the
 * only honest thing to put on a facade is a tone consistent with the roof above it.
 *
 * A TRAP IN THE INJECTION ITSELF, restated from Threshold.tsx because it is inherited rather
 * than re-derived: Material.customProgramCacheKey() defaults to onBeforeCompile.toString(), so
 * two materials whose injected SOURCE is identical share one compiled program and only their
 * uniforms differ. Every literal in the GLSL below is baked at module scope -- nothing here
 * closes over a per-call JS value -- so Campus.tsx's two materials, which differ only in their
 * `uWall` uniform, compile once between them.
 */

import * as THREE from "three";

export type AerialUniforms = {
  uAerial: { value: THREE.Texture | null };
  uMinX: { value: number };
  uMinY: { value: number };
  uWidth: { value: number };
  uHeight: { value: number };
  uWall: { value: THREE.Color };
};

/**
 * One material's uniforms: the plate's extent, fixed at construction from the manifest, and the
 * texture, filled in later once `sharedTexture` hands it back.
 */
export function aerialUniforms(
  wall: THREE.ColorRepresentation,
  extent: { minX: number; minY: number; width: number; height: number },
): AerialUniforms {
  return {
    uAerial: { value: null },
    uMinX: { value: extent.minX },
    uMinY: { value: extent.minY },
    uWidth: { value: extent.width },
    uHeight: { value: extent.height },
    uWall: { value: new THREE.Color(wall) },
  };
}

/** The varyings carrying world position and world normal into the fragment stage. */
const POS = "vAerialWorldPos";
const NRM = "vAerialWorldNormal";

/**
 * Splice world position and world normal into the vertex stage, and `body` into the fragment
 * stage after the diffuse colour is established -- the same anchor point Threshold.tsx's own
 * `inject` uses and for the same reason: AO, vertex colours and every other multiplicative term
 * on `diffuseColor` up to that chunk have already been applied, so this composes with them
 * instead of overwriting whatever ran first.
 *
 * Position is read from `transformed` after `<project_vertex>`, matching Threshold.tsx, so that
 * morphing or skinning (neither of which applies to this geometry, but the chunk order costs
 * nothing to respect) has already had its say. The normal is read straight off the `normal`
 * attribute rather than the shading pipeline's own `objectNormal`/`transformedNormal`, because
 * this needs a WORLD-space normal and every built-in normal chunk in three's standard material
 * produces a VIEW-space one; taking the attribute directly and transforming it by `modelMatrix`
 * is simpler than undoing that. modelMatrix is identity for this project's extruded meshes (no
 * group transform sits above them), but applying it rather than assuming so is what keeps this
 * correct if that ever stops being true, the same argument Threshold.tsx makes about its own use
 * of modelMatrix.
 */
function inject(
  shader: { vertexShader: string; fragmentShader: string },
  declarations: string,
  body: string,
): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\nvarying vec3 ${POS};\nvarying vec3 ${NRM};`)
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n  ${POS} = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n  ${NRM} = normalize( ( modelMatrix * vec4( normal, 0.0 ) ).xyz );`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>\nvarying vec3 ${POS};\nvarying vec3 ${NRM};\n${declarations}`,
    )
    .replace("#include <color_fragment>", `#include <color_fragment>\n${body}`);
}

/**
 * Make a material carry the aerial skin: the plate's photograph on the roof, a wall tone pulled
 * toward a darkened reading of the same photograph on the walls, and a clean split between them.
 */
export function attachAerialSkin(
  material: THREE.MeshStandardMaterial,
  uniforms: AerialUniforms,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAerial = uniforms.uAerial;
    shader.uniforms.uMinX = uniforms.uMinX;
    shader.uniforms.uMinY = uniforms.uMinY;
    shader.uniforms.uWidth = uniforms.uWidth;
    shader.uniforms.uHeight = uniforms.uHeight;
    shader.uniforms.uWall = uniforms.uWall;
    inject(
      shader,
      "uniform sampler2D uAerial;\nuniform float uMinX;\nuniform float uMinY;\nuniform float uWidth;\nuniform float uHeight;\nuniform vec3 uWall;",
      `vec2 aUv = vec2((${POS}.x - uMinX) / uWidth, (-${POS}.z - uMinY) / uHeight);
  vec3 photo = texture2D(uAerial, aUv).rgb;
  float up = smoothstep(0.55, 0.95, clamp(${NRM}.y, 0.0, 1.0));
  vec3 wall = mix(uWall, photo * 0.55, 0.25);
  diffuseColor.rgb *= mix(wall, photo, up) / max(diffuseColor.rgb, vec3(1e-4));`,
    );
  };
  material.needsUpdate = true;
}
