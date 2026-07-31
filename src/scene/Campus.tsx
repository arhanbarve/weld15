"use client";

import { useEffect, useMemo, useRef } from "react";
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
 * The ramp the mass fill climbs as the camera descends, and where its two ends come from.
 *
 * MERGE NOTE, because this reconciles two changes that landed independently. The high-contrast work
 * above set a FLAT fill: MASS_OPACITY normally, CONTRAST_MASS under the toggle. P9 put a photograph
 * under these buildings and needed the fill to climb with altitude. Both survive: the flat pair is
 * the FLOOR of the ramp, and the ramp is what happens below 40,000 ft.
 *
 * WHY THERE IS A RAMP AT ALL. At the flat 0.12 the mass barely touches the image beneath it.
 * Measured at stage 2, luminance standard deviation inside an 80 x 60 patch:
 *
 *   open ground, no building over it        sd 29.51   mean  91.6
 *   a library's roof, under 0.12 of mass    sd 28.88   mean 100.1
 *
 * Two per cent of the photograph's texture removed. So each footprint was marked only by its edges
 * and the roof inside it was still the photograph, which is the doubled image decision 9 asked to
 * get rid of.
 *
 * WHY THE CEILING IS 0.34 AND NOT THE 0.81 THAT WOULD ACTUALLY HIDE IT. Blending is linear, so the
 * residual texture is (1 - alpha) times the photograph's, and getting sd under 6 -- flat enough to
 * call hidden -- needs alpha above 0.81. A campus at 0.81 is not a cyanotype; it is solid blue
 * blocks, and translucent massing over line work is the whole of the SCAN palette. So this is a
 * deliberate partial: 0.34 cuts the residual by a quarter, enough that a footprint reads as
 * occupied rather than as a rectangle drawn on a photograph. P9.md section 6.9 asked for full
 * occlusion and it is not achievable without losing the look; that is recorded rather than quietly
 * not done, and tests/labels.test.ts asserts MASS_CEILING < 0.5 so nobody "finishes" it by accident.
 *
 * THE HIGH-CONTRAST GAIN IS DERIVED, NOT WRITTEN DOWN. CONTRAST_MASS / MASS_OPACITY is 1.833, and
 * using that ratio rather than a third literal is what keeps the floor at MASTER's 0.22 exactly --
 * which is the figure tests/e2e/contrast.spec.ts asserts through the window.__campus probe below.
 * An earlier version of this ramp carried its own gain of 2.2, derived from the --mass TOKEN's 0.10
 * rather than from the 0.12 this file actually draws, and it would have put the high-contrast floor
 * at 0.264 and failed that gate.
 */
const MASS_CEILING = 0.34;
const HIGH_CONTRAST_GAIN = CONTRAST_MASS / MASS_OPACITY;

/**
 * How much denser Weld's pulse is than the rest of the campus.
 *
 * A MULTIPLIER ON THE RAMP rather than an absolute range, which is the change the ramp forces. The
 * pulse used to run 0.20 to 0.34 against a flat 0.12, with `Math.max(mass, ...)` flooring it under
 * high contrast. Once the rest of the campus also reaches 0.34, an absolute pulse at 0.34 makes the
 * highlighted building identical to its neighbours at exactly the stage it most needs to stand out.
 * As a multiple it stays ahead at every altitude, and the high-contrast floor comes for free because
 * the gain is already inside the base it multiplies.
 */
const WELD_PULSE = { lo: 1.0, hi: 1.55, reduced: 1.4 } as const;

/** The mass fill at an altitude. Pure, so the ramp is asserted without a renderer. */
function massAt(alt: number, highContrast: boolean): number {
  const floor = highContrast ? CONTRAST_MASS : MASS_OPACITY;
  const ceiling = MASS_CEILING * (highContrast ? HIGH_CONTRAST_GAIN : 1);
  return floor + (ceiling - floor) * layerOpacity(alt).massing;
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
  const high = useStore((s) => s.highContrast);
  const weldMass = useRef<THREE.MeshStandardMaterial>(null);
  const otherMass = useRef<THREE.MeshStandardMaterial>(null);

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

useFrame(({ clock, camera }) => {
    // ONE PLACE READS THE ALTITUDE, and both materials come off it, so the campus can never be
    // half-ramped. camera.position.y IS the altitude by definition -- altitude.ts's header sets
    // that out -- and CameraRig has already placed the camera for this frame.
    const base = massAt(camera.position.y, high);
    if (otherMass.current) otherMass.current.opacity = base;
    if (!weldMass.current) return;
    if (!highlightWeld) {
      weldMass.current.opacity = base;
      return;
    }
    // Reduced motion holds the pulse at a fixed multiple instead of animating. No Math.max floor is
    // needed any more: the high-contrast gain is already inside `base`, so the trough rises with it,
    // which is what the old `Math.max(mass, ...)` was there to guarantee.
    const k = reduced
      ? WELD_PULSE.reduced
      : WELD_PULSE.lo + (WELD_PULSE.hi - WELD_PULSE.lo) * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.6));
    weldMass.current.opacity = Math.min(1, base * k);
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
    // `massOpacity` stays the DESIGN-SYSTEM figure -- MASTER's 0.12 / 0.22 -- because that is what
    // contrast.spec.ts asserts, and it is still literally what is drawn at the top of the ramp where
    // the massing band is zero. `massCeiling` is added so the probe is not misleading now that the
    // fill climbs: below 40,000 ft what reaches the GPU is between the two.
    const probe = {
      highContrast: high,
      dpr,
      lineWidth: baseWidth,
      weldLineWidth: weldWidth,
      massOpacity: mass,
      massCeiling: MASS_CEILING * (high ? HIGH_CONTRAST_GAIN : 1),
    };
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
          ref={otherMass}
          color={SCAN.mass}
          roughness={1}
          metalness={0}
          transparent
          // The initial value only; the frame loop writes it from the altitude every frame.
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
          opacity={mass}
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
export { massAt, MASS_OPACITY, CONTRAST_MASS, MASS_CEILING, HIGH_CONTRAST_GAIN };

/** LineSegmentsGeometry wants point pairs; our buffer is a flat position list. */
function toPointPairs(g: THREE.BufferGeometry): [number, number, number][] {
  const pos = g.getAttribute("position");
  const out: [number, number, number][] = [];
  for (let i = 0; i < pos.count; i++) {
    out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  }
  return out;
}
