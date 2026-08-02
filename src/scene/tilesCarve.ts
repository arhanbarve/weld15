/**
 * Weld's oriented footprint prism, as injectable GLSL: the fragment discard that removes
 * Google's photogrammetric Weld from the live tiles during the stage 3 -> 4 transit, so the
 * parametric shell (WeldExterior.tsx) is the only Weld on screen once it takes over.
 *
 * docs/phases/P11-PHOTOREAL.md section 2.6: clipping planes cannot express "remove this
 * box" -- a box is a union of complements, not an intersection of half-spaces -- so this is
 * a fragment discard on the tile materials, injected through `onBeforeCompile` the same way
 * P10's Threshold.tsx (retired in P11 decision 9, its seam machinery no longer needed) once
 * did for the shell's own palette seam.
 *
 * THREE-FREE, like geo/frame.ts and geo/frames.ts: no `import * as THREE`. The GLSL is built
 * as plain strings and the injection glue (`applyWeldCarve`) takes a duck-typed shader object
 * -- `{ vertexShader, fragmentShader, uniforms }`, the same shape that retired module's own
 * private `inject()` helper used -- so this module never needs to know what a THREE.Material is. The
 * pure containment math (`carveFactor`) is exported separately so it can be unit tested with
 * plain numbers, no WebGL context required.
 *
 * WHERE THE PRISM COMES FROM
 * Centre: the origin. weld.json's ring and campus.json's origin are both anchored on Weld's
 * own centroid (campus.json meta.origin's own comment says so), and geo/frame.ts's
 * `ecefToSite` maps that same point to world (0, *, 0) by construction ("T translate by
 * -ECEF(WELD_ORIGIN)") -- so no separate centre offset is needed here.
 * Rotation: WELD_AXIS_DEG from geo/frames.ts, 13.2 degrees east of north -- imported rather
 * than restated, since frames.ts is the one place that number is supposed to live.
 * Half-extents: weld.json's own `width_ft_max_at_wings` and `length_ft`, read directly (the
 * same file place.ts already parses for WELD's other dimensions). NOT campus.json's
 * meta.weld.width_ft/length_ft -- weld.json's own sources note flags those two as wrong (54 x
 * 151: "54 was one facade edge, 151 was the rotation-inflated bounding box"). Weld is a
 * dumbbell, not a rectangle, so a box built from its WIDEST point is slightly larger than the
 * true footprint at the waist and gable ends; that is the right direction to be wrong in for
 * a carve whose job is "never leave a sliver of the real building showing," and the ~2 ft
 * feather absorbs the rest. tests/place.test.ts's own numbers (facadeStep, maxSectionLength)
 * confirm the building frame this reuses: siteToBuilding() applied to weld.json's own ring
 * vertices reproduces the u/v figures place.ts's docblocks already cite (e.g. u = 25.4 at
 * v = 72.2 for the ring vertex nearest the north-east corner).
 * Height: grade (0, the same invariant geo/frame.ts's own header measures to within a foot)
 * up to the ridge plus the roof-feature slider's stated maximum rise -- the same reasoning
 * P10's retired Threshold.tsx used for its own SWEEP_TOP ("clear of everything the shell can
 * contain"), computed independently from weld.json's own fields rather than imported from
 * that module, which would have pulled `three` into this module's graph for one constant.
 */

import weld from "@/data/weld.json";
import { WELD_AXIS_DEG } from "@/geo/frames";

/** Duck-typed subset of a three.js compiled shader, matching the retired Threshold.tsx's own `inject()`. */
export type ShaderLike = {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
};

export type CarveUniforms = { uCarve: { value: number } };

/** A fresh uniforms bag, `uCarve` starting at 0 (nothing carved). */
export function carveUniforms(): CarveUniforms {
  return { uCarve: { value: 0 } };
}

const AXIS_RAD = (WELD_AXIS_DEG * Math.PI) / 180;
const COS_A = Math.cos(AXIS_RAD);
const SIN_A = Math.sin(AXIS_RAD);

/** Half the footprint's widest point (the wings), ft. See the header for why this and not campus.json's figure. */
export const HALF_U = weld.meta.width_ft_max_at_wings / 2;

/** Half the footprint's overall length, ft. */
export const HALF_V = weld.meta.length_ft / 2;

/**
 * Clear below grade, ft: no other constant in this project records "how far below the
 * ground a real photogrammetric mesh's own terrain relief might dip near a building", so
 * this is this module's own margin rather than a reused figure. Generous against the ~2 ft
 * feather below it.
 */
const BELOW_GRADE_FT = 5;

/** Ridge plus the roof feature's inferred maximum rise -- see the header. */
export const HEIGHT_MAX = weld.meta.ridge_height_ft + weld.meta.towers.height_above_ridge_ft_estimate;

export const HEIGHT_MIN = -BELOW_GRADE_FT;

/** How far either side of the prism boundary the cut is feathered, ft. Spec: "~2 ft". */
export const FEATHER_FT = 2;

/** GLSL has no implicit int-to-float promotion, so a baked constant needs a decimal point. */
const glsl = (n: number): string => n.toFixed(4);

/** The varying carrying the fragment's world position into the box test. */
const POS = "vCarveWorldPos";

/**
 * A 4x4 ordered (Bayer) dither, the same technique 3d-tiles-renderer's own
 * TilesFadePlugin uses (node_modules/3d-tiles-renderer/src/three/plugins/fade/
 * wrapFadeMaterial.js) to turn a continuous fade into a per-fragment discard on these
 * same tile materials -- the closest existing precedent for "soften a discard-based cut
 * on this exact material type" in this dependency tree. A plain smoothstep alone cannot
 * do it: `discard` is binary per fragment, so softening the EDGE of the prism (the ~2 ft
 * feather) needs some fragments in the feather band to discard and others not to,
 * stochastically, in proportion to how deep into the feather they are. Ordered dithering
 * gives a fixed, non-shimmering pattern for that rather than needing per-frame noise.
 */
const BAYER_FN = `
float weldCarveBayer4x4( vec2 v ) {
  vec2 p1 = mod( v, 2.0 );
  vec2 p2 = floor( 0.5 * mod( v, 4.0 ) );
  float b1 = mod( 3.0 * p1.y + 2.0 * p1.x, 4.0 );
  float b2 = mod( 3.0 * p2.y + 2.0 * p2.x, 4.0 );
  return 4.0 * b1 + b2;
}`;

/**
 * The box test and discard, as a fragment-shader statement block.
 *
 * `outside` is the largest of the six axis-aligned excursions past the box's six faces
 * (u, v and height each contribute two, one per direction) -- a Chebyshev-style box
 * distance rather than a true rounded Euclidean SDF, which is what "prism" asks for: a
 * simple box, not a rounded one. `carve` is 1 for a fragment deep inside the prism, 0 well
 * outside it, smoothstepped across the FEATHER_FT band, and scaled by `uCarve` so the whole
 * effect is off until the transit ramps it on. The dither turns that continuous value into
 * a discard decision per fragment.
 */
function carveStatement(): string {
  return `
  {
    float u = ${POS}.x * ${glsl(COS_A)} + ${POS}.z * ${glsl(SIN_A)};
    float v = ${POS}.x * ${glsl(SIN_A)} - ${POS}.z * ${glsl(COS_A)};
    float y = ${POS}.y;

    float du = abs( u ) - ${glsl(HALF_U)};
    float dv = abs( v ) - ${glsl(HALF_V)};
    float dyLow = ${glsl(HEIGHT_MIN)} - y;
    float dyHigh = y - ${glsl(HEIGHT_MAX)};
    float outside = max( max( du, dv ), max( dyLow, dyHigh ) );

    float carve = ( 1.0 - smoothstep( ${glsl(-FEATHER_FT)}, ${glsl(FEATHER_FT)}, outside ) ) * uCarve;

    float bayer = weldCarveBayer4x4( floor( mod( gl_FragCoord.xy, 4.0 ) ) );
    float ditherThreshold = ( 0.5 + bayer ) / 16.0;
    if ( carve > ditherThreshold ) discard;
  }
`;
}

/**
 * Give a material's compiled shader the carve: a world-position varying (vertex stage) and
 * the box-test discard (fragment stage), wired to the shared `uCarve` uniform.
 *
 * Same chunk markers Threshold.tsx's `attachPaletteSeam`/`inject` use -- `<common>` for
 * declarations, `<project_vertex>` for where world position is known, `<color_fragment>` for
 * where the fragment-stage body lands -- so this reads as the same pattern applied to a
 * different material family (glTF-loaded tile materials rather than this app's own
 * MeshStandardMaterial clones), not a second convention.
 */
export function applyWeldCarve(shader: ShaderLike, uniforms: CarveUniforms): void {
  shader.uniforms.uCarve = uniforms.uCarve;

  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\nvarying vec3 ${POS};`)
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n  ${POS} = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
    );

  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>\nvarying vec3 ${POS};\nuniform float uCarve;\n${BAYER_FN}`,
    )
    .replace("#include <color_fragment>", `#include <color_fragment>\n${carveStatement()}`);
}

/**
 * The same box test as `carveStatement()`'s GLSL, in plain JS, for a WebGL-free unit test.
 * `x`/`y`/`z` are world coordinates (feet: x east, y up, z south -- geo/frame.ts's `ecefToSite`
 * convention), `carveT` is the temporal ramp (0..1). Returns the continuous carve factor
 * BEFORE dithering -- 1 deep inside the prism, 0 well outside it -- which is what a test can
 * assert against exactly; the dither only decides which fragments a given continuous value
 * turns into a discard, and that is a rendering-time decision this function does not make.
 */
export function carveFactor(x: number, y: number, z: number, carveT: number): number {
  const u = x * COS_A + z * SIN_A;
  const v = x * SIN_A - z * COS_A;

  const du = Math.abs(u) - HALF_U;
  const dv = Math.abs(v) - HALF_V;
  const dyLow = HEIGHT_MIN - y;
  const dyHigh = y - HEIGHT_MAX;
  const outside = Math.max(du, dv, dyLow, dyHigh);

  const edge = Math.min(1, Math.max(0, (outside + FEATHER_FT) / (2 * FEATHER_FT)));
  const smooth = edge * edge * (3 - 2 * edge);
  const t = Math.min(1, Math.max(0, carveT));
  return (1 - smooth) * t;
}
