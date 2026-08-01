# P10 — implementation plan

Companion to `docs/phases/P10.md`, which is the spec and the diagnosis. This file is the build:
eleven steps, every file, every constant, every check, in the order they are to be done.

Read `P10.md` §1 first. Nothing here re-argues a decision; where a number appears without a
derivation, `P10.md` has it.

---

## 0. Working rules for this phase

**Environment**

```
worktree   /Users/arhanbarve/Code/weld15-ux        branch p10-ux, cut from origin/main @ 8e6ef50
dev        cd /Users/arhanbarve/Code/weld15-ux && npx next dev -p 3010
gates      npm run typecheck && npm test           # tsc --noEmit, then vitest run
e2e        npx playwright test                     # baseURL comes from playwright.config.ts
```

Port 3000 belongs to another session. Never start a server on it, never assume a server on it is
mine, and never point `playwright.config.ts` at it.

**Three other worktrees are live off the same commit.** `p10-fidelity` (`../weld15-p10`),
`p10-walk-in` (`./weld15-walkin` inside the main checkout), and `main` itself. Rules that follow from
that, and they are not optional:

1. Every step is one commit on `p10-ux`. No step is split across commits and no two steps share one.
2. Before any `git` operation beyond `add`/`commit`/`status`/`diff`: `git fetch origin`, then
   `git log --oneline origin/main -5` and `git worktree list`. If `origin/main` has moved, stop and
   report before rebasing.
3. Nothing is pushed and nothing is merged to `main` from this branch without asking.
4. If `git status` in this worktree shows a file I did not edit, stop.
5. `src/scene/Campus.tsx`, `src/scene/WeldExterior.tsx` and `app/globals.css` are the three files
   most likely to be contested. All three are touched in **steps 5, 6 and 10 — the latest steps** —
   so a rebase costs at most those three commits.

**Commit message style**, matching the log (`8e6ef50`, `07b9e2b`, `bd10fa2`): one sentence, imperative
or declarative, naming the reason rather than the mechanism. Body only where the "why" is not on the
subject line. No conventional-commit prefixes — this repo does not use them.

**Definition of done for every step.** `npm run typecheck && npm test` green, plus the step's own
named check, plus no new console error in the e2e run. A step that cannot make its own check pass
stops and reports; it does not get a weaker check.

---

## Step 0 — baseline, committed as a script

**Why.** Eight gates in section 6 of `P10.md` are re-measurements. A re-measurement against numbers
kept in my head is not one. Also `P10.md`'s §1 figures need to be reproducible by whoever reads this
in six months.

**New file `scripts/p10-measure.mjs`.** A node script, run against a live dev server, printing one
JSON blob. Sections:

- `boxes` — `getBoundingClientRect` for `[data-testid="hud"]`, `.a11y-alt-dock`,
  `[data-testid="a11y-alt-toggle"]`, `[data-testid="sources"]`, `[data-testid="panel-toggle"]`,
  `[data-testid="fly-down"]`, `.imagery-chip`, at all six stages.
- `marker` — crimson-pixel bounding box at stage 0 (`r > 170 && g < 130 && b in 80..160 && r - g > 60`).
- `groundPatch` — mean rgb and mean HSV saturation of the 360 x 200 px patch at
  `(40, 0.45 * height)`, per stage. Clear of every dock at every stage, which is why that patch.
- `perf` — `window.__perf` per stage.
- `cam` — `window.__cam` per stage.
- `reach` — at stage 5, for each of the 29 pieces: project its anchor through the same maths
  `DragLayer.screenOf()` uses, then `document.elementFromPoint`, and count how many land on the
  canvas. This is the number `Experience.tsx:160-180` records as 17.

It takes `--port` (default 3010) and `--out` (default `verify-run/p10-baseline.json`).

**Run it now and keep the output.** Every later "re-measured" claim cites this file.

Recorded baseline, from the run already done (see `P10.md` §1 for the full tables):

| metric | baseline |
|---|---|
| HUD box, stage 3 | `[451, 989, 541, 886]` — 538 x 345 px |
| HUD box, stage 5 | `[561, 879, 14, 462]` — the top-centre jump |
| a11y dock toggle | `[14, 266, 66, 110]` — 52 px below its own left alignment |
| stage-0 marker | 32 x 32 px |
| ground patch saturation | stage 1 `0.036`, stage 2 `0.194`, stage 3 `0.321` (blue cast, mean rgb 64/74/92) |
| `__perf.calls` | stage 1 `24`, stage 2 `28`, stage 3 `28`, stage 5 `38` |
| pieces reachable at stage 5 | `17` of 29 (from `Experience.tsx`; re-confirm here) |

**Check.** `node scripts/p10-measure.mjs` writes the file and the seven numbers above reproduce.

**Commit.** `Add the P10 measurement script, so every "re-measured" claim has a command behind it`

---

## Step 1 — `src/scene/journey.ts`, and its unit tests

No UI. A pure mapping, testable in node.

**Why a separate module rather than a function in `Hud.tsx`.** Three consumers need it — the bar,
the wheel handler, and every e2e gate that has to turn a `(stage, t)` into a slider position — and it
is exactly the kind of arithmetic that goes wrong silently. `altitude.ts` and `orbit.ts` are the
precedent: three-free, unit-tested, and the renderer only consumes them.

**File.**

```ts
/**
 * The whole descent as ONE parameter, and the mapping back to the stage machine.
 *
 * u runs 0 at orbit to 1 standing in the hall. It is the only number the master scrubber
 * carries; (stage, t) stays the model, because every other file in this project already
 * reads it and because url.ts encodes it. So this is a projection, not a new state.
 *
 * WHY THE LEGS ARE WEIGHTED BY DECADES OF ALTITUDE. The three descent legs cover 3.28,
 * 1.30 and 0.87 decades. Give them equal thirds of the bar and the first third descends
 * at 2.5x the relative rate of the last, which is the same mistake FlyDown.tsx's
 * SECONDS_PER_DECADE docblock records: the perceptually uniform quantity is the rate of
 * change of apparent scale, i.e. d(log alt)/du. Weighting by decades makes that constant,
 * which is also what descentPath() does inside a leg -- so the bar and the path agree
 * about what "halfway" means.
 *
 * THREE-FREE, like altitude.ts and orbit.ts. tests/place.test.ts walks the import graph.
 */
import type { SuiteParams } from "@/geo/rooms";
import type { StageId } from "@/state/store";
import { keyframes } from "./stages";

/**
 * The 3 -> 4 transit's share of the bar, in the same "decades" unit the descent legs use.
 *
 * NOT an altitude change: 110 ft down to 55 ft is 0.30 decades, but the move is mostly the
 * 124 ft of horizontal travel out to the gable stand-off, which no altitude ratio measures.
 * 0.60 gives it 8.6% of the bar -- more than its altitude ratio would buy, less than the
 * shortest descent leg -- which is what a short repositioning move should get.
 */
export const TRANSIT_SPAN = 0.6;

/**
 * The threshold's share.
 *
 * Also not an altitude change. 0.90 gives it 12.9% of the bar, so one pixel of a 300 px
 * slider is 0.4% of stage 4's own t -- fine enough to stop on any frame of the dissolve,
 * which is the one leg somebody will want to inspect frame by frame.
 */
export const THRESHOLD_SPAN = 0.9;

/** Never let a params set collapse a leg to zero and make the bar undivisible. */
const MIN_SPAN = 0.05;

export type Leg = { stage: StageId; span: number };

/**
 * One entry, keyed on the params object's IDENTITY.
 *
 * The same cache stages.ts keyframes() uses, for the same reason and with the same
 * guarantee: every writer of `params` replaces the object rather than mutating it. This is
 * called from a pointermove handler and from a render, so it must not walk the keyframes
 * each time.
 */
const CACHE: { params: SuiteParams | null; legs: Leg[] | null } = { params: null, legs: null };

export function legs(params: SuiteParams): Leg[] {
  if (CACHE.params === params && CACHE.legs) return CACHE.legs;
  const kf = keyframes(params);
  const decades = (s: 0 | 1 | 2): number => {
    const p = kf[s].path;
    if (!p || p.length < 2) return MIN_SPAN;
    const from = p[0]!.frame.position[1];
    const to = p[p.length - 1]!.frame.position[1];
    return from > to && to > 0 ? Math.max(MIN_SPAN, Math.log10(from / to)) : MIN_SPAN;
  };
  const out: Leg[] = [
    { stage: 0, span: decades(0) },
    { stage: 1, span: decades(1) },
    { stage: 2, span: decades(2) },
    { stage: 3, span: TRANSIT_SPAN },
    { stage: 4, span: THRESHOLD_SPAN },
  ];
  CACHE.params = params;
  CACHE.legs = out;
  return out;
}

/** Total span, and the cumulative span before each leg. */
function cumulative(params: SuiteParams): { total: number; before: number[] } {
  const l = legs(params);
  const before: number[] = [0];
  for (const leg of l) before.push(before[before.length - 1]! + leg.span);
  return { total: before[before.length - 1]!, before };
}

/**
 * u at each of the six stage ticks, ascending, first 0 and last 1.
 *
 * DERIVED at render and never written into CSS, because the first three move with the suite
 * params: sectionLength changes kf[4] and kf[5], which changes nothing here, but a params
 * set that made a descent leg degenerate would change the weights, and a tick drawn at a
 * hard-coded percentage would then point at the wrong stage.
 */
export function boundaries(params: SuiteParams): number[] {
  const { total, before } = cumulative(params);
  return before.map((b) => b / total);
}

/** (stage, t) -> u. Stage 5 is the top of the bar, whatever its t is. */
export function toJourney(stage: StageId, t: number, params: SuiteParams): number {
  if (stage >= 5) return 1;
  const { total, before } = cumulative(params);
  const k = Math.min(1, Math.max(0, t));
  return (before[stage]! + k * legs(params)[stage]!.span) / total;
}

/**
 * u -> (stage, t). Exact inverse of toJourney at every tick.
 *
 * u = 1 is {stage: 5, t: 0} rather than {stage: 4, t: 1}, and the two are the same POSE:
 * thresholdPath() pins its last stop to the kf[5] object itself, so the top of the bar is
 * not a cut. Returning stage 5 there is what makes the last tick land on the stage the HUD
 * then names.
 */
export function fromJourney(u: number, params: SuiteParams): { stage: StageId; t: number } {
  const x = Math.min(1, Math.max(0, u));
  if (x >= 1) return { stage: 5, t: 0 };
  const { total, before } = cumulative(params);
  const l = legs(params);
  const at = x * total;
  for (let i = l.length - 1; i >= 0; i--) {
    if (at >= before[i]!) {
      return { stage: l[i]!.stage, t: Math.min(1, Math.max(0, (at - before[i]!) / l[i]!.span)) };
    }
  }
  return { stage: 0, t: 0 };
}
```

**New `tests/journey.test.ts`.**

| assertion | expectation |
|---|---|
| span table at `DEFAULT_PARAMS` | `[3.2831, 1.3018, 0.8698, 0.60, 0.90]`, each `toBeCloseTo(…, 3)`; total `6.9547` |
| `boundaries()` | `[0, 0.4720, 0.6592, 0.7843, 0.8706, 1]`, `toBeCloseTo(…, 4)`; strictly increasing |
| round trip | 10,000 samples of `u`: `toJourney(...fromJourney(u))` back to `u` within `1e-12` |
| exact at ticks | for `k` in 0..4: `fromJourney(boundaries[k])` is `{stage: k, t: 0}`; `fromJourney(1)` is `{stage: 5, t: 0}` |
| monotone in altitude | sample 500 `u`, map to a pose via `cameraKeyframe`, assert `position[1]` is non-increasing across the three descent legs |
| params robustness | the 18 params sets `tests/stages.test.ts` already sweeps: every leg span `>= MIN_SPAN`, `boundaries` still strictly increasing, round trip still exact |
| three-free | `journey.ts` joins `PURE_SCENE` in `tests/place.test.ts` (today `["altitude.ts", "globeRig.ts"]`), so the existing graph walk covers it. VERIFIED that this is possible before writing it down: `journey.ts`'s only value import is `keyframes` from `stages.ts`, and `stages.ts`'s eight imports are `@/geo/rooms`, `@/geo/place`, type-only `@/geo/frames` and `@/state/store`, plus `./route`, `./walk` and `./altitude` — not one of them matches that test's `/^(three($|[-/])\|@react-three\/\|postprocessing($\|\/))/`. `stages.ts` has simply never been swept, because nothing in `src/state` imports it |

**Check.** `npm test -- journey place stages`

**Commit.** `Project the whole descent onto one parameter, weighted by decades of altitude`

---

## Step 2 — the store learns the difference between a cut and a move

**`src/state/store.ts`.** Four additions to the `Store` type and the initial state.

```ts
  /**
   * How many CUTS have happened. A counter, not a boolean, and not the stage.
   *
   * CameraRig un-settles on this rather than on `stage`, and that one change is what deletes
   * every boundary jump in the descent. The poses either side of a stage boundary are already
   * identical -- descentPath() pins each leg's last stop to the next stage's keyframe OBJECT
   * -- so the jump was never geometry. It was `settled.current = false` firing on a stage
   * change and making the next frame COPY the new pose instead of easing into it.
   *
   * Bumped by the five actions that are genuinely a jump: setStage, next, prev, skipToSuite,
   * and entering or leaving first person. NOT bumped by setT, setJourney or flyStep -- those
   * three are continuous motion, and flyStep's exclusion is precisely what turns the
   * fly-down from three moves with two pops into one nine-second descent.
   */
  cuts: number;

  /**
   * Whether a pointer is currently down on the master scrubber.
   *
   * CameraRig copies rather than eases while this is true, on the same argument it copies for
   * the walker: a dragged control must track the hand. The exponential approach at k = 3.2/s
   * lags by about 0.3 s, which on a scrubber reads as the camera fighting the slider.
   *
   * A separate flag rather than inferring it from rapid setJourney calls, because "rapid" is
   * a guess about event rates and pointerdown/pointerup are facts.
   */
  scrubbing: boolean;

  /** Stage and t together, with no cut and no reset. The master scrubber's only writer. */
  setJourney: (stage: StageId, t: number) => void;
  setScrubbing: (v: boolean) => void;
```

Initial state: `cuts: 0, scrubbing: false`.

Actions:

```ts
  setJourney: (stage, t) =>
    // NOT setStage-then-setT: setStage resets t to 0 and cancels the flight, and a scrubber
    // that reset the very number it is writing would snap to the start of each leg as it
    // crossed into it. One set(), so no render ever sees the half-applied pair.
    set({ stage, t: Math.min(1, Math.max(0, t)), firstPerson: null, flying: false }),
  setScrubbing: (scrubbing) => set({ scrubbing }),
```

and `cuts: s.cuts + 1` added to the object literal in exactly five places: `setStage`, `next`,
`prev`, `skipToSuite`, and both `enterFirstPerson`'s success `set` and `leaveFirstPerson`. `next`
and `prev` already use the functional form; `setStage` and `skipToSuite` become functional to read
`s.cuts`.

`setJourney` drops the walker for the same reason `setStage` does — the walker replaces the stage's
camera, so scrubbing away from stage 5 with somebody standing in a bedroom would put the HUD and the
camera in different rooms.

**`src/state/url.ts`** — untouched. `cuts` and `scrubbing` are session facts, not model state, on
exactly the argument the file already makes about `flying`: a link is a place, and "currently moving"
is not one. No `VERSION` bump, so every existing v2 link keeps working.

**`tests/store.test.ts`** additions:

| assertion |
|---|
| `setJourney(4, 0.5)` sets both fields and leaves `cuts` unchanged |
| `setJourney` clamps `t` to `[0, 1]` |
| each of `setStage`, `next`, `prev`, `skipToSuite`, `enterFirstPerson`, `leaveFirstPerson` bumps `cuts` by exactly 1 |
| `setT` and `flyStep` leave `cuts` unchanged — the flight is continuous by construction |
| `setJourney(2, 0.3)` while walking clears `firstPerson` |
| `resetAll` and `hydrate` leave `cuts` and `scrubbing` alone (they are not model state) |

**Check.** `npm test -- store url`. `url.test.ts` must pass **untouched** — that is the proof no
format changed.

**Commit.** `Tell a cut from a move, so a stage boundary stops snapping the camera`

---

## Step 3 — CameraRig stops cutting, and starts tracking the hand

**`src/scene/CameraRig.tsx`.** Three edits, and one of them is a single line that does most of the
work of this phase.

```diff
+ const cuts = useStore((s) => s.cuts);
+ const scrubbing = useStore((s) => s.scrubbing);

  useEffect(() => {
    settled.current = false;
    path.current = [];
-  }, [stage, walking]);
+  }, [cuts, walking]);
```

with the docblock above it extended: a stage change is no longer the trigger, because a scrubbed
stage change is continuous and an un-settle there is exactly the pop this phase deletes. The
first-person half of that docblock's argument is unchanged and still holds — `enterFirstPerson` and
`leaveFirstPerson` both bump `cuts`.

```diff
-    if (walker !== null || reduced || !settled.current) {
+    // `scrubbing` joins the copy branch for the walker's own reason: the control being dragged
+    // IS the camera, and an exponential approach to it lags the hand by ~0.3 s.
+    if (walker !== null || reduced || scrubbing || !settled.current) {
```

`window.__cam` gains two fields, so a gate can assert continuity without reconstructing the mapping
in test code:

```diff
   alt: number;
+  /** Journey parameter, 0 at orbit to 1 in the hall. journey.ts toJourney(stage, t). */
+  u: number;
+  /** The cut counter the un-settle now watches. A gate asserts it did NOT change. */
+  cuts: number;
```

**New `tests/e2e/journey-continuity.spec.ts`** — the gate this whole step exists for.

```
sweep u from 0 to 1 in 200 equal steps, driving the master slider's value setter
  (the HTMLInputElement.prototype setter, per a11y.spec.ts:313's note about React's
  value tracker), settling 60 ms per step, recording __cam.position and __cam.cuts.

assert  cuts is the same at every step as at step 0        no jump happened
assert  no single step moves the camera more than 3x the MEDIAN step length
assert  in particular that holds at the five boundary steps, named individually
assert  the same sweep in reverse, 1 down to 0
```

Three times the median rather than an absolute foot figure, because the step length varies by five
orders of magnitude down the descent — that is the point of the log weighting. Under the baseline
the boundary steps are the ones that would blow a ratio test wide open: the pose either side is
identical, so the pre-fix failure mode is not a large step but the *ease* restarting, which the
`cuts` assertion catches directly.

**Check.** `npx playwright test journey-continuity` green; `npm test` still green.

**Commit.** `Un-settle on a cut rather than on the stage, and track the scrubber while it is held`

---

## Step 4 — the 3 → 4 transit exists at all

The only genuine geometric gap in the descent. `cameraKeyframe` returns `kf[3]` for stage 3 and
stage 4's path starts at `kf[4]`, 124 ft outside the north gable; nothing interpolates.

**`src/scene/CameraRig.tsx`** — stage 3's pose becomes a blend out of the live orbit:

```diff
       : stage === 3
-        ? orbitKeyframe(kf[3], orbit ?? orbitOf(kf[3]))
+        // Stage 3 is a PLACE at t = 0 and a TRANSIT above it. The blend starts from whatever
+        // the viewer orbited to rather than from a fixed pose, so scrubbing on from stage 3
+        // leaves from where they were standing; at t = 1 it is kf[4] exactly, which is the
+        // first stop of stage 4's own path, so the next boundary is not a cut either.
+        ? blend(orbitKeyframe(kf[3], orbit ?? orbitOf(kf[3])), kf[4], t)
         : cameraKeyframe(kf, stage, t, reduced);
```

**And `keepOutsideMassing` has to stop applying above t = 0.** This is the trap in this step, and it
is not hypothetical: that function forces the radius back inside `STAGE3_CLAMP` on every eased frame,
and the transit deliberately leaves that envelope on its way to a stand-off 124 ft out.

```diff
-      if (stage === 3) keepOutsideMassing(camera.position, target.current);
+      // Only while stage 3 IS a place. Above t = 0 the pose is the transit to kf[4], which
+      // deliberately leaves STAGE3_CLAMP's envelope, and forcing the radius back inside it
+      // would pin the camera to the orbit sphere and stall the move.
+      if (stage === 3 && t === 0) keepOutsideMassing(camera.position, target.current);
```

Reduced motion: `cameraKeyframe`'s own reduced branch does not apply here, since stage 3 has no
path. The transit takes the same treatment stage 4's does — jump at the midpoint:

```ts
const transit = reduced ? (t < REDUCED_CUT ? 0 : 1) : t;
```

so under reduced motion stage 3 is either the orbit or `kf[4]` and nothing between, which is the same
shape `REDUCED_CUT` already gives the threshold and `stages.ts` documents at length.

**`tests/stages.test.ts`** additions — the blend is asserted where the rest of the keyframe maths is,
against `blend()` rather than against CameraRig:

| assertion |
|---|
| `blend(orbitKeyframe(kf[3], orbitOf(kf[3])), kf[4], 0)` equals `kf[3]`'s orbit pose exactly |
| at `t = 1` it equals `kf[4]` to `1e-9`, i.e. the first stop of stage 4's path |
| **the segment clears the building**: sample `t` at 0.001 intervals and assert `hypot(pos - [0, 42, 0]) >= MASS_RADIUS` for the whole segment. `kf[3]` sits at `orbitOf` radius ~251 ft against a `minRadius` of 114.9, and `kf[4]` is 124 ft beyond the gable, so a straight line between them cannot enter the massing sphere — but that is the guarantee `keepOutsideMassing` exists to enforce and it is now switched off here, so it is asserted rather than argued |
| the same three, swept over the 18 params sets the file already uses |

**Check.** `npm test -- stages journey`, then `npx playwright test journey-continuity` — the
boundary-4 step in that sweep is what this step makes pass on distance as well as on `cuts`.

**Commit.** `Give stage 3 somewhere to go, because 3 to 4 was the one boundary with no path`

---

## Step 5 — one dock, and the master bar in it

The biggest diff in the phase. Layout only: no scene file is touched.

### 5a — `src/ui/JourneyBar.tsx`, new

```tsx
"use client";
```

Props: `{ stage, t, params, onScrub(u), onScrubbing(v), onPickStage(s) }`. It holds no store
subscription of its own — `Hud.tsx` already reads every one of those and passing them down is what
keeps this component testable and free of a second opinion about the mapping.

Structure:

```tsx
<div className="jbar" data-testid="journey-bar">
  <input
    type="range" min={0} max={1} step={0.0005}
    value={toJourney(stage, t, params)}
    onChange={(e) => onScrub(Number(e.target.value))}
    onPointerDown={() => onScrubbing(true)}
    onPointerUp={() => onScrubbing(false)}
    onPointerCancel={() => onScrubbing(false)}
    onKeyDown={/* nothing: the platform's own arrow handling is the keyboard path */}
    data-testid="journey"
    aria-label="Descend from orbit to the room"
    aria-valuetext={`${STAGES[stage].name}, ${(t * 100).toFixed(0)} per cent`}
    aria-describedby="journey-ticks"
  />
  {/* Kept as the input's next sibling and formatted to two places, because
      threshold.spec.ts polls `slider.locator("+ span.tabular")` for t.toFixed(2). That
      selector is an interface; the testid changed, the shape did not. */}
  <span className="tabular" data-testid="journey-read">{t.toFixed(2)}</span>

  <div className="jbar-ticks" id="journey-ticks">
    {STAGES.map((s) => (
      <button
        key={s.id}
        type="button"
        className={s.id === stage ? "on" : ""}
        style={{ left: `${boundaries(params)[s.id]! * 100}%` }}
        onClick={() => onPickStage(s.id)}
        aria-current={s.id === stage ? "step" : undefined}
        aria-label={`Stage ${s.id}: ${s.name}`}
        data-testid={`stage-${s.id}`}
      >
        {s.id}
      </button>
    ))}
  </div>
</div>
```

Three things that are load-bearing:

- **`data-testid="stage-N"` moves onto the ticks.** `gotoStage()` in five e2e files clicks those,
  and `journey.spec.ts`'s skip test asserts `stage-name` afterwards. The ticks *are* the stage
  buttons now; `.hud-scrub`'s six numerals are retired rather than duplicated, because two controls
  over one field is how they come to disagree.
- **`step={0.0005}`** — 2,000 steps. The widest leg is 47.2% of the bar, so 944 steps inside it, so
  `t` resolves to 0.0011 there. DERIVED, not chosen: any coarser and stage 0's log descent visibly
  stairsteps at the top where the altitude ratio per step is largest.
- **The ticks are positioned from `boundaries(params)`**, in a `style`, because the first three move
  with the params. Nothing about their positions is in CSS.

`aria-valuetext` because a screen reader announcing "0.47" for a slider whose meaning is "halfway
down to Cambridge" is the same defect `sun-hour`'s `aria-valuetext` already fixes.

A `window.__journey` probe in an effect — `{ boundaries, spans, total }` — same device as
`window.__campus`, cleaned up on unmount, so an e2e gate can compute the `u` for a `(stage, t)`
without a second implementation of the mapping in test code.

### 5b — `src/ui/Hud.tsx`, restructured

Order inside the returned fragment (DOM order is tab order, and two gates depend on it):

```
<UrlSync/>  <ImageryChip/>
<button className="skip">            first, unchanged — journey.spec.ts:133 asserts it
<A11yAlt … />                        unchanged props, unchanged position in the DOM
<div className="dock" data-testid="dock">
  <section className="dock-card" data-testid="hud">      ← keeps the testid
    <div className="hud-stage" data-testid="stage-name"> [n] Name  {reduced flag}
    <JourneyBar … />
    <div className="dock-row">
      {!reduced && stage < FLY_DOWN_END ? <button data-testid="fly-down"> : null}
      {stage === 0 || stage === 3 ? <button data-testid="reset-view"> : null}
    </div>
    {stage === 3 ? <orbit readout + live region + hint> : null}
    {stage === LAST_STAGE ? <fp-controls row, unchanged> : null}
  </section>

  <details className="dock-fold" data-testid="view-fold">
    <summary>View and light</summary>
    date · hour · floor area                  ← moved verbatim, same testids
  </details>

  <Panel … />                                 ← same props, now a flow child
  <Sources />                                 ← same markup, now a flow child
</div>
```

Deleted from this file: `ORBIT_CONTROLS`, `NUDGE_BY_KEY`, the six orbit buttons, the `.hud-scrub`
stage row, the contrast toggle, `contrastChosen`, the `prefers-contrast` effect (it moves to
`CameraRig` in step 6), and `high`/`setHighContrast`.

Kept exactly: `nudgeOrbit`, `readOrbit`, `sayOrbit`, `STEP_DEG`, `ZOOM_PER_PRESS`, `ANNOUNCE_MS`,
the announce effect, the piece-key effect, the bracket effect, `TAP`, `ISO_DATE`, `clock`,
`placeFace`, `FP_ROW_MAX`, `copyLink`, and the whole first-person row. `nudgeOrbit` survives because
step 8 gives it a window handler; the buttons that called it do not.

New handlers:

```tsx
const onScrub = (u: number) => {
  const { stage: s, t: k } = fromJourney(u, params);
  setJourney(s, k);
};
```

### 5c — `app/globals.css`

New block, replacing `.hud`'s fixed positioning and deleting `.hud.hud-room` outright:

```css
/* ---------- P10: one dock, top right, at every stage ----------

   WHAT THIS REPLACES, AND THE MEASUREMENT THAT KILLED IT. The HUD was fixed
   bottom-centre and moved to the top at stage 5 (.hud.hud-room, deleted below). Measured
   at 1440 x 900: at stage 3 its box was [451, 989, 541, 886] -- 538 x 345 px directly over
   the base of Weld Hall, the one building the stage exists to show. The stage-5 move was
   itself a correct fix for a real defect (the fit-out's 29 anchors land at y 589-716 and a
   bottom HUD sat on every one of them), and it is what made the chrome inconsistent: three
   positions across six stages, plus the fly-down at a fourth.
   One column at the right edge answers both. The bottom of the frame is where the model
   is at every stage; the right edge is where the dimension panel already lived. */
.dock {
  position: fixed;
  top: var(--s2);
  right: var(--s2);
  z-index: var(--z-panel);
  width: min(23rem, calc(100vw - 2 * var(--s2)));
  /* One scroll container, so two open disclosures cannot push the third off screen. The
     body is overflow: hidden for the canvas's sake, so anything taller than this would be
     CLIPPED rather than scrolled -- the same defect .gate records at 375 x 500. */
  max-height: calc(100dvh - 2 * var(--s2));
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-family: var(--mono);
  /* The empty column must not eat drags meant for the room behind it. Both
     .a11y-alt-dock and Panel.module.css's .dock already make this move. */
  pointer-events: none;
}
.dock > * { pointer-events: auto; }
```

`.dock-card` takes the HUD's old chrome — `--chip-scan` ground, `--rule` border, 2 px radius, 0.7/0.85
rem padding — with `align-items: stretch` instead of `center`, since a full-width scrubber is the
card's subject.

`.jbar` and `.jbar-ticks`: the input at `width: 100%`, `min-height: 44px` (the existing
`.hud-t input` rule already covers it, but the bar is not inside a `.hud-t`, so it is restated with
a comment saying so); the tick row `position: relative; height: 44px` with each button
`position: absolute; transform: translateX(-50%)`, 44 x 44 per MASTER. The two end ticks get
`transform: translateX(-50%)` clamped by `margin` so stage 0 and stage 5 do not overhang the card —
measured at build time, not guessed.

`.skip` moves to the centre so the top-left corner is free:

```diff
 .skip {
   position: fixed;
   top: var(--s2);
-  left: var(--s2);
+  /* CENTRED, so .a11y-alt-dock can sit in the corner it is aligned to. The top-left was
+     reserved for a control that is off-screen until focused, which cost the written
+     description 52 px of misalignment (P10.md 1.2). The centre is free now that the
+     fly-down has moved into the dock. */
+  left: 50%;
   z-index: var(--z-toast);
-  transform: translateY(-200%);
+  transform: translateX(-50%) translateY(-200%);
 }
-.skip:focus-visible { transform: translateY(0); }
+.skip:focus-visible { transform: translateX(-50%) translateY(0); }
```

and the dock for the written description finally aligns with itself:

```diff
 .a11y-alt-dock {
   position: fixed;
-  top: calc(var(--s2) + 44px + var(--s1));
+  /* var(--s2), matching its own `left`. The 44 px it used to add was clearance for .skip,
+     which is now centred. */
+  top: var(--s2);
   left: var(--s2);
```

Retired: `.hud`'s `position/left/transform/bottom/max-width`, `.hud.hud-room` (whole rule),
`.fly`'s `position/left/transform/top/z-index` (the chrome stays, it is a dock button now), and
`.sources`'s `position/left/bottom/z-index/max-width` (`width: 100%` in the column instead). Each
deletion keeps its comment, rewritten to say where the rule went and why — those comments carry
measurements that are still true and still the reason the layout is what it is.

`.imagery-chip` stays bottom-right. Its comment enumerates which corner holds what; it gets
corrected, since four of the five entries are now wrong.

### 5d — `src/ui/Panel.module.css`

`.dock` stops being a dock:

```diff
 .dock {
-  position: fixed;
-  top: var(--s2);
-  right: var(--s2);
-  z-index: var(--z-panel);
-  width: min(23rem, calc(100vw - 2 * var(--s2)));
+  /* A FLOW CHILD of globals.css's .dock since P10, not a fixed dock of its own. Two fixed
+     columns in one corner was the collision this phase removes; the outer dock owns the
+     position, the width and the scroll. */
+  width: 100%;
   display: flex;
   flex-direction: column;
-  align-items: stretch;
   gap: 0.4rem;
-  font-family: var(--mono);
-  pointer-events: none;
 }
-.dock > * { pointer-events: auto; }
```

`Panel.tsx` itself: unchanged, except the `.dock` div gains nothing and loses nothing. Its
`max-height` on the open form is dropped, because the outer dock scrolls now.

**Check.**

1. `node scripts/p10-measure.mjs` — the `[data-testid="hud"]` box is **identical at all six stages
   to within 1 px**, and its left edge is `>= 1058` at 1440 wide. Nothing is at bottom-centre.
2. `npx playwright test a11y` — axe clean at all six stages, both with the dock's folds open and
   shut. (`a11y.spec.ts` itself is amended in step 6; this run is the axe half only.)
3. At 1024 and 1440: `document.body.scrollWidth === window.innerWidth`, per MASTER's breakpoints.
4. Screenshots at all six stages, saved to `design/renders/p10-stage-N.png`, eyeballed for the one
   thing a box check cannot see: that no control paints its glyphs onto the bare WebGL frame, which
   is the defect `globals.css:353`'s `.hud-orbit .hud-scrub` rule records.

**Commit.** `Put every control in one column at the top right, and stop moving it between stages`

---

## Step 6 — the sun, the sources, the area, and the end of the contrast button

Mostly a move, one deletion. Split from step 5 so the layout restructure and the control inventory
are separately revertable.

- `sun-date`, `sun-hour`, `sun-time` and `area-readout` move inside `<details data-testid="view-fold">`,
  markup and handlers unchanged. `TAP` and the `ISO_DATE` guard travel with them.
- `<Sources/>` renders inside the dock. `Sources.tsx` is not edited at all — its position was always
  CSS.
- The contrast toggle and its 24-line docblock are deleted from `Hud.tsx`. The docblock's argument —
  that a preference control must be present at every stage — is what made it a control in the first
  place; it is quoted into the CSS comment that records the removal, because the honest summary is
  that the control should never have existed for a preference the platform already reports.
- The `prefers-contrast: more` effect moves to `CameraRig.tsx`, beside the
  `prefers-reduced-motion` one, and becomes an unconditional mirror:

```ts
useEffect(() => {
  const mq = window.matchMedia("(prefers-contrast: more)");
  setHighContrast(mq.matches);
  const onChange = () => setHighContrast(mq.matches);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}, [setHighContrast]);
```

Unconditional now, where `Hud.tsx`'s version was guarded by `contrastChosen`: that guard existed only
so a button press could out-vote the media query, and there is no button. The store field, the
`Campus.tsx` stroke arithmetic and MASTER's 2.5 px all survive untouched.

**`tests/e2e/contrast.spec.ts`** — the largest test edit in the phase, 505 lines. What survives and
what goes:

| test | fate |
|---|---|
| `prefers-contrast: more` seeds the flag (`:385`) | **kept**, minus the "and the control still overrides it" half, which no longer has a control. Renamed. |
| `__campus.lineWidth` is 2.5 CSS px at DPR 1 and at DPR 2 (`:373` neighbourhood) | **kept.** This is MASTER:144's surviving half and the reason the probe exists. |
| the stroke-histogram pixel measurement | **kept.** It is what proves the multiplier reaches the GPU. |
| `massOpacity` is 0.22 (`:373`) | **deleted** in step 10 with the mass fill. Left passing at step 6 and removed there, so this step's diff is layout-only. |
| every test that clicks `contrast-toggle` (`:90, :183, :268, :308, :400, :429`) | **rewritten** to drive `browser.newContext({ contrast: "more" })` instead of a click. Six call sites. |
| the `aria-label` assertion (`:191`) | **deleted** with the button. |

**`tests/e2e/a11y.spec.ts`**:

- `threshold-t` → `journey` at `:319`. The 40-event live-region flood test is otherwise unchanged and
  is now measuring the master bar, which is the control that can flood it.
- The axe node-count docblock at `:124-131` names `contrast-toggle` and `.hud-orbit > span` among
  fifteen colour-contrast nodes. Re-measured and rewritten with the new count. **The number is
  whatever it measures**; it is not adjusted to make a test pass.
- The stage-5 box gate at `:456-470`: `.a11y-alt-dock` vs `[data-testid="hud"]` vs
  `[data-testid="sources"]`. Sources is now inside the dock, so `hits(a, c)` compares the left dock
  against an element in the right one. Rewritten as dock-left vs dock-right, which is the property
  that actually matters, with the boxes logged as before.

**Check.** `npx playwright test a11y contrast` green. `node scripts/p10-measure.mjs`: the
`a11y-alt-toggle` box top is **14**, down from 66, and its left is 14 — aligned with itself.

**Commit.** `Fold the sun into a disclosure and retire the contrast button the platform already answers`

---

## Step 7 — the trackpad drives the descent, and the globe turns

**`src/state/store.ts`**:

```ts
  /**
   * How far the viewer has turned the globe at stage 0, or null for "as stages.ts posed it".
   *
   * NOT CARRIED BY A LINK, on the same argument url.ts makes about `flying` and
   * `firstPerson`: it is where the recipient is looking, not what the model is. Null rather
   * than {0, 0} so "untouched" is a distinct state and [Reset the view] has something to
   * restore.
   */
  globeSpin: { yawDeg: number; pitchDeg: number } | null;
  setGlobeSpin: (s: { yawDeg: number; pitchDeg: number } | null) => void;
```

Cleared by `resetAll`, absent from `hydrate`'s parameter list and from `url.ts`. No `VERSION` bump.

**`src/scene/globeRig.ts`** — two pure functions, tested rather than eyeballed:

```ts
/**
 * The camera pose, rotated about the Earth's centre.
 *
 * WHICH AXES, AND WHY NOT THE OBVIOUS ONE. Rotating about the line from Earth's centre
 * through Weld -- site +Y -- spins the picture around the marker and shows no new
 * geography at all. To bring another face round, the axis has to be PERPENDICULAR to that
 * line, so yaw turns about site +Z (south) and pitch about site +X (east). Both keep
 * |p - centre| exactly, so the altitude above the surface is unchanged and the globe's
 * angular size does not move while it is being turned.
 *
 * BOTH the position and the target are rotated, so the disc stays framed and it is the
 * EARTH that turns under the camera. Rotating the position alone would swing the camera
 * off to one side and point it at the same spot, which is a pan, not a spin.
 *
 * `k` scales the rotation, and it is how the descent survives being aimed: CameraRig passes
 * (1 - t), so at the bottom of leg 0 the pose is exactly kf[1] however far the globe was
 * turned. Without it a viewer could spin Cambridge over the horizon and then descend into
 * the Pacific.
 */
export function spinPose(
  position: Vec3,
  target: Vec3,
  spin: { yawDeg: number; pitchDeg: number },
  k: number,
): { position: Vec3; target: Vec3 };

/**
 * Is a point on the proxy sphere on the near side of it?
 *
 * dot(n, v) > radius / distanceToCentre, where n is the point's outward normal and v the
 * direction from the centre to the camera. That is the exact horizon condition, and it is
 * here rather than inline in Globe.tsx because the marker's material has depthTest off --
 * so nothing else stops it drawing straight through the Earth, and a marker visible on the
 * far side is the defect that only appears once the globe can be turned.
 */
export function aboveHorizon(nDotV: number, radius: number, distanceToCentre: number): boolean;
```

`spinPose` clamps `pitchDeg` to ±80. Beyond that the camera approaches the axis `lookAt` uses to
resolve roll, which is the same degeneracy `STAGE0_TILT_DEG`'s docblock refused 0.3° of tilt for.

**`src/scene/CameraRig.tsx`** — the pointer/wheel effect is restructured. It currently mounts only at
stage 3; it now mounts at every stage and dispatches:

| stage | drag | wheel (and ctrl+wheel, i.e. macOS pinch) |
|---|---|---|
| 0 | turn the globe — writes `globeSpin` | scrub the journey |
| 1, 2 | — | scrub the journey |
| 3 | orbit — writes `orbit`, unchanged | orbit radius, unchanged (`ZOOM_PER_NOTCH`) |
| 4 | — | scrub the journey |
| 5 | — | — (the interior is not a zoom; the walker owns the pointer) |

```ts
/** Share of the whole journey per notch of wheel. 50 notches end to end. */
const SCRUB_PER_NOTCH = 0.02;
```

Chosen against the alternatives: 0.05 (20 notches) overshoots a stage per flick on a trackpad, and
0.005 needs 200 notches, which is a minute of scrolling. Both tried on hardware at step 7's check.

The scrub path calls `setJourney(...fromJourney(u ± d))` and sets `scrubbing` true for 120 ms after
the last notch — a wheel gesture has no pointerup, and without the hold the camera eases between
notches and reads as syrupy.

Pose selection gains one branch:

```ts
const posed =
  stage === 0 && globeSpin
    ? spinPose(want.position, want.target, globeSpin, 1 - t)
    : want;
```

**`src/ui/Hud.tsx`** — `[Reset the view]`, mounted at stages 0 and 3 only, because those are the two
stages with a view to reset. `setGlobeSpin(null)` at 0, `setOrbit(null)` at 3. `data-testid="reset-view"`.

**Tests.**

`tests/globeRig.test.ts`:

| assertion |
|---|
| `spinPose(p, t, {0,0}, k)` is the identity for every `k` |
| `spinPose(p, t, spin, 0)` is the identity for every `spin` |
| `|p - centre|` is preserved to `1e-9` under every spin, so altitude does not drift |
| yaw 180° puts the camera on the far side: `dot(before, after)` about `-1` after removing the centre offset |
| pitch clamps at ±80 |
| `aboveHorizon` is true on the sub-camera point, false on the antipode, and flips exactly at `acos(radius / distance)` |

`tests/e2e/wheel-and-spin.spec.ts`, new:

| assertion |
|---|
| at stage 1, ten wheel notches down increase `__cam.u` monotonically and decrease `__cam.alt` |
| ten notches up reverse it to within one notch |
| at stage 3, wheel changes `__cam.position` radius and leaves `__cam.u` alone |
| at stage 0, a 200 px drag changes `__cam.position` by more than 1% of the distance to Earth's centre |
| after that drag, scrubbing to `u = boundaries[1]` puts `__cam.position` at `kf[1]` to within `MOVE_EPS` — the `(1 - t)` guarantee |
| `reset-view` at stage 0 restores the pose to `kf[0]` |
| **sign check, by screenshot rather than by maths**: drag right at stage 0, and the crimson marker's `cx` moves right. The sign is a choice and `CameraRig`'s existing comment is explicit that the drag's direction is the established convention; this is the gate that keeps the two agreeing. |

**Check.** The above, plus `SCRUB_PER_NOTCH` tried by hand on a trackpad at 3010 before the constant
is committed.

**Commit.** `Make the wheel descend and the globe turn, so the whole journey is a trackpad gesture`

---

## Step 8 — stage 3 loses its buttons and keeps its keys

`ORBIT_CONTROLS` and the six buttons are already gone (step 5). This step re-homes the keys they
carried, so the deletion never costs the keyboard path.

**`src/ui/Hud.tsx`** — a window handler mounted at stage 3, alongside the piece-key and bracket
handlers, with the same guard set and for the same reasons:

```ts
/**
 * The orbit keys, on the window, at stage 3 only.
 *
 * ON THE WINDOW because the six buttons that used to carry them are gone -- P10 took every
 * on-screen control off the canvas at this stage -- and the canvas cannot hold focus
 * meaningfully: there is nothing inside it to focus. Which is what makes the guards
 * load-bearing rather than defensive, exactly as they are on the two handlers above:
 *
 *   the stage gate   arrow keys belong to the walker at stage 5 and to a selected piece
 *                    at stage 5; mounting by stage rather than branching inside keeps one
 *                    owner per key per stage.
 *   the target gate  every dimension in the panel is a range input, the master scrubber is
 *                    one, and both sun controls are. Claiming an arrow while one has focus
 *                    would make them unusable by keyboard, which is the exact failure this
 *                    project keeps finding.
 *   no modifiers     Cmd+Arrow and Alt+Arrow are platform navigation.
 *
 * STEP_DEG, ZOOM_PER_PRESS and nudgeOrbit are unchanged from when buttons called them. The
 * derivation in their docblocks -- 15 presses end to end on both the polar span and the
 * radius, matched to one wheel notch and to 14 px of drag -- is why the keys still feel
 * like the pointer, and none of it moved.
 */
```

`NUDGE_BY_KEY` survives verbatim: `ArrowLeft/Right` azimuth ±5°, `ArrowUp/Down` polar ±5°,
`PageUp`/`+`/`=` closer, `PageDown`/`-`/`_` further. The `=`/`_` entries stay for the reason the
original docblock gives — on a US layout an unshifted press of the `+` key reports `=`.

What is on screen at stage 3, in the dock card:

```tsx
<div className="dock-orbit" role="group"
     aria-label="Orbit the camera around Weld"
     aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown PageUp PageDown"
     data-testid="orbit-keys">
  <span className="tabular" data-testid="orbit-readout" aria-hidden="true">{readOrbit(here)}</span>
  <span className="dock-hint">drag to orbit · scroll to zoom · arrows and +/− also work</span>
  <span className="hud-sr" aria-live="polite" aria-atomic="true" data-testid="orbit-live">{said}</span>
</div>
```

`data-testid="orbit-keys"` is kept on the group even though it holds no buttons, because it is the
group the shortcuts are advertised on. The hint is `--faint` at 0.6875 rem — measured at 5.03:1 on
`--void-deep` in `Panel.module.css`'s ledger, over MASTER's 4.5 floor.

**Check.** `tests/e2e/orbit-keys.spec.ts`, new:

| assertion |
|---|
| each of the ten keys moves `__cam.position` at stage 3, by the amount `STEP_DEG` / `ZOOM_PER_PRESS` predicts within 1% |
| a held `ArrowLeft` (30 `keydown`s, no `keyup`) moves 30 steps, not 1 — the `getState()`-not-closure property `nudgeOrbit`'s docblock exists for |
| `[` typed into `sun-date` changes neither `stage` nor `orbit` |
| `ArrowRight` while the master scrubber has focus scrubs and does **not** orbit |
| `orbit-live` announces once, throttled, after a burst — the existing `ANNOUNCE_MS` behaviour |
| the six `orbit-*` button testids are **absent** from the DOM at every stage |

**Commit.** `Move the orbit keys onto the window, since the buttons they duplicated are gone`

---

## Step 9 — the marker becomes a pin, and hides behind the Earth

**`src/scene/Globe.tsx`**.

```ts
/**
 * The marker's angular radius, degrees.
 *
 * 0.32 deg is 5.0 px of radius at 900 px tall and a 45 deg vertical fov: the fov spans
 * 900 px, so one degree is 20 px. DERIVED, and it replaces a fixed 0.022 of the sphere's
 * radius, which measured 32 x 32 px on the rendered frame -- 87 miles of radius at Earth's
 * true scale, a disc from Albany to Portland (P10.md 1.4).
 *
 * A CONSTANT ANGLE rather than a constant fraction of the globe, because the globe's
 * angular size barely changes over stage 0's dwell but its proxy radius changes with `far`
 * at every altitude. Pinning the angle is what makes the pin the same size on screen
 * wherever the descent has got to.
 */
const MARKER_DEG = 0.32;

/** Ring radius, as a multiple of the dot's. 2.6 reads as a target rather than as a blob. */
const MARKER_RING = 2.6;
```

The marker becomes a group of two meshes — the dot (`sphereGeometry(1, 16, 12)`, unit radius, scaled
per frame) and a ring (`ringGeometry(MARKER_RING - 0.25, MARKER_RING, 32)` with
`side: DoubleSide`, billboarded to the camera). Both keep `depthTest: false`, `depthWrite: false`,
`ORDER.marker`, and the crimson `#e4526f`.

In the frame loop, after `rig` is computed:

```ts
const m = markerGroup.current;
if (m) {
  m.getWorldPosition(MARKER_WORLD);                       // module-level scratch Vector3
  const d = MARKER_WORLD.distanceTo(camera.position);
  // The group sits inside a group scaled by rig.radius, so a local scale s renders as
  // s * rig.radius feet. Solve for the world radius the angle asks for.
  m.scale.setScalar((d * Math.tan(MARKER_DEG * DEG)) / rig.radius);

  // Nothing depth-tests against this sphere, so the horizon has to be done by hand.
  N.copy(MARKER_WORLD).sub(CENTRE).normalize();
  V.copy(camera.position).sub(CENTRE).normalize();
  m.visible = aboveHorizon(N.dot(V), rig.radius, rig.distanceToCentre);
}
```

Three module-level scratch vectors, allocated once: this runs sixty times a second and
`new THREE.Vector3()` in a frame loop is the allocation pattern `Globe.tsx`'s own header objects to
for the sphere geometry.

**Check.**

| assertion | expected |
|---|---|
| `scripts/p10-measure.mjs` `marker` at stage 0 | `w` and `h` in **9–12 px**, from 32 |
| the marker's centre is still within 2 px of the globe's projected centre at spin 0 | unchanged framing |
| spin the globe 180° (`setGlobeSpin({yawDeg: 180, pitchDeg: 0})`), then scan for crimson | **zero** matching pixels |
| spin 90°, marker present and off-centre | the horizon flip happens at the limb, not at the centre |
| `tests/globeRig.test.ts` | `aboveHorizon` unit assertions from step 7 |

**Commit.** `Shrink the orbit marker to a pin, and stop it drawing through the Earth`

---

## Step 10 — colour, solid buildings, and brick before the threshold

Last, largest-risk, and the one step whose files another branch is likely to be holding. Three
independent sub-steps, committed together only if all three pass; separately if not.

### 10a — the ground keeps its colour

`src/scene/Ground.tsx`, two constants:

```diff
-const TINT_MAX = 0.82;
+/**
+ * How far the tint goes at full strength.
+ *
+ * 0.22 SINCE P10, down from 0.82, and the 0.82 is worth keeping in the record because its
+ * reasoning was sound and its result was not. It argued that a fully tinted photograph is a
+ * flat blue rectangle and that 18% of the image left is enough for paths across the Yard to
+ * read under the cyanotype. Measured on the shipped build, a 360 x 200 ground patch at
+ * stage 3 came back mean rgb (64, 74, 92) -- a blue monochrome, which is the thing the
+ * paragraph was trying to avoid, one step further on. The tint band clamps to 1.0 below
+ * 400 ft, so stage 3 got the whole of it.
+ *
+ * 0.22 is a GRADE rather than a substitution: enough to tie the photograph to the palette,
+ * not enough to take its colour. The band in altitude.ts is unchanged, so WHEN the grade
+ * arrives is unchanged; only how far it goes.
+ */
+const TINT_MAX = 0.22;

-const SAT_MIN = 0.25;
+/** Saturation left at full tint. 0.90 since P10: the desaturation was the other half of
+ *  the monochrome, and a 10% pull is enough to stop the grade reading as a colour cast. */
+const SAT_MIN = 0.9;
```

Nothing else in the file moves. `FADE`, the Chebyshev rim, the four quads, the loader: untouched.

### 10b — the campus becomes solid, and its roofs are photographs

**New `src/scene/aerial.ts`** — an `onBeforeCompile` skin, deliberately the same shape as
`Threshold.tsx`'s `attachPaletteSeam`, which is this project's established way to add a term to a
lit material without giving up the lighting:

```ts
/**
 * Sample a georeferenced plate by WORLD POSITION, on top of a lit standard material.
 *
 * WHY onBeforeCompile AND NOT A ShaderMaterial. The massing has to stay lit by Lighting.tsx
 * -- the sun's direction is the whole reason the campus reads as three-dimensional rather
 * than as coloured shapes -- and a raw ShaderMaterial gives that up along with the shadow
 * map. Threshold.tsx's attachPaletteSeam solves the identical problem the identical way and
 * is the precedent; this is the second consumer of that idiom rather than a new one.
 *
 * WHICH PLATE, AND THIS IS MEASURED. L4 is 1,600 x 1,600 ft at 0.52 ft per texel.
 * campus.json's 36 buildings span x -551.0..597.5 and y -649.6..618.8, so the whole campus
 * sits inside L4 with 150.4 ft of margin on its tightest side -- asserted in
 * tests/imagery.test.ts rather than trusted, because a building whose roof sampled outside
 * the plate would clamp to an edge texel and come out as a smear.
 *
 * THE UV IS (x - minX) / width AND (-z - minY) / height, matching Ground.tsx's
 * `position={[quad.cx, 0, -quad.cy]}`: the plane's +y becomes world -z after its rotation,
 * and world -z is north. Getting this wrong mirrors the roofs against the ground they stand
 * on -- and frames.ts:13-17 warns that a mirror in this project is invisible.
 */
export function attachAerialSkin(
  material: THREE.MeshStandardMaterial,
  uniforms: AerialUniforms,
): void;
```

The injected fragment work, in the diffuse stage:

```glsl
vec2 aUv = vec2((vWorldPos.x - uMinX) / uWidth, (-vWorldPos.z - uMinY) / uHeight);
vec3 photo = texture2D(uAerial, aUv).rgb;
// Roofs get the photograph; walls get it darkened and pulled toward the wall tone, because
// an aerial has no wall pixels at all -- the only honest thing to put on a facade is a tone
// consistent with the roof above it.
float up = smoothstep(0.55, 0.95, clamp(vWorldNormal.y, 0.0, 1.0));
vec3 wall = mix(uWall, photo * 0.55, 0.25);
diffuseColor.rgb *= mix(wall, photo, up) / max(diffuseColor.rgb, vec3(1e-4));
```

The extrusions have flat roofs (`extrude.ts`), so a roof normal is `y = 1` exactly and a wall normal
`y = 0` exactly. The smoothstep is therefore a clean split with no interpolation to tune — it is
there so a future non-flat roof degrades to a blend rather than to a hard line.

**Shared texture.** `Ground.tsx` already loads L4 for its innermost quad. A second `TextureLoader`
call here would upload a second 640 KB texture for the same file. So `imagery.ts` gains:

```ts
/**
 * One THREE.Texture per level per process, reference counted.
 *
 * Ground's Q4 quad and Campus's roof skin both want L4, and two TextureLoader calls means
 * two GPU uploads of the same 640 KB plate -- the browser caches the FETCH, not the upload.
 * Counted rather than leaked, so a level whose last consumer unmounts is disposed.
 */
export function sharedTexture(id: string, onReady: (t: THREE.Texture) => void): () => void;
```

`loadTexture` stays exactly as it is and `sharedTexture` is a thin cache over it, so the AVIF →
WebP fallback and the `colorSpace`/`anisotropy`/`ClampToEdge` handling are not duplicated.
`Ground.tsx`'s `Quad` switches to it; that is a two-line change and it is the whole reason the
texture count in `__perf` should not move.

**`src/scene/Campus.tsx`**:

- both `<meshStandardMaterial>`s: `transparent` off, `opacity` gone, `depthWrite` back to default,
  `roughness` 0.85, `metalness` 0, and `attachAerialSkin` applied to each.
- `massAt`, `MASS_OPACITY`, `CONTRAST_MASS`, `MASS_CEILING`, `HIGH_CONTRAST_GAIN` deleted, along with
  the 40-line docblock deriving the ramp — replaced by a shorter note recording that P9.md §6.9's
  full occlusion is now achieved by the buildings being opaque, which is what that section asked for
  and what an opacity ramp capped at 0.34 could not do.
- Weld's pulse moves from `opacity` to `emissiveIntensity`, over the same `WELD_PULSE` range and the
  same `1.6` rad/s, with `emissive` set to `SCAN.edgeHi`. Reduced motion holds it at
  `WELD_PULSE.reduced`, unchanged.
- `window.__campus` keeps `highContrast`, `dpr`, `lineWidth`, `weldLineWidth`; loses `massOpacity`
  and `massCeiling`, and gains `weldEmissive` so the third non-hue signal is still assertable.
- the edge `<Line>`s stay. They are Weld's second signal and, on the other 35 buildings, what keeps
  a solid massing from reading as a lump.

**`tests/labels.test.ts`**: the whole `massAt` block (`:121-173`) goes, including
`expect(MASS_CEILING).toBeLessThan(0.5)`. That assertion existed to stop somebody "finishing" the
occlusion by raising the ceiling; the occlusion is now finished a different way, so the guard has
nothing to guard. The deletion is recorded in the file rather than silent.

**`tests/imagery.test.ts`**: new assertion — campus bbox ⊂ `quadOf("L4")` with ≥ 100 ft of margin on
every side. Measured margin today: 150.4 ft (y minimum). If a future plate shrinks, this fails
before a roof smears.

### 10c — Weld wears brick before the threshold

`src/scene/WeldExterior.tsx`:

```diff
-  const progress = 1 - opacity;
+  /**
+   * How far the palette has resolved from cyanotype into brick: an ALTITUDE ramp since P10,
+   * not the dissolve.
+   *
+   * It read `1 - opacity`, and thresholdOpacity() returns shell: 1 for every stage below 4 --
+   * so progress was 0 for the whole descent and the building was a blue ghost box at stage 3,
+   * which is the complaint P10 exists to answer. The brick, the sandstone belts and the slate
+   * were all in the file and none of them was ever seen before the wall started dissolving.
+   *
+   * layerOpacity(alt).tint is the SAME 40,000 -> 400 ft band the ground resolves on, so the
+   * building and the photograph under it stop being a drawing at the same rate, which is what
+   * makes the descent read as one continuous resolve rather than two effects.
+   *
+   * WHAT THIS COSTS, STATED RATHER THAN HIDDEN. The header above argues for driving the
+   * palette from the dissolve so the payoff is not spent early: "an exterior that lerps from
+   * cyan to brick over the threshold spends the payoff on a dissolve". P10 spends it earlier
+   * on purpose. The threshold now does one thing -- it dissolves the shell -- and the palette
+   * change is the descent's.
+   */
+  const [progress, setProgress] = useState(0);
+  useFrame(({ camera }) => {
+    const want = layerOpacity(camera.position.y).tint;
+    // Quantised to 1/64, because `progress` feeds a useMemo that writes three materials'
+    // uniforms, and a per-frame React state write here is the stall useWeldCut's docblock
+    // records buying a throttle for. 64 steps across the ramp is under a pixel of seam
+    // movement per step at stage 3.
+    if (Math.abs(want - progress) >= 1 / 64) setProgress(want);
+  });
```

`shell` keeps using `opacity` and `REDUCED_CUT` exactly as now, so the dissolve is untouched. The
reduced-motion note in that docblock — "the exterior never wears brick under reduced motion, because
the only ways to show it would be an animated seam or a second hard cut" — **stops being true and
that is a fix**: the seam is now a function of altitude, and a reduced-motion viewer who scrubs down
to stage 3 sees brick, with no animation involved.

**`tests/e2e/threshold.spec.ts`**: the palette-at-`t` assertions move to palette-at-altitude. The
lit-pixel and empty-frame gates are unchanged in intent; their thresholds are re-measured, since a
brick building at stage 4 has a different histogram from a cyanotype one.

### Checks for step 10

| # | check | expected |
|---|---|---|
| 1 | ground patch saturation at stage 3 vs the same patch with `uTint` forced to 0 | ≥ 0.75x. Baseline: `0.321` against an untinted control to be measured in the same run |
| 2 | brick is present at stage 3 | a hue histogram over Weld's projected box has a peak in 10–30° (brick) where the baseline has none |
| 3 | `__perf.calls` at stage 3 | ≤ 30, from 28 |
| 4 | `__perf.textures` at stage 3 | unchanged from 25 — the proof `sharedTexture` works |
| 5 | median frame time, stage 3, headless | no worse than +15% on 93.5 ms. Recorded headed on real hardware too, per `FlyDown.tsx`'s precedent about not tuning to SwiftShader |
| 6 | `npx playwright test campus imagery threshold contrast perf` | green, with every re-measured threshold recorded in the test's own comment |
| 7 | roofs are not mirrored | the committed overlay in `design/renders/` — Ground.tsx's own method for this exact question — compared against a fresh render |

**If check 3 or 5 fails**: drop the roof texture, ship the buildings flat-shaded in a warm neutral.
Still solid, still 3D, still occluding. `attachAerialSkin` and `sharedTexture` come out; 10a and 10c
stand on their own.

**Commit.** `Let the descent resolve into a colour photograph, solid buildings and brick`
(or three commits, if any sub-step has to be dropped)

---

## Step 11 — the whole suite, and the one measurement that can still veto this

**Run, in order:**

```
npm run typecheck
npm test
npx playwright test                       # all 11 spec files plus the 3 new ones
node scripts/p10-measure.mjs --out verify-run/p10-final.json
```

**The veto.** `Experience.tsx:160-180` records that 17 of the 29 pieces are pointer-reachable from
the stage-5 hall shot, and gates furniture editing on that being true. The dock now occupies
`x 1058..1426` for the full height of the frame at 1440 wide. `reach` in the measurement script is
that same projection test.

- **≥ 17 reachable**: ship. Update `Experience.tsx`'s comment with the new figure and the new
  occluder either way — that comment is a measurement, and a stale measurement is worse than none.
- **< 17**: the dock gets a collapse-to-a-strip state at stage 5 — a 44 px tall header with the
  stage name and the bar, everything else folded — before this phase is called done. Not optional,
  and not deferred to a later phase, because it would be a regression to the one interaction the
  suite exists for.

**Also re-measure and write into the docs:**

- `docs/phases/P10.md` §1's table, marked as the before, next to the after.
- `design/renders/p10-stage-{0..5}.png`, at 1440 x 900, committed. The repo already keeps stage
  renders per phase and they are how a look change is reviewed.
- `design-system/MASTER.md` gains the amendment section, text below.

**MASTER.md amendment**, to be appended verbatim:

```md
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
```

**Commit.** `Re-measure everything P10 moved, and record the four departures from MASTER`

---

## Appendix A — every constant this phase introduces or changes

| constant | file | value | status |
|---|---|---|---|
| `TRANSIT_SPAN` | `journey.ts` | 0.60 | CHOSEN, reasoned |
| `THRESHOLD_SPAN` | `journey.ts` | 0.90 | CHOSEN, reasoned |
| `MIN_SPAN` | `journey.ts` | 0.05 | guard |
| slider `step` | `JourneyBar.tsx` | 0.0005 | DERIVED from the widest leg |
| `SCRUB_PER_NOTCH` | `CameraRig.tsx` | 0.02 | CHOSEN, tried on hardware |
| scrub-hold after a notch | `CameraRig.tsx` | 120 ms | CHOSEN |
| `MARKER_DEG` | `Globe.tsx` | 0.32° | DERIVED — 5.0 px at 900 px, 45° fov |
| `MARKER_RING` | `Globe.tsx` | 2.6 | CHOSEN |
| pitch clamp | `globeRig.ts` | ±80° | reasoned from `lookAt` roll degeneracy |
| `TINT_MAX` | `Ground.tsx` | 0.82 → **0.22** | CHANGED, measured |
| `SAT_MIN` | `Ground.tsx` | 0.25 → **0.90** | CHANGED, measured |
| roof-normal smoothstep | `aerial.ts` | 0.55 → 0.95 | clean split on flat roofs |
| wall mix | `aerial.ts` | `mix(uWall, photo * 0.55, 0.25)` | CHOSEN |
| `progress` quantum | `WeldExterior.tsx` | 1/64 | throttle, reasoned |
| **deleted** | `Campus.tsx` | `MASS_OPACITY`, `CONTRAST_MASS`, `MASS_CEILING`, `HIGH_CONTRAST_GAIN`, `massAt` | |

## Appendix B — derived numbers, with their derivations

```
leg 0 span    log10(31,353,347 / 16,332)          = 3.2831
leg 1 span    log10(16,332 / 815)                 = 1.3018
leg 2 span    log10(815 / 110)                    = 0.8698
total         3.2831 + 1.3018 + 0.8698 + 0.6 + 0.9 = 6.9547
ticks         0, 3.2831, 4.5849, 5.4547, 6.0547, 6.9547  / 6.9547
            = 0, 0.4720, 0.6592, 0.7843, 0.8706, 1.0000

slider res    2000 steps * 0.4720 = 944 steps in leg 0 -> t resolution 0.00106
marker angle  45 deg fov / 900 px = 20 px per deg; 5 px / 20 = 0.25 deg of radius,
              0.32 deg after the ring's 1 px stroke is allowed for
L4 margin     campus y -649.6..618.8 against L4's -800..800 -> 150.4 ft, tightest side
tint at alt   ln(40000/alt) / ln(100):  16,332 -> 0.194   815 -> 0.845   110 -> clamped 1.0
```

## Appendix C — test-edit ledger

| file | lines | action |
|---|---|---|
| `tests/journey.test.ts` | new | step 1 |
| `tests/e2e/journey-continuity.spec.ts` | new | step 3 |
| `tests/e2e/wheel-and-spin.spec.ts` | new | step 7 |
| `tests/e2e/orbit-keys.spec.ts` | new | step 8 |
| `tests/store.test.ts` | +6 assertions | step 2 |
| `tests/stages.test.ts` | +4 assertions | step 4 |
| `tests/globeRig.test.ts` | +7 assertions | steps 7, 9 |
| `tests/imagery.test.ts` | +1 assertion | step 10 |
| `tests/place.test.ts` | +1 module in the graph walk | step 1 |
| `tests/labels.test.ts` | −53 lines (`massAt` block) | step 10 |
| `tests/e2e/a11y.spec.ts` | 3 edits | step 6 |
| `tests/e2e/contrast.spec.ts` | 6 rewrites, 2 deletions | steps 6, 10 |
| `tests/e2e/threshold.spec.ts` | testid + palette assertions | steps 5, 10 |
| `tests/e2e/journey.spec.ts` | testid | step 5 |
| `tests/e2e/campus.spec.ts` | re-measured thresholds | step 10 |
| `tests/e2e/imagery.spec.ts` | re-measured thresholds | step 10 |
| `tests/e2e/edit.spec.ts` | draw calls + reach | step 11 |
| `tests/e2e/perf.spec.ts` | re-baselined | step 10 |
| `tests/url.test.ts` | **untouched** — the proof no wire format moved | — |
| `tests/e2e/{walk,smoke,desktop-only}.spec.ts` | **untouched** | — |

## Appendix D — rollback

Eleven commits, each green on its own. Reverting any one leaves a working app:

| step | revert leaves |
|---|---|
| 1–2 | dead code, no behaviour change |
| 3 | the boundary cuts come back; everything else stands |
| 4 | stage 3 → 4 is a cut again; the bar still works, one leg reads as a jump |
| 5 | the old three-position HUD; the bar comes back with it, in the old card |
| 6 | the contrast button returns; the sun leaves the fold |
| 7 | no wheel travel, no globe spin |
| 8 | no orbit keys — **do not revert alone**, it is what keeps the step-5 button deletion accessible |
| 9 | the 87-mile dot |
| 10 | the cyanotype |
| 11 | docs only |

The one coupling: **step 8 must not be reverted without step 5**, since step 5 deletes the buttons
and step 8 is the keyboard path that replaces them. Every other pair is independent.
