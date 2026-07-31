"use client";

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line, Html } from "@react-three/drei";
import * as THREE from "three";
import { buildCampusGeometry } from "./campusGeometry";
import { useStore } from "@/state/store";
import weld from "@/data/weld.json";

const SCAN = {
  mass: "#96c8f5",
  edge: "#8fc4f2",
  edgeHi: "#ffffff",
  grid: "#0c3260",
} as const;

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

  const geo = useMemo(() => buildCampusGeometry(), []);

  const edgePoints = useMemo(() => toPointPairs(geo.otherEdges), [geo.otherEdges]);
  const weldEdgePoints = useMemo(() => toPointPairs(geo.weldEdges), [geo.weldEdges]);

  // Scale line width with device pixel ratio so the 1.5px floor is 1.5 CSS px
  // rather than 1.5 device px, which on a 2x display would read as 0.75.
  const scale = Math.max(1, dpr);
  const baseWidth = 1.5 * scale;
  const weldWidth = 2.2 * scale;

  useFrame(({ clock }) => {
    if (!weldMass.current || !highlightWeld) return;
    // Reduced motion holds the pulse at its brightest instead of animating.
    weldMass.current.opacity = reduced
      ? 0.34
      : 0.2 + 0.14 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.6));
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
          color={SCAN.mass}
          roughness={1}
          metalness={0}
          transparent
          opacity={0.12}
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
          opacity={highlightWeld ? 0.3 : 0.12}
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

/** LineSegmentsGeometry wants point pairs; our buffer is a flat position list. */
function toPointPairs(g: THREE.BufferGeometry): [number, number, number][] {
  const pos = g.getAttribute("position");
  const out: [number, number, number][] = [];
  for (let i = 0; i < pos.count; i++) {
    out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  }
  return out;
}
