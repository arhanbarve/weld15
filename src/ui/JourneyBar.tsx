"use client";

import { useEffect } from "react";
import { LAST_STAGE, STAGES, type StageId } from "@/state/store";
import type { SuiteParams } from "@/geo/rooms";
import { boundaries, legs, toJourney } from "@/scene/journey";

/**
 * The master scrubber: one range input that carries the whole descent, orbit to hall,
 * plus the six stage ticks that sit on it.
 *
 * Holds no store subscription of its own. Hud.tsx already reads every field this needs
 * -- stage, t, params -- and passing them down is what keeps this component testable
 * and free of a second opinion about the (stage, t) <-> u mapping, which lives once in
 * journey.ts.
 */
type Props = {
  stage: StageId;
  t: number;
  params: SuiteParams;
  onScrub: (u: number) => void;
  onScrubbing: (v: boolean) => void;
  onPickStage: (s: StageId) => void;
};

/**
 * Where the handle is on the STAGE scale, 0 at orbit to 5 in the hall.
 *
 * stage + t, and not the slider's own u: u is the bar's geometry (journey.ts weights the
 * descent legs by decades of altitude, so it is deliberately non-linear in stage), while
 * the ticks the viewer reads are the stage numbers. This is the number under the handle.
 *
 * CLAMPED AT LAST_STAGE because stage 5 carries a real t: skipToSuite() sets `{ stage: 5,
 * t: 1 }`, and 5 + 1 would put a "6.00" under a bar whose last tick is 5. Stage 5 is a
 * place rather than a leg -- stages.ts's cameraKeyframe ignores t there, and toJourney()
 * already maps every stage-5 t to u = 1 -- so the whole stage is one point on this scale.
 */
function position(stage: StageId, t: number): number {
  return Math.min(LAST_STAGE, stage + Math.min(1, Math.max(0, t)));
}

/**
 * window.__journey, for the e2e gates.
 *
 * Same device as CameraRig's window.__cam, Perf's window.__perf and DragLayer's
 * window.__drag: a gate driving the slider by u needs boundaries(params) to compute a
 * target for a given (stage, t), and the alternative is a second implementation of
 * journey.ts's mapping in test code. Cleaned up on unmount, like window.__drag.
 */
export function JourneyBar({ stage, t, params, onScrub, onScrubbing, onPickStage }: Props) {
  useEffect(() => {
    const probe = {
      boundaries: boundaries(params),
      spans: legs(params).map((l) => l.span),
      total: legs(params).reduce((sum, l) => sum + l.span, 0),
    };
    const w = window as unknown as { __journey?: typeof probe };
    w.__journey = probe;
    return () => {
      if (w.__journey === probe) delete w.__journey;
    };
  }, [params]);

  return (
    <div className="jbar" data-testid="journey-bar">
      <input
        type="range"
        min={0}
        max={1}
        step={0.0005}
        value={toJourney(stage, t, params)}
        onChange={(e) => onScrub(Number(e.target.value))}
        onPointerDown={() => onScrubbing(true)}
        onPointerUp={() => onScrubbing(false)}
        onPointerCancel={() => onScrubbing(false)}
        data-testid="journey"
        aria-label="Descend from orbit to the room"
        aria-valuetext={`${STAGES[stage].name}, ${position(stage, t).toFixed(2)} of ${LAST_STAGE}`}
        aria-describedby="journey-ticks"
      />
      {/* THE STAGE'S NAME AND THE POSITION ON THE STAGE SCALE, which is a fix and not a
          dressing-up. This read `t.toFixed(2)` -- progress WITHIN the current stage, 0 to 1
          -- directly beneath ticks labelled 0 to 5, so two thirds of the way through Harvard
          Yard it showed "0.67" while the tick under the handle said 2. One handle, two
          different numbers, and the one on display was the one nothing else in the interface
          uses. position() below is the scale the ticks are already drawn on.

          Kept as the input's next sibling: a gate polling `slider.locator("+ span.tabular")`
          is reading a shape this component promises, and the shape has not moved. */}
      <span className="tabular" data-testid="journey-read">
        {STAGES[stage].name} · {position(stage, t).toFixed(2)}
      </span>

      <div className="jbar-ticks" id="journey-ticks">
        {STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            className={s.id === stage ? "on" : ""}
            style={{ left: `${boundaries(params)[s.id]! * 100}%` }}
            onClick={() => onPickStage(s.id as StageId)}
            aria-current={s.id === stage ? "step" : undefined}
            aria-label={`Stage ${s.id}: ${s.name}`}
            data-testid={`stage-${s.id}`}
          >
            {s.id}
          </button>
        ))}
      </div>
    </div>
  );
}
