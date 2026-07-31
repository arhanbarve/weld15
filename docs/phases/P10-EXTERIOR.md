# P10 — Colour on the ground, and buildings that are actually the buildings

Two complaints, one sentence each:

1. The Cambridge satellite at stages 1 and 2 is black and white. It should be colour, like Google Maps.
2. At stages 3 and 4, Weld and the other Harvard buildings are blue glass boxes. They should look
   like the real buildings.

This document is the diagnosis, the spec, and the build order. **Nothing here has been built yet.**

---

## 0. Provenance of this document

Every number below was measured during diagnosis, on this machine, against commit `8e6ef50`, and the
command that produced it is named. Where a figure is an estimate rather than a measurement it says
so. This project's discipline is that a claim carries its source; this phase does not get an
exemption because it is about how things look.

---

## 1. Diagnosis

### 1.1 The satellite is grey for two independent reasons, and they act at different stages

**Cause A — the source plate is leaf-off.**

`scripts/fetch-imagery.mjs` builds L2, L3 and L4 from MassGIS
`Massachusetts_Aerial_Imagery_2025`, which the manifest itself records as
`"flown": "2025-03-18/2025-04-23, leaf-off"`. Leaf-off is not an accident — state orthos are flown in
early spring *on purpose*, because bare canopy is what planimetric mapping needs. The cost is that
the photograph has no summer in it: no green canopy, no green turf, dormant brown ground, grey roofs.

Measured mean saturation of one 256×256 z19 tile centred on Weld, per source:

| service | meanSat | green excess | leaf state |
|---|---|---|---|
| **MassGIS `Massachusetts_Aerial_Imagery_2025`** (shipping) | **0.127** | +3.0 | leaf-off |
| MassGIS `orthos2023` | 0.250 | +7.4 | leaf-off |
| MassGIS `orthos2021` | 0.168 | +3.9 | leaf-off |
| MassGIS `USGS_Orthos_2019` | 0.142 | −1.5 | leaf-off |
| MassGIS `DigitalGlobe_2011_2012` | 0.275 | +7.7 | leaf-off |
| MassGIS `coq0809_from_sids_package` | 0.189 | +3.5 | leaf-off |
| USDA NAIP `USDA_CONUS_PRIME` | 0.137 | **+9.7** | **leaf-on** |
| Esri `World_Imagery` | 0.303 | **+11.1** | **leaf-on** |

`meanSat` is `mean((max−min)/max)` over RGB per pixel. `green excess` is `mean(G − (R+B)/2)`, which is
the discriminating statistic here: saturation alone cannot tell brown-and-blue apart from
green-and-grey, and it is the *green* that is missing. Every free MassGIS layer is leaf-off. The two
leaf-on sources are NAIP and Esri.

The shipped plates confirm the effect survived the pipeline. Channel means of
`public/imagery/*.webp`:

| plate | source | R/G/B means | meanSat |
|---|---|---|---|
| l0 | Blue Marble | 51.1 / 61.9 / 76.3 | 0.669 |
| l1 | Blue Marble | 25.2 / 50.6 / 57.3 | 0.750 |
| **l2** | **MassGIS** | **115.9 / 118.4 / 118.8** | **0.138** |
| **l3** | **MassGIS** | **132.6 / 133.5 / 130.8** | **0.077** |
| **l4** | **MassGIS** | **139.3 / 139.9 / 135.9** | **0.095** |

Three near-identical channel means is the signature of a grey image. This is why orbit looks right
and Cambridge does not: L0 and L1 are a different dataset.

**Cause B — the app deliberately desaturates and blue-tints the photograph.**

`src/scene/Ground.tsx` `GROUND_FRAG` desaturates by `uTint * (1 − 0.25)` and pushes toward
`--void #06203F` by `uTint * 0.82`. `uTint` comes from `src/scene/altitude.ts`
`BANDS.tint = { in: [40_000, 400] }`, a log ramp. This is specified behaviour —
`design-system/MASTER.md` §"Two stages, two palettes", amended in P9.

Stage altitudes read off `window.__cam` in a live browser, and the resulting ramp:

| stage | altitude | `tint` | desaturation applied | push toward `#06203F` |
|---|---|---|---|---|
| 0 Orbit | 31,353,347 ft | 0.000 | 0% | 0% |
| 1 Cambridge | 16,332 ft | 0.195 | 15% | 16% |
| 2 Harvard Yard | 815 ft | **0.846** | **63%** | **69%** |
| 3 Weld Hall | 110 ft | **1.000** | **75%** | **82%** |

**So the two complaints about the satellite are not the same bug.** At stage 1 the app removes only
15% of the saturation — what you see there is almost entirely the leaf-off source. At stage 2 the app
removes 63% and paints the rest blue — there the app is the dominant cause, and it is working exactly
as written down. Fixing stage 1 is a data change. Fixing stage 2 is a design-system amendment.

### 1.2 There is no real building geometry in the project

- `src/scene/Campus.tsx` + `campusGeometry.ts` draw 36 buildings from `src/data/campus.json` as
  **flat-topped extruded footprints** — a ring and a single `height_ft`. Filled `#96c8f5` at 0.12–0.34
  opacity, edged with white `<Line>`. No roof, no window, no material. That is the cyanotype language
  and it is deliberate.
- `src/scene/WeldExterior.tsx` gives Weld a real gable roof, two roof features and five window bays,
  but it is drawn in the scan palette until **stage 4, t = 0.2**, and does not finish crossing to
  brick and slate until **t = 0.7**. At stage 3, and at stage 4 before you touch the slider, Weld is
  entirely blue. Confirmed by screenshot.
- Nothing anywhere in the repo carries a building texture or a roof form measured from anything.

### 1.3 What is available to fix it — probed, not assumed

**Harvard publishes its own 3D model of the campus.** `Facilities3D_Facilities`, an I3S 3D-object
scene layer at
`https://services6.arcgis.com/xj2fNQwUFCYCWY8a/arcgis/rest/services/Facilities3D_Facilities/SceneServer`,
owned by `…@harvard.edu_harvard_gis`, item `d371f09c273e417f907577d92004127b`, public access. This is
the same Harvard GIS org `docs/SOURCES.md` already cites for the footprints (`Hosted/Facilities3D/
FeatureServer/5`) — the footprint layer the project already trusts is the 2D shadow of this.

Verified by download:

- 609 nodes across 10 node pages; 608 carry a mesh; **224 are leaves**. It is a mesh pyramid, so only
  leaves may be drawn or the same building is submitted at several LODs.
- **Node 13's OBB centre is `−71.11712048, 42.37392690`.** Weld's origin in `src/geo/frames.ts` is
  `−71.1171195, 42.3739244`. They agree to six decimal places. Its OBB half-size is
  `21.75 × 9.46 × 13.26 m` = `143 × 62 × 87 ft`.
- Its `NAME` attribute decodes to exactly **`Weld Hall`**.
- Decoded and transformed into the project's site frame (feet, x east, y north, origin at Weld), the
  mesh spans **0.0 → 87.0 ft vertically** — `campus.json` gives Weld `height_ft: 87.01`, and the base
  sits on grade with no elevation offset — and **62.3 ft across × 142.8 ft along** its 13.2° long
  axis, against the nominal 54 × 151 ft block.
- Its vertical structure is real, not a prism. Height histogram of its 960 vertices, in site feet:
  `0:72  40:110  45:23  50:320  55:92  60:239  65:44  75:44  85:16` — grade, a body, an eaves line at
  60, and a ridge at 85–87.
- Within `campus.json`'s own footprint bbox plus 200 ft: **30 leaf nodes, 49,308 vertices,
  62 buildings.** (62 rather than 36 because the I3S layer splits Wigglesworth into its lettered
  entries and so on.) Estimated **1.13 MB** as an unquantized position+normal GLB.

**But Harvard ships it untextured.** Six node textures downloaded and measured: every one is
512×512 (or 256/32) JPEG with channel means **251.3 / 251.3 / 251.3, stdev 7.8** — blank white. There
is no photographic skin to take.

So the honest statement is: **Harvard gives real, correctly-georeferenced 3D massing with real roof
forms, and no colour.** Colour has to be supplied.

The only source that would give genuinely photographed buildings is Google's Photorealistic 3D Tiles,
which needs a billed API key in the browser, fetches at runtime, requires attribution, and forbids
caching — it would end this project's offline, self-contained, provenance-documented property. Ruled
out by decision (§2).

---

## 2. Decisions taken

Asked and answered before this document was written:

| # | Question | Decision |
|---|---|---|
| D1 | Leaf-on imagery source | **NAIP outright for L2/L3; for L4, MassGIS luma + NAIP colour** |
| D2 | The tint ramp | **Soften — scale the ramp so it reaches ~0.35 instead of 1.0** |
| D3 | Buildings | **Harvard I3S geometry + derived materials, for all buildings** |

---

## 3. Goal and non-goals

### Goal

At stages 1 and 2 the ground is a colour aerial photograph with green canopy and green turf, reading
the way Google Maps reads. At stages 2, 3 and 4 the Harvard buildings — Weld included — stand as
their real masses with their real roof forms, in brick, sandstone and slate, on that photograph.

### Non-goals

- **Photogrammetric realism.** No source of textured Harvard buildings exists that this project can
  ship. Materials will be *derived from the geometry* (see §6.3) and that is stated, not hidden.
- **Replacing Weld's geometry.** See §6.5. `weldGeometry.ts` is parametric — the dimension sliders,
  the cutaways, the threshold seam and the window bays that line up with the interior suite all run
  through it. It stays.
- **Touching the interior.** Stage 5 and the daylight palette are out of scope.
- **Touching stage 0.** The globe and the Blue Marble plates are already in colour and are not
  changed.
- **Re-flying the pyramid geometry.** Extents, pixel grids and the site frame do not move. Only what
  is sampled into them changes.

---

## 4. Assumptions and open questions

**Assumptions, to be checked at the step that depends on them:**

- A1. NAIP `USDA_CONUS_PRIME` `exportImage` will serve an EPSG:3857 window at the sizes L2/L3/L4 need.
  *Checked so far only at 1024×1024 over a 1,600 ft box — returned 200, `image/png`, leaf-on, green
  excess +9.7.*
- A2. NAIP's native resolution over Cambridge is 0.6 m. The service reports `pixelSizeX: 1`, which is
  a mosaic default and not the flown resolution. **Step A0 must pin the real figure and the flight
  date from the mosaic catalog, because the manifest has to record it truthfully.**
- A3. The I3S uncompressed geometry buffer (`geometries/0`) is served for every leaf, so no Draco
  decoder is needed. *Verified for resources 12 and 13; must be verified for all 30.*
- A4. `three-stdlib`'s `GLTFLoader` can load a hand-written GLB. It is already a dependency; no new
  package.

**Open questions that only a prototype can answer:**

- Q1. **Does the L4 hybrid survive the season mismatch?** MassGIS is leaf-off, NAIP is leaf-on. Under
  a tree, MassGIS luma shows pavement and bare branches while NAIP colour says green. Naively
  combined that paints green onto footpaths. §5.3 proposes a vegetation-masked blend to handle it,
  but **it is a hypothesis and step A2 is a throwaway prototype whose only job is to look at one
  1,600 ft tile and decide.** If it fails, the fallback is stated in §10.
- Q2. **Does 0.35 read as atmosphere or as dirt?** §6.4. Decided by eye against a render, not
  in advance.

---

## 5. Part A — the imagery pyramid learns about summer

### 5.1 What changes and what does not

| level | extent | grid | today | after |
|---|---|---|---|---|
| L0 | globe | 4096×2048 | Blue Marble | **unchanged** |
| L1 | 1,000 km | 2048×1524 | Blue Marble | **unchanged** |
| L2 | 164,000 ft | 2048×2048 | MassGIS z13, BMNG ocean | **NAIP**, BMNG ocean |
| L3 | 16,400 ft | 2048×2048 | MassGIS z16 | **NAIP** |
| L4 | 1,600 ft | 3072×3072 | MassGIS z20 | **MassGIS z20 luma + NAIP colour** |

Extents, pixel grids, the site frame, the inverse per-pixel resampling and the AVIF/WebP encode are
all untouched. `src/scene/imagery.ts`, `Ground.tsx`'s quad construction and `quadOf()` need no change
at all — the manifest keeps the same shape.

### 5.2 Why NAIP outright is right for L2 and L3 but not L4

L2 outputs 80.08 ft/texel and L3 outputs 8.01 ft/texel. NAIP at 0.6 m is 1.97 ft/texel, so both are
**downsamples of real pixels** — the same standard `fetch-imagery.mjs` already applies when it picks
"the shallowest zoom whose native resolution still beats the output grid".

L4 outputs **0.52 ft/texel**. NAIP would be a 3.8× *upsample*, and L4 is the plate that fills the
whole frame at stages 2 and 3 — the one place blur is unmissable. MassGIS z20 is 0.36 ft/texel over
0.492 ft native imagery, so it is the only source in play with the detail L4 needs. Hence the hybrid:
**take the detail from the source that has it and the colour from the source that has it.**

### 5.3 The L4 hybrid, specified

Both sources are resampled into the L4 grid **through the existing inverse per-output-pixel mapping**,
so they are co-registered by construction rather than by alignment — each output pixel asks both
sources what is at the same point on Earth.

Then, per pixel:

```
naipVeg   = clamp((G_naip − (R_naip + B_naip)/2 − T0) / (T1 − T0), 0, 1)   # vegetation mask
naipVeg   = gaussianBlur(naipVeg, sigma ≈ 4 ft)                            # no hard mask edges

Y_mass    = luma(massgis)          # 0.49 ft detail, leaf-off
Y_naip    = luma(naip)             # 1.97 ft detail, leaf-on
CbCr_naip = chroma(naip), low-passed at sigma ≈ 3 ft

Y_out     = mix(Y_mass, Y_naip, naipVeg)
out       = YCbCr→RGB(Y_out, CbCr_naip)
```

The vegetation mask is the whole idea, and it exists because of Q1. Where NAIP says *canopy*, the
leaf-off luma is a picture of the ground seen through bare branches and is not merely uncoloured but
**wrong** — so canopy takes both its luma and its colour from NAIP, going soft where softness is
invisible, because a tree crown has no hard detail to lose. Everywhere else — roofs, paths, the Yard's
turf, Weld's slate — luma comes from the 15 cm plate and only the colour, which is low-frequency in
aerial imagery anyway, comes from NAIP.

`T0`, `T1` and the two sigmas are tuned once, by eye, in step A2, and then written into the script as
named constants with the measurement that chose them.

### 5.4 Provenance, which is not optional in this repo

`scripts/fetch-imagery.mjs` is described in its own header as "THE PROVENANCE". The script's header
comment must be rewritten to explain the source change and the hybrid, in the same register as the
existing note about why the tile service was chosen over the JP2 orthos.

`src/data/imagery-manifest.json` gains, per level:

- NAIP: dataset name, the flown date resolved in step A0, native resolution, the `exportImage` URL
  template, and the licence — NAIP is a work of the US Department of Agriculture and is in the public
  domain, requiring no permission and no attribution, though attribution is recorded anyway.
- L4 additionally: a `composite` block naming both parents and describing the luma/chroma split, so
  nobody later reads `nativeResolutionFt: 0.492` and concludes the colour is also 15 cm. **It is
  not, and the manifest has to say so.**

`docs/SOURCES.md` gains a NAIP entry. `src/ui/ImageryChip.tsx` currently renders
`MASSGIS ORTHOIMAGERY · 2025 · LEAF-OFF`; it must render the new attribution, and "LEAF-OFF" must go
because it will no longer be true.

---

## 6. Part B — the tint, and Part C — the buildings

These are one part really, because they are the same decision seen twice: what stages 2 and 3 are
made of.

### 6.1 The coherence problem, stated before the fix

Softening the tint and making the buildings real are not independent. Brick buildings standing on a
69%-blue photograph looks worse than either the all-blue version or the all-colour version. And a
photoreal campus at stage 3 means the cyanotype is over at stage 3 — which in turn means
`WeldExterior.tsx`'s scan→brick seam, which currently crosses during stage 4, has nothing left to
cross. **The three changes have to land together or the intermediate states are incoherent.** That is
why they are one phase.

### 6.2 Getting Harvard's buildings out — `scripts/fetch-buildings.mjs` (new)

A build-time script, run by hand like `fetch-imagery.mjs`, cached under `.cache/buildings/`.

1. Walk `…/SceneServer/layers/0/nodepages/{n}` until a page comes back empty. Collect all 609 nodes.
2. Keep leaves only — `node.mesh && !node.children?.length`. **Parents carry meshes too and taking
   them would draw every building two or three times.**
3. Filter to leaves whose `obb.center` falls inside `campus.json`'s footprint bbox plus 200 ft.
   Measured: 30 nodes, 49,308 vertices, 62 features.
4. Per node, fetch `…/nodes/{mesh.geometry.resource}/geometries/0`. **The resource id is not the node
   index** — node 13's resource is 12, and getting this wrong silently returns a different building,
   which is exactly how this was got wrong once during diagnosis. Also fetch
   `…/nodes/{resource}/attributes/f_1/0` for the `NAME` strings.
5. Decode against `geometryDefinitions[1].geometryBuffers[0]`: 8-byte header
   (`vertexCount:u32, featureCount:u32`), then non-interleaved arrays — `position f32×3`,
   `normal f32×3`, `uv0 f32×2`, `color u8×4`, `uvRegion u16×4`, then per feature `featureId u64` and
   `faceRange u32×2`. Assert the buffer length equals `8 + vc*44 + fc*16` and throw if not; that
   arithmetic is what proved the layout during diagnosis and it is cheap to keep as a guard.
6. Transform each vertex: `lon = obb.center[0] + x`, `lat = obb.center[1] + y`,
   `elevation_m = obb.center[2] + z` — **x and y are degree offsets, z is metres**, a mixed-unit
   convention that is invisible if you assume otherwise. Then to site feet with the *same* constants
   `fetch-imagery.mjs` uses, and with the same `assertFramesAgree()` guard against `src/geo/frames.ts`
   drift.
7. Drop the feature named `Weld Hall` — Weld is parametric and keeps its own geometry (§6.5).
8. Split by `faceRange` so each building is separable, tag every vertex with a material class
   (§6.3), merge into one indexed geometry, and write `public/models/campus.glb` plus
   `src/data/buildings-manifest.json` (names, per-building height and centroid, provenance, source
   node/resource ids, sha256 of each downloaded buffer).

The GLB is written by hand — a JSON chunk and a BIN chunk — so no new devDependency. Estimated 1.1 MB
unquantized; **if it exceeds 1.5 MB, quantize positions to u16 over the per-building bbox before
adding a compression dependency.**

Validation the script performs and prints, so the transform cannot be silently wrong:

- Weld's extracted mass, before it is dropped, is compared against `campus.json`'s Weld ring and
  `height_ft`. Diagnosis measured `0.0–87.0 ft` against `87.01`. **The script asserts the height
  agrees within 1 ft and the centroid within 5 ft, and throws otherwise.** This is a free, exact
  check that the whole coordinate pipeline is right, and it is the single most valuable line in the
  script.
- Every extracted building is matched by `NAME` against `campus.json`; unmatched names on both sides
  are printed, not swallowed.

### 6.3 Materials, derived from geometry and honestly labelled

Harvard ships no texture. So each vertex is classified in the build script from the geometry itself:

| class | rule | material |
|---|---|---|
| roof | `normal.y > 0.5` and height above the building's eaves break | slate |
| wall | `abs(normal.y) < 0.5` | brick |
| base | height below 3 ft | granite |
| trim | horizontal band at the eaves break | sandstone |

The eaves break per building is the height at which the vertex histogram's vertical-face population
ends — for Weld that is the 60 ft band in the histogram in §1.3, and it is derivable per building the
same way.

The class rides as a vertex attribute, and one `ShaderMaterial` colours by it, so **the whole campus
stays one or two draw calls** (§6.6). Window openings are drawn as a grid in that shader on wall
faces, spaced by a 12 ft floor height — the same figure `WeldExterior.tsx` already derives five floors
from.

**This is derived, not measured, and it will be said so out loud** — in the shader's header, in
`buildings-manifest.json` as a `derived` block, and in `docs/SOURCES.md`. A project that records the
provenance of a photograph's resampling kernel does not get to quietly invent windows. The window
grid ships behind a constant that can turn it off if it reads as wallpaper.

### 6.4 The tint ramp

`src/scene/Ground.tsx` gains:

```ts
const TINT_SCALE = 0.35;
```

and the shader uniform becomes `o.tint * TINT_SCALE`.

**Scaled, not clamped.** A clamp at 0.35 would plateau around 8,000 ft and the photograph would stop
changing for the last two stages of a descent whose whole idea is continuous change. Scaling keeps
the ramp's shape and only shortens its reach.

Resulting effect, computed from the measured stage altitudes in §1.1:

| stage | `tint` | effective | desaturation | push to `#06203F` |
|---|---|---|---|---|
| 1 Cambridge | 0.195 | 0.068 | 5% | 5.6% |
| 2 Harvard Yard | 0.846 | 0.296 | 22% | 24% |
| 3 Weld Hall | 1.000 | 0.350 | 26% | 29% |

**The change is made in `Ground.tsx`, not in `altitude.ts`.** `layerOpacity().tint` stays a pure 0→1
ramp, `tests/altitude.test.ts:168`'s `expect(yard.tint).toBe(1)` stays green, and the design decision
lives in the design layer where `TINT_MAX` and `SAT_MIN` already live. Changing the band would put a
look decision inside a geometry module and break a test for no gain.

What survives is worth naming: at 26/29% the remaining tint stops being a cyanotype and becomes
**aerial haze**. With real brick buildings on the ground that is a gain, not a leftover — it is the
distance cue that stops the photograph looking like a decal. Q2 checks that by eye.

### 6.5 Weld keeps its own geometry, and gets its materials early

`src/scene/weldGeometry.ts` is 1,168 lines and is parametric: the dimension sliders reshape it, the
four cutaway modes cut it, the threshold seam sweeps it, and its five window bays are derived from the
interior suite's own perimeter so that the gable bay the camera flies through is the opening bedroom B
actually has. **Swapping in a static I3S mesh would break every one of those.** It is not done.

What changes is when Weld is brick. Today `WeldExterior.tsx` derives seam progress from
`1 − opacity`, so it is 0 for all of stages 2 and 3 and only crosses during stage 4, t 0.2→0.7. After
this phase Weld must already be brick and slate when the camera arrives at stage 3, because that is
the complaint. So:

- seam progress becomes 1 from stage 3 onward; the threshold keeps its opacity dissolve and loses its
  recolour.
- The seam mechanism itself is **kept, not deleted** — it still runs across stage 2 → 3, which is now
  where the crossing happens. The payoff moves one stage earlier; it does not disappear.

`src/scene/materials.ts` already holds the daylight materials. Weld's exterior brick/sandstone/slate
should come from the **same** definitions the new campus shader uses, so Weld and its neighbours
cannot end up different shades of brick. One source for the masonry palette.

### 6.6 Draw calls — the budget this has to fit inside

`tests/e2e/campus.spec.ts:133` asserts `calls ≤ 34` at stages 1, 2 and 3. Measured today: 24 / 28 /
28. Six spare, and the header explains that two of those six exist because the test flaked at 30.

The ledger for this phase:

| change | Δ calls |
|---|---|
| remove `Campus.tsx`'s two mass meshes | −2 |
| remove `Campus.tsx`'s two `<Line>` meshes | −2 |
| add merged campus GLB, opaque | +1 |
| add a second material group if trim needs one | +1 |
| **net** | **−2** |

Triangles go from 16,905 to roughly 33,000 — `campus.spec.ts` asserts only `> 10_000`, and the perf
gate compares against a recorded baseline rather than an absolute, so the baseline is re-recorded
with the phase.

If the merged campus needs more than two materials, the answer is more vertex attributes, **not more
meshes.**

---

## 7. Files touched

**New**

| file | why |
|---|---|
| `scripts/fetch-buildings.mjs` | I3S → GLB extractor, and the provenance for it |
| `src/data/buildings-manifest.json` | names, heights, provenance, derived-materials disclosure |
| `public/models/campus.glb` | the extracted campus, ~1.1 MB |
| `src/scene/CampusMesh.tsx` | imperative GLB load + the classified-material shader |
| `docs/phases/P10-EXTERIOR.md` | this document |

**Changed**

| file | change |
|---|---|
| `scripts/fetch-imagery.mjs` | NAIP source for L2/L3, hybrid for L4, header rewritten |
| `src/data/imagery-manifest.json` | regenerated; new provenance blocks |
| `public/imagery/l2,l3,l4.{avif,webp}` | regenerated |
| `src/scene/Ground.tsx` | `TINT_SCALE = 0.35` |
| `src/scene/Campus.tsx` | mass + line work retired; mounts `CampusMesh`; keeps Weld's highlight and the `window.__campus` probe |
| `src/scene/WeldExterior.tsx` | seam progress reaches 1 by stage 3 |
| `src/scene/materials.ts` | shared exterior masonry palette |
| `src/ui/ImageryChip.tsx` | new attribution; "LEAF-OFF" removed |
| `src/ui/Provenance.tsx` | NAIP + Harvard 3D entries |
| `design-system/MASTER.md` | amend the photographic-layer table: tint ceiling, and the scan palette's scope at stages 2–3 |
| `docs/SOURCES.md` | NAIP; Harvard `Facilities3D_Facilities`; the derived-materials disclosure |
| `tests/e2e/campus.spec.ts` | the 236 luminance threshold — see §9 |
| `tests/e2e/imagery.spec.ts` | tint-magnitude assertions re-based |
| `tests/e2e/perf.spec.ts` | baseline re-recorded |
| `tests/campusGeometry.test.ts` | follows whatever survives of `campusGeometry.ts` |

**Explicitly not touched:** `src/scene/weldGeometry.ts`, `src/geo/**`, `src/scene/altitude.ts`,
`src/state/**`, the whole interior, stage 0 and stage 5.

---

## 8. Build order

Each step has a check that must pass before the next begins. Steps A and C are independent up to A4 /
C5 and could interleave, but the order below keeps a working tree at every commit.

### A — imagery

- **A0. Pin NAIP's provenance.** Query the mosaic catalog over Cambridge for flight date and native
  resolution.
  *Verify:* a real date and a real ground-sample distance, written down. If the catalog will not give
  them, **stop and report** — a manifest that guesses is worse than the grey plate.
- **A1. NAIP fetch + resample into the existing pipeline, L3 only.** Smallest useful level.
  *Verify:* `l3.webp` regenerates; meanSat rises from 0.077 to > 0.20 and green excess goes clearly
  positive; the Yard's paths still land on `design/renders/p9-georef-overlay.png`'s alignment.
- **A2. Prototype the L4 hybrid — throwaway.** One 1,600 ft tile, three variants: naive luma/chroma,
  vegetation-masked, NAIP-only. Look at all three.
  *Verify:* **a human decision on Q1.** If the masked hybrid does not beat NAIP-only, take NAIP-only
  for L4 and record the blur as a known cost. Do not ship a clever thing that looks worse.
- **A3. Apply the chosen L4 path, and NAIP for L2 with the BMNG ocean composite retained.**
  *Verify:* all three plates regenerate; total `public/imagery` stays within ~10% of today's 5.7 MB;
  `tests/imagery.test.ts` green.
- **A4. Manifest, `SOURCES.md`, `ImageryChip`, `Provenance`.**
  *Verify:* `npm run test` green; chip reads correctly in a browser.

### B — tint

- **B1. `TINT_SCALE = 0.35` in `Ground.tsx`; amend `MASTER.md`'s photographic-layer table.**
  *Verify:* screenshots at stages 1, 2, 3 against the §6.4 table; `tests/altitude.test.ts` still
  green (it must be — nothing in `altitude.ts` moved).

### C — buildings

- **C1. `fetch-buildings.mjs`, extraction only, no render.**
  *Verify:* the script's own Weld cross-check passes — height within 1 ft of 87.01, centroid within
  5 ft — and 62 names print, matched against `campus.json`.
- **C2. GLB writer.**
  *Verify:* the GLB loads in `GLTFLoader` in a node harness; vertex and triangle counts match what
  the extractor reported; file size recorded.
- **C3. `CampusMesh.tsx`, flat untextured material, mounted beside the existing campus.**
  *Verify:* in a browser at stage 2, the new masses sit exactly on the old footprints. **This is the
  georeferencing gate and it is visual — an overlay screenshot goes into `design/renders/`.**
- **C4. Classified materials + window grid; retire `Campus.tsx`'s mass and line work.**
  *Verify:* draw calls at stages 1/2/3 read ≤ 34 off `window.__perf`, per the §6.6 ledger.
- **C5. Weld's seam moves to stage 3; shared masonry palette.**
  *Verify:* stage 3 shows brick Weld among brick neighbours in one shade of brick; stage 4's
  threshold still dissolves; all four cutaway modes still cut.

### D — reconcile

- **D1. Re-measure and rebuild the gates in §9.** Not loosen. Rebuild, with the numbers, the way P9
  did for the 236 threshold.
- **D2. Full `npm run test` + `npm run test:e2e` + `npm run typecheck` + `npm run build`.**
- **D3. Refresh `design/renders/` stage plates. Update `docs/CHECKLIST.md`.**

---

## 9. Test plan, including the gates this will break

Three gates are **expected** to fail, and each is a real measurement that has to be redone rather
than relaxed.

**`tests/e2e/campus.spec.ts` — the 236 near-neutral threshold.** Its header records that P9 raised it
from 205 to 236 because "leaf-off aerial imagery is full of bright near-neutral pixels — white roofs,
concrete, bare pavement", and that at 205 the ground alone contributed 1,939 pixels at stage 1. This
phase makes the photograph *brighter and less tinted*, so that population moves up. The test's job is
to count white line work that only Weld carries; the threshold must be re-derived by re-running the
same by-threshold table the header already contains. **P9.md §6.10's instruction — do not just loosen
the tolerance — applies again here.** If the two populations no longer separate at any threshold, the
test needs a different discriminator (Weld's line work is neutral, the photograph is not) and that is
a finding to report, not to paper over.

**`tests/e2e/imagery.spec.ts`.** Its comments cite "a 19% effect at the first and 85% at the second".
Both figures change to 5.6% and 24%. Re-based against §6.4's table.

**`tests/e2e/perf.spec.ts`.** Compares against a recorded baseline; re-record with the phase and note
the triangle count roughly doubling.

**New coverage:**

- `tests/buildings.test.ts` — the I3S decode is pure arithmetic and should be tested as such: buffer
  length arithmetic, the degree/metre mixed-unit transform against Weld's known 87.01 ft and centroid,
  and leaf-only filtering (a fixture containing a parent with a mesh must not contribute geometry).
- `tests/e2e/campus.spec.ts` gains a draw-call assertion for the new mesh against the §6.6 ledger.
- An e2e assertion that the ground's mean saturation at stage 2 exceeds a floor — the direct
  regression test for complaint 1, and the thing that would catch a future source swap silently
  going grey again.

**Unchanged and must stay green:** everything under `tests/` not listed above, all 622 unit tests, and
the full journey e2e.

---

## 10. Risks and rollback

| risk | likelihood | mitigation |
|---|---|---|
| **L4 hybrid greens the footpaths** (Q1) | **high** | Step A2 is a prototype that exists only to answer this before any of it is committed. Fallback: NAIP-only L4, blurrier but correct. Fallback to the fallback: keep MassGIS L4 grey and let the colour arrive at L3, which is up until 4,000 ft. |
| Derived materials read as a video game | medium | Window grid is behind a constant and can be turned off; materials come from one shared palette so they can be retuned in one place. Judged against a render, not asserted. |
| 236 gate cannot be re-derived | medium | Stated as a finding; the discriminator changes from brightness to neutrality-plus-brightness. |
| GLB too large | low | 1.13 MB estimated against 5.7 MB of imagery already shipping. Quantize positions if over 1.5 MB. |
| I3S service changes or disappears | low | The GLB is committed, so the app never fetches it at runtime; the script is the provenance and can be re-run. Same posture as the imagery. |
| Harvard's model disagrees with `campus.json` | low | C1's cross-check catches it at extraction time, and Weld's 87.0 vs 87.01 already says it agrees. |
| Another session is doing this work | **resolved** | See §11. `p10-fidelity` dropped its exterior workstreams and reserved this phase's files. |

**Rollback:** every part is independently revertable. A is `git checkout` on the script, the manifest
and four image files. B is one constant. C is deleting one component and restoring `Campus.tsx`'s two
meshes. Nothing here migrates state, changes the URL format, or touches the geometry the interior is
built from.

---

## 11. Four sessions, and who owns which files

Four sessions are running against this repo:

```
/Users/arhanbarve/Code/weld15          main            8e6ef50
/Users/arhanbarve/Code/weld15-imagery  p10-imagery               ← this work
/Users/arhanbarve/Code/weld15-p10      p10-fidelity    interior + stage 4 camera
/Users/arhanbarve/Code/weld15-ux       p10-ux          HUD / measurement harness
/Users/arhanbarve/Code/weld15-walkin   p10-walk-in     walk mechanics + tests
```

**The overlap that existed has been resolved, by the other session, with the user.** `p10-fidelity`
originally scoped workstreams B (Weld's procedural exterior detail) and C (Google Photorealistic 3D
Tiles) — the same goal as this phase, solved an incompatible way. Its `docs/phases/P10.md` §0 records
that both were dropped after confirming with the user, and its **G8 reserves
`weldGeometry.ts`, `WeldExterior.tsx`, `Ground.tsx`, `Campus.tsx` and `materials.ts`'s exterior
tokens for this branch for the duration of that phase**, with a pre-merge check asserting its own
diff touches none of them.

So the division is:

| files | owner |
|---|---|
| `Ground.tsx`, `Campus.tsx`, `CampusMesh.tsx`, `WeldExterior.tsx`, `weldGeometry.ts`, `fetch-imagery.mjs`, `fetch-buildings.mjs`, imagery + models assets | **this phase** |
| `Suite.tsx`, `furniture.ts`, `walls.ts`, `stages.ts`, `orbit.ts`, interior materials | `p10-fidelity` |
| `Hud.tsx` and the UI chrome | `p10-ux` |
| `walk.ts`, `route.ts` and their tests | `p10-walk-in` |

**Two files are still shared and need care at merge:**

- **`src/scene/materials.ts`.** This phase adds `SANDSTONE`, `GRANITE` and the exported `MASONRY`
  near the existing `BRICK`/`SLATE` at the top of the file; `p10-fidelity` adds a plaster tooth
  around `materials.ts:348` and touches the `transmission` note at `:399`. Different regions of one
  file — a clean textual merge, but do not rebase blind.
- **`src/scene/Experience.tsx`.** This phase adds one `weldPalette` line and one prop. `p10-fidelity`
  reworks stage 4's camera through `stages.ts` and `orbit.ts` and its plan does not name
  `Experience.tsx`, so this should be clear — but stage 4 is its subject and this is stage 4's
  mounting point. **Check before merging, not after.**

**This phase's doc is `P10-EXTERIOR.md` and not `P10.md`, deliberately** — `p10-fidelity` committed
`docs/phases/P10.md` first and a phase document is not worth a merge conflict.
