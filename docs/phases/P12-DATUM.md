# P12 — The datum, and one Weld instead of two

Status: **implemented**, unit suite 1037/1037, keyless e2e 72 passed / 3 skipped / 0 failed. Three defects, one of which explains the other
two being invisible until now. Everything here was measured in a browser against live Google
Photorealistic 3D Tiles, not reasoned about.

Supersedes nothing. P11 built the tiles pipeline correctly and put it in the wrong place.

---

## 0. What was wrong

### 0.1 The site frame hung off the ellipsoid, 64 ft above the ground

`src/scene/geo/frame.ts`'s `originEcefStd()` anchored the whole site frame at **ellipsoid
height 0**, while its own comment said "at grade" and every other file in the project treats
`y = 0` as Weld's grade. Those two readings agree only if grade IS the ellipsoid, and at
Cambridge it is 64 ft below it:

| source | value |
|---|---|
| USGS EPQS (1 m 3DEP) at 42.3739244, −71.1171195 | H = 8.240 m orthometric, NAVD88 |
| NOAA NGS GEOID12B, same point | N = −27.763 m (stated error 0.048) |
| h = H + N | **−19.523 m = −64.05 ft** |

Nothing could see the error while the world was parametric, because the parametric world was
self-consistent about where the ground was. Google's tiles arrive in real ECEF and are the
first thing in this project that knows independently. So the tiles' Cambridge landed 64 ft
BELOW the model, and every parametric object — Weld's shell, `WeldMarker`'s ring and pin, the
camera keyframes' aim heights — floated above the photogrammetry by that much. That is the
"the 3D model is hovering over Google Maps" report this phase started from.

**The carve was broken by the same bug, silently.** `tilesCarve.ts`'s prism spans grade − 5 ft
to the ridge; 64 ft too high, it covered the air OVER Weld's roof, so the carve that is
supposed to remove Google's own Weld at the threshold could never have removed any of it.

### 0.2 Two Welds were mounted at once, by design

`Experience.tsx` mounted `<WeldExterior>` for `visibility(stage).weld`, i.e. stages 2–4, at
`shell = 1` (fully opaque, since `thresholdOpacity` only ramps at stage 4) — and `Tiles.tsx`
set `uCarve = 1 - shell`, i.e. **0** until stage 4. So at stages 2 and 3 an opaque
brick-coloured massing of Weld stood in front of Google's photogrammetric Weld. Even with the
datum right, that is two buildings in one place.

### 0.3 The master scrubber's readout was on a different scale from its own ticks

`JourneyBar.tsx` rendered `t.toFixed(2)` — progress WITHIN the current stage, 0 to 1 — directly
beneath ticks labelled 0 to 5. Two thirds of the way through Harvard Yard it read `0.67` while
the tick under the handle said `2`.

---

## 1. What changed

| file | change |
|---|---|
| `src/scene/geo/frame.ts` | `WELD_GRADE_H_FT = -64.05`; the origin anchors there; `geodeticToSite`/`siteToGeodetic`/`altitudeOf` heights now mean **feet above Weld's grade** |
| `src/scene/cutaway.ts` | `modelMode(stage, mode)` — the one predicate for "the viewer asked for the model, not the world" |
| `src/scene/Experience.tsx` | `<WeldExterior>` mounts only in model mode; the interior goes to full opacity in model mode at stage 3 |
| `src/scene/Tiles.tsx` | `uCarve` is 1 in model mode, otherwise the threshold ramp as before; dev-only `window.__tilesImpl` handle for measurement |
| `src/scene/stages.ts` | stage 3 derived by `obliqueDrop()` like stages 0–2, at 205 ft instead of 110 |
| `src/ui/JourneyBar.tsx` | readout and `aria-valuetext` on the 0–5 stage scale, with the stage's name |
| `scripts/measure-align.mjs` | the alignment measurement, repeatable |

**Altitude did not change meaning and no tuned constant moved.** `altitudeOf` returns height
above grade, which is what `altitude.ts`'s bands, `NEAR_FAR_STOPS`, `window.__cam.alt` and the
fly-down's decades were all tuned against back when grade and the ellipsoid were assumed to be
the same surface. `tests/geoFrame.test.ts`'s `altitudeOf([0, h, 0]) === h` still holds.

**Stage 3 had to move, and the datum is why.** Its hand-placed pose stood 110 ft up and 190 ft
south of Weld — which is over Widener. Correct against the old floating world; level with
Widener's roof once the tiles were at their real height, and the stage-3 frame became mostly a
skylight (screenshotted). It is now `obliqueDrop(270, 45, 45)` at azimuth 38.3: 205 ft up,
range 230 ft, inside `STAGE3_CLAMP`'s 115–345 ft and 2–75°.

**Stage 4's stand-off had to rise, for the same class of reason.** The threshold begins 124 ft
outside bedroom B's gable at a height of `ridge / 2` — 55 ft above grade, chosen when the only
things in the scene were this project's own massing and a ground plane. Google's Yard has elms
in it. Measured along the approach corridor itself (±25 ft either side of the line from the
stand-off to Weld's centre, 1,628 tiles settled): canopy tops run **50.8 to 59.9 ft over the
first 39%** of the run in, so the camera began the crossing inside a tree — screenshotted, half
the frame was leaves. The stand-off is now `ridge * 0.8`, i.e. 80.6 ft above grade: clear of the
worst canopy by 20 ft and still under the 85.4 ft ridge, so the approach looks slightly UP at
the roofline. The aim rose with it, `ridge / 4` to `ridge / 2` — lifting only the camera would
have pitched the shot 21° down and pushed the ridge off the top edge. Weld's own mesh tops out
at 81.2 ft in the same measurement, which is the same number from the other direction.

---

## 2. The measurement

`scripts/measure-align.mjs`, stage 3, settled (779 meshes, 1,572 tiles): every loaded tile's
vertices in site space, ground read as a per-cell 10th percentile on a 20 ft grid, medianed
over cells.

| statistic | with the datum applied |
|---|---|
| grade, ring 35–75 ft (hugging Weld) | **+1.7 ft** |
| grade, ring 80–160 ft (out in the yard) | **−1.3 ft** |
| highest vertex over the footprint | **+82.2 ft** (weld.json's ridge: 85.4) |

The two rings bracket zero: the ground rises about 3 ft over the 100 ft from the yard to Weld's
walls and this project's grade is one flat plane, so no constant makes both zero — what is left
is a slope, not an offset. The value is therefore NOT tuned past the geodetic figure. The sign
that remains is the safe one: grade sits 1.7 ft above Google's ground at the building, so
`WeldMarker`'s ring lies on top of the photogrammetry rather than buried in it. The ridge line
is the independent check and it passes — 82.2 ft of photogrammetric mesh, which rounds slate
ridges off, against a real 85.4 ft ridge. A datum still 64 ft out would have read near 146.

---

## 3. Verification

- `npx vitest run` — **1037/1037**, including four new cases in `tests/geoFrame.test.ts` that
  pin the datum's sign, size and the ellipsoid-to-grade relationship.
- Three recorded numbers moved with stage 3 and were updated with their reasons:
  `journey.test.ts`'s leg spans (leg 2 is now log10(814.6 / 204.96) = 0.5993 decades) and stage
  ticks, and `orbit.test.ts`'s stage-3 range (230.46 ft at pitch 45).
- Live screenshots at stages 2, 3, 4 (t = 0.3 / 0.55 / 0.85) and 5, keyed: one building at
  every stage, the crimson footprint ring tracing Weld's real base, the carve dissolving
  Google's Weld across the threshold, and a clean interior in the hall.
- Cutaway at stage 3, measured off `window.__perf`: `none` 72 calls / 161,628 triangles (tiles
  only, no parametric geometry at all); `roofOff` 104 / 171,910; `section` 103 / 169,744 — the
  shell AND the interior arriving together, which is the P6-era bug in §0.2's neighbourhood
  fixed on the way past: `thresholdOpacity` returns `interior: 0` below stage 4 and `<Suite>`
  returns null under 0.001 opacity, so every cutaway at stage 3 used to open onto an EMPTY
  building.

---

## 4. The e2e suite, and what was wrong with it

The suite is **keyless by default** (P11 §6a): `NEXT_PUBLIC_GOOGLE_MAPS_KEY= npx playwright
test`, with three keyed-only gates skipping themselves. Run it keyed and the drag-safety
sweeps time out on tile streaming and half the pixel gates sample a half-loaded frame — worth
knowing, because that is how it was first run during this phase and it produced nine failures
that had nothing to do with the code.

Run correctly, the branch inherited **one real failure and one switched-off gate**, both
fixed here, and P12's own regression (one) was found by running the merge base with the work
stashed and comparing.

| gate | was | now |
|---|---|---|
| `edit.spec` — each cutaway mode changes the frame | failing on `main`, deterministically | fixed: measured from stage 3 |
| `journey-continuity.spec` — scrubbing never pops the camera | `test.skip` since it was written | on, and passing |
| `journey.spec` — reduced motion jump-cuts | P12 regression | fixed: asserts the camera, then the frame |
| `perf.spec` — triangles stay in a sane range | flaked 1 run in 3 | fixed: `settled()` waits for the scene |

**The cutaway gate was measuring the wrong stage.** It asserted that `wallsDown` differs from
`none` by more than 0.5 mean luminance while standing in the hall — where a cutaway drops
walls that are behind the camera or out of frame. Measured, keyless, same 60×60 grid:

| stage | none | roofOff | wallsDown | section |
|---|---|---|---|---|
| 5 (the hall) | 210.70 | 211.02 | 210.83 | 211.02 |
| 3 (outside) | 83.82 | 78.52 | 79.64 | 80.44 |

So the floor was unreachable at stage 5 (real delta 0.13) and clears at stage 3 with 8× margin
(4.18). Stage 3 is also where the feature is for — and, thanks to §1's interior fix, where it
now shows something.

**The continuity gate had never run.** It carried `test.skip` and a note saying the master
slider "does not exist yet in this checkout"; the slider landed with P10 and the note went
stale, so the gate sat off through P10 and P11 while the camera it guards was rebuilt twice.
Turned on, its metric turned out to be unrunnable as written — raw step length against 3× the
sweep's median, on a descent whose legs are deliberately weighted by decades of altitude, so
step 0 moved 625,173 ft against a median of 1,736 and was correct to. It now measures each
step against **its own neighbours**, which is what a pop is and needs no scale. Measured worst
local ratios: 5.27 anywhere (the funnel's own smoothstep accelerating inside the threshold),
2.61 at a stage boundary, 4.79 at the 4→5 arrival where the walker takes the camera over.

**One keyed gate is unverified**: `perf.spec`'s tile-cache ceiling. Left unrun on purpose —
this phase's measurement campaign spent most of a day's 3D Tiles root-request quota, and that
gate tests cache bookkeeping unrelated to anything here.
