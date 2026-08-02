"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import { HAS_TILES_KEY, subscribeSettled, getSettled } from "@/scene/Tiles";

/**
 * First-paint gate on tiles settled. P11 phase 4 step 2
 * (docs/phases/P11-PHOTOREAL.md decision 11: "Quality-first, gate on settled. Loading
 * bar at first paint; the fly-down waits for tiles rather than flying through blur.").
 *
 * WHY A SUBSCRIPTION AND NOT A STORE FIELD: state/store.ts is out of scope for this
 * task (a concurrent agent may be editing it), so this reads Tiles.tsx's own
 * module-scope probe -- the same `window.__tiles` pattern that file already uses for
 * `constructions`/`rootRequests` -- through `subscribeSettled`/`getSettled` rather than
 * through a new zustand field. `useSyncExternalStore` is the correct primitive for a
 * mutable value that lives outside React: it re-renders this component exactly when
 * `Tiles.tsx` calls its listeners, and nothing else needs to poll or diff by hand.
 *
 * RENDERS NOTHING WITHOUT A KEY, on its own, rather than requiring every mount site to
 * remember the gate: `HAS_TILES_KEY` is false on the keyless fallback path (decision
 * 10), where `FallbackGround`'s L3/L4 quads and `campus.glb` load fast and
 * synchronously -- there is nothing to wait for, so there is nothing to show a bar
 * for.
 */
export function LoadingBar() {
  const settled = useSyncExternalStore(subscribeSettled, getSettled, getSettled);

  if (!HAS_TILES_KEY || settled) return null;

  return (
    <div role="status" aria-live="polite" data-testid="loading-bar" style={trackStyle}>
      <div style={sweepStyle} />
      <span className="hud-sr">Loading imagery&hellip;</span>
      <style>{`
        @keyframes loadingBarSweep {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}

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

const sweepStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  width: "28%",
  background: "var(--line)",
  // Reduced motion is handled globally: app/globals.css's
  // `@media (prefers-reduced-motion: reduce)` forces every animation-duration to
  // 0.01ms and every iteration-count to 1, so this collapses to a single static frame
  // there rather than needing its own guard.
  animation: "loadingBarSweep 1.1s var(--ease-out-quint) infinite",
};
