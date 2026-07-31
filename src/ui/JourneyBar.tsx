"use client";

import { useEffect } from "react";
import { STAGES, type StageId } from "@/state/store";
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
        aria-valuetext={`${STAGES[stage].name}, ${(t * 100).toFixed(0)} per cent`}
        aria-describedby="journey-ticks"
      />
      {/* Kept as the input's next sibling and formatted to two places, because
          threshold.spec.ts polls `slider.locator("+ span.tabular")` for t.toFixed(2). That
          selector is an interface; the testid changed, the shape did not. */}
      <span className="tabular" data-testid="journey-read">
        {t.toFixed(2)}
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
