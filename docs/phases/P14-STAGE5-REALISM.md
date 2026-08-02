# P14 — Stage 5 stops feeling like a model

Four complaints, one phase, all about the first-person walkthrough specifically:

1. The bathroom is an empty tiled box.
2. Every window is a flat, dead-looking panel — nothing behind it, whatever the stage.
3. The walls and interior read as boxy and synthetic.
4. The suite's own front door opens straight onto nothing; there is no real entrance.

---

## 0. Decisions taken before any code was written

Ambiguous enough to be worth grilling explicitly, and settled before row 1:

- **Entrance routing.** Full re-route of the stage 4 approach through a real door, rather than a
  cosmetic door mesh bolted onto the existing crossing point. Chosen path: the west front loggia
  (Weld's own 1875-documented main entrance — "two wide arches opening on a large porch or loggia,
  twenty-one feet by twenty-five feet, paved with marble tiles," §0 of `DIMENSION-AUDIT.md`) rather
  than inventing a door in the north gable the camera used to fly through.
- **What a window shows.** Real Google Photorealistic 3D Tiles when a key is configured, a cheap
  keyless backdrop (`FallbackGround`) otherwise — both reusing the exact world the descent already
  builds, not a new asset.
- **Bathroom era.** Present-day dorm fixtures (a tub/shower, a WC, a lavatory, a radiator, a towel
  rail), not a period reconstruction — the 1875 text gives no plumbing fixture at all, so there is
  nothing to reconstruct.
- **Realism budget.** Best judgement, no numeric target handed down — resolved as baked per-vertex
  ambient occlusion (row 10) rather than a screen-space technique, since P10 had already tried and
  measured N8AO off the table for this project's headless test environment (`Effects.tsx`'s own
  header).
- **Scope of the building beyond the suite's own door.** The full loggia, the north stair hall, one
  flight of stairs, and the spine corridor connecting them to the suite's own entry — not just a
  door-shaped hole.
- **Can the walker leave the suite?** No — the suite stays sealed. The common-parts geometry exists
  so the door reads as a real doorway, not so the model can be explored beyond it.
- **Workflow.** Implemented in an isolated git worktree (`weld15-p14`, branch `p14-interior`), so a
  concurrent session's own uncommitted work in the main checkout was never at risk.

---

## 1. The twelve rows

| Row | What | Where |
|---|---|---|
| 1 | Window casing no longer covers the opening it frames | `src/geo/sash.ts` |
| 2 | Door casing, a hung-open leaf with real hinge geometry, threshold strips | `src/geo/trim.ts`, `src/scene/Suite.tsx` |
| 3 | The suite's own entry hangs nearly shut rather than standing wide open | `src/scene/Suite.tsx` |
| 4 | Bathroom gets a tile floor and a porcelain wainscot | `src/scene/Suite.tsx` |
| 5 | The building's own loggia, stair hall, stair and spine corridor, modelled from the 1875 text | `src/geo/common.ts` (new) |
| 6 | That geometry drawn, mounted at stage 5 beyond the suite's own door | `src/scene/CommonParts.tsx` (new) |
| 7 | Stage 4's approach re-routed through the loggia instead of the north gable | `src/scene/stages.ts` |
| 8 | Windows show the real world (keyed) or a keyless backdrop, through stage 5 | `src/scene/Outlook.tsx` (new), `src/scene/tilesCarve.ts` |
| 9 | The bathroom populated: tub, WC, lavatory, mirror, radiator, towel rail | `src/geo/fixtures.ts` (new), `src/scene/walk.ts` |
| 10 | Baked per-vertex ambient occlusion, every box in the suite | `src/scene/Suite.tsx` |
| 11 | Window fill scaled by actual glazing, ceiling fixtures, radiators in every occupied room | `src/scene/Lighting.tsx`, `src/geo/fixtures.ts` |
| 12 | This document; final draw-call/triangle re-measurement | `docs/DIMENSION-AUDIT.md` §9, `tests/e2e/perf.spec.ts`, `tests/e2e/edit.spec.ts` |

Two real bugs were caught by unit tests written alongside their own rows rather than found later by
inspection, both worth naming because neither was obvious in advance:

- **Row 7.** The stage 4 arch-crossing point was pinned to the loggia's *inner* wall (shared with
  the stair hall) instead of its outer, front wall — the camera crossed into the building and then
  had to fly back out into the loggia to visit its own centre. Caught by a geometric monotonicity
  check, not by eye.
- **Row 10.** `BoxGeometry`'s 24 vertices sit only at face corners, so a naive per-vertex
  distance-to-edge computation was zero at every single vertex — the "gradient" was a flat, uniform
  darkening with no shape to it at all. Fixed by giving qualifying axes a few interior segments,
  and by excluding a box's own thinnest axis from the occlusion test (a floor slab's thinness is its
  own nature, not a sign of being in a crevice).

## 2. What was deliberately not done

- **`tilesCarve.ts`'s `HEIGHT_MIN` fix is unverified against a real key.** This worktree has no
  `NEXT_PUBLIC_GOOGLE_MAPS_KEY` (no `.env.local`), so the keyed path through `Outlook.tsx`/`Tiles.tsx`
  has never actually rendered here. The fix is verified against `tilesCarve.ts`'s own pure-JS
  `carveFactor()` twin, which is exact but not the same as watching real photogrammetry render.
- **The mirror is not truly reflective.** It reads `scene.environment`'s single procedural room map
  (the same source glazing already reflects), which gives a soft, generic highlight rather than an
  actual reflection of the room it hangs in.
- **`route()`'s generic `standIn()` does not know the bathroom has fixtures in it.** That function
  has no production caller left since row 7 replaced its one call site in `stages.ts`; teaching a
  general-purpose room router about one room's own furniture layout was judged not worth doing for
  code nothing renders through any more. `tests/route.test.ts` documents the gap directly rather
  than working around it.
- **The "unknown" room stays exactly as undefined as it always was** — no ceiling fixture (row 11
  explicitly excludes it), no furniture, no fixtures. It is the one space this project has
  deliberately kept its own stated ignorance about (`rooms.ts`'s own header), and P14 did not invent
  a use for it.

## 3. Measured cost

Stage 5, keyless, 1280×720, settled `__perf`, this build:

| | Before P14 | After P14 |
|---|---|---|
| Draw calls, idle | 46 | 57 |
| Draw calls, ceiling (gesture + headroom) | 50 | 62 |
| Triangles | 10,061 | 60,315 |

The triangle rise is almost entirely row 10's baked AO (interior segments on every qualifying box)
and row 9's fixture geometry; draw calls rose only at row 8 (`Outlook.tsx` mounts three more meshes
through stage 5) and stayed flat through rows 9-11, since every later row's new geometry reuses an
existing merged mesh rather than opening one of its own. Both figures sit well inside
`tests/e2e/perf.spec.ts`'s 80,000-triangle ceiling and `tests/e2e/edit.spec.ts`/`walk.spec.ts`'s
62-call ceiling for the stage.

## 4. Testing

Full `npm test` (1108 tests) and the full Playwright suite (72 run, 3 skipped — all three requiring
a real `NEXT_PUBLIC_GOOGLE_MAPS_KEY` this worktree does not have) are green as of row 12. Every row
landed with its own unit tests before being folded into the next; `tests/fixtures.test.ts`,
`tests/suite-transform.test.ts`'s baked-AO block, and `tests/lighting.test.ts`'s `glazingCounts()`
block are new files/blocks this phase added, not retrofitted afterward.
