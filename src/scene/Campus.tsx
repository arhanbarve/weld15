"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Line, Html } from "@react-three/drei";
import * as THREE from "three";
import { buildCampusGeometry } from "./campusGeometry";
import { useStore } from "@/state/store";
import weld from "@/data/weld.json";
import { CampusMesh } from "./CampusMesh";

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
 * The buildings are solid now, and they are the buildings.
 *
 * THROUGH P9, this file carried an 80-line opacity ramp -- MASS_OPACITY, CONTRAST_MASS,
 * MASS_CEILING, HIGH_CONTRAST_GAIN and the massAt() function deriving a fill capped at 0.34,
 * because P9.md section 6.9 asked for full occlusion of the photographed roof underneath and
 * blending math meant getting there needed alpha above 0.81 -- past the point a translucent
 * cyanotype block still reads as one. So it shipped a documented partial and a test
 * (tests/labels.test.ts) that asserted the ceiling stayed under 0.5, guarding against someone
 * "finishing" the occlusion by raising a number.
 *
 * P10 FINISHES IT, AND TWO BRANCHES FINISHED IT DIFFERENTLY. `p10-ux` step 10 made these same
 * extruded footprints opaque and skinned their roofs with the L4 photograph (src/scene/aerial.ts,
 * `attachAerialSkin`), which is full occlusion over the massing this project already had.
 * `p10-imagery` replaced the massing instead: CampusMesh.tsx carries Harvard's own building
 * meshes, decoded from their published I3S scene layer, with walls, roofs, bases and trim
 * classified per vertex and coloured from MASONRY. The second supersedes the first -- an
 * aerial photograph stretched over a box is a stand-in for a building, and there is no longer
 * anything to stand in for -- so the boxes, their roof skin and the ramp they replaced are all
 * gone together. `src/scene/imagery.ts`'s sharedTexture() stays: Ground.tsx uses it.
 *
 * WHAT WELD'S HIGHLIGHT LOST, AND WHY THAT IS STILL THREE SIGNALS. `p10-ux` moved Weld's pulse
 * from `material.opacity` to `emissiveIntensity` on its own mass mesh. There is no Weld mass
 * mesh any more -- Weld is excluded from campus.glb on purpose (fetch-buildings.mjs's WELD
 * note) because weldGeometry.ts draws it parametrically -- so the pulse has nothing to write
 * to and is gone. MASTER.md asks for three signals that are not hue, and three remain, all on
 * the outline and the chip: a wider stroke (WELD_WIDTH against BASE_WIDTH), full opacity
 * against the neighbours' 0.7, and the "Weld Hall" label. Recorded rather than quietly dropped.
 */

/**
 * The campus: white line work over Harvard's own building meshes.
 *
 * Two things here are not cosmetic.
 *
 * Line width: gl.lineWidth is capped at 1px on every major platform and silently
 * ignored, so edges use drei's <Line>, which is LineSegments2 and draws lines as
 * camera-facing quads. MASTER.md requires at least 1.5px at 1x DPR because the
 * style DB rates thin-line-on-dark as poor for accessibility, and this entire look
 * is thin lines on dark.
 *
 * Weld's highlight: three signals, never hue alone. A wider stroke, a fully opaque one
 * where the neighbours draw at 0.7, and a DOM label chip on a solid ground.
 */
export function Campus({ visible, highlightWeld }: { visible: boolean; highlightWeld: boolean }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const high = useStore((s) => s.highContrast);

  const geo = useMemo(() => buildCampusGeometry(), []);

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

  /**
   * window.__campus, for the gates.
   *
   * Same device as CameraRig's window.__cam, Perf's window.__perf and DragLayer's
   * window.__drag, and for the same reason those exist: what MASTER.md specifies here is a
   * line width inside a WebGL frame, and there is no DOM to read it off. A pixel measurement can
   * show the strokes got thicker -- tests/e2e/contrast.spec.ts does that too -- but it cannot
   * show they are 2.5 CSS px rather than 2.3, because a bloom pass spreads every bright pixel and
   * the checklist records that limit. This publishes the number that was actually handed to
   * <Line>, so the gate can assert MASTER's figure exactly, and at DPR 2 as well.
   *
   * `massOpacity`/`massCeiling` are gone with the ramp they described, and so is the
   * `weldEmissive` that briefly replaced them: nothing pulses any more (see this file's header).
   * What is left is exactly what MASTER states and a pixel cannot prove -- the two widths.
   *
   * An effect rather than an assignment in the body, so it does not run during render and
   * so it cleans up: a stale probe left behind by an unmounted campus is a gate reading a
   * number nothing is drawing.
   */
  useEffect(() => {
    const probe = {
      highContrast: high,
      dpr,
      lineWidth: baseWidth,
      weldLineWidth: weldWidth,
    };
    const w = window as unknown as { __campus?: typeof probe };
    w.__campus = probe;
    return () => {
      if (w.__campus === probe) delete w.__campus;
    };
  }, [high, dpr, baseWidth, weldWidth]);

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
      <CampusMesh visible={visible} />

      {/* THE TWO MASS FILLS AND THE NON-WELD EDGE LINE ARE RETIRED IN P10. They read
              <mesh geometry={geo.others}><meshStandardMaterial ref={otherMass} color={SCAN.mass} .../></mesh>
              <mesh geometry={geo.weld}><meshStandardMaterial ref={weldMass} color={SCAN.mass} .../></mesh>
              <Line points={edgePoints} segments color={SCAN.edge} lineWidth={baseWidth} transparent opacity={0.7} />
          and their whole job was to stand in for buildings this project had no real geometry for --
          translucent blue boxes and a white wireframe over an aerial photograph. CampusMesh.tsx now
          carries Harvard's own building meshes and crosses out of that same cyanotype into brick,
          slate, granite and sandstone on the identical layerOpacity().massing band the mass fill used
          to climb, so the stand-in has nothing left to stand in for. Weld's own outline and label
          stay below: they are the highlight, not the massing, and MASTER.md requires three non-hue
          signals for it. Removed rather than commented out in place; this note is the record.
          massAt() and its ramp constants went at the merge as well: CampusMesh reads
          layerOpacity().massing directly, so there was nothing left for a pure ramp function to
          be the testable half of. */}

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
