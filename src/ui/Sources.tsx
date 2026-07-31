"use client";

import { useState } from "react";

/**
 * Who said what, in the app rather than only in the repo.
 *
 * P8 asks for attribution, and the reason it is a feature rather than a footnote is the
 * same reason the provenance chips exist: this model states dimensions for a building
 * whose floor plan has never been found, so a viewer has to be able to tell what came
 * from a published source and what the project worked out. A credit list that lives only
 * in docs/SOURCES.md credits nobody in front of the person looking at the model.
 *
 * SHORT FORM ON PURPOSE. docs/SOURCES.md carries the full account -- what each source
 * supplied, what it did not, and the errors corrected along the way -- and this is the
 * one-screen version: the primary text, the five footprint datasets, the fabric sources,
 * and the sentence that matters most, which is what no source supplied at all.
 *
 * Collapsed by default and reachable by keyboard, not a hover tooltip: a tooltip is not
 * reachable, not readable by a screen reader in any dependable way, and disappears while
 * you are trying to read it. It is a <details> because that is the platform's own
 * disclosure widget -- focus, Enter, Space and the expanded state all come for free, and
 * a hand-rolled version of it is how an accessible name goes missing.
 */
export function Sources() {
  // Tracked so the summary's own label can say what activating it will do, rather than
  // leaving a screen reader to infer state from a triangle glyph. <details> manages the
  // open state itself; this only mirrors it for the label.
  const [open, setOpen] = useState(false);

  return (
    <details
      className="sources"
      data-testid="sources"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary data-testid="sources-toggle" aria-label={open ? "Hide the sources" : "Show the sources"}>
        Sources
      </summary>
      <div className="sources-body">
        <p>
          <strong>The Harvard Book</strong>, Vaille &amp; Clark eds., 1875, vol. 1, pp. 135–136 — a
          published specification three years after Weld was built. The 143 × 51 ft extreme
          dimensions, 54 studies, and the two central staircase halls this model’s section length is
          derived from.
        </p>
        <p>
          <strong>Footprint</strong> cross-checked against five datasets: Harvard PPM ArcGIS
          Facilities3D, Cambridge GIS BASEMAP_Buildings (52 vertices, and the ring this model is
          marched from), MassGIS Building Structures, OpenStreetMap way 29824449, and Microsoft
          GlobalMLBuildingFootprints. Areas and heights from Cambridge GIS and BEUDO.
        </p>
        <p>
          <strong>Fabric and history</strong> — MACRIS <code>CAM.184</code>{" "}
          for the brick, the
          sandstone belts, the slate roof and the clustered chimney shafts; Harvard Planning for
          1871–72 and Ware &amp; Van Brunt; <em>The Harvard Crimson</em>, 12 September 1951, for the
          pre-1962 room scheme. Furniture sizes from Harvard College DSO guidance.
        </p>
        <p>
          <strong>The suite itself</strong> — Harvard’s 2026 housing assignment for the occupancy, and
          a current resident’s description for the room sequence and the room sizes.
        </p>
        <p>
          {/* THE IMAGERY IS REDISTRIBUTED, so its attribution is not optional in the way the rest
              of this panel arguably is. Both licences ask for acknowledgement -- NASA requests it,
              MassGIS says it "would be appreciated" -- and this is where the app gives it, in front
              of the person looking at the photograph rather than in a file they will never open.
              The capture year is here as well as in the viewport chip, because the panel is where
              someone goes to find out why the trees are bare. */}
          <strong>The ground and the globe</strong> — NASA Earth Observatory / Blue Marble Next
          Generation, August 2004, for the Earth at orbit and the 1,000 km plate; MassGIS (Bureau of
          Geographic Information), Commonwealth of Massachusetts EOTSS, for the aerial imagery of
          Cambridge, flown leaf-off in March and April 2025 at 15 cm. Both permit redistribution of
          derived crops. The imagery is 2025 and the sun is computed for September 2026, so the trees
          are bare under September light.
        </p>
        <p className="sources-gap">
          <strong>No source supplied</strong> the ceiling height, the bathroom’s depth, the wall
          thicknesses, the hall’s width, which end of the section the suite occupies, or what the
          room marked <em>unknown</em> is for. Those ship as controls with an INFERRED chip, which is
          the whole reason the panel exists. No floor plan for Weld has been found: searches of HABS,
          MACRIS, the National Register and the Loeb Library all came back empty.
        </p>
      </div>
    </details>
  );
}
