"use client";

/**
 * The settings panel: cutaway view, occupancy, and the housekeeping actions
 * (refit, copy link, reset).
 *
 * PURELY PRESENTATIONAL, AND THAT IS NOT A STYLE CHOICE. Nothing here imports
 * @/state/store. Props mean the e2e gates can drive this at any state without
 * reaching into zustand.
 */

import { useRef, type JSX } from "react";
import { CUTAWAY_MODES, CUTAWAY_WORDS, type CutawayMode } from "@/scene/cutaway";
import { Slider } from "./Slider";
import s from "./Panel.module.css";

export type PanelProps = {
  open: boolean;
  onToggle: () => void;

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

  /** refusals and drops, already worded by H. Announced, not just printed. */
  notice: string | null;
  onRefit: () => void;
  onCopyLink: () => void;
  onReset: () => void;
};

/*
 * The cutaway wording is NOT a table in this file. It was -- a local MODES record of a
 * face and a sentence -- and it is now CUTAWAY_WORDS in src/scene/cutaway.ts, whose
 * header is already where the four obligations on a cutaway UI are written down and
 * which was one of three files holding the same words. This panel reads `.word` for
 * the button faces and `.brief` for the hint and the announcement; both strings are
 * the ones this file used to hold, moved rather than reworded.
 */

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
    occupancy,
    onOccupancy,
    cutaway,
    onCutaway,
    cutawayEnabled,
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
        {open ? "Close settings" : "Settings"}
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
          Settings
        </h2>

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
          <legend className={s.legend}>Who sleeps here</legend>

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
      </form>
    </div>
  );
}
