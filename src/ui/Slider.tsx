"use client";

/**
 * One labelled range input, with a live numeric readout and a provenance chip.
 *
 * Every dimension the suite rests on is corrected through this component, so the
 * three things it has to get right are the three things a slider usually gets
 * wrong.
 *
 * THE TARGET. 44 px minimum, set as a min-height on the input itself rather than
 * through padding. Hud.tsx's TAP constant records why that is not a formality:
 * `.hud-t input` sets a width and no height, a native range track comes out about
 * 20 px tall, and the height of the box IS the hit area for the thumb. A 20 px
 * thumb is under half of MASTER.md's floor.
 *
 * THE ANNOUNCEMENT. aria-valuetext, always, carrying the unit -- and for feet,
 * carrying feet and inches. P6-UI.md gives the example and it is the right one:
 * "10.75" read aloud is not a ceiling height. A reader driving the ceiling slider
 * hears "10 feet 9 inches", which is the number a builder would say.
 *
 * THE READOUT. className="tabular", per the contract, so the digits do not
 * reflow while the thumb is being dragged; the width is pinned in the stylesheet
 * for the same reason .hud-orbit-read is. It is aria-hidden, because
 * aria-valuetext already carries the value and Hud.tsx's orbit readout settled
 * that argument: a visible readout that changes every frame is a second voice
 * saying the same thing worse.
 *
 * `note` reaches the chip as its `source`. That is a consequence of the prop
 * types in docs/phases/P6-UI.md, which give this component a `note` and no
 * `source` while giving Chip a `source` and no `note`, and it is the right
 * reading rather than a compromise: both are one line of rendered prose about
 * where the number comes from and why the range is what it is, and Panel.tsx
 * composes them into one string deliberately.
 */

import type { JSX } from "react";
import { Chip, type Prov } from "./Provenance";
import s from "./Panel.module.css";

export type SliderProps = {
  id: string; // data-testid is `slider-${id}`, the input's own id is `in-${id}`
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string; // "ft", "in", "beds"
  provenance: Prov;
  /** why this range and not another; rendered, not a title attribute */
  note: string;
  onChange: (v: number) => void;
  /** the shipped default, marked on the track so "back to the source" is findable */
  reset?: number;
};

/**
 * A length as a number a person would write. 10.75 stays 10.75; 8 does not become
 * "8.00", because a fixed decimal count on a panel of sixteen values makes the
 * whole numbers look measured to the hundredth when they are not.
 */
function show(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * A length in words, feet and inches.
 *
 * Rounded through whole inches rather than formatted from the float, and that is
 * the same lattice src/state/url.ts encodes on -- one inch, chosen there because
 * every one of DEFAULT_PARAMS's fifteen lengths is a whole number of inches, the
 * 10.75 ft ceiling included. Every step this component offers is a quarter of a
 * foot, so nothing is ever lost in this rounding; if a value arrives off the
 * lattice it is spoken to the nearest inch, which is the resolution a shared link
 * would have carried anyway.
 */
function sayLength(v: number): string {
  const inches = Math.round(v * 12);
  const ft = Math.floor(inches / 12);
  const rem = inches - ft * 12;
  const feet = ft === 1 ? "1 foot" : `${ft} feet`;
  const inch = rem === 1 ? "1 inch" : `${rem} inches`;
  if (ft === 0) return inch;
  if (rem === 0) return feet;
  return `${feet} ${inch}`;
}

/**
 * What a screen reader says instead of the raw number.
 *
 * Lengths get sayLength. Anything else is a counted noun -- "beds", "students" --
 * and gets its plural dropped at one, because "1 students" is the one reading a
 * person would notice. Dropping a trailing s is not general English; it is right
 * for every unit this panel uses, and stated here rather than pretended to be a
 * rule.
 */
function valueText(v: number, unit: string): string {
  if (unit === "ft") return sayLength(v);
  if (unit === "in") return `${show(v)} ${v === 1 ? "inch" : "inches"}`;
  if (v === 1 && unit.endsWith("s")) return `1 ${unit.slice(0, -1)}`;
  return `${show(v)} ${unit}`;
}

export function Slider({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  provenance,
  note,
  onChange,
  reset,
}: SliderProps): JSX.Element {
  const inputId = `in-${id}`;
  const marksId = `marks-${id}`;
  /*
   * The default, or nothing to mark. `max > min` is not defensiveness about a
   * caller: it is what keeps the fraction below from dividing by zero, and a
   * degenerate range is one bad row in Panel.tsx's table away.
   */
  const def = max > min ? reset : undefined;
  /*
   * Where the default sits along the track, as a fraction. The 0.5rem inset in
   * the calc is half a nominal thumb: a range input's thumb centre travels from
   * half a thumb in to half a thumb short of the far end, so a mark placed at a
   * plain percentage of the track's width drifts away from the thumb at both
   * ends. Decorative either way -- .deflt below says the same thing in words.
   */
  const at = def === undefined ? 0 : (def - min) / (max - min);

  return (
    <div className={s.field} data-testid={`slider-${id}`}>
      <div className={s.fieldTop}>
        <label className={s.fieldLabel} htmlFor={inputId}>
          {label}
        </label>
        <span className={`tabular ${s.readout!}`} aria-hidden="true">
          {show(value)} {unit}
        </span>
      </div>

      <div className={s.trackWrap}>
        <input
          id={inputId}
          className={s.track}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          // Without this a reader announces "10.75" and the unit is lost.
          aria-valuetext={valueText(value, unit)}
          // Real <datalist>, so the default is in the DOM as data and not only as
          // a positioned div. Chrome draws its own tick from this; .tick below is
          // what makes the mark appear in the browsers that do not.
          list={def !== undefined ? marksId : undefined}
        />
        {def !== undefined ? (
          <>
            <datalist id={marksId}>
              <option value={def} label="shipped default" />
            </datalist>
            <span
              className={s.tick}
              style={{ left: `calc(0.5rem + (100% - 1rem) * ${at})` }}
              aria-hidden="true"
            />
          </>
        ) : null}
      </div>

      {/* Only when it has moved. A line reading "default 16 ft" under a slider
          sitting at 16 ft is noise on fifteen of the sixteen controls. */}
      {def !== undefined && value !== def ? (
        <p className={s.deflt}>
          default {show(def)} {unit}
        </p>
      ) : null}

      <Chip prov={provenance} source={note} />
    </div>
  );
}
