"use client";

import { CampusMesh } from "./CampusMesh";

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
 * P11 §0.5 RETIRES WELD'S CAGE. This file used to draw Weld's highlight too: a wider, brighter
 * <Line> over the same ring buildEdgeGeometry() emitted for every other building, plus a
 * distanceFactor-scaled "Weld Hall" chip. Measured on the shipped build: that wireframe put a
 * grade ring, an eaves ring AND a vertical at every one of Weld's 56 corners on screen at once,
 * which merge into opaque white panels at the gable ends of a 143 ft building -- the thing this
 * phase's user complaint names directly. WeldMarker.tsx replaces it: a flat crimson ring at
 * grade, no verticals, plus an angular-constant pin and label above the ridge, mounted
 * alongside this component in Experience.tsx on the same condition Weld's highlight used
 * (`stage >= 2`). campusGeometry.ts's own header has the fuller account of what was deleted
 * and why. This component is left with exactly what its name says: the campus massing.
 */
export function Campus({
  visible,
  // Accepted, unused: Experience.tsx still passes highlightWeld={stage >= 2} at this call
  // site (out of scope for this change -- see the file-level note above), and keeping it in
  // the signature is what lets that line typecheck unchanged. WeldMarker.tsx now owns
  // everything the flag used to gate.
  highlightWeld: _highlightWeld,
}: {
  visible: boolean;
  highlightWeld: boolean;
}) {
  return (
    <group visible={visible}>
      <CampusMesh visible={visible} />
    </group>
  );
}
