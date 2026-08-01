"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import manifest from "@/data/buildings-manifest.json";
import { MASONRY, SCAN } from "./materials";
import { layerOpacity } from "./altitude";

/** Must match scripts/fetch-buildings.mjs's CLASS. */
const MATCLASS = { wall: 0, roof: 1, base: 2, trim: 3 } as const;

/** Nominal storey height, ft. The same 12 ft weldGeometry derives Weld's five floors from. */
const FLOOR_FT = 12;

/** Turn the window grid off if it reads as wallpaper rather than as windows. */
const WINDOWS = true;

const CAMPUS_VERT = /* glsl */ `
  // Named _matclass, lowercase: GLTFLoader has no built-in semantic for a custom "_MATCLASS"
  // attribute, so addPrimitiveAttributes() falls back to attributeName.toLowerCase() when it
  // copies the glTF accessor onto the BufferGeometry (three-stdlib's GLTFLoader.js). Three's
  // WebGLBindingStates then binds program attributes to geometry.attributes by exact-case name,
  // so a shader attribute spelled _MATCLASS silently fails to bind against a geometry attribute
  // named _matclass -- it reads the WebGL default of 0 for every vertex, which is class "wall"
  // for every vertex, which is every building solid brick with no roof, base or trim. Confirmed
  // against the loader source and against the geometry actually decoded from public/models/campus.glb
  // before fixing the case here; see glb.ts for where _MATCLASS is written into the glTF JSON.
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

/**
 * Colour by class, add a window grid on walls, then blend the whole thing out of the scan palette
 * by altitude.
 *
 * THE SCAN BLEND IS WHY THIS IS ONE SHADER AND NOT FOUR MATERIALS. At 40,000 ft these buildings are
 * a few pixels each and the cyanotype is the right drawing; by stage 3 they are the subject and
 * brick is. layerOpacity().massing is the same ramp Campus.tsx's mass fill already climbed, so the
 * crossing happens at the altitude the design system already chose rather than at a new one.
 *
 * THE WINDOW GRID IS DERIVED AND IS NOT A RECORD OF ANYTHING. No source in this project gives the
 * fenestration of any building but Weld. It is a 12 ft storey rhythm on vertical faces, which is a
 * plausible reading of a 19th-century Yard dormitory and nothing more. buildings-manifest.json's
 * `derived` block says so, and WINDOWS above turns it off.
 */
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

    // Windows: a storey rhythm in y, and a bay rhythm along whichever horizontal axis the wall
    // faces across. Only on walls, and only where the face is vertical.
    if (uWindows > 0.5 && vClass < 0.5) {
      float across = abs(vNormal2.x) > abs(vNormal2.z) ? vWorld.z : vWorld.x;
      float sy = fract((vWorld.y - 4.0) / ${FLOOR_FT}.0);
      float sx = fract(across / 10.0);
      float win = step(0.18, sy) * step(sy, 0.68) * step(0.30, sx) * step(sx, 0.70);
      base = mix(base, uSlate * 0.55, win * 0.85);
    }

    // Lambert against a fixed key, so this needs no lights and stays one draw call. Lighting.tsx's
    // sun drives the interior; out here the buildings are seen from above and a full PBR pass buys
    // nothing a gradient does not.
    float lambert = 0.45 + 0.55 * clamp(dot(normalize(vNormal2), normalize(vec3(0.4, 0.85, 0.3))), 0.0, 1.0);
    vec3 lit = base * lambert;

    gl_FragColor = vec4(mix(uScan, lit, uReal), 1.0);
  }
`;

/**
 * Harvard's campus, as Harvard models it.
 *
 * LOADED IMPERATIVELY AND NOT WITH useGLTF, and src/scene/imagery.ts's header is the reason: R3F
 * wraps <Canvas>'s children in a Suspense whose fallback throws, so a scene child that suspends
 * suspends the CANVAS, up to the "LOADING WELD 15" screen outside it. P8 measured that at 2.5 s of
 * the whole UI disappearing and coming back. A 1.1 MB GLB is exactly the thing that warning was
 * written for. So: a loader in an effect, and nothing rendered until it arrives.
 *
 * NOTHING IS DRAWN WHILE IT LOADS. Not a placeholder, not a wireframe. The ground is already
 * underneath at every altitude this is mounted at, so an empty frame is a frame with a photograph
 * in it rather than a hole.
 */
export function CampusMesh({ visible }: { visible: boolean }) {
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
    // The same band Campus.tsx's mass fill climbed. One ramp, one crossing.
    mat.uniforms.uReal!.value = layerOpacity(camera.position.y).massing;
  });

  if (!geo) return null;

  return (
    <mesh geometry={geo} visible={visible} castShadow={false} receiveShadow={false}>
      <shaderMaterial
        ref={material}
        vertexShader={CAMPUS_VERT}
        fragmentShader={CAMPUS_FRAG}
        uniforms={uniforms}
      />
    </mesh>
  );
}
