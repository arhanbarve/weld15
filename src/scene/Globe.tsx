"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { WELD_ORIGIN } from "@/geo/frames";
import { subsolarPoint } from "@/geo/solar";
import { useStore } from "@/state/store";
import { cambridgeInstant } from "./Lighting";
import { layerOpacity } from "./altitude";
import { levelUrls, loadTexture } from "./imagery";
import { assertRigVisible, geoToSite, globeRig, weldBasis, type Vec3 } from "./globeRig";

/**
 * Stage 0's Earth, as a depth-less proxy at whatever scale the far plane allows.
 *
 * WHAT CHANGED IN P9. This was 39 lines: a unit sphere in flat #0c3260, a wireframe over it,
 * and a red dot at Weld's latitude and longitude, living in a scene of its own at unit scale
 * because "Earth at the project's foot scale would be 2.1e7 ft in radius, which would wreck
 * depth precision for everything else, so stage 0 -> 1 is the one hard cut in the sequence."
 *
 * The premise was right and the conclusion was avoidable. globeRig.ts explains how: a
 * perspective projection is invariant under scaling the scene about the camera, so the Earth
 * can be drawn at its correct ANGULAR size by a much smaller sphere placed much closer. There
 * is now ONE frame, in feet, and no cut. Read globeRig.ts before changing anything here.
 *
 * The three properties that make it a backdrop rather than a participant are set below and they
 * are load-bearing: depthTest false, depthWrite false, and a renderOrder before everything
 * else. Nothing in the scene ever depth-composites against this sphere, which is what allows
 * near and far to serve only the foot-scale content and is therefore what keeps a logarithmic
 * depth buffer -- and its argument with the EffectComposer in Effects.tsx -- out of this
 * project entirely.
 *
 * P8 ASKED FOR THIS FILE TO BE CODE-SPLIT AND THE MEASUREMENT SAYS NOT TO. That measurement is
 * unchanged by P9 and is kept because it is the reason the import is still eager:
 *
 *   as shipped                        scene chunk 1,252,534 B    total JS 1,885,152 B
 *   Globe deleted outright            scene chunk 1,251,818 B    -716 B
 *   lazy(() => import("./Globe"))     scene chunk 1,252,102 B    -432 B, total +1,173 B
 *
 * So the whole globe was 716 bytes of a 1.25 MB chunk, and the lazy boundary SHIPPED MORE in
 * total because it split geo/frames into a 703 B chunk the main bundle still needs. It also
 * broke the descent, measured rather than feared: with the globe's chunk delayed 2,500 ms,
 * journey.spec.ts's own frame metric read 0.0% covered / 1 distinct colour from +850 ms to
 * +2,905 ms. Stage 0 IS first paint, so "off the critical path" is a contradiction here.
 * CanvasHost.tsx records the R3F half of that experiment -- what a suspending child of
 * <Canvas> does to the whole page. P9 makes this file bigger; the conclusion is unchanged,
 * because the reason was never the size. It was that the globe is the first thing on screen.
 *
 * THE SUN IS A UNIFORM, NOT A LIGHT, AND THAT IS THE HARDEST-WON LINE IN THIS FILE.
 * The first version used a <directionalLight> inside the sphere's group and the terminator came
 * out mirrored. Three reasons it cannot work, all of which the uniform avoids:
 *
 *   1. A DirectionalLight aims at `light.target`, which defaults to an Object3D at the WORLD
 *      origin -- and the world origin here is Weld's centroid, tens of millions of feet from
 *      the proxy sphere's centre. So the light direction was position-minus-Weld rather than
 *      position-minus-centre, which is not the sun's direction at all.
 *   2. Lights in three are collected from the whole scene graph, not scoped to the group they
 *      are written in. A light added here also lights Campus and Weld.
 *   3. The target object is not in the scene, so its matrixWorld is never updated, which makes
 *      any attempt to move it per frame silently do nothing.
 *
 * A single normalised direction in the site frame, handed straight to the fragment shader, has
 * none of those failure modes and is directly unit-testable besides -- tests/globeRig.test.ts
 * checks geoToSite(), which is the only conversion involved.
 */

/** Fresnel rim colour, SCAN.line. */
const ATMOSPHERE = "#8fc4f2";

/** Daylit ocean, and the night side. The lit tone is the flat blue the grey-box shipped with. */
const DAY = "#14509a";
const NIGHT = "#061426";

/**
 * The globe's surface: a two-tone day/night sphere with a soft terminator.
 *
 * `uSun` is a direction in the SITE frame, and the normal is taken to the same frame in the
 * vertex stage, so the dot product is computed in one consistent space with no view-dependent
 * term. The scale on the group is uniform, so mat3(modelMatrix) rotates the normal correctly
 * up to a scale factor that normalize() removes.
 *
 * smoothstep(-0.12, 0.25) rather than a hard step at 0: a real terminator is softened by the
 * atmosphere over a few degrees, and a hard one on a 64x48 sphere shows the tessellation.
 */
const SURFACE_VERT = /* glsl */ `
  varying vec3 vNormalSite;
  varying vec2 vUv;
  void main() {
    // SphereGeometry's own UVs, unmodified: u runs from the prime meridian and v from the south
    // pole, which is exactly the layout of an equirectangular plate. That is why L0 is written
    // 4096 x 2048 and not cropped -- see scripts/fetch-imagery.mjs.
    vUv = uv;
    vNormalSite = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SURFACE_FRAG = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uDay;
  uniform vec3 uNight;
  uniform float uOpacity;
  uniform sampler2D uMap;
  uniform float uHasMap;
  varying vec3 vNormalSite;
  varying vec2 vUv;
  void main() {
    // uHasMap rather than a #define, so the Blue Marble arriving does not recompile the program
    // mid-descent. The flat colour is what stage 0 shows on the very first frame, before any
    // texture has loaded, and CanvasHost.tsx's header is the reason it must be something rather
    // than nothing.
    vec3 day = mix(uDay, texture2D(uMap, vUv).rgb, uHasMap);
    // The night side is the same photograph crushed toward the void colour rather than a flat
    // black, so coastlines stay faintly readable across the terminator the way they do from
    // orbit at dusk.
    vec3 night = mix(uNight, mix(uNight, day, 0.18), uHasMap);
    float l = dot(normalize(vNormalSite), normalize(uSun));
    float lit = smoothstep(-0.12, 0.25, l);
    gl_FragColor = vec4(mix(night, day, lit), uOpacity);
  }
`;

/**
 * The atmosphere rim, as an actual fresnel rather than as a trick that does not work.
 *
 * WHAT THIS REPLACES AND WHY, because the first version of it shipped in this file briefly and
 * was wrong in a way worth recording. The idea was to avoid a shader: draw a slightly larger
 * sphere with BackSide and additive blending, and let "the back wall of a sphere is at grazing
 * incidence exactly at the limb" produce the falloff for free. It does not. A
 * MeshBasicMaterial's opacity is CONSTANT over the surface -- there is no view-dependent term
 * anywhere in it -- so what that produces is a uniform wash of #8fc4f2 over the entire disc,
 * not a rim. Caught by looking at a screenshot: the Earth was flat, pale, and had swallowed the
 * red marker at its centre.
 *
 * `1 - |dot(view, normal)|` is 0 where the surface faces the camera and 1 at the limb; the
 * power tightens the band to the edge.
 */
const RIM_VERT = /* glsl */ `
  varying vec3 vNormalView;
  varying vec3 vPosView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vPosView = mv.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const RIM_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPower;
  varying vec3 vNormalView;
  varying vec3 vPosView;
  void main() {
    vec3 viewDir = normalize(-vPosView);
    float f = 1.0 - abs(dot(viewDir, normalize(vNormalView)));
    gl_FragColor = vec4(uColor, pow(clamp(f, 0.0, 1.0), uPower) * uOpacity);
  }
`;

/**
 * RENDER ORDER, AND WHY IT IS THREE DIFFERENT NUMBERS.
 *
 * three renders the opaque queue first and the transparent queue second, and renderOrder only
 * sorts WITHIN a queue -- so an opaque object always draws before a transparent one no matter
 * what renderOrder says. The first version of this file had a transparent surface and an opaque
 * marker, and the consequence was that the surface painted over the marker every frame and
 * Weld's red dot was invisible at stage 0. With depthTest off there was nothing to stop it.
 *
 * So all three materials are transparent, which puts them in one queue where renderOrder is
 * actually obeyed, and they are ordered explicitly. All three stay negative so the whole globe
 * still draws before the rest of the scene.
 */
const ORDER = { surface: -3, rim: -2, marker: -1 };

/** Weld's outward normal, geocentric. The same vector weldBasis() calls `up`. */
function markerDirection(): Vec3 {
  const lat = WELD_ORIGIN.lat * (Math.PI / 180);
  const lon = WELD_ORIGIN.lon * (Math.PI / 180);
  return [
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.sin(lon),
  ];
}

export function Globe({ visible }: { visible: boolean }) {
  const date = useStore((s) => s.date);
  const hour = useStore((s) => s.hour);

  const group = useRef<THREE.Group>(null);
  const surface = useRef<THREE.ShaderMaterial>(null);
  const rim = useRef<THREE.ShaderMaterial>(null);
  const warned = useRef(false);

  /**
   * The geocentric-to-site rotation, as a quaternion.
   *
   * HANDED TO THE GROUP AS A QUATERNION, NOT AS A MATRIX, and that is deliberate rather than
   * stylistic. Setting `matrix` on an R3F node needs matrixAutoUpdate false to survive, and
   * props are applied in object-key order -- so whether the matrix or the flag lands first is
   * an implementation detail of applyProps, and if the flag lands first three recomposes the
   * matrix from position/quaternion/scale on the next update and silently discards the
   * rotation. A quaternion is composed BY that recomposition rather than overwritten by it.
   *
   * makeBasis() builds the matrix whose COLUMNS are the vectors given, which maps site to
   * geocentric; the mesh's vertices are geocentric and need to land in the site frame, so this
   * is the transpose. For a rotation the transpose IS the inverse, which is why it is a
   * transpose and not an invert(): same answer, no division, cannot fail.
   *
   * tests/globeRig.test.ts checks weldBasis() for orthonormality, for right-handedness, and
   * that Weld's own outward normal comes out as site +Y. A mirrored Earth is the failure that
   * guards against, and frames.ts:13-17 warns that a mirror in this project is invisible.
   */
  const orientation = useMemo(() => {
    const b = weldBasis();
    const m = new THREE.Matrix4()
      .makeBasis(
        new THREE.Vector3(...b.x),
        new THREE.Vector3(...b.y),
        new THREE.Vector3(...b.z),
      )
      .transpose();
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, []);

  /**
   * The direction of the sun in the SITE frame, from the store's own wall clock.
   *
   * THE POINT OF THIS, and the reason it is not a fixed direction: the subsolar point is where
   * the sun is really overhead at the instant the viewer has dialled in, so moving the existing
   * hour slider at stage 0 sweeps a real terminator across a real Earth, and Weld's marker is
   * truthfully in daylight or in night. cambridgeInstant() is the same wall-clock-to-instant
   * conversion Lighting.tsx uses for the building's sun, so the globe and the building cannot
   * disagree about what time it is -- solar.ts's header is emphatic that this conversion is the
   * easy thing to get wrong, and doing it in one place is how that is avoided.
   *
   * Converted to the site frame HERE rather than in the shader, because geoToSite() is a tested
   * function and a hand-rolled matrix multiply in GLSL would not be.
   */
  const sunSite = useMemo(() => {
    const { lat, lon } = subsolarPoint(cambridgeInstant(date, hour));
    const f = lat * (Math.PI / 180);
    const l = lon * (Math.PI / 180);
    const geo: Vec3 = [
      Math.cos(f) * Math.cos(l),
      Math.sin(f),
      -Math.cos(f) * Math.sin(l),
    ];
    return new THREE.Vector3(...geoToSite(geo, weldBasis()));
  }, [date, hour]);

  const marker = useMemo(markerDirection, []);

  /**
   * The Blue Marble, loaded imperatively.
   *
   * NOT useTexture / useLoader, for the reason imagery.ts's header sets out at length: a
   * suspending child of <Canvas> suspends the whole page back to "LOADING WELD 15", and stage 0
   * IS first paint, so this is the single worst place in the app to suspend. Until it arrives the
   * sphere is drawn in the flat DAY colour, which is what the grey-box shipped with.
   */
  const [day, setDay] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const urls = levelUrls("L0");
    if (urls.length === 0) return;
    return loadTexture(urls, setDay);
  }, []);

  /**
   * The uniforms, built once each.
   *
   * Once, and held across renders, because a fresh uniforms object makes three recompile the
   * program and a shader recompile mid-descent is a visible stall. Values that change -- the
   * opacity ramp, the sun -- are written through the refs in the frame loop instead.
   *
   * uPower 3 for the rim was chosen against the alternatives: 1 is a haze over the whole disc,
   * which is exactly the defect the constant-opacity version had, and 6 is a hairline that has
   * disappeared by the altitudes where the globe is already fading out.
   */
  const surfaceUniforms = useMemo(
    () => ({
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uDay: { value: new THREE.Color(DAY) },
      uNight: { value: new THREE.Color(NIGHT) },
      uOpacity: { value: 1 },
      uMap: { value: null as THREE.Texture | null },
      uHasMap: { value: 0 },
    }),
    [],
  );

  const rimUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(ATMOSPHERE) },
      uOpacity: { value: 0.55 },
      uPower: { value: 3 },
    }),
    [],
  );

  /**
   * Place and scale the proxy every frame, from the camera's own altitude.
   *
   * PER FRAME AND NOT PER RENDER, because the rig is a function of the camera position and the
   * camera moves sixty times a second while the descent runs.
   *
   * The group's SCALE carries the radius rather than the geometry, so the sphere is built once
   * at unit radius and rescaled. A SphereGeometry rebuilt per frame at a new radius would
   * allocate and upload a buffer sixty times a second for no visual difference at all.
   */
  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    const alt = camera.position.y;
    const o = layerOpacity(alt);

    // Zero opacity is INVISIBLE, not transparent-and-drawn. Below 40,000 ft the globe
    // contributes nothing, and a fully transparent sphere still costs its draw calls -- and,
    // because three collects lights and meshes by walking visible objects only, an invisible
    // group costs nothing at all.
    g.visible = visible && o.globe > 0;
    if (!g.visible) return;

    const rig = globeRig([camera.position.x, camera.position.y, camera.position.z], alt);
    g.position.set(rig.centre[0], rig.centre[1], rig.centre[2]);
    g.scale.setScalar(rig.radius);

    if (surface.current) {
      const u = surface.current.uniforms;
      u.uOpacity!.value = o.globe;
      (u.uSun!.value as THREE.Vector3).copy(sunSite);
      // THROUGH THE MATERIAL'S OWN UNIFORMS, for the reason Ground.tsx records in full: mutating
      // the memoised object handed to <shaderMaterial uniforms={...}> writes to a copy, the
      // sampler stays unbound, and nothing is drawn without an error being raised.
      if (day && u.uMap!.value !== day) {
        u.uMap!.value = day;
        u.uHasMap!.value = 1;
      }
    }
    if (rim.current) rim.current.uniforms.uOpacity!.value = 0.55 * o.globe;

    // Development only, and it reports rather than throws: an Earth that is silently absent
    // looks exactly like a texture that failed to load, so the hours go into the wrong file.
    if (process.env.NODE_ENV !== "production" && !warned.current) {
      const problem = assertRigVisible(alt);
      if (problem) {
        warned.current = true;
        console.warn(`[Globe] ${problem}`);
      }
    }
  });

  return (
    <group ref={group} visible={visible}>
      {/* The geocentric-to-site rotation lives on an inner group so the outer one keeps
          position and scale -- which the frame loop writes every frame -- separate from the
          orientation, which is computed once and never changes. */}
      <group quaternion={orientation}>
        <mesh renderOrder={ORDER.surface}>
          <sphereGeometry args={[1, 64, 48]} />
          <shaderMaterial
            ref={surface}
            vertexShader={SURFACE_VERT}
            fragmentShader={SURFACE_FRAG}
            uniforms={surfaceUniforms}
            transparent
            depthTest={false}
            depthWrite={false}
          />
        </mesh>

        {/* The rim's job is that the limb does not read as a cut-out against the void. One
            extra draw call; see RIM_FRAG for why it is a shader and not a trick. */}
        <mesh renderOrder={ORDER.rim} scale={1.025}>
          <sphereGeometry args={[1, 64, 48]} />
          <shaderMaterial
            ref={rim}
            vertexShader={RIM_VERT}
            fragmentShader={RIM_FRAG}
            uniforms={rimUniforms}
            transparent
            side={THREE.BackSide}
            blending={THREE.AdditiveBlending}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>

        {/* Weld, which is the only thing on screen at stage 0 that says where this is going.
            1.004 so it stands proud of the surface; with no depth test what that actually buys
            is that it is not co-planar and z-fighting is impossible by construction. */}
        <mesh
          position={[marker[0] * 1.004, marker[1] * 1.004, marker[2] * 1.004]}
          renderOrder={ORDER.marker}
        >
          <sphereGeometry args={[0.022, 16, 12]} />
          <meshBasicMaterial
            color="#e4526f"
            transparent
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  );
}
