# P11 — Photorealism and one camera

Status: **spec, awaiting approval. No code written.**

Supersedes the exterior half of P9 and P10. The interior (stages 4–5: `Suite`, `Furniture`,
`FirstPerson`, `walk`, `route`, `rooms`, `weldGeometry`) is largely untouched.

---

## 0. Diagnosis — measured, not inferred

Every finding below was reproduced against a running dev server on this build
(`npm run dev`, Playwright, 1440×900, DPR 1) on 2026-08-01. Camera figures are read off
`window.__cam`.

### 0.1 Stage 0 drag black-screens the app

`globeRig.ts` `spinPose()` rotates the camera about Earth's true centre. Every
altitude-driven system in the app reads altitude as `camera.position.y` —
`altitude.ts`'s own header states this as an invariant:

```
alt = camera.position.y        // three.js Y is up, and Weld's grade is y = 0
```

That invariant is only true for a camera on Weld's local vertical. `spinPose` moves the
camera off it, so `y` stops meaning altitude. Measured, dragging right in 60 px steps
(≈21.6° of yaw each, at `DRAG_TURN_DEG = 360` per viewport height):

| cumulative drag | `camera.position.y` (read as "alt") | consequence |
|---|---|---|
| 0 px | 31,353,347 | correct |
| 60 px | 27,334,642 | globe proxy already shrinking |
| 120 px | 15,096,158 | half the apparent Earth gone |
| **180 px** | **−3,322,701** | `nearFar()` clamps to 0.5 / 25,000 ft → proxy radius 3,125 ft → `layerOpacity().globe = 0` → **nothing is drawn** |
| 420 px | −71,416,791 | camera is 3.4 Earth radii below the planet |

Analytic threshold: `y = 2.5·R·cos(yaw) − R` goes below the globe fade floor of 40,000 ft
at `yaw > 66.4°`, i.e. **184 px of drag**. This is not a tuning bug. It is a false
invariant, and no amount of clamping inside `spinPose` fixes it while `y` is the
definition of altitude.

`spinPose` also rotates the look-at target by the same rotation, so the target walks away
from the origin (measured: `[−20,791,374, −22,481,279, 0]` after five drags) and the
`(1 − t)` unwind in `CameraRig` cannot bring it back within the stage.

### 0.2 Stages 1 and 2 have no drag at all

`CameraRig.tsx:328`:

```ts
if (stage !== 0 && stage !== 3 && stage !== 4) return;
```

Deliberate — the docblock calls 1 and 2 "fixed shots that scrub on the wheel alone".

### 0.3 The imagery pyramid has a 20× resolution hole

Reproduced at `u = 0.35` → stage 0, `t = 0.74`, alt 144,107 ft: an unreadable green/blue
blur with a "BOSTON" chip on it. This is the "0.7 … 0.8 … extremely pixelated render of
the Earth" exactly.

| level | ft/texel | extent | source |
|---|---|---|---|
| L0 | — | whole Earth | NASA Blue Marble, MODIS 500 m |
| **L1** | **1,601** | 3,280,000 ft | Blue Marble crop — *at native resolution; the source is this coarse* |
| L2 | 80 | 164,000 ft | USDA NAIP 2023 |
| L3 | 8 | 16,400 ft | USDA NAIP 2023 |
| L4 | ~1 | 1,600 ft | NAIP/MassGIS hybrid |

`altitude.ts` `BANDS`: `q1` is fully up from 99,000 ft; `q2` does not begin until 99,000
and is not full until 40,000. So the entire band **400,000 → 40,000 ft** — which is most
of stage 0's second half — is carried by a 1,601 ft/texel plate. At 144,000 ft a 1440 px
frame spans ~119,000 ft of ground = 74 texels across the screen. That is 19 screen pixels
per texel.

### 0.4 "The dot is above Boston"

`Labels.tsx` places `Boston` at 42.3555 / −71.0565 (Downtown Crossing), band
260,000 → 26,000 ft. Weld's marker and the Boston chip are ~3 miles apart, which at
144,000 ft is ~40 px — they sit on top of each other, and the only readable thing in
frame is the word BOSTON next to the pin.

### 0.5 The white cage around Weld

`campusGeometry.ts` `buildEdgeGeometry()` emits, per ring edge: a grade segment, an eaves
segment, **and a vertical at the corner**. Weld's `campus.json` ring normalises to 56
edges, so the highlight is 56 white verticals plus two 56-segment rings, drawn through
`drei`'s `<Line>` at `WELD_WIDTH · dpr = 2.2 px`. On a 143 ft building at stage 2 they
merge into opaque white panels at the gable ends. Confirmed by pixel inspection of the
stage-2 frame.

Weld itself under the cage is a two-tone solid: brick below the eaves, slate above, no
fenestration, no belts, no relief.

### 0.6 The neighbours are four hand-derived hexes

`materials.ts`:

```
BRICK     = mix(DAY.crimson, DAY.oakDeep, 0.35)
SLATE     = scale(mix(DAY.edge, DAY.sky, 0.5), 0.14)
SANDSTONE = mix(DAY.plaster, DAY.oak, 0.3)
GRANITE   = scale(DAY.edge, 0.55)
```

painted per-vertex-class onto Harvard's I3S mesh. **There is no photographic skin
anywhere in the pipeline**: `scripts/fetch-buildings.mjs` measured all six of Harvard's
published node textures as blank white plates (channel means 251.3/251.3/251.3, σ 7.8).
This cannot be fixed by better colour choices — the data has no texture.

### 0.7 Stage 4 loses the world

`stages.ts` `visibility()` returns `campus: stage <= 3`, and `Experience.tsx` mounts
`<Ground visible={vis.campus} />`. At stage 4 the campus mesh **and the ground** unmount.
Confirmed at `u = 0.93`: the frame is Weld's dissolving shell against empty background.

### 0.8 Stage 5 stance

`walk.ts` `EYE = 5 + 10/12 = 5.833 ft`. `route.ts` `standingPose()` drops the aim 2 ft
over a ~14.25 ft run → **−8.0° pitch**. The floor occupies the lower half of the frame.

---

## 1. Decisions taken

| # | Decision | Chosen |
|---|---|---|
| 1 | Photorealism source | **Live Google Photorealistic 3D Tiles.** No baking — Google's Map Tiles policy forbids pre-fetching, indexing, storing or caching Content. |
| 2 | Tile scope | **Orbit → Yard, all of it.** Tiles replace the globe, the ground quads and the campus mesh. |
| 3 | Weld handoff | **Swap during the 3→4 transit.** Google's photogrammetric Weld is what you see at stages 0–3; the parametric shell cross-fades in as stage 4 begins. |
| 4 | Camera model | **Geodetic offset over keyframes.** `(stage, t)`, the scrubber, the URL encoding and the fly-down all survive; the pose layer is rebuilt on lat/lon/heading/pitch/range, with altitude taken from the ellipsoid rather than from `y`. |
| 5 | Stage structure | **Keep 6 ids; make 3→4 continuous.** Old share links keep working. |
| 6 | Weld marker | **Ground ring + floating pin.** Crimson footprint outline at grade (no verticals) plus an angular-constant pin and label above the ridge. |
| 7 | Stage 5 stance | **Lower the eye only.** `EYE` → ~5'2"; the −8° pitch stays. |
| 8 | Eye height scope | **One constant, shared.** The opening shot and first-person walking both come down. |
| 9 | Design language | **Retire the cyanotype for the world, keep it for UI.** Photoreal at every altitude. Scan palette survives only as chrome. |
| 10 | No-key fallback | **Keep L3/L4 quads + `campus.glb`.** Drop L0/L1/L2. |
| 11 | Tile quality | **Quality-first, gate on settled.** Loading bar at first paint; the fly-down waits for tiles rather than flying through blur. |
| 12 | Test gates | **Re-derive against the new build.** |
| 13 | Delivery | **Five phases, checkpoint each.** |

### 1.1 Cost, for the record

SKU `C6E1-98B2-DBD0`, Map Tiles API: Photorealistic 3D Tiles. Billable event = one **root
tileset request** ≈ one page load; the tile requests it authorises are free and do not
count against quota. **1,000 free events per month**, then $6.00/1,000.

At 5 users × 25 opens = 125 sessions/month, the bill is **$0.00**, with ~8× headroom.
The realistic overspend risk is CI: every Playwright page load is a billable event.
Mitigated by decision 10 — e2e runs keyless on the fallback path, with a single opt-in
`@tiles` spec. A $5 budget alert and a daily key quota cap are part of phase 1.

---

## 2. Target architecture

### 2.1 One frame, three coordinate systems reconciled in one place

Today the app has two frames (foot-scale site, and the globe's unit-scale proxy). Tiles
add a third: **ECEF**, metres, origin at Earth's centre.

All three collapse into one transform, applied to the tiles group and nowhere else:

```
M_ecef→site  =  S · R · T

T  translate by  −ECEF(WELD_ORIGIN)          // 42.3739244, −71.1171195
R  rotate ENU→site                            // east→+X, up→+Y, north→−Z
S  scale 3.280839895                          // metres → feet
```

`R` is exactly the basis `globeRig.ts` `weldBasis()` already computes and
`tests/globeRig.test.ts` already proves orthonormal, right-handed, and correctly
oriented. That function is **kept and moved**, not rewritten — it is the one piece of the
globe rig that survives, and it is the piece a mirrored Earth would have come from.

Consequence: the camera stays near the origin in site feet, exactly as today. The large
numbers live in one `Matrix4` on one group. `3d-tiles-renderer` keeps per-tile geometry
in tile-local space, so float32 precision is not stressed by this arrangement — but it is
a stated risk (§6.1) and phase 1 measures it rather than assuming it.

### 2.2 Altitude stops being `camera.position.y`

New module `src/scene/geo/frame.ts`, **three-free** (the rule `altitude.ts`, `orbit.ts`,
`walk.ts` and `journey.ts` already follow, asserted by `tests/place.test.ts`):

```ts
export function siteToEcef(p: Vec3): Vec3
export function ecefToSite(p: Vec3): Vec3
export function geodeticToSite(lat: number, lon: number, hFt: number): Vec3
export function siteToGeodetic(p: Vec3): { lat: number; lon: number; hFt: number }

/** Height above the WGS-84 ellipsoid, ft. THE definition of altitude from P11 on. */
export function altitudeOf(p: Vec3): number
```

`altitudeOf([0, h, 0]) === h` to within a foot, so every number in the existing docs
(815 ft at stage 2, 110 ft at stage 3) keeps its meaning. What changes is that the
function is correct for a camera that is *not* over Weld — which is the entire bug in
§0.1.

Every reader of `camera.position.y` migrates. Full list:
`CameraRig.tsx` (near/far), `Ground.tsx`, `Globe.tsx`, `CampusMesh.tsx`,
`WeldExterior.tsx` (`progress`), `Labels.tsx`, `Perf.tsx`. Six of those seven are deleted
or rewritten by this phase anyway.

### 2.3 The camera is a geodetic rig

New module `src/scene/geo/rig.ts`, three-free:

```ts
export type GeoPose = {
  lat: number; lon: number;     // what the camera looks at
  targetFt: number;             // height of the target above grade, ft
  headingDeg: number;           // compass bearing of the camera FROM the target, °E of N
  pitchDeg: number;             // ° below the target's local horizontal. 90 = straight down
  rangeFt: number;              // camera-to-target, ft
  fov: number;
};

export function poseToKeyframe(p: GeoPose): Keyframe          // → position/target/fov, site ft
export function keyframeToPose(k: Keyframe): GeoPose          // exact inverse
export function clampPose(p: GeoPose, c: PoseClamp): GeoPose
```

Every stage keyframe in `stages.ts` becomes a `GeoPose`. The existing derivations survive
verbatim — `obliqueDrop()`, `GABLE_BACK`, `descentPath()`'s log-in-altitude
interpolation, `thresholdPath()`'s routed waypoints — because all of them produce a
*drop and an azimuth*, which is a `GeoPose` with different field names.

| stage | lat/lon | targetFt | heading | pitch | range |
|---|---|---|---|---|---|
| 0 | Weld | 0 | 30° | 88° | 1.5 · R⊕ |
| 1 | Weld | 40 | 30° | 50° | derived from `CAMBRIDGE_EXTENT` |
| 2 | Weld | 30 | 34.1° | 45° | derived from `YARD_EXTENT` |
| 3 | Weld | 42 | 38.3° | 30° | 251 ft (today's `[150,110,190]`) |
| 4 | bedroom B | eye | derived | derived | `GABLE_BACK`, then the routed path |
| 5 | hall | eye | `standingPose().heading` | 8° | 0 (first person) |

`pitchDeg` replaces `polarDeg` (`pitch = 90 − polar`). The existing `STAGE3_CLAMP` /
`STAGE4_CLAMP` radius and polar limits map across unchanged; `MASS_RADIUS`,
`WELD_FOOTPRINT_RADIUS`, `keepOutsideMassing()` and `transitPose()`'s
spherical-about-`MASSING_CENTER` interpolation are all still needed for stages 3–4 and
are kept as-is.

### 2.4 One control scheme, every stage

| input | behaviour | stages |
|---|---|---|
| left-drag horizontal | `headingDeg` ± | **all** |
| left-drag vertical | `pitchDeg` ∓, clamped per stage | **all** |
| wheel / trackpad pinch | `rangeFt` ×, and *range drives the journey* — see below | **all** |
| shift-drag | pan the target lat/lon across the surface | 2, 3, 4 |
| scrubber, stage buttons, fly-down | set `(stage, t)` as today | all |
| double-click at stage 5 | pointer lock, first person, as today | 5 |

**Wheel zoom becomes the descent.** Today the wheel scrubs at stages 0–2 and changes
orbit radius at 3–4 — two behaviours on one control. Instead: the wheel always changes
`rangeFt`, and `rangeFt` is projected back into `u` through the same
altitude↔journey mapping `journey.ts` already owns. Zooming in at Cambridge therefore
*descends*, continuously, and past stage 3 it keeps closing until the shell dissolves.
That is decision 5 and your "you should just be able to zoom in and go to the view",
implemented as one rule rather than as a special case at 3→4.

Pitch clamps per stage, all with the same justification `orbit.ts` already gives for 15°
and 88° — the camera must stay above the horizon of what it is looking at:

| stage | pitch range | why |
|---|---|---|
| 0 | 25 … 89 | below 25° from 1.5 R⊕ the camera passes behind the limb |
| 1–2 | 20 … 89 | keeps the horizon out of frame (today's argument, restated) |
| 3–4 | **2 … 75** | today's 15…88 in polar terms; the low end lets you look at Weld from near street level, which is the "flyby" angle |

`globeSpin` and `spinPose()` are **deleted**, along with the `globeSpin` store field and
its URL encoding slot.

### 2.5 Tiles

New `src/scene/Tiles.tsx`:

```tsx
<TilesRenderer group={{ matrix: M_ecef→site, matrixAutoUpdate: false }}>
  <TilesPlugin plugin={GoogleCloudAuthPlugin} args={{ apiToken: KEY, autoRefreshToken: true }} />
  <TilesPlugin plugin={TilesFadePlugin} />
</TilesRenderer>
```

- `3d-tiles-renderer` (NASA-AMMOS) — has first-class `@react-three/fiber` exports at
  `3d-tiles-renderer/r3f` and `GoogleCloudAuthPlugin` at `3d-tiles-renderer/plugins`.
- **Constructed once per page load.** A `TilesRenderer` rebuilt on stage change or on HMR
  issues a new root tileset request, which is a new billable event. A `window.__tiles`
  probe publishes the construction count and a gate asserts it is 1.
- Imperative, never `useLoader`/suspense — `imagery.ts` and `CanvasHost.tsx` both record
  what a suspending child of `<Canvas>` does to this app (the whole UI reverts to
  "LOADING WELD 15"). That rule is unchanged and now applies to tiles.
- Attribution is **required**: Google logo ≥16 dp plus the `copyright` string from the
  tileset, in the bottom-right. Wired into the existing `Provenance`/`Sources` chrome,
  which is already bottom-right and already carries "USDA NAIP · 2023 · MASSGIS DETAIL".

### 2.6 Carving Google's Weld out

Cross-fade during the 3→4 transit needs Google's Weld to disappear where the parametric
shell appears. Clipping planes cannot express "remove this box" (a box is a union of
complements, not an intersection of half-spaces), so this is a **fragment discard** on
the tile materials:

- `tiles.addEventListener('load-model', …)` → `material.onBeforeCompile` injects a test
  against Weld's oriented footprint prism (centre, half-extents, the 13.2° axis rotation
  already in `weld.json`), with a `uCarve` uniform.
- `uCarve` ramps 0 → 1 over the 3→4 transit, on the same `t` the shell's opacity uses, so
  the two cannot disagree about when the swap happens.
- Feathered by ~2 ft at the prism boundary so the cut is not a hard edge against
  photogrammetry that is itself ±1–2 ft.

Same mechanism, same shader, is what dims the neighbourhood if the marker ever needs it.

### 2.7 What Weld itself looks like

Google's mesh at stages 0–3. The parametric shell from stage 4. The shell keeps its
daylight materials (`BRICK`, `SLATE`, `SANDSTONE`) and loses the scan half entirely —
`attachPaletteSeam`, `SCAN_ROOF`, `sweepY`, `SWEEP_TOP/BOTTOM` and the seam line mesh all
go with decision 9. `Threshold.tsx` keeps only what dissolves the shell.

The bays are upgraded from solid slate boxes to actual reveals with glazing, because the
one place the parametric Weld is on screen is now the closest shot in the whole piece.
Scoped as phase 3 stretch, not a gate.

---

## 3. File-by-file

### 3.1 Deleted

| file | why |
|---|---|
| `src/scene/Globe.tsx` | tiles render the Earth |
| `src/scene/globeRig.ts` | except `weldBasis()`, moved to `geo/frame.ts` |
| `src/scene/Ground.tsx` | replaced by tiles; a stripped `FallbackGround` remains (§3.3) |
| `src/scene/CampusMesh.tsx` | replaced by tiles; kept in the fallback path only |
| `src/scene/campusGeometry.ts` | `weldEdges` becomes the marker ring; the rest is dead |
| `public/imagery/l0.*`, `l1.*`, `l2.*` | ~3.2 MB; the blurry levels |
| `tests/globeRig.test.ts` (partial) | `spinPose` cases; `weldBasis` cases move |

### 3.2 Rewritten

| file | change |
|---|---|
| `src/scene/stages.ts` | keyframes become `GeoPose`; `visibility()` loses `campus`/`globe`, gains `tiles`; the cyanotype `SHELL_GONE`/`funnel` machinery stays |
| `src/scene/CameraRig.tsx` | one drag handler for all stages; pose from `poseToKeyframe`; near/far from `altitudeOf` and the ellipsoid |
| `src/scene/altitude.ts` | `BANDS` reduced to the fallback quads + a `tiles` band; `nearFar` extended to 1e8 ft and derived from height-above-ellipsoid |
| `src/scene/Campus.tsx` | becomes `WeldMarker.tsx`: ground ring + angular-constant pin, no wireframe |
| `src/scene/Labels.tsx` | place bands re-pitched to the new altitude schedule; "Boston" moved out of the pin's neighbourhood or dropped |
| `src/scene/Experience.tsx` | mounts `<Tiles>`; drops `<Globe>`, `<Ground>`, `<Campus>` |
| `src/scene/WeldExterior.tsx` | drops `palette`/`progress`/seam; gains the 3→4 cross-fade opacity |
| `src/scene/Threshold.tsx` | seam removed, dissolve kept |
| `src/scene/materials.ts` | `MASONRY` block and the `SCAN` export trimmed to what UI chrome still uses |
| `src/scene/walk.ts` | `EYE` 5.833 → 5.1667 ft |
| `src/state/store.ts`, `src/state/url.ts` | `globeSpin` removed; `orbit` becomes `{ headingDeg, pitchDeg, rangeFt }`; URL version bumped with a decoder that accepts the old layout |
| `src/ui/Provenance.tsx`, `Sources.tsx` | Google attribution + logo |
| `src/ui/Hud.tsx` | readout `az/pol/ft` → `heading/pitch/range`; loading bar |
| `design-system/MASTER.md` | photographic-layer section rewritten; scan palette scoped to chrome |
| `docs/SOURCES.md` | Google Photorealistic 3D Tiles added with its licence terms |

### 3.3 New

| file | contents |
|---|---|
| `src/scene/geo/frame.ts` | ECEF ↔ site ↔ geodetic, `altitudeOf`. Three-free. |
| `src/scene/geo/rig.ts` | `GeoPose`, `poseToKeyframe`, `keyframeToPose`, `clampPose`. Three-free. |
| `src/scene/Tiles.tsx` | `TilesRenderer` + Google auth plugin + carve shader hook + `window.__tiles` probe |
| `src/scene/tilesCarve.ts` | the Weld prism discard, as injectable GLSL. Three-free string builder. |
| `src/scene/FallbackGround.tsx` | L3/L4 quads + `campus.glb`, mounted only when no key is present |
| `src/ui/LoadingBar.tsx` | first-paint gate on tiles settled |
| `src/scene/WeldMarker.tsx` | ring + pin |
| `.env.example` | `NEXT_PUBLIC_GOOGLE_MAPS_KEY=` |

---

## 4. Phases

Each phase ends with a running app and a named check. Nothing proceeds without your
look.

### Phase 1 — tiles land, keyless still works

1. `npm i 3d-tiles-renderer` → verify: `npm run build` succeeds, bundle delta recorded.
2. Google Cloud: project, Map Tiles API on, browser key restricted to
   `localhost:3000` + the Vercel domains, **daily quota cap** + **$5 budget alert**.
   → verify: a `curl` for the root tileset returns 200.
3. `src/scene/geo/frame.ts` + `tests/geoFrame.test.ts`.
   → verify: `geodeticToSite(WELD_ORIGIN, 0)` is `[0,0,0]` ±0.01 ft; a point 100 ft due
   east is `[100, 0, 0]` ±0.01; `altitudeOf([0, h, 0]) === h` ±1 ft for h over six
   decades; round-trip `siteToEcef ∘ ecefToSite` is identity to 1e-6 ft.
4. `src/scene/Tiles.tsx`, mounted alongside the existing scene, with the old scene
   toggleable off by a query flag.
   → verify: screenshot at each of the six stage keyframes shows photoreal Cambridge
   registered against the existing NAIP quad (overlay diff, the same method
   `scripts/georef-overlay.mjs` already uses for the imagery).
5. `nearFar()` extended; `window.__tiles` probe.
   → verify: no clipping at any `u` from 0 to 1; `__tiles.constructions === 1` after a
   full journey sweep; `__tiles.rootRequests === 1`.
6. `FallbackGround.tsx` + delete L0/L1/L2.
   → verify: with `NEXT_PUBLIC_GOOGLE_MAPS_KEY` unset the app still renders stages 2–5;
   full vitest suite green.

**Checkpoint: you look at photoreal Harvard Yard in this app and confirm the fidelity is
what you pictured.** This is the spike, folded into phase 1 — if the answer is no, the
premise is wrong and we stop here having spent one phase.

### Phase 2 — one camera, drag everywhere, stage-0 bug dead

1. `src/scene/geo/rig.ts` + `tests/geoRig.test.ts`.
   → verify: `keyframeToPose ∘ poseToKeyframe` is identity to 1e-9 for 10,000 random
   poses; each existing stage keyframe round-trips to within 0.01 ft of today's value
   (this is the regression fence — the shots must not move).
2. `stages.ts` keyframes → `GeoPose`.
   → verify: `tests/stages.test.ts` passes with its existing numeric assertions.
3. `CameraRig.tsx` single drag handler; `spinPose`/`globeSpin` deleted.
   → verify (**the gate for §0.1**): a Playwright sweep that, at every stage, drags
   ±720° of heading and the full pitch range in 20 px steps and asserts at every sample
   that `altitudeOf(camera) > 0`, that the frame is not uniform, and that
   `__cam.target` stays within 1,000 ft of the intended target.
4. Wheel → `rangeFt` → `u`.
   → verify: wheeling from `u = 0` reaches `u = 1` monotonically; `journey.spec.ts`'s
   continuity assertion (`cuts` does not change across a scrub) still holds.
5. `store.ts` / `url.ts` orbit shape + version bump with backward-compatible decode.
   → verify: `tests/url.test.ts`, plus a case decoding a v-previous string.

**Checkpoint: drag feels right at all six stages, and nothing black-screens.**

### Phase 3 — Weld handoff, marker, 3→4 continuity

1. `tilesCarve.ts` + prism discard, `uCarve` on the transit ramp.
   → verify: screenshots at `u` = 0.80, 0.83, 0.86, 0.87, 0.90; no frame with two Welds
   and no frame with none.
2. `WeldMarker.tsx`; `campusGeometry.ts` and the `<Line>` cage deleted.
   → verify: the pin holds constant on-screen size (±1 px) from `u` 0.4 to 0.9; the ring
   sits on Weld's footprint in the overlay diff.
3. `visibility()` — tiles always mounted; the stage-4 disappearance fixed.
   → verify (**the gate for §0.7**): at every `u` in a 200-sample sweep, frame coverage
   is non-zero and the Yard is present through stage 4.
4. `WeldExterior` cross-fade; `Threshold` seam removed.
   → verify: `tests/weldGeometry.test.ts`, `tests/cutaway.test.ts` green; the four
   cutaway modes still cut.

**Checkpoint: 3 and 4 read as one continuous move into the building.**

### Phase 4 — stance, loading, quality

1. `EYE` → 5.1667 ft.
   → verify: `tests/walk.test.ts`, `tests/collide.test.ts`, `tests/route.test.ts` green;
   re-measure doorway and ceiling clearance at the new height and record the numbers.
2. `LoadingBar.tsx`; `FlyDown` waits on tiles settled.
   → verify: a throttled-network run shows the bar, then a sharp first frame — never the
   blur in §0.3.
3. `errorTarget`, LRU cache size, download parallelism tuned and **measured** on this
   machine: frame time, tile count, GPU memory, time-to-settle at each stage.
   → verify: a recorded table in this document, the way every other number in this repo
   is recorded.

**Checkpoint: it loads properly and stage 5 sits right.**

### Phase 5 — gates and documentation

1. `perf.spec.ts`: draw-call budgets replaced by triangles + frame time + tile memory,
   measured not guessed.
2. `journey.spec.ts`: palette-membership heuristics replaced by colour variance and
   edge-energy measures that work on photoreal frames.
3. Delete `imagery.spec.ts`, `campus.spec.ts`, `contrast.spec.ts`,
   `wheel-and-spin.spec.ts`; fold what survives into a new `descent.spec.ts`.
4. New gates: no black frame at any `u`; drag never sends altitude negative; one root
   tileset request per page load; tiles settle within N s at each stage.
5. `MASTER.md`, `SOURCES.md`, `CHECKLIST.md`, this file's measured tables.

**Checkpoint: full suite green, docs true.**

---

## 5. What is explicitly out of scope

- The interior geometry, furniture, walk and route systems.
- The dimension sliders and the edit/drag layer.
- The suite's lighting model.
- Mobile. `DesktopOnly.tsx` stays as-is; streaming tiles make the mobile case worse, not
  better, and that is a separate decision.

---

## 6. Risks

| # | risk | mitigation |
|---|---|---|
| 6.1 | float32 precision at ECEF scale — cracks between tiles, jitter near the camera | phase 1 checkpoint looks for it directly; `3d-tiles-renderer` keeps tile geometry tile-local, and the camera stays near the site origin, so the exposure is one `Matrix4`. If it bites, the fallback is re-rooting the tiles group per stage. |
| 6.2 | Harvard Yard's tile LOD may not be as sharp as you imagine | phase 1 is the spike; you look before we commit further. |
| 6.3 | Draw calls and GPU memory explode; the machine that runs this may not be the machine that views it | phase 4 measures on real hardware and `errorTarget` is the dial. Fallback path exists. |
| 6.4 | EEA visitors get no tiles (Google blocks the API there) | fallback path renders L3/L4 + `campus.glb`. |
| 6.5 | CI burns billable events | e2e runs keyless by default; one opt-in `@tiles` spec. Budget alert at $5. |
| 6.6 | Key is public by construction (browser-side) | HTTP-referrer restriction + daily quota cap. This is the standard Maps browser pattern; a proxy would route every tile byte through your server for no security gain, since the referrer restriction is what actually binds the key. |
| 6.7 | The piece loses its identity — the cyanotype was the concept | decision 9 was taken with that stated. Recorded here so it is a choice and not an accident. |
| 6.8 | Google's Weld and the parametric Weld differ by 1–2 ft at the swap | feathered carve + a fast cross-fade during a move the camera is already making. |

## 6a. Session budget discipline (binding)

1,000 free root-tileset requests per month. My own testing is the only thing that can
eat them. Rules for the build:

- **Hard ceiling: 150 keyed sessions for the whole of P11.** A `window.__tiles` counter
  is written to a scratch log on every keyed run; I report the running total at each
  checkpoint. If it passes 100 I stop and tell you before continuing.
- **Keyless by default, everywhere.** Dev server, vitest, and the full Playwright suite
  all run with no key on the L3/L4 fallback path. A key is set only for the specific
  screenshot or measurement that needs one.
- **No keyed sweeps.** The 200-sample coverage sweep (phase 3) and the ±720° drag sweep
  (phase 2) run keyless — they test the camera and the visibility logic, neither of
  which needs photoreal pixels. Keyed runs are single-frame captures only.
- **One page load per capture, batched.** All the screenshots a checkpoint needs come
  from one browser session, scrubbing between them, not one load per shot. That is 1
  billable event per checkpoint, not 8.
- **Quota cap on the key**, set in Google Cloud at phase 1: a daily cap low enough that a
  runaway loop stops itself. Belt to the budget alert's braces.
- **You eyeball, I don't re-screenshot.** At each checkpoint I hand you a running dev
  server and a list of what to look at, rather than capturing my own evidence for things
  you can see faster.

Expected actual spend across all five phases: **~40–60 sessions**, i.e. inside the free
tier with your own 125 on top.

## 7. Rollback

Every phase is a commit on a branch off `main`. Phases 1–2 are independently
revertible. The point of no return is phase 3, where `campusGeometry.ts` and the L0–L2
plates are deleted — those are recoverable from git, and `scripts/fetch-imagery.mjs`
regenerates the plates from source if ever needed.

## 8. Open questions — resolved 2026-08-01

1. **GCP billing.** No project yet. Click-path below; phase 1 step 2 waits on you, the
   rest of phase 1 does not.
2. **Eye height.** Confirmed 5'2" = 5.1667 ft.
3. **Boston label.** Kept, repositioned off the pin's collision band rather than dropped.
   `Labels.tsx` gets an explicit offset/priority so BOSTON and Weld's pin never occupy the
   same ~40 px at the 260,000→26,000 ft band.
4. **Wheel semantics.** Wheel drives the descent (§2.4), at all stages. Scrubber still
   works as an alternate control on the same `u`.

### 8.1 GCP click-path (yours to run)

1. console.cloud.google.com → new project (or pick an existing one) → attach a billing
   account (needs a card; this is Google's requirement for the Map Tiles API, not
   optional).
2. APIs & Services → Library → search "Map Tiles API" → Enable.
3. APIs & Services → Credentials → Create credentials → API key.
4. Edit the key → Application restrictions → **Websites** → add
   `localhost:3000/*` and your Vercel domain(s) (`*.vercel.app/*` plus the production
   domain once known).
5. Edit the key → API restrictions → restrict to **Map Tiles API** only.
6. Billing → Budgets & alerts → new budget → $5 → alert at 50/90/100%.
7. APIs & Services → Map Tiles API → Quotas → set a daily cap on "Root tileset requests"
   low enough that a runaway loop stops itself (a few hundred/day is generous headroom
   over the ~40–60/month this build expects).
8. Paste the key back here, or set it yourself as `NEXT_PUBLIC_GOOGLE_MAPS_KEY` in
   `.env.local` (never commit it — `.env.example` ships with the empty var name only).

Nothing in phase 1's code depends on the key existing yet — decision 10's keyless
fallback is exactly for this gap.
