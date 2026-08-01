"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Line, Html } from "@react-three/drei";
import * as THREE from "three";
import { buildCampusGeometry } from "./campusGeometry";
import { attachAerialSkin, aerialUniforms } from "./aerial";
import { quadOf, sharedTexture } from "./imagery";
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
 * The buildings are solid now, not a translucent ramp.
 *
 * THROUGH P9, this file carried an 80-line opacity ramp -- MASS_OPACITY, CONTRAST_MASS,
 * MASS_CEILING, HIGH_CONTRAST_GAIN and the massAt() function deriving a fill capped at 0.34,
 * because P9.md section 6.9 asked for full occlusion of the photographed roof underneath and
 * blending math meant getting there needed alpha above 0.81 -- past the point a translucent
 * cyanotype block still reads as one. So it shipped a documented partial and a test
 * (tests/labels.test.ts) that asserted the ceiling stayed under 0.5, guarding against someone
 * "finishing" the occlusion by raising a number.
 *
 * P10 finishes it a different way. The masses are opaque MeshStandardMaterials with their own
 * default depthWrite, so a roof is genuinely hidden by the building standing over it rather than
 * partially seen through it -- which is what section 6.9 asked for and an opacity ramp capped
 * short of "solid" could not deliver. aerial.ts's `attachAerialSkin` puts the photograph back on
 * top, so what an opaque building loses (the ground drawing showing through) it gets back as its
 * own roof.
 *
 * THE RANGE, MEASURED RATHER THAN CARRIED OVER FROM THE OLD OPACITY PULSE. A first pass kept the
 * dissolve-era numbers verbatim -- lo 1.0, hi 1.55 -- on the assumption that an emissive intensity
 * and an opacity fraction are interchangeable units. They are not: opacity blends toward the
 * background, capped at 1, while emissive ADDS to the lit, textured colour underneath with no
 * such cap, and `edgeHi` is pure white. At lo 1.0 every one of Weld's photographed-roof pixels
 * blew straight to (1,1,1) -- a solid white block, screenshotted and caught rather than inferred --
 * which erased the one thing this step exists to put on Weld's mass: its own photographed roof.
 *
 * 0.1-0.35 IS THE SECOND MEASUREMENT, NOT THE FIRST. 0.15-0.45 fixed the blowout -- the roof's
 * texture stayed legible at both ends, confirmed by screenshot -- but it moved the amplitude
 * that had been swept away with the opacity ramp: `emissiveIntensity` at that range still lifts
 * enough of the photographed roof's own near-white pixels to make the pulse's PHASE, not just
 * its presence, show up in pixel-counting gates. Two of them do: contrast.spec.ts's white-pixel
 * ratio at stage 2 read as low as 1.023 across repeated full-suite runs against a bound written
 * for a tighter signal, and campus.spec.ts's stage 1 vs stage 2 comparison failed outright once
 * at 959 against a required 1,097. Both gates already take a median of several samples for
 * exactly this class of noise (Weld's mass pulses continuously); 0.1-0.35 is the amplitude
 * measured to keep both stable across repeated runs while the highlight stays visible -- three
 * runs of contrast.spec.ts's own ratio at 1.130, 1.104, 1.106, and campus.spec.ts's stage 2 count
 * at 1,305 and 1,328 against stage 1's steady 299.
 */
const WELD_PULSE = { lo: 0.1, hi: 0.35, reduced: 0.22 } as const;

/**
 * The plate the roof skin samples, and its extent: L4, the same 1,600 x 1,600 ft plate
 * Ground.tsx's own innermost quad draws, so the two can share one THREE.Texture through
 * imagery.ts's sharedTexture(). See aerial.ts's header for the margin measurement and the UV
 * sign convention.
 */
const L4 = quadOf("L4")!;
const AERIAL_EXTENT = {
  minX: L4.cx - L4.width / 2,
  minY: L4.cy - L4.height / 2,
  width: L4.width,
  height: L4.height,
};

/**
 * The campus: white line work over solid, photographed massing.
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
 * slow emissive pulse (opacity through P9, moved since the buildings became opaque),
 * and a DOM label chip on a solid ground.
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

  // One AerialUniforms object per material: both want the same L4 plate and the same wall tone,
  // but each is its own uniform set because attachAerialSkin binds them by reference into the
  // material's own compiled shader. `useMemo` rather than a ref so the extent -- fixed at import
  // time from the manifest -- is only ever computed once per material's lifetime.
  const otherAerial = useMemo(() => aerialUniforms(SCAN.mass, AERIAL_EXTENT), []);
  const weldAerial = useMemo(() => aerialUniforms(SCAN.mass, AERIAL_EXTENT), []);

  // The one THREE.Texture for L4, shared with Ground.tsx's own Q4 quad rather than uploaded a
  // second time -- imagery.ts's sharedTexture() and aerial.ts's header both carry the reason.
  useEffect(
    () =>
      sharedTexture("L4", (t) => {
        otherAerial.uAerial.value = t;
        weldAerial.uAerial.value = t;
      }),
    [otherAerial, weldAerial],
  );

  // Attached once, on mount: onBeforeCompile is set on the material object itself and the
  // uniforms it captures are updated by mutating their `.value` fields (the texture arriving,
  // above), never by re-attaching.
  useEffect(() => {
    if (otherMass.current) attachAerialSkin(otherMass.current, otherAerial);
  }, [otherAerial]);
  useEffect(() => {
    if (weldMass.current) attachAerialSkin(weldMass.current, weldAerial);
  }, [weldAerial]);

  useFrame(({ clock }) => {
    // Weld's highlight, since P10 an emissive glow rather than a denser fill -- the building is
    // opaque now, so there is no alpha left for a pulse to ramp. Same WELD_PULSE range and the
    // same 1.6 rad/s; `emissive` is SCAN.edgeHi, the same white Weld's line work already
    // highlights in, so the third non-hue signal reads as "this building" rather than as a new
    // colour of its own.
    if (!weldMass.current) return;
    if (!highlightWeld) {
      weldMass.current.emissiveIntensity = 0;
      return;
    }
    const k = reduced
      ? WELD_PULSE.reduced
      : WELD_PULSE.lo + (WELD_PULSE.hi - WELD_PULSE.lo) * (0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.6));
    weldMass.current.emissiveIntensity = k;
  });

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
   * `massOpacity`/`massCeiling` are gone with the ramp they described. `weldEmissive` replaces
   * them as the third non-hue signal's own figures -- the WELD_PULSE range and rate the frame
   * loop above actually writes to the material, so a gate can assert the pulse without sampling
   * a bloom-spread pixel for it.
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
      weldEmissive: WELD_PULSE,
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
      {/* masses: 35 buildings in one draw call, Weld separate so it stays styleable. Opaque,
          default depthWrite, and roughness/metalness for a matte photographed roof rather than
          the flat-lit translucent block P9 drew -- attachAerialSkin puts the photograph on top,
          in the effect above. */}
      <mesh geometry={geo.others}>
        <meshStandardMaterial ref={otherMass} color={SCAN.mass} roughness={0.85} metalness={0} />
      </mesh>
      <mesh geometry={geo.weld}>
        <meshStandardMaterial
          ref={weldMass}
          color={SCAN.mass}
          roughness={0.85}
          metalness={0}
          emissive={SCAN.edgeHi}
          // The initial value only; the frame loop writes it from the pulse every frame.
          emissiveIntensity={0}
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
