"use client";

import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Line, Html } from "@react-three/drei";
import * as THREE from "three";
import campus from "@/data/campus.json";
import weld from "@/data/weld.json";
import { buildGroundRingGeometry, toPointPairs, WELD_NAME } from "./campusGeometry";
import { DAY } from "./materials";

/**
 * Weld's marker: a ground ring and a floating pin, replacing the wireframe cage.
 *
 * THE BUG THIS FILE FIXES, MEASURED IN docs/phases/P11-PHOTOREAL.md §0.5. Campus.tsx used to
 * highlight Weld with a <Line> over buildEdgeGeometry()'s output: a grade segment, an eaves
 * segment AND a vertical, per ring edge. Weld's footprint normalises to 56 edges, so that put
 * 56 verticals plus two 56-segment rings on screen at once, all at ~2.2 px -- pixel inspection
 * of the stage-2 frame showed them merging into opaque white panels at the gable ends of a
 * 143 ft building. A cage of that many closely-spaced, near-parallel lines reads as a solid at
 * any width worth drawing, so thinning it further would not have fixed it. Dropping the eaves
 * ring and the verticals does: what is left is `buildGroundRingGeometry()`'s single ring, lying
 * flat on the ground, which cannot merge into a panel because it never runs two lines parallel
 * to the camera at a gable end the way a vertical does.
 *
 * WHAT REPLACES THE CAGE'S OTHER JOB. The old highlight also carried a "Weld Hall" chip, scaled
 * by `distanceFactor` -- correct for a label meant to look like a physical object anchored in
 * the scene, wrong for one that has to stay legible from stage 2's 815 ft down to stage 3's
 * 251 ft, where a distance-scaled chip is either a smear or a speck depending which end of the
 * descent it is seen from. Labels.tsx's place chips solve exactly this, and its own header
 * explains how: drei's <Html> WITHOUT `distanceFactor` renders the DOM node at its own CSS
 * size no matter how far the camera is, because <Html> repositions a real DOM element at the
 * projected 2D point rather than scaling a 3D object -- there is no perspective term to hold
 * constant against because none was ever applied. That is angular-constant sizing by
 * construction, and it is copied here verbatim (no `distanceFactor`) rather than reinvented,
 * for the same reason Labels.tsx gives for not copying Campus.tsx's version: a fixed CSS size
 * keeps the pin and its label the same size at every altitude, which is what a map pin does.
 */

/** CSS px before the DPR term below, matching the 1.5 px accessibility floor MASTER.md sets
 *  for line work on dark -- the ring is line work on daylight ground now, but the floor is
 *  still the reason a hairline would fail the same gate a thin edge always did. */
const RING_WIDTH = 2.2;

/**
 * Feet the ring floats above grade -- NOT zero, and that is measured rather than cosmetic.
 * WeldExterior.tsx's own shell geometry meets the ground at the identical y=0 this ring traces,
 * and a screenshot diff (ring shown vs ring hidden, otherwise identical frames) found the two
 * z-fighting: the shell's own wall-base rendering already reads bright at that seam, and the
 * crimson line was mostly lost under it rather than visible beside it. Ground.tsx's header
 * describes the same family of problem for its stacked photo quads and rules out
 * polygon-offset as driver-dependent, stacking coplanar surfaces vertically instead -- this is
 * that same fix at ring scale. 0.2 ft (2.4 in) is far below anything a viewer reads as
 * "floating" at stage 2's 815 ft, and clears the seam.
 */
const RING_LIFT_FT = 0.2;

/** Feet above the ridge to float the pin, clear of the roofline at every pitch stage 2-3 use. */
const PIN_HEIGHT_ABOVE_RIDGE_FT = 26;

export function WeldMarker({ visible }: { visible: boolean }) {
  const dpr = useThree((s) => s.viewport.dpr);

  const ringPoints = useMemo(() => {
    const buildings = campus.buildings.filter((b) => b.name === WELD_NAME);
    return toPointPairs(buildGroundRingGeometry(buildings)).map(
      ([x, , z]) => [x, RING_LIFT_FT, z] as [number, number, number],
    );
  }, []);

  // Same point Campus.tsx used to float its chip above: a fifth of the way off-centre along
  // Weld's long axis, high enough to clear the ridge. Kept identical rather than re-derived so
  // the marker lands where the viewer already saw a "Weld Hall" label sit.
  const pinPosition = useMemo(() => {
    const half = weld.meta.length_ft / 2;
    const a = (weld.meta.long_axis_deg_e_of_n * Math.PI) / 180;
    return new THREE.Vector3(
      Math.sin(a) * half * 0.2,
      weld.meta.ridge_height_ft + PIN_HEIGHT_ABOVE_RIDGE_FT,
      -Math.cos(a) * half * 0.2,
    );
  }, []);

  const ringWidth = RING_WIDTH * Math.max(1, dpr);

  return (
    <group visible={visible}>
      <Line points={ringPoints} segments color={DAY.crimson} lineWidth={ringWidth} />
      {/* Decorative duplicate of information the canvas's own accessible name already carries
          (Experience.tsx's CanvasLabel), exactly the reasoning Labels.tsx's place chips give for
          the same aria-hidden treatment -- a screen reader gets nothing from this pin either
          way, so it should not be read twice. */}
      <Html position={pinPosition} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        <div className="weld-marker" aria-hidden="true">
          <span className="weld-marker-pin" />
          <span className="weld-marker-label">Weld Hall</span>
        </div>
      </Html>
    </group>
  );
}
