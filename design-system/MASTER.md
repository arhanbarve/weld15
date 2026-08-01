# Weld 15 — Design System (MASTER)

Global source of truth. Page-specific deviations live in `design-system/pages/`.

Generated with `/ui-ux-pro-max`, then **overridden** where the DB recommendation conflicted
with the locked visual direction. Precedence: user's locked direction > this file > DB defaults.

## Overrides applied

| DB recommended | Used instead | Why |
|---|---|---|
| Style: "Vibrant & Block-based" | Cyanotype scan → daylight interior | Locked by the user in direction review. DB matched on generic keywords, not the subject. |
| CTA `#22C55E` (run-green) | `#A41034` Harvard crimson / `#E4526F` lifted | Subject is a Harvard building. Green has no meaning here. |
| Type: Fira Code + Fira Sans | IBM Plex Mono + Libre Baskerville | Mono+sans is a weak contrast axis. Mono+transitional-serif suits an 1872 building and a technical drawing at once. |
| Pattern: Immersive/Interactive | **Kept** | Its requirements adopted verbatim: skip control, mobile fallback, CTA after interaction. |
| "The two palettes must not be blended" | **Amended in P9** | A third input — aerial photography — resolves *into* the scan palette by an altitude ramp. See "Two stages, two palettes". |

## Register

Product UI, not marketing. Design serves the artifact being explored. The building is the
subject; chrome stays quiet and gets out of the way of the 3D viewport.

## Two stages, two palettes

The app crosses from a scan of the campus into a finished room. Each stage commits to its own
palette; the crossing between them is the payoff, so they must not be blended.

> **Amended in P9.** The scan and daylight palettes still must not blend *with each other*. A third
> input arrives at stages 0–3 — georeferenced aerial photography — and it is neither palette. It is
> resolved **into** the scan palette by an altitude ramp rather than sitting beside it: full colour
> at orbit, and by the time the camera reaches Weld it has been desaturated to 74% and pushed 29% of
> the way to `--void`. The rule the original line protects is that the *crossing* is the payoff, and
> that rule is kept — the crossing is now photograph → scan → daylight, three states and two
> crossings, each committed to.
>
> The ramp stops short of 100% deliberately. A fully tinted photograph is a flat blue rectangle with
> every bit of tonal information gone, and what stage 3 wants is a photograph that has become *the
> ground the drawing sits on*. The 18% that survives is what keeps the paths across the Yard
> readable under the cyanotype, which is what makes the massing look like it is standing on
> something. `src/scene/Ground.tsx` holds both numbers and the reasoning.

### Token: the photographic layer

| token | value | meaning |
|---|---|---|
| tint target | `--void` `#06203F` | what the photograph resolves toward as altitude falls |
| tint ceiling | 0.82 × 0.35 = 0.287 | how far it goes at stage 3. Not 1.0; see above |
| tint scale | 0.35 | P10: the campus is real geometry now, not a drawing, so the ground only needs to read as aerial haze under it rather than a cyanotype wash — this shortens the ramp's reach without touching its shape (`src/scene/Ground.tsx`) |
| saturation floor | 0.25 | saturation left at full tint, so the tint does not read as a colour cast |
| ramp bounds | 40,000 ft → 400 ft | the altitude band over which it happens (`src/scene/altitude.ts`) |

These are design-system values rather than magic numbers in a shader, so the look can be tuned
without touching GLSL.

### Stage: SCAN (globe, Cambridge, Yard, Weld exterior)

Thin white line work on Prussian blue — the cyanotype process contemporary with Weld's 1872
construction drawings.

```
--void        #06203F   ground
--void-deep   #041426   vignette, chip backgrounds
--grid        #0C3260   ground grid
--line        #8FC4F2   building edges
--line-hi     #FFFFFF   Weld Hall edges
--mass        rgba(150,200,245,0.10)   extruded faces
--mark        #E4526F   Weld marker, large labels only
--ink-scan    #E4EBF6   text on void
```

### Stage: DAYLIGHT (Weld 15 interior)

Plaster, oak, north light. Materials, not a theme — this is what the room is made of.

```
--sky         #D9E2EC   ambient / window beyond
--plaster     #F0EDE7   wall faces lit
--plaster-sh  #DFDAD1   wall faces shaded
--oak         #B5813F   floor
--oak-deep    #A5732F   floor grain, furniture sides
--crimson     #A41034   bedding, textiles
--glass       #CFE4F2   window glazing
--edge        #8C8578   geometry edges
--ink-day     #0A1626   text on light
```

### Chrome (must read on both stages)

```
--chip-scan   rgba(4,20,38,0.82)
--chip-day    rgba(255,255,255,0.86)
--focus       #5EA6EB   2px ring, 2px offset
```

## Contrast ledger

Verified, not assumed. Body text means < 18px and not bold.

| Pair | Ratio | Verdict |
|---|---|---|
| `--ink-scan` on `--void` | ~13:1 | body OK |
| `--ink-day` on `--plaster` | ~15:1 | body OK |
| `--mark` on `--void` | ~4.0:1 | **large text and graphics only — never body** |
| `--line` on `--void` | **8.82:1** (was stated ~6.5) | OK for hairlines and labels, and for body |

The `--line` figure was `~6.5:1` and is measured at **8.82:1** — `#8FC4F2` on `#06203F` by the
WCAG relative-luminance formula. The tilde was doing real work in this table: every other row is
also approximate, and this one was pessimistic by enough to change what the pair is allowed to
carry. Corrected rather than left, because a ledger that understates a ratio gets used to reject
a legal combination. The full sweep is in `docs/CHECKLIST.md`: 119 text pairs measured against
their real rendered grounds, one failure, since fixed.

`--chip-day` is declared in `app/globals.css` and **painted on nothing** — measured across all
six stages, zero elements compute its value. It is listed below as half of the chrome pair that
"must read on both stages"; in practice both grounds use `--chip-scan` or an opaque `--void-deep`.
It is kept as a declared token rather than struck, because the daylight stages have no chrome
that needs a translucent chip *yet* and deleting it would lose the pairing the table describes —
but it is documented here as unused so nobody reads its presence as evidence it was checked.

## Typography

Self-hosted via `next/font/google` — no CDN request, no layout shift, works offline.

- **IBM Plex Mono** 400/500 — labels, dimensions, room names, all numerals. `tabular-nums` wherever digits align.
- **Libre Baskerville** 400/700 — prose, room descriptions, historical notes.
- Line height 1.5–1.75 body. Line length capped 65–75ch. Minimum 16px body on mobile.
- Display ceiling: clamp max ≤ 6rem. Letter-spacing floor: ≥ -0.04em.

## Motion

- Micro-interactions 180–260ms, `ease-out-quint`. No bounce, no elastic, no linear.
- Stage transitions 900–1400ms along a camera spline.
- Animate `transform` / `opacity` only. Never width, height, top, left.
- **Animate 1–2 elements per view maximum** (DB: "Excessive Motion", severity High).
- `prefers-reduced-motion: reduce` → camera **jump-cuts** between stages with a 120ms crossfade.
  No fly-through, no parallax, no scroll-jacking. Not optional.

## Accessibility gates

The scan stage is the entire risk surface; the DB rates thin-line-on-dark styles poor for a11y.

- Campus strokes **≥ 1.5px at 1× DPR**, multiplied by `devicePixelRatio`.
- Weld is never distinguished by hue alone — hue **plus** a label chip **plus** a pulse.
- Text over the void always sits on `--chip-scan`, never directly on the gradient.
- High-contrast toggle: thickens strokes to 2.5px, raises `--mass` opacity to 0.22.
- Semantic HTML before ARIA. `<button>`, never `<div role="button">`.
- Every canvas interaction has a keyboard equivalent: arrow keys nudge furniture, `[`/`]` change
  stage, `r` rotates selection. `onKeyDown` alongside every `onClick`.
- `:focus-visible` ring on everything focusable. Never `outline: none` without a replacement.
- Canvas carries a text alternative describing the current stage and room.
- Touch targets ≥ 44 × 44px.

## Z-index scale

Semantic only. No arbitrary values, no 999.

```
canvas 0 · hud 10 · panel 20 · scrubber 30 · backdrop 40 · modal 50 · toast 60 · tooltip 70
```

## Breakpoints

375 · 768 · 1024 · 1440. No horizontal body scroll at any of them.
Wide content (tables, the dimension ledger) scrolls inside its own `overflow-x: auto`.

## Icons

SVG only, one set (Lucide). **No emoji as UI icons.** Fixed 24×24 viewBox.

## Anti-patterns for this project

- Gradient text, `background-clip: text` — banned.
- Glassmorphism as decoration — the only blur allowed is depth-of-field in the 3D scene.
- Side-stripe accent borders on panels — banned.
- Uppercase tracked eyebrows above every section — banned.
- Numbered section markers unless the content is genuinely a sequence. The stage scrubber *is* a
  sequence, so it may number its stops. Nothing else may.
- Identical card grids.
- Cream/sand body background (`#F4F1EA` family) — the saturated AI default. The daylight stage
  uses plaster as a **material on geometry**, never as a page background.

## Delivery checklist

- [ ] No emoji icons; Lucide SVG throughout
- [ ] `cursor-pointer` on every clickable element
- [ ] Hover feedback with no layout shift (color/opacity, not scale)
- [ ] Transitions 150–300ms
- [ ] Visible `:focus-visible` on all interactive elements
- [ ] Body contrast ≥ 4.5:1 on both stages; verified, not eyeballed
- [ ] Borders visible in both stages
- [ ] Responsive at 375 / 768 / 1024 / 1440
- [ ] No horizontal scroll on mobile
- [ ] Canvas has a text alternative
- [ ] All form inputs labelled
- [ ] Color never the sole indicator
- [ ] `prefers-reduced-motion` honored
- [ ] Skip control on the intro sequence, reachable by keyboard on first tab

## P10 amendments

Four departures, each traceable to a decision in docs/phases/P10.md and each measured there.

1. **The scan resolves into a photograph.** The palette section commits each stage to one palette and
   says the two are never blended. Since P10 the ground's tint tops out at 0.22 rather than 0.82 and
   Weld's exterior wears brick from about 400 ft down, both on altitude.ts's existing 40,000 -> 400 ft
   band. The drawing-becomes-real progression is intact; what changed is that the bottom of the ramp
   is a colour photograph rather than a blue monochrome. Measured before: a ground patch at stage 3
   read mean rgb (64, 74, 92).
2. **The high-contrast toggle is gone; half its definition survives.** "Thickens strokes to 2.5px"
   still holds and is still asserted at DPR 1 and 2. "Raises --mass opacity to 0.22" has no referent:
   the campus massing is opaque since P10, which is what delivers P9.md section 6.9's occlusion. The
   flag is now seeded from `prefers-contrast: more` alone, unconditionally, exactly as
   `prefers-reduced-motion` is.
3. **Stage 3's canvas interactions have no on-screen buttons.** "onKeyDown alongside every onClick"
   has no onClick left to sit alongside. The keys -- arrows, PageUp/PageDown, +/- -- are bound on the
   window at that stage, advertised in aria-keyshortcuts on the readout group and in a visible hint
   line. The requirement is that every canvas interaction has a keyboard equivalent; it holds.
4. **One dock, top right, at every stage.** Replaces a bottom-centre HUD that moved to the top at
   stage 5, plus a top-centre fly-down. The stage-5 move was itself a correct fix for a measured
   defect and it is preserved in effect: nothing sits over the bottom of the frame at any stage now.
