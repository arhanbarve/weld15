"use client";

import { useStore } from "@/state/store";
import { manifest } from "@/scene/imagery";

/**
 * Names the imagery and the year it was flown, in the viewport, at the stages that show it.
 *
 * WHY THIS IS A FEATURE AND NOT A FOOTNOTE. Sources.tsx's header makes the general argument -- this
 * model states dimensions for a building whose floor plan has never been found, so a viewer has to
 * be able to tell what came from a source and what the project worked out. The photograph makes that
 * sharper rather than softer: an aerial image reads as ground truth in a way a drawing does not, and
 * this one is a 2025 photograph under a September 2026 sun.
 *
 * THERE IS A REAL DISCREPANCY AND THE CHIP EXISTS TO DISCLOSE IT. The MassGIS plates were flown
 * 18 March to 23 April 2025, leaf-off, so every tree in the Yard is bare; the store's default
 * instant is 15 September 2026 and Lighting.tsx computes the sun for that date. Nothing about that
 * is hidden, and a viewer who notices bare trees in September should be able to find out why without
 * opening the repository. docs/SOURCES.md carries the long version; the Sources panel carries the
 * middle version; this is the one-line version that is on screen whether or not anyone opens
 * anything.
 *
 * ONLY WHERE THE IMAGERY IS ACTUALLY THE SUBJECT -- stages 0 to 2. By stage 3 the photograph has
 * been tinted into the scan palette and the massing is what the frame is about; by stages 4 and 5
 * the camera is inside the building and there is no imagery on screen at all. A credit for something
 * that is not visible is noise.
 *
 * NOT FOCUSABLE, and aria-hidden. It duplicates what the Sources panel says in a reachable,
 * navigable form, and adding a non-interactive chip to the tab order would put a stop between the
 * skip control and the HUD for no gain. tests/e2e/a11y.spec.ts runs axe over this.
 */

/** The stages at which the photograph is the subject rather than the substrate. */
const SHOW_UPTO = 2;

export function ImageryChip() {
  const stage = useStore((s) => s.stage);
  if (stage > SHOW_UPTO) return null;

  // Read from the manifest rather than written out, so the year cannot drift from the plates. The
  // fetch script emits `flown` as an ISO range; the chip wants the year.
  const flown = manifest.levels.L4?.provenance.flown;
  const year = typeof flown === "string" ? flown.slice(0, 4) : null;

  return (
    <div className="imagery-chip" data-testid="imagery-chip" aria-hidden="true">
      {stage === 0 ? (
        <>NASA Blue Marble · 2004</>
      ) : (
        <>MassGIS orthoimagery{year ? ` · ${year}` : ""} · leaf-off</>
      )}
    </div>
  );
}
