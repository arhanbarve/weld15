"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { HAS_TILES_KEY, subscribeProgress, getProbe, type TilesPhase } from "@/scene/Tiles";
import { subscribePreload, getPreloadProbe } from "@/scene/Preload";

/**
 * First-paint progress against tiles settling. P11 phase 4/5
 * (docs/phases/P11-PHOTOREAL.md decision 11: "Quality-first, gate on settled. Loading
 * bar at first paint; the fly-down waits for tiles rather than flying through blur.").
 *
 * REWRITTEN FROM A SWEEP TO A PHASE CHECKLIST, P11 phase 5. The sweep (an indeterminate
 * bar with no numbers) was honest about not knowing how long the wait would be, but it
 * told the viewer nothing about WHY -- a viewer staring at three or four seconds of
 * unexplained motion reads it as the app being slow, not as "downloading a real,
 * photorealistic Earth from Google's own servers", which is what is actually happening
 * and is a wait worth explaining rather than hiding. What replaced it names the four
 * things that really happen, in order, ticks each one off as `window.__tiles`'s own
 * probe reports it done, and shows the real tile count once one is available -- the
 * psychology being that a labelled, ticking checklist reads as SHORTER than an
 * unexplained bar of the same duration, because the viewer can see that the wait has a
 * shape and an end, not just a number climbing.
 *
 * WHY A SUBSCRIPTION AND NOT A STORE FIELD, still: state/store.ts's own concerns aside,
 * this reads Tiles.tsx's own module-scope probe -- `subscribeProgress`/`getProbe`, the
 * same device `subscribeSettled`/`getSettled` already were -- rather than a new zustand
 * field, because the probe already carries everything this needs (`phase`,
 * `loadProgress`, `stats`, `stage`) and duplicating it into the store would be a second
 * place for the same numbers to drift out of step with Tiles.tsx's own frame loop.
 * `useSyncExternalStore`'s replacement here is a plain `useState` + `useEffect`
 * subscription instead, because this component ALSO needs its own `setInterval` for the
 * creep floor below, which `useSyncExternalStore` has no room for.
 *
 * RENDERS NOTHING WITHOUT A KEY, on its own, exactly as before: `HAS_TILES_KEY` is false
 * on the keyless fallback path (decision 10), where `FallbackGround`'s L3/L4 quads and
 * `campus.glb` load fast and synchronously -- there is nothing to wait for, so there is
 * nothing to show a bar for.
 */

/** Where the descent is, in words a viewer recognises -- indexed by the store's own `stage`. */
const STAGE_LABELS = ["orbit", "Cambridge, MA", "Harvard Yard", "Weld Hall"] as const;

function stageLabel(stage: number): string {
  return STAGE_LABELS[Math.min(Math.max(stage, 0), STAGE_LABELS.length - 1)]!;
}

/**
 * How long, in seconds, the creep floor takes to reach its cap -- see `displayedProgress`
 * below. Chosen against this file's own measured sessions: a live run settled in 1.8-4.8 s
 * cold and streamed several more per stage during flight, so 6 s is comfortably past a
 * typical episode's real completion (the real `loadProgress` normally overtakes the floor
 * well before it) and still short enough that a genuinely slow episode reads as "almost
 * there" rather than stalled at some arbitrary lower number.
 */
const CREEP_SECONDS = 6;

/** The creep floor's cap -- never reads 100% on its own; only a real settle does that. */
const CREEP_CAP = 0.92;

/**
 * The bar's own fill, 0 to 1, blending the real per-tile fraction with a floor that
 * creeps forward on elapsed time alone. NEVER MOTIONLESS is the requirement this exists
 * for: `TilesRendererImpl.loadProgress` can sit still for a real stretch when the parse
 * queue (not the network) is the bottleneck -- exactly the failure this app's own
 * `errorTarget`/`parseQueue.maxJobs` tuning (Tiles.tsx) exists to shrink but cannot
 * promise to eliminate -- and a bar that stops moving reads as broken rather than slow.
 * `Math.max` rather than a blend keeps it monotonic: the floor only ever pulls the
 * displayed value UP toward what real progress will eventually reach on its own, never
 * down, and once real progress overtakes the floor the floor is simply irrelevant.
 */
function displayedProgress(phase: TilesPhase, loadProgress: number, elapsedSec: number): number {
  if (phase === "boot") return 0.04;
  if (phase === "auth") return 0.12;
  if (phase === "settled") return 1;
  const floor = Math.min(CREEP_CAP, elapsedSec / CREEP_SECONDS);
  return 0.15 + 0.85 * Math.max(loadProgress, floor);
}

/**
 * Milliseconds the widget waits before appearing, so a cache-warm reload that settles
 * almost instantly never flashes a checklist for one frame. Every cold run this file's
 * own measurement produced took at least 1.8 s to settle, so this delay is invisible on
 * the path it exists for and costs nothing on the path it is meant to hide.
 */
const APPEAR_DELAY_MS = 250;

/** How long the widget takes to fade out once settled, rather than disappearing on the frame it happens. */
const FADE_MS = 400;

export function LoadingBar() {
  const [probe, setProbe] = useState(getProbe);
  const [preload, setPreload] = useState(getPreloadProbe);
  const [now, setNow] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [opaque, setOpaque] = useState(false);

  useEffect(() => {
    if (!HAS_TILES_KEY) return;
    return subscribeProgress(setProbe);
  }, []);

  // P13: this bar covers ordinary in-app streaming (a heading drag off the preloaded set,
  // docs/phases/P13-PRELOAD.md section 1 decision 1's own accepted gap) -- not first load,
  // which is Preloader.tsx's blocking overlay. Showing both at once would be two progress
  // UIs arguing about the same wait, so this one stays hidden until the preloader's own
  // `done` flips (or never applies at all, `!HAS_TILES_KEY`/`?preload=0`).
  useEffect(() => subscribePreload(setPreload), []);

  // The creep floor's clock. Only ticks while there is a real episode in flight -- boot,
  // auth and settled all have a fixed displayed value (see `displayedProgress`) that does
  // not need a `now` to compute, so the interval is torn down rather than running for the
  // page's whole lifetime.
  useEffect(() => {
    if (probe.phase !== "stream") return;
    setNow(performance.now());
    const id = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(id);
  }, [probe.phase, probe.episode]);

  /**
   * Mount/fade timing, keyed on `shouldShow` -- a BOOLEAN, not `probe.phase` itself. That
   * distinction is the whole correctness of this effect: `shouldShow` stays `true` across
   * boot -> auth -> stream (three phase changes, zero real visibility transitions), so an
   * effect keyed on it schedules the 250 ms appear-timer exactly once per genuine
   * hidden-to-shown edge. Keying on `probe.phase` instead would re-run this effect on
   * every sub-phase change too, and since React tears down a previous run's timeout
   * before starting the next, an auth->stream transition arriving inside the 250 ms
   * window would cancel the pending appear-timer with nothing left to reschedule it --
   * the bar would never appear at all. `useState` for `mounted`/`opaque` rather than one
   * combined flag because they move on different clocks: `mounted` gates whether the
   * card exists in the DOM at all, `opaque` is the CSS transition's own target and has to
   * flip to 0 immediately on hide (so the transition has something to animate) while
   * `mounted` only flips false once `FADE_MS` has actually elapsed.
   */
  const shouldShow = HAS_TILES_KEY && probe.phase !== "settled" && preload.done;
  useEffect(() => {
    if (shouldShow) {
      const id = setTimeout(() => {
        setMounted(true);
        setOpaque(true);
      }, APPEAR_DELAY_MS);
      return () => clearTimeout(id);
    }
    setOpaque(false);
    const id = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(id);
  }, [shouldShow]);

  if (!HAS_TILES_KEY || !mounted) return null;

  const elapsedSec =
    probe.phase === "stream" && now !== null && probe.episodeStartMs
      ? Math.max(0, (now - probe.episodeStartMs) / 1000)
      : 0;
  const progress = displayedProgress(probe.phase, probe.loadProgress, elapsedSec);

  const stats = probe.stats;
  const total = stats ? stats.loaded + stats.queued + stats.downloading + stats.parsing : 0;

  const rendererOnline = probe.phase !== "boot";
  const sessionOpen = probe.rootRequests >= 1;
  const streaming = probe.phase === "stream";
  const midDescent = streaming && probe.stage > 0;

  const summary = !rendererOnline
    ? "Warming up the renderer."
    : !sessionOpen
      ? "Opening a session with Google Earth."
      : streaming
        ? `Streaming Earth ${probe.stage === 0 ? "from orbit" : `near ${stageLabel(probe.stage)}`}, ${Math.round(progress * 100)} percent.`
        : "";

  return (
    <div data-testid="loading-bar" style={{ ...wrapStyle, opacity: opaque ? 1 : 0 }}>
      {/* aria-hidden on the visual half only -- NOT on this whole wrapper, which would
          also hide the live region below it. An aria-hidden ancestor removes every
          descendant from the accessibility tree regardless of its own aria-live, so the
          summary has to sit outside this div rather than inside it. */}
      <div aria-hidden="true">
        <div style={trackStyle}>
          <div style={{ ...fillStyle, width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div data-testid="loading-checklist" style={cardStyle}>
          <ChecklistRow done={rendererOnline} active={!rendererOnline}>
            Renderer online
          </ChecklistRow>
          <ChecklistRow done={sessionOpen} active={rendererOnline && !sessionOpen}>
            Session opened with Google Earth
          </ChecklistRow>
          <ChecklistRow done={sessionOpen && !streaming && rendererOnline} active={streaming}>
            Streaming Earth {probe.stage === 0 ? "from orbit" : `near ${stageLabel(probe.stage)}`}
            {streaming && total > 0 ? (
              <div style={subStyle} className="tabular">
                {stats!.loaded} / {total} tiles
              </div>
            ) : null}
          </ChecklistRow>
          <ChecklistRow done={false} active={midDescent}>
            Descending to {stageLabel(probe.stage + 1)}
          </ChecklistRow>
        </div>
      </div>
      <span className="hud-sr" aria-live="polite" aria-atomic="true" data-testid="loading-live">
        {summary}
      </span>
    </div>
  );
}

function ChecklistRow({
  done,
  active,
  children,
}: {
  done: boolean;
  active: boolean;
  children: React.ReactNode;
}) {
  const mark = done ? "✓" : active ? "▸" : "·";
  return (
    <div style={rowStyle}>
      <span style={{ ...markStyle, color: done ? "var(--given)" : active ? "var(--line)" : "var(--faint)" }}>
        {mark}
      </span>
      <span style={active || done ? undefined : dimTextStyle}>{children}</span>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
  transition: `opacity ${FADE_MS}ms var(--ease-out-quint)`,
};

const trackStyle: CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  right: 0,
  height: 3,
  // --z-toast: the same transient-chrome level `.skip` uses (app/globals.css), above
  // every panel and below nothing that would need to occlude it.
  zIndex: 60,
  background: "var(--void-deep)",
  overflow: "hidden",
};

const fillStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  background: "var(--line)",
  transition: "width 300ms var(--ease-out-quint)",
};

const cardStyle: CSSProperties = {
  position: "fixed",
  left: "var(--s2)",
  bottom: "var(--s2)",
  zIndex: 60,
  background: "var(--chip-scan)",
  border: "1px solid var(--rule-soft)",
  borderRadius: 2,
  padding: "0.6rem 0.75rem",
  fontFamily: "var(--mono)",
  fontSize: "0.6875rem",
  letterSpacing: "0.02em",
  color: "var(--ink)",
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
  minWidth: "13rem",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "0.5rem",
};

const markStyle: CSSProperties = {
  width: "1em",
  flexShrink: 0,
  textAlign: "center",
};

const dimTextStyle: CSSProperties = {
  color: "var(--faint)",
};

const subStyle: CSSProperties = {
  color: "var(--dim)",
  marginTop: "0.15rem",
};
