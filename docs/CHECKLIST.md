# `design-system/MASTER.md`, worked item by item

Every box below was ticked from a **rendered page in a real browser** — computed styles read
off the live DOM, and grounds read back out of actual screenshot pixels. Nothing here is read
off the source, because this project's most repeated defect is an accessibility property
written where it has no effect: `aria-label` on R3F's `<Canvas>` landed on a container div and
was measured absent from both the div and the canvas, so the six-stage descent had no
accessible name at all. Source inspection showed a label. Only the browser showed the truth.

## How these numbers were taken

- Chromium via Playwright's browser API, viewport **1280 × 720**, `deviceScaleFactor` 1,
  against the dev server on :3000. A second pass at 1440 × 900 and DPR 2 where the item is
  resolution-dependent.
- **Contrast** is not computed from the token table. For each element that paints its own
  text: the element's text (and its descendants') is set to `transparent`, the element's box
  is screenshotted, the PNG is decoded back inside the page and every pixel of the ground is
  read. The ratio is then computed against the ground's mean and against its 5th/95th
  luminance percentiles, so a translucent chip over a radial vignette over a live WebGL frame
  is measured as composited rather than as declared. The band, not the mean, decides the
  verdict.
- **Stage** is read from `window.__weld.stage`, which `UrlSync` publishes on every store
  change, and each move waits 1.6 s for the camera to settle.

### One caveat that belongs in the record, and how it was closed

Three other agents were editing `src/scene/Experience.tsx`, `Threshold.tsx`,
`WeldExterior.tsx`, `weldGeometry.ts` and `src/geo/walls.ts` while this audit ran, and the app
crashed twice mid-measurement from their in-flight edits (`Threshold.tsx:368`, then `Experience`
reading `alpha` of null). Every run was retried against a healthy build.

**Every scene-dependent figure was then re-taken after those agents committed**, at
`eaf1f93` "P7: stand up and walk it, and the threshold finally lands in the hall", and all of
them reproduce: stage 2 strokes n=2732, median 2 device px, 90.8 % ≥ 2 px; stage 3 n=6239,
median 2, 78.7 % ≥ 2 px; `window.__perf` at stage 2 and 3 both 26 calls / 16899 triangles /
122 lines; stage 4 21 calls / 433 triangles / 0 lines; stage 5 38 calls / 1469 triangles /
0 lines / 9 shadow casters. So nothing below rests on a half-saved file.

---

## Legend

**PASS** — measured, meets the stated bar. **FAIL** — measured, does not.
**N/A** — cannot apply, with the reason. Every row carries the number it was judged on.

---

## Contrast ledger (MASTER.md §Contrast ledger) — verified, not assumed

MASTER's own table, re-computed from the tokens in `app/globals.css`:

| Pair | MASTER says | Computed | Verdict |
|---|---|---|---|
| `--ink-scan` #e4ebf6 on `--void` #06203f | ~13:1 | **13.62:1** | table is right |
| `--ink-day` #0a1626 on `--plaster` #f0ede7 | ~15:1 | **15.55:1** | table is right |
| `--mark` #e4526f on `--void` #06203f | ~4.0:1 | **4.46:1** | close enough, and still under 4.5 — its verdict "large text and graphics only — never body" holds, and is the finding below |
| `--line` #8fc4f2 on `--void` #06203f | ~6.5:1 | **8.82:1** | **the table understates this one by a third.** #8fc4f2 on #06203f is 8.82:1, not 6.5. Nothing is broken by it — the row is more permissive than the truth — but the number is wrong and someone will one day size a decision off it |

`globals.css`'s own `--void-deep` ledger, in the `.a11y-alt-table caption` comment, re-computed
and correct on every value: `--faint` **5.03:1**, `--dim` **8.89:1**, `--ink` **15.45:1**,
`--given` **10.21:1**, `--inferred` **8.43:1** (and `--derived` **10.01:1**).

- [x] **Body contrast ≥ 4.5:1 on both stages; verified, not eyeballed** — **1 FAIL, 118 PASS
  before the fix; 119 PASS, 0 FAIL after it.** The table below is the *before* state, because a
  fix without the failure it answers is not evidence of anything.

Every element that paints its own text, at stage 0 (scan) and stage 5 (daylight), in four
chrome states each: default, description open, corrections panel open, sources open. The
ground is the real composited pixel behind the glyph run, read back from a screenshot with
that element's text set to `transparent`.

| Group | PASS | FAIL | N/A (screen-reader-only) |
|---|---|---|---|
| stage 0, default chrome | 15 | 1 | 20 |
| stage 0, description open | 23 | 1 | 20 |
| stage 0, corrections panel open | 35 | 1 | 20 |
| stage 0, sources open | 25 | 1 | 20 |
| stage 5, default chrome | 25 | 0 | 21 |
| stage 5, description open | 31 | 0 | 21 |
| stage 5, corrections panel open | 46 | 0 | 21 |
| stage 5, sources open | 35 | 0 | 21 |

**The one failure — `.hud-num`, the stage-number chip in the HUD, at stage 0.**
11 px / weight 400, `color: var(--mark)` #e4526f. Ground read back over the glyph's own
7 × 14 px rect at (610, 485): mean `rgb(6,22,41)`, 95th percentile `rgb(19,39,59)`.
**4.97:1 against the mean and 4.15:1 against the p95 — under the 4.5 floor.**
The p95 is the point: `--chip-scan` is `rgba(4,20,38,0.82)`, so 18 % of the globe behind it
comes through, and the brightest pixels of Earth's limb land under a mid-luminance crimson
glyph. The same element at stage 5 reads 4.80:1, because the room behind it is dimmer there
than the globe is — so this is a stage-0 failure specifically, and it is a failure that moves
with the frame.

MASTER.md predicted it in its own ledger: `--mark` on `--void` is ~4:1 and is marked
**"large text and graphics only — never body"**. 11 px at weight 400 is body by MASTER's own
definition (`< 18px and not bold`). Fixed in CSS — see *Fixes made* below.

**The lowest passing readings**, for the record, since a floor is only meaningful with the
next rung shown: `.hud-num` at stage 5 4.80:1; `Panel:legend` "Placement, and who sleeps here"
4.77:1; `Panel:hint` at 5.03:1; the HUD's stage buttons 7.46–8.34:1; `.sources-body` prose
13.29–15.30:1; `.a11y-alt-panel` prose 15.45:1 and its `<h2>` 18.53:1.

### Two things the first pass got wrong, recorded so nobody re-measures them

Both were measurement artefacts, and both looked exactly like defects:

1. **`<label class="hud-t">` "hour" read 1.76:1.** The label *wraps its own
   `<input type="range">`, and the input's `accent-color: var(--mark)` painted crimson into
   what was being called "the ground behind the word hour". Sampling the union of the
   element's own text-node client rects instead of its box gives **7.28:1**.
2. **Six stage buttons read 1.35–2.09:1 at stage 5.** Rects enumerated once and screenshotted
   thirty shots later. Re-reading the rect immediately before each shot, and sampling the same
   rect ten times a second apart, gives a stable **7.18–7.28:1** (composited ground
   `rgb(23,39,56)`; raw canvas under the HUD `rgb(108,112,114)`, ten identical samples).

- [x] **Text over the void always sits on `--chip-scan`, never directly on the gradient**
  (MASTER §Accessibility gates) — **PASS.** Walking every text-bearing element's ancestor
  chain to the first one painting a background, at all six stages: the grounds in use are
  `rgba(4,20,38,0.82)` = `--chip-scan` (on `.hud`, `.hud.hud-room`, `.sources`, `.weld-chip`,
  `.skip`) and `rgb(4,20,38)` = `--void-deep` (on `.a11y-alt-panel`, `.a11y-alt-toggle`,
  `Panel:panel`, `Panel:toggle`).
  **Exactly two elements resolve all the way to `<body>`** — `body`'s own `rgb(6,32,63)`,
  which is `--void`: `SPAN.a11y-alt-sr` and `Panel:sr`. Both are the clipped
  `clip-path: inset(50%)` screen-reader live regions, which paint no glyphs at all, so
  neither is text on the gradient. No visible text was found without its own chip.

---

## Overrides applied (MASTER.md §Overrides applied)

- [x] **Type is IBM Plex Mono + Libre Baskerville, not the DB's Fira pair** — **PASS.**
  `document.fonts` after `fonts.ready` reports `IBM Plex Mono 400 loaded`,
  `IBM Plex Mono 500 loaded`, `Libre Baskerville 400 loaded`, and both `Fallback` faces
  declared. Every text element in the app resolves to one of exactly two families:
  `IBM Plex Mono` or `Libre Baskerville`. `body` computes to
  `"Libre Baskerville", "Libre Baskerville Fallback", "Iowan Old Style", Palatino, Georgia, serif`.
  No `Fira` anywhere.
- [ ] **Self-hosted, no CDN request** — **NOT CHECKED HERE.** The two families resolve and
  render, which is measured above, but whether the face bytes come from this origin is a
  network claim and I did not record the request log. `tests/e2e/smoke.spec.ts`'s "applies the
  design tokens and the self-hosted fonts" is the gate that owns it and it passes. Left
  unticked rather than ticked on someone else's evidence. (`__nextjs-Geist` also appears in
  `document.fonts` — that is Next's dev-overlay font, present only under `next dev`.)
- [x] **The DB's run-green CTA `#22C55E` is not used** — **PASS.** The computed `:root`
  carries no green: the accent tokens are `--mark #e4526f` and `--crimson #a41034`, and the
  only greenish value in the whole token set is `--given #7fd1a6`, a provenance tint.
- [x] **Pattern requirements kept: skip control, mobile fallback, CTA after interaction** —
  **PASS** on the first two, measured below. The mobile fallback is `DesktopOnly`, whose gate
  is `(pointer: coarse)` **and** a small viewport, both required — so a 375 px-wide desktop
  window correctly gets the app, not the message.

## Two stages, two palettes (MASTER.md §Two stages, two palettes)

- [x] **Every token in MASTER's two palettes exists and matches** — **PASS**, read out of the
  browser's computed `:root`, all 20 exact:
  `--void #06203f`, `--void-deep #041426`, `--grid #0c3260`, `--line #8fc4f2`,
  `--line-hi #fff`, `--mass #96c8f51a` (= `rgba(150,200,245,0.10)`), `--mark #e4526f`,
  `--ink-scan #e4ebf6`; `--sky #d9e2ec`, `--plaster #f0ede7`, `--plaster-sh #dfdad1`,
  `--oak #b5813f`, `--oak-deep #a5732f`, `--crimson #a41034`, `--glass #cfe4f2`,
  `--edge #8c8578`, `--ink-day #0a1626`; `--chip-scan #041426d1` (alpha 209/255 = 0.820),
  `--chip-day #ffffffdb` (alpha 219/255 = 0.859), `--focus #5ea6eb`.
- [x] **The two palettes are not blended** — **PASS.** At stage 0 the raw canvas behind the
  HUD reads `rgb(4,20,38)`-family; at stage 5 the same rect reads `rgb(108,112,114)`, ten
  identical samples a second apart. Two grounds, one crossing, no intermediate mixing state
  left on screen.
- [ ] **`--chip-day` is declared and painted on nothing** — **FAIL (dead token).** MASTER
  lists `--chip-day` under "Chrome (must read on both stages)". Scanning every element's
  computed `background-color` at stages 0 and 5, in all four chrome states, found **zero**
  elements painting `rgba(255,255,255,0.86)`. Every chrome surface uses `--chip-scan` or the
  opaque `--void-deep` on both grounds. Not a rendering defect — the measured stage-5
  contrast passes on `--chip-scan` — but the token is unreachable and MASTER implies it is
  the daylight half of a pair. Owner's call: either paint it at stage 5 or strike it from
  MASTER. See *Findings handed over*.
- [x] **`--focus` is the ring actually painted** — **PASS.** Every focus stop measured
  `outline: solid 2px rgb(94, 166, 235)` with `outline-offset: 2px`, which is `#5ea6eb` and
  MASTER's "2px ring, 2px offset" exactly.

## Typography (MASTER.md §Typography)

- [x] **`tabular-nums` wherever digits align** — **PASS.** `font-variant-numeric: tabular-nums`
  computes on `.tabular` (the sun time and the area readout), on `.hud-orbit-read`'s row and
  on `.a11y-alt-table`. The rooms table's numeric columns are tabular.
- [ ] **Line height 1.5–1.75 body** — **FAIL, 26 elements, all in one file.**
  `body` computes 25.6px / 16px = **1.600**. `globals.css`'s own prose is in band:
  `.sources-body` 1.55, `.gate-prose` 1.55, `.a11y-alt-panel p/li` 1.55.
  `src/ui/Panel.module.css` is not: `.hint`, `.chipSource` and `.chipWord` all compute
  **1.45** (12px/17.4px and 10px/14.5px). Below the 1.5 floor on 26 rendered elements.
  Not my file. See *Findings handed over*.
- [x] **Line length capped 65–75ch** — **was 1 FAIL, now fixed.** Measured against each
  element's own font advance width. Everything in the app is ≤ 41.3ch except
  `.a11y-alt-table caption`, which ran to a single **128ch** line because its containing block
  is a 1218 px-wide table inside a horizontal scroller and nothing capped it. Fixed in CSS —
  now three lines of 51ch, 51ch and 24ch, all of them inside the scroller's visible 385 px
  column rather than merely under the ch cap. Next widest: 41.3ch (`.a11y-alt-panel p`), 41.2ch
  (`.a11y-alt-foot`), 37ch (a table cell).
- [x] **Minimum 16 px body on mobile** — **PASS where it applies.** `body` is exactly 16px.
  The gate's `.gate-prose` is 1rem with no clamp. The chrome's own labels are 10–13px, which
  is the product-UI register MASTER asks for and not "body on mobile" — and mobile is cut.
  The smallest rendered type in the app is 10px (`Panel:chipWord`, the provenance words
  `GIVEN` / `DERIVED` / `INFERRED`); flagged below, not as a MASTER violation.
- [x] **Display ceiling: clamp max ≤ 6rem** — **PASS.** The largest `font-size` on any
  element that paints text, anywhere in the app, is **16 px = 1.0 rem**. The one clamp in the
  stylesheet is `.gate-title`'s `clamp(1.375rem, 4.5vw, 1.875rem)`, ceiling 1.875rem.
- [x] **Letter-spacing floor ≥ -0.04em** — **PASS.** Tightest measured is **-0.01em**
  (`.hud-stage` and `.gate-title`, both -0.15px at 15px and 16px). Nothing is negative-tracked
  beyond that.

## Motion (MASTER.md §Motion)

- [x] **Micro-interactions 180–260 ms, `ease-out-quint`** — **PASS.** Every transition in the
  app computes **200 ms** with `cubic-bezier(0.22, 1, 0.36, 1)`. Counted across all six
  stages and four chrome states: 17 distinct transition declarations, all 200 ms, all that
  curve. `--dur-micro` is `.2s` and `--ease-out-quint` is `cubic-bezier(.22, 1, .36, 1)`.
- [x] **No bounce, no elastic, no linear** — **PASS.** No `linear`, no overshooting curve
  (both control-point y values ≤ 1) appears on any computed `transition-timing-function`.
- [x] **Stage transitions 900–1400 ms** — **PASS on the token**, `--dur-stage: 1.1s`. The
  camera's own settling time could not be resolved independently: screenshotting under
  SwiftShader costs 400–800 ms per frame here, which is coarser than the interval being
  measured. What *was* resolved is the difference between full and reduced motion, below.
- [x] **Animate `transform` / `opacity` only; never width, height, top, left** — **PASS.**
  The transitioned properties in the whole app are exactly `transform` (`.skip`),
  `color` and `border-color` (every button). No `width`, `height`, `top`, `left`, `margin`
  or `padding` is transitioned anywhere.
- [x] **Animate 1–2 elements per view maximum** — **PASS.** `animation-name` is `none` on
  every element in the document at every stage: there are **zero** CSS keyframe animations.
  The only continuous motion is in the 3D scene (Weld's mass pulse), measured below.
- [x] **`prefers-reduced-motion: reduce` → jump-cut, not nothing** — **PASS, measured in
  rendered pixels.** A stage 0 → 3 change, sampled as frames and compared pixel-to-pixel:

  | | frames changing > 1.5 % | first change | last change | window |
  |---|---|---|---|---|
  | no-preference | 9 | 2124 ms | 18806 ms | 16.7 s |
  | reduce | **1** | 881 ms | 881 ms | **0 ms** |

  Under `reduce` exactly one frame changes — by 83.4 % of sampled pixels — and every one of
  the following 24 samples changes by **0.00 %**. That is a jump-cut: the picture arrives at
  the destination in a single step and then holds perfectly still. Under no-preference the
  same 80-odd-percent change happens once and is then followed by a tail of 1.6–2.8 % changes
  continuing for 20 seconds, which is the continuous scene animation.
  `matchMedia("(prefers-reduced-motion: reduce)")` is `true`, the store publishes
  `reducedMotion: true`, and `window.__cam.reduced` is `true` — so the preference reaches the
  camera and not only the stylesheet.
- [x] **The alternative is real, not an absence** — **PASS.** Three separate alternatives,
  each measured: (1) the camera still arrives — the frame changed by 83 % and the store
  reached stage 3, it just did not fly; (2) every CSS transition collapses to `1e-05s` rather
  than being removed, so hover and the skip link still complete, instantly — the skip control
  measured at y 14 and in the viewport 400 ms after Tab under `reduce`, same as under full
  motion; (3) Weld's pulse is held rather than dropped, which is what the flat 0.00 % series
  shows. **Not verified:** MASTER's specific "120 ms crossfade". At 400–800 ms per screenshot
  under SwiftShader that interval is below this method's resolution. The jump-cut is measured;
  the crossfade's duration is not, and I am not going to assert it.

## Accessibility gates (MASTER.md §Accessibility gates)

- [x] **Campus strokes ≥ 1.5 px at 1× DPR, multiplied by `devicePixelRatio`** — **PASS**,
  measured in rendered pixels rather than read off a prop. Every scanline of the canvas is
  walked, each run of pixels brighter than that row's 20th-percentile ground is found, and its
  width taken at half maximum (a 1.5 px camera-facing quad lands on two or three physical
  pixels with the outer ones part-covered, so counting every tinted pixel would overstate it):

  | | strokes found | min | p25 | median | p75 | max |
  |---|---|---|---|---|---|---|
  | DPR 1, stage 2 (Yard) | 2733 | 1 | 2 | **2** | 4 | 12 |
  | DPR 1, stage 3 (Weld Hall) | 6372 | 1 | 2 | **2** | 2 | 12 |
  | DPR 2, stage 2 | 3149 | 1 | 6 | **7** | 9 | 12 |
  | DPR 2, stage 3 | 9798 | 1 | 6 | **6** | 7 | 12 |

  (device pixels; the DPR-2 image is 2000 × 1120 for a 1000 × 560 CSS-pixel clip.)

  Two things follow. **The histogram is not the platform cap.** `gl.lineWidth` is hard-capped
  at 1 px on every WebGL platform and silently ignored above it, so a scene drawing lines that
  way would show a flat histogram pinned at 1. This one has its mode at 2 with **90.8 %** of
  strokes ≥ 2 px at stage 2 and 79.2 % at stage 3 — these are `LineSegments2` quads, as
  `Campus.tsx` claims. **And they scale with DPR:** doubling `deviceScaleFactor` moves the
  mode from 2 to 6 and puts **98.7 %** / **99.1 %** of strokes at ≥ 3 device px, so the
  `× devicePixelRatio` term is doing real work.

  *Method limit, stated:* `Effects.tsx` runs a bloom pass, which spreads bright pixels, so
  each absolute figure is an upper bound on the geometric stroke width. What the method
  establishes reliably is the shape of the distribution and its response to DPR, and both say
  the floor is honoured. The 1 px tail is consistent with a 1.5 px stroke crossing a scanline
  at an oblique angle — half-maximum on an antialiased diagonal cannot distinguish 1.0 from
  1.5 px, and I am not going to claim it can.

- [x] **The same floor, verified in P4's exterior** — **N/A, and this is the answer the plan
  asked for.** The exterior draws **no line work at all**: `WeldExterior.tsx` renders four
  solid meshes (walls, roof, towers, bays) with `materials()`' BRICK and SLATE, and contains
  no `<Line>`, no `LineSegments` and no `EdgesGeometry`. `window.__perf.lines` reads **122**
  at both stage 2 and stage 3 — the same count, i.e. Campus's lines, unchanged by the
  exterior arriving — and **0** at stage 4, where `triangles` drops to 433. So there is no
  exterior stroke to hold to 1.5 px; the strokes on screen at stage 3 are Campus's, and they
  are the ones measured above. The exterior's edges are read as material and silhouette
  instead, which sidesteps the thin-line-on-dark risk rather than failing it.
  **Re-take this after the scene owners land:** `WeldExterior.tsx`, `Threshold.tsx` and
  `weldGeometry.ts` were being edited throughout this audit, and stage 4's 433 triangles with
  0 lines is a figure I would not ship a conclusion on.

- [x] **Weld is never distinguished by hue alone — hue *plus* a label chip *plus* a pulse** —
  **PASS, all three measured.** *Hue and width:* `Campus.tsx` gives Weld's edges
  `2.2 × dpr` against `1.5 × dpr` for every other building and `--line-hi` #ffffff against
  `--line` #8fc4f2, and the measured stroke distribution at stage 2 has a tail out to 12 px
  where the bulk is at 2. *Chip:* `.weld-chip` is present in the DOM at stages 2, 3, 4 and 5
  reading "Weld Hall", on `rgba(4,20,38,0.82)` with a `rgb(228,82,111)` border — and absent at
  stages 0 and 1, where the building is not on screen. *Pulse:* the frame-to-frame diff shows
  a continuous 1.6–2.8 % of pixels changing for 20 s after the camera settles at stage 3, and
  **0.00 % on every sample** under `prefers-reduced-motion: reduce`, where `Campus.tsx` holds
  the mass opacity at 0.34 instead of animating it. Three signals, two of them not colour.

- [ ] **High-contrast toggle: thickens strokes to 2.5 px, raises `--mass` opacity to 0.22** —
  **FAIL, not implemented.** No control anywhere in the app carries "contrast" in its text,
  `aria-label` or `data-testid`, at any stage, in any chrome state. Scanning every `<button>`
  and `<input>` in the document returns an empty list. Not CSS-fixable — it needs a control
  plus a store flag plus the two scene values. See *Findings handed over*.

- [x] **Semantic HTML before ARIA. `<button>`, never `<div role="button">`** — **PASS.**
  Querying every element carrying `role="button"`, `role="link"`, `role="checkbox"`,
  `role="radio"`, `role="tab"` or an `onclick` attribute and keeping the ones that are not a
  real control element returns **zero**. The six `role="radio"` nodes in the app (four cutaway
  modes, two facades) are all `<button>` elements inside a `role="radiogroup"` labelled
  "Cutaway mode", which is ARIA layered onto semantics rather than replacing them.

- [x] **Every canvas interaction has a keyboard equivalent** — **PASS.** Driven from the
  keyboard against the real model, with the published state as the witness:
  - *Orbit* (stage 3): six `<button>`s, `orbit-left` / `-right` / `-up` / `-down` / `-in` /
    `-out`, each 44 × 44 with a focus ring, all reachable by Tab in the HUD.
  - *Walk* (stage 5): `fp-enter` plus six `fp-go-*` room buttons, all 44 high.
  - *Threshold* (stage 4): `threshold-t`, a real `<input type="range">`.
  - *Edit* (stage 5): selected `common1-table-0` by clicking in the room, then pressed
    ArrowLeft, ArrowUp and `r` with nothing focused. All three changed the published model
    state (`window.__weld.q` went `…IgCAiI3` → `…IgCAqmk` → `…IgCAhKA` → `…IgCAhzl`), so
    arrows nudge and `r` rotates, as MASTER specifies. The Panel's `nudge-*` and `rotate`
    buttons are the same code path by mouse.
  - *Stage* : the six `stage-N` buttons, all 44 × 44, all with a ring.
- [ ] **…specifically `[` / `]` change stage** — **FAIL.** Pressed `BracketLeft` then
  `BracketRight` with nothing focused: `window.__weld.stage` stayed **5 → 5 → 5**. No handler
  for either key exists anywhere in `src/`. The *requirement above it* is met — the six stage
  buttons are keyboard-operable — so this is a missing shortcut rather than an unreachable
  interaction. Not CSS. See *Findings handed over*.

- [x] **`:focus-visible` ring on everything focusable. Never `outline: none` without a
  replacement** — **PASS, on every stop.** Tabbed through the whole document at stages 0, 2,
  3, 4 and 5, in default / description-open / panel-open states, reading the computed outline
  off `document.activeElement` at each stop. **Every one of the 42 distinct stops** measured
  `outline-style: solid`, `outline-width: 2px`, `outline-color: rgb(94, 166, 235)`,
  `outline-offset: 2px`. Not one `outline: none`. The stops covered: `skip`,
  `a11y-alt-toggle`, `a11y-alt-scroll`, `a11y-alt-close`, `stage-0`…`stage-5`,
  `orbit-left`…`orbit-out`, `threshold-t`, `fp-enter`, `fp-go-hall`…`fp-go-bedB`, `sun-date`,
  `sun-hour`, `sources-toggle`, `sources-body`, `panel-toggle`, `refit`, `copy-link`,
  `reset-all`, `cutaway-none`, `facade-east`, `wing-step`, and Panel's `.track` sliders.

- [ ] **Tab order matching visual order** — **FAIL, one stop out of twelve.** The measured
  order at stage 0, with each stop's box:

  | # | stop | box (x, y) |
  |---|---|---|
  | 1 | `skip` | 14, 14 *(when focused)* |
  | 2 | `a11y-alt-toggle` | 14, 66 |
  | 3–8 | `stage-0` … `stage-5` | 496–784, 512 |
  | 9 | `sun-date` | 570, 565 |
  | 10 | `sun-hour` | 548, 620 |
  | 11 | `sources-toggle` | 15, 661 |
  | 12 | **`panel-toggle`** | **898, 14** |

  Eleven of twelve walk top-to-bottom. `panel-toggle` sits at **y 14** — the topmost control
  on screen, top-right — and is reached **last**, after a control at y 661. Reading order puts
  it second or third. It is a mismatch, not a trap: the control is reachable, labelled
  ("Correct a dimension"), and has a ring. Fixing it means moving `<Panel>` ahead of `<Hud>`
  in `Experience.tsx`, which is mount order, not CSS, and it interacts with the deliberate
  choice that `skip` is first and `a11y-alt-toggle` second — both of which
  `tests/e2e/a11y.spec.ts` asserts on purpose. Handed over rather than guessed at.

- [x] **Canvas carries a text alternative describing the current stage and room** — **PASS,
  read off the `<canvas>` element itself**, which is the exact thing that was absent before:
  `role="img"`, and `aria-label` = *"Three-dimensional descent from orbit to the interior of
  Weld 15. The suite is shown closed, as built."* The second sentence is the live cutaway
  mode and it changes with it (all four verified below). The parent container carries no
  competing role or label. Beyond the name, the written description is a real live region:
  `role="status"`, `aria-live="polite"`, `aria-atomic="true"`, its text changes for all six
  stages, it names "Bedroom B" at stage 5, and 40 slider events over a second produce **1**
  announcement rather than 40.

- [x] **Touch targets ≥ 44 × 44 px** — **was 1 FAIL, now fixed.** Every focusable element
  measured at stages 0, 2, 3, 4 and 5 in every chrome state. All 44 × 44 or larger except
  `[data-testid="threshold-t"]` at stage 4, which measured **176 × 16**. Fixed in CSS — now
  176 × 44. The only remaining sub-44 boxes are `0 × 0`: the corrections panel's controls
  while the panel is collapsed, which are not rendered.
  (`a11y-alt-scroll` also measured 385 × **0** — the same defect as the flexbox crush below,
  and the same fix; it is now 385 × 301.)

## Z-index scale (MASTER.md §Z-index scale)

- [x] **Semantic only. No arbitrary values, no 999** — **PASS.** Every element in the document
  with a computed `z-index` other than `auto`, at all six stages: `.vignette` **0**,
  `.hud` **10**, `.hud.hud-room` **10**, `.sources` **10**, one `<div>` **10** (drei's `Html`
  wrapper for the Weld chip), `.a11y-alt-dock` **20**, `Panel:dock` **20**, `.skip` **60**.
  Eight elements, four values, and all four — 0, 10, 20, 60 — are tokens from the scale
  (`--z-canvas`, `--z-hud`, `--z-panel`, `--z-toast`). All eight tokens are declared with
  MASTER's exact values: 0 · 10 · 20 · 30 · 40 · 50 · 60 · 70. No literal, no 999.

## Breakpoints (MASTER.md §Breakpoints)

- [x] **No horizontal body scroll at 375 · 768 · 1024 · 1440** — **PASS at all four.**
  `documentElement.scrollWidth` equals `clientWidth` at every width: 375/375, 768/768,
  1024/1024, 1280/1280, 1440/1440. Worth noting *what was measured at 375*: the desktop gate
  requires `(pointer: coarse)` **and** a small viewport, both, so a 375 px-wide desktop window
  gets the **full app** — canvas mounted, 44 focusables — not the gate. That is the harder
  case and it still does not scroll sideways.
- [x] **Wide content scrolls inside its own `overflow-x: auto`** — **PASS.** The one element
  wider than its container is `.a11y-alt-scroll`, holding the eight-column rooms table:
  `scrollWidth` **1218** against `clientWidth` **385**, `overflow-x: auto`, and `tabindex="0"`
  so a keyboard can reach it. `document.body` is `overflow: hidden` throughout, as the canvas
  requires, so anything not in its own scroller would be clipped — and nothing is.

## Icons (MASTER.md §Icons)

- [ ] **SVG only, one set (Lucide), fixed 24 × 24 viewBox** — **FAIL.** The app contains
  **zero** `<svg>` elements at any stage in any chrome state. There is no Lucide, and no icon
  set at all.
- [x] **No emoji as UI icons** — **PASS.** Scanning every text node for emoji and dingbat
  ranges returns four hits, all of them the arrow glyphs on Panel's nudge buttons:
  `←` `→` `↑` `↓` (U+2190–2193). Those are arrow characters, not emoji — no emoji presentation
  selector, no `U+FE0F`, rendered as text in the button's own font at 16px — and each button
  carries a full `aria-label` ("Move outward, toward the window wall", "Move north, toward the
  gable", …) so nothing depends on reading the glyph. MASTER's ban is on emoji and it is
  honoured; MASTER's *positive* requirement of Lucide SVG is the row above, and those four
  arrows are the only place an icon set would land. See *Findings handed over*.

## Anti-patterns for this project (MASTER.md §Anti-patterns)

- [x] **Gradient text / `background-clip: text` — banned** — **PASS.** Computed
  `background-clip` and `-webkit-background-clip` on every element at every stage: **zero**
  elements resolve to `text`.
- [x] **Glassmorphism as decoration; the only blur allowed is depth-of-field in the scene** —
  **PASS.** Computed `backdrop-filter` on every element: **zero** non-`none` values. The
  chrome's translucency is flat alpha (`--chip-scan` at 0.82) with no blur behind it.
- [x] **Side-stripe accent borders on panels — banned** — **PASS.** Scanning for any element
  with `border-left-width` ≥ 2 px and its other three sides at 0 returns **zero**. Every
  border in the app is a full 1 px box (`--rule`, `--mark`, `--line`, or a provenance tint) or
  a single **top** rule: `.sources-gap` and `Panel:group`'s `border-top: 1px`. The one place
  the project deliberately marks a division uses a top rule, exactly as `globals.css` records.
- [x] **Uppercase tracked eyebrows above every section — banned** — **PASS**, and this one is
  a judgement so here is the measurement it rests on. Thirteen elements compute
  `text-transform: uppercase` with tracking over 0.05em: `.sources`' `<summary>` "Sources"
  (0.14em), six `Panel:legend` `<legend>`s (0.12em), five `<h3>`s in the written description
  (0.12em), and `.weld-chip` "Weld Hall" (0.16em). **None of them is an eyebrow.** An eyebrow
  is a decorative label stacked *above* a real heading, duplicating its job; every one of
  these thirteen *is* the heading or the control's own face — a `<summary>` labelling its
  disclosure, a `<legend>` labelling its `<fieldset>`, an `<h3>` in the heading tree, a map
  label MASTER itself requires. No element was found sitting above another heading and saying
  the same thing.
- [x] **Numbered section markers unless the content is genuinely a sequence** — **PASS.** The
  only numbers used as markers in the app are `.hud-num` (the current stage's number) and the
  six stage buttons' digits `0`–`5`. That is the stage scrubber, which MASTER explicitly
  permits to number its stops. No other section carries a number.
- [x] **Identical card grids** — **PASS / not present.** There is no card grid: no element in
  the document computes `display: grid`, and the app's layout is three fixed chrome panels
  plus a canvas.
- [x] **Cream/sand body background (`#F4F1EA` family) — banned** — **PASS.** `body`'s
  computed `background-color` is `rgb(6, 32, 63)` = `--void`, at every stage including
  stage 5. Plaster appears only as a material on geometry inside the canvas — the raw canvas
  under the HUD at stage 5 reads `rgb(108,112,114)` while the page background stays `--void`.

---

## Delivery checklist (MASTER.md §Delivery checklist) — the thirteen boxes, ticked

- [ ] **No emoji icons; Lucide SVG throughout** — *split.* No emoji: **PASS** (four arrow
  characters, all `aria-label`led). Lucide SVG throughout: **FAIL**, zero `<svg>` in the app.
- [x] **`cursor-pointer` on every clickable element** — **was 18 FAIL, now fixed.** Every
  `<button>` and `<summary>` already computed `pointer`. Every `<input>` computed **`default`**:
  `sun-date`, `sun-hour`, `threshold-t` and Panel's fifteen `.track` sliders. Fixed in CSS —
  all 18 now compute `pointer`.
- [x] **Hover feedback with no layout shift (color/opacity, not scale)** — **PASS, measured on
  the box.** Hovered `stage-2`, `a11y-alt-toggle`, `panel-toggle` and `sources-toggle`, reading
  the bounding box to two decimal places before and 400 ms after:

  | control | box before | box after | what changed |
  |---|---|---|---|
  | `stage-2` | 593.60, 512.23, 44, 44 | *identical* | `color`, `border-color` |
  | `a11y-alt-toggle` | 14, 66, 252.2, 44 | *identical* | `color`, `border-color` |
  | `panel-toggle` | 898, 14, 368, 44 | *identical* | `color` |
  | `sources-toggle` | 15, 661, 79.36, 44 | *identical* | `color`, `border-color` |

  Zero movement on all four; `transform` stayed `none` on every one. No scale, no reflow.
- [x] **Transitions 150–300 ms** — **PASS.** All 17 transition declarations in the app compute
  **200 ms**. Nothing outside the band, nothing at 0 that should animate.
- [x] **Visible `:focus-visible` on all interactive elements** — **PASS.** 42 distinct tab
  stops, all `solid 2px rgb(94,166,235)` at `2px` offset. Detail in §Accessibility gates.
- [x] **Body contrast ≥ 4.5:1 on both stages; verified, not eyeballed** — **was 1 FAIL, now
  fixed.** 119 measured elements, one below the floor, fixed in CSS. Detail at the top.
- [x] **Borders visible in both stages** — **PASS.** Every border in the app is ≥ 1 px and
  drawn in one of five palette values, each measured against the ground it sits on:
  `--rule` #1d4470 on `--void-deep` **1.86:1**; `--rule-soft` #143252 on `--void-deep`
  **1.42:1**; `--mark` #e4526f **5.06:1**; `--line` #8fc4f2 **10.01:1**; the provenance tints
  `--given` **10.21:1** and `--inferred` **8.43:1**. The two structural greys are below the
  3:1 that WCAG asks of a *meaningful* graphic — but they are not meaningful graphics: they are
  the container edges of panels that are already separated from the canvas by an opaque or
  0.82-alpha ground, and every state a border *carries* meaning for is drawn in `--mark` at
  5.06:1 (the active stage button, the active cutaway radio, the active facade) or `--line` at
  10.01:1 (hover). No state is signalled by a border a reader cannot see. Visible in both
  stages: the same 1 px boxes are present and measured at stage 0 and stage 5, and the panel
  grounds they sit on are the same on both (opaque `--void-deep`, or `--chip-scan` composited
  to `rgb(6,22,41)` at stage 0 and `rgb(23,39,56)` at stage 5).
- [x] **Responsive at 375 / 768 / 1024 / 1440** — **PASS on the one property that survives the
  desktop-only decision:** no horizontal scroll at any of the four, measured. Mobile is cut by
  project decision, so no breakpoint work was done or attempted; the 375 measurement is of the
  full app, because the gate needs a coarse pointer as well as a small viewport.
- [x] **No horizontal scroll on mobile** — **PASS.** 375 px: `scrollWidth` 375 =
  `clientWidth` 375. 768 px: 768 = 768.
- [x] **Canvas has a text alternative** — **PASS.** `role="img"` and a live `aria-label` on the
  `<canvas>` element itself, plus a `role="status"` live region carrying the full description.
- [x] **All form inputs labelled** — **PASS, all 18.** `sun-date` and `sun-hour` by
  `aria-label` *and* an ancestor `<label>`; the sixteen Panel sliders by `label[for=…]` against
  a real `id` (`in-occupancy`, `in-sectionLength`, `in-legDepth`, `in-hallWidth`, `in-bedDepth`,
  `in-commonAlong`, `in-commonDeep`, `in-bedAAlong`, `in-bedBAlong`, `in-bathAlong`,
  `in-bathDeep`, `in-kDeep`, `in-kAlong`, `in-partition`, `in-masonry`, `in-ceiling`);
  `threshold-t` by `aria-label`. Zero unlabelled inputs, and axe agrees at all six stages.
- [x] **Color never the sole indicator** — **PASS, and the cutaway table is the proof.** All
  four modes driven in the browser, reading every call site:

  | | `none` | `roofOff` | `wallsDown` | `section` |
  |---|---|---|---|---|
  | button face (rendered text) | `none` | `roof off` | `walls down` | `section` |
  | `aria-checked` on the active one | true | true | true | true |
  | the other three | false | false | false | false |
  | `font-weight` active / inactive | 600 / 400 | 600 / 400 | 600 / 400 | 600 / 400 |
  | `border-color` active / inactive | `--mark` / `--rule` | same | same | same |
  | visible hint | = `CUTAWAY_WORDS.brief` | ✓ | ✓ | ✓ |
  | `cutaway-live` region | "Cutaway *word*. *brief*" | ✓ | ✓ | ✓ |
  | `<canvas aria-label>` tail | = `CUTAWAY_WORDS.alt` | ✓ | ✓ | ✓ |
  | written description ¶ | = `CUTAWAY_WORDS.prose` | ✓ | ✓ | ✓ |

  All six `role="radio"` nodes sit in a `role="radiogroup"` labelled "Cutaway mode" with a
  roving `tabindex`. So the active mode is recoverable from the rendered **word**, from
  **weight**, from **`aria-checked`**, from a **visible sentence**, from a **live region** and
  from the **canvas's own name** — five of the six being nothing to do with colour. Every
  string matches `src/scene/cutaway.ts`'s `CUTAWAY_WORDS` exactly at all three call sites, so
  the one-table refactor at `459ebba` holds in the rendered output and not only in the imports.
  Weld's highlight (three signals) and the provenance chips (word + border + tint) are measured
  in §Accessibility gates and §Anti-patterns.
- [x] **`prefers-reduced-motion` honored** — **PASS.** One frame changes, then 0.00 % for 24
  samples. Detail in §Motion.
- [x] **Skip control on the intro sequence, reachable by keyboard on first tab** — **PASS,
  and it actually appears.** From a blurred document the **first** Tab lands on
  `[data-testid="skip"]`; `el.matches(":focus-visible")` is `true` immediately;
  `transform` runs from `translateY(-88px)` (box at y **−74**, outside the viewport, which is
  the point of a skip link) to `translateY(0)` (box at y **14**, `inViewport: true`) over the
  200 ms transition. Under `prefers-reduced-motion: reduce` it is at y **14** at t+400 ms just
  the same. Pressing Enter took `window.__weld.stage` from **0 → 5**, so it skips to the room
  rather than merely looking like it would.

---

## Fixes made, in `app/globals.css`

All five are appended as one attributed block under `/* ---------- P8 the MASTER.md checklist
pass ---------- */`. Nothing above that comment was touched — in particular the two measured
layout attributions (`.hud.hud-room`'s anchors at y 589–716 against a HUD at 467–706, and
`.sources`' 30rem cap) and `.sources-gap`'s deliberate top rule are all intact. No side-stripe
border was introduced.

| # | Rule | Box it fixes | Before | After |
|---|---|---|---|---|
| 1 | `.hud-num { background: var(--void-deep) }` | body contrast ≥ 4.5:1 | 4.97:1 mean / **4.15:1** p95 at stage 0; 4.80:1 at stage 5 — a ratio that moved with the frame | **5.06:1** flat, all four chrome states, both stages, ground `rgb(4,20,38)` with p05 = p95 = mean |
| 2 | `.hud-t input { min-height: 44px }` | touch targets ≥ 44 × 44 | `threshold-t` **176 × 16** | **176 × 44** |
| 3 | `input[type=range], input[type=date] { cursor: pointer }` | `cursor-pointer` on every clickable | `default` on **18** inputs | `pointer` on all 18 |
| 4 | `.a11y-alt-scroll { flex: none }` | the rooms table rendered at all | `clientHeight` **0** at 1280×720, 1440×900, 1440×1200 and 1024×768, with `scrollHeight` 281 and the first row laid out at y 869.9 outside it | `clientHeight` **320**, seven rows inside the box, tab stop 385 × 320 |
| 5 | `.a11y-alt-table caption { max-width: 24rem; white-space: normal; position: sticky; left: 0 }` | line length ≤ 75ch | one line of **128ch**, clipped by the scroller | three lines of **51ch / 51ch / 24ch**, all inside the scroller's 385 px column, and still at its left edge with `scrollLeft` driven to 600 |

**Fix 5 took two passes, and the first one is worth recording.** Capping the caption at `68ch`
did satisfy MASTER's 65–75ch box — two lines of 63ch and 64ch. But 68ch of this caption's IBM
Plex Mono measures ~490 px and the scroller's visible column is **385**, so both compliant lines
were clipped and you had to scroll the table sideways to finish reading the instructions for how
to read the table. A box ticked and the reader no better off. The cap is now `24rem` — the width
the column actually has, `.a11y-alt-dock`'s 26rem less `.a11y-alt-panel`'s 0.9rem of padding
each side, measured at 384 px against the scroller's 385 — plus `position: sticky; left: 0`,
because the caption lives *inside* the horizontal scroller and would otherwise slide out of
frame with the columns it explains.

### Fix 1, and axe

An incidental, measured improvement: axe-core's `color-contrast` **incomplete** node count
dropped from **14 to 13**, and the node that left is `.hud-num`. Its message had been
*"Element's background color could not be determined due to a background gradient"* — the
opaque ground means axe can now resolve it. The remaining 13 are unchanged and are the two
causes already accounted for in `tests/e2e/a11y.spec.ts`: **6** nodes of *"content is too short
to determine if it is actual text content"* (the single-digit stage buttons) and **7** of the
gradient message (`.hud-stage`, the two `.hud-t` rows, `sun-time`, the two `area-readout`
spans, Sources' `<summary>`).

Resolving those 7 would mean giving `.hud` and `.sources` opaque grounds. **Not done, and
deliberately:** MASTER specifies `--chip-scan rgba(4,20,38,0.82)` as the chrome token, the
translucency is the design rather than an oversight, and the measured contrast on those nodes
is 7.28–8.89:1 either way. Making the HUD opaque to satisfy a tool that says "incomplete"
rather than "fail" would trade a real design decision for a cosmetic clean sheet.

### Fix 4, why it is the interesting one

This is the class of defect the project keeps meeting: correct markup, no effect. `A11yAlt`
builds a seven-room table from the model, `a11y.spec.ts` counts its rows and gets 7, axe scans
it and finds nothing wrong — and it was **not rendered**, at every desktop viewport, because a
flex item whose `overflow` is not `visible` has an automatic minimum size of 0 and was
therefore the only child of `.a11y-alt-panel` able to absorb the column's shrink deficit.
Measured sibling heights while it was crushed: `h2` 20.8, `p` 80.6, `p` 100.7, `p` 181.3,
`ul` 95 — none of them shrank at all. The scroller took the entire 400 px and went to zero.
Nothing in the DOM, the accessibility tree or axe could see it; only the box could.

---

## Findings handed over

Each one is a browser measurement, with the file and the element. None is CSS in a file I own.

1. **`Panel.module.css` line-height 1.45, 26 elements.** `src/ui/Panel.module.css`, classes
   `.hint`, `.chipSource`, `.chipWord`. Computed 17.4px/12px and 14.5px/10px = **1.45**,
   against MASTER's body band of **1.5–1.75**. Expected ≥ 1.5. Affects 26 rendered elements at
   stage 5 with the corrections panel open. *Owner: whoever holds `src/ui/Panel.module.css`.*

2. **Tab order: `panel-toggle` is last and sits at the top of the frame.** Measured at
   stage 0: 12 stops, 11 in reading order, and `[data-testid="panel-toggle"]` at box
   (898, **14**) is reached 12th — after `sources-toggle` at (15, 661). Fix is mount order in
   `src/scene/Experience.tsx`: `<Panel>` currently mounts after `<Hud>`. Note the constraint —
   `tests/e2e/a11y.spec.ts` asserts `skip` first and `a11y-alt-toggle` second on purpose, so
   the Panel would have to move to third, not first. *Owner: `Experience.tsx`.*

3. **No high-contrast toggle exists.** MASTER §Accessibility gates requires one that "thickens
   strokes to 2.5px, raises `--mass` opacity to 0.22". Scanning every `<button>` and `<input>`
   in the document at all six stages for "contrast" in text, `aria-label` or `data-testid`
   returns an **empty list**. Needs a control in `Hud.tsx`, a flag in `store.ts`, and the two
   values read in `Campus.tsx` (which already reads `dpr` and `reducedMotion`, so the seam is
   there). *Owners: `Hud.tsx` + `store.ts` + `Campus.tsx`.*

4. **`[` and `]` do not change stage.** Pressed `BracketLeft` then `BracketRight` with nothing
   focused: `window.__weld.stage` measured **5 → 5 → 5**. No handler exists. `Hud.tsx` already
   owns a window `keydown` for the piece keys with three documented guards (stage, input
   target, first-person) — the bracket handler belongs beside it and needs a fourth guard of
   the same kind. *Owner: `Hud.tsx`.*

5. **No icon set at all; four arrow characters stand in.** Zero `<svg>` elements anywhere.
   MASTER §Icons asks for Lucide, 24 × 24. The only icon-shaped things in the app are
   `Panel.tsx`'s four nudge buttons rendering `←` `→` `↑` `↓` as text at 16px. They are
   `aria-label`led, so nothing is unreachable — this is a design-system conformance gap, not an
   accessibility one. *Owner: `Panel.tsx`, or MASTER's §Icons should say "text arrows are the
   set" and be done with it.*

6. **`--chip-day` is declared and painted on nothing.** Zero elements compute
   `background-color: rgba(255,255,255,0.86)` at any stage. MASTER lists it as half of the
   chrome pair that "must read on both stages"; in practice both stages use `--chip-scan` or
   `--void-deep`, and the measured stage-5 contrast is fine. Either paint it or strike it.
   *Owner: `design-system/MASTER.md`.*

7. **MASTER's contrast ledger understates `--line` on `--void`.** The row says ~6.5:1;
   computed it is **8.82:1**. Harmless today because the row is stricter than reality, but it
   is a number in a table headed "Verified, not assumed". *Owner: `design-system/MASTER.md`.*

8. **`a11y.spec.ts`'s comment now says "fourteen nodes"; it is thirteen.** The docblock in
   `scanStage` enumerates the incomplete nodes and lists `.hud-num` among them. After fix 1 it
   resolves, and the count is 13. The assertion itself is unaffected — it only checks that none
   of them is `A11yAlt`'s — so this is a stale comment, not a broken gate.
   *Owner: `tests/e2e/a11y.spec.ts`.*

9. **10px type on the provenance chips.** `Panel:chipWord` (`GIVEN` / `DERIVED` / `INFERRED`)
   computes **10px**, the smallest rendered type in the app. Not a MASTER violation — the 16px
   floor is scoped to mobile body and mobile is cut — but it is 10px of uppercase tracked mono
   and worth a second look. Contrast measures fine (8.43–10.21:1). *Owner: `Panel.module.css`.*

10. **Two `__perf` readings worth a second pair of eyes — recorded, not diagnosed.** Both
    reproduce at `eaf1f93`, so neither is a mid-edit artefact.
    (a) **Stage 3 draws exactly what stage 2 draws:** 26 calls / 16899 triangles / 122 lines,
    identical at both, while stage 5 reads 38 / 1469 / 0 and stage 4 reads 21 / 433 / 0. If the
    exterior shell is meant to be adding geometry at stage 3, it is not adding a draw call.
    (b) **Stage 4 draws 433 triangles and 0 lines** — plausible if Campus unmounts and only the
    shell plus the sweep plane remain, which is what a code-split stage should do, but it is a
    99 % drop from stage 3 across one stage boundary and nobody has written down that it is
    intended. Neither is an accessibility finding and neither is mine to call; they are here
    because the numbers were in front of me. *Owners: `WeldExterior.tsx` / `Threshold.tsx`.*

---

## Counts

Sixty boxes, from every section of `design-system/MASTER.md`.

| | boxes |
|---|---|
| **PASS** — measured, meets the bar | **51** |
| of which: was a measured FAIL, **fixed in CSS by this pass** | 4 |
| **FAIL** — measured, does not meet the bar, handed to another owner | **7** |
| **N/A** — cannot apply, with the reason | **1** |
| **not checked here** — outside what a rendered page can show | **1** |

**Fixed in CSS (4 boxes, 5 rules).** Body contrast ≥ 4.5:1 · touch targets ≥ 44 × 44 ·
`cursor-pointer` on every clickable · line length ≤ 75ch. The fifth rule,
`.a11y-alt-scroll { flex: none }`, does not have a box of its own in MASTER — it is what made
the touch-target and line-length rows measurable at all, since a container 0 px tall has no
readable geometry.

**FAIL, handed over (7).** `Panel.module.css` line-height 1.45 · tab order (`panel-toggle`
last from the top of the frame) · no high-contrast toggle · `[`/`]` do not change stage · no
Lucide SVG (twice: §Icons and the delivery checklist's combined emoji/Lucide box) ·
`--chip-day` painted on nothing.

**N/A (1).** The 1.5 px stroke floor in P4's exterior: the exterior draws no line work, so
there is no stroke to hold to it.

**Not checked here (1).** Whether the font faces are served from this origin. That is a
network claim, not a rendered-page one; `smoke.spec.ts` owns it and passes.

**Gates after the change.** `npx tsc --noEmit` clean. `npx playwright test
tests/e2e/a11y.spec.ts tests/e2e/smoke.spec.ts` — **12 passed**, zero axe violations on all six
stages in both description states, and the stage-5 box geometry `a11y.spec.ts` asserts is
unchanged: dock [14, 430, 66, 644], HUD [481, 799, 14, 360], sources [14, 95, 660, 706], no
intersection with either.

---

## Scope decisions on the six handed-over items, 31 July 2026

Recorded because the alternative to a decision here is a silent drop. Each of the six above is
either fixed, or declined with a reason — none is left implicit.

**1. `Panel.module.css` line-height 1.45 → FIXED.** Three declarations raised to 1.5, MASTER's
floor for body text. `.title`'s 1.3 is deliberately left: MASTER's 1.5–1.75 is a body-text rule
and that is a 1 rem serif heading, where 1.3 is correct.

**2. `--line` on `--void` stated ~6.5:1 → FIXED in MASTER.** Measured 8.82:1. The correction
matters in the direction it went: an understated ratio gets used to reject a legal pairing.

**6. `--chip-day` painted on nothing → DOCUMENTED, not struck.** Kept as a declared token with
a note in MASTER saying it is unused, because the daylight stages currently have no chrome
needing a translucent chip and deleting it would lose the pairing the table describes. What was
wrong was that its presence read as evidence it had been checked.

**4. `[` and `]` do not change stage → IN SCOPE, assigned.** MASTER asks for them, the seam
exists (`Hud.tsx` already owns a window `keydown` with three documented guards), and the fix
needs a fourth guard of the same kind plus a gate. Handed to the owner of `Hud.tsx` rather than
done here, to avoid two writers in one file.

**3. No high-contrast toggle → IN SCOPE, assigned.** This was the one item where declining was
tempting and the reasoning did not survive contact: the objection would be that a second palette
is a design decision nobody should invent at ship time, but MASTER *specifies* it — strokes to
2.5 px, `--mass` opacity to 0.22. So it is a build, not a design, and it is a genuine
accessibility feature rather than conformance paperwork. Assigned with the bracket keys, since
both touch `Hud.tsx` and `store.ts`.

**5. Zero `<svg>`; four text arrows stand in → DECLINED, and MASTER should be amended.** The
four nudge buttons render `←` `→` `↑` `↓` as labelled text. MASTER §Icons asks for Lucide at
24 × 24, and the checklist itself records this as "a design-system conformance gap, not an
accessibility one" — the buttons are `aria-label`led and reachable. Swapping four labelled
characters for four SVGs on ship night is aesthetic churn with no accessibility gain and a new
dependency or four hand-authored paths to maintain. The honest resolution is the one the
checklist offers as its alternative: §Icons should say text arrows are the set. Declining the
swap, not the conformance question.

---

# P10 — colour on the ground, and the buildings are the buildings

Task 15 of `docs/phases/P10-EXTERIOR-PLAN.md`, the final task of the phase. Implemented on branch
`p10-imagery` in the worktree `~/Code/weld15-imagery`. Everything below is a
measurement taken against that build, not the plan's prediction — where the two differ, both are
given, per `docs/phases/P9.md`'s own precedent of recording every divergence from the spec rather
than quietly reconciling to it.

**Gates run 1 August 2026:** `npm run typecheck` clean · `npm run test` 716/716 passed (30 files) ·
`npm run test:e2e` 58/58 passed · `npm run build` clean (Turbopack, static). The e2e run is the
one number here that needed a workaround to be trustworthy — see *A verification hazard found and
worked around* below.

## Mean saturation, before and after (the original complaint)

`tests/e2e/imagery.spec.ts`'s regression test, added in Task 14 specifically so a future source
swap cannot silently go grey again:

| level / stage | before (leaf-off MassGIS) | after (this build) |
|---|---|---|
| L3 raster, mean saturation | 0.077 | **0.126** |
| L4 raster, mean saturation | 0.095 | **0.128** |
| on-screen, stage 1 (16,332 ft) | — | **0.056** |
| on-screen, stage 2 (815 ft) | — | **0.144** |

The plan (P10-EXTERIOR-PLAN.md Task 3) predicted L3 would clear **0.20**; it measured **0.126**.
`greenExcess` (G − (R+B)/2) was the reliable secondary check both times it mattered: L3 +10.8,
L4 +9.9, both clearly positive against the leaf-off baseline's +3.0. Re-verified independently in
this task: `sharp` over the committed `l3.webp`/`l4.webp` reads meanSat 0.126 / 0.128, greenExcess
10.8 / 9.9 — exact match to the figures Tasks 3 and 5 recorded. (L2 for reference: meanSat 0.224,
greenExcess 17.5.)

The on-screen floors are per-stage (`SATURATION_FLOOR = { 1: 0.03, 2: 0.07 }`) rather than one
shared constant, because half of stage 2's measured value (0.072) already sits above stage 1's own
measurement (0.056) — a single floor would either be meaningless at stage 2 or fail outright at
stage 1.

## Tint, before and after

`src/scene/Ground.tsx`'s `TINT_SCALE = 0.35` header, measured at the camera's real stage
altitudes (`window.__cam`):

| stage | altitude | was (desaturated / blue-pushed) | now |
|---|---|---|---|
| 1 | 16,332 ft | 15% / 16% | **5% / 5.6%** |
| 2 | 815 ft | 63% / 69% | **22% / 24%** |
| 3 | 110 ft | 75% / 82% | 26% / 29% (unchanged by Task 15; Part B landed in Task 7) |

Scaled, not clamped, so the ramp keeps its shape and does not plateau for the last two stages of a
descent whose whole point is continuous change.

## Draw-call ledger — corrected against the plan's own arithmetic

Measured live this task, `npm run test:e2e -- tests/e2e/campus.spec.ts` (`merging holds` test,
composer included, normal motion):

| | stage 1 | stage 2 | stage 3 |
|---|---|---|---|
| pre-P10 baseline | 24 | 28 | 28 |
| **this build (measured)** | **22** | **26** | **26** |
| plan's prediction (Task 12 step 6) | 21 | 25 | 25 |

**The plan's own arithmetic was off by one.** P10-EXTERIOR-PLAN.md Task 12 Step 6 computed
"24/28/28 minus 4 (two masses, one line) plus 1 (the GLB) = 21 / 25 / 25", and Task 14 Step 4
separately says draw calls "fell from 28 to 25". Neither matches what the build actually does:
retiring the two mass meshes and the one non-Weld edge line removes exactly one fewer call than
the ledger assumed, landing at **22/26/26**, not 21/25/25. Recorded here so anyone who reads the
plan after the fact is not confused by the mismatch — the plan's prose is left as written (Ground
rule 1 says a claim carries its source; the source here is now this correction, not a rewrite).

A second, composer-subtracted reading exists in `tests/e2e/perf.spec.ts`'s own budget table (under
`reducedMotion`, which drops bloom): the Campus row there reads **9 calls / 17,546 tris** at stage
2, against **11 calls** before P10 — a different frame (no bloom passes) from the 22/26/26 above,
which includes the composer. Both are real; they are not the same count and should not be
conflated.

## Triangle count

**Rose by ~658, not "roughly doubled."** `17,563` triangles at stages 2/3 in this build (measured
live, `campus.spec.ts`) against a pre-P10 figure of `16,899` (this document's own P8 section,
§"stage 2 and 3 both 26 calls / 16899 triangles / 122 lines") — a delta of 664, consistent with the
~658 `tests/e2e/perf.spec.ts` records in its own header. "Roughly doubled" describes a different,
earlier comparison point (the raw 48,348-vertex GLB against what a much smaller pre-P10 scene
carried) and does not describe the actual on-screen triangle delta, which is small because the
120,000-triangle budget was never close to the constraint either side of the swap. Stage 1 (campus
without Weld's highlight edges yet costed in): 17,147 triangles.

## The GLB

`public/models/campus.glb`: **1,403,020 bytes (1.3 MB)**, 48,348 raw vertices across the decoded
I3S leaf nodes, 61 buildings in the emitted manifest (Weld itself excluded — see below). Total
`public/imagery/` after the pyramid regeneration: **6.1 MB**, against a pre-P10 baseline of 5.7 MB
(+7%, within the plan's ~10% budget).

## Weld's coordinate-pipeline cross-check (`assertWeld()`)

Passed cleanly on the first real run against the live I3S service, per Task 10: decoded height
**87.01 ft** against `campus.json`'s independently stated **87.01 ft**; centroid **2.3 ft** from
the site origin, against a 5 ft tolerance. Weld itself is drawn by `src/scene/weldGeometry.ts`
(parametric — the dimension sliders, cutaways, threshold sweep and window bays all run through
it) and is excluded from the extracted campus mesh by name; the I3S decode of Weld is still run on
every `fetch-buildings.mjs` invocation purely as this cross-check, then discarded.

## Q1 — leaf-off luma bleeding through leaf-on canopy

**Yes, it happened, on the first attempt.** Task 4's initial tuning (`VEG_T0=6`, `VEG_T1=24`, 4 ft
blur) showed visible bare-branch bleed-through inside tree crowns — ghosted diagonal paths and
branch structure showing through canopy. Fixed by retuning to `VEG_T0=0`, `VEG_T1=15` with an 8 ft
blur, chosen by direct visual comparison of four rendered variants (`a-naip-only`,
`b-massgis-only`, `c-hybrid-masked`, `d-hybrid-naive`) plus three further retuning sweeps. The
final threshold (excess ≥ 0) was preferred over an equally-good negative-threshold alternative for
being physically meaningful rather than merely fitted.

## Q2 — does the derived window grid read as windows or wallpaper

**Windows, at normal viewing distance.** Confirmed by direct visual inspection at stages 2 and 3 —
the altitudes a viewer actually experiences — where it reads convincingly as a Harvard Yard
dormitory's fenestration. A separate, artificially-close 2×-DPR crop revealed the underlying
mechanical, uniform-pitch repetition (the same rhythm regardless of wall width or corner), but that
view does not occur in normal use. `WINDOWS = true` kept in `CampusMesh.tsx`.

## Everything else that turned out differently from the plan

- **L2's NAIP fetch had a real bug the plan did not anticipate.** A single `exportImage` request
  over L2's 50 km footprint returned ~37.6% no-data, because NAIP's ArcGIS service silently caps
  composited source scenes at 50 per request and L2's footprint intersects ~79. Visible as a dark
  diagonal quilt at stage 1 in the live app. Fixed by splitting the fetch into a 3×3 grid of
  smaller `exportImage` sub-requests, mosaicked before resampling — no-data dropped to ~1.4% (the
  remainder is genuine open ocean, correctly left to the Blue Marble fallback).
- **Two test files needed unplanned fixes to stay honest.** `tests/imagery.test.ts`'s
  native-resolution assertion became per-level (`EXPECTED_NATIVE_FT = { L2: 0.984, L3: 0.984,
  L4: 0.492 }`) once L2/L3 moved to NAIP's coarser resolution while L4 kept MassGIS's finer figure
  for its luminance channel. `tests/hybrid.test.ts`'s blur-conservation test had a fixture too
  small to hold its own blur without edge clamping eating real mass (correct behaviour at that
  tiny scale, not a bug) — fixed by enlarging the fixture, not by loosening the tolerance.
- **A pre-existing, unrelated bug surfaced and got fixed as a side effect.** `scripts/georef-
  overlay.mjs` had been silently broken since P9b — it read a manifest path that no longer
  existed. Fixed as part of Task 3's mandated georeferencing check, since that check could not run
  at all otherwise.
- **A real shader bug was caught before shipping.** Task 12's classified-material shader declared
  its custom vertex attribute as `_MATCLASS` (uppercase, matching the glTF-side convention), but
  three-stdlib's `GLTFLoader` lowercases non-standard attribute names on load, so the attribute
  would never have bound — every vertex would silently have read material class 0 ("wall")
  regardless of its real class, with no error. Caught by tracing the loader source; fixed by using
  `_matclass` (lowercase) in the shader.
- **The near-neutral pixel threshold (`campus.spec.ts`, 236) did not need to change**, but the
  populations under it moved a lot in both directions: stage 1 fell (1,939 → 454 at threshold 205)
  because leaf-on canopy now covers bare roofs and pavement that used to read bright and neutral;
  stage 2 rose (2,588 → 2,712 at 205, and higher at every threshold above it) because CampusMesh's
  granite and sandstone are themselves near-neutral and bright under the highlight tint. Both
  moves are real, and 236 still separates the two populations completely (stage 1 is zero from 235
  up; stage 2 is 1,783 at 245).

## A verification hazard found and worked around, this task

`playwright.config.ts` hardcodes `http://localhost:3000` for both `use.baseURL` and
`webServer.url`, with `reuseExistingServer: true` — and its own header comment already names the
exact trap this ran into: "a full P9 run" was lost to it before. At the start of this task, port
3000 was occupied by the **main checkout's** own `next-server` (confirmed via `lsof -p <pid>` →
cwd `~/Code/weld15`, not this worktree), which does not carry any of this branch's
changes. Running `npm run test:e2e` unmodified would have silently adopted that server and tested
the wrong code while reporting green. Worked around by running the suite against a temporary,
untracked config (`playwright.p10-verify.config.ts`, deleted after the run) pointed at this
worktree's own port 3200, rather than editing the shared, committed `playwright.config.ts`. All 58
tests passed against the worktree's own server. Nobody should trust a green `test:e2e` run from
any of these sibling worktrees without first checking which server answered on 3000.

## Accessibility and contrast, re-verified for P10

`npm run test:e2e -- tests/e2e/a11y.spec.ts tests/e2e/contrast.spec.ts` — **PASS, all of it**
(part of the 58/58 above). In particular:

- The high-contrast toggle still drives `massOpacity` to MASTER's **0.22** through
  `window.__campus`: measured live, `mass 0.12 -> 0.22` at both DPR 1 and DPR 2, alongside line
  width `1.5 -> 2.5` and Weld's own edge `2.2 -> 3.666...` (still the same `2.2×`/`1.5×` ratio to
  the rest of the campus, now against the thickened 2.5 base).
- Weld's highlight is still three signals — hue **and** width (its edge is `2.2×`/`3.67×dpr`
  against `1.5×`/`2.5×dpr` for neighbours), the `.weld-chip` label, and the reduced-motion-aware
  pulse — verified visually under the toggle rather than only by the number, since Weld's white
  outline is now the brightest thing on a **brick** building rather than a **blue** one. It still
  reads clearly as the highlighted building at stages 2 and 3 with the toggle on.

---

# P11 — photorealism, and the specs it retires

Phase 5 (`docs/phases/P11-PHOTOREAL.md`), the final phase. A note for anyone who follows one of
the `tests/e2e/*.spec.ts` references above (lines 771, 809, 835, 901, 925) and finds the file
gone: **`imagery.spec.ts`, `campus.spec.ts`, `contrast.spec.ts` and `wheel-and-spin.spec.ts` were
deleted in this phase**, per the phase spec's own instruction — each tested a system this phase
retires (the L0-L2 imagery pyramid, Campus.tsx's `.weld-chip` highlight, MASTER's stroke-width
figures for that same highlight, and the old per-stage globe-spin/wheel split CameraRig.tsx
replaced with one drag-and-wheel handler for every stage but the last). The measurements those
sections of this document recorded are left exactly as taken — they were true of the build at the
time — but the commands quoted in them (`npm run test:e2e -- tests/e2e/campus.spec.ts`, etc.) no
longer run. What is not retired-system-specific from those four files survived into
`tests/e2e/descent.spec.ts`, whose own header names each piece and where it came from.
`perf.spec.ts` and `journey.spec.ts` were rewritten rather than deleted: draw-call budgets became
triangles/frame-time/tile-memory, and the coverage heuristic became luminance variance and edge
energy — both changes are explained at length in each file's own header, for the same reason this
document explains its own.
