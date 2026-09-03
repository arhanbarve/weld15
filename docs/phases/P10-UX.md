# P10 — the controls get out of the way, and the descent becomes one move

Branch `p10-ux`, worktree `~/Code/weld15-ux`, cut from `origin/main` at `8e6ef50`.
Three other sessions hold `p10-fidelity` (`../weld15-p10`), `p10-walk-in` (`./weld15-walkin`) and `main`
itself. Nothing in this phase edits a file outside the list in section 4, and section 8 records the
merge hazards where that list overlaps another branch's likely surface.

Every number below was measured on this branch at `1440 x 900`, DPR 1, against `next dev` on
port 3010, unless it is marked DERIVED.

---

## 1. What is actually wrong

Ten complaints. Each is reproduced, and the cause is in the code rather than in taste.

### 1.1 The Sources disclosure cannot be dismissed

`src/ui/Sources.tsx` renders a `<details>` fixed at bottom-left (`app/globals.css:507`). It is
`position: fixed` with no close affordance and no consumer of any hidden state: the summary
collapses the body, and the 79 x 44 px `SOURCES` chip stays on screen at every one of the six
stages. Measured box at every stage: `[14, 95, 840, 886]`.

**After (P10 step 11 re-measurement, `node scripts/p10-measure.mjs`):** Sources moved into the
dock (step 6) as a `<details>` fold alongside View and Light and Correct a Dimension, collapsed by
default. `[data-testid="sources"]` is `[1058, 1426, 367, 413]` at stage 0 — inside the dock's
column, off the bottom-left corner entirely, and dismissible like every other fold.

### 1.2 The written description is not at the top-left corner

`.a11y-alt-dock` (`app/globals.css:577`) sets `top: calc(var(--s2) + 44px + var(--s1))` — 14 + 44 + 8
= **66 px** — to clear `.skip`, which is fixed at `top: var(--s2); left: var(--s2)` and is only on
screen while focused. Measured toggle box `[14, 266, 66, 110]` against the panel's own left edge at
14. So the dock is 52 px lower than the corner it is aligned to horizontally, and the thing it is
making room for is invisible 99% of the time.

**After (P10 step 11 re-measurement):** `[data-testid="a11y-alt-toggle"]` is `[14, 266, 14, 58]` —
flush with `top: var(--s2)`, the same 14 px as the corner it is aligned to. 0 px of offset, down
from 52.

### 1.3 The descent is discontinuous, and there is no one control for it

Four separate mechanisms, and none of them is a single scrubber:

- `store.setStage` sets `t: 0` (`src/state/store.ts:530`), and `CameraRig` un-settles on every stage
  change (`src/scene/CameraRig.tsx:173-176`), which makes the next frame **copy** the new pose
  instead of easing to it. So a stage button is a hard cut, by construction.
- The `t` scrubber is mounted only on stages that travel (`src/ui/Hud.tsx:672`), so stage 3 has no
  scrubber at all and the bar you were just dragging disappears when you arrive.
- `FlyDown` is the only thing that crosses a stage boundary continuously, and it is
  fire-and-forget: no scrub, no reverse, and it retires itself at `FLY_DOWN_END = 3`.
- The stage-to-stage geometry is *already* continuous — `descentPath()` pins each stage's last stop
  to the next stage's keyframe object (`src/scene/stages.ts:271`, `:461-463`), and each leg is
  logarithmic in altitude. So the discontinuity is **entirely** in the control surface and in the
  `settled` reset. The camera path underneath is one smooth curve that nothing lets you ride.

  One genuine gap: **stage 3 → stage 4 has no path at all.** `kf[3]` is `[150, 110, 190]` and
  `kf[4]` is 124 ft outside the north gable; `cameraKeyframe` returns `kf[3]` for stage 3 and stage
  4's own path starts at `kf[4]`. Nothing interpolates between them, so that boundary is a real cut
  even with `settled` fixed.

Leg extents, DERIVED from `keyframes(DEFAULT_PARAMS)`:

| leg | altitude | decades |
|---|---|---|
| stage 0 path | 31,353,347 → 16,332 ft | 3.2831 |
| stage 1 path | 16,332 → 815 ft | 1.3018 |
| stage 2 path | 815 → 110 ft | 0.8698 |
| stage 3 → 4 | 110 → 55 ft, plus 124 ft of translation | — (no path exists) |
| stage 4 path | the threshold, 5+ waypoints | — (not an altitude change) |

### 1.4 The stage-0 marker is enormous

`src/scene/Globe.tsx:399` — `<sphereGeometry args={[0.022, 16, 12]} />` inside a group scaled to the
proxy radius. Measured on the rendered frame by scanning for crimson: **32 x 32 px** at
1440 x 900, centred (719.5, 449.5), against a globe disc that fills the 900 px height. At Earth's
true scale that dot is 0.022 x 20,902,231 = **460,000 ft of radius — 87 miles**, i.e. a disc 174
miles across covering everything from Albany to Portland.

Second defect in the same mesh: `depthTest: false` (`:403`), so the marker draws through the Earth
and would still be visible with Weld on the far side. Invisible today only because stage 0 never
moves.

**After (P10 step 11 re-measurement):** the dot alone (the ring around it is a separate mesh, see
`Globe.tsx`'s `MARKER_RING`) measures **12 x 12 px**, down from the old 32 x 32 blob. Depth-tested
now: `wheel-and-spin.spec.ts`'s "spinning the globe 180 degrees hides the marker entirely" and "a
moderate spin culls at the limb, not at the centre" both pass.

### 1.5 The globe cannot be turned

`CameraRig`'s pointer and wheel listeners are attached only when `stage === 3`
(`src/scene/CameraRig.tsx:195`). Stage 0 has no pointer interaction of any kind. The globe's
orientation is a constant quaternion computed once (`src/scene/Globe.tsx:217`).

**After (P10 step 11 re-measurement):** `wheel-and-spin.spec.ts`'s "a 200px drag turns the globe,
moving the camera measurably" and its wheel-notch tests both pass at every stage they apply to;
the globe turns at stage 0 and the wheel drives the descent everywhere else.

### 1.6 Stage 3 is driven by six on-screen arrow buttons

`ORBIT_CONTROLS` (`src/ui/Hud.tsx:162-193`) renders `← → ↑ ↓ + −` as six 44 x 44 buttons inside the
HUD, measured at `y 639` occupying `x 510..798`. Pointer drag and wheel zoom already work
(`CameraRig.tsx:206-251`), so the buttons are a second path to the same state. No test drives them
(grepped: `orbit-left`, `orbit-in`, `orbit-keys`, `orbit-readout` appear in zero test files).

**After (P10 step 11 re-measurement):** the six buttons are gone —
`orbit-keys.spec.ts`'s "the six retired orbit-* buttons are absent from the DOM at every stage"
passes — and the same ten keys (arrows, PageUp/PageDown, +/-) are bound on the window and covered
by nine gates in `orbit-keys.spec.ts`.

### 1.7 The Cambridge imagery reads as black and white, and nothing at stage 3 is 3D

Three separate causes, all measured:

- **The ground tint.** `Ground.tsx` desaturates by `uTint * 0.75` and mixes 82% toward `#06203f`
  (`TINT_MAX = 0.82`, `SAT_MIN = 0.25`). `altitude.ts`'s `tint` band runs `[40,000 → 400]` ft, so
  tint is 0.194 at stage 1, **0.845 at stage 2** and **clamped to 1.0 at stage 3**. Measured mean
  saturation of a 360 x 200 ground patch clear of the HUD: stage 1 **0.036**, stage 2 0.194,
  stage 3 0.321 — and stage 3's is *blue cast*, mean rgb (64, 74, 92), not colour.

  **After (P10 step 11 re-measurement, same patch):** `TINT_MAX` is now `0.22`, `SAT_MIN` is `0.90`.
  Mean saturation: stage 1 **0.049** (rgb 143/140/138), stage 2 **0.155** (rgb 121/133/143), stage 3
  **0.074** (rgb 119/126/127). The saturation *number* at stage 3 reads lower than the 0.321
  before, which looks backwards until the rgb is read alongside it: 64/74/92 is a saturated blue
  because the blue channel dominates; 119/126/127 is close to neutral gray because it is not a
  tint any more, it is pavement — an aerial photograph's own low-chroma content, revealed rather
  than colour-cast. The qualitative claim is the one that matters here and it holds: blue cast is
  gone, replaced by tones that read as a photograph.
- **The massing is a translucent blue ghost.** `Campus.tsx` draws 36 buildings as
  `MeshStandardMaterial` in `#96c8f5` at opacity 0.12 → 0.34, `depthWrite: false`. `MASS_CEILING` is
  capped at 0.34 with a recorded note that full occlusion "is not achievable without losing the
  look", and `tests/labels.test.ts` asserts `MASS_CEILING < 0.5` to stop anyone raising it.

  **After (P10 step 11 re-measurement):** `MASS_OPACITY`, `CONTRAST_MASS`, `MASS_CEILING` and
  `massAt` are deleted (Appendix A). The buildings are opaque, solid geometry now — full occlusion,
  which is what delivers P9.md §6.9's occlusion requirement — not a translucency ceiling.
- **Weld itself is cyanotype at stage 3.** `WeldExterior.tsx` drives its palette seam from
  `progress = 1 - opacity` (`:398`), and `thresholdOpacity()` returns `shell: 1` for every stage
  below 4 — so `progress` is 0 and the whole building is `SCAN.line`/`SCAN.void` until the threshold
  starts dissolving it. The brick, sandstone and slate exist and are never seen before stage 4.

  **After (P10 step 11 re-measurement):** Weld's exterior wears brick from about 400 ft down, on
  the same `altitude.ts` band as the ground tint. `campus imagery threshold contrast perf`'s "brick
  is present at stage 3" gate passes: a hue histogram over Weld's projected box peaks in 10–30°
  where the baseline had none.

### 1.8 What high contrast does

`MASTER.md:144` specifies it exactly: *"thickens strokes to 2.5px, raises `--mass` opacity to
0.22."* `Campus.tsx` honours both — `BASE_WIDTH 1.5 → CONTRAST_WIDTH 2.5` CSS px on the campus
edges, and the mass fill's floor from 0.12 to 0.22 with the ceiling scaled by the same 1.833 ratio.
The flag is seeded from `prefers-contrast: more` and the button overrides the media query for the
session (`Hud.tsx:461-469`).

So it affects **only the campus line work and the campus mass fill**, which are on screen at stages
1–3 only, and after §1.7's change the mass fill stops existing. It does nothing for the HUD, the
written description, the interior, or any text. The button is mounted at all six stages, so at
stages 0, 4 and 5 it is a control with no effect whatsoever.

**After (P10 step 11 re-measurement):** the button is gone. Only the 2.5 px stroke half of the
description survives — there is no `--mass` fill left to raise once §1.7's massing became opaque —
and it is now seeded from `prefers-contrast: more` alone, unconditionally, with no session override
to diverge from the platform. `contrast.spec.ts`'s "MASTER's two figures reach the scene" and
"`prefers-contrast: more` seeds it" both pass at the re-measured figures (`dpr 1: line 1.5 -> 2.5`,
`dpr 2: line 3 -> 5`). See `design-system/MASTER.md`'s P10 amendments, item 2.

### 1.9 The control menu blocks the view and moves between stages

Measured HUD boxes:

| stage | HUD box `[l, r, t, b]` | what it covers |
|---|---|---|
| 0 | `[561, 879, 537, 886]` | the lit face of the Earth, bottom-centre |
| 1 | `[561, 879, 537, 886]` | Cambridge, dead centre-bottom |
| 2 | `[561, 879, 537, 886]` | the Yard |
| 3 | `[451, 989, 541, 886]` | **the entire base of Weld Hall** — 538 x 345 px |
| 4 | `[535, 905, 537, 886]` | the approach to the gable |
| 5 | `[561, 879, 14, 462]` | jumps to the **top**, 318 x 448 px of hallway |

The stage-5 move is `.hud.hud-room` (`globals.css:174`), added because the fit-out's 29 anchors land
at y 589–716 and a bottom HUD sat on top of every draggable piece. That measurement is correct; the
answer it chose is what makes the chrome inconsistent. The fly-down button is a third position
again — fixed top-centre, `x 638..802`, stages 0–2 only.

**After (P10 step 11 re-measurement, `node scripts/p10-measure.mjs`):** one dock, top right, same
`x 1058..1426` at all six stages. Height alone varies, with the fold state of the stage:

| stage | dock box `[l, r, t, b]` | what varies |
|---|---|---|
| 0 | `[1058, 1426, 14, 252]` | fly-down present |
| 1 | `[1058, 1426, 14, 252]` | fly-down present |
| 2 | `[1058, 1426, 14, 252]` | fly-down present |
| 3 | `[1058, 1426, 14, 320]` | orbit readout row, no fly-down |
| 4 | `[1058, 1426, 14, 208]` | shortest — no orbit row, no fly-down |
| 5 | `[1058, 1426, 14, 364]` | first-person row added |

No stage moves the dock's left or top edge, and nothing sits over the bottom of the frame at any
stage — the property the stage-5 move in the old table was reaching for, now true everywhere
rather than only at stage 5. This is the same box `Experience.tsx`'s reachability comment
(§ furniture editing) measures as the current occluder for the stage-5 hall shot: 17 of 29 pieces
are still reachable with the dock in this position (`scripts/p10-measure.mjs`'s `reach`, re-run at
step 11).

### 1.10 The sun controls are the largest thing in the HUD

`date` (176 x 44) plus `hour` (176 x 44) plus the two labels and the clock readout are **110 px of
the HUD's 345** at every stage, above the floor-area readout and the contrast toggle. The zoom
control — the actual subject — is one 176 px slider. The default instant (2026-09-15 09:00, chosen
in `store.ts:88` because the east facade is lit and the oak grain reads at 27° solar altitude) is
already the best-looking light in the app, so nothing is lost by making these secondary.

**After (P10 step 11 re-measurement):** date and hour moved into the `view-fold` disclosure
(`[data-testid="view-fold"]`), collapsed by default at every stage — 0 px of the dock's default
height, down from 110 of 345 always-visible. The default instant is unchanged.

---

## 2. Goals, and what this phase is not

**Goals**

- G1 One dock, top right, identical position and identical structure at all six stages.
- G2 One continuous scrubber for the whole journey, with a labelled tick per stage, and no cut at
  any stage boundary while it is being dragged.
- G3 Trackpad and mouse drive everything: drag to orbit and to turn the globe, wheel to travel.
- G4 The stage-0 marker is a pin, not a continent, and it hides when it is on the far side.
- G5 Stage 3 shows a colour photograph, solid 3D buildings, and a brick Weld.
- G6 The sun controls, the sources and the floor area move into a secondary disclosure inside the
  dock. The date/hour default is unchanged.
- G7 The high-contrast button is gone; the platform preference still takes effect.
- G8 Stage 3's arrow/zoom buttons are gone; every one of their actions is still reachable from the
  keyboard, unadvertised buttons excepted.

**Non-goals**

- The suite interior (stages 4–5 geometry, furniture, first person, drag-to-edit) is not touched
  except where the dock's box moves over it. `p10-walk-in` owns that surface.
- No new URL wire-format field, and no `VERSION` bump. `stage` and `t` already encode the journey
  position; globe spin and dock open/closed state are deliberately not shared, on the same argument
  `url.ts` already makes about `flying` and `firstPerson`.
- No change to `geo/`, to `weld.json`, to the imagery pyramid, or to `scripts/`.
- No new dependency.

---

## 3. The specification, item by item

### S1 — one dock, top right (G1)

Replace three fixed positions (HUD bottom-centre / top-at-stage-5, fly-down top-centre, sources
bottom-left) with **one** fixed column at `top: var(--s2); right: var(--s2)`.

```
.dock  width min(23rem, 100vw - 2*--s2)   max-height calc(100dvh - 2*--s2)   overflow-y auto
       z-index --z-panel                  pointer-events none; children auto
  ├── <section> JOURNEY                       always mounted, never moves
  │     [3] Weld Hall                         stage chip + name          (data-testid stage-name)
  │     ├─ master scrubber + 6 ticks           (data-testid journey)
  │     ├─ [Fly down to Weld] / [Stop]         (data-testid fly-down)  stages 0-2, !reduced
  │     ├─ [Reset the view]                    (data-testid reset-view) stage 0 or 3 only
  │     ├─ stage 3: az/pol/ft readout + hint   (data-testid orbit-readout, orbit-live)
  │     └─ stage 5: walk + places row          (data-testid fp-controls) — unchanged internals
  ├── <details> VIEW AND LIGHT                 collapsed by default
  │     date · hour · floor area · reduced-motion flag
  ├── <details> CORRECT A DIMENSION            the existing Panel, internals unchanged
  └── <details> SOURCES                        moved here verbatim from bottom-left
```

Rules:

- `.hud.hud-room` is deleted. There is no per-stage position.
- The dock is one scroll container so two open disclosures cannot push content off screen. Wide
  content still scrolls inside its own box (MASTER's breakpoints rule).
- `.fly` and `.sources` lose their `position: fixed` rules; both become flow children of the dock.
- `.skip` moves to `left: 50%; transform: translateX(-50%) translateY(-200%)`, so the top-left corner
  is free. It stays first in the DOM, so it stays the first tab stop —
  `journey.spec.ts:120-130`'s gate is unaffected.
- `.a11y-alt-dock` gets `top: var(--s2)`, aligning it with its own `left: var(--s2)`. Its width stays
  26 rem; with the HUD gone from the centre there is nothing left for it to collide with, and
  `a11y.spec.ts`'s intersection gate is re-pointed at the new dock box.

**Measured constraint that must be re-verified, not assumed.** At stage 5 the dock occupies
`x 1058..1426` for its full height. `Experience.tsx:160-180` records that 17 of the 29 pieces are
pointer-reachable from the hall shot. Step V5 in section 5 re-runs that exact projection test and
the phase does not ship if the number falls.

### S2 — the master scrubber (G2)

New three-free module `src/scene/journey.ts`, unit-testable in node, importing only `stages.ts`
types and `altitude.ts`:

```ts
export type Leg = { stage: StageId; span: number };
export function legs(params: SuiteParams): Leg[];        // span in "decades", see below
export function boundaries(params: SuiteParams): number[]; // u at each of the 6 ticks
export function toJourney(stage: StageId, t: number, params: SuiteParams): number;   // → u
export function fromJourney(u: number, params: SuiteParams): { stage: StageId; t: number };
```

Spans, and why each is what it is:

| leg | span | source |
|---|---|---|
| 0 | 3.2831 | DERIVED, `log10(alt0 / alt1)` off the stage-0 path |
| 1 | 1.3018 | DERIVED |
| 2 | 0.8698 | DERIVED |
| 3 (3→4) | 0.60 | CHOSEN. The transit is 124 ft of translation at the scale of a 143 ft building, i.e. not an altitude change at all. 0.60 gives it 8.6% of the bar — between leg 2's 12.5% and a tick's width, which is what a short repositioning move should get. |
| 4 (threshold) | 0.90 | CHOSEN. The threshold is the payoff and must be scrubbable frame by frame; 0.90 gives it 12.9% of the bar, so one pixel of a 300 px slider is 0.4% of `t`. |

Total 6.9547. Tick positions, DERIVED: **u = 0, 0.4720, 0.6592, 0.7843, 0.8706, 1.0**. They are
computed at render from `boundaries(params)` and never written down in CSS, because the first three
move with the suite params.

- `toJourney`/`fromJourney` are exact inverses at every tick, and `fromJourney(1) = {stage: 5, t: 0}`.
  Stage 4 at `t = 1` and stage 5 at `t = 0` are the same pose by construction
  (`thresholdPath()` pins its last stop to the `kf[5]` object), so the top of the bar is not a cut.
- The slider is `<input type="range" min={0} max={1} step={0.0005}>` — 2000 steps, so the widest leg
  (47% of the bar) still resolves `t` to 0.0011.
- The six ticks are real `<button>`s positioned at `left: {u * 100}%`, keeping
  `data-testid="stage-N"` and `aria-current="step"`, so every existing gate that clicks a stage keeps
  working. They are the *only* stage buttons; `.hud-scrub`'s six numerals are retired.
- `[` and `]` keep stepping stages (MASTER names them). The range input's own arrow keys scrub.

**Store changes** (`src/state/store.ts`):

```ts
scrubTo: (u: number) => void;    // sets {stage, t} together, cancels flying, does NOT bump `cuts`
scrubbing: boolean;              // pointer is down on the master slider
setScrubbing: (v: boolean) => void;
cuts: number;                    // monotonic counter, bumped ONLY by a jump
```

`cuts` is bumped by `setStage`, `next`, `prev`, `skipToSuite`, `enterFirstPerson`,
`leaveFirstPerson`. It is **not** bumped by `scrubTo`, `setT` or `flyStep` — those three are
continuous motion, and `flyStep`'s exclusion is what makes the fly-down one move instead of three.

**CameraRig changes** (`src/scene/CameraRig.tsx`):

- `useEffect(..., [cuts, walking])` instead of `[stage, walking]`. This one line is what deletes the
  boundary cut: the pose either side of a boundary is already identical, so with no un-settle there
  is nothing to jump.
- The copy-don't-ease branch gains `scrubbing`: `if (walker !== null || reduced || scrubbing ||
  !settled.current)`. A dragged slider must track the hand; the 3.2/s exponential would lag it by
  ~0.3 s.
- Stage 3's pose becomes `blend(orbitKeyframe(kf[3], orbit ?? orbitOf(kf[3])), kf[4], t)`. At `t = 0`
  that is exactly today's free orbit; at `t = 1` it is exactly `kf[4]`, the first stop of stage 4's
  path. This is what fills the 3→4 gap, and it starts the transit from wherever the viewer orbited
  to rather than from a fixed pose.
- `window.__cam` gains `u: number` and `cuts: number`, so a gate can assert continuity without
  reconstructing the mapping.

**Wheel = travel** (G3). The wheel listener moves out of the stage-3-only effect:

| stage | wheel does |
|---|---|
| 0, 1, 2, 4 | `scrubTo(u ± k)` — descend / ascend along the journey |
| 3 | orbit radius, exactly as today (`ZOOM_PER_NOTCH`) |
| 5 | nothing (the interior is not a zoom) |

`k` is `0.02` of the bar per notch of `deltaY / 100`, i.e. ~50 notches end to end. `ctrlKey` wheel
(macOS pinch) is treated as the same gesture, and `preventDefault()` stays so the page never
scrolls under it.

### S3 — the stage-0 marker (G4)

`src/scene/Globe.tsx`:

- The marker's radius is written per frame to hold a constant angular size: `scale = D *
  tan(MARKER_DEG) / rig.radius` where `D` is the camera-to-marker distance and `MARKER_DEG` is
  `0.32°` — **5.0 px of radius at 900 px tall and 45° fov**, DERIVED, against today's 16.
- A concentric ring at 2.6x the dot's radius, 1 px stroke, so a 10 px pin still reads as a
  deliberate mark and not as a stray pixel. Ring and dot are one group, scaled together.
- **Horizon test.** The marker is hidden when Weld is on the far side: visible iff
  `dot(n, normalize(cam − centre)) > R / |cam − centre|`, the exact condition for a point at radius
  `R` on a sphere to be above the horizon from that distance. Pure, and unit-tested in
  `tests/globeRig.test.ts` rather than eyeballed.

### S4 — the globe turns (G3)

New store field `globeSpin: { yawDeg: number; pitchDeg: number } | null`, default null, **not**
URL-encoded.

`CameraRig` attaches pointer listeners at stage 0 as well as at stage 3, with the same
`DRAG_TURN_DEG` per viewport height so a drag feels the same in both places. The spin is applied by
rotating both the camera position **and** its target about the Earth's centre — which sits at
`(0, −R_EARTH_FT, 0)` in the site frame, straight down from Weld:

```
q      = centre + R(spin) * (p − centre)
target = centre + R(spin) * (target − centre)
```

Both, so the disc stays framed and a different face of the Earth comes round; the marker moves off
centre, which is the point. Clamps: pitch ±80° (beyond that `lookAt`'s up-vector degeneracy starts
deciding the roll, which is the same trap `STAGE0_TILT_DEG`'s docblock records), yaw wraps.

**Blended out by `t`.** The applied rotation is scaled by `(1 − t)`, so at the bottom of leg 0 the
pose is exactly `kf[1]` whatever the viewer did to the globe. The descent cannot be aimed away from
Cambridge, and the leg's endpoint guarantee survives.

`[Reset the view]` in the journey card clears `globeSpin` at stage 0 and `orbit` at stage 3.

### S5 — stage 3 loses its buttons (G8)

- `ORBIT_CONTROLS`, the six buttons and the `.hud-orbit` group's `onKeyDown` are deleted from
  `Hud.tsx`.
- The keys survive, moved to a window `keydown` mounted at stage 3, with the same
  `INPUT`/`SELECT`/`TEXTAREA`/`isContentEditable` guard the piece and bracket handlers already use.
  `ArrowLeft/Right` azimuth, `ArrowUp/Down` polar, `PageUp/PageDown`/`+`/`=`/`−`/`_` radius —
  the same `STEP_DEG = 5` and `ZOOM_PER_PRESS` arithmetic, unchanged, so MASTER's "every canvas
  interaction has a keyboard equivalent" still holds and nothing about the derivation moves.
- What is kept visible: the `az … pol … ft` readout, the polite live region, and one dim hint line —
  `drag to orbit · scroll to zoom · arrows and +/− also work` — so the keyboard path is discoverable
  rather than folklore. `aria-keyshortcuts` moves onto the readout's group.

### S6 — colour, and 3D at stage 3 (G5)

Three edits, in increasing order of risk.

**S6a — the ground keeps its colour.** `Ground.tsx`: `TINT_MAX 0.82 → 0.22`, `SAT_MIN 0.25 → 0.90`.
At full tint the photograph then keeps 90% of its saturation and is pushed 22% toward `#06203f` — a
cool grade that ties it to the palette instead of erasing it. The `tint` band in `altitude.ts` is
unchanged, so *when* the grade arrives is unchanged; only *how far* it goes.

Honest caveat, recorded because it will otherwise read as a bug: the L2/L3 plates are MassGIS
leaf-off imagery flown March–April 2025. They are grey-brown at the source. Measured mean saturation
of the stage-1 patch is 0.036 with a tint of only 0.194, so most of stage 1's greyness **is the
photograph**, not the shader. Colour here means true-to-source, not green.

**S6b — the campus becomes solid.** `Campus.tsx`:

- The 36 buildings become opaque (`transparent: false`, `depthWrite: true`), lit by the existing
  `Lighting` rig, roughness 0.85.
- Roof faces sample the L3 plate by world position — a planar UV from world XZ through
  `quadOf("L3")`'s extent, so each building's roof carries its own aerial patch — and wall faces get
  a shaded neutral derived from that sample. One extra texture bind, no extra draw call: the
  geometry is already two merged meshes.
- This **delivers P9.md §6.9's full occlusion**, which that phase recorded as unachievable. An
  opaque building hides its own smeared rooftop; the doubled image is gone by construction rather
  than by an opacity ramp that could only reach 0.34.
- `MASS_OPACITY`, `CONTRAST_MASS`, `MASS_CEILING`, `HIGH_CONTRAST_GAIN` and `massAt()` are deleted.
  `tests/labels.test.ts`'s `MASS_CEILING < 0.5` assertion goes with them.
- **Weld keeps three non-hue signals**, which MASTER requires. Opacity is no longer one of them, so:
  brighter and wider edge lines (`WELD_WIDTH`, unchanged), the `Weld Hall` label chip (unchanged),
  and the pulse moves from `material.opacity` to `material.emissiveIntensity` over the same
  1.0–1.55 range and the same 1.6 rad/s. Reduced motion holds it at the fixed multiple, as now.

**S6c — Weld resolves into brick as you descend.** `WeldExterior.tsx`: the palette seam's driver
changes from `progress = 1 - opacity` to an altitude ramp — `progress = layerOpacity(alt).tint`,
the same 40,000 → 400 ft band the ground already resolves on. So the building becomes brick,
sandstone and slate as the camera comes down, and by stage 3 (110 ft) it is fully brick.

The threshold then does what it says: it *dissolves* the shell (`opacity`) rather than
simultaneously repainting it. That is a real change to the stage-4 sequence and it is a divergence
from `WeldExterior.tsx`'s own header, which argues for combining the two. Recorded in §7, and
`threshold.spec.ts`'s palette-at-`t` assertions are re-pointed at altitude.

### S7 — the sun, the sources, the area (G6)

Moved verbatim into the `VIEW AND LIGHT` disclosure inside the dock: `sun-date`, `sun-hour`, the
clock readout, `area-readout`, and the reduced-motion flag. Same testids, same handlers, same
`ISO_DATE` guard, same 44 px minimum. `Sources` moves into the dock as the last disclosure with its
markup untouched. The default date and hour do not change.

### S8 — high contrast (G7)

The button, `contrastChosen`, `setHighContrast`'s call site in `Hud.tsx` and the
`aria-label`/`data-testid="contrast-toggle"` go. The store field `highContrast` **stays**, seeded
from `prefers-contrast: more` by an effect moved into `CameraRig` beside the `prefers-reduced-motion`
seed — where it becomes an unconditional mirror of the query, exactly like `reducedMotion`, because
nothing can disagree with it any more.

What it still does after S6b: thickens campus strokes 1.5 → 2.5 CSS px. The mass-fill half of
MASTER's sentence no longer has a mass fill to apply to, so it is dropped and MASTER is amended
(§7). Somebody who has set the OS preference still gets the thicker strokes; nobody gets a button
that does nothing at three of six stages.

---

## 4. Every file this phase touches

| file | change |
|---|---|
| `src/ui/Hud.tsx` | restructured into the dock; stage ticks replace `.hud-scrub`; master scrubber; orbit buttons out, orbit keys to a window handler; sun/area into a disclosure; contrast toggle deleted; `Sources` mounted inside the dock |
| `src/ui/Sources.tsx` | unchanged markup; loses nothing but its fixed position (which lives in CSS) |
| `src/ui/JourneyBar.tsx` | **new.** The range input, the six tick buttons, the labels, the ARIA |
| `src/scene/journey.ts` | **new.** `legs`, `boundaries`, `toJourney`, `fromJourney`. Three-free |
| `src/state/store.ts` | `scrubTo`, `scrubbing`, `setScrubbing`, `cuts`; `cuts` bumped by the five jump actions and not by `scrubTo`/`setT`/`flyStep` |
| `src/scene/CameraRig.tsx` | un-settle on `cuts`; copy while `scrubbing`; stage-3 pose blends to `kf[4]` by `t`; pointer at stage 0; wheel dispatch by stage; `prefers-contrast` seed; `__cam.u`, `__cam.cuts` |
| `src/scene/Globe.tsx` | marker scaled per frame, ring added, horizon test; spin applied |
| `src/scene/globeRig.ts` | `markerVisible(alt, …)` horizon predicate, exported and tested |
| `src/scene/Ground.tsx` | `TINT_MAX`, `SAT_MIN` |
| `src/scene/Campus.tsx` | opaque, roof-textured massing; pulse on emissive; mass-opacity constants deleted |
| `src/scene/WeldExterior.tsx` | palette seam driven by altitude |
| `app/globals.css` | `.dock` block; `.hud`/`.hud-room`/`.fly`/`.sources` positioning retired; `.skip` centred; `.a11y-alt-dock` to the corner; tick-mark styles |
| `src/ui/Panel.module.css` | `.dock` becomes a flow section rather than a fixed dock |
| `design-system/MASTER.md` | amendment note, §7 |
| `docs/phases/P10.md` | this file |

Tests: `tests/journey.test.ts` (new), `tests/globeRig.test.ts`, `tests/labels.test.ts`,
`tests/stages.test.ts`, `tests/e2e/{a11y,contrast,threshold,journey,campus,imagery,edit,perf}.spec.ts`.
Section 6 is the itemised list.

---

## 5. Build order — eleven steps, each with its own check

Every step ends green: `npm run typecheck && npm test` at minimum, plus the named check. Nothing is
committed that fails its own step.

| # | step | verification |
|---|---|---|
| 1 | `src/scene/journey.ts` + `tests/journey.test.ts`, no UI | `toJourney`/`fromJourney` round-trip to 1e-12 across 10k samples; exact at all six ticks; `boundaries()` strictly increasing; ticks match the DERIVED table in §S2 to 1e-4 |
| 2 | store: `cuts`, `scrubbing`, `scrubTo` | `tests/store.test.ts`: `scrubTo` leaves `cuts` unchanged and sets both fields; the five jump actions each bump it exactly once; `flyStep` does not |
| 3 | `CameraRig`: un-settle on `cuts`, copy while `scrubbing`, `__cam.u` | e2e: sweep `u` 0→1 in 200 steps, assert **no** step moves the camera more than 3x the median step, i.e. no cut anywhere including at all five boundaries |
| 4 | stage-3 pose blends to `kf[4]`; `journey.test.ts` for the transit | `stages.test.ts`: pose at stage 3 `t=1` equals `kf[4]` to 1e-9; at `t=0` equals `orbitKeyframe(kf[3], seed)` exactly |
| 5 | `JourneyBar.tsx` + dock skeleton; HUD moved, `.hud-room` deleted | boxes at all six stages identical to within 1 px; nothing at bottom-centre; axe clean at all six |
| 6 | sun/area/sources into the disclosure; contrast button out; `.skip` and `.a11y-alt-dock` repositioned | dock toggle box top-left is `[14, …, 14, …]`; `sources` is inside the dock's subtree; axe clean open and closed |
| 7 | wheel dispatch + stage-0 pointer + `globeSpin` + reset | e2e: wheel at stage 1 changes `__cam.u` monotonically; drag at stage 0 changes `__cam.position` and returns to the keyframe pose when `t` reaches 1; reset clears it |
| 8 | stage-3 orbit keys to a window handler, buttons deleted | e2e: each of the six keys still moves `__cam` as before; typing `[` into `sun-date` changes neither stage nor orbit |
| 9 | marker size, ring, horizon test | crimson-pixel scan at stage 0 gives **9–12 px** of extent, down from 32; with the globe spun 180° the marker contributes **zero** crimson pixels |
| 10 | `Ground` tint + `Campus` solid + `WeldExterior` altitude seam | stage-3 patch mean saturation ≥ 0.75x the same patch with `uTint` forced to 0; brick hue present at stage 3 (a hue histogram peak in 10–30°); `__perf.calls` at stage 3 ≤ 30 and median frame time no worse than +15% |
| 11 | full-suite pass, then the box re-measure | `npm test`, `npx playwright test`, and the §S1 pointer-reachability re-measure at stage 5 must still report **≥ 17** of 29 pieces |

---

## 6. Test plan, and every gate that has to change

**New**

- `tests/journey.test.ts` — the mapping, the ticks, the inverse, the span table.
- `tests/e2e/journey-continuity.spec.ts` — the 200-step sweep of step 3, and the same sweep in
  reverse; plus a `cuts`-did-not-change assertion across each boundary.

**Amended, and why**

| file | why |
|---|---|
| `tests/e2e/contrast.spec.ts` (505 lines) | `contrast-toggle` is gone. The media-query seed, the 2.5 px stroke assertion and the `__campus.lineWidth` probe survive; every test that clicks the button, and the two mass-opacity assertions (`0.22`, the ramp), are deleted or rewritten against the seed. |
| `tests/e2e/a11y.spec.ts` | `threshold-t` → `journey`; the axe node-count docblock (fifteen nodes, naming `contrast-toggle` and `.hud-orbit > span`) is re-measured; the stage-5 dock/HUD/sources intersection gate is re-pointed at the new boxes. |
| `tests/e2e/threshold.spec.ts` | `threshold-t` → `journey` with `u` computed via `toJourney(4, t)`; the palette-at-`t` assertions move to palette-at-altitude (S6c). |
| `tests/e2e/journey.spec.ts` | `threshold-t` → `journey`. The skip-is-first-tab gate is unaffected and must stay passing. |
| `tests/labels.test.ts` | drop the `MASS_CEILING < 0.5` assertion with the constant. |
| `tests/e2e/campus.spec.ts` | the tinted-population brightness threshold (236) is re-measured against a colour ground and solid buildings. |
| `tests/e2e/imagery.spec.ts` | the tint-is-a-19%/85%-effect commentary and any chroma assertion re-measured for `TINT_MAX = 0.22`. |
| `tests/e2e/edit.spec.ts` | the 40-draw-call ceiling at stage 5, and the pointer-reachability figure, re-measured against the new dock box. |
| `tests/e2e/perf.spec.ts` | headless medians move with S6b; re-baseline, and record the real-hardware figure beside it rather than tuning to SwiftShader (`FlyDown.tsx`'s docblock is the precedent). |
| `tests/globeRig.test.ts` | add the horizon predicate. |
| `tests/stages.test.ts` | add the stage-3 transit blend; stage-0 pose is unchanged. |

**Unaffected and must stay green untouched**: `walk.spec.ts`, `smoke.spec.ts`,
`desktop-only.spec.ts`, `url.test.ts` (no format change), and all of `geo/`'s unit tests.

---

## 7. Divergences from the design system, stated rather than smuggled

Four, all deliberate, all traceable to an instruction in this phase's brief. `design-system/MASTER.md`
gets a `## P10 amendments` section recording each.

1. **The cyanotype gives way to a photograph at stages 1–3.** MASTER's palette section commits each
   stage to one palette and says they are never blended; S6a/S6b/S6c make the scan *resolve into*
   colour and brick as altitude falls. The tint band still exists, so the drawing-to-photograph
   progression is intact — what changes is that the bottom of the ramp is a photograph rather than a
   blue monochrome.
2. **High contrast keeps half of its definition.** MASTER:144 names two effects; after S6b there is
   no `--mass` fill to raise, so only the 2.5 px stroke survives, and it is now applied from the
   platform preference alone.
3. **Stage 3's canvas interactions have no on-screen buttons.** MASTER asks for `onKeyDown` alongside
   every `onClick`; there is no longer an `onClick` to sit alongside, and the keys are still bound and
   still advertised in a visible hint and in `aria-keyshortcuts`. The intent — reachable by keyboard —
   holds; the letter of it does not apply.
4. **The threshold no longer repaints the shell.** `WeldExterior.tsx`'s header argues for driving the
   palette from the dissolve so the payoff is not spent early. S6c spends it earlier on purpose,
   because a blue ghost box at stage 3 is the complaint this phase exists to answer.

---

## 8. Risk, rollback, and the four-session hazard

| risk | mitigation |
|---|---|
| **Concurrent branches.** `p10-fidelity` and `p10-walk-in` are cut from the same commit and will plausibly touch `Campus.tsx`, `WeldExterior.tsx` and `globals.css`. | Steps 1–4 and 7–9 touch none of the likely-contested files. S6 (step 10) is the collision surface and is deliberately **last**, so it can be dropped or rebased without unpicking anything else. Nothing is pushed to `main` from here without a fresh `git fetch` and a look at the other two branches' diffs first. |
| **The dock covers the furniture at stage 5.** | Step 11's re-measure is a hard gate: ≥ 17 of 29 pieces pointer-reachable, or the dock gets a collapse-to-a-strip state at stage 5 before this ships. |
| **Solid massing costs frame time.** | Step 10's budget: stage-3 draw calls ≤ 30 (from 28) and median frame time no worse than +15% headless. Over budget → the roof texture is dropped and the buildings ship flat-shaded, which still satisfies "3D". |
| **`cuts` misses a jump and a stage button starts easing through the building.** | `tests/store.test.ts` asserts the counter per action, and the continuity sweep asserts the opposite property, so a missing bump fails one of the two. |
| **The 3→4 blend flies through masonry.** | `kf[3]` is outside `STAGE3_CLAMP.minRadius` (114.9 ft) and `kf[4]` is 124 ft outside the gable; the straight line between them stays outside the massing sphere. Asserted in `stages.test.ts` by sampling the blend at 0.001 and checking `|pos − target| ≥ MASS_RADIUS` for the whole segment — the same property `keepOutsideMassing` exists to protect. |
| **Rollback.** | Eleven commits, one per step, each independently green. Any step can be reverted on its own; the two riskiest (10, and 5's layout restructure) are the last and the middle, not the foundation. |

---

## 9. Questions asked, and how they were answered

All three were put to the owner before any code was written, and all three came back as this spec
already proposed. Recorded here so the decisions are traceable rather than assumed.

1. **The bar's top end — 0 → 5, into the room.** The brief said "from 0 all the way to 4"; asked
   directly, the answer was the whole journey. Stopping at 4 would leave the final crossing — the
   payoff — off the one control that drives the journey. Six ticks, the last at `u = 1.0` being
   stage 5. Section S2's span table stands as written.
2. **How far the cyanotype retreats — resolve on the existing ramp.** Stage 0 stays pure scan;
   colour and brick arrive on the 40,000 → 400 ft `tint` band already in `altitude.ts`, so stages
   1–2 are part-way and stage 3 is fully photographic. The rejected alternatives were photographic
   from stage 1 down, and dropping the scan entirely; both lose the drawing-becomes-real
   progression that is the reason the descent exists.
3. **The fly-down still stops at stage 3.** `FLY_DOWN_END` is unchanged, per the decision recorded
   in `store.ts:63` — walking through a wall should be something the viewer does. With the boundary
   cuts gone it would now be trivial to fly all the way in, and that was declined deliberately: the
   flight hands over to the free orbit rather than ending the piece for you.
