# P10 implementation plan — step by step, with the verification for each

Companion to `P10-WALK-IN.md`, which holds the diagnosis, the decisions and the rationale. This
file is the execution order: what gets edited, in what sequence, what command proves it, and what
the commit says. Spec approved 2026-07-31, including all three judgment calls (double-click lock,
arrows follow the selection, brackets live at stage 5).

**Workspace.** `~/Code/weld15-walkin`, branch `p10-walk-in`, base `8e6ef50`.
Dev server on **:3007** (other sessions hold 3000/3001). Three sibling worktrees are live —
`weld15` (main), `weld15-p10` (`p10-fidelity`), `weld15-ux` (`p10-ux`) — so **every** git command
below runs inside this worktree, `git status` is checked before each commit, and nothing is
pushed or merged without asking.

**Global rules for the whole phase.**
- One commit per step. Seven steps, seven commits, each independently green.
- No `--no-verify`, no force anything, no rebase onto a branch another session owns.
- Test edits are part of the step that causes them, never a separate "fix the tests" commit.
- Any pinned number that moves gets investigated, not re-pinned.

---

## Step 1 — `standingPose()`, and kf[5] built from it

Pure refactor. Behaviour must not change at all.

### 1a. `src/scene/route.ts`

Add after `standIn()` (currently ends line 130):

```ts
export type StandingPose = {
  p: Vec2;          // where the viewer stands
  aim: Vec2;        // the plan point the stage-5 shot aims at
  drop: number;     // ft below eye height the aim sits at
  heading: number;  // walk.ts's convention: 0 faces +v, rising turns toward +u
  pitch: number;    // radians, negative is down
};

export function standingPose(suite: Suite): StandingPose;
```

Body is the arithmetic lifted verbatim from `stages.ts:415-419`, both branches:

```ts
const hall = suite.rooms.find((r) => r.id === HUB);
const bedB = /* same lookup stages.ts already has */;
const p    = hall ? standIn(hall) : { u: bedB.u + 2.5, v: bedB.v + 2.5 };
const aim  = hall
  ? { u: hall.u + hall.du / 4, v: hall.v }
  : { u: bedB.u + bedB.du - 2, v: bedB.v + bedB.dv - 1 };
const drop = 2;
const run  = Math.hypot(aim.u - p.u, aim.v - p.v);
return { p, aim, drop, heading: Math.atan2(aim.u - p.u, aim.v - p.v), pitch: -Math.atan2(drop, run) };
```

Docblock states: why the module is the home (owns `standIn`, `HUB`, the reachability graph;
already imported by both `stages.ts` and `store.ts`, so no new edge); why `drop` is carried as a
number rather than folded into `pitch` (the keyframe must be reconstructible bit-for-bit, §1b);
and the measured values at default params — `p = (18.75, 29.75)`, `heading = 184.51°`,
`pitch = −7.965°`, which are the numbers read off the live keyframe in the spec's §1.

`bedB` lookup: `stages.ts` already has the rect in scope. In `route.ts` it must be found the same
way `stages.ts` finds it — read that code before writing this, and if the fallback needs anything
`route.ts` cannot see, keep the fallback in `stages.ts` and have `standingPose()` take the two
rects as arguments instead. **Do not invent a second way of finding bedroom B.**

### 1b. `src/scene/stages.ts`

Replace lines 415-419 with:

```ts
const pose = standingPose(suite);
const inHall = suiteToThree(pose.p.u, pose.p.v, floor + EYE, params);
const hallTarget = suiteToThree(pose.aim.u, pose.aim.v, floor + EYE - pose.drop, params);
```

Expressions are moved, not rewritten: same operands, same order, so the floats are identical.
Keep the whole draw-call comment above it (lines 400-414) — it is about the shot, not the code.
Import `standingPose` alongside the existing `HUB, route, standIn` (line 18); drop `standIn` from
that import only if it has no other use in the file.

### 1c. Tests

- `tests/route.test.ts`, new case: `standingPose(buildSuite())` gives `p` equal to
  `standIn(hall)`, `heading` within 1e-12 of `atan2(aim.u - p.u, aim.v - p.v)`, `pitch` within
  1e-9 of `-7.965°` in radians, `drop === 2`; and the no-hall fallback lands inside bedroom B's
  rect.
- `tests/stages.test.ts`, one **added** assertion (nothing edited): kf[5]'s `position` and
  `target` equal `suiteToThree` of `pose.p` / `pose.aim` at `floor + EYE` and
  `floor + EYE - pose.drop`, exactly — `toBe`-level equality on each component, not `toBeCloseTo`.
  This is the pin that keeps the shot and the walker from drifting apart in either direction.

### Verify

```
npm run typecheck
npx vitest run tests/route.test.ts tests/stages.test.ts tests/frames.test.ts tests/place.test.ts
```

Every pre-existing stage-5 assertion must pass **with no edit**. If one moves, revert 1b and find
out why before continuing — that assertion is the whole safety net for this refactor.

**Commit:** `One source for where you stand: kf[5] is built from the pose the walker uses`

---

## Step 2 — pitch enters the walk state

### 2a. `src/scene/walk.ts`

```ts
export const PITCH_LIMIT = (85 * Math.PI) / 180;
export type WalkState = { p: Vec2; heading: number; pitch: number };
export type WalkInput = { forward: number; strafe: number; turn: number; pitch: number };
export const NO_INPUT: WalkInput = { forward: 0, strafe: 0, turn: 0, pitch: 0 };
```

`walk()` gains, immediately after the `heading` line:

```ts
const pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, state.pitch + input.pitch * TURN_RATE * dt));
```

and returns `pitch` on **both** exit paths — the zero-magnitude early return (line 655) and the
moved return (line 669). Both are load-bearing: looking around while standing still is the
common case, and it goes through the early return.

Nothing else in the module changes. `step()`, `resolve()`, `pushOut()`, `clearance()`,
`insideSuite()`, `roomAt()` and every solid are untouched.

Docblocks to write:
- `PITCH_LIMIT`: **above** — `camera.lookAt` with `up = (0,1,0)` is degenerate when the view
  direction is parallel to up, so ±90° is unavailable; **below** — at 85° the floor is
  `5.833 / tan(85°) = 0.51 ft` ahead of the eye and the ceiling `4.917 / tan(85°) = 0.43 ft`, so
  85° already looks at your own feet and the remaining 5° buys nothing.
- Pitch rate reuses `TURN_RATE` deliberately: level to the limit is 0.71 s, the same order as the
  1.5 s a 180° turn takes, so one held key does not feel faster than the other. Stated, not
  duplicated as a second constant.
- **Clamped, not wrapped**, beside `wrap()`: a bearing is circular and a pitch is not. A viewer
  holding `F` must stop looking down, not roll over backwards.
- Module header, the height paragraph (lines 30-34): one sentence that pitch is dropped by the
  plan maths for the same reason height is — every wall band is a vertical prism, so no pitch can
  change which side of a vertical face the walker is on.

### 2b. `tests/walk.test.ts`

Mechanical: add `pitch: 0` to the 15 `WalkState`/`WalkInput` literals (lines 578, 943, 947, 957,
964, 966, 969, 974 and the rest — grep `heading:` and `turn:`). Required rather than optional on
purpose: an optional field with a `?? 0` fallback hides a writer that forgot to carry it, and
this state has three writers already.

New cases:
1. **clamps both ways and does not wrap.** From pitch 0, `input.pitch = -1` for 100 frames of
   dt 0.1 lands exactly on `-PITCH_LIMIT`; the same with `+1` on `+PITCH_LIMIT`. Then one more
   frame at the limit changes nothing.
2. **pitch does not move the walker.** The same 40-frame walk run at pitch 0, `+PITCH_LIMIT` and
   `-PITCH_LIMIT` returns bit-identical `p` (`toEqual` on the object). This is the property that
   says walking stays horizontal however far down you look.
3. **the walker does not move the pitch.** `forward`, `strafe` and `turn` with `pitch: 0` leave
   pitch untouched, including across a collision that triggers the per-axis retry.
4. **the early return carries pitch.** `walk(state, {…, forward: 0, strafe: 0, pitch: -1}, dt)`
   with no translation still turns the head.
5. the existing tunnelling, corner, absurd-step and randomised-sweep cases pass unchanged.

### Verify

```
npm run typecheck && npx vitest run tests/walk.test.ts
```

**Commit:** `A head that turns: pitch joins the walk state, clamped rather than wrapped`

---

## Step 3 — the store: standing is a property of stage 5

### 3a. Deletions

- `goToPlace` — the action (lines 712-730), its entry in the `Store` type (292), and its
  docblock. This is the click-to-teleport feature.
- `leaveFirstPerson` — the action (690) and its type entry (288). There is no mode to leave.
- Any import left orphaned by the two (`standIn` from `route.ts` if nothing else uses it — check,
  do not assume).

### 3b. `pointerLocked`

New field `pointerLocked: boolean` (initial `false`) and `setPointerLocked: (v: boolean) => void`.
Docblock: it is a fact about the browser's input state, in the same class as `reducedMotion`, and
it is therefore absent from `url.ts`, from `hydrate()`'s parameter list and from `resetAll()`.
`Experience.tsx` is its only reader and `FirstPerson.tsx` its only writer.

### 3c. `enterFirstPerson()` keeps its name, changes three things

```ts
enterFirstPerson: () => {
  const s = get();
  const suite = buildSuite(s.params);
  const ctx = walkContext(suite);
  const pose = standingPose(suite);
  for (const spot of places(suite)) {
    if (!isClear(spot.p, ctx)) continue;
    const room = suite.rooms.find((r) => r.id === spot.id)!;
    set({
      firstPerson: {
        p: spot.p,
        heading: spot.id === HUB ? pose.heading : arrivalHeading(room),
        pitch: pose.pitch,
        room: spot.id,
      },
      selected: null,
      flying: false,
      // no notice — see D7
    });
    return;
  }
  set({ notice: `Refused: ${noRoomToStand("Every room in this suite")}` });
},
```

- heading and pitch from `standingPose()` in the hub case, so arrival at stage 5 is continuous
  with the fly-down's last frame — the 8° snap the phase exists to remove.
- `arrivalHeading(room)` survives for the fall-through rooms (a suite whose hall is unstandable),
  with the same pitch.
- No notice on success. The keys are in the HUD row; a toast on every stage change is noise.
- `flying: false` stays, and its comment is rewritten: the reason is no longer "the viewer would
  press Escape and be somewhere else" but simply that two things must not own the camera.

### 3d. Seeding on arrival, one helper, seven call sites

```ts
function walkerFor(stage: StageId, params: SuiteParams): FirstPerson | null;
```

Returns a verified seed when `stage === LAST_STAGE` and `null` otherwise — the same `places()` /
`isClear()` / `standingPose()` logic as 3c, factored so that `enterFirstPerson` and the seven
transitions cannot disagree. `enterFirstPerson` becomes the thin wrapper that also writes the
refusal notice and drops `selected`.

Call sites, each replacing `firstPerson: null`:

| line | action | after |
|---|---|---|
| 530 | `setStage` | `firstPerson: walkerFor(stage, s.params)` |
| 541 | `next` | `walkerFor(nextStage, s.params)` |
| 548 | `prev` | `walkerFor(prevStage, s.params)` |
| 555 | `skipToSuite` | `walkerFor(LAST_STAGE, s.params)` |
| 560 | `flyStep` | `walkerFor(next, s.params)` |
| 791 | `resetAll` | `walkerFor(get().stage, DEFAULT_PARAMS)` — params are being reset, so the seed uses the new ones |
| 825 | `hydrate` | `walkerFor(s.stage, s.params)` — a link that opens at stage 5 opens standing |

`setStage` becomes a function-form `set` where it needs `s.params`. The comment at 521-529 is
rewritten: a stage change no longer destroys the walker, it *decides* whether there is one.

### 3e. `setParams`'s wedge branch re-seeds (lines 604-624)

```
wedged  →  next = walkerFor(LAST_STAGE, params)
           next ? "A wall closed onto where you were standing, so you were moved to <room>."
                : the existing noRoomToStand refusal, walker null
```

Only when the walker is genuinely no longer clear — the "leaves a walker alone when the slider
does not reach it" case must still pass untouched, which is what stops the sliders from
teleporting you on every pointer move.

### 3f. `tests/store.test.ts` — rewrite the `first person` describe (lines 415-593)

Keep:
- seeds in the hall, `p === standIn(hall)`, `isClear`, `clearance` 1.5 ft at shipped params.
- drops `selected`.
- `hallWidth: 1` falls through past the hall to a standable room.
- the all-1 params case refuses in words and leaves the walker null.
- "leaves a walker alone when the slider does not reach it".

Change:
- heading is `standingPose().heading` (≈184.5°), **not** `π` — the old `toBeCloseTo(Math.PI)`
  assertion is now wrong and its comment ("so entering first person does not spin the camera")
  becomes true for the first time.
- pitch is `standingPose().pitch` ≈ −0.139 rad.
- no notice on a successful seed; the `/Escape/` assertion goes.
- "leaves, and leaves on a stage change as well" becomes **"seeds on arrival and drops on
  departure"**: `setStage(5)`, `next()` into 5, `skipToSuite()`, `flyStep()` to 3 then on to 5,
  `hydrate({stage: 5, …})` and `resetAll()` at stage 5 each leave a walker; `setStage(2)` and
  `prev()` off 5 leave null.
- the wedge case loses its `goToPlace("bedB")` setup (use `setWalk` to put the walker at
  `{u: 8, v: 39}` in bedroom B) and asserts the re-seed plus the "you were moved" wording.

Delete:
- every `leaveFirstPerson` case (462-464, 493, 582).
- the whole `goToPlace` describe content: "jump-cuts to a named place" (475-495), "refuses a room
  nobody can stand in" (497-511), "refuses an id this suite has no room for" (559-564). Their
  subject no longer exists. The refusal *wording* they covered is still exercised by the all-1
  params case, so `noRoomToStand` keeps a test.

### Verify

```
npm run typecheck && npx vitest run
```

Full unit suite, not just `store.test.ts` — `url.test.ts`'s anti-drift cases enumerate snapshot
fields and must be seen to be unaffected by the new store field.

**Commit:** `Standing is where you are at stage 5, not a mode you enter`

---

## Step 4 — the input half, and who owns the pointer

### 4a. `src/scene/FirstPerson.tsx`

1. **`PITCH_KEYS = { r: 1, R: 1, f: -1, F: -1 }`**, folded into `held`, the same
   `preventDefault()`, the same form-field guard, and added to the `in FORWARD_KEYS || …` test at
   line 274.
2. **Arrows yield to a selection.** When building the input, if
   `useStore.getState().selected !== null`, ignore `ArrowUp/Down/Left/Right` — read from the
   store at frame time, not closed over, so a deselect takes effect on the next frame.
   `w/a/s/d/q/e/r/f` are never affected. Docblock: selection only ever happens by pointer pick,
   so a keyboard-only viewer never has one and loses nothing (D6).
3. **`pendingDy`** beside `pendingDx`, fed from `e.movementY` in the locked `pointermove`.
   Applied as `walker.pitch - dy * perPxY`, `perPxY = LOOK_PITCH_DEG * π/180 / max(1, clientHeight)`,
   `LOOK_PITCH_DEG = 360`. Docblock: `CameraRig`'s `DRAG_TURN_DEG` convention on the axis a
   vertical look uses — a full screen height is a full turn, 0.5 deg/px at 720, the whole ±85°
   range in 340 px of mouse. **`turnSign` is not applied**: the east/west reflection is a plan
   reflection and cannot change which way is up. Sign un-inverted: mouse down looks down.
4. **The clamp stays in `walk()`.** The pointer's pitch goes in through `state.pitch` exactly as
   the pointer's yaw goes in through `state.heading`, so there is one clamp in the app.
5. **Escape stops leaving.** Delete the `if (e.key === "Escape") { leave(); return; }` block and
   the `leave` selector. The browser releases pointer lock on Escape itself.
6. **`onLockChange`** becomes `setPointerLocked(document.pointerLockElement === el)` and nothing
   else. The `if (locked.current && !now) leave()` line goes, and the "one press, one exit"
   paragraph (lines 310-315) is replaced by what Escape means now: it gives the mouse back.
7. **The lock is requested on `dblclick`** (D5), not `pointerdown`. Listener swapped on the same
   element, promise still caught for the `journey.spec.ts` console-error gate. Docblock carries
   the reason from the spec's §3.1: a single click cannot both lock and pick, because
   `FirstPerson` is a DOM listener and `DragLayer` sees the same DOM event through R3F, so
   `stopPropagation` in either does not suppress the other — after Escape, the next click on a
   bed would re-lock and editing would be reachable for zero clicks. `dblclick` is a gesture
   `DragLayer` never uses.
8. **Cleanup** must also `setPointerLocked(false)` on unmount, beside the existing
   `exitPointerLock()`.
9. **`WalkProbe` gains `pitch: number`**, published on both the active and the inactive branch,
   so an e2e gate can read the look without recomputing it from the camera.
10. **`firstPersonPose()`** applies the pitch:

```ts
const horiz = LOOK_AHEAD * Math.cos(walker.pitch);
const rise  = LOOK_AHEAD * Math.sin(walker.pitch);
const ahead = { u: walker.p.u + Math.sin(walker.heading) * horiz,
                v: walker.p.v + Math.cos(walker.heading) * horiz };
return { position: suiteToThree(walker.p.u, walker.p.v, eye, params),
         target:   suiteToThree(ahead.u, ahead.v, eye + rise, params) };
```

Docblock: at the ±85° limit `horiz` is 0.87 ft — three orders above float noise at suite scale,
so `lookAt` never sees a degenerate direction.

11. **The header's level-eye paragraph (lines 38-45) is rewritten**, keeping its measurements as
    the record of why level-only was tried and why it was wrong: the floor entering the frame
    9.7 ft ahead is true, and irrelevant to a viewer who wants to look at the floor they are
    standing on.

### 4b. `src/scene/Experience.tsx`

`edit={stage === LAST_STAGE && !pointerLocked}` (add the selector; `walking` may become unused —
remove it if so, it is used elsewhere in the file for nothing else). Rewrite the tail of the
comment at 194-200 to the new rule: the pointer belongs to look while locked and to furniture
while not, and the arrows follow the selection.

### 4c. `src/scene/CameraRig.tsx`

No code change expected. Its `walking` un-settle effect (173-176) is still correct — the pose
source still changes when a walker appears or goes. Update the docblock sentence that describes
leaving first person as a cut (168-171): the case it describes can no longer happen from a
button, only from a stage change.

### Verify

```
npm run typecheck
node verify-run/p10-look.mjs      # the §6.3 script, written in step 7
```

and by hand at :3007 before moving on: arrive at stage 5 without clicking anything, hold `F`,
watch the floor fill the frame, hold `R`, watch the ceiling.

**Commit:** `Look down: the mouse and R F drive a pitch, and the pointer has one owner at a time`

---

## Step 5 — the HUD row loses two controls and keeps three

### `src/ui/Hud.tsx`

Delete:
- the `toggle` / `places` branch entirely (782-828) — `fp-enter`, `fp-leave`, the seven
  `fp-go-*` buttons.
- `placeFace()` (103), the `places` import (10), the `spots` memo (400), and the
  `enterFirstPerson` / `leaveFirstPerson` / `goToPlace` selectors (329-331).
- `reduced ? "go to" : "walk"` (780) → `walk`.
- `if (walking) return` from the bracket effect (556). Rewrite the "first person" row of its
  guard table (542-545): a stage change no longer destroys a walker, so there is nothing to
  guard, and leaving it in would make `[` and `]` permanently dead at stage 5.
- `|| walking` from the piece-nudge effect's condition (510), and rewrite the P7 paragraph
  (504-509) to D6's rule.

Keep and adjust:
- the row itself, its `role="group"`, its `aria-label`, `FP_ROW_MAX`, `fp-controls`.
- `fp-readout`: room label / "in a doorway" / **"nowhere to stand"** for the refusal case. The
  "not walking" branch goes.
- `fp-keys`: unconditional now, text
  `W A S D walk and turn · Q E sidestep · R F look up and down · double-click to look with the mouse, Esc to release`.
  Check it still wraps inside `FP_ROW_MAX` at 375 px — the overflow bug fixed in `bd10fa2` was
  this row.
- `fp-live`: sentences become the room, the doorway, or the refusal. "First person is off" goes.
- `walkReading` / `saidWalk` simplified accordingly; `spots` is gone, so the label lookup goes
  straight to `suite.rooms`.

### Verify

```
npm run typecheck && npm run test
npx playwright test tests/e2e/a11y.spec.ts --grep "tab order"
```

plus a 375 px screenshot of the row to confirm nothing lands on the bare canvas.

**Commit:** `No menu to arrive by: the walk row keeps its readout and its keys`

---

## Step 6 — the gates

### `tests/e2e/walk.spec.ts`

- `Walk` probe type gains `pitch`.
- `openInTheRoom()` drops the `fp-enter` wait. `standUp()` becomes `awaitWalker()`: poll
  `__walk.active === true` and `frames > 2` with **no click at all** — that poll is the gate for
  "you arrive standing".
- Delete: "stands up and leaves again, by keyboard alone" (222-247), the `fp-go-bedB` gate (441),
  the `fp-go-hall`/`fp-go-bedB` pair (478-508) and the `aria-pressed` assertion.
- New, **look up and down**: hold `F` until `__walk.pitch` settles; assert −85° ± 0.5°, and that
  the camera's own pitch recomputed in node from `__cam.position` and `__cam.target` agrees
  within 0.1°. Hold `R` to +85°. Assert `u`/`v` unchanged across both.
- New, **the floor is in the frame**: at −85°, ray the camera forward against the floor plane in
  node and assert the hit is inside the hall's rect and within 2 ft of the walker.
- New, **arrival is continuous**: sample `__cam` across the stage-5 settle and assert pitch stays
  within −7.965° ± 0.2° — the snap, as a gate.
- New, **nothing teleports**: `page.getByTestId(/^fp-go-/)` has count 0, and `fp-enter` /
  `fp-leave` have count 0.
- Unchanged: every wall, tunnelling, absurd-step and doorway gate, and the node-side
  `violation()` recomputation that makes them real.

### `tests/e2e/a11y.spec.ts`

- "the written description follows the walker into another room" (263-293) is rewritten to hold
  keys — `A`/`D` to aim, `W` to walk — until `__walk.room === "bedA"`, then back to the hall.
  Replace its comment about using the place menu with why the menu is gone.
- Delete its closing "leaving first person hands the sentence back to the stage" block.
- Re-run the tab-order gate rather than reasoning about it: it runs at stage 0 and should still
  be `skip → a11y-alt-toggle → fly-down → stage-0`.
- axe at stage 5 re-run against the shorter row.

### `tests/e2e/contrast.spec.ts:486-505`

Inverted: with a walker always present, `[` now steps to stage 4. Assert that. The
`fp-enter`/`fp-leave` waits and the Escape-to-release-the-guard half go.

### `tests/e2e/edit.spec.ts`

Run untouched. It must stay green because headless Chromium refuses pointer lock (measured:
`locked: false` after a canvas click), so `pointerLocked` is false and `edit` is true. If it
fails, the fix is in the `edit` predicate, not in the spec file.

### Everything else

`journey`, `smoke`, `perf`, `threshold`, `campus`, `imagery`, `desktop-only` reference none of the
removed controls. Run in full; `journey.spec.ts` fails on any console error, which is the guard
on the deleted pointer-lock and Escape paths.

### Verify

```
npm run test
npx playwright test
```

Both green, whole suite, no `--grep`. Report the counts.

**Commit:** `The gates: you arrive standing, you can look at the floor, and nothing teleports`

---

## Step 7 — pictures, docs, and the handover

1. `verify-run/p10-look.mjs` — the six-shot pass from the spec's §6.3: arrival (assert
   `__walk.active` already true and `__cam` pitch −7.97°), `F` held, `R` held, walked into
   bedroom A on foot, the HUD row, and a console-error check at every step. Screenshots into
   `verify-run/`, which is untracked and stays untracked.
2. Read the shots. Confirm by eye: floorboards fill the frame at −85°, ceiling at +85°, no HUD
   control offers a room.
3. `docs/phases/P10-WALK-IN.md` gets a "what actually happened" section: every divergence from
   this plan, every number that came out different from the prediction, and anything found on the
   way. That is the repo's habit (see `1c2a7b4`, `6372eb3`) and it is the record that matters
   most if this is revisited.
4. `git status` in **all four worktrees** before the final commit. If any of the other three has
   moved onto files this branch touches, say so rather than merging anything.
5. Report: test counts, the measured pitches, the screenshots, and what is left. **No push, no
   merge to `main`, no deploy** without asking.

**Commit:** `The verification run, and what the plan got wrong`

---

## Checklist

- [ ] 1 `standingPose()` + kf[5] refactor — stage-5 pins pass unedited
- [ ] 2 pitch in `walk.ts`, clamped ±85°, walking stays horizontal
- [ ] 3 store seeds at stage 5; `goToPlace` and `leaveFirstPerson` gone; `pointerLocked` in
- [ ] 4 `R`/`F` + `movementY`; Escape releases the mouse only; `dblclick` locks; `edit` follows the lock
- [ ] 5 HUD row: toggle and seven place buttons gone, readout + keys + live region kept
- [ ] 6 unit suite green, e2e suite green, whole thing, no greps
- [ ] 7 screenshots read, divergences written down, four worktrees checked, nothing pushed
