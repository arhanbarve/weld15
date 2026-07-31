"use client";

/**
 * The correction panel: every number this project inferred rather than sourced,
 * offered as a control.
 *
 * docs/phases/P6.md calls this the phase the layout risk is spent on, and this is
 * where it is spent. The inferred values are the project's exposure -- the ceiling
 * height appears in no public source, the bathroom's depth was bounded rather than
 * sourced, and which facade the suite faces is unknowable from outside -- and the
 * mitigation decided early was that every one of them ships as a control, so being
 * wrong costs a drag rather than a rebuild.
 *
 * PURELY PRESENTATIONAL, AND THAT IS NOT A STYLE CHOICE. Nothing here imports
 * @/state/store. P6-UI.md's reason: owner H is editing store.ts in this same
 * window, and a component that imports a store field which does not exist yet
 * cannot be type-checked by the person writing it. Props also mean the e2e gates
 * can drive this at any state without reaching into zustand.
 *
 * WHY THE CONTROLS TABLE IS A Record OVER A MAPPED TYPE
 * CONTROLS below is `Record<LengthKey, ControlSpec>`, keyed over every numeric
 * field of SuiteParams. Add a field to SuiteParams and this file stops compiling.
 * src/state/url.ts's LENGTH_ORDER makes exactly this move and states the reason:
 * the alternative is the loud failure becoming a quiet one -- the field drops out
 * of the UI, nobody can correct it, and the whole point of the phase is silently
 * missing for that dimension. The audit's own pattern-of-failure note is that the
 * dangerous errors are the ones that look fine.
 *
 * WHERE THE NUMBERS COME FROM
 * Ranges, tags and source lines are transcribed from docs/DIMENSION-AUDIT.md and
 * the per-field docblocks in src/geo/rooms.ts. Two rules, from P6-UI.md:
 *   - INFERRED fields get the audit's own bounds where it states them, and a
 *     defensible bracket where it does not -- with the reason written into the
 *     note, which is rendered.
 *   - GIVEN and DERIVED fields still get a control, but a tight one, about a foot
 *     either way, because the question they answer is "what if the letter was
 *     wrong", not "what shape would you like".
 *
 * WHY EVERY STEP IS A QUARTER OF A FOOT
 * url.ts encodes lengths on a one-inch lattice, and its header is explicit that
 * anything off that lattice comes back up to half an inch out. Three inches is on
 * the lattice, is fine enough that no slider feels coarse, and puts every
 * DEFAULT_PARAMS value on a step boundary -- so a shared link round-trips a
 * corrected suite exactly rather than nearly.
 */

import { useRef, type JSX } from "react";
// DEFAULT_PARAMS is a value import and the only one, deliberately: it is what each
// slider's reset mark points at. Transcribing the fifteen defaults into the table
// below instead is precisely what docs/DIMENSION-AUDIT.md section 1 is a list of --
// a measured number copied into a second file drifts from the first and the drift
// is invisible. rooms.ts is pure and three-free, so the import costs nothing.
import { DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";
import type { NudgeDir } from "@/geo/drag";
import { CUTAWAY_MODES, CUTAWAY_WORDS, type CutawayMode } from "@/scene/cutaway";
import { Chip, type Prov } from "./Provenance";
import { Slider } from "./Slider";
import s from "./Panel.module.css";

export type PanelProps = {
  open: boolean;
  onToggle: () => void;

  params: SuiteParams;
  onParam: (patch: Partial<SuiteParams>) => void;

  /**
   * How many students the suite is fitted out for, 1..4.
   *
   * NOT beds per bedroom, which is what P6-UI.md's prop list says. H measured the
   * real behaviour: layout(suite, { beds }) takes the whole suite's occupancy and
   * splits it across the two bedrooms itself, and it saturates at 4 because
   * bedroomSlots() holds a two-to-a-bedroom limit. 5 and 6 come back as 4, with 29
   * pieces either way. This message from H is authoritative over that file for
   * this one control.
   */
  occupancy: number;
  onOccupancy: (n: number) => void;

  cutaway: CutawayMode;
  onCutaway: (m: CutawayMode) => void;
  /**
   * Whether the cutaway modes can do anything yet.
   *
   * They cannot before the interior is mounted, which visibility() in
   * src/scene/stages.ts puts at stage 3 and later. Hud.tsx found this wart once
   * already and its comment carries the measurement: toggling roof-off moved the
   * mean frame luminance by 0.00, 0.00, 0.18, 0.08 and 0.00 at stages 0 to 4 and
   * by 2.73 at stage 5, so for five of six stages it was a control that changed
   * nothing while looking like it should -- worse than a missing control, because
   * a viewer who presses it concludes the app is broken. So when this is false the
   * group is disabled and says why, rather than being quietly dimmed.
   */
  cutawayEnabled: boolean;

  /** id of the selected piece, or null */
  selected: string | null;
  selectedLabel: string | null; // "bedroom A bed 0", already humanised by H
  onRotate: () => void;
  onNudge: (dir: NudgeDir) => void;
  onDeselect: () => void;

  /** refusals and drops, already worded by H. Announced, not just printed. */
  notice: string | null;
  onRefit: () => void;
  onCopyLink: () => void;
  onReset: () => void;
};

/**
 * Every numeric field of SuiteParams, as a type.
 *
 * A local copy of url.ts's mapped type rather than an import, because that one is
 * not exported and url.ts belongs to another owner this window. The type is three
 * lines and derives itself from SuiteParams, so the two copies cannot disagree
 * about what the fields are -- only about their order, which does not matter here.
 */
type LengthKey = {
  [K in keyof SuiteParams]: SuiteParams[K] extends number ? K : never;
}[keyof SuiteParams];

/** Which fieldset a control appears in. Grouping only; the table stays exhaustive. */
type Group = "section" | "rooms" | "fabric";

type ControlSpec = {
  group: Group;
  label: string;
  min: number;
  max: number;
  /** GIVEN, DERIVED or INFERRED, from the audit and rooms.ts. Never upgraded. */
  prov: Prov;
  /** One line: where the number came from, or that it came from nowhere. */
  source: string;
  /** One line: why this range and not another. Rendered, per P6-UI.md. */
  why: string;
};

/** Three inches. See the header for why this and not the 0.5 ft drag grid. */
const STEP_FT = 0.25;

/**
 * The whole controls table.
 *
 * Read alongside docs/DIMENSION-AUDIT.md sections 4, 6 and 8, which are where
 * every `source` line below comes from. Where the audit and rooms.ts tag the same
 * field differently, the more humble tag wins and the disagreement is stated in
 * the source line rather than hidden -- see `ceiling`.
 */
const CONTROLS: Record<LengthKey, ControlSpec> = {
  sectionLength: {
    group: "section",
    label: "Section length",
    min: 43,
    max: 45,
    prov: "DERIVED",
    source:
      "The 1875 specification's 143 ft overall, less two 15 ft stair halls and the 25 ft porch, halved.",
    why: "About a foot either way. The 1875 figure is published and five modern footprints agree with it to within a foot, so what this asks is whether the subtraction was right, not what length you would like.",
  },
  legDepth: {
    group: "section",
    label: "Leg depth, facade to inner wall",
    min: 20,
    max: 22,
    prov: "DERIVED",
    source:
      "Forced by the rooms behind it: hall 4.5 + partition 0.5 + bedroom 16 is 21 ft (rooms.ts header).",
    why: "About a foot either way. It is the sum of three other controls on this panel, so moving those is usually the change you want; this one asks whether the sum itself is off.",
  },
  hallWidth: {
    group: "section",
    label: "Hall width",
    min: 3,
    max: 6,
    prov: "INFERRED",
    source:
      "Not stated by anyone. the resident's email gives no hall width and the audit lists it open; 4.5 ft is this project's figure.",
    why: "3 to 6 ft, a bracket rather than a bound, because the audit states none. Below 3 ft it stops being a corridor two people can pass in, and past 6 the 21 ft leg can no longer hold a 16 ft bedroom behind it.",
  },
  bedDepth: {
    group: "rooms",
    label: "Bedroom depth",
    min: 15,
    max: 17,
    prov: "GIVEN",
    source:
      "the resident: bedrooms “about 10 ft by 16 ft”, read off a 31-year-old blueprint, with dimensions that “could be off by about a foot”.",
    why: "A foot either way, which is exactly the tolerance the sender stated. Both bedrooms share this depth.",
  },
  commonAlong: {
    group: "rooms",
    label: "Common room width",
    min: 14,
    max: 16,
    prov: "GIVEN",
    source: "the resident: common room “15 x 15-20 ft”. The 15 is the along-section figure.",
    why: "A foot either way, per the sender's own tolerance.",
  },
  commonDeep: {
    group: "rooms",
    label: "Common room depth",
    min: 15,
    max: 20,
    prov: "GIVEN",
    source:
      "the resident: common room “15 x 15-20 ft”. The range is the tell -- it is the band depth he could not read off the plan.",
    why: "15 to 20 ft: the stated range itself, not a foot either way, because here the source is a range. Nothing is offered past 20, which is already its top; audit section 6 refuses to overrun a given figure on the strength of an inference, and that refusal is what decided the wing step.",
  },
  bedAAlong: {
    group: "rooms",
    label: "Bedroom A width",
    min: 9,
    max: 11,
    prov: "GIVEN",
    source: "the resident: first door off the hall, “about 10 ft by 16 ft”.",
    why: "A foot either way, per the sender's own tolerance.",
  },
  bedBAlong: {
    group: "rooms",
    label: "Bedroom B width",
    min: 9,
    max: 11,
    prov: "GIVEN",
    source:
      "the resident: third door, at the end of the hall, “about 16 ft by 10 ft”, read as 10 x 16 per the client's correction.",
    why: "A foot either way. Bedroom B also absorbs whatever the section length leaves over, so it is the room that shows an error in the chain first.",
  },
  bathAlong: {
    group: "rooms",
    label: "Bathroom width",
    min: 6,
    max: 8,
    prov: "INFERRED",
    source:
      "Never sourced -- the resident gives no bathroom dimension at all, and the audit's fourth listed error is an 8 x 16 ft bathroom this project invented. Solving the 49 ft clear width bounds it to 6-8 ft.",
    why: "6 to 8 ft, the audit's own bound. At 6 the bath is 51 sq ft and a 6.5 ft strip is left over for the building; at 8 it is 68 sq ft and 4.5 ft is left; closing the width entirely would need a 106 sq ft bathroom, which no four-person dorm suite has.",
  },
  bathDeep: {
    group: "rooms",
    label: "Bathroom depth",
    min: 6,
    max: 8,
    prov: "INFERRED",
    source:
      "Never sourced. The audit's 6-8 ft arithmetic bounds the bathroom's width across the band, not its depth; nothing bounds the depth.",
    why: "6 to 8 ft, the same bracket reused because it is the only one the evidence offers for this room. What it moves is the unnamed strip on the facade behind the bath: 9.5 ft deep at 6, 7.5 ft at 8. That strip is space this project can measure and cannot name, and rooms.ts leaves it without a door for that reason.",
  },
  kDeep: {
    group: "rooms",
    label: "K depth",
    min: 9,
    max: 11,
    prov: "GIVEN",
    source:
      "the resident: room K “roughly 10 ft by 12 ft”. Harvard's assignment settles what K is -- the second common room.",
    why: "A foot either way, per the sender's own tolerance.",
  },
  kAlong: {
    group: "rooms",
    label: "K width",
    min: 11,
    max: 13,
    prov: "GIVEN",
    source: "the resident: room K “roughly 10 ft by 12 ft”.",
    why: "A foot either way. K bumps inward off the common room, so this runs along the same wall the common room does.",
  },
  partition: {
    group: "fabric",
    label: "Partition thickness",
    min: 0.25,
    max: 1,
    prov: "INFERRED",
    source:
      "No source. 0.5 ft is the thickness the 44 ft room chain was closed with -- four rooms in a line have three partitions between them.",
    why: "3 in to 12 in. A stud-and-plaster partition is about 5 in; a 1962 demising wall with sound insulation in it can reach a foot. Three of them sit in the chain, so every 3 in here moves the rooms by 9.",
  },
  masonry: {
    group: "fabric",
    label: "Exterior masonry",
    min: 1,
    max: 2.5,
    prov: "INFERRED",
    source:
      "No source states it. The audit subtracts two 1.5 ft masonry walls from the verified 52 ft gable end to reach the 49 ft clear width the whole layout is anchored on.",
    why: "1 to 2.5 ft. Load-bearing 1871 brick at the first floor of five storeys runs three to four wythes, roughly 13 to 18 in, and thicker at the base. Nothing here is measured, and the 49 ft clear width rests on it.",
  },
  ceiling: {
    group: "fabric",
    label: "Ceiling height",
    min: 9,
    max: 12,
    prov: "INFERRED",
    source:
      "In no public source. Cambridge GIS gives a 60.0 ft eave over five floors, so 12 ft floor-to-floor, which less a period floor assembly bounds the ceiling to 10.5-11 ft. rooms.ts calls that DERIVED; the audit says no source states a ceiling height, so the chip stays INFERRED.",
    why: "9 to 12 ft, wider than the 10.5-11 the eave arithmetic brackets, because that arithmetic is a division and not a measurement. The audit's fourteenth listed error is this number fabricated as “typical for the period”; it now has a basis, which is not the same as a source.",
  },
};

/**
 * Ordered once, here, so the render cannot silently drop a field the table
 * declares. Object key order is declaration order for string keys, which is what
 * makes this safe; url.ts sorts an explicit index instead because its order is
 * part of a wire format and mine is only a reading order.
 */
const CONTROL_KEYS = Object.keys(CONTROLS) as LengthKey[];

const GROUPS: { id: Group; legend: string; hint?: string }[] = [
  {
    id: "section",
    legend: "The section, and the hall",
    hint: "Depth runs inward from the window wall. Width runs north along the section.",
  },
  { id: "rooms", legend: "The five rooms" },
  { id: "fabric", legend: "The fabric" },
];

/*
 * The cutaway wording is NOT a table in this file. It was -- a local MODES record of a
 * face and a sentence -- and it is now CUTAWAY_WORDS in src/scene/cutaway.ts, whose
 * header is already where the four obligations on a cutaway UI are written down and
 * which was one of three files holding the same words. This panel reads `.word` for
 * the button faces and `.brief` for the hint and the announcement; both strings are
 * the ones this file used to hold, moved rather than reworded.
 */

/**
 * The four nudges, and what u and v mean in words.
 *
 * These buttons are the visible face of the same nudge() the arrow keys call --
 * P6.md's risk table is explicit that the keyboard path is not a second
 * implementation, it is one code path with two inputs. Each press is one 0.5 ft
 * grid step, the GRID that collide.ts already snaps to.
 *
 * The glyphs are typographic arrows in the mono face, matching Hud.tsx's orbit
 * keys. MASTER.md bans emoji as UI icons; these are not emoji, and the project
 * ships no icon set. Every one carries a worded aria-label, because an arrow
 * alone does not say which axis it moves along on a suite sitting at 13.2 degrees.
 *
 * aria-keyshortcuts records the mapping H wires up. If H binds the arrows the
 * other way round, these four attributes are the lie and should be corrected
 * here -- flagged rather than assumed.
 */
const NUDGES: { dir: NudgeDir; glyph: string; label: string; key: string }[] = [
  { dir: "u-", glyph: "←", label: "Move outward, toward the window wall", key: "ArrowLeft" },
  { dir: "u+", glyph: "→", label: "Move inward, away from the window wall", key: "ArrowRight" },
  { dir: "v+", glyph: "↑", label: "Move north, toward the gable", key: "ArrowUp" },
  { dir: "v-", glyph: "↓", label: "Move south, toward the stair hall", key: "ArrowDown" },
];

/**
 * A patch for one length.
 *
 * The cast is the one in this file and it buys the compile-time table above. A
 * computed key over a union widens to `{ [x: string]: number }`, which is not
 * assignable to Partial<SuiteParams> -- the index signature has to satisfy
 * `facade?: "east" | "west"` as well. Pick<SuiteParams, K> is what the object
 * actually is; TypeScript cannot see it through the computed key.
 */
function lengthPatch<K extends LengthKey>(k: K, v: number): Pick<SuiteParams, K> {
  return { [k]: v } as Pick<SuiteParams, K>;
}

/**
 * A radio group of buttons.
 *
 * role="radiogroup" with aria-checked, which is the first of the two shapes
 * P6-UI.md allows, and it is the one that says what is true: the modes are four
 * states of one setting, not four independent toggles. aria-pressed on four
 * buttons would be announced as four toggles, which is the reading that document
 * warns against even while permitting it.
 *
 * Roving tabindex and arrow keys, because that is what a radio group is: one stop
 * in the tab order, arrows to move within it, and selection following focus.
 * Getting that wrong is worse than not claiming the role, so it is implemented
 * rather than approximated -- the refs exist only so that focus can follow the
 * selection the arrow key just made.
 */
function RadioRow<T extends string>({
  legend,
  options,
  value,
  onPick,
  disabled = false,
}: {
  legend: string;
  options: { value: T; face: string; testid: string }[];
  value: T;
  onPick: (v: T) => void;
  /** Nothing this group sets would do anything yet. Says so, rather than dimming. */
  disabled?: boolean;
}): JSX.Element {
  const buttons = useRef(new Map<T, HTMLButtonElement>());

  function move(delta: number): void {
    const n = options.length;
    if (disabled || n === 0) return;
    const from = options.findIndex((o) => o.value === value);
    // A value outside the options is not a state this panel can produce, but it
    // is one a URL could arrive with, and starting from 0 beats starting from -1.
    const next = options[(((from < 0 ? 0 : from) + delta) % n + n) % n]!;
    onPick(next.value);
    buttons.current.get(next.value)?.focus();
  }

  return (
    <div
      className={s.row}
      role="radiogroup"
      aria-label={legend}
      // Both, and neither is redundant: aria-disabled is what a reader announces
      // for the group as a whole, and the native `disabled` on each button is what
      // actually makes it unpressable and takes it out of the tab order.
      aria-disabled={disabled || undefined}
      onKeyDown={(e) => {
        const delta =
          e.key === "ArrowRight" || e.key === "ArrowDown"
            ? 1
            : e.key === "ArrowLeft" || e.key === "ArrowUp"
              ? -1
              : 0;
        if (delta === 0) return;
        // Ours now. Enter and Space already activate the focused button and
        // claiming them here would apply the change twice -- the argument
        // Hud.tsx's orbit group makes about the same two keys.
        e.preventDefault();
        move(delta);
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={disabled}
          tabIndex={o.value === value ? 0 : -1}
          ref={(el) => {
            if (el) buttons.current.set(o.value, el);
            else buttons.current.delete(o.value);
          }}
          className={o.value === value ? `${s.seg!} ${s.segOn!}` : s.seg}
          data-testid={o.testid}
          onClick={() => onPick(o.value)}
        >
          {o.face}
        </button>
      ))}
    </div>
  );
}

export function Panel(props: PanelProps): JSX.Element {
  const {
    open,
    onToggle,
    params,
    onParam,
    occupancy,
    onOccupancy,
    cutaway,
    onCutaway,
    cutawayEnabled,
    selected,
    selectedLabel,
    onRotate,
    onNudge,
    onDeselect,
    notice,
    onRefit,
    onCopyLink,
    onReset,
  } = props;

  const mode = CUTAWAY_WORDS[cutaway];

  return (
    <div className={s.dock}>
      <button
        type="button"
        className={s.toggle}
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="weld-panel"
        data-testid="panel-toggle"
      >
        {open ? "Close the corrections panel" : "Correct a dimension"}
      </button>

      {/*
        Refusals and drops. Outside the collapsible form on purpose: a drag can be
        refused while the panel is shut, and P6.md is explicit that silently
        overlapping furniture -- or a silently swallowed rejection -- is the
        failure this phase is judged on. role="status" plus aria-live so it is
        announced rather than only printed, and always in the DOM so the
        announcement is a change to an existing region rather than a new node.
      */}
      <div
        className={s.notice}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="panel-notice"
      >
        {notice ?? ""}
      </div>

      {/*
        The third of the four things src/scene/cutaway.ts's header says the UI owes
        these modes: an announcement on change, because what changed is the
        geometry and a screen reader gets nothing at all from a WebGL canvas. The
        fourth -- the canvas's own text alternative -- is H's.

        Out here rather than beside the radio group, for the reason the notice is
        out here: the form is `hidden` while the panel is shut, a hidden live
        region is not in the accessibility tree, and cutaway can be changed from
        outside this panel. The mode's word is rendered visibly on the buttons; this
        is the same fact for a reader who cannot see them.
      */}
      <span className={s.sr} aria-live="polite" aria-atomic="true" data-testid="cutaway-live">
        {cutawayEnabled
          ? `Cutaway ${mode.word}. ${mode.brief}`
          : "Cutaway unavailable until the interior is reached."}
      </span>

      {/*
        A form that never submits, per P6-UI.md, named by its own heading. Nothing
        in it is a submit control, but Enter in a range input can still submit a
        form in some browsers, and a navigation on Enter would throw away the
        state this panel exists to edit.
      */}
      <form
        id="weld-panel"
        className={s.panel}
        hidden={!open}
        aria-labelledby="weld-panel-title"
        onSubmit={(e) => e.preventDefault()}
        data-testid="panel"
      >
        <h2 id="weld-panel-title" className={s.title}>
          What this model is guessing
        </h2>
        <p className={s.lede}>
          Every number below carries where it came from. Correct the ones this project
          inferred; the walls, the areas and the furniture all follow from them.
        </p>

        <div className={s.row}>
          <button type="button" className={s.btn} onClick={onRefit} data-testid="refit">
            Refit furniture
          </button>
          <button type="button" className={s.btn} onClick={onCopyLink} data-testid="copy-link">
            Copy link
          </button>
          <button type="button" className={s.btn} onClick={onReset} data-testid="reset-all">
            Reset all
          </button>
        </div>

        <fieldset className={s.group}>
          <legend className={s.legend}>Cutaway</legend>
          <RadioRow
            legend="Cutaway mode"
            value={cutaway}
            onPick={onCutaway}
            disabled={!cutawayEnabled}
            options={CUTAWAY_MODES.map((m) => ({
              value: m,
              face: CUTAWAY_WORDS[m].word,
              testid: `cutaway-${m}`,
            }))}
          />
          <p className={s.hint}>
            {cutawayEnabled
              ? mode.brief
              : "Unavailable out here: there is no interior mounted to cut away from yet. Reach the room — stage 3 or later — and these come back."}
          </p>
        </fieldset>

        <fieldset className={s.group}>
          <legend className={s.legend}>The selected piece</legend>
          <p className={s.hint}>
            {selected === null
              ? "Nothing selected. Pick a piece in the room to move it."
              : (selectedLabel ?? selected)}
          </p>
          <div className={s.row}>
            <button
              type="button"
              className={s.btn}
              onClick={onRotate}
              disabled={selected === null}
              aria-keyshortcuts="R"
              data-testid="rotate"
            >
              Rotate 90&deg;
            </button>
            {NUDGES.map((n) => (
              <button
                key={n.dir}
                type="button"
                className={s.glyph}
                onClick={() => onNudge(n.dir)}
                disabled={selected === null}
                aria-label={n.label}
                aria-keyshortcuts={n.key}
                data-testid={`nudge-${n.dir}`}
              >
                {n.glyph}
              </button>
            ))}
            <button
              type="button"
              className={s.btn}
              onClick={onDeselect}
              disabled={selected === null}
              data-testid="deselect"
            >
              Deselect
            </button>
          </div>
          <p className={s.hint}>
            One press is half a foot, the grid the room already snaps to. A move that
            would leave the room, hit another piece or block a door is refused and said
            so above.
          </p>
        </fieldset>

        <fieldset className={s.group}>
          <legend className={s.legend}>Placement, and who sleeps here</legend>

          <p className={s.fieldLabel}>Which facade the rooms face</p>
          <RadioRow
            legend="Which facade the rooms face"
            value={params.facade}
            onPick={(facade) => onParam({ facade })}
            options={[
              { value: "east" as const, face: "east", testid: "facade-east" },
              { value: "west" as const, face: "west", testid: "facade-west" },
            ]}
          />
          <Chip
            prov="INFERRED"
            source={
              "Not knowable from outside. The 1875 specification puts Weld's main entrance on the west front and the audit lists which end of the suite the common room sits at as undetermined; the measured facade projection differs slightly between the two sides, 5.165 ft east against 5.298 ft west."
            }
          />

          <p className={s.fieldLabel}>Follow Weld&rsquo;s wing step</p>
          <div className={s.row}>
            {/* .btn, not .seg: a lone .seg grows to fill the row and a full-width
                bar reads as a banner rather than as a two-state control. */}
            <button
              type="button"
              className={params.wingStep ? `${s.btn!} ${s.segOn!}` : s.btn}
              aria-pressed={params.wingStep}
              onClick={() => onParam({ wingStep: !params.wingStep })}
              data-testid="wing-step"
            >
              {params.wingStep ? "stepped" : "straight"}
            </button>
          </div>
          <Chip
            prov="DERIVED"
            source={
              "The step itself is measured, off Weld's GIS ring: 5.165 ft on the east facade, 5.298 ft on the west. What sits in it is the question, and the audit settles it as masonry and a chimney breast rather than floor -- so straight is the claim, not merely the default. Stepped takes the common room to 25.17 ft deep, past the 15-20 ft the resident gave, and walls.ts still lays the facade masonry straight, so the extra floor has no outer wall and no ceiling. Kept addressable in case a 1962 or 1992 plan turns up; not an open question."
            }
          />

          <Slider
            id="occupancy"
            label="Students in the suite"
            value={occupancy}
            min={1}
            max={4}
            step={1}
            unit="students"
            provenance="GIVEN"
            note={
              "Harvard's assignment and the client agree on four: two bedrooms, two doubles. It stops at four because the fit-out recipes stop there -- bedroomSlots() puts at most two beds in a bedroom -- and that is a limit of this model, not of the building. Weld is documented as having housed quints and sextuplets and this suite held seven undergraduates in 1983, which the audit lists as a live contradiction; those are real questions the model cannot currently answer, so it does not offer a 5 that would quietly come back as 4."
            }
            onChange={onOccupancy}
            reset={4}
          />
        </fieldset>

        {GROUPS.map((g) => (
          <fieldset className={s.group} key={g.id}>
            <legend className={s.legend}>{g.legend}</legend>
            {g.hint ? <p className={s.hint}>{g.hint}</p> : null}
            {CONTROL_KEYS.filter((k) => CONTROLS[k].group === g.id).map((k) => {
              const c = CONTROLS[k];
              return (
                <Slider
                  key={k}
                  id={k}
                  label={c.label}
                  value={params[k]}
                  min={c.min}
                  max={c.max}
                  step={STEP_FT}
                  unit="ft"
                  provenance={c.prov}
                  note={`${c.source} ${c.why}`}
                  onChange={(v) => onParam(lengthPatch(k, v))}
                  reset={DEFAULT_PARAMS[k]}
                />
              );
            })}
          </fieldset>
        ))}
      </form>
    </div>
  );
}
