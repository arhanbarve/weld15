/**
 * The provenance chip: GIVEN, DERIVED or INFERRED, plus the one line that says
 * where the number came from.
 *
 * This is the honesty mechanism, and docs/phases/P6.md is explicit that it is the
 * reason docs/DIMENSION-AUDIT.md exists at all: a viewer has to be able to tell
 * which numbers came from the housing office, which the geometry forced, and
 * which are the project's own guess. The audit's section 1 is a list of what
 * happens when that distinction is lost -- five of its twelve errors are cases of
 * the author treating his own inference as a source, and error 4 is a fabricated
 * bathroom dimension "rendered in the same typographic style as the sourced ones,
 * on a page whose entire claim was provenance". This component is what stops that
 * from happening again on a page that is again about provenance.
 *
 * THE CHIP CARRIES ITS WORD, ALWAYS
 * design-system/MASTER.md's delivery checklist bars colour as the sole indicator,
 * and src/scene/cutaway.ts's header names this component as the precedent when it
 * asks the same of the cutaway control. So the tag is a WORD, in text, and hue is
 * the third signal after the word and the border -- not the first. A stylesheet
 * that failed to load, a monochrome display, or a reader that speaks the DOM all
 * get the same information.
 *
 * `source` is rendered as visible text rather than hung on aria-describedby or a
 * title. P6-UI.md decides that one outright: visible wins. A title attribute is
 * invisible to touch, invisible to keyboard, and invisible to anyone who does not
 * think to hover -- which for the one fact this project most needs to be read is
 * not a trade worth making.
 *
 * Contrast on the panel's ground is measured in Panel.module.css's header, where
 * the ground itself is defined. All three tag colours clear 4.5:1, and the source
 * line's --faint clears it at 5.03:1.
 */

import type { JSX } from "react";
import s from "./Panel.module.css";

export type Prov = "GIVEN" | "DERIVED" | "INFERRED";

/**
 * Declared as a Record over the union rather than looked up with a fallback, so
 * that a fourth tag would fail to compile instead of rendering an untinted chip.
 * src/state/url.ts's LENGTH_ORDER makes the same move and says why.
 */
const TINT: Record<Prov, string> = {
  GIVEN: s.provGiven!,
  DERIVED: s.provDerived!,
  INFERRED: s.provInferred!,
};

/**
 * What each word means, for a reader who has not read the audit.
 *
 * On the chip's accessible name rather than in the visible text, because the
 * visible line is already the source and three words of vocabulary repeated
 * sixteen times down a panel is noise. A reader gets "GIVEN, stated by a source"
 * once per chip, which is the reading a first-time visitor needs and a returning
 * one can ignore.
 */
const MEANS: Record<Prov, string> = {
  GIVEN: "stated by a source",
  DERIVED: "forced by other numbers",
  INFERRED: "this project's own estimate",
};

export function Chip({ prov, source }: { prov: Prov; source: string }): JSX.Element {
  return (
    <p className={s.chip}>
      <span className={`${s.chipWord!} ${TINT[prov]}`}>
        {prov}
        {/* The gloss is inside the tag's own element so it lands in the tag's
            accessible name, immediately before the source line is read. */}
        <span className={s.sr}>{`, ${MEANS[prov]}.`}</span>
      </span>
      <span className={s.chipSource}>{source}</span>
    </p>
  );
}
