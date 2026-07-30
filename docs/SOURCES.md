# Sources

What each source actually supplied, and where the model uses it. `docs/DIMENSION-AUDIT.md` is the
companion to this file: it tags every dimension GIVEN, DERIVED or INFERRED and records the errors
this project made and corrected. This file answers the narrower question — who said what.

The rule the whole project runs on: **nothing here is presented as measurement unless a source
measured it.** Where a number is the project's own inference it ships as a slider with an INFERRED
chip, and the panel's note says what bounds it.

## Primary

**The Harvard Book**, Vaille & Clark eds., 1875, vol. 1, pp. 135–136.
<https://archive.org/details/harvardbookserie01vail> — a published specification three years after
Weld was built. Supplies the extreme dimensions 143 × 51 ft, the count of 54 studies, an average
study of 16 × 17 ft, and the sentence the whole stair-core geometry rests on: the building has two
central staircase halls, fifteen feet by thirty-something. `src/data/weld.json`
`meta.primary_source_1875` carries the citation and the quotation; `sectionLength` is derived from
it (143 less two 15 ft stair halls and the porch, halved).

**Harvard's housing assignment, 2026.** The suite is Weld 15, four students. This is the source for
occupancy, and it is the only source for it — `layout()`'s default of four beds comes from here and
nowhere else. §3 of the audit.

**the resident's email** (a current resident, describing the suite from inside). Supplies the room sequence
off the private hall, the common room at 15 × 15–20 ft, bedrooms at about 10 × 16 ft, K at roughly
10 × 12 ft, and the door order. It gives **no bathroom dimension** — audit error 4 is this project
inventing one and rendering it in the same typographic style as the sourced numbers.

## Footprint and site

The plan is cross-checked against five independent datasets, because a single one was wrong in a way
that survived three artifacts (audit error 1: 54 ft was one facade edge, not the building's width).

- **Harvard PPM public ArcGIS**, `Hosted/Facilities3D/FeatureServer/5` — campus footprints and
  `height_absolute` in feet; `Hosted/fydbuildingHUWM/FeatureServer/0` — first-year dorm amenities.
- **Cambridge GIS `BASEMAP_Buildings`** — the highest-fidelity ring, 52 vertices. This is what the
  model's Weld outline is marched from.
- **MassGIS Building Structures (2-D)**, 2011 roofprint.
- **OpenStreetMap** way 29824449.
- **Microsoft GlobalMLBuildingFootprints.**
- **Cambridge BEUDO** energy disclosure — areas and heights.

Corrected figures: 52 ft at the gable ends, 62–64 ft across the wings, and a 13.2° long axis east of
north. `src/data/campus.json` records the cleaning rule — rings under 50 sq ft dropped as degenerate
slivers, three of them, all Smith Campus Center.

## Fabric and history

- **MACRIS `CAM.184`** — brick with light sandstone belts, a slate roof, and the "clustered chimney
  shafts" that settled what occupies the 5.2 ft the common room does not: masonry, not floor space.
- **Harvard Planning**, and multiple concurring sources — built 1871–72, Ware & Van Brunt.
- **The Harvard Crimson**, "12 Yard Dorms House '55", 12 September 1951 — the pre-1962 room scheme.
- **Harvard College DSO** what-to-bring guidance — the furniture sizes in `SIZES`, which is the only
  furniture dimension in the model with a source behind it. Everything else about the fit-out is
  tagged ASSUMED in `src/geo/furniture.ts`.

## What no source supplied

Recorded here because an absence is a source-level fact and the sliders exist because of it: the
ceiling height (in no public source at all), the bathroom's depth, the interior partition and
exterior masonry thicknesses, the private hall's width, which end of the section the suite occupies,
which hand it is mirrored on, what the room the model calls "unknown" is for, and the plan size of
the two roof lanterns the 1875 text names but does not measure.

Searches that came back empty are listed at the end of `docs/DIMENSION-AUDIT.md`: original
architectural drawings via HABS, MACRIS, the National Register and the Loeb Library have not turned
up a floor plan for Weld.
