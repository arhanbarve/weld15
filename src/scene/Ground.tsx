"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { layerOpacity, type LayerOpacity } from "./altitude";
import { GROUND_LEVELS, levelUrls, loadTexture, quadOf, type GroundLevelId } from "./imagery";

/**
 * The photographed ground: four nested quads, cross-dissolved by altitude, resolving into the
 * scan palette as the camera descends.
 *
 * FOUR CONCENTRIC PLANES, NOT ONE, and each is ten times smaller and ten times sharper than the
 * one outside it. That is what lets a stack of four cover five decades of altitude: at orbit the
 * 1,000 km plate is all you can see, and by stage 3 the 1,600 ft plate covers the whole frame at
 * half a foot per texel. altitude.ts owns which are up; imagery.ts owns how big each one is, read
 * from the manifest so the mesh and the resampling cannot disagree.
 *
 * NO DEPTH PARTICIPATION AT ALL. Every quad has depthWrite false and an ascending renderOrder, so
 * the inner ones simply paint over the outer ones. Four coplanar planes WOULD z-fight -- they are
 * all at y = 0 -- and the usual answers are polygonOffset or nudging each one up by a foot. Both
 * are worse: polygon offset is driver-dependent, and stacking them vertically means the camera at
 * stage 5 stands inside a 4 ft lasagne of ground. Painting in order costs nothing and cannot
 * fight.
 *
 * They keep depthTest TRUE, unlike the globe. The massing has to be able to occlude the
 * photograph -- that is the whole point of Campus.tsx's opacity ramp, so each building hides its
 * own smeared rooftop -- and an untested ground would paint over the buildings standing on it.
 *
 * THE FADE IS RADIAL AND IN THE SHADER, NOT THREE.Fog. Fog is a scene-wide setting and would also
 * fog the suite's interior at stage 5, which is a daylight room and the one place in the app that
 * must not be touched by the scan palette's atmosphere. A per-quad radial falloff also fades the
 * EDGE specifically, which is the actual problem: a flat plane has a boundary, and at any oblique
 * angle a viewer sees it.
 */

/**
 * How much of each quad's half-extent is fade.
 *
 * 0.28 rather than P9.md section 3.5's 0.20, and the reason is Q1. At 1,000 km across, the
 * sagitta of the Earth's curve is 19,650 m -- tens of pixels, not the sub-pixel the flat
 * approximation assumes -- so the far field of the outermost quad is geometrically wrong. The
 * plan anticipated this and gave the instruction: "if the flat far field reads as wrong at
 * 28,000 ft, the answer is to bring the fade in closer, not to subdivide Q1." This is that,
 * applied to every quad rather than to Q1 alone so there is one number instead of four.
 */
const FADE = 0.28;

/** Tint target: SCAN.void, from design-system/MASTER.md. The photograph resolves into this. */
const TINT = "#06203f";

/**
 * How far the tint goes at full strength.
 *
 * 0.82 and not 1.0. A fully tinted photograph is a flat blue rectangle -- every bit of tonal
 * information gone -- and what stage 3 wants is a photograph that has become the GROUND THE
 * DRAWING SITS ON rather than one that has been deleted. Leaving 18% of the image means the paths
 * across the Yard and the difference between grass and paving still read under the cyanotype,
 * which is what makes the massing look like it is standing on something.
 */
const TINT_MAX = 0.82;

/** Saturation left at full tint. Desaturating alongside the tint is what stops it going purple. */
const SAT_MIN = 0.25;

/**
 * How much of altitude.ts's tint ramp actually reaches the photograph.
 *
 * P10. The ramp itself still runs a clean 0 to 1 from 40,000 ft to 400 ft -- altitude.ts is
 * untouched and tests/altitude.test.ts still asserts yard.tint === 1 -- and this is the design
 * layer deciding how much of it to spend. Measured at the three stage altitudes the camera actually
 * sits at (window.__cam), before and after:
 *
 *   stage 1, 16,332 ft   tint 0.195   was 15% desaturated / 16% blue   now  5% / 5.6%
 *   stage 2,    815 ft   tint 0.846   was 63% / 69%                    now 22% / 24%
 *   stage 3,    110 ft   tint 1.000   was 75% / 82%                    now 26% / 29%
 *
 * SCALED, NOT CLAMPED, and the difference matters. A clamp at 0.35 would plateau around 8,000 ft
 * and the photograph would then stop changing for the last two stages of a descent whose whole
 * subject is continuous change. Scaling shortens the ramp's reach and keeps its shape.
 *
 * WHAT SURVIVES AT 0.35 IS NOT A WEAKENED CYANOTYPE, IT IS AERIAL HAZE. The campus is no longer
 * drawn as translucent blue massing over the photograph -- CampusMesh.tsx stands real brick and
 * slate on it -- so a residual quarter-strength blue is the distance cue that stops the ground
 * reading as a decal under the buildings. MASTER.md's photographic-layer table is amended to match.
 */
const TINT_SCALE = 0.35;

const GROUND_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * The ground fragment shader: sample, desaturate, tint, and fade the rim.
 *
 * The fade is computed on a CHEBYSHEV distance from the quad's centre -- max(|u|,|v|) rather than
 * length(uv) -- so the falloff follows the quad's own square boundary. A radial (circular) falloff
 * on a square plane leaves the four corners opaque and fully visible, which is precisely the edge
 * this exists to hide, and it looks like a vignette rather than a horizon.
 */
const GROUND_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uOpacity;
  uniform float uTint;
  uniform vec3 uTintColor;
  uniform float uFade;
  varying vec2 vUv;

  void main() {
    vec4 c = texture2D(uMap, vUv);

    // Desaturate toward luminance, then push toward the void colour. Both driven by the same
    // ramp, because a tinted-but-saturated photograph reads as a colour cast rather than as a
    // drawing.
    float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 desat = mix(c.rgb, vec3(lum), uTint * (1.0 - ${SAT_MIN}));
    vec3 tinted = mix(desat, uTintColor, uTint * ${TINT_MAX});

    // Chebyshev distance from the centre, 0 at the middle and 1 at any edge.
    vec2 d = abs(vUv - 0.5) * 2.0;
    float edge = max(d.x, d.y);
    float rim = 1.0 - smoothstep(1.0 - uFade, 1.0, edge);

    gl_FragColor = vec4(tinted, c.a * uOpacity * rim);
  }
`;

/** One quad. Mounted only once its texture has arrived; see the loader note in imagery.ts. */
function Quad({
  id,
  order,
  opacityOf,
}: {
  id: GroundLevelId;
  order: number;
  opacityOf: (o: LayerOpacity) => number;
}) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const quad = useMemo(() => quadOf(id), [id]);

  useEffect(() => {
    const urls = levelUrls(id);
    if (urls.length === 0) return;
    return loadTexture(urls, setTex);
  }, [id]);

  const uniforms = useMemo(
    () => ({
      uMap: { value: null as THREE.Texture | null },
      uOpacity: { value: 0 },
      uTint: { value: 0 },
      uTintColor: { value: new THREE.Color(TINT) },
      uFade: { value: FADE },
    }),
    [],
  );

  useFrame(({ camera }) => {
    const m = mesh.current;
    const mat = material.current;
    if (!m || !mat) return;
    const o = layerOpacity(camera.position.y);
    const a = opacityOf(o);
    // Invisible rather than transparent-at-zero: a quad at zero alpha still costs its draw call,
    // and at stage 5 -- inside the building, with the camera below the eaves -- none of these
    // should be issuing one at all.
    m.visible = a > 0.002;
    if (!m.visible) return;

    /**
     * THE TEXTURE IS BOUND THROUGH THE MATERIAL'S OWN UNIFORMS, NOT THROUGH THE MEMOISED OBJECT,
     * and this cost an hour so it is written down.
     *
     * The obvious version is `uniforms.uMap.value = tex` in an effect, mutating the same object
     * handed to <shaderMaterial uniforms={...}>. It silently does nothing: the object the material
     * ends up holding is not the object passed in, so the effect writes to a copy and the sampler
     * stays unbound. The symptom is not an error -- an unbound sampler2D is simply not drawn -- so
     * the quads rendered at the right size, in the right place, visible and in frustum, and
     * invisible. Diagnosed by publishing window.__ground from this loop and reading
     * `!!uniforms.uMap.value` back out, which said false while `tex` said true.
     *
     * Written here rather than in an effect for the same reason: this is the one place with a
     * guaranteed-live handle on the material three is actually rendering with.
     */
    if (tex && mat.uniforms.uMap!.value !== tex) mat.uniforms.uMap!.value = tex;
    mat.uniforms.uOpacity!.value = a;
    mat.uniforms.uTint!.value = o.tint * TINT_SCALE;
  });

  if (!tex || !quad) return null;

  return (
    <mesh
      ref={mesh}
      // -Math.PI/2 about X takes a PlaneGeometry from the XY plane to the XZ plane, i.e. flat on
      // the ground. Weld's grade is y = 0.
      rotation={[-Math.PI / 2, 0, 0]}
      // The plane's local +y becomes world -z after that rotation, and world -z is NORTH
      // (place.ts). The manifest's rows run north-to-south from the top, which is the same
      // direction, so the texture needs no flip. Verified on the committed overlay in
      // design/renders/ rather than reasoned about: a north-south flip here would mirror the Yard
      // and frames.ts:13-17 warns that a mirror in this project is invisible.
      position={[quad.cx, 0, -quad.cy]}
      renderOrder={order}
    >
      <planeGeometry args={[quad.width, quad.height]} />
      <shaderMaterial
        ref={material}
        vertexShader={GROUND_VERT}
        fragmentShader={GROUND_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}

/** Which band drives which quad. Outermost first, and the render order follows. */
const PICK: Record<GroundLevelId, (o: LayerOpacity) => number> = {
  L1: (o) => o.q1,
  L2: (o) => o.q2,
  L3: (o) => o.q3,
  L4: (o) => o.q4,
};

export function Ground({ visible }: { visible: boolean }) {
  return (
    <group visible={visible}>
      {GROUND_LEVELS.map((id, i) => (
        <Quad key={id} id={id} order={i} opacityOf={PICK[id]} />
      ))}
    </group>
  );
}
