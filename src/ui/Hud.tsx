"use client";

import { STAGES, useStore, type StageId } from "@/state/store";

/**
 * Stage scrubber, stage name, and the skip control.
 *
 * The skip button is FIRST in tab order and first in the DOM. The immersive
 * pattern the design system adopted requires an escape from the intro sequence,
 * and a skip you have to tab past six stage buttons to reach is not one.
 */
export function Hud() {
  const stage = useStore((s) => s.stage);
  const t = useStore((s) => s.t);
  const setStage = useStore((s) => s.setStage);
  const setT = useStore((s) => s.setT);
  const skip = useStore((s) => s.skipToSuite);
  const reduced = useStore((s) => s.reducedMotion);

  return (
    <>
      <button className="skip" onClick={skip} data-testid="skip">
        Skip to the room
      </button>

      <div className="hud" data-testid="hud">
        <div className="hud-stage" data-testid="stage-name">
          <span className="hud-num">{stage}</span>
          {STAGES[stage].name}
          {reduced ? <span className="hud-flag">reduced motion</span> : null}
        </div>

        <div className="hud-scrub" role="group" aria-label="Stage">
          {STAGES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStage(s.id as StageId)}
              aria-current={s.id === stage ? "step" : undefined}
              aria-label={`Stage ${s.id}: ${s.name}`}
              data-testid={`stage-${s.id}`}
              className={s.id === stage ? "on" : ""}
            >
              {s.id}
            </button>
          ))}
        </div>

        {stage === 4 ? (
          <label className="hud-t">
            through the wall
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={t}
              onChange={(e) => setT(Number(e.target.value))}
              data-testid="threshold-t"
              aria-label="Threshold progress"
            />
            <span className="tabular">{t.toFixed(2)}</span>
          </label>
        ) : null}
      </div>
    </>
  );
}
