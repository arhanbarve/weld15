"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import manifest from "@/data/buildings-manifest.json";
import { layerOpacity, type LayerOpacity } from "./altitude";
import { quadOf, sharedTexture } from "./imagery";
import { MASONRY, SCAN } from "./materials";

/**
 * The keyless fallback world: P11 decision 10.
 *
 * Once `Tiles.tsx` exists, live Google Photorealistic 3D Tiles are the ground, the Earth and
 * the campus at every altitude -- but a run with no `NEXT_PUBLIC_GOOGLE_MAPS_KEY` (no Google
 * Cloud project yet, or any Playwright/CI run that must not spend a billable tileset request)
 * still has to render something. This file is that something: Ground.tsx's L3/L4 photographed
 * quads and CampusMesh.tsx's `campus.glb` massing, consolidated into one component, with L0/L1/L2
 * dropped because they existed only to cover the whole Earth down to the Boston basin -- ground
 * a keyless run over Harvard Yard's immediate surroundings does not need. L3 (8 ft/texel, NAIP
 * 2023) and L4 (~1 ft/texel, NAIP/MassGIS hybrid) are the two plates that actually cover the Yard
 * at the resolution stages 2-5 are seen at.
 *
 * NOT WIRED UP YET. `Experience.tsx` still mounts `<Ground>` and `<Campus>`; this component
 * becomes their keyless replacement once `Tiles.tsx` lands, per the phase-1 task list.
 */

/** How much of each quad's half-extent is fade. Same figure Ground.tsx uses; see its header. */
const FADE = 0.28;

/** Tint target: SCAN.void, from design-system/MASTER.md. The photograph resolves into this. */
const TINT = "#06203f";

/** How far the tint goes at full strength. See Ground.tsx's header for the measured basis. */
const TINT_MAX = 0.82;

/** Saturation left at full tint. Desaturating alongside the tint is what stops it going purple. */
const SAT_MIN = 0.25;

/** How much of altitude.ts's tint ramp actually reaches the photograph. See Ground.tsx. */
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
 * length(uv) -- so the falloff follows the quad's own square boundary, not a circle that would
 * leave the corners opaque.
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

    float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 desat = mix(c.rgb, vec3(lum), uTint * (1.0 - ${SAT_MIN}));
    vec3 tinted = mix(desat, uTintColor, uTint * ${TINT_MAX});

    vec2 d = abs(vUv - 0.5) * 2.0;
    float edge = max(d.x, d.y);
    float rim = 1.0 - smoothstep(1.0 - uFade, 1.0, edge);

    gl_FragColor = vec4(tinted, c.a * uOpacity * rim);
  }
`;

/**
 * The two levels this fallback ever asks for. L0/L1/L2 are not imported here at all, and
 * tests/fallbackGround.test.ts asserts exactly this pair so a future edit that widens it back
 * out fails a gate instead of quietly undoing decision 10.
 */
export const FALLBACK_LEVELS = ["L3", "L4"] as const;
export type FallbackLevelId = (typeof FALLBACK_LEVELS)[number];

/** Which band drives which quad's opacity. Outermost first, and the render order follows. */
export const PICK: Record<FallbackLevelId, (o: LayerOpacity) => number> = {
  L3: (o) => o.q3,
  L4: (o) => o.q4,
};

/** One ground quad. Mounted only once its texture has arrived; see imagery.ts's loader note. */
function GroundQuad({
  id,
  order,
  opacityOf,
}: {
  id: FallbackLevelId;
  order: number;
  opacityOf: (o: LayerOpacity) => number;
}) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const quad = useMemo(() => quadOf(id), [id]);

  useEffect(() => sharedTexture(id, setTex), [id]);

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
    // Invisible rather than transparent-at-zero: a quad at zero alpha still costs its draw call.
    m.visible = a > 0.002;
    if (!m.visible) return;

    // THE TEXTURE IS BOUND THROUGH THE MATERIAL'S OWN UNIFORMS, NOT THROUGH THE MEMOISED OBJECT.
    // See Ground.tsx's header for why: mutating the memoised `uniforms` object writes to a copy
    // once <shaderMaterial> has cloned it, and the sampler silently stays unbound.
    if (tex && mat.uniforms.uMap!.value !== tex) mat.uniforms.uMap!.value = tex;
    mat.uniforms.uOpacity!.value = a;
    mat.uniforms.uTint!.value = o.tint * TINT_SCALE;
  });

  if (!tex || !quad) return null;

  return (
    <mesh
      ref={mesh}
      rotation={[-Math.PI / 2, 0, 0]}
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

/** Must match scripts/fetch-buildings.mjs's CLASS. Same as CampusMesh.tsx. */
const MATCLASS = { wall: 0, roof: 1, base: 2, trim: 3 } as const;

/** Nominal storey height, ft. Same as CampusMesh.tsx. */
const FLOOR_FT = 12;

/** Turn the window grid off if it reads as wallpaper rather than as windows. */
const WINDOWS = true;

const CAMPUS_VERT = /* glsl */ `
  // Named _matclass, lowercase: see CampusMesh.tsx's header for why the case has to match the
  // geometry attribute GLTFLoader decodes it into.
  attribute float _matclass;
  varying float vClass;
  varying vec3 vWorld;
  varying vec3 vNormal2;
  void main() {
    vClass = _matclass;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal2 = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/** Colour by class, add a window grid on walls, then blend out of the scan palette by altitude. */
const CAMPUS_FRAG = /* glsl */ `
  uniform vec3 uBrick;
  uniform vec3 uSlate;
  uniform vec3 uGranite;
  uniform vec3 uSandstone;
  uniform vec3 uScan;
  uniform float uReal;      // 0 = scan massing, 1 = masonry
  uniform float uWindows;
  varying float vClass;
  varying vec3 vWorld;
  varying vec3 vNormal2;

  void main() {
    vec3 base =
        vClass < 0.5 ? uBrick
      : vClass < 1.5 ? uSlate
      : vClass < 2.5 ? uGranite
      : uSandstone;

    if (uWindows > 0.5 && vClass < 0.5) {
      float across = abs(vNormal2.x) > abs(vNormal2.z) ? vWorld.z : vWorld.x;
      float sy = fract((vWorld.y - 4.0) / ${FLOOR_FT}.0);
      float sx = fract(across / 10.0);
      float win = step(0.18, sy) * step(sy, 0.68) * step(0.30, sx) * step(sx, 0.70);
      base = mix(base, uSlate * 0.55, win * 0.85);
    }

    float lambert = 0.45 + 0.55 * clamp(dot(normalize(vNormal2), normalize(vec3(0.4, 0.85, 0.3))), 0.0, 1.0);
    vec3 lit = base * lambert;

    gl_FragColor = vec4(mix(uScan, lit, uReal), 1.0);
  }
`;

/**
 * The keyless fallback: L3/L4 photographed ground plus Harvard's own campus mesh, one component.
 *
 * LOADED IMPERATIVELY AND NOT WITH useGLTF, for the same reason CampusMesh.tsx is: a suspending
 * child of `<Canvas>` suspends the whole canvas up to the "LOADING WELD 15" screen outside it
 * (imagery.ts's header measures this at 2.5 s). Nothing is drawn while campus.glb loads -- the
 * ground quads are already underneath at every altitude this is mounted at.
 */
export function FallbackGround({ visible }: { visible: boolean }) {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uBrick: { value: new THREE.Color(MASONRY.brick) },
      uSlate: { value: new THREE.Color(MASONRY.slate) },
      uGranite: { value: new THREE.Color(MASONRY.granite) },
      uSandstone: { value: new THREE.Color(MASONRY.sandstone) },
      uScan: { value: new THREE.Color(SCAN.line) },
      uReal: { value: 0 },
      uWindows: { value: WINDOWS ? 1 : 0 },
    }),
    [],
  );

  useEffect(() => {
    let live = true;
    let loaded: THREE.BufferGeometry | null = null;
    new GLTFLoader().load(manifest.file, (gltf) => {
      const mesh = gltf.scene.getObjectByProperty("type", "Mesh") as THREE.Mesh | undefined;
      if (!mesh) return;
      loaded = mesh.geometry;
      if (!live) {
        loaded.dispose();
        return;
      }
      setGeo(loaded);
    });
    return () => {
      live = false;
      loaded?.dispose();
    };
  }, []);

  useFrame(({ camera }) => {
    const mat = material.current;
    if (!mat) return;
    mat.uniforms.uReal!.value = layerOpacity(camera.position.y).massing;
  });

  return (
    <group visible={visible}>
      {FALLBACK_LEVELS.map((id, i) => (
        <GroundQuad key={id} id={id} order={i} opacityOf={PICK[id]} />
      ))}
      {geo ? (
        <mesh geometry={geo} visible={visible} castShadow={false} receiveShadow={false}>
          <shaderMaterial
            ref={material}
            vertexShader={CAMPUS_VERT}
            fragmentShader={CAMPUS_FRAG}
            uniforms={uniforms}
          />
        </mesh>
      ) : null}
    </group>
  );
}
