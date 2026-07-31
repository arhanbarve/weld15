"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line, Html } from "@react-three/drei";
import * as THREE from "three";
import { buildCampusGeometry } from "./campusGeometry";
import { layerOpacity } from "./altitude";
import { useStore } from "@/state/store";
import weld from "@/data/weld.json";

const SCAN = {
  mass: "#96c8f5",
  edge: "#8fc4f2",
  edgeHi: "#ffffff",
  grid: "#0c3260",
} as const;

/**
 * Mass opacity at the top and bottom of the altitude ramp.
 *
 * WHY THERE IS A RAMP AT ALL. P9 put a photograph under these buildings, and at the opacity that
 * shipped before it -- a flat 0.12 -- the mass barely touches the image beneath it. Measured at
 * stage 2, luminance standard deviation inside an 80 x 60 patch:
 *
 *   open ground, no building over it        sd 29.51   mean  91.6
 *   a library's roof, under 0.12 of mass    sd 28.88   mean 100.1
 *
 * Two per cent of the photograph's texture removed. So each footprint was marked only by its
 * edges, and the roof inside it was still the photograph -- which is the doubled image decision 9
 * asked to get rid of.
 *
 * WHY THE CEILING IS 0.34 AND NOT THE 0.81 THAT WOULD ACTUALLY HIDE IT. Blending is linear, so the
 * residual texture is (1 - alpha) times the photograph's. Getting sd under 6 -- flat enough to call
 * hidden -- needs alpha above 0.81, and a campus at 0.81 is not a cyanotype: it is a set of solid
 * blue blocks, and translucent massing over line work is the whole of the SCAN palette.
 * MASTER.md's --mass token is 0.10. So this is a deliberate partial: 0.34 at the bottom of the
 * ramp cuts the residual texture by a quarter, which is enough that a footprint reads as occupied
 * rather than as a rectangle drawn on a photograph, and the palette survives. 0.34 is not a new
 * number either -- it is what the highlighted Weld pulse already peaked at, so the campus at its
 * most solid is exactly as solid as one highlighted building used to be.
 *
 * THE SPEC ASKED FOR FULL OCCLUSION (section 6.9) AND IT IS NOT ACHIEVABLE WITHOUT LOSING THE
 * LOOK. That is recorded here rather than quietly not done.
 */
const MASS_MIN = 0.1;
const MASS_MAX = 0.34;

/**
 * High-contrast multiplier, from MASTER.md's own pair.
 *
 * The token is 0.10 normally and 0.22 in high contrast, so the ratio the design system already
 * specifies is 2.2, and section 6.9 asks for the ramp's ceiling to rise "in the same proportion".
 * Applied to both ends, so 0.22 to 0.75 -- and 0.75 is the one place a nearly solid mass is right,
 * because high contrast is precisely the setting where legibility beats atmosphere.
 */
const HIGH_CONTRAST_GAIN = 2.2;

/**
 * How much brighter Weld's pulse is than the rest of the campus.
 *
 * A MULTIPLIER ON THE RAMP rather than an absolute range, which is the change the ramp forces: the
 * pulse used to run 0.2 to 0.34 against a fixed 0.12 for everything else, and once the rest of the
 * campus reaches 0.34 an absolute pulse at 0.34 would make the highlighted building identical to
 * its neighbours at exactly the stage it most needs to stand out. As a multiple it stays ahead at
 * every altitude.
 */
const WELD_PULSE = { lo: 1.0, hi: 1.55, reduced: 1.4 } as const;

/** Mass opacity for an altitude. Pure, so the ramp can be reasoned about without a renderer. */
function massOpacity(alt: number, highContrast: boolean): number {
  const gain = highContrast ? HIGH_CONTRAST_GAIN : 1;
  const t = layerOpacity(alt).massing;
  return (MASS_MIN + (MASS_MAX - MASS_MIN) * t) * gain;
}

/**
 * The campus as a cyanotype: white line work over translucent Prussian masses.
 *
 * Two things here are not cosmetic.
 *
 * Line width: gl.lineWidth is capped at 1px on every major platform and silently
 * ignored, so edges use drei's <Line>, which is LineSegments2 and draws lines as
 * camera-facing quads. MASTER.md requires at least 1.5px at 1x DPR because the
 * style DB rates thin-line-on-dark as poor for accessibility, and this entire look
 * is thin lines on dark.
 *
 * Weld's highlight: three signals, never hue alone. Brighter and wider edges, a
 * slow opacity pulse, and a DOM label chip on a solid ground.
 */
export function Campus({ visible, highlightWeld }: { visible: boolean; highlightWeld: boolean }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const reduced = useStore((s) => s.reducedMotion);
  const weldMass = useRef<THREE.MeshStandardMaterial>(null);
  const otherMass = useRef<THREE.MeshStandardMaterial>(null);

  /**
   * Whether the viewer has asked for more contrast.
   *
   * Read here rather than from the store because nothing else in the app needs it yet, and a store
   * field with one reader is a field that will drift from its media query. Subscribed rather than
   * sampled once, so a viewer who turns it on mid-session gets it.
   */
  const [highContrast, setHighContrast] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-contrast: more)");
    setHighContrast(mq.matches);
    const onChange = () => setHighContrast(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const geo = useMemo(() => buildCampusGeometry(), []);

  const edgePoints = useMemo(() => toPointPairs(geo.otherEdges), [geo.otherEdges]);
  const weldEdgePoints = useMemo(() => toPointPairs(geo.weldEdges), [geo.weldEdges]);

  // Scale line width with device pixel ratio so the 1.5px floor is 1.5 CSS px
  // rather than 1.5 device px, which on a 2x display would read as 0.75.
  const scale = Math.max(1, dpr);
  const baseWidth = 1.5 * scale;
  const weldWidth = 2.2 * scale;

  useFrame(({ clock, camera }) => {
    // ONE PLACE READS THE ALTITUDE, and both materials come off it, so the campus can never be
    // half-ramped. camera.position.y IS the altitude by definition -- altitude.ts's header sets
    // that out -- and CameraRig has already placed the camera for this frame.
    const base = massOpacity(camera.position.y, highContrast);
    if (otherMass.current) otherMass.current.opacity = base;
    if (!weldMass.current) return;
    if (!highlightWeld) {
      weldMass.current.opacity = base;
      return;
    }
    // Reduced motion holds the pulse at a fixed multiple instead of animating.
    const k = reduced
      ? WELD_PULSE.reduced
      : WELD_PULSE.lo + (WELD_PULSE.hi - WELD_PULSE.lo) * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.6));
    weldMass.current.opacity = Math.min(1, base * k);
  });

  const label = useMemo(() => {
    const half = weld.meta.length_ft / 2;
    const a = (weld.meta.long_axis_deg_e_of_n * Math.PI) / 180;
    return new THREE.Vector3(
      Math.sin(a) * half * 0.2,
      weld.meta.ridge_height_ft + 26,
      -Math.cos(a) * half * 0.2,
    );
  }, []);

  return (
    <group visible={visible}>
      {/* masses: 35 buildings in one draw call, Weld separate so it stays styleable */}
      <mesh geometry={geo.others}>
        <meshStandardMaterial
          ref={otherMass}
          color={SCAN.mass}
          roughness={1}
          metalness={0}
          transparent
          // The initial value only; the frame loop writes it from the altitude every frame.
          opacity={MASS_MIN}
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={geo.weld}>
        <meshStandardMaterial
          ref={weldMass}
          color={SCAN.mass}
          roughness={1}
          metalness={0}
          transparent
          opacity={MASS_MIN}
          depthWrite={false}
        />
      </mesh>

      <Line points={edgePoints} segments color={SCAN.edge} lineWidth={baseWidth} transparent opacity={0.7} />
      <Line
        points={weldEdgePoints}
        segments
        color={highlightWeld ? SCAN.edgeHi : SCAN.edge}
        lineWidth={highlightWeld ? weldWidth : baseWidth}
        transparent
        opacity={highlightWeld ? 1 : 0.7}
      />

      {highlightWeld ? (
        <Html position={label} center distanceFactor={520} zIndexRange={[10, 0]}>
          <span className="weld-chip">Weld Hall</span>
        </Html>
      ) : null}

      {/* THE gridHelper IS RETIRED IN P9. It read
              <gridHelper args={[3000, 60, SCAN.grid, SCAN.grid]} position={[0, -0.5, 0]} />
          and its whole job was to say "there is a ground here" under buildings that would
          otherwise float in a void. There is now a ground -- Ground.tsx, four georeferenced
          photographic quads -- so the stand-in has nothing left to stand in for, and a 60-division
          grid over an aerial photograph reads as a bug rather than as a drawing. Removed rather
          than commented out in place; this note is the record. */}
    </group>
  );
}

/** Exported for tests: the ramp is a pure function and is asserted without a renderer. */
export { massOpacity, MASS_MIN, MASS_MAX, HIGH_CONTRAST_GAIN };

/** LineSegmentsGeometry wants point pairs; our buffer is a flat position list. */
function toPointPairs(g: THREE.BufferGeometry): [number, number, number][] {
  const pos = g.getAttribute("position");
  const out: [number, number, number][] = [];
  for (let i = 0; i < pos.count; i++) {
    out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  }
  return out;
}
