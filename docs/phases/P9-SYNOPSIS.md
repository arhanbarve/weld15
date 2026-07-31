# P9 in progress — hands off these files

**Branch:** `p9-earth-descent`
**Worktree:** `.claude/worktrees/p9-earth/`
**Spec:** `docs/phases/P9.md` (829 lines, on that branch)
**Status:** implemented, 7 commits, not pushed, `main` untouched. Do not edit these files on `main`
until it merges. `docs/phases/P9.md` §10 records every place the implementation departed from the
spec — four numbers in the spec are wrong and the corrections are asserted in tests.

**If you run the e2e suite from a worktree, read this first.** `playwright.config.ts` sets `baseURL`
to `localhost:3000` with `reuseExistingServer: true`. If any dev server is already listening there —
including one from another worktree or the main checkout — Playwright adopts it silently and the
suite reports green while testing the wrong code. The first full P9 run said "46 passed" while
testing code with none of P9 in it. Check that a file only your branch has returns 200 before
trusting a green run.

## What P9 does, in one paragraph

Replaces the grey-box sphere at stage 0 and the empty grid at stage 1 with a real Google-Earth-style
descent: a textured Blue Marble globe lit by the true subsolar point, dissolving into georeferenced
aerial photography of Cambridge that resolves into the existing cyanotype palette by the time the
camera reaches Weld. The six-stage machine and the interior design are unchanged.

## The one mechanism you need to know

Everything is driven by a single derived scalar, **`alt` = `camera.position.y`** (feet above Weld's
grade). Which ground quad is visible, the tint, the labels, `near`/`far`, the globe's crossfade — all
pure functions of `alt`, living in a new three-free module `src/scene/altitude.ts`.

The globe never exists at foot scale. It is drawn as a **depth-less proxy sphere** whose radius and
camera distance are scaled together (`GLOBE_R = far/8`), which is pixel-identical to the real thing
by perspective invariance. Consequence: **no logarithmic depth buffer, no origin recentring, no
change to `src/geo/`.** If you see someone adding `logarithmicDepthBuffer: true`, that is a bug.

## Files P9 owns — do not touch on main

**P9a (the flight, no imagery):**
```
src/scene/altitude.ts        NEW    bands, ramps, near/far schedule
src/scene/globeRig.ts        NEW    the scale-invariance maths
src/scene/Globe.tsx          REWRITE
src/scene/stages.ts          EDIT   re-pitch kf1/kf2, paths on kf0-2, generalise cameraKeyframe()
src/scene/CameraRig.tsx      EDIT   per-frame near/far, publish window.__cam.alt
src/scene/Experience.tsx     EDIT   drop hard-coded near/far
src/geo/solar.ts             EDIT   + subsolarPoint(date)
src/state/store.ts           EDIT   fly-down action        <-- CONFLICT RISK, see below
src/ui/Hud.tsx               EDIT   fly-down button        <-- CONFLICT RISK, see below
tests/altitude.test.ts       NEW
tests/globeRig.test.ts       NEW
tests/{solar,stages}.test.ts EDIT
tests/e2e/{journey,campus}.spec.ts EDIT  re-measured bounds
```

**P9b (the imagery):**
```
scripts/fetch-imagery.mjs    NEW
public/imagery/*             NEW    ~2.6 MB AVIF pyramid, committed
src/scene/imagery.ts         NEW
src/scene/Ground.tsx         NEW    four nested quads + horizon fade
src/scene/Labels.tsx         NEW    progressive place labels
src/ui/ImageryChip.tsx       NEW
src/scene/Campus.tsx         EDIT   --mass altitude ramp, retire gridHelper  <-- CONFLICT RISK
src/scene/Perf.tsx           EDIT   publish gl.info.memory.textures
src/ui/Sources.tsx           EDIT
design-system/MASTER.md      EDIT   amendment to the "palettes must not blend" rule
docs/SOURCES.md              EDIT
```

## Conflict risk right now

As of branch point `3f174e8`, `main`'s working tree has **uncommitted** edits to
`src/scene/Campus.tsx`, `src/state/store.ts`, `src/ui/Hud.tsx`, `tests/store.test.ts`, and an
untracked `tests/e2e/contrast.spec.ts`. P9 also edits the first three. Whoever owns those changes
should land them; P9 will rebase onto them rather than the other way round.

## Explicitly out of scope for P9 — safe for you to work on

- Stages 4 and 5: the threshold, the suite, the fit-out editor, first-person walking
- Anything in `src/geo/frames.ts` — unchanged by design
- Mobile (already gated out by `DesktopOnly.tsx`)
- Terrain elevation, photogrammetric buildings, live map tiles / API keys

## Gates P9 moved, each with its measurement

| gate | was | now | measured |
|---|---|---|---|
| `campus.spec.ts` draw calls, stages 1–3 | ≤ 30 | ≤ 34 | 24 / 28 / 28 |
| `campus.spec.ts` geometries | < 20 | < 24 | 11 / 16 / 16 |
| `campus.spec.ts` white pixels | threshold 205 | threshold 236 + floor 400 | 0 at stage 1, 1,648 at stage 2 |
| `perf.spec.ts` §9 Campus scene calls | ≤ 10 | ≤ 13 | 11 with the composer subtracted |
| `a11y.spec.ts` tab order | 3 stops | 4 stops | fly-down is top-centre, before the HUD |

`journey.spec.ts`'s bounds did **not** need moving: worst case across the whole descent is 16.9%
coverage against `> 8` and 50 distinct colours against `>= 5`.

The white-pixel gate was **rebuilt, not widened** — a photographic ground puts bright neutral pixels
on both sides of the old comparison, so the threshold moved to where the two populations separate
completely.
