"use client";

import { useEffect, useMemo, useRef } from "react";
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
 * Stroke widths in CSS pixels, before the DPR term below multiplies them.
 *
 * BASE is MASTER.md's 1.5 px floor for line work on dark. WELD is the wider stroke that
 * is one of Weld's three non-hue signals -- 1.47x BASE, and the ratio is what the high
 * contrast branch preserves rather than the difference, so the highlight cannot be
 * overtaken by the buildings around it.
 *
 * CONTRAST is MASTER.md §Accessibility gates, quoted: the high-contrast toggle "thickens
 * strokes to 2.5px". It is applied as a multiplier on BASE rather than as a second pair of
 * literals, so 2.5 is honoured exactly where MASTER states it and Weld's margin comes out
 * of the same arithmetic.
 */
const BASE_WIDTH = 1.5;
const WELD_WIDTH = 2.2;
const CONTRAST_WIDTH = 2.5;

/**
 * The mass fill, and MASTER.md's other high-contrast value: `--mass` opacity to 0.22.
 *
 * 0.12 rather than the --mass token's own 0.10 because these are meshes lit by
 * Lighting.tsx rather than a flat CSS fill, and 0.12 is what P3 settled on for the
 * translucent Prussian blocks. 0.22 is MASTER's figure, and it is applied to the fill and
 * as a FLOOR under Weld's pulse -- the pulse runs 0.20 to 0.34, so its trough would
 * otherwise be the one part of the frame high contrast made no denser.
 */
const MASS_OPACITY = 0.12;
const CONTRAST_MASS = 0.22;

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
  const high = useStore((s) => s.highContrast);
  const weldMass = useRef<THREE.MeshStandardMaterial>(null);

  const geo = useMemo(() => buildCampusGeometry(), []);

  const edgePoints = useMemo(() => toPointPairs(geo.otherEdges), [geo.otherEdges]);
  const weldEdgePoints = useMemo(() => toPointPairs(geo.weldEdges), [geo.weldEdges]);

  // Scale line width with device pixel ratio so the 1.5px floor is 1.5 CSS px
  // rather than 1.5 device px, which on a 2x display would read as 0.75.
  //
  // High contrast multiplies the SAME term, so 2.5 is 2.5 CSS px on both displays: the
  // checklist's measurement of the shipped scene is the proof this is the mechanism that
  // reaches the GPU -- the stroke histogram's mode moves from 2 device px at DPR 1 to 6-7
  // at DPR 2, which an unscaled gl.lineWidth (capped at 1 on every driver) could not do.
  const scale = Math.max(1, dpr);
  const boost = high ? CONTRAST_WIDTH / BASE_WIDTH : 1;
  const baseWidth = BASE_WIDTH * boost * scale;
  const weldWidth = WELD_WIDTH * boost * scale;
  const mass = high ? CONTRAST_MASS : MASS_OPACITY;

  useFrame(({ clock }) => {
    if (!weldMass.current || !highlightWeld) return;
    // Reduced motion holds the pulse at its brightest instead of animating.
    // Under high contrast `mass` is 0.22 and floors the pulse's 0.20 trough; with the
    // toggle off it is 0.12 and the max is a no-op, so the pulse is bit-for-bit what it
    // was -- which is what keeps campus.spec.ts's hue/pulse gates measuring the same thing.
    weldMass.current.opacity = reduced
      ? 0.34
      : Math.max(mass, 0.2 + 0.14 * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.6)));
  });

  /**
   * window.__campus, for the gates.
   *
   * Same device as CameraRig's window.__cam, Perf's window.__perf and DragLayer's
   * window.__drag, and for the same reason those exist: what MASTER.md specifies here is a
   * line width and a fill opacity inside a WebGL frame, and there is no DOM to read them
   * off. A pixel measurement can show the strokes got thicker -- tests/e2e/contrast.spec.ts
   * does that too -- but it cannot show they are 2.5 CSS px rather than 2.3, because a
   * bloom pass spreads every bright pixel and the checklist records that limit. This
   * publishes the number that was actually handed to <Line>, so the gate can assert
   * MASTER's figure exactly, and at DPR 2 as well.
   *
   * An effect rather than an assignment in the body, so it does not run during render and
   * so it cleans up: a stale probe left behind by an unmounted campus is a gate reading a
   * number nothing is drawing.
   */
  useEffect(() => {
    const probe = { highContrast: high, dpr, lineWidth: baseWidth, weldLineWidth: weldWidth, massOpacity: mass };
    const w = window as unknown as { __campus?: typeof probe };
    w.__campus = probe;
    return () => {
      if (w.__campus === probe) delete w.__campus;
    };
  }, [high, dpr, baseWidth, weldWidth, mass]);

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
          opacity={mass}
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
          opacity={highlightWeld ? 0.3 : mass}
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

      <gridHelper args={[3000, 60, SCAN.grid, SCAN.grid]} position={[0, -0.5, 0]} />
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
