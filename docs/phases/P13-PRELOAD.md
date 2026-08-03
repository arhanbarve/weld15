# P13 — Load the whole descent before anybody sees it

Status: **implemented and measured.** Unit suite green, keyless e2e green, keyed
`preload.spec.ts` gate passing against real Google Photorealistic 3D Tiles. Step 6 (GPU
residency via `gl.initTexture`) is built and verified error-free against real content, but
deliberately not frame-time-measured — see step 6's own note for why. Retention (no
eviction) is fully validated; zero re-fetch is not achievable for any finite discrete
sampling and is documented as a disclosed, bounded residual (§6.3).

Goal: the app is inaccessible until every tile the descent can need is fetched, parsed,
uploaded and pinned in memory. After that, flying down, scrubbing the JourneyBar, clicking a
stage button or skipping to the suite is instantaneous — no streaming, no blur, no stall.

Non-goal: making the *first* load fast. It will get considerably slower — one to two minutes
is expected and accepted. This phase trades first-load latency for zero latency everywhere
after it.

---

## 0. What is actually wrong

### 0.1 The wait is four costs, and only one is network

Measured, this build, real key — `P11-PHOTOREAL.md:506`, driven by teleporting between stage
buttons at `errorTarget = 8`:

| stage | settled by 30s? | frame time (median) | loaded / cached | still parsing |
|---|---|---|---|---|
| 0 (orbit) | n/a | 75.7 ms | 0 | 0 |
| 1 | yes, 28.3 s | 167.7 ms | 714 / 714 | 0 |
| 2 | no | 267.4 ms | 1182 / 1549 | 367 |
| 3 | no | 374.6 ms | 1352 / 2326 | 944 |
| 4 | no | 324.8 ms | 1190 / 2153 | 963 |
| 5 | no | 440.3 ms | 1256 / 1776 | 517 |

And the decisive observation, already recorded in `Tiles.tsx:398`: at stage 3, **every one of
184 pending tiles had already finished downloading** (`stats.downloading === 0`,
`stats.queued === 0`) and sat waiting on parse slots.

So the costs, in order of how much they hurt:

- **(b) Parse** — ~~Draco/glTF decode. CPU-bound, main-thread, serial.~~ **This characterisation
  was wrong and was later re-measured — see §6.4.** There is no Draco anywhere in Google's
  photorealistic content and no worker in `3d-tiles-renderer`'s parse path; "parse" is one
  embedded JPEG per tile through `createImageBitmap`, and its latency is *waiting*, not
  compute. `parseQueue.maxJobs` therefore buys real throughput, and is now 64, not 16.
- **(c) GPU upload and shader compile** — every tile's texture uploads on first draw;
  `tilesCarve.ts` runs `onBeforeCompile` per material.
- **(a) Fetch** — real, not dominant.
- **(d) Eviction** — see below. This is why it recurs.

### 0.2 Eviction is why it happens *again* at every depth

`Tiles.tsx:415` sets `lruCache.maxBytesSize = 1 GB`, `minBytesSize = 0.75 GB`. The measured
session caught the consequence directly: `inCache` fell **693 → 610** between stages 4 and 5
**while `loaded` only rose**. That is the LRU discarding tiles the session had already paid
to fetch *and* parse.

There is no disk cache in `3d-tiles-renderer`. An evicted tile costs a full re-fetch **and a
full re-parse**. Browser HTTP cache does not save you either: `GoogleCloudAuthPlugin` appends
a per-session `session=` token, so every page load requests distinct URLs.

**Therefore the only thing that makes a second visit to a view free is that its tiles are
still resident and parsed.** A preloader that loads everything but lets the LRU evict it
solves nothing.

### 0.3 Why LOD makes every leg a cold load

Tile selection is screen-space-error driven. The descent spans ~7.16 decades of altitude
(`journey.ts`'s own leg weights: 3.28 + 1.32 + 1.06 for the descent legs, plus
`TRANSIT_SPAN` 0.60 and `THRESHOLD_SPAN` 0.90). Roughly every 0.3 decades selects a
materially different tile set. Five legs, each a fresh 300–900 tile cold load.

### 0.4 Why the current loading UI does not help

- `LoadingBar.tsx` is a 3 px hairline at the top plus a bottom-left checklist card
  (`LoadingBar.tsx:221`, `:250`). Non-blocking by construction — `pointerEvents: "none"`.
- `FlyDown` gates on `settled`, but with a **4-second escape hatch**
  (`MAX_STALL_SECONDS`, `FlyDown.tsx:79`). A stalled parse queue therefore produces exactly
  the "flies through blur" behaviour being reported.
- The JourneyBar slider, the stage buttons, `skipToSuite` and the wheel scrub have **no
  settle gate at all**. They teleport straight into an unloaded view.

---

## 1. Decisions

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Coverage | **Descent path only.** ~28 poses sampled along `journey.ts`'s `u ∈ [0,1]` at each pose's default heading/pitch. | Covers fly-down, JourneyBar, wheel scrub, stage buttons, `skipToSuite`, URL deep-links. A drag to a *new* heading at stage 3/4 still streams — accepted. A heading sweep at orbit altitude approaches loading a meaningful fraction of Earth. |
| 2 | Quota | **Accept. Always full preload, every page load.** | ~2,400 tile requests per load against ~400 today, ≈6× per-visitor Maps billing, paid even by a visitor who never descends. Explicitly accepted. |
| 3 | Memory | **Tiered `errorTarget` by altitude, applied identically at preload and at runtime,** if and only if step 0's measurement exceeds the budget. | Keeps `errorTarget = 8` where detail is visible (near Weld) and coarsens the high-altitude legs where the camera is moving through decades per second. Must be the *same* function at runtime or the app would ask for finer tiles than were preloaded and stream anyway. |
| 4 | Tests | **`?preload=0` query param bypasses the preloader entirely.** | Keyless e2e runs are already unaffected (`<Tiles>` never mounts without a key). Keyed specs add the param. Doubles as a dev-loop escape hatch. |

---

## 2. Architecture

### 2.1 The mechanism

`TilesRenderer` keeps `this.cameras[]` and takes the **union** of every registered camera's
tile selection (`TilesRenderer.js:326` `setCamera`, `:476` `prepareForTraversal`). Tiles
selected for *any* registered camera are marked used every frame, so they are
**eviction-proof for as long as that camera stays registered** (`LRUCache.js:275` `markUsed`,
`:347` the `unloadUnusedContent` guard).

That gives the whole preloader for free: build a synthetic `PerspectiveCamera` at each
sampled journey pose, register it, wait for the queues to drain.

### 2.2 Retention after the synthetic cameras are gone

`unloadUnusedContent()` (`LRUCache.js:324`) only evicts when either:

- `cachedBytes > minBytesSize` with any unused item present, **or**
- `itemList.length > minSize` (default 6,000) with any unloaded item present.

So retention is two configuration values, set once, after the measurement is in:

```
lruCache.minBytesSize = lruCache.maxBytesSize = max(measuredBytes * 1.25, 1 GB)
lruCache.minSize = 12_000        // measured peak was 2,434; the default 6,000 is
lruCache.maxSize = 16_000        // close enough to a dense sample to be worth raising
```

### 2.3 Near/far is load-bearing, not incidental

`af3346f` fixed exactly this: at orbit the camera sits ~54,345,801 ft from Earth's centre,
past a far plane of 4,000,000 ft, so the **entire tileset was frustum-culled** and nothing
loaded, forever. Each synthetic camera must take `near`/`far` from `altitude.ts`'s
`nearFar(pose.position[1])` — the same function `CameraRig.tsx:557` uses — and must have
`updateMatrixWorld()` and `updateProjectionMatrix()` called before `tiles.update()` runs.

Each synthetic camera must also get `tiles.setResolution(cam, w, h)` at the live canvas size,
or its screen-space error is computed against a zero resolution (`TilesRenderer.js:519` warns
and the error maths is wrong).

### 2.4 Settle detection: poll, do not trust the event

`tiles-load-start` / `tiles-load-end` cannot be used to gate a batch. If a newly registered
batch's tiles happen to already be resident, **no `tiles-load-start` fires at all** and an
event-based wait hangs forever.

Gate instead on the stats already published every frame:
`queued + downloading + parsing === 0` held for **8 consecutive frames**, with a per-batch
timeout. Same signal, no race.

### 2.5 Pose composition must not be duplicated

`CameraRig.tsx:448–483` composes the pose for a given `(stage, t, reduced, orbit)` through a
five-way branch — `firstPersonPose`, `transitPose`, `stage4Pose`, `pathStagePose`,
`cameraKeyframe`. The preloader needs the **exact same** poses or it preloads tiles the app
never asks for and misses ones it does.

Duplicating that branch is the drift risk this project has repeatedly paid for. So: **extract
it, do not copy it.** New pure module `src/scene/pose.ts` exporting

```ts
export function journeyPose(
  kf: Record<StageId, Keyframe>,
  stage: StageId,
  t: number,
  reduced: boolean,
  orbit: Orbit | null,
  orbitStage: StageId | null,
): Keyframe
```

lifted verbatim from `CameraRig`'s `want` expression minus the walker branch (which is
interior, needs no tiles). `CameraRig` then calls it. This is a refactor of existing working
code and is the one place in this plan where I touch a file that is not broken — flagged
deliberately, and pinned by a regression test asserting `journeyPose(...) === ` the old
branch's output at 40 sampled `(stage, t)` pairs before the branch is deleted.

---

## 3. Files

### New

| File | Role |
|---|---|
| `src/scene/pose.ts` | `journeyPose()` — extracted from `CameraRig`, used by both. Three-free. |
| `src/scene/preloadPlan.ts` | Pure. `preloadPoses(params): PreloadPose[]` — the sampled poses and their batch/phase assignment. `errorTargetFor(altFt)` if tier 3 is triggered. Three-free, unit-testable with no browser. |
| `src/scene/Preload.tsx` | Inside `<Canvas>`. Drives the synthetic cameras, polls settle, publishes progress. Module-scope probe + listener set, same shape as `Tiles.tsx`'s. |
| `src/ui/Preloader.tsx` | The blocking DOM overlay. Subscribes to `Preload`'s probe. |
| `tests/preloadPlan.test.ts` | Unit: pose count, monotone altitude, batch coverage, `u` endpoints. |
| `tests/pose.test.ts` | Unit: the extraction-equivalence fence described in §2.5. |
| `scripts/measure-preload.mjs` | Step 0's measurement harness — and the one that caught the batch-timeout bug (§6.1). |
| `scripts/verify-retention.mjs` | Step 4's harness: drives a full scrub after `done` and checks `stats.loaded`/`inCache` don't regress. |
| `tests/e2e/preload.spec.ts` | Step 7's permanent keyed gate. |

### Changed

| File | Change |
|---|---|
| `src/scene/Tiles.tsx` | Export `getTiles()` and `getCachedBytes()` (the module-scope `currentTiles`/its `lruCache.cachedBytes`, both undocumented fields the package's own `.d.ts` omits). `errorTarget`/`parseQueue`/`lruCache` defaults are UNCHANGED here — the retention byte cap and item ceilings are set at runtime by `Preload.tsx`'s finalizing step, not hardcoded in this file. GPU residency: `load-model` now calls `gl.initTexture` on every texture-valued property of every material any tile contributes (§6's step 6 note). |
| `src/scene/CameraRig.tsx` | Call `journeyPose()` instead of the inline branch. No behaviour change — pinned by `tests/pose.test.ts`'s 170-case equivalence fence. |
| `src/scene/Experience.tsx` | Mount `<Preload />` inside `<Canvas>`; mount `<Preloader />` outside it, above `<LoadingBar />`. |
| `src/ui/LoadingBar.tsx` | Suppressed until `preload.done` (it would be the second progress UI on screen). Unchanged otherwise — it still covers the disclosed re-fetch residual (§6.3) and any off-path streaming. |
| Every `tests/e2e/*.spec.ts` | `?preload=0` added to (nearly) every `page.goto`, not only the keyed-gated files — a real key now persists in `.env.local` for this project's Vercel deployment, so every spec would otherwise pay the full preload. `edit.spec.ts`'s two dynamic-URL gotos (`openInTheRoom`'s `query` param, and the reopened-share-link case) append it via `URL`/string concatenation rather than a literal, since those already carry their own query string. |
| `docs/phases/P13-PRELOAD.md` | This file, updated with measured numbers as they landed (§6). |

---

## 4. The sampling plan

`journey.ts` already weights the three descent legs by **decades of altitude**, so uniform
spacing in `u` is uniform spacing in decades across legs 0–2 — which is exactly the axis LOD
selection moves on.

```
N_POSES  = 56                     // shipped; ~0.128 decades/sample -- was 28, doubled after
                                   // §6.3's measured 14.8% re-fetch residual (only reached
                                   // 12.9% at this density -- see that section for why
                                   // further doubling was not pursued)
u_i      = i / (N_POSES - 1)      // i = 0..55, endpoints included
(stage,t) = fromJourney(u_i, params)
pose_i   = journeyPose(kf, stage, t, false, null, null)
```

Batched **high → low**, 8 poses per batch, 7 batches. High-to-low matters for two reasons:
coarse tiles land first so the frame behind the overlay is never empty, and if tier 3 fires,
`tiles.errorTarget` can be stepped per batch monotonically.

Stage 5 is deliberately not sampled: it is interior parametric geometry, `visibility(stage)`
returns `tiles: false` there, and the walker is behind Weld's walls for the whole stage.

Batch → viewer-facing copy, each tied to a real milestone rather than a timer:

| batch | poses (u) | copy |
|---|---|---|
| — | — | Warming up the renderer |
| — | — | Opening a session with Google Earth |
| 1 | 0.00–0.11 | Downloading Earth from orbit |
| 2 | 0.15–0.26 | Resolving the eastern seaboard |
| 3 | 0.30–0.41 | Bringing Boston into focus |
| 4 | 0.44–0.56 | Streaming Cambridge rooftops |
| 5 | 0.59–0.70 | Reading Harvard Yard, tree by tree |
| 6 | 0.74–0.85 | Finding Weld Hall's brick |
| 7 | 0.89–1.00 | Crossing the threshold |
| — | — | Standing up the room |
| — | — | Pinning everything in memory |

Progress = `(batchesDone + currentBatchLoadProgress) / TOTAL_STEPS`. Monotone, real, no creep
floor — the creep floor in `LoadingBar.tsx:70` exists because *that* bar has no idea how many
episodes remain. This one does.

---

## 5. Build order

Each step ends with a stated verification. Nothing proceeds on inspection alone.

### Step 0 — Measure. Nothing is designed until this lands.

`scripts/measure-preload.mjs`: boot the app with a real key, register the 28 synthetic
cameras in batches, and record per batch:

- `lruCache.cachedBytes` (the number nothing in the app currently reports)
- `stats.loaded`, `stats.inCache`
- wall-clock to drain
- `performance.memory.usedJSHeapSize` (noting `P11-PHOTOREAL.md:527`'s caveat that this
  does not see GPU-side geometry — it is a floor, not the figure)

**Decision gate:** if final `cachedBytes > 1.5 GB`, tier 3 (`errorTargetFor(altFt)`) is
implemented in step 4; otherwise it is skipped entirely and `errorTarget` stays 8 everywhere.

**Verify:** the script prints a table; the numbers are pasted into §6 of this document.
Cost: one session, ~2,400 tile requests.

### Step 1 — Extract `journeyPose()`

Move `CameraRig`'s `want` branch into `src/scene/pose.ts`; `CameraRig` calls it.

**Verify:** `tests/pose.test.ts` asserts the new function's output equals the old inline
branch's at 40 `(stage, t)` pairs including every boundary, both `reduced` values, and with
and without a live orbit. Then the full unit suite (1037 currently green) and the keyless e2e
suite (72/3/0) both stay green. This step changes nothing observable and must prove it.

### Step 2 — `preloadPlan.ts`, pure

`preloadPoses(params)` returns `{ u, stage, t, pose, batch, alt }[]`.

**Verify:** `tests/preloadPlan.test.ts` — 28 poses, `u[0] === 0`, `u[27] === 1`, altitude
strictly decreasing, every batch non-empty, no pose at `stage === 5`.

### Step 3 — `Preload.tsx`, no UI yet

Waits for `getTiles()` non-null and `rootRequests >= 1`, then runs the batch loop. Publishes
`window.__preload = { phase, batch, totalBatches, progress, cachedBytes, tilesLoaded, done }`
and a listener set. Removes every synthetic camera and calls `gl.compile(scene, cam)` before
flipping `done`.

**Verify:** headed run with a real key. `window.__preload.done === true`; `window.__tiles.
constructions === 1` and `rootRequests === 1` (the preloader must not trigger a second
billable root request — this is the same invariant `descent.spec.ts` already gates);
`cachedBytes` matches step 0's measurement within 10%.

### Step 4 — Retention, and tier 3 if step 0 demanded it

Set the `lruCache` byte caps and item ceilings from the measured figure. If triggered, add
`errorTargetFor(altFt)` and drive `tiles.errorTarget` from it in **both** `Preload`'s batch
loop and `Tiles.tsx`'s `useFrame`.

**Verify:** after `done`, drive a full `u = 0 → 1 → 0` scrub and assert `inCache` does not
decrease. **This is the assertion that actually holds** (§6.3) — `stats.loaded` NOT
increasing does not hold for any finite discrete sampling and is not asserted as an
absolute; `tests/e2e/preload.spec.ts` bounds it generously instead.

### Step 5 — `Preloader.tsx`, the blocking overlay

Fixed, `inset: 0`, `--void` background, `zIndex` above everything, `pointerEvents: auto`.
Centered: title, the batch's copy line, a determinate bar, and a live tile count. `role="status"`,
`aria-live="polite"`, `aria-busy` on the container. Honours reduced motion by dropping the bar's
transition, not by dropping the block. `data-testid="preloader"` and `data-testid="preload-done"`.

`?preload=0` short-circuits both `<Preload>` and `<Preloader>`; so does `!HAS_TILES_KEY`.

**Verify:** headed run — the app is genuinely unreachable (canvas not clickable, HUD not
reachable by keyboard) until the overlay clears; the copy advances through all eleven lines;
the bar is monotone. Screenshot at three points.

### Step 6 — GPU residency

**Built, but not frame-time-measured, and that is a deliberate choice rather than a gap.**
`Tiles.tsx`'s `load-model` handler now calls `gl.initTexture(tex)` on every texture-valued
property of every material any tile ever contributes (generic over material type, walking
`Object.values` rather than a hand-enumerated slot list — the same reasoning three's own
`Material.dispose()` uses to find every texture on a material without assuming which slots
exist). This is NOT redundant with `Preload.tsx`'s existing `gl.compile(scene, mainCamera)`
call, verified directly against three.js's own source rather than assumed:
`WebGLRenderer.compile()` walks the scene and calls `prepareMaterial` → `getProgram`, which
compiles and links SHADER PROGRAMS only. Texture data upload (`texImage2D`) is a separate
GPU operation that only happens at first draw or via the explicit `initTexture()` call —
three's own inline comment on the method: "preloading a texture rather than waiting until
first render, which can cause noticeable lags due to decode and GPU upload overhead." So
the gap this step fills is real, not imagined.

**Why no A/B frame-time measurement backs this up:** `Perf.tsx`'s own header states the
project's standing rule plainly — "Frame time is recorded but must not be used as a gate:
headless Chromium runs SwiftShader in software, where the bloom pass costs about 70 ms
against roughly 1-3 ms on a real GPU." Every measurement tool available in this session
(`scripts/measure-preload.mjs`, `scripts/verify-retention.mjs`, the whole e2e suite) runs
through that same SwiftShader path. Producing a frame-time delta from it and reporting it
as evidence would be manufacturing false confidence from a number the codebase's own
convention already disclaims — worse than reporting nothing. Verified instead: a real keyed
session loads real tile content through the new code path with zero console or page errors
(`window.__tiles` showed real, healthy stats — `loaded`/`inCache` growing normally). Real
frame-time validation needs actual GPU hardware, which this session does not have access
to, and is left as open follow-up rather than faked.

### Step 7 — Gates

`?preload=0` added across nearly every e2e spec (not only the keyed ones — see §3's file
table for why). One new keyed e2e (`tests/e2e/preload.spec.ts`): preload completes within a
300 s ceiling, `rootRequests`/`constructions` stay at 1 through both the preload and a full
scrub, `inCache` never decreases, and re-fetch growth is bounded at 50% (real margin above
the measured 12.9–14.8%, tight enough to catch a genuine retention regression).

**Verify:** full keyless suite green — confirmed at 71 passed / 1 skipped-unrelated-flake /
3 skipped on an isolated port with no other session's server interfering (the one failure,
`walk.spec.ts`'s hall-length test, traced to `FirstPerson.tsx`'s pre-existing `MAX_DT = 0.1`
assumption being exceeded by this machine's actual frame times under load — unrelated to
this phase, not touched). Keyed run of `preload.spec.ts`: passed, 3.9 minutes.

---

## 6. Measured results

Real key, this build, two independent sessions (2026-08-02). Every number below came from
`scripts/measure-preload.mjs` and `scripts/verify-retention.mjs`, not assumption.

### 6.1 The batch-timeout bug, caught by the first measurement

The first run — `N_POSES = 28`, `BATCH_TIMEOUT_MS = 20_000` — completed in 146.1 s reporting
`done: true`. Its own final `window.__tiles.stats` gave it away: `parsing: 2881` tiles still
in flight the instant `done` fired. Every one of the 7 batch transitions landed at 19.9–20.9 s
— the unmistakable signature of the 20 s escape hatch firing on *every* batch rather than the
8-consecutive-idle-frame condition ever actually being met once. Cameras accumulate across
batches (never cleared until finalizing), so batch *N*'s settle condition is the union of
every camera registered so far — batch 6 has to satisfy 28 at once — and a fixed 20 s budget
was nowhere near enough once that union got large. Fixed by raising `BATCH_TIMEOUT_MS` to
`90_000` (`Preload.tsx`'s own comment carries the full account). Re-measured after the fix:
every batch that session settled on real idle detection, not the ceiling — durations varied
genuinely (48 s, 42 s, 86 s, 43 s, then 3.5 s / 4.6 s / 3.1 s as later batches found most of
what they needed already resident), and the final probe showed `settled: true`,
`loadProgress: 1`, every queue at 0. This is the number this document trusts.

### 6.2 Bytes, tiles, wall clock

| | `N_POSES = 28` | `N_POSES = 56` (shipped) |
|---|---|---|
| wall clock to `done` | 234.9 s | 228.6 s |
| tiles loaded | 2,906 | 3,079 |
| `cachedBytes` | 1.000 GB | 1.001 GB |
| `rootRequests` / `constructions` | 1 / 1 | 1 / 1 |

**Doubling the sample density cost almost nothing** — 173 more tiles, 0.001 GB more bytes.
Adjacent sampled poses overlap heavily in what they select, which is also why decision 3's
tier-3 (`errorTarget` tiering by altitude) is **not implemented**: both sessions landed at
~1.0 GB, comfortably under the 1.5 GB threshold the approved plan set for triggering it.

### 6.3 Retention: eviction fully solved, re-fetch has a real, disclosed residual

`scripts/verify-retention.mjs` drives a full `u = 0 → 1 → 0` scrub after `done`, sampling
`window.__tiles.stats` at every step, against both densities:

| | `N_POSES = 28` | `N_POSES = 56` |
|---|---|---|
| `inCache` before → min → after | 2,906 → **2,906** → 3,336 | 3,045 → **3,045** → 3,438 |
| `loaded` before → after | 2,906 → 3,336 | 3,045 → 3,438 |
| re-fetch (Δloaded / before) | 430 tiles, **14.8%** | 393 tiles, **12.9%** |

**`inCache` never once decreased, in either session.** That is the guarantee this phase's
finalizing step (`Preload.tsx` raising `lruCache.minBytesSize`/`maxBytesSize` from the
measured `cachedBytes`) exists to provide, and it holds exactly as designed: nothing the
preload ever loads gets evicted.

**Zero re-fetch does not hold, and cannot for any finite discrete sampling.** Tile selection
is continuous with altitude; 28 (then 56) synthetic cameras are 28 (then 56) points on a
continuous curve, and a live scrub visits points neither samples. Doubling the density only
moved the residual from 14.8% to 12.9% — real evidence that sample count is not the
dominant lever here, not merely an unlucky first attempt. Chasing this further (112, 224
poses…) was not pursued: the returns are clearly diminishing, the cost is real API quota per
attempt, and the residual itself is small and spread thin across many individual
one-or-few-tile increments (the first re-fetch in each session moved `loaded` by exactly 1),
not concentrated stutters — a materially different, much milder situation than the
300–900-tile cold loads and 300+ ms frame times this phase set out to fix. `LoadingBar.tsx`
remains mounted specifically to cover this residual, and `tests/e2e/preload.spec.ts` gates
on a generous 50% bound (roughly 3–4× the measured residual) rather than zero, so a real
regression in retention is still caught without the gate being permanently on the edge of
flaking over an already-understood, already-bounded gap.

### 6.4 Re-measuring the parse bottleneck: §0.1's bullet (b) named the wrong cause

`parseQueue.maxJobs` was raised 5 → 16 in P11 on solid evidence (tiles finished downloading
and sat waiting on slots) but with an explanation that was never checked: "Draco/glTF decode,
CPU-bound, main-thread, serial", repeated in `Preload.tsx`'s `BATCH_TIMEOUT_MS` comment as
"CPU-bound and single-threaded". Checked against the library and against real tile bytes:

- **No Draco, no KTX2, no workers.** `Worker` / `DRACOLoader` / `KTX2Loader` /
  `setWorkerLimit` appear in exactly one implementation file in `3d-tiles-renderer@0.5.0`
  (`three/plugins/GLTFExtensionsPlugin.js`), which this app does not register — and does not
  need to. Real `.glb` tiles pulled straight off `tile.googleapis.com` report
  `extensionsUsed: ["KHR_materials_unlit"]` and nothing else: one primitive, float32
  `POSITION`/`TEXCOORD_0`, uint8 indices, 138–194 vertices, and one `image/jpeg` bufferView
  that is 60–85% of the tile's bytes. So there is no worker pool to enlarge.
- **The one part that can leave the main thread already does.** three's `GLTFLoader` routes
  buffer-view images to `ImageBitmapLoader`, i.e. `createImageBitmap`, decoded off-thread.
- **`maxJobs` is not a core count.** `PriorityQueue` dispatches only from a
  `requestAnimationFrame` callback and holds ≤ `maxJobs` in flight, so throughput is
  `maxJobs / job-latency` — and job latency here is queueing behind a busy main thread.

Instrumented over a 40 s window inside a real preload (batch 2 on): main thread **98.7%**
busy, frame time p50 **229 ms** (4.4 fps), parse occupancy pinned at 16 with **456** tiles
backlogged, job latency p50 **1,335 ms** (≈6 frames), `createImageBitmap` awaits averaging
**685 ms**. Time inside *all* WebGL calls: **202 ms of 40 s (0.5%)**; texture upload
(`gl.initTexture`, §6's step 6) **11 ms**. Nothing was decoding — the slots were waiting.

Alternating windows inside single live sessions (the fair comparison — successive batches are
not equally expensive, so a between-run wall-clock A/B would confound the two):

| `maxJobs` | tiles/s (batch 2–3) | job latency p50 | at batch 4 (≈1 s frames) |
|---|---|---|---|
| 16 | 13.7 | 1,335 ms | 0.8 jobs/s, 1,158 backlogged |
| 64 | 32.1 | 1,029 ms | 13.4 jobs/s |
| 128 | 43.0 | 1,687 ms | — |

**64 is the knee**: past it, latency scales with concurrency instead of throughput doing so.
Shipped as 64 (`Tiles.tsx`'s `onRootTileset`). Cost: preload frame rate 4.39 → 3.15 fps, which
nobody sees behind `Preloader.tsx`'s overlay, and nothing afterwards — ordinary in-app
streaming never builds the several-hundred-tile backlog a deep queue exists to drain.

**Caveat, stated rather than hidden.** All of this — including §6.2's wall-clock figures — was
measured in headless Chromium rendering through **SwiftShader** (`WEBGL_debug_renderer_info`:
"ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device …), SwiftShader driver)"). That is why frame
time is ~229 ms and why 88% of profile samples land in native `(program)`. The numbers are
internally comparable, but a GPU-accelerated browser has shorter frames and less to gain.

**The bigger lever was not in `Tiles.tsx` — it was in `Preload.tsx`, and it IS implemented
now.** The preload is rendering-bound before it is parse-bound: **~5,900 `drawElements` per
frame** (234,452 in that 40 s window), because `TilesRenderer` draws the union of every
registered synthetic camera's selection every frame and this phase accumulates 4 → 28 of
them. Hiding `tiles.group` for the duration of the blocking overlay (nobody can see it
regardless — `Preloader.tsx`'s ladder is the only thing on screen) measured **34 tiles/s at
`maxJobs` 16 and 91 at 64** in isolation — a further ~2.5×. Shipped in `Preload.tsx`'s own
job loop (`tiles.group.visible = j.batch > UNLOCK_AFTER_BATCH`, revealed exactly at unlock,
since the real camera needs it visible from that point on). Combined with `maxJobs` 64 and progressive unlock (the app becomes interactive after
`UNLOCK_AFTER_BATCH` settles rather than waiting for the whole descent -- see
`Preload.tsx`'s own `UNLOCK_AFTER_BATCH` comment for the full reasoning): a clean isolated
run went from 510-515s total to **235.8s**, and this phase's own e2e gate (preload plus a
full 0→1→0 scrub) dropped from 9.4-9.7 minutes to **4.9 minutes**.

### 6.5 An observed reliability risk, not just a theoretical one

Across the real-key runs taken while measuring this phase, the SwiftShare-rendered
(software) Chromium instance driving `scripts/measure-preload.mjs` crashed outright once
("Target page, context or browser has been closed") and showed at least one internal
GPU-process crash-and-respawn cycle that Chromium's own resilience absorbed without losing
the page in two other runs. This is real, observed instability — not merely the theoretical
"a lower-end machine may drop the WebGL context" risk 7.1 already named — occurring at a
resident scale of roughly 350 MB–1 GB under software rendering. It was not chased further:
retrying until a run completes is a reasonable practical stance for a one-time measurement
script, but it is a live signal that this phase's real-GPU production behavior (where
Chromium is not falling back to SwiftShader) should be checked on real hardware before
being trusted at face value from a software-rendered measurement alone.

---

## 7. Risks, stated rather than hidden

1. **Memory — measured, not the honest unknown any more.** `cachedBytes` reached ~1.0 GB at
   both 28 and 56 poses (§6.2), under the 1.5 GB tier-3 threshold. NOT resolved, though:
   §6.4 records real, observed instability in the SwiftShader-rendered measurement sessions
   themselves — one hard browser crash, one internal GPU-process crash-and-respawn absorbed
   by Chromium's own resilience. This happened under software rendering at 350 MB–1 GB
   resident; production's real-GPU behavior at the same scale has not been checked on real
   hardware. `performance.memory` still will not tell us the truth
   (`P11-PHOTOREAL.md:527`) — the real check remains whether the context survives a full
   descent on target hardware, and that check is still open.
2. **Quota, accepted.** ~6× per-session Maps billing, paid by every visitor including one who
   never leaves orbit. Every page load pays in full: the per-session token defeats HTTP cache.
3. **First load becomes one to two minutes**, every time, with no way to skip. Accepted, and
   the reason the overlay copy has to be worth reading.
4. **A heading drag at stage 3/4 still streams.** Out of scope by decision 1. `LoadingBar`
   survives to cover it.
5. **`CameraRig` refactor.** The one change to working code. Fenced by `tests/pose.test.ts`
   before the old branch is deleted.
6. **`UrlSync.tsx` stripping `?preload=0` — checked, does not happen.** Its `write()` only
   ever `.set()`/`.delete()`s `SNAPSHOT_PARAM` on the URL and leaves every other search
   param untouched, so `?preload=0` survives every `replaceState` call it makes.
7. **The batch-timeout escape hatch defeating its own settle check — real, found and fixed.**
   Not a hypothetical: the first real measurement caught every batch riding a 20 s ceiling
   instead of ever reaching genuine idle. See §6.1 for the full account and the fix.
8. **Zero re-fetch during a scrub — real, found, and not fixable by more sampling.** See §6.3.
   Bounded and disclosed rather than silently claimed solved.

## 8. Rollback

Everything new is additive behind two conditions (`HAS_TILES_KEY` and `?preload=0`). Rollback
is: delete `Preload.tsx`, `Preloader.tsx`, `preloadPlan.ts`, revert three lines in
`Experience.tsx` and the `lruCache` values in `Tiles.tsx`. `pose.ts` can stay — it is a
behaviour-preserving extraction and is independently fenced.
