# P10 — Walk in, or do not arrive: no teleport, no toggle, and a head that turns

Branch `p10-walk-in`, worktree `/Users/arhanbarve/Code/weld15-walkin`, cut from `main` at `8e6ef50`.
Three other worktrees are live on the same repo (`weld15-p10`/`p10-fidelity`, `weld15-ux`/`p10-ux`,
and `main` itself), so nothing here touches `main` and nothing here is committed to it.

---

## 1. What is wrong, measured

Measured on a dev build of `8e6ef50` at 1280 × 720, stage 5, default params. `pitch` is
`atan2(target.y - position.y, hypot(target.x - position.x, target.z - position.z))` read off
`window.__cam`.

```
stage-5 keyframe   position 18.363, 17.833, -53.110   target 16.204, 15.833, -38.980   pitch −7.965°
after "stand up"   position 18.363, 17.833, -53.110   target 16.079, 17.833, -43.374   pitch  0.000°
300 px drag down   (no change)                         target 16.079, 17.833, -43.374   pitch  0.000°
```

**(a) Standing up tilts the view UP by 8° and then pins it there.** `stages.ts:418` aims the
stage-5 shot at `floor + EYE - 2`, i.e. 2 ft below the eye at 14.3 ft — that is the −7.965°.
`firstPersonPose()` (`FirstPerson.tsx:170-183`) aims at exactly eye height, so the pose the
walker hands `CameraRig` is dead level. Pressing "stand up" therefore rotates the frame 8°
upward off the shot the fly-down just landed on, and there is no way to get it back: the yaw
also jumps, from 180.0° to 184.5°, because the seed uses `arrivalHeading(room)` (`π`) rather
than the keyframe's own aim.

**(b) There is no vertical look input anywhere in the app.** `FirstPerson.tsx:331` accumulates
`e.movementX` only; `movementY` is discarded. `CameraRig`'s pointer-drag listeners are mounted
at stage 3 only (`CameraRig.tsx:195`). `walk.ts`'s `WalkState` is `{ p, heading }` — no pitch
field exists, and `FirstPerson.tsx:38-45` records level-eye as a deliberate choice, arguing the
62° vertical field reaches 31° below level so the floor "enters the frame 9.7 ft ahead". That
argument is why the app feels like it is looking up: in a 10 ft 9 in bedroom you are standing
closer to the floor you want to look at than 9.7 ft.

**(c) Click-to-teleport is the HUD place row**, `Hud.tsx:811-826` → `goToPlace()`
(`store.ts:712-730`). Seven buttons: `fp-go-hall`, `fp-go-common1`, `fp-go-k`, `fp-go-bedA`,
`fp-go-bath`, `fp-go-bedB` (the row renders `hall` twice — once as a button, once as the
readout). Nothing in the 3D scene teleports; there is no room picking on the canvas.

**(d) The stand-up/leave toggle** is `fp-enter` / `fp-leave` in the same row
(`Hud.tsx:784-809`). `firstPerson` is null on boot and is dropped by every stage change
(`store.ts:530, 541-554, 555, 560`), by `hydrate` (`825`), by `resetAll` (`791`), and when a
slider closes a wall onto the walker (`621`).

---

## 2. Goal

At stage 5 you are always standing in the suite and you can always move and look freely. The
only way into a room is to walk through its doorway. There is no mode to enter or leave, and no
control that sends you anywhere.

### Non-goals

- No change to stages 0–4, to the descent, to the globe, to the imagery, or to any keyframe
  except through the refactor in §4.3, which is required to be bit-identical.
- No new camera collision, head bob, crouch, jump, or vertical movement. Walking stays
  horizontal at `EYE` however far down you are looking.
- No change to `url.ts`'s wire format. The walker is not in a link today and is not added.
- No redesign of the HUD beyond deleting the two dead controls from one row.
- No change to `walk.ts`'s plan-collision maths. Pitch is dropped by `step()` exactly as height
  already is.

---

## 3. Decisions

Four were put to you and answered; three more are mine and are flagged as such.

| # | Decision | Source |
|---|---|---|
| D1 | Pointer-lock arbitration: mouse look takes the pointer under lock; with the lock released the pointer edits furniture | yours |
| D2 | `R` looks up, `F` looks down, for keyboard-only viewers | yours |
| D3 | Arrival pitch and yaw come from the stage-5 shot, derived, not from a constant | yours |
| D4 | The HUD walk row keeps its readout, its key legend and its live region; only the toggle and the seven place buttons go | yours |
| D5 | **The lock is requested on a DOUBLE-click, not a click** | mine, §3.1 |
| D6 | **Arrow keys go to a selected piece; the walker keeps W A S D Q E R F** | mine, §3.2 |
| D7 | **Arriving at stage 5 is silent; a notice only appears on a refusal or a re-seed** | mine, §3.3 |

### 3.1 Why double-click (D5)

The clean version of D1 does not survive contact with `DragLayer`. Today the lock is requested
on every `pointerdown` on the canvas (`FirstPerson.tsx:320`). If a single click both requests
the lock and picks a piece, then the moment you press Escape to release the lock and click a bed,
that click re-locks — so editing would be reachable for exactly zero clicks. Ordering the two
listeners does not fix it: `FirstPerson` listens on the DOM element and `DragLayer` receives the
same DOM event through R3F's raycaster, so `stopPropagation` in one does not suppress the other.

`dblclick` is a gesture `DragLayer` never uses (it is `pointerdown`/`pointermove`/`pointerup`
only, `DragLayer.tsx:683-685`). So: **double-click the canvas to take mouse look, Escape to give
it back.** Single clicks and drags always belong to furniture. Every walk and look function is
on the keyboard regardless, so the mouse path stays what it is today — an enhancement.

### 3.2 Why the arrows change owner (D6)

`Hud.tsx:510` currently refuses to nudge a selected piece while `walking`, and `walking` is about
to be permanently true at stage 5 — which would make keyboard nudging dead code and delete a
documented accessibility path (`Hud.tsx:499-501`). The other way round is worse: the walker
cannot yield `ArrowLeft` unconditionally, because turning is how a keyboard-only viewer leaves a
room.

The resolution follows from who can select at all: **selection only ever happens by pointer pick**
(`DragLayer` → `onSelect`). A keyboard-only viewer therefore never has a selection, and loses
nothing. So while `selected !== null` the arrow keys nudge the piece and the walker ignores them;
W A S D, Q E and R F keep working throughout, so you can still walk and look with a piece
selected. Deselecting (`Panel`'s own control, or a click on empty floor) hands the arrows back.

### 3.3 Why arrival is silent (D7)

Seeding the walker on every arrival at stage 5 would fire the corner toast on every stage change,
every `]` press and every link open. The keys are already written down in the HUD row, which D4
keeps. So the seed is silent, and a notice is written only when something a viewer must be told
happened: no room is standable (refusal), or a slider closed a wall onto where they stood and
they were moved.

---

## 4. The changes, file by file

### 4.1 `src/scene/walk.ts` — pitch joins the walk state

```ts
export const PITCH_LIMIT = (85 * Math.PI) / 180;   // new
export type WalkState = { p: Vec2; heading: number; pitch: number };   // pitch is new, required
export type WalkInput = { forward: number; strafe: number; turn: number; pitch: number };  // pitch new
export const NO_INPUT: WalkInput = { forward: 0, strafe: 0, turn: 0, pitch: 0 };
```

- `walk()` gains one line before the movement maths:
  `const pitch = clamp(state.pitch + input.pitch * TURN_RATE * dt, -PITCH_LIMIT, PITCH_LIMIT)`,
  and returns it on both exit paths (the early return for a zero-magnitude input, and the moved
  one). Pitch is **clamped, not wrapped** — `heading` wraps because a bearing is circular and
  pitch is not; a viewer who holds `F` must stop looking down, not roll over backwards.
- `step()`, `resolve()`, `roomAt()`, `clearance()` and every solid are untouched. Pitch is
  dropped by the plan maths for the same reason height is (module header, lines 30-34), and the
  header gets one sentence saying so.
- `PITCH_LIMIT` is 85° and the docblock states both bounds: **above**, `camera.lookAt` with
  `up = (0, 1, 0)` is degenerate when the view direction is parallel to up, so ±90° is not
  available; **below**, at 85° the floor is 5.833 / tan(85°) = **0.51 ft** ahead of the eye and
  the ceiling 4.917 / tan(85°) = **0.43 ft**, so 85° already looks at your own feet.
- Pitch rate reuses `TURN_RATE` (120°/s), documented rather than duplicated: level to the limit
  is 0.71 s, which is the same order as the 1.5 s a 180° turn takes.
- The header's "THE EYE IS LEVEL, and there is no pitch anywhere in this file" paragraph in
  `FirstPerson.tsx:38-45` is now false and is rewritten, keeping the measured numbers as the
  record of why level-only was tried.

### 4.2 `src/scene/route.ts` — one source for the standing pose

New export, three-free like the rest of the module:

```ts
export type StandingPose = {
  p: Vec2;        // where the viewer stands, suite frame
  aim: Vec2;      // the point the stage-5 shot aims at, suite frame
  drop: number;   // ft below eye height that aim sits at  (2)
  heading: number; // atan2(aim.u - p.u, aim.v - p.v)      — walk.ts's convention, 0 = +v
  pitch: number;   // -atan2(drop, hypot(aim - p))
};
export function standingPose(suite: Suite): StandingPose;
```

The body is exactly the arithmetic now inlined at `stages.ts:415-419`, including its fallback for
a suite with no hall (`bedB.u + 2.5, bedB.v + 2.5` aimed at `bedB.u + bedB.du - 2,
bedB.v + bedB.dv - 1`), moved rather than reinvented. At the default params it yields
`p = (18.75, 29.75)`, `heading = 184.51°`, `pitch = −7.965°` — the numbers §1 measured off the
live keyframe, which is the check that the move is faithful.

`route.ts` is the right home: it already owns `standIn`, `HUB` and the reachability graph, it is
imported by both `stages.ts` and `store.ts` today, and it introduces no new dependency edge.

### 4.3 `src/scene/stages.ts` — build kf[5] from that pose, bit-identically

`keyframes()` replaces the inlined `stand`/`hallTarget` with `standingPose(suite)` and maps
`pose.p` and `pose.aim` through `suiteToThree` at `floor + EYE` and `floor + EYE - pose.drop`.
The expressions are moved unchanged, so the floats are identical and `tests/stages.test.ts`'s
pins on the stage-5 keyframe must pass **untouched**. That is the verification for this step: if
a stage-5 assertion moves, the refactor was not faithful and is reverted rather than re-pinned.

### 4.4 `src/state/store.ts` — the walker is a property of being at stage 5

- `pointerLocked: boolean` + `setPointerLocked(v)` join the store. Not in `url.ts`, not in
  `hydrate`, not in `resetAll` — it is a fact about the browser's input state, in the same class
  as `reducedMotion`.
- `enterFirstPerson()` keeps its name and its verified-seed loop over `places()`, and changes in
  three ways: it takes `heading` and `pitch` from `standingPose(suite)` when it seeds in the hall
  (so arrival matches the shot exactly, D3), it uses `arrivalHeading(room)` with the same
  `pitch` for the fall-through rooms, and it writes **no notice** on success (D7).
- `leaveFirstPerson()` is **deleted**. There is nothing to leave.
- `goToPlace()` is **deleted**, and with it `standIn`'s only other caller in this module.
- The nine sites that set `firstPerson: null` are split by what they mean:
  - `setStage`, `next`, `prev`, `flyStep`, `skipToSuite`, `hydrate`, `resetAll` — each now seeds
    when the resulting stage is `LAST_STAGE` and nulls otherwise. Implemented as one private
    helper, `walkerFor(stage, params)`, so seven call sites cannot drift.
  - `setParams`'s wedge branch (`store.ts:604-624`) **re-seeds instead of dropping**: if the
    walker is no longer clear, it is moved to the first standable place and the notice becomes
    "A wall closed onto where you were standing, so you were moved to the Hall." If nothing is
    standable, the walker goes null and the existing refusal wording is used.
  - `setWalk` is unchanged: still the raw per-frame write.
- Refusal case (no standable room in the whole suite, reachable only by hand-editing params —
  `store.test.ts:520-560` records the sweep): `firstPerson` stays null at stage 5, `CameraRig`
  falls back to the kf[5] shot, and the HUD readout says so. Degradation, not a crash.

### 4.5 `src/scene/FirstPerson.tsx` — the input half

- `PITCH_KEYS = { r: 1, R: 1, f: -1, F: -1 }`, folded into the same held-key set and the same
  form-field guard. `KeyboardEvent.preventDefault()` on them for the reason the walk keys have
  it.
- Arrow keys are ignored while `useStore.getState().selected !== null` (D6). The check is at the
  point of building the input, not at the listener, so a piece deselected mid-press works on the
  next frame.
- `pendingDy` beside `pendingDx`, fed from `e.movementY` under lock, applied as
  `pitch - dy * perPxY` where `perPxY = LOOK_PITCH_DEG / clientHeight` with
  `LOOK_PITCH_DEG = 360` — `CameraRig`'s `DRAG_TURN_DEG` convention on the axis a vertical look
  uses, i.e. a full screen height is a full turn, so at 720 px it is 0.5 deg/px and the whole
  ±85° range is 340 px of mouse. The sign is un-inverted (mouse down looks down) and
  `turnSign` is **not** applied: the reflection between facades is a plan reflection and cannot
  change which way is up.
- The clamp lives in `walk()` only. The pointer's contribution goes in through `state.pitch`
  the way the pointer's yaw already goes in through `state.heading`, so there is exactly one
  clamp.
- `Escape` no longer calls `leave()`. The handler drops the key entirely: the browser releases
  pointer lock on Escape by itself, and `onLockChange` now only writes `setPointerLocked(false)`.
  The `if (locked.current && !now) leave()` line is deleted — that line was the whole
  "one press, one exit" argument (lines 310-315) and the argument goes with the mode.
- The lock is requested from a `dblclick` listener rather than `pointerdown` (D5). The promise is
  still caught, for the reason at lines 300-309: an unhandled rejection is a console error and
  `journey.spec.ts` fails the run on one.
- `WalkProbe` gains `pitch: number`, so an e2e gate can assert the look without reading the
  camera. `locked` stays.
- `firstPersonPose()` applies the pitch:
  `horiz = LOOK_AHEAD * cos(pitch)`, `rise = LOOK_AHEAD * sin(pitch)`, target at
  `(p.u + sin(h) * horiz, p.v + cos(h) * horiz, eye + rise)`. At the ±85° limit `horiz` is
  0.87 ft, which is three orders above float noise at suite scale.

### 4.6 `src/scene/Experience.tsx` — one prop

`edit={stage === LAST_STAGE && !pointerLocked}` replaces `&& !walking`. The long comment at
lines 194-200 is rewritten to the new rule: the pointer belongs to look while it is locked and to
furniture while it is not, and the arrows follow the selection (D6).

### 4.7 `src/ui/Hud.tsx` — delete two controls, keep the row

- Deleted: the `toggle`/`places` branch (lines 782-828), the `reduced ? "go to" : "walk"` label
  swap, `placeFace()` (line 103), the `places` import, the `spots` memo, and the
  `enterFirstPerson` / `leaveFirstPerson` / `goToPlace` selectors.
- Kept: `walk` label, `fp-readout`, `fp-keys`, `fp-live`, `FP_ROW_MAX`, and the whole row's
  stage-5 mount. The row's aria-label stays "Walk through the suite".
- `fp-readout` loses its "not walking" branch and gains one for the refusal case: the room label,
  "in a doorway", or "nowhere to stand".
- `fp-keys` is no longer conditional on `walking` and reads
  `W A S D walk and turn · Q E sidestep · R F look up and down · double-click to look with the mouse, Esc to release`.
- The bracket-key effect (line 555) loses `if (walking) return`. That guard exists because
  `setStage` dropped the walker mid-stride; the walker is now a property of the stage, so `[`
  simply takes you to stage 4 as it does everywhere else. Without this change `[` and `]` would
  be permanently dead at stage 5, which is a worse trap than the one the guard prevented.
- The piece-nudge effect (line 510) loses `|| walking` per D6.
- `saidWalk`'s "First person is off" wording goes; the live region says the room, or the
  doorway, or the refusal.

### 4.8 `src/ui/A11yAlt.tsx` — no code change

`whereIs()` already prefers the walker over the keyframe (lines 350-370) and its stage-5
keyframe branch simply stops being reachable. Left in place: it is still correct, and it is what
renders in the refusal case.

---

## 5. Build order

Each step is independently verifiable and each ends green before the next starts.

| # | Step | Verify |
|---|---|---|
| 1 | §4.2 + §4.3: `standingPose()` and the kf[5] refactor. No behaviour change. | `npm run typecheck && npx vitest run tests/stages.test.ts tests/route.test.ts` — the stage-5 pins pass **unedited** |
| 2 | §4.1: pitch in `walk.ts`, plus new unit tests | `npx vitest run tests/walk.test.ts` |
| 3 | §4.4: store seeding, deletions, `pointerLocked`, plus rewritten unit tests | `npx vitest run tests/store.test.ts` |
| 4 | §4.5 + §4.6: input, probe, pose, `edit` prop | `npm run typecheck`, then the manual Playwright pass in §6.3 |
| 5 | §4.7: HUD | `npx playwright test tests/e2e/walk.spec.ts` (rewritten in step 6) |
| 6 | Tests: §6.1 and §6.2 in full | `npm run test && npx playwright test` — whole suite, both runners |
| 7 | Screenshot pass, docs, commit | §6.3, then `git status` on all four worktrees before any commit |

---

## 6. Test plan

### 6.1 Unit

**`tests/walk.test.ts`** — new cases:
- pitch clamps at ±`PITCH_LIMIT` from a held key, in both directions, and does not wrap: 10 s of
  `pitch: -1` at dt 0.1 lands exactly on `-PITCH_LIMIT`.
- pitch is unchanged by `forward`, `strafe` and `turn`, and position is unchanged by `pitch`:
  the same walk at pitch 0, +85° and −85° returns bit-identical `p` — the property that says
  walking stays horizontal.
- `NO_INPUT` with a nonzero dt preserves pitch (the early-return path returns it).
- the existing tunnelling, corner and randomised-sweep cases keep passing with `pitch` added to
  their `WalkState` literals.

**`tests/route.test.ts`** — new: `standingPose(buildSuite())` gives `p = standIn(hall)`,
`heading` within 1e-12 of `atan2(aim.u - p.u, aim.v - p.v)`, `pitch` within 1e-12 of −7.965°, and
the no-hall fallback lands inside bedroom B.

**`tests/stages.test.ts`** — one added assertion, no edits: kf[5]'s position and target are
exactly `suiteToThree` of `standingPose()`'s `p` and `aim`, so the keyframe and the walker cannot
drift apart.

**`tests/store.test.ts`** — the `first person` describe is rewritten:
- landing on stage 5 by `setStage`, `next`, `skipToSuite`, `flyStep`, `hydrate` and `resetAll`
  each leave a walker in the hall, clear of every band (`clearance` 1.5 ft at the shipped
  params), with `heading` and `pitch` equal to `standingPose()`'s.
- leaving stage 5 by `setStage(2)` and by `prev()` leaves `firstPerson === null`.
- arrival writes **no** notice (D7).
- the wedge case (`goToPlace("bedB")` is gone, so: seed, `setWalk` to bedroom B's centre,
  `setParams({ sectionLength: 38 })`) re-seeds into the hall and the notice says "you were
  moved".
- `hallWidth: 1` still falls through past the hall to a standable room; the all-1 params case
  still refuses with the existing wording and leaves the walker null.
- `enterFirstPerson()` still drops `selected`.
- deleted: every `leaveFirstPerson` and `goToPlace` case (lines 462-511, 562-592), including the
  "refuses an id this suite has no room for" case, which tested an action that no longer exists.

### 6.2 End-to-end

**`tests/e2e/walk.spec.ts`**
- `openInTheRoom()` drops its `fp-controls` wait for `fp-enter`; `standUp()` becomes
  `awaitWalker()` — poll `__walk.active` and `frames > 2` with no click at all. That poll **is**
  the D-1 gate: arriving at stage 5 with no interaction leaves you walking.
- deleted: "stands up and leaves again" (the Escape half and the `fp-enter` focus half), the two
  `fp-go-*` gates (441, 478-508), and the `aria-pressed` gate.
- new: **look up and down**. Hold `F` until `__walk.pitch` stops changing; assert it settles at
  −85° ± 0.5° and that `__cam`'s own pitch, recomputed in node from position and target, agrees
  within 0.1°. Then hold `R` to +85°. Then assert `__walk.u`, `__walk.v` are unchanged across
  both — looking does not move you.
- new: **the floor is in the frame**, which is the user-visible claim. With pitch at −85°, ray
  the camera's forward direction against the floor plane in node and assert the hit is inside
  the hall's rect and under 2 ft from the walker — i.e. you are looking at the floor you are
  standing on.
- new: **arrival is continuous**. Sample `__cam` on the frame before and after the stage-5
  keyframe settles and assert the pitch never leaves −7.965° ± 0.2° — the 8° snap this phase
  exists to remove, as a gate.
- kept unchanged: every walls/tunnelling/absurd-step/doorway gate, and the `violation()`
  recomputation in node that makes them real.

**`tests/e2e/a11y.spec.ts`**
- "the written description follows the walker into another room" is rewritten to hold `W` (and
  `A`/`D` to aim) until `__walk.room` is `bedA`, then walk back to the hall — the technique
  `walk.spec.ts` already uses, since the `fp-go-*` shortcut it relied on is gone. Its own
  comment explaining why it used the menu is replaced with why it cannot.
- its final "leaving first person hands the sentence back to the stage" block is deleted.
- the tab-order gate is unaffected: it runs at stage 0, and the four stops are `skip`,
  `a11y-alt-toggle`, `fly-down`, `stage-0`. Re-run to confirm rather than assume.
- axe still runs at stage 5, now with a shorter row.

**`tests/e2e/contrast.spec.ts:492-505`** — the bracket-guard block is rewritten: with a walker
present, `[` now **does** step to stage 4, which is the opposite of the old assertion and is the
intended new behaviour. The `fp-enter`/`fp-leave` waits go.

**`tests/e2e/edit.spec.ts`** — expected to pass untouched. Headless Chromium refuses pointer
lock (measured: `locked: false` after a canvas click), so `pointerLocked` stays false and `edit`
stays true. If a future Chromium grants it, these gates fail loudly rather than silently, which
is the right failure. Verified by running the file, not by argument.

**`tests/e2e/journey.spec.ts`, `smoke.spec.ts`, `perf.spec.ts`, `threshold.spec.ts`,
`campus.spec.ts`, `imagery.spec.ts`, `desktop-only.spec.ts`** — no references to the removed
controls. Run in full anyway; `journey.spec.ts` fails the run on any console error, which is the
guard on the deleted pointer-lock path.

### 6.3 Manual verification, with pictures

A Playwright script, not a claim from reading code:
1. Load, click `stage-5`, screenshot. `__walk.active` must already be true and `__cam` pitch
   must be −7.97°.
2. Hold `F` 1 s, screenshot: floorboards fill the frame.
3. Hold `R` 2 s, screenshot: ceiling fills the frame.
4. Walk `W` into bedroom A and screenshot, confirming `__walk.room === "bedA"` — arrived on
   foot, with no button to press.
5. Confirm the HUD row shows only the label, the readout and the legend.
6. Console errors must be empty at every step.

Screenshots land in the worktree under `verify-run/` (already git-ignored by pattern? no — it is
untracked on `main` and stays untracked here).

---

## 7. Risks, and what each one costs

| Risk | Cost if it bites | Mitigation |
|---|---|---|
| kf[5] refactor shifts a float | stage-4→5 blend and six pinned renders move | step 1 passes `tests/stages.test.ts` **unedited**; expressions moved, not rewritten |
| Double-click is undiscoverable | mouse users never find mouse look | every function is on the keyboard; the legend states the gesture; the keyboard path is what the gates test |
| Pointer lock granted in CI | `edit.spec.ts` breaks | it breaks loudly, and the fix is one line in the `edit` predicate; measured false today |
| Auto-seed loops on a refusal | a notice per render | the seed is in store actions keyed to stage transitions, not in a React effect — there is no dependency that can re-fire |
| Re-seed on a slider teleports the viewer | you are moved without asking | only when the wall has actually closed onto you, which is the case that already dropped you; the notice names it |
| `prefers-reduced-motion` viewers lose the jump-to-room control | crossing the suite needs a held key | MASTER.md's reduced-motion rule is about **stage transitions** (line 134), which still jump-cut; the walk is viewer-driven and `CameraRig` copies the walker pose without easing, so no animation is added. Recorded as a divergence in §8 |

---

## 8. Divergences from what the repo already says

Written down rather than quietly contradicted, which is this project's habit.

1. **`docs/phases/P7-P8.md`'s "Escape leaves first person"** is retired. There is no first-person
   mode to leave; Escape releases the mouse and nothing else.
2. **`store.ts:698-711`'s claim that `goToPlace()` is the reduced-motion alternative to walking**
   is retired with the function. §7's last row is the argument.
3. **`FirstPerson.tsx:38-45`'s level-eye paragraph** is retired. Its measurement — floor at 9.7 ft,
   ceiling at 8.2 ft, both inside every room's length — was correct and was still the wrong
   conclusion, because the thing a viewer wants to look at is the floor at their feet. The
   numbers are kept in the rewritten docblock as the record.
4. **`Hud.tsx:542-548`'s first-person guard on the bracket keys** is retired: a stage change no
   longer destroys the walker, so there is nothing to guard.
5. **`store.test.ts`'s "leaves, and leaves on a stage change as well"** becomes "seeds on
   arrival, and drops on departure" — the same property inverted.

---

## 9. Rollback

Everything is on `p10-walk-in` in its own worktree. `git worktree remove` and
`git branch -D p10-walk-in` reverts the whole phase; `main` is never written to until you say so.
Within the branch each of the seven steps is one commit, so step 1 (the kf[5] refactor) can be
kept while the rest is dropped, or the reverse.

---

## 10. What actually happened

All seven steps landed, one commit each, on `p10-walk-in`:

| step | commit | message |
|---|---|---|
| 1 | `328181c` | One source for where you stand: kf[5] is built from the pose the walker uses |
| 2 | `25c2081` | A head that turns: pitch joins the walk state, clamped rather than wrapped |
| 3 | `d89472d` | Standing is where you are at stage 5, not a mode you enter |
| 4 | `076173b` | Look down: the mouse and R F drive a pitch, and the pointer has one owner at a time |
| 5 | `9862608` | No menu to arrive by: the walk row keeps its readout and its keys |
| 6 | `c6a3319` | The gates: you arrive standing, you can look at the floor, and nothing teleports |
| 7 | (this commit) | The verification run, and what the plan got wrong |

**Everything the plan predicted held.** Step 1's kf[5] refactor passed `tests/stages.test.ts`
unedited, as required — no pinned float moved. Step 2's clamp, Step 3's seeding, and Step 4's
pointer-lock arbitration all matched their write-ups with no design change; only the amount of
prose that had to move around `FirstPerson.tsx` and `Hud.tsx` was larger than a single step's
diff suggests, because Step 2's mechanical `pitch: 0` addition and Step 3's deletion of
`goToPlace`/`leaveFirstPerson` each forced small compile-keeping stopgaps in files that a later
step then rewrote for real (`FirstPerson.tsx` in Step 2 and 3, `Hud.tsx` in Step 3). That is
execution ordering, not a divergence: each stopgap was superseded by its own step's real
implementation and none of it survived into the final diffs.

**Two real bugs, both in Step 6's new test helpers, not in the app.** The gates found them, which
is what they are for:

1. `turnToward()`'s first version compared before/after gap sizes after a fixed-duration key
   press to decide which of `a`/`d` was the right one, and that comparison breaks the instant the
   target sits close to directly behind the walker: measured, a walker at heading −3.06 rad held
   `d` for its probe burst, the true turn was −0.33 rad, and wrapping the result into (−π, π]
   landed it at +2.89 — closer to the far side of the wrap seam than to the target — so the
   probe wrongly concluded `d` was the wrong key and held `a` for the rest of the turn, which
   walked the full length of the hall and out through the doorway at the opposite end. Fixed by
   reading `turnSign` straight off `window.__walk`'s own probe (it already says whether `d` adds
   to the heading or subtracts) instead of inferring a direction from before/after comparison.
2. `walkToward()`'s first version turned once toward the target and then held `w` in a straight
   line, and a residual aim well inside the "close enough to stop turning" tolerance still misses
   badly over a room-scale walk: measured, a 0.15 rad (8.8°) residual over a 9.3 ft approach missed
   the doorway by 1.4 ft, which is what left the "doorway is passable" gate stopped short at
   (20.25, 16.25) instead of reaching bedroom B. Fixed by holding `w` for the whole approach while
   re-aiming with a one-processed-frame tap of `a`/`d` whenever the bearing to the target drifts,
   rather than trusting a single turn to hold over the distance.

Both are recorded in the docblocks above `turnToward()` and `walkToward()` in
`tests/e2e/walk.spec.ts`, not just here.

**A process observation, not a code one.** Two background implementation agents stalled mid-task
during Step 6 — each spawned a long-running background test run, reported its intent to wait for
it, and then produced no further activity for the better part of an hour with no completion
notification and no live process left running. Neither left the worktree in a broken state (no
partial commit, no reverted-looking edits), but neither finished on its own either. Both times the
fix was to inspect the worktree directly (`git status`, `git diff`, the last test-results run) to
recover exactly where the stalled agent had actually gotten to, then continue the remaining work
directly rather than delegate a third time. Worth flagging for whoever plans the next phase's
agent split: a step that ends in "kick off the full suite and wait" is a step that can go quiet.

**The verification script (§6.3) is a Playwright test file, not a bare `.mjs` script.** The plan
named `verify-run/p10-look.mjs`; what's in `verify-run/` instead is `p10-look.spec.ts` plus a
throwaway `verify.config.ts` that only overrides `testDir` so the one file can run outside the
gated suite. The reason: the six-shot pass needs to walk to bedroom A on the keys, which needs
`turnSign`-correct steering exactly like `tests/e2e/walk.spec.ts`'s own `turnToward`/`walkToward`,
and getting that right depends on `buildSuite()`'s real room geometry. A bare node script has no
access to `@/geo/rooms` without re-deriving the suite's layout by hand outside the app's own
resolution of `SuiteParams` — a second, hand-rolled copy of exactly the geometry this phase is
careful not to duplicate elsewhere. Importing `@/geo/rooms` the same way the e2e specs already do,
inside a Playwright test, gets the real geometry for free. Both files stay untracked, as `main`'s
`verify-run/` already does.

**The six shots, measured:**

1. **Arrival.** `__walk.active` was already `true` and `frames > 2` before any key was pressed.
   Camera pitch recomputed from `__cam.position`/`__cam.target`: **−7.965°**, matching the
   keyframe's own value to three decimals with no manual correction needed.
2. **`F` held 1 s.** Pitch: **−85.000°** — the clamp, reached and held, not overshot.
3. **`R` held 2 s.** Pitch: **+85.000°** — same clamp, other direction.
4. **Walked to bedroom A on foot.** `__walk.room` read `"bedA"` at the end, with zero clicks and
   no button anywhere in the page.
5. **The HUD row**, read back verbatim: `walk` / `Bedroom A` /
   `W A S D walk and turn · Q E sidestep · R F look up and down · double-click to look with the
   mouse, Esc to release` / `Standing in Bedroom A.` — the label, the readout, and the keys, and
   nothing else.
6. **Console errors across the whole run: zero.**

Screenshots are `verify-run/walk-in/01-arrival.png` through `06-final.png` (moved from the
branch worktree's own `verify-run/` at the P10 merge, and into a subdirectory because three
other branches wrote a `verify-run/` too). `02-look-down.png` shows
floorboards filling the frame; `03-look-up.png` shows the ceiling; `04-in-bedroom-a.png` shows two
beds and the room label, reached without a button.

**Final counts.** Unit suite: 696 tests, 696 passing. E2E suite: 59 tests, 59 passing, run against
this worktree's own server on port 3007 (playwright.config.ts's own comment names the exact trap
of trusting a green run against a server on 3000 owned by a sibling worktree; this run confirmed
3007 before trusting it, each time, and `playwright.config.ts` itself is unmodified in every
commit — the port was changed only in the uncommitted working tree while testing, and reverted
before every commit that followed).

**Four worktrees, checked before this commit:** `weld15` (main) carries only a stray untracked
`verify-run/` left over from an earlier phase, nothing this branch touches. `weld15-p10`
(`p10-fidelity`) is clean. `weld15-ux` (`p10-ux`) has uncommitted work in `CameraRig.tsx`,
`store.ts`, `Hud.tsx` and others — a different branch's edits to files this phase also touched,
but in a separate working tree, so nothing here conflicts with it; reconciling the two is a merge
question for whoever merges either branch to `main`, not something this phase's worktree can see
or needs to resolve. Nothing has been pushed, merged, or deployed.
