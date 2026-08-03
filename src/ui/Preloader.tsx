"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { subscribePreload, getPreloadProbe, batchCopy, preloadDisabled, type PreloadProbe } from "@/scene/Preload";
import { preloadPoses } from "@/scene/preloadPlan";
import { HAS_TILES_KEY } from "@/scene/Tiles";
import { useStore } from "@/state/store";

/**
 * The blocking overlay P13 asks for: the app is genuinely unreachable until enough of the
 * descent is resident to fly it (docs/phases/P13-PRELOAD.md section 5 step 5).
 *
 * GATES ON `unlockable`, NOT `done`. Waiting for every batch plus `finalizing` measured at
 * ~8.5 minutes of blank screen, which is not a wait anyone sits through. Preload.tsx's own
 * `UNLOCK_AFTER_BATCH` comment carries which batch is the line and why that specific one;
 * what matters here is that the last batches and `finalizing` keep running AFTER this
 * overlay leaves, and LoadingBar.tsx picks that remainder up the same way it already covers
 * ordinary in-app streaming. So this screen deliberately disappears with its own ladder
 * unfinished -- the footnote below says so out loud rather than letting it read as a jump.
 *
 * `pointerEvents: "auto"` and a full-viewport `inset: 0` -- unlike LoadingBar.tsx's own
 * hairline-and-checklist, which is deliberately `pointerEvents: "none"` because it exists to
 * cover ordinary in-app streaming, not first load. This is the opposite: nothing behind it
 * should be reachable, by pointer or by keyboard, until the app is interactive.
 *
 * SAME SUBSCRIPTION SHAPE AS LoadingBar.tsx, for the same reason (that file's own header):
 * Preload.tsx's probe lives at module scope in a Canvas-mounted component, so a plain DOM
 * component outside the Canvas reads it through a subscription rather than a store field.
 *
 * `!HAS_TILES_KEY || preloadDisabled()` renders nothing -- the keyless fallback path has no
 * tiles to preload, and `?preload=0` is the escape hatch (section 1 decision 4) tests and a
 * fast dev loop use.
 *
 * WHY A LADDER AND NOT A SPINNER. The whole app is one descent, orbit to a dorm room, and
 * the preload walks it in altitude order -- coarse tiles first (preloadPlan.ts's own batch
 * comment). A bar reduces that to one number; the ladder shows the shape of the wait, which
 * is the same psychology LoadingBar.tsx's own header records for replacing its sweep with a
 * checklist: a labelled descent with seven named legs and a real altitude against each reads
 * as shorter than an unexplained bar of the same duration, because the viewer can see where
 * they are in it. Every figure on screen is real -- the altitudes come from the same
 * `preloadPoses()` the synthetic cameras are built from, and the marker's position is
 * `probe.progress`, not a timer.
 */

/**
 * Row pitch, rem. The marker and the rail's traversed segment are positioned by ARITHMETIC
 * on this (`markerRem` below), not by measuring the DOM, so every row must be exactly this
 * tall -- hence an explicit `height` on the row rather than letting content size it.
 */
const ROW_REM = 2.25;

/**
 * Keyframes, which inline style objects cannot express, in a <style> element of this
 * component's own -- the same device A11yAlt.tsx used for its :hover/:focus-visible rules
 * (that file's header records it), and with the same note: this belongs in app/globals.css
 * under a heading of its own as soon as one owner holds both files. Every name is prefixed
 * `preloader-` so nothing here can reach another owner's markup.
 *
 * `color-mix` rather than a literal rgba() so the glow is derived from `--line` instead of
 * being a fourth blue nobody can trace back to a token.
 */
const OVERLAY_CSS = `
@keyframes preloader-scan {
  from { transform: translateY(-120%); }
  to { transform: translateY(400%); }
}
@keyframes preloader-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--line) 55%, transparent); }
  60% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--line) 0%, transparent); }
}
@keyframes preloader-caret {
  0%, 45% { opacity: 1; }
  55%, 100% { opacity: 0.12; }
}
`;

/** Where the marker is on a rung: the three states ChecklistRow (LoadingBar.tsx) already established. */
type RungState = "done" | "active" | "pending";

/** One rung of the ladder: a batch, its copy, and the altitude band its poses actually sit in. */
type Rung = {
  batch: number;
  label: string;
  /** Highest sampled altitude in the batch -- the altitude the descent ENTERS this rung at. */
  entryFt: number;
  /** Lowest sampled altitude in the batch. */
  exitFt: number;
};

/**
 * Altitude at a fractional rung position, INTERPOLATED IN LOG SPACE.
 *
 * The descent crosses ~7 decades (31.4M ft to 5 ft), so a linear reading would sit above 10M
 * ft for the first two thirds of the ladder and then collapse -- it would look stuck. Log is
 * also the axis the plan itself is sampled on (preloadPlan.ts's own header: uniform spacing
 * in `u` is uniform spacing in decades of altitude), which is why the rungs can be evenly
 * spaced on screen and still be a true log ladder: each one really is about a decade.
 *
 * `breaks` is one entry longer than the ladder -- every rung's entry altitude, plus the last
 * rung's exit -- so position `n` is the bottom of the descent rather than off the end.
 */
function altAt(breaks: number[], pos: number): number {
  const i = Math.max(0, Math.min(Math.floor(pos), breaks.length - 2));
  const f = Math.max(0, Math.min(1, pos - i));
  return Math.exp(Math.log(breaks[i]!) * (1 - f) + Math.log(breaks[i + 1]!) * f);
}

/**
 * Feet, abbreviated by magnitude so the whole ladder is one narrow right-aligned column:
 * 31.4M, 3.4M, 356K, 38K, 4,021, 418, 80. Below 10,000 ft the exact figure is short enough
 * to print in full, and near the ground it is the interesting part -- "80 ft" is Weld's own
 * height, "4.0K ft" is not a number anyone reads as a rooftop.
 *
 * `"en-US"` explicitly, not the ambient locale: this component renders on the server too,
 * and a separator that differs between Node's locale and the browser's is a hydration
 * mismatch on the app's very first paint.
 */
function formatAlt(ft: number): string {
  if (ft >= 1e6) return `${(ft / 1e6).toFixed(1)}M`;
  if (ft >= 1e4) return `${Math.round(ft / 1e3)}K`;
  return Math.round(ft).toLocaleString("en-US");
}

/** The same reading in words -- "31.4 million feet" rather than a fourteen-digit number read out digit by digit. */
function sayAlt(ft: number): string {
  if (ft >= 1e6) return `${(ft / 1e6).toFixed(1)} million feet`;
  if (ft >= 1e4) return `${Math.round(ft / 1e3)} thousand feet`;
  return `${Math.round(ft)} feet`;
}

/** GiB once there is a whole one, MiB before that -- the range this preload actually spans. */
function formatBytes(bytes: number): string {
  const gib = bytes / 2 ** 30;
  return gib >= 1 ? `${gib.toFixed(2)} GB` : `${Math.round(bytes / 2 ** 20)} MB`;
}

/** Elapsed time on this screen, as a mission clock. */
function clock(sec: number): string {
  const whole = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export function Preloader() {
  const [probe, setProbe] = useState<PreloadProbe>(getPreloadProbe);
  const reducedMotion = useStore((s) => s.reducedMotion);
  /**
   * The live params, not DEFAULT_PARAMS -- the same source Preload.tsx builds its cameras
   * from, so the altitudes on screen are the altitudes actually being loaded. A link
   * carrying a snapshot can set non-default dimensions before first paint, and the overlay
   * blocks every control that could change them afterwards, so this subscription fires at
   * most once in this component's lifetime.
   */
  const params = useStore((s) => s.params);

  const [elapsedSec, setElapsedSec] = useState(0);
  const startedMs = useRef<number | null>(null);

  useEffect(() => subscribePreload(setProbe), []);

  /**
   * The mission clock. It exists because PROGRESS CAN GENUINELY SIT STILL for a long
   * stretch: Preload.tsx's `BATCH_TIMEOUT_MS` is 90 s, and a batch whose parse queue is the
   * bottleneck can hold one rung for most of that -- the same "a bar that stops moving reads
   * as broken" failure LoadingBar.tsx's creep floor exists for, except a fake floor would be
   * dishonest across a wait this long. A clock is honest and never stops.
   *
   * Not gated on `reducedMotion`: a once-a-second digit is information, not animation, and
   * this is the one readout that proves the app is still working.
   *
   * Started from mount rather than from page load, and torn down once `unlockable` flips, so
   * the interval does not outlive the overlay it belongs to. Elapsed lives in a ref across
   * that one dependency change so a re-run could not reset the clock.
   */
  useEffect(() => {
    if (!HAS_TILES_KEY || probe.unlockable) return;
    const start = startedMs.current ?? performance.now();
    startedMs.current = start;
    const id = window.setInterval(() => setElapsedSec((performance.now() - start) / 1000), 1000);
    return () => window.clearInterval(id);
  }, [probe.unlockable]);

  /**
   * The ladder: one rung per batch, with the altitude band its poses really occupy.
   *
   * Derived here rather than exported from preloadPlan.ts because it is a presentation
   * grouping of that file's own output and nothing else needs it -- `preloadPoses()` already
   * carries `batch` and `altFt` per pose, so this is a group-by, not a second plan.
   */
  const rungs = useMemo<Rung[]>(() => {
    const byBatch = new Map<number, number[]>();
    for (const p of preloadPoses(params)) {
      const alts = byBatch.get(p.batch);
      if (alts) alts.push(p.altFt);
      else byBatch.set(p.batch, [p.altFt]);
    }
    return [...byBatch.keys()]
      .sort((a, b) => a - b)
      .map((batch) => {
        const alts = byBatch.get(batch)!;
        return { batch, label: batchCopy(batch), entryFt: Math.max(...alts), exitFt: Math.min(...alts) };
      });
  }, [params]);

  const breaks = useMemo(
    () => [...rungs.map((r) => r.entryFt), rungs[rungs.length - 1]!.exitFt],
    [rungs],
  );

  // ALWAYS RENDERED, even once unlocked or when preloading never applies -- the one DOM node
  // a gate can wait on (`getByTestId("preload-done")`) regardless of which of the states
  // below produced it. `data-done` is still the whole preload including `finalizing`;
  // `data-unlockable` is the narrower thing the overlay itself now gates on, so a future
  // gate can wait for "the app is usable" without waiting for "everything is resident".
  const sentinel = (
    <span
      data-testid="preload-done"
      data-done={probe.done}
      data-unlockable={probe.unlockable}
      style={{ display: "none" }}
    />
  );

  if (!HAS_TILES_KEY || preloadDisabled() || probe.unlockable) return sentinel;

  const title =
    probe.phase === "boot"
      ? "Warming up the renderer"
      : probe.phase === "auth"
        ? "Opening a session with Google Earth"
        : probe.phase === "finalizing"
          ? "Pinning everything in memory"
          : batchCopy(probe.batch);

  const pct = Math.round(probe.progress * 100);

  /**
   * Fractional rung position. `probe.progress` is `(batch + batchFrac) / totalBatches`
   * (Preload.tsx's own field docs), so this is `batch + batchFrac` -- the marker creeps
   * WITHIN a rung as that batch's tiles land, not just between rungs.
   */
  const pos = Math.min(1, probe.progress) * rungs.length;
  /**
   * Marker offset. `+ 0.5` because a rung's node sits at its row's midpoint, so position 0
   * means "on rung 0's node", not "above the ladder"; clamped to the last node so a
   * `finalizing` frame (position `n`) sits at the bottom of the rail rather than past it.
   */
  const markerRem = Math.min(pos + 0.5, rungs.length - 0.5) * ROW_REM;

  const rendererOnline = probe.phase !== "boot";
  const sessionOpen = rendererOnline && probe.phase !== "auth";

  /**
   * What a reader who cannot see the ladder hears. COARSE ON PURPOSE: a polite live region
   * re-speaks on every text change, `publish()` fires every 100 ms, and this screen lives
   * for minutes -- a sentence carrying the exact percentage or tile count would be a
   * continuous stream of speech. Rounding to the nearest 10 percent means roughly one
   * announcement per leg, alongside the leg's own name changing. The tile counter and the
   * altimeter are in the visual half only, which is what they are for.
   */
  const summary = `${title}. Leg ${Math.min(probe.batch + 1, rungs.length)} of ${rungs.length}, about ${Math.round(probe.progress * 10) * 10} percent, altitude ${sayAlt(altAt(breaks, pos))}.`;

  return (
    <div style={wrapStyle} role="status" aria-busy="true" aria-live="polite" data-testid="preloader">
      <style>{OVERLAY_CSS}</style>

      {/* Backdrop, in two layers behind the card. The grid is masked to an ellipse so it
          reads as an instrument's own field rather than as graph paper edge to edge; the
          sweep is the one piece of decoration here, and it is the first thing
          `reducedMotion` removes because it is pure motion carrying no information. */}
      <div aria-hidden="true" style={gridLayerStyle} />
      {reducedMotion ? null : (
        <div aria-hidden="true" style={scanLayerStyle}>
          <div style={scanBandStyle} />
        </div>
      )}

      {/* aria-hidden on the visual half only -- NOT on the wrapper, which would also hide
          the live region below it. An aria-hidden ancestor removes every descendant from the
          accessibility tree regardless of its own aria-live, so the summary sits outside
          this card. Same split as LoadingBar.tsx, same reason. */}
      <div aria-hidden="true" style={cardStyle}>
        <div style={eyebrowRowStyle}>
          <span style={eyebrowStyle}>Curating the descent to Weld 15</span>
          <span className="tabular" style={eyebrowStyle}>
            T+{clock(elapsedSec)}
          </span>
        </div>

        <div style={titleStyle}>
          {title}
          <span
            style={{
              ...caretStyle,
              animation: reducedMotion ? "none" : "preloader-caret 1.1s steps(1, end) infinite",
            }}
          >
            ▍
          </span>
        </div>

        {/* Pre-flight, above the ladder: the two things that have to be true before a single
            camera can be registered (Preload.tsx's own boot/auth derivation). They are not
            rungs -- no altitude belongs to them -- but they are the whole of the first few
            seconds, and an all-pending ladder with no explanation reads as stalled. */}
        <div style={preflightStyle}>
          <span style={preflightItemStyle}>
            <Mark state={rendererOnline ? "done" : "active"} /> renderer
          </span>
          <span style={preflightItemStyle}>
            <Mark state={sessionOpen ? "done" : rendererOnline ? "active" : "pending"} /> earth session
          </span>
        </div>

        <div style={telemetryStyle}>
          <Readout label="altitude" value={formatAlt(altAt(breaks, pos))} unit="ft" hero />
          <Readout label="tiles resident" value={probe.tilesLoaded.toLocaleString("en-US")} />
          <Readout label="cached" value={probe.cachedBytes === null ? "—" : formatBytes(probe.cachedBytes)} />
          <Readout label="descent" value={`${pct}%`} />
        </div>

        <div style={ladderStyle}>
          {rungs.map((r, i) => (
            <RungRow
              key={r.batch}
              label={r.label}
              altFt={r.entryFt}
              state={i < probe.batch || probe.phase === "finalizing" ? "done" : i === probe.batch && probe.phase === "loading" ? "active" : "pending"}
              // How much of THIS row's rail the descent has already crossed. Clamped per
              // row, so rows above the marker are full, the row it is in is partial, and
              // rows below are empty -- one expression, no special cases.
              trail={Math.max(0, Math.min(1, pos + 0.5 - i))}
              first={i === 0}
              last={i === rungs.length - 1}
              reducedMotion={reducedMotion}
            />
          ))}

          {/* The marker: the live altitude's own reading against the ladder, which is why it
              tracks `pos` continuously rather than snapping to the active rung.

              DRAWN AS BRACKETS IN THE MARGINS, not as a full-width rule -- a hairline at this
              exact offset crosses the active rung's own label and would read as a
              strikethrough. The vertical caps are what make two short hairlines read as one
              measurement bracket rather than as stray dashes; without them the marker looked
              like a rendering artifact. */}
          <div
            style={{
              ...markerStyle,
              top: `${markerRem}rem`,
              transition: reducedMotion ? "none" : markerStyle.transition,
            }}
          >
            <span style={{ ...markerCapStyle, left: 0 }} />
            <span style={{ ...markerCapStyle, right: 0 }} />
          </div>
        </div>

        {/* Said out loud because the overlay leaves with rungs still pending, which would
            otherwise read as the loader giving up rather than as the intended hand-off to
            LoadingBar.tsx. */}
        <div style={footnoteStyle}>
          The room opens before the ladder finishes. The last legs keep streaming behind it.
        </div>
      </div>

      <span className="hud-sr" aria-live="polite" aria-atomic="true" data-testid="preloader-live">
        {summary}
      </span>
      {sentinel}
    </div>
  );
}

/** The ✓ / ▸ / · vocabulary ChecklistRow (LoadingBar.tsx) established, in the one place both the pre-flight row and the ladder can share it. */
function Mark({ state }: { state: RungState }) {
  return (
    <span
      style={{
        ...markStyle,
        color: state === "done" ? "var(--given)" : state === "active" ? "var(--line)" : "var(--faint)",
      }}
    >
      {state === "done" ? "✓" : state === "active" ? "▸" : "·"}
    </span>
  );
}

function RungRow({
  label,
  altFt,
  state,
  trail,
  first,
  last,
  reducedMotion,
}: {
  label: string;
  altFt: number;
  state: RungState;
  trail: number;
  first: boolean;
  last: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div
      style={{
        ...rowStyle,
        // The active rung is the only row with a ground of its own -- everything else on
        // this screen is a hairline, so a wash is enough to say "here" without a border.
        background: state === "active" ? "linear-gradient(90deg, color-mix(in srgb, var(--line) 8%, transparent), transparent 62%)" : "none",
      }}
    >
      <Mark state={state} />
      <span
        className="tabular"
        style={{ ...altCellStyle, color: state === "pending" ? "var(--faint)" : "var(--dim)" }}
      >
        {formatAlt(altFt)}
        <span style={altUnitStyle}> ft</span>
      </span>

      {/* The rail, one segment per row. Trimmed to the node at the two ends so the ladder
          starts and stops on a rung rather than overshooting by half a row, and the
          traversed fill is a CHILD of the segment so it inherits that trimming for free. */}
      <span style={railCellStyle}>
        <span style={{ ...railSegStyle, top: first ? "50%" : 0, bottom: last ? "50%" : 0 }}>
          <span
            style={{
              ...railTrailStyle,
              height: `${trail * 100}%`,
              transition: reducedMotion ? "none" : railTrailStyle.transition,
            }}
          />
        </span>
        <span
          style={{
            ...nodeStyle,
            ...(state === "done"
              ? { background: "var(--given)", borderColor: "var(--given)" }
              : state === "active"
                ? {
                    background: "var(--line)",
                    borderColor: "var(--line)",
                    animation: reducedMotion ? "none" : "preloader-pulse 1.8s var(--ease-out-quint) infinite",
                  }
                : { background: "var(--void-deep)", borderColor: "var(--faint)" }),
          }}
        />
      </span>

      <span style={{ ...labelCellStyle, color: state === "pending" ? "var(--faint)" : "var(--ink)" }}>
        {label}
      </span>
    </div>
  );
}

/** One telemetry cell. `hero` is the altimeter, which is the reading this screen is about. */
function Readout({
  label,
  value,
  unit,
  hero,
}: {
  label: string;
  value: string;
  unit?: string;
  hero?: boolean;
}) {
  return (
    <span style={readoutStyle}>
      <span style={readoutLabelStyle}>{label}</span>
      <span className="tabular" style={hero ? readoutHeroStyle : readoutValueStyle}>
        {value}
        {unit ? <span style={readoutUnitStyle}> {unit}</span> : null}
      </span>
    </span>
  );
}

const wrapStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  // 70, i.e. --z-tooltip (app/globals.css): above every panel, above LoadingBar.tsx's own
  // --z-toast track, because nothing may draw over a blocking overlay.
  zIndex: 70,
  // Not flat --void: the app opens on a globe against a vignette, and a card floating in the
  // middle of a plate of one colour is the generic-web-spinner look this screen exists to
  // avoid. The ellipse also gives the grid layer below something to fade into.
  background: "radial-gradient(ellipse at 50% 42%, var(--void), var(--void-deep) 78%)",
  display: "grid",
  placeItems: "center",
  padding: "var(--s3)",
  overflowY: "auto",
  pointerEvents: "auto",
};

const gridLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  backgroundImage:
    "repeating-linear-gradient(to right, var(--grid) 0 1px, transparent 1px 56px), repeating-linear-gradient(to bottom, var(--grid) 0 1px, transparent 1px 56px)",
  opacity: 0.34,
  maskImage: "radial-gradient(ellipse at 50% 45%, #000 20%, transparent 72%)",
  WebkitMaskImage: "radial-gradient(ellipse at 50% 45%, #000 20%, transparent 72%)",
};

/** Clips the sweep, so a band positioned past the bottom edge cannot extend the wrapper's scroll box. */
const scanLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  overflow: "hidden",
  pointerEvents: "none",
};

const scanBandStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  top: 0,
  height: "28%",
  background:
    "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--line) 7%, transparent), transparent)",
  animation: "preloader-scan 9s linear infinite",
};

const cardStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: "0.85rem",
  width: "min(33rem, calc(100vw - 3rem))",
  fontFamily: "var(--mono)",
  color: "var(--ink)",
};

const eyebrowRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "1rem",
  borderBottom: "1px solid var(--rule-soft)",
  paddingBottom: "0.5rem",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "0.625rem",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--faint)",
  whiteSpace: "nowrap",
};

const titleStyle: CSSProperties = {
  fontSize: "1rem",
  lineHeight: 1.3,
  color: "var(--ink)",
  minHeight: "1.3em",
};

const caretStyle: CSSProperties = {
  color: "var(--line)",
  marginLeft: "0.2em",
};

const preflightStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.25rem 1.1rem",
  fontSize: "0.625rem",
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--dim)",
};

const preflightItemStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.35rem",
};

const telemetryStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  // Baseline, not flex-end: each cell is a column whose first baseline is its LABEL, so this
  // is what puts the four labels on one line. Aligning the values instead (flex-end) left the
  // labels stepped by the altimeter's larger type, which read as a misalignment rather than
  // as a hierarchy.
  alignItems: "baseline",
  gap: "0.75rem 1.25rem",
  borderTop: "1px solid var(--rule-soft)",
  borderBottom: "1px solid var(--rule-soft)",
  padding: "0.6rem 0",
};

const readoutStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.2rem",
  minWidth: "5.5rem",
};

const readoutLabelStyle: CSSProperties = {
  fontSize: "0.5625rem",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--faint)",
};

const readoutValueStyle: CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--dim)",
};

const readoutHeroStyle: CSSProperties = {
  fontSize: "1.375rem",
  lineHeight: 1,
  color: "var(--ink)",
};

const readoutUnitStyle: CSSProperties = {
  fontSize: "0.625rem",
  color: "var(--faint)",
};

const ladderStyle: CSSProperties = {
  position: "relative",
};

const rowStyle: CSSProperties = {
  position: "relative",
  // Marker arithmetic depends on this being exact -- see ROW_REM.
  height: `${ROW_REM}rem`,
  display: "grid",
  gridTemplateColumns: "1.1rem 4.75rem 1.5rem 1fr",
  alignItems: "center",
  gap: "0.4rem",
  fontSize: "0.75rem",
  // Above the marker, so the brackets never sit on the type.
  zIndex: 1,
};

const markStyle: CSSProperties = {
  width: "1em",
  flexShrink: 0,
  textAlign: "center",
};

const altCellStyle: CSSProperties = {
  textAlign: "right",
  whiteSpace: "nowrap",
};

const altUnitStyle: CSSProperties = {
  color: "var(--faint)",
  fontSize: "0.625rem",
};

const railCellStyle: CSSProperties = {
  position: "relative",
  alignSelf: "stretch",
};

const railSegStyle: CSSProperties = {
  position: "absolute",
  left: "calc(50% - 0.5px)",
  width: 1,
  background: "var(--rule-soft)",
  overflow: "hidden",
};

const railTrailStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  background: "var(--line)",
  opacity: 0.55,
  transition: "height 300ms var(--ease-out-quint)",
};

const nodeStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 6,
  height: 6,
  marginLeft: -3,
  marginTop: -3,
  borderWidth: 1,
  borderStyle: "solid",
  // A diamond, so a rung node is not mistaken for the square chips the HUD uses.
  transform: "rotate(45deg)",
};

const labelCellStyle: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const markerStyle: CSSProperties = {
  position: "absolute",
  // Outside the card's content box, into the wrapper's own var(--s3) padding: the marker
  // coincides with a rung's row centre at the instant every batch starts, and inside the
  // content box its left bracket landed on that rung's ✓/▸ glyph. 0.9rem of overhang is well
  // inside 1.5rem of padding, so it cannot introduce a horizontal scroll even at the
  // narrowest width the card is allowed (calc(100vw - 3rem)).
  left: "-0.9rem",
  right: "-0.9rem",
  top: 0,
  height: 1,
  transform: "translateY(-50%)",
  // Brackets in the margins only -- the middle is transparent so the whole ladder reads
  // through it. See the marker's own note in the JSX.
  background:
    "linear-gradient(to right, var(--line) 0 0.9rem, transparent 0.9rem calc(100% - 0.9rem), var(--line) calc(100% - 0.9rem) 100%)",
  opacity: 0.8,
  transition: "top 320ms var(--ease-out-quint)",
};

const markerCapStyle: CSSProperties = {
  position: "absolute",
  top: -4,
  width: 1,
  height: 9,
  background: "var(--line)",
};

const footnoteStyle: CSSProperties = {
  fontSize: "0.625rem",
  lineHeight: 1.5,
  color: "var(--faint)",
  borderTop: "1px solid var(--rule-soft)",
  paddingTop: "0.5rem",
};
