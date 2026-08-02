"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { subscribePreload, getPreloadProbe, batchCopy, preloadDisabled, type PreloadProbe } from "@/scene/Preload";
import { HAS_TILES_KEY } from "@/scene/Tiles";
import { useStore } from "@/state/store";

/**
 * The blocking overlay P13 asks for: the app is genuinely unreachable until every tile the
 * whole descent can need is resident (docs/phases/P13-PRELOAD.md section 5 step 5).
 *
 * `pointerEvents: "auto"` and a full-viewport `inset: 0` -- unlike LoadingBar.tsx's own
 * hairline-and-checklist, which is deliberately `pointerEvents: "none"` because it exists to
 * cover ordinary in-app streaming, not first load. This is the opposite: nothing behind it
 * should be reachable, by pointer or by keyboard, until `done`.
 *
 * SAME SUBSCRIPTION SHAPE AS LoadingBar.tsx, for the same reason (that file's own header):
 * Preload.tsx's probe lives at module scope in a Canvas-mounted component, so a plain DOM
 * component outside the Canvas reads it through a subscription rather than a store field.
 *
 * `!HAS_TILES_KEY || preloadDisabled()` renders nothing -- the keyless fallback path has no
 * tiles to preload, and `?preload=0` is the escape hatch (section 1 decision 4) tests and a
 * fast dev loop use.
 */
export function Preloader() {
  const [probe, setProbe] = useState<PreloadProbe>(getPreloadProbe);
  const reducedMotion = useStore((s) => s.reducedMotion);

  useEffect(() => subscribePreload(setProbe), []);

  // ALWAYS RENDERED, even once done or when preloading never applies -- the one DOM node a
  // gate can wait on (`getByTestId("preload-done")`) regardless of which of the three states
  // below produced it. The overlay itself is conditionally the only OTHER thing this
  // component ever renders.
  const sentinel = (
    <span data-testid="preload-done" data-done={probe.done} style={{ display: "none" }} />
  );

  if (!HAS_TILES_KEY || preloadDisabled() || probe.done) return sentinel;

  const title =
    probe.phase === "boot"
      ? "Warming up the renderer"
      : probe.phase === "auth"
        ? "Opening a session with Google Earth"
        : probe.phase === "finalizing"
          ? "Pinning everything in memory"
          : batchCopy(probe.batch);

  const pct = Math.round(probe.progress * 100);

  return (
    <div style={wrapStyle} role="status" aria-busy="true" aria-live="polite" data-testid="preloader">
      <div style={cardStyle}>
        <div style={headingStyle}>Curating the descent to Weld 15</div>
        <div style={lineStyle} className="tabular">
          {title}
        </div>
        <div style={trackStyle}>
          <div
            style={{
              ...fillStyle,
              width: `${pct}%`,
              transition: reducedMotion ? "none" : fillStyle.transition,
            }}
          />
        </div>
        <div style={subStyle} className="tabular">
          {pct}% &middot; {probe.tilesLoaded} tiles
        </div>
      </div>
      {sentinel}
    </div>
  );
}

const wrapStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 70,
  background: "var(--void)",
  display: "grid",
  placeItems: "center",
  pointerEvents: "auto",
};

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.9rem",
  alignItems: "center",
  width: "min(26rem, calc(100vw - 3rem))",
  fontFamily: "var(--mono)",
  color: "var(--ink)",
};

const headingStyle: CSSProperties = {
  fontSize: "0.75rem",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--faint)",
};

const lineStyle: CSSProperties = {
  fontSize: "0.9375rem",
  color: "var(--ink)",
  minHeight: "1.2em",
  textAlign: "center",
};

const trackStyle: CSSProperties = {
  width: "100%",
  height: 3,
  background: "var(--void-deep)",
  overflow: "hidden",
};

const fillStyle: CSSProperties = {
  height: "100%",
  background: "var(--line)",
  transition: "width 300ms var(--ease-out-quint)",
};

const subStyle: CSSProperties = {
  fontSize: "0.6875rem",
  letterSpacing: "0.02em",
  color: "var(--dim)",
};
