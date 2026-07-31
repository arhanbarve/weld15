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

## Aerial and satellite imagery (P9)

The descent from orbit stands on photography, and everything under `public/imagery/` is a derived
work. `scripts/fetch-imagery.mjs` is the executable version of this section: it records each source
URL, the bounding box, the projection, the resampling, and a SHA-256 of what it downloaded.

- **NASA Blue Marble Next Generation**, topography and bathymetry, August 2004 composite, MODIS at
  500 m — the globe at stage 0 (`l0`, 4096 × 2048) and the 1,000 km plate (`l1`). A US federal work
  and therefore not subject to copyright in the United States; acknowledgement is requested rather
  than required, and it is given here and in the Sources panel. **August and not December**: the
  December plate carries heavy snow over New England.
  NASA ships no 2048 × 1024 or 8192 × 4096 BMNG — the sizes that exist are 5400 × 2700,
  21600 × 10800, and eight 21600 × 21600 tiles. Every other figure in circulation is a third-party
  rescale, so our levels are downsamples we produced and are documented as such.

- **MassGIS 2025 Aerial Imagery** (Commonwealth of Massachusetts, EOTSS Bureau of Geographic
  Information) — the 50 km, 5 km and 1,600 ft plates (`l2`, `l3`, `l4`). Flown 18 March to
  23 April 2025, **leaf-off**, statewide at 15 cm. The licence is unambiguous: *"No restrictions
  apply to these data. Acknowledgement of MassGIS would be appreciated for products derived from
  these data."*

  **The OpenStreetMap wiki says MassGIS imagery cannot be redistributed. That warning is about the
  2015 WorldView layer, which carries a DigitalGlobe licence, and not about these state-funded
  orthos.** Both licence strings were read from their ArcGIS item metadata. This paragraph exists
  because the next person to check will find that wiki page first.

  Taken from the cached tile service (EPSG:3857) rather than the JP2 originals (EPSG:6348, UTM
  19N). The reason is in the fetch script's header at length, and it is not convenience: UTM grid
  north is not true north, the convergence at Weld is −1.4269°, and over the Yard's 1,269 ft extent
  that is **31.6 ft** of misalignment against `campus.json` if the rotation is missed or signed
  wrongly. Web Mercator's convergence is identically zero, so the error cannot be made. Verified on
  a committed overlay — `design/renders/p9-georef-overlay.png` and `p9-georef-weld.png` — which
  draws all 36 `campus.json` footprints and `weld.json` onto the deepest plate.

  z20 is the deepest level published; z21 returns 404. Its 0.362 ft grid is **finer than the
  0.492 ft the imagery was flown at**, so the extra density is interpolation and not information.
  The manifest records the native figure as the resolution and the grid separately, because
  claiming 0.362 ft would be claiming detail nobody captured.

**Rejected, recorded so nobody re-proposes them:** MassGIS 2015 WorldView (*"The image files may not
be distributed to the general public"*); EOX Sentinel-2 cloudless (CC BY-**NC**-SA 4.0 — the
non-commercial and share-alike terms both fail here); Google Maps and Google Earth (Maps Platform
Terms §3.2.3(a) bars exporting, scraping, pre-fetching, storing, resharing, rehosting and bulk tile
download).

**The seasons do not match, and that is disclosed rather than hidden.** The imagery is leaf-off
March–April 2025; the model's default instant is 15 September 2026, and the sun is computed for that
date. So the trees in the photograph are bare while the simulated light is September's. It is
arguably a feature — bare trees mean Weld's fabric is visible from above instead of buried under
canopy — and `src/ui/ImageryChip.tsx` names the dataset and the capture year in the viewport so a
viewer can see the discrepancy for themselves. A second leaf-on plate was considered and not taken:
it doubles the deepest level's budget and adds a second capture date to keep honest.

## What no source supplied

Recorded here because an absence is a source-level fact and the sliders exist because of it: the
ceiling height (in no public source at all), the bathroom's depth, the interior partition and
exterior masonry thicknesses, the private hall's width, which end of the section the suite occupies,
which hand it is mirrored on, what the room the model calls "unknown" is for, and the plan size of
the two roof lanterns the 1875 text names but does not measure.

Searches that came back empty are listed at the end of `docs/DIMENSION-AUDIT.md`: original
architectural drawings via HABS, MACRIS, the National Register and the Loeb Library have not turned
up a floor plan for Weld.
