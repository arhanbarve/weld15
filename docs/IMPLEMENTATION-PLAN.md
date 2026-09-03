# Weld 15 — Implementation Plan

Interactive 3D model of Weld 15, Harvard Yard. Cinematic descent from orbit to the suite, then a
fully manipulable room. Deployed on Vercel.

Status: **plan awaiting approval. No application code written yet.**

---

## 1. Goal and non-goals

**Goal.** A single-page web app that takes you from a globe down to the inside of Weld 15 in one
continuous move, then hands you the room to explore and rearrange. The campus is built from
Harvard's real published building geometry. The suite is built from a parametric room graph derived
from a housing office's description, where every uncertain dimension is a control
you can move rather than a number baked into a mesh.

**Non-goals.**

- Not a general floor-plan editor. It models one suite.
- Not photorealistic. The look is a cyanotype scan resolving into a clean daylight room.
- No accounts, no database, no server state. Layouts travel in the URL.
- Not a Harvard product and must not present itself as one. Data attribution is explicit in the UI.
- No VR/AR.

---

## 2. Locked decisions

| Decision | Choice | Where it came from |
|---|---|---|
| Experience shape | Journey + suite, 6 stages | Round 1 |
| Visual direction | A — cyanotype scan → daylight interior | Round 2, from rendered comparison |
| Interactions | Furniture drag, cutaway/wall toggles, day-night sun, first-person; plus orbit, dimension sliders, share-by-URL | Round 1 + 3 |
| Stack | Next.js 16, React 19.2 (pinned), react-three-fiber 9, drei 10, three, zustand | Round 3; versions corrected in P0 against the registry |
| Furniture | Procedural from primitives | Round 3 |
| Platform | Desktop-first, mobile simplified | Round 3 |
| Build order | Thin end-to-end slice, then beautify | Round 3 |
| Room K | Study / second common room | Round 2 |
| Occupancy | Four, two doubles — but bed count is a control | Round 2, with Weld's documented quints/sextuplets flagged |
| Room graph | North-gable band, common room on the right, bathroom on the hall | Confirmed after correction |
| Placement in Weld | Default north-gable east-west; four options selectable | Undetermined by public data |
| Design system | `design-system/MASTER.md` | `/ui-ux-pro-max`, palette overridden |
| Intro | Must have a skip control | `/ui-ux-pro-max` immersive-pattern requirement |

### Corrections already folded in

1. Common room is on the **right** on entry. My first draft was mirrored.
2. Bedroom B is **10 × 16**, same orientation as A. Removes the phantom unaccounted space.
3. Bathroom is **7 × 9 and touches the hall**, so its door opens into the bathroom. Earlier I had
   closets between hall and bath, which meant door two opened into a closet.
4. Bathroom size is **inferred, not given**. The resident supplied no bathroom dimension. Benchmark:
   three-quarter baths average 36 sq ft, range 18–50.
5. The leftover west strip is **not labelled "elevator"**. It is ~7 ft that is simply outside the
   suite. Naming it was a guess dressed as a fact.
6. "K has no window" is **dropped**. I invented it and let it move the room.

---

## 3. Data already in the repo

| File | Contents | Provenance |
|---|---|---|
| `data/campus.json` | 39 building footprints within 620 ft of Weld, each with real `height_ft`, in feet, local frame, x=east y=north, origin = Weld centroid | Harvard PPM public ArcGIS, `Hosted/Facilities3D/FeatureServer/5` |
| `data/weld.json` | Weld Hall footprint, 59-point ring plus two slivers; 54 × 151 ft, 87.01 ft, axis 13.2° E of N | Same, cross-checked against OpenStreetMap way 29824449 |
| `design/weld15-directions.html` | The visual-direction comparison that selected direction A | Session artifact |
| `design/weld15-plan-derivation.html` | The plan derivation and provenance ledger | Session artifact |
| `design-system/MASTER.md` | Tokens, type, motion, accessibility gates, z-index scale, anti-patterns | `/ui-ux-pro-max` + locked direction |

Origin for all local coordinates: **lat 42.3739244, lon −71.1171195**, 1 unit = 1 foot.

---

## 4. Architecture

### 4.1 The one idea the whole app rests on

`buildSuite(params) -> { rooms, walls, openings, area }` is a **pure function with no three.js
import**. Every dimension the housing office was unsure about is a field in `params`. Geometry,
walls, doors, windows, furniture snap targets, the first-person collision hull, and the area readout
all derive from its output. Nothing else in the app knows how the suite is shaped.

That buys three things: dimension sliders are free rather than a rewrite; the mirror and placement
options are a transform applied after the fact; and the hardest logic in the project is testable in
Node with no browser, no canvas, and no screenshots.

### 4.2 File tree

```
weld15/
  package.json  next.config.ts  tsconfig.json  vitest.config.ts  playwright.config.ts
  app/
    layout.tsx                 fonts, metadata, theme bootstrap
    page.tsx                   mounts <Experience/> via next/dynamic ssr:false
    globals.css                tokens from design-system/MASTER.md
  src/
    data/
      campus.json  weld.json   (moved from /data at P0)
      program.ts               DEFAULT_PARAMS, FURNITURE_CATALOG, ROOM_META
    geo/
      project.ts               lat/lon <-> local feet, building-frame rotation
      rooms.ts                 buildSuite() — the parametric core
      walls.ts                 room rects -> deduped wall segments + openings
      extrude.ts               footprint ring + height -> BufferGeometry
      solar.ts                 NOAA sun position for Cambridge, in building frame
      collide.ts               AABB overlap, wall snap, floor containment
    scene/
      Experience.tsx           <Canvas>, stage machine, scene switch
      CameraRig.tsx            per-stage keyframes, spline interpolation, reduced-motion cut
      Globe.tsx                stage 0, separate scene graph
      Campus.tsx               stages 1-3, merged masses + Line2 edges + ground grid
      WeldExterior.tsx         stage 3-4, own extrusion, dissolve at threshold
      Threshold.tsx            stage 4, clip plane + scanline sweep
      Suite.tsx                stage 5, floors, walls, openings, cutaway
      Furniture.tsx            instanced procedural props
      Sun.tsx                  directional light + sky from solar.ts
      FirstPerson.tsx          eye-height controls, collision against walls
    ui/
      Hud.tsx                  stage scrubber, skip, stage title
      Panel.tsx                tabs: rooms, furniture, dimensions, light, placement
      DimensionSliders.tsx     writes params
      FurnitureList.tsx        add/remove/select
      Legend.tsx               provenance chips: given / derived / inferred
      Attribution.tsx          Harvard GIS + Crimson credits
      A11yAlt.tsx              live text description of the canvas
    state/
      store.ts                 zustand: stage, params, furniture, flags
      url.ts                   encode/decode share links
  tests/
    rooms.test.ts  walls.test.ts  solar.test.ts  url.test.ts  collide.test.ts
    e2e/journey.spec.ts  e2e/edit.spec.ts  e2e/a11y.spec.ts
```

### 4.3 State shape

```ts
type Store = {
  stage: 0|1|2|3|4|5;
  playing: boolean;                 // intro auto-advance
  params: SuiteParams;              // every inferred dimension
  furniture: Piece[];               // {id, type, room, x, y, rot}
  selected: string | null;
  view: {
    cutaway: 'none'|'roofOff'|'section';
    hiddenWalls: string[];
    autoFade: boolean;              // fade walls between camera and target
    mode: 'orbit'|'firstPerson';
    timeOfDay: number;              // hours, 0-24
    dayOfYear: number;
    highContrast: boolean;
  };
};
```

`params` and `furniture` are the only things serialized to the URL. Everything else is session view
state.

### 4.4 The six stages

| # | Name | Camera | Content | Notes |
|---|---|---|---|---|
| 0 | Orbit | ~2.5 radii from a unit sphere | Globe, cyanotype landmass, Boston marker | Separate scene graph; crossfades to stage 1 |
| 1 | Cambridge | ~4,000 ft out, 55° pitch | All 39 footprints, ground grid, river hint | Foot-scale world begins here |
| 2 | Harvard Yard | ~900 ft out, 40° pitch | Same geometry, Weld's edges switch to white and pulse | Label chip appears |
| 3 | Weld Hall | ~180 ft out, orbitable | Weld extruded to 87 ft with tower masses | User can free-orbit here |
| 4 | Threshold | pushing through the north gable, 40 ft → 2 ft | Gable dissolves; scanline sweep; interior fades up | The risky one. Built in P2. |
| 5 | Weld 15 | inside, orbit or first-person | Full suite, daylight materials, all controls live | Terminal stage |

Scale discontinuity is only between 0 and 1, handled as a crossfade between two scene graphs.
Stages 1–5 share one continuous foot-scale world, so 4,000 ft → 2 ft is a single camera spline with
no precision problems in float32.

---

## 5. Visual and material spec

Tokens live in `design-system/MASTER.md`; this is how they land in 3D.

**Scan stages (0–4).** Background `#06203F`. Building masses `rgba(150,200,245,0.10)` with
`depthWrite: false` so overlapping volumes read as translucent glass. Edges are **Line2 from drei**,
not `LineBasicMaterial` — GL line width is capped at 1px on every major platform, and the
accessibility gate requires ≥1.5px at 1× DPR scaled by `devicePixelRatio`. Weld's edges are white
at 2.2px and carry a slow opacity pulse plus a label chip. Ground grid `#0C3260`. A single
`UnrealBloomPass` at low strength; nothing else post.

**Daylight stage (5).** Plaster `#F0EDE7` lit / `#DFDAD1` shaded, oak floor `#B5813F`, glazing
`#CFE4F2`, bedding and textiles `#A41034`. Soft shadows from one directional light plus a hemisphere
fill. Subtle SSAO in corners. No bloom.

**The honest sun.** `solar.ts` computes real altitude and azimuth for 42.3739 N, 71.1171 W and
rotates it into the building frame. Consequence worth surfacing in the UI rather than hiding: a
north-gable suite receives **almost no direct sunlight**. The bedrooms get soft, even north light
year-round; only the common room, which also faces east, catches direct morning sun. That is a real
property of your room and the time-of-day slider should teach it, not paper over it.

---

## 6. Interaction spec

**Orbit.** `OrbitControls`, damped, with per-stage distance and polar clamps so you cannot get
outside the building at stage 5 or under the ground at stage 1.

**Cutaway.** Three modes. `roofOff` hides the ceiling plane. `section` clips at an adjustable plane.
`autoFade` raycasts from camera to orbit target each frame and drops any wall in the way to 0.12
opacity — this is what stops the "I can't see anything" failure that kills most interior 3D.

**Furniture drag.** Pointer raycasts to the floor plane. Snap to a 0.5 ft grid, plus wall-snap when
within 1 ft of a wall. `collide.ts` rejects any position whose AABB overlaps another piece or leaves
the room polygon; rejected drags show the piece in crimson at 40% and snap back on release. `r`
rotates 90°. Arrow keys nudge 0.5 ft. Every drag has this keyboard equivalent — required by the
accessibility gate, and it is also just faster.

**Dimension sliders.** One per inferred quantity, each labelled with its provenance chip. Moving one
re-runs `buildSuite`, which regenerates walls and re-validates furniture positions; pieces that no
longer fit are nudged to the nearest legal spot rather than deleted.

**Placement selector.** Four options from the derivation. Applies a rotation and translation to the
whole suite inside Weld and updates which facade each window faces, which changes the sun result.

**First person.** Eye height 5 ft 10 in, WASD plus pointer-lock look, capsule collision against
walls, doorway clearance 2 ft 8 in. Disabled on touch devices.

**Share.** `params` diff from defaults plus the furniture array, JSON → deflate → base64url in the
query string. Target under 1,500 characters. Loading a link restores the suite and the stage.

---

## 7. Build phases

Thin slice first. Each phase ends with a command I run and output I show you — no phase is "done"
on inspection alone.

### P0 — Scaffold and deployment pipeline

Steps:
1. `npm create next-app@latest` — TypeScript, App Router, no Tailwind (tokens are hand-written CSS).
2. Add `three`, `@react-three/fiber`, `@react-three/drei`, `zustand`, `three-stdlib`.
3. Add `vitest`, `@playwright/test`, `@axe-core/playwright`.
4. Move `data/*.json` to `src/data/`.
5. `globals.css` from `design-system/MASTER.md`, both themes, fonts via `next/font/google`
   (IBM Plex Mono, Libre Baskerville) — self-hosted, no CDN.
6. Placeholder page that renders the tokens and a `<Canvas>` with one cube.
7. **`git init` and first commit — I will ask before running any git command.**
8. Connect to Vercel, deploy.

Verify: `npm run build` clean; `npx tsc --noEmit` clean; live Vercel URL renders the cube; Lighthouse
run recorded as a baseline.

Done when: you can open the Vercel URL and see a spinning cube in the right colours.

### P1 — Geometry core, no rendering

Steps:
1. `project.ts` — lat/lon → local feet, and the 13.2° building-frame rotation both ways.
2. `rooms.ts` — `DEFAULT_PARAMS` and `buildSuite()`. Packs the band west→east, builds bedroom A as
   an L-polygon, returns room polygons and area.
3. `walls.ts` — collect every room edge, dedupe shared edges, classify exterior vs partition, place
   door and window openings.
4. `solar.ts` — NOAA sun position, then rotate into the building frame.
5. `collide.ts` — AABB overlap, point-in-polygon, wall snap.
6. `extrude.ts` — ring + height → `BufferGeometry` with cap triangulation and side quads.

Verify: `npm test` with these assertions —
- room areas sum to 966 ± 2 sq ft at defaults
- no two room polygons overlap, at defaults and across 200 randomized param sets
- every room shares an edge with the hall, or with a room that does — nothing is landlocked
- `mirror` twice is the identity
- wall dedupe: shared edges appear exactly once, exterior count equals the band perimeter
- solar altitude for Cambridge at 2026-06-21 12:00 and 2026-12-21 12:00 within 0.5° of published
- north-gable windows receive zero direct sun on 2026-12-21 — the claim in §5, asserted
- `extrude` on Weld's real ring produces a watertight, correctly-wound geometry

Done when: `npm test` is green and I paste the output, including the computed area and the winter
solstice sun check.

### P2 — Grey-box vertical slice, all six stages

The riskiest integration is stage 4. It gets built now, ugly, rather than last.

Steps:
1. `store.ts` with the stage machine.
2. `Experience.tsx`, `CameraRig.tsx` — keyframes per stage, `CatmullRomCurve3`, damped follow.
3. `Globe.tsx` — plain sphere, Boston marker, crossfade out.
4. `Campus.tsx` — all 39 footprints extruded, flat grey, one merged mesh.
5. `WeldExterior.tsx` — Weld extruded, flat grey.
6. `Threshold.tsx` — clip plane on the gable plus opacity dissolve; interior mounts hidden at
   stage 3 and fades in at 4.
7. `Suite.tsx` — floors and walls as untextured boxes from `buildSuite`.
8. `Hud.tsx` — stage scrubber and **skip control, first item in tab order**.

Verify: Playwright `journey.spec.ts` drives the scrubber 0→5, screenshots each stage, asserts no
console errors and that stage 5 contains the expected wall count. Manual: watch the threshold
transition and judge it.

Done when: you can travel globe → inside the room and back, and you have told me the threshold
either works or needs a different treatment. **This is the decision point where the transition
approach can still change cheaply.**

Rollback: if the dissolve reads badly, fall back to a hard cut behind a scanline wipe — a contained
change inside `Threshold.tsx`.

### P3 — Campus in cyanotype

Steps:
1. Palette from MASTER.md; translucent masses with `depthWrite: false`.
2. Edge lines as drei `<Line>` (Line2), width scaled by `devicePixelRatio`, floor 1.5px.
3. Ground grid, vignette, low-strength bloom.
4. Weld highlight: white 2.2px edges, opacity pulse, label chip, all three together so hue is never
   the only signal.
5. Merge geometry: one mass mesh, one line mesh.

Verify: screenshot stages 1–3 and compare against the direction-A panel in
`design/weld15-directions.html`. Draw calls under 10, checked via `renderer.info`. Frame time under
16 ms at 1440p on this machine. Contrast on every text chip measured, not eyeballed.

Done when: the campus matches the mockup you picked and I show the draw-call and frame-time numbers.

### P4 — Weld exterior and a real threshold

Steps:
1. Weld from its own 59-point ring, 87 ft, plus the two tower slivers as separate masses.
2. Window bays on the gable from `openings`, so exterior and interior agree.
3. Free orbit at stage 3 with clamps.
4. Finish the threshold: scanline sweep, gable dissolve, interior fade, and the reduced-motion
   jump-cut path.

Verify: Playwright asserts the reduced-motion path produces no camera interpolation frames.
Screenshots at threshold progress 0, 0.5, 1.0.

Done when: the transition is one you would show someone.

### P5 — Interior in daylight

Steps:
1. Materials per MASTER.md. Oak floor with a grain normal generated procedurally.
2. Walls from `walls.ts` with real 1.5 ft masonry on exterior faces, 0.5 ft partitions, reveals at
   openings.
3. Glazing, sills, and the sun from `solar.ts`; hemisphere fill; soft shadows; light SSAO.
4. Procedural furniture: bed, desk, chair, dresser, sofa, table, shelving, plus the K study fit-out.
   All instanced per type.
5. Ceiling plane at 10 ft 6 in, hidden in `roofOff`.

Verify: screenshots at 08:00, 13:00, 19:00 on 2026-09-15 and 2026-12-21. Assert visually that the
north rooms show no direct sun patch and the common room does at 08:00. Frame time under 16 ms.

Done when: the room looks like the direction-A interior panel and the light behaves correctly.

### P6 — Make it changeable

Steps:
1. Cutaway modes and `autoFade` wall dropping.
2. Furniture drag with snap, collision, rejection feedback; keyboard equivalents.
3. Dimension sliders wired to `params`, each with its provenance chip; furniture re-validation.
4. Placement selector, mirror toggle, K-use switch, per-room bed count 1–3.
5. URL encode/decode.

Verify: `edit.spec.ts` — drag a bed, read the URL, reload it, assert the bed is where you left it;
drive a dimension slider and assert the wall count and area change; assert a colliding drag is
rejected; do the same drag with arrow keys only.

Done when: you can rearrange the room, send yourself the link, and reopen it identically.

### P7 — First person and mobile

Steps:
1. `FirstPerson.tsx` — pointer lock, capsule collision, doorway clearance, eye height.
2. Mobile: touch orbit, shortened intro, first-person hidden, lower shadow resolution, reduced
   line widths, capped DPR at 2.
3. Responsive HUD and panel at 375 / 768 / 1024 / 1440.

Verify: Playwright at all four widths, no horizontal scroll, all touch targets ≥ 44px. First person
walks the hall end to end without passing through a wall.

Done when: it holds up when you hand someone your phone.

### P8 — Accessibility, performance, ship

Steps:
1. Work the MASTER.md checklist item by item.
2. `A11yAlt.tsx` — live region describing the current stage and room.
3. `axe-core` scan on every stage; fix everything it finds.
4. Perf: bundle analysis, code-split the globe, texture budget, `renderer.info` audit.
5. Attribution panel: Harvard PPM ArcGIS, OpenStreetMap, The Crimson.
6. Optional custom domain.

Verify: `a11y.spec.ts` green with zero violations; Lighthouse ≥ 90 performance and 100
accessibility; the full checklist pasted with each box actually checked.

Done when: every gate is green and I show you the output rather than telling you it passed.

---

## 8. Test plan

| Layer | Tool | Covers |
|---|---|---|
| Geometry | Vitest | `rooms`, `walls`, `solar`, `collide`, `extrude`, `url`. Property tests over randomized params. |
| Behaviour | Playwright | Stage journey, skip control, drag + URL round trip, sliders, cutaway, reduced motion, first person |
| Accessibility | axe-core in Playwright | All six stages, both themes, four breakpoints |
| Visual | Playwright screenshots | Compared against the approved direction-A panels |
| Performance | `renderer.info` assertions in Playwright | Draw calls and triangle budget per stage |

There is no existing test framework in this repo, so P0 installs one. I will not claim a passing
suite without pasting the run.

---

## 9. Performance budget

**These are SCENE draw calls, excluding the bloom composer's 17 fullscreen passes.** Stated
because the omission caused the same misreading three times: `WeldExterior.tsx`'s header and
`docs/phases/P4-P5.md`'s verification table both recorded a mesh count as a call count, and both
were corrected from measurement. The composer's share is exactly **17 calls and 17 triangles** at
1280 × 720 — one fullscreen triangle per pass — measured at ten points by comparing full motion
against `prefers-reduced-motion: reduce`, where it is not mounted. So a frame reading 38 calls at
stage 5 is 21 of scene against the 25 below.

| Stage | Draw calls | Triangles | Target | Measured | Verdict |
|---|---|---|---|---|---|
| Globe | ≤ 4 | ≤ 20k | 60 fps | **3** / 3,328 | pass |
| Campus | ≤ 10 | ≤ 120k | 60 fps desktop / 30 mobile | **9** / 16,882 | pass, the tightest row |
| Weld exterior | ≤ 8 | ≤ 40k | 60 fps | **4** / 416 | pass |
| Suite | ≤ 25 | ≤ 80k | 60 fps desktop / 30 mobile | **21** / 1,452 | pass |

Merged geometry for campus masses and edges. Instanced furniture. DPR capped at 2. Canvas mounted
`ssr: false`.

**The globe is deliberately NOT code-split, against this plan's own instruction**, and the
measurement is in `docs/phases/P7-P8.md`'s Performance section: the whole globe is 716 B of a
1,252,534 B scene chunk, because it is three spheres and every three class it touches stays
behind. A lazy boundary moves 432 B and ships 1,173 B *more*, by forcing `geo/frames` into its
own chunk the main bundle fetches immediately anyway. It also breaks the descent — with the
chunk delayed 2,500 ms, stage 0 reads 0.0% coverage and one distinct colour for two seconds,
failing `journey.spec.ts`'s own gate on every frame in that window. Stage 0 *is* first paint, so
"not in the critical path once you are past it" is a contradiction for this one component.

**Frame time is recorded and never gated**, and as of P8 there is finally a real number: Apple
M5 Pro, macOS 26.5.2, headed Chrome 150 against a production build, ANGLE Metal renderer — 2.5
to 2.8 ms median across all six stages at DPR 2, p95 never above 4.0. Headless Chromium runs
SwiftShader at 62–79 ms, about 25× the hardware cost, which is why every gate in the suite is on
draw calls and triangles instead.

The 60 fps targets above are therefore met with room to spare on this machine. Lighthouse
performance is a separate question and is **81 against a target of 90** — the cost of shipping a
WebGL engine, with 420 ms of total blocking time of which 322 ms is evaluating the scene chunk.
`docs/phases/P7-P8.md` carries the breakdown.

---

## 10. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Threshold transition looks cheap | Medium | Built in P2, judged before anything is polished. Fallback: scanline wipe hard cut. |
| Cyanotype thin lines fail contrast | Medium | Line2 with a 1.5px floor, DPR scaling, high-contrast toggle, hue never the sole signal. Style DB explicitly flags this family. |
| Layout is simply wrong | **High** | Everything inferred is a slider; placement is a selector; provenance chips tell you what to distrust. Being wrong costs a drag, not a rebuild. |
| Occupancy is 5–6, not 4 | Medium-high | Weld is documented as quints and sextuplets. Bed count is a per-room control 1–3. |
| Mobile perf | Medium | Simplified path from P7, DPR cap, reduced shadows, shorter intro. |
| Scope creep | Medium | The six stages and the interaction list above are the whole scope. Anything else is a later conversation. |

---

## 11. Still open, none of it blocking

1. **Occupancy.** Does the housing assignment give an occupant count? Default is four.
2. **Placement.** Unknowable from public sources. Default north-gable; selector ships regardless.
3. **What K actually is.** Modelled as a study. You will find out in September.
4. **JFK layer.** Weld 15 is the post-1962 renumbering of Kennedy's Weld 32. Currently out of scope;
   could be a plaque you find by clicking, or a 1936 overlay. Say the word and it becomes P9.
5. **Ceiling height.** 10 ft 6 in inferred, in no public source. Slider.
6. **Custom domain** or `*.vercel.app`.

---

## 12. What I need from you to start

1. Approval of this plan, or the parts you want changed.
2. Permission for `git init` plus a first commit — per your global rules I will not run git without
   asking.
3. Whether to connect Vercel now in P0 or build locally and deploy at P8.
