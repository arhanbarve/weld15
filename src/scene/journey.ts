/**
 * The whole descent as ONE parameter, and the mapping back to the stage machine.
 *
 * u runs 0 at orbit to 1 standing in the hall. It is the only number the master scrubber
 * carries; (stage, t) stays the model, because every other file in this project already
 * reads it and because url.ts encodes it. So this is a projection, not a new state.
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
 * The same cache stages.ts's keyframes() uses, for the same reason and with the same
 * guarantee: every writer of `params` replaces the object rather than mutating it. This is
 * called from a pointermove handler and from a render, so it must not walk the keyframes
 * each time.
 */
const CACHE: { params: SuiteParams | null; legs: Leg[] | null } = { params: null, legs: null };

/**
 * The five legs of the journey and how much of the bar each gets.
 *
 * THE DESCENT LEGS ARE WEIGHTED BY DECADES OF ALTITUDE, NOT BY EQUAL THIRDS. The three
 * descent legs span 3.28, 1.30 and 0.87 decades; splitting the bar into equal thirds would
 * make the first leg descend at 2.5x the relative rate of the last, the same mistake
 * FlyDown.tsx's SECONDS_PER_DECADE avoids -- the perceptually uniform quantity is
 * d(log alt)/du, which decade-weighting holds constant. That is also what descentPath()
 * does inside a leg, so the bar and the path agree about what "halfway" means.
 */
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
 * DERIVED at render and never written into CSS, because the first three legs move with the
 * suite params: a params set that made a descent leg degenerate would change the weights,
 * and a tick drawn at a hard-coded percentage would then point at the wrong stage.
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
 * u = 1 MAPS TO {stage: 5, t: 0} RATHER THAN {stage: 4, t: 1}, because those are the same
 * POSE, not a boundary between two different ones: thresholdPath() pins its last stop to
 * the kf[5] object itself. Naming it stage 5 is what makes the top of the bar land on the
 * stage the HUD then names, instead of on the tail end of the one before it.
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
