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

## Register

Product UI, not marketing. Design serves the artifact being explored. The building is the
subject; chrome stays quiet and gets out of the way of the 3D viewport.

## Two stages, two palettes

The app crosses from a scan of the campus into a finished room. Each stage commits to its own
palette; the crossing between them is the payoff, so they must not be blended.

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
