# P6, second half — the UI layer

The pure modules landed: `src/state/url.ts`, `src/geo/drag.ts`, `src/scene/cutaway.ts`, all three
three-free, all three property-tested. What is missing is every way a person could reach them. This
document is the contract between the three owners who close that gap.

## Ownership, binding

| Owner | Writes | Must not touch |
|---|---|---|
| G1 controls | `src/ui/Panel.tsx`, `src/ui/Slider.tsx`, `src/ui/Provenance.tsx` | `Hud.tsx`, `store.ts`, `app/globals.css` |
| G2 drag scene | `src/scene/DragLayer.tsx` | `Suite.tsx`, `Furniture.tsx`, `store.ts` |
| H integrate | `store.ts`, `Experience.tsx`, `Suite.tsx`, `Furniture.tsx`, `Hud.tsx`, `url.ts`, `app/*` | any G file |
| I gates | `tests/e2e/edit.spec.ts` | any source file |

G1 and G2 are **presentational and take everything as props.** Neither imports `@/state/store`. That
is not style: H is editing `store.ts` in the same window, and a component that imports a store field
which does not exist yet cannot be type-checked by the person writing it. Props also mean the e2e
gates can drive them at any state without reaching into zustand.

## `src/ui/Slider.tsx` (G1)

One labelled range input with a live numeric readout and a provenance chip.

```ts
export type SliderProps = {
  id: string;              // data-testid is `slider-${id}`, the input's own id is `in-${id}`
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;            // "ft", "in", "beds"
  provenance: Prov;
  /** why this range and not another; rendered, not a title attribute */
  note: string;
  onChange: (v: number) => void;
  /** the shipped default, marked on the track so "back to the source" is findable */
  reset?: number;
};
```

44 px minimum target (`TAP` in `Hud.tsx` is the precedent). `aria-valuetext` carries the unit, because
"10.75" read aloud alone is not a ceiling height. The readout is `className="tabular"` — the digits
must not reflow while dragging.

## `src/ui/Provenance.tsx` (G1)

```ts
export type Prov = "GIVEN" | "DERIVED" | "INFERRED";
export function Chip({ prov, source }: { prov: Prov; source: string }): JSX.Element;
```

The chip **carries its word**, always. `design-system/MASTER.md` forbids colour as the sole signal and
this is the case it was written for: the difference between a number the housing office stated and a
number this project guessed is the honesty of the whole model. `source` is the one-line provenance
string, rendered as the chip's accessible description (`aria-describedby` or title + visible text —
visible wins).

Contrast: at least 4.5:1 against **both** grounds the panel appears over, the near-black scan ground of
stages 0–3 and the daylit interior of stage 5. Measure, do not eyeball.

## `src/ui/Panel.tsx` (G1)

```ts
export type PanelProps = {
  open: boolean;
  onToggle: () => void;

  params: SuiteParams;
  onParam: (patch: Partial<SuiteParams>) => void;

  // CORRECTED after measurement. This was written as `beds: number // 1..3 per bedroom`,
  // which the geometry cannot express: layout(suite, { beds }) takes the whole suite's
  // OCCUPANCY and splits it across the two bedrooms itself, and it saturates at 4 because
  // bedroomSlots() holds a two-to-a-bedroom limit. Measured: 1 -> 1 bed, 2 -> 2, 3 -> 3,
  // 4 -> 4, 5 -> 4, 6 -> 4. So the control is occupancy 1..4, and its note has to say the
  // cap belongs to the recipes rather than to Weld -- the building is documented as having
  // housed quints and sextuplets, which this model cannot draw.
  occupancy: number;
  onOccupancy: (n: number) => void;

  cutaway: CutawayMode;
  onCutaway: (m: CutawayMode) => void;
  // Added after the fact. The modes can only change anything once the interior is
  // mounted, which visibility() puts at stage 3; before that the group is disabled and
  // says why. Hud.tsx had already found this wart once with a roof-off toggle that was
  // live at all six stages and changed the frame at one.
  cutawayEnabled: boolean;

  /** id of the selected piece, or null */
  selected: string | null;
  selectedLabel: string | null;                  // "bedroom A bed 0", already humanised by H
  onRotate: () => void;
  onNudge: (dir: NudgeDir) => void;
  onDeselect: () => void;

  /** refusals and drops, already worded by H. Announced, not just printed. */
  notice: string | null;
  onRefit: () => void;
  onCopyLink: () => void;
  onReset: () => void;
};
```

Required test ids: `panel`, `panel-toggle`, `panel-notice`, `refit`, `copy-link`, `reset-all`,
`cutaway-${mode}` for each of the four modes, `rotate`, `nudge-u+` / `nudge-u-` / `nudge-v+` /
`nudge-v-`, `slider-${id}` per control.

Every parameter of `SuiteParams` that is a number gets a control. Declare the table as
`Record<LengthKey, ControlSpec>` so that adding a field to `SuiteParams` **fails to compile** rather
than silently shipping a dimension nobody can correct — `url.ts` makes the same move with
`LENGTH_ORDER` and says why.

Ranges and provenance come from `docs/DIMENSION-AUDIT.md` and the per-field docblocks in
`src/geo/rooms.ts`, which already tag every field. Read both. The two rules:

- **INFERRED** fields get the audit's own bounds where it states them (ceiling 9–12 ft, `bathDeep`
  6–8 ft) and a defensible bracket where it does not.
- **GIVEN** and **DERIVED** fields still get a control, but a tight one — roughly ±1 ft — because the
  question they answer is "what if the letter was wrong", not "what shape would you like".

Cutaway is a radio group, not four independent toggles: `role="radiogroup"` with
`aria-checked`, or `aria-pressed` on buttons in a `role="group"`. `cutaway.ts`'s header lists what the
UI owes the mode — the word rendered, selection expressed structurally, a live-region announcement,
and the canvas alternative text updated. The first three are G1's. The fourth is H's.

The panel is a `<form>` that never submits, or a `<section>` with an accessible name. It must be
reachable and operable by keyboard alone, and the nudge buttons are the visible face of the same
`nudge()` the arrow keys call.

## `src/scene/DragLayer.tsx` (G2)

```ts
export type DragLayerProps = {
  enabled: boolean;
  params: SuiteParams;
  suite: Suite;
  pieces: Piece[];
  openings: Opening[];
  yaw: number;                                    // suiteBasis(params).yaw, passed in
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** every attempt, accepted or refused. H commits or words the refusal. */
  onResult: (id: string, r: DragResult) => void;
};
```

**Draw calls are the constraint.** The suite's budget is 25 and `Suite` plus `Furniture` already spend
15. So: **no per-piece hit mesh.** Twenty-nine invisible boxes would be 29 draw calls and would blow
the budget on its own. Instead:

1. One large plane at `floorLevel(1)`, mounted only while `enabled`, carrying the pointer handlers.
2. Convert the intersection point into the suite frame and hit-test the pieces **arithmetically**
   against `pieceBox()`. That is the same box maths `collide.ts` already does and it costs nothing.
3. `cutaway.ts` exports `cameraInSuite(p, params)`, which is a projection onto `suiteToThree()`'s own
   basis and works for any point, not only a camera. Use it. Do **not** write a second inverse — the
   reason is in that function's docblock, and `frames.ts` warns that a wrong inverse mirrors the
   building invisibly.

Feedback while dragging, at most two further draw calls and only while they are needed:

- a ghost at the candidate position, tinted by whether `tryMove()` accepts it;
- an outline on the selected piece.

Rejection must be visible, not swallowed: the ghost reads as refused and `onResult` fires with the
reason so H can word it. The piece itself does not move.

Pointer maths runs in the suite frame throughout. The suite sits on a 13.2° axis, so screen deltas are
not a substitute for a real ray — `docs/phases/P6.md`'s risk table says so.

## `store.ts`, and what H changes (H)

- `pieces: Piece[]` becomes state, seeded from `DEFAULT_SNAPSHOT.pieces`, so a drag persists.
- `cutaway: boolean` widens to `cutaway: CutawayMode`. `url.ts`'s flag bits widen with it —
  bits 0–1 the mode index, bit 2 facade, bit 3 `wingStep`, bit 4 orbit — and `tests/url.test.ts`
  moves with them. No shipped link predates this: `url.ts` is untracked and the deployed build has no
  encoder in it.
- `beds: number` and `selected: string | null` are added.
- `setParams` re-validates. A patch that produces an illegal suite is **refused** with a notice; a
  patch that is legal but leaves a piece outside its room or overlapping **drops** that piece and names
  it. Silently overlapping furniture is the failure `docs/phases/P6.md` names.
- The URL is written on change and read on boot. Boot order matters: a malformed parameter opens at
  defaults with no console error, which is gate 7.

## Verification (I)

`tests/e2e/edit.spec.ts`, all seven gates from `docs/phases/P6.md`, plus the two that the widened
cutaway adds:

8. Each of the four cutaway modes is announced, and the canvas alt text names the active one.
9. `wallsDown` shows more floor than `none` from the same camera.

Every new assertion gets mutated and seen to fail. Restore from an explicit `.bak`; these files are
untracked and `git checkout` on them is a silent no-op.

## What the gates found, recorded because the plan above did not predict any of it

- **The canvas had no accessible name at all.** `aria-label` on `<Canvas>` lands on R3F's container
  div, not on the canvas element, and it was absent from both. Fixed by a `CanvasLabel` component
  inside the canvas that sets `role` and `aria-label` on `gl.domElement`. Found by a gate asserting
  the attribute, not by reading the code.
- **The HUD covered every draggable thing in the suite.** At stage 5 the camera looks diagonally down,
  so the floor projects into the bottom of the frame: the fit-out's anchors land at y 589 to 716 on a
  1280 x 720 viewport and the bottom-centred HUD occupied 467 to 706. A press reached an `<input>` and
  never got to the canvas. The HUD moves to the top of the frame at that stage now.
- **`hiddenWalls()` in a `useFrame` was a real stall.** Its `wallsDown` branch calls `buildSuite()` and
  then walks every band, and doing that per frame made a cutaway mode change stop responding to input
  for longer than a 30 s test would wait. Now recomputed only when the camera has moved a quarter foot,
  which is half the drag grid.
- **The pointer can only reach the room the camera stands in.** Bedroom A's furniture projects off
  screen, so editing at stage 5 covers bedroom B. The dollhouse fix is blocked on `WeldExterior` not
  reading `cutaway`; see `Experience.tsx`.
- **Gate 4 moved rather than being dropped.** Reaching a doorway landing through the UI is up to 120
  nudge presses at a 62 ms frame, because landings sit at the room edges the camera does not show. The
  door rule stays pinned in `tests/drag.test.ts` and its wording in `tests/store.test.ts`; the e2e
  refusal gate covers the chain from pointer to visible text. `tests/e2e/edit.spec.ts` says all of this
  where the gate used to be.
- **A stale flags-byte offset.** `tests/url.test.ts`'s "unused flag bits are refused" check was
  mutating byte 3 on the assumption that version, stage, t and flags are one byte each, but the
  fixture's `t` is 1 -- a two-byte varint -- so it was corrupting `t` and being refused for that
  instead. The offset is now derived from the encoder.
