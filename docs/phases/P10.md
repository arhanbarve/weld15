# P10 — The building becomes a building

Three complaints, one phase.

1. *"Every single furniture or interior object should be rendered better."* Today every piece of
   furniture is one axis-aligned box, every wall meets every floor at a bare corner, and no window
   in the model has a window in it.
2. *"If you have an open window, it should have a window panel on it."* There is no sash, no
   glazing bar, no casing, no sill board — inside or out. The exterior's windows are solid boxes
   painted dark.
3. *"Completely rework stage four."* The entry angle is a head-on wall because it is derived from
   the crossing rather than chosen, and stage 4 is the one exterior stage with no camera control.
   Stage 3 can be dragged; stage 4 cannot.

---

## 0. Decisions taken before this document was written

**Scope cut, 2026-07-31, before any code was written.** A second concurrent session
(`weld15-imagery`, branch `p10-imagery`) is independently doing: (a) swapping the ground imagery
source and retuning `Ground.tsx`'s tint constants, and (b) extracting Harvard's own I3S building
mesh into `campus.glb` as real, georeferenced building geometry. That is the same goal as this
document's original workstreams B (Weld's procedural exterior detail) and C (Google Photorealistic
3D Tiles) — both were "make the building/ground read as real" — solved a different, incompatible
way. Confirmed with the user: **this phase drops B and C entirely.** Exterior and ground realism
belong to `p10-imagery`. This document keeps only the interior (workstream A, revised to touch
nothing exterior) and stage 4's camera (workstream D). Sections 6, 7, and the tile-related rows of
§3/§4/§9/§10/§11/§12 below are struck accordingly and kept only as a record of what was decided
against, not as pending work.

**D1 — The cyanotype survives, and gets no less crude at the exterior end than it is today.**
`design-system/MASTER.md` builds the piece on scan → daylight, with the crossing as the payoff.
That is kept, untouched. This phase does not add exterior detail to either end of it — that is
`p10-imagery`'s I3S geometry, not this phase's procedural brick/stone. The interior end gets more
real (real furniture, real windows, real trim); the exterior end does not move here.

**D4 — Stage 4 orbits freely and then funnels.** Full stage-3-style drag and wheel while the
scrubber is low. As `t` advances the viewer's chosen pose blends back onto the crossing line and is
perpendicular to the gable by `SHELL_GONE`. The viewer picks the approach angle; the perpendicular
crossing stays true by construction rather than by trusting a drag to have been reasonable. This
works against whatever exterior geometry is rendered at the time — procedural today, `p10-imagery`'s
I3S mesh later if that lands first — because the camera rig only reads `stages.ts`'s keyframes and
`orbit.ts`'s clamp, neither of which reference the exterior mesh's implementation.

---

## 1. Goals

- G1. Every furniture kind is modelled as the thing it is, not as its bounding box.
- G2. Every window opening, seen from inside, carries a real sash and glass rather than a bare pane.
- G3. Interior surfaces read as a room: base, casing, cornice, and materials with structure.
- ~~G4. Weld's exterior carries the features `weld.json` and the 1875 description already record.~~
  **Dropped — `p10-imagery`'s territory.**
- ~~G5. The campus is Google photogrammetry, resolved into the scan palette by altitude.~~
  **Dropped — `p10-imagery`'s territory.**
- G6. Stage 4 is draggable, and its approach angle is the viewer's rather than the geometry's.
- G7. Nothing above breaks the crossing, the walk, the editor, the URL format, or the a11y gates.
- G8. Nothing above touches `weldGeometry.ts`, `WeldExterior.tsx`, `Ground.tsx`, `Campus.tsx`, or
  `materials.ts`'s exterior tokens — those are `p10-imagery`'s files for the duration of this phase.

## 2. Non-goals

- **Not** a photoreal interior. The daylight palette is `MASTER.md`'s and does not move.
- **Not** a rewrite of the suite's dimensions. `rooms.ts`, `walls.ts` room geometry, `place.ts` and
  `frames.ts` are read, not edited, except for the two specific changes named in §5.2.
- **Not** new furniture *kinds*, and not a change to any `SIZES` entry. The inventory and the
  footprints are `docs/DIMENSION-AUDIT.md`'s; this phase changes what is drawn inside a footprint,
  never the footprint. A piece that fits today fits afterwards, bit for bit.
- **Not** a change to the URL wire format. `occupancy` landed at v2 four commits ago; nothing here
  adds a field.
- **Not** anything exterior. No belt courses, no cornice, no entrance, no Google tiles, no touch of
  `weldGeometry.ts`, `WeldExterior.tsx`, `Ground.tsx`, `Campus.tsx`, or `materials.ts`'s exterior
  tokens. That is `p10-imagery`'s phase, decided after both were scoped and found to be solving the
  same problem twice.

## 3. Assumptions, and what is sourced

Following `docs/DIMENSION-AUDIT.md`'s rule: an inference is never presented in the same voice as a
measurement.

| thing | status |
|---|---|
| eaves 60.0 ft, ridge 85.4 ft, 5 floors at 12 ft | **SOURCED** — Cambridge GIS, already in `weld.json` |
| Harvard dorm mattress 38 × 80 in | **SOURCED** — already `MATTRESS` in `furniture.ts` |
| double-hung 2-over-2 sashes | **ASSUMED** — no source gives the light pattern |
| sash stile/rail 0.17 ft, meeting rail 0.25 ft, muntin 0.06 ft | **ASSUMED** — standard joinery |
| baseboard 0.62 ft tall × 0.06 ft proud | **ASSUMED** |
| door casing 0.35 ft wide × 0.05 ft proud; door leaf 0.14 ft thick | **ASSUMED** |
| bed legs, headboard, pillow, blanket dimensions | **ASSUMED** — as every non-mattress figure already is |

Rows for the exterior (belt course dimensions, brick course, sandstone) and for tiles (MassGIS
imagery, ECEF/ENU) are dropped with workstreams B and C — they belong to `p10-imagery` now.

Every ASSUMED figure gets a named constant with a comment saying so, in the manner the codebase
already uses. None of them is laundered into a table of measurements.

## 4. Open questions

- **Q1.** Does the sash light pattern matter enough to source? Widener's and Weld's contemporaries
  are 2-over-2; a photograph would settle it. Proceeding with 2-over-2 marked ASSUMED, revisable in
  one constant.
- ~~Q2~~ — was about the Google tile mesh vs hand-built Weld. Moot; tiles dropped from this phase.
- **Q3.** Whether `verify-run/` belongs to another session. It is untracked in main and this phase
  does not touch it. Flagged, not touched.

---

## 5. Workstream A — the interior

### 5.1 A1. Furniture becomes furniture

`src/scene/Furniture.tsx`, `src/geo/pieces.ts` (**new**).

Today: one `BoxGeometry(1,1,1)` (`Furniture.tsx:205`), instanced per kind, instance matrices
carrying the extents. A desk is a 4.0 × 2.0 × 2.5 ft solid block.

**The change that makes everything else possible: instances stop carrying scale.** Every piece of a
given kind has *the same* size — `SIZES` is per kind — so one geometry per kind at its true
dimensions is correct, and the instance matrix becomes a rigid transform. Three things follow that
are impossible today:

- Parts can have correct proportions independent of the whole.
- UVs can be baked at true world scale, so the oak grain finally applies to furniture.
  `materials.ts:348` currently withholds the grain from `oakDeep` *specifically because* 0..1 box
  UVs would stretch a 4 ft tile over a drawer front. That constraint disappears.
- Normals are correct per part rather than per bounding box.

**The trap this introduces, stated up front.** `Furniture.tsx:27-34`'s header warns that a `Piece`'s
`du`/`dv` are unrotated and `pieceBox()` applies the quarter turn, so today the mesh applies *only*
the suite yaw. With per-kind geometry at unrotated extents, the mesh must now apply **piece yaw ×
suite yaw** and must **not** use `pieceBox()` extents. Applying both would rotate twice and a bed
6.8 ft along `u` would come out 6.8 ft along `v`. This is the single highest-risk edit in workstream
A and it gets its own property test (§9).

New module `src/geo/pieces.ts` — three-free, in the manner of `rooms.ts` and `walk.ts`, so the part
layout is unit-testable in Node:

```
partsOf(kind: FurnitureKind): Part[]
  Part = { u, v, w, d, h, material: "oak" | "textile" | "hardware", turn?: number }
```

Coordinates are local to the piece, origin at its low corner, extents summing within `SIZES[kind]`.
`Furniture.tsx` turns `Part[]` into one merged `BufferGeometry` per (kind, material) pair.

Part breakdown:

| kind | parts | batches |
|---|---|---|
| bed | 4 rails, 4 legs, headboard panel + 2 posts, footboard, slat deck; mattress, pillow, folded blanket | oak + textile = 2 |
| desk | top, 2 end panels, modesty panel, 3 drawer fronts, back rail; 3 pulls | oak + hardware = 2 |
| chair | seat, 4 legs, 2 back stiles, 2 back slats | oak = 1 |
| dresser | carcase, top with overhang, 3 drawer fronts, plinth; 6 pulls | oak + hardware = 2 |
| sofa | seat cushion, back cushion, 2 arms, base rail; 4 legs | textile + oak = 2 |
| table | top with overhang, 4 legs, 2 stretchers | oak = 1 |
| shelf | 2 side panels, 4 shelves, back panel, plinth | oak = 1 |

**Draw calls: 8 today → 11.** Each is one `InstancedMesh` covering every piece of that kind
regardless of count, exactly as today. The 25-call suite budget in
`docs/IMPLEMENTATION-PLAN.md` §9 is already exceeded (measured 38 at stage 5, recorded in
`stages.ts:400-414`); §10 raises it deliberately with a fresh measurement rather than pretending.

**Triangle cost.** ~46 parts across 7 kinds × 12 triangles = ~550 triangles of *geometry*, shared
across all instances. At the default 29 pieces the submitted triangle count rises from ~350 to
roughly 4,100. Measured for real in step A1-v.

**`DragLayer` is unaffected, verified.** Picking does not raycast the furniture meshes: one
invisible plane at `floorLevel(1)` carries the handlers and pieces are hit-tested *arithmetically*
against `pieceBox()` (`DragLayer.tsx:36-68`). Geometry can change freely without touching the
editor. This is why A1 is safe to do at all.

### 5.2 A2. Windows become windows — interior only

`src/scene/Suite.tsx`, `src/geo/sash.ts` (**new**). **`walls.ts`'s opening emission and
`weldGeometry.ts` are not touched** — see §0's scope cut. A wider split of one opening into several
physically separate wall penetrations would change `bayRects()`'s count and, through it, the facade
`p10-imagery` is working on in the same window. So the room keeps today's single opening rectangle
per window (`walls.ts:520-556`, unchanged, `width = min(run * 0.55, 8)`); what changes is what fills
it.

**There is no window, only a hole and a plane of glass.** `Suite.tsx:316-329` emits a 0.06 ft box of
`glazing` in the void and nothing else. New `src/geo/sash.ts`, three-free, takes the *existing*
opening rectangle and returns the parts of a real window inside it:

- the opening's width is divided into `n = clamp(round(width / LIGHT_SPACING), 1, LIGHT_MAX)` lights
  side by side, each a double-hung sash — this is what makes an 8 ft opening read as a window bank
  rather than one implausibly wide sash, without changing the wall penetration or its id
- outer casing / architrave on the room face, `CASING_W` wide, `CASING_PROUD` proud, running the
  full opening width
- sill board on the room face, projecting `SILL_PROUD` with a `SILL_NOSE` nosing
- jamb linings on all four faces of the reveal
- per light — lower sash: 2 stiles, top and bottom rails, 1 vertical muntin → 2 panes; upper sash
  the same, offset up, its bottom rail the meeting rail at `MEETING_RAIL`
- glass: one pane per light, inset into the sash

Seen only from inside, at `Suite.tsx`'s existing opening. The reveal's outside face — what
`WeldExterior.tsx` draws — is untouched; from outside this remains today's solid box, which is
`p10-imagery`'s scope to change, not this phase's.

**Glass stays `transmission: 0`.** `materials.ts:399` records the measurement: transmission forces a
second full scene render, doubling every draw call. What carries the glass instead is that it now
sits in a real frame with real depth, plus the env map from A4 giving it something to reflect.

**A discovered defect, noted and left for the exterior owner.** While reading `weldGeometry.ts`,
`bays()` sets `h: params.ceiling`, so the exterior window box runs floor-to-ceiling while the
interior opening (`SILL_H` 2.5 → `HEAD_H` 9) does not, and the two have never agreed. Not fixed here
— fixing it means editing `weldGeometry.ts`, which is out of scope by §0. Flagged for whoever next
touches that file.

### 5.3 A3. The room gets trim

`src/scene/Suite.tsx`, `src/geo/trim.ts` (**new**).

The single loudest "this is a model, not a room" tell in the stage-5 capture is that plaster meets
oak at a bare 90° corner. Add, all derived from the room rectangles `Suite.tsx` already builds:

- **baseboard** — every room-facing wall run, `BASE_H` tall, `BASE_PROUD` proud, mitred at corners
  by simply overlapping (they are opaque boxes; a mitre is invisible and costs vertices)
- **door casing** — architrave round every door opening, matching the window casing
- **door leaf** — every interior door gets a panelled leaf, hung open against its jamb. Open,
  because `walk.ts` and `route.ts` both assume a doorway is passable and a closed leaf would be a
  lie the geometry tells about a route the code will still walk
- **picture rail** at `RAIL_H`, and a simple cornice at the ceiling. Both period-appropriate for
  1872 and both cheap: one box per wall run

All emitted as `Slab`s through the existing `mergeSlabs()` path, so they cost **2 additional draw
calls** (one oak-painted trim mesh, one plaster cornice) regardless of room count.

### 5.4 A4. Light and material

`src/scene/materials.ts`, `src/scene/Lighting.tsx`, `src/scene/Effects.tsx`.

Today: one hemisphere, one directional sun with PCF shadows, one bloom pass. No ambient occlusion,
no environment map, no bounce. The stage-5 capture shows a large soft featureless hotspot on the
right-hand wall and flat plaster everywhere else.

- **Environment map.** `materials.ts:399` already names this as the cheap next step and never took
  it. A small procedural room environment generated once (`PMREMGenerator` over a gradient scene,
  no asset file, consistent with this module's no-texture-files rule) gives glazing something to
  reflect and puts a specular response on oak. One texture, negligible cost.
- ~~**Ambient occlusion.**~~ Tried (N8AO in the existing `EffectComposer`) and dropped. It made a
  baseboard read as a baseboard and a drawer front read as recessed, but its per-frame cost under
  SwiftShader (headless Chromium's software renderer, which the whole e2e suite runs on) turned
  out severe enough to break tests that have nothing to do with rendering quality: a
  wall-clock-timed walk test came up short on distance because too few frames rendered in its
  window, and a perf test timed out outright. Gating it on a measured frame time is the fix
  `Perf.tsx`'s own header already warns against — the effect's own cost is what would make the
  measurement high. See `Effects.tsx`'s header for the full account.
- **Plaster gets structure.** Extend the `drawGrain()` canvas machinery in `materials.ts` — which
  already exists and is already headless-safe — with a low-amplitude plaster tooth. No new asset
  files; the module's existing rule holds. No brick — that is an exterior material, out of scope
  by §0.
- **Sun.** Keep `solar.ts` driving direction and colour, which is sourced and correct. Raise shadow
  map resolution and add a small normal bias for the new fine geometry.

---

## 6-7. Workstreams B and C — dropped

Weld's procedural exterior detail (belt courses, cornice, entrance, brick texture, and the seam
work to carry the palette crossing across them) and Google Photorealistic 3D Tiles are both struck
from this phase per §0. Both are `p10-imagery`'s scope. Nothing in `src/scene/weldGeometry.ts`,
`src/scene/WeldExterior.tsx`, `src/scene/Ground.tsx`, `src/scene/Campus.tsx`, or the tile
dependency/billing work is touched by this phase.

---

## 8. Workstream D — stage 4

`src/scene/stages.ts`, `src/scene/CameraRig.tsx`, `src/scene/orbit.ts`, `src/ui/Hud.tsx`.

### 8.1 D1. Why the angle is what it is

Not a framing choice. `stages.ts:346-353` puts the camera on bedroom B's centreline, square off the
north gable, at `ridge/2`, with the stand-off derived from `GABLE_FOV`. It is square because
`thresholdPath()` pins a waypoint at the gable's interior face and the camera must cross the masonry
**perpendicular**, on exactly the frame the brick reaches zero opacity (`SHELL_GONE = 0.7`). The
perpendicularity is not decoration: it is what makes the flight through the wall land where the walk
begins, instead of entering at whatever angle a line from 124 ft out happens to make.

So the angle cannot simply be changed. It can be *made the viewer's*, provided the funnel restores
it before the crossing.

### 8.2 D2. Orbit at stage 4

`CameraRig.tsx:195` opens `if (stage !== 3) return;`, which gates all pointer, drag and wheel
handling. Generalise to `stage === 3 || stage === 4`, reading the clamp per stage.

New `STAGE4_CLAMP` in `orbit.ts`, derived exactly as `STAGE3_CLAMP` is and for the same reasons:

- `minRadius = MASS_RADIUS` — the same "camera is outside the massing at every azimuth" guarantee.
- `maxRadius` — stage 4's own stand-off `gableBack` (~123.6 ft) × 2, so the viewer can pull back to
  see the building but not out to where stage 3 lives.
- `minPolarDeg` / `maxPolarDeg` — 15 / 88, unchanged, same argument.

Orbit is about `kf[4].target`, which is `insideBedB`. `keepOutsideMassing()` applies during the
funnel as it does at stage 3.

### 8.3 D3. The funnel

```
funnel(t) = smoothstep(FUNNEL_START, SHELL_GONE, t)     FUNNEL_START = 0.15
pose(t)   = blend(orbitKeyframe(kf[4], orbit), alongPath(kf[4].path, t), funnel(t))
```

Three properties, each of which is a test:

1. **`funnel(t) = 1` for all `t >= SHELL_GONE`.** At and after the crossing the pose is exactly the
   path's, so the camera is perpendicular at the gable and every existing guarantee downstream —
   the routed walk, the 1 ft standoff, the near plane — is untouched. **The crossing itself is
   bit-identical to today's.**
2. **`funnel(t) = 0` for `t <= FUNNEL_START`.** Drag is fully authoritative at the top of the
   stage, so the control feels direct rather than rubber-banded.
3. **`orbit === null` reproduces today's stage 4 exactly**, because `orbitKeyframe(kf[4],
   orbitOf(kf[4]))` is `kf[4]`. A viewer who never drags sees precisely the current sequence.
   This is what lets every existing stage-4 test keep passing unchanged.

Reduced motion is unchanged: the jump cut at `REDUCED_CUT` still returns the path's own endpoints,
never an interpolated pose. Drag remains available at `t = 0` because orbiting is not animation.

`orbit` is one store field shared by stages 3 and 4 and is **already in the URL snapshot**
(`store.ts:321`), so a shared link carries a stage-4 angle with no wire-format change.

### 8.4 D4. The HUD sits in the shot

Visible in every capture: the control panel occupies the centre-bottom of the frame, and at stage 4
`t = 0` it covers the base of the gable — the subject of the shot. Move the stage-4 and stage-3
controls out of the optical centre, matching the `hud-room` treatment stage 5 already uses. Small,
and the most immediately visible improvement in the phase.

---

## 9. Test plan

**Unit (vitest, Node, no renderer).**

| file | asserts |
|---|---|
| `tests/pieces.test.ts` *(new)* | every part of every kind lies inside `SIZES[kind]`; parts sum to a plausible volume fraction; no zero/negative extent; every kind has ≥1 part |
| `tests/furniture-transform.test.ts` *(new)* | **the double-rotation trap.** For all 4 yaws × 6 param sets, the world AABB of a piece's assembled parts equals `pieceBox()`'s footprint to 1e-9. This is the test that catches the §5.1 error |
| `tests/sash.test.ts` *(new)* | sash parts tile the (unchanged) opening without overlap; glass area = opening minus frame; parts inside the opening rect; wider openings split into more lights, `walls.ts`'s opening rectangle itself untouched |
| `tests/trim.test.ts` *(new)* | baseboard runs cover every room-facing wall; no trim inside a doorway |
| `tests/orbit.test.ts` *(edit)* | `STAGE4_CLAMP` idempotent; `minRadius` keeps the camera outside `MASS_RADIUS` at every azimuth/polar |
| `tests/stages.test.ts` *(edit)* | `funnel(t >= SHELL_GONE) === 1`; `funnel(t <= FUNNEL_START) === 0`; **with `orbit === null`, every stage-4 pose is bit-identical to today's** — a regression fence round the whole rework |
| `tests/materials.test.ts` *(edit)* | new materials headless-safe; hexes still cross-check `MASTER.md` |

**e2e (Playwright).**

- `journey.spec.ts` — existing per-stage render gates still pass; stage 5 gains a `distinct`-colour
  floor reflecting the added interior geometry.
- `threshold.spec.ts` — the crossing is unchanged; **no empty frame** across a sweep of 12 drag
  poses × 20 `t` values. This is the P7 defect (`stages.ts:371-387`) generalised to the new freedom,
  and it is the most important new gate in the phase.
- `stage4-orbit.spec.ts` *(new)* — dragging changes azimuth; a dragged pose still arrives
  perpendicular; a shared URL restores the angle.
- `perf.spec.ts` — new measured ceilings, raised deliberately with numbers in the commit.
- `contrast.spec.ts`, `a11y.spec.ts` — unchanged and must stay passing.

**Visual.** Regenerate `design/renders/` for all six stages plus the new interior details, and
attach before/after to the final commit.

---

## 10. Budgets, raised with measurement

Every current budget is exceeded by this work. Each is re-measured off `window.__perf` on real
hardware — not headless SwiftShader, which `FlyDown.tsx:44-56` records as 25× slower — and each
ceiling is moved in the same commit as the change that moves it, with the number in the message.

| budget | today | expected | where |
|---|---|---|---|
| suite draw calls | 25 (already 38 measured) | ~46 | `IMPLEMENTATION-PLAN.md` §9 |
| edit-stage draw calls | 40 | 50 | `edit.spec.ts` |
| interior triangles | 1,469 | ~9,000 | `stages.ts` header |

Shell/frame/tile rows are dropped with workstreams B and C — `p10-imagery` owns those budgets now.

A budget raised without a measurement beside it is a budget deleted. Each row above gets its
measured replacement written into the comment it lives in.

---

## 11. Build order

Each step is independently committable and independently verifiable. Workstreams A and D touch
disjoint files entirely.

| # | step | verify |
|---|---|---|
| **H1** | `walls.ts` literal NUL bytes → `" "` | `file src/geo/walls.ts` reports text; `grep -r` finds the file; tests unchanged |
| **H2** | Correct `Suite.tsx:56-65`'s stale header — the window bug it describes is fixed | read-only |
| **A1a** | `src/geo/pieces.ts` + `tests/pieces.test.ts` | unit green, no scene change |
| **A1b** | `Furniture.tsx` consumes it; rigid instance transforms | `furniture-transform.test.ts`; screenshot; `__perf` |
| **A2** | `src/geo/sash.ts`; `Suite.tsx` consumes it; opening rectangle in `walls.ts` untouched | `sash.test.ts`; stage 5 screenshot |
| **A3** | `src/geo/trim.ts`; `Suite.tsx` consumes it | `trim.test.ts`; stage 5 screenshot |
| **A4** | env map, plaster normal, hardware material (GTAO tried, dropped -- see §5.4) | `materials.test.ts`; screenshots; frame-time measurement |
| **D1** | `STAGE4_CLAMP` in `orbit.ts` | `orbit.test.ts` |
| **D2** | funnel in `stages.ts` | `stages.test.ts`, incl. the bit-identical fence |
| **D3** | `CameraRig.tsx` stage-4 listeners | `stage4-orbit.spec.ts`; manual drag |
| **D4** | HUD out of the optical centre | screenshots at every stage |
| **Z** | regenerate renders; re-measure and rewrite every budget comment | full unit + e2e; visual diff |

Steps H1–H2 are trivial and go first so the tree is clean for grep. A and D are independent
after that.

## 12. Risk and rollback

| risk | mitigation |
|---|---|
| **Double-rotation in A1b** silently mis-orients furniture | `furniture-transform.test.ts` compares assembled AABB to `pieceBox()` across all yaws — the failure is caught arithmetically, not visually |
| **Perf collapse** from added interior geometry + AO | each step measured on real hardware; AO independently switchable; budgets raised with numbers |
| **e2e times out** — the suite already needs 300 s for SwiftShader contention | geometry cost measured at A1b before more is added |
| **Stage-4 drag reaches an empty frame** — the recorded P7 defect | funnel guarantees the pose is the path's from `SHELL_GONE` on; 12 × 20 sweep gate |
| **A concurrent session edits the same files** | all work in the `p10-fidelity` worktree; `git status` on both trees before every commit; nothing pushed to `main` without approval; this phase never opens `weldGeometry.ts`, `WeldExterior.tsx`, `Ground.tsx`, or `Campus.tsx` — `p10-imagery`'s files, checked at the top of every step |

Rollback is per-step: every step is one commit on `p10-fidelity`, and the phase is a single merge
that can be dropped whole.

## 13. What this phase does not fix

Recorded so it is not mistaken for done.

- The interior remains a *model* of Weld 15, not a survey of it. Every dimension marked ASSUMED in
  `docs/DIMENSION-AUDIT.md` stays assumed; this phase adds detail, not evidence.
- The exterior does not move in this phase at all — see §0. Whatever `p10-imagery` lands (or
  doesn't) is what stages 0-4 show from outside.
