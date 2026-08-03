"use client";

import { useCallback, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { TilesRenderer as TilesRendererR3F, TilesPlugin } from "3d-tiles-renderer/r3f";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/plugins";
import type { TilesRenderer as TilesRendererImpl } from "3d-tiles-renderer/three";
import { ecefToSite, type Vec3 } from "./geo/frame";
import { useStore } from "@/state/store";
import { thresholdOpacity } from "./stages";
import { applyWeldCarve, carveUniforms, type CarveUniforms } from "./tilesCarve";
import { modelMode } from "./cutaway";

/**
 * Live Google Photorealistic 3D Tiles: P11 phase 1.
 *
 * MOUNTED ONLY WHEN NEXT_PUBLIC_GOOGLE_MAPS_KEY IS SET -- Experience.tsx's job, not this
 * file's. This component still has to import cleanly with no key present (nothing at
 * module scope depends on the key existing), since a test context could import it without
 * ever mounting it.
 *
 * WHAT IS DELIBERATELY NOT HERE YET: the Weld-carving shader (tilesCarve.ts, phase 3) and
 * attribution UI (phase 1's remainder, wired into Provenance/Sources). This component's
 * job is just: mount tiles, place them, publish the probe.
 *
 * CONSTRUCTED EXACTLY ONCE PER PAGE LOAD. 3d-tiles-renderer's own <TilesRenderer> only
 * builds a new TilesRendererImpl when its `url`/`invalidate` deps change (see
 * node_modules/3d-tiles-renderer/src/r3f/components/TilesRenderer.jsx) -- neither of which
 * this component ever changes across a re-render, so React re-rendering <Tiles> on a stage
 * change does NOT rebuild the tileset. A new TilesRendererImpl issues a new billable root
 * tileset request (docs/phases/P11-PHOTOREAL.md section 1.1), so `window.__tiles` publishes
 * a construction count and a root-request count so a gate can assert both stay at 1 across
 * a full journey sweep.
 */

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY ?? "";

/**
 * Whether a Google Maps key is present, decided once at module scope -- the same
 * build-time constant Experience.tsx computes for itself (Next.js inlines
 * `NEXT_PUBLIC_*` at build time, so re-deriving it here from the same env var costs
 * nothing and can never drift out of step with Experience's copy). Exported so
 * FlyDown.tsx and LoadingBar.tsx -- neither of which is allowed to duplicate
 * Experience.tsx's own unexported constant -- have one place to read it from,
 * rather than three separate `Boolean(process.env...)` call sites.
 */
export const HAS_TILES_KEY = Boolean(KEY);

type TilesStatsSnapshot = {
  queued: number;
  downloading: number;
  parsing: number;
  loaded: number;
  failed: number;
  inCache: number;
};

/**
 * P11 phase 5 (docs/phases/P11-PHOTOREAL.md, LoadingBar rewrite): which leg of the load
 * LoadingBar.tsx is rendering against. A DERIVED read of the same state `settled` and
 * `rootRequests` already track -- not a separate state machine that could drift out of
 * step with them -- computed once in `publishProbe()` below.
 *
 *   boot    no `TilesRendererImpl` yet (the ref callback has not fired).
 *   auth    constructed, but `load-root-tileset` has not fired -- GoogleCloudAuthPlugin is
 *           still exchanging the API key for a session.
 *   stream  the root tileset is in and content tiles are downloading/parsing.
 *   settled the current view has caught up. LoadingBar renders nothing in this phase; it
 *           is here so a probe reading `window.__tiles.phase` mid-flight can tell a
 *           finished view from one still streaming without checking `settled` twice.
 */
export type TilesPhase = "boot" | "auth" | "stream" | "settled";

type TilesProbe = {
  constructions: number;
  rootRequests: number;
  /**
   * P11 phase 4 (docs/phases/P11-PHOTOREAL.md section 2.6 decision 11): whether the
   * current view's tile downloads have caught up, per `TilesRendererBase`'s own
   * `tiles-load-start` / `tiles-load-end` events (node_modules/3d-tiles-renderer/src/
   * core/renderer/tiles/TilesRendererBase.js) -- fired when the download/parse/node
   * queues go from idle to busy and back to idle. `false` from mount until the first
   * settle; flips back to `false` whenever the camera moves somewhere new and the
   * queues pick up again.
   */
  settled: boolean;
  /** Live snapshot of the current `TilesRendererImpl.stats`, for measurement (phase 4 step 3). */
  stats: TilesStatsSnapshot | null;
  /** The current `errorTarget`, for measurement -- what quality setting produced a given frame. */
  errorTarget: number | null;
  /** See `TilesPhase` above. */
  phase: TilesPhase;
  /**
   * `TilesRendererImpl.loadProgress` (TilesRendererBase.js's own getter): the fraction of
   * this load episode's tiles that have finished, 0 to 1. Real, not estimated -- LoadingBar
   * blends this with a time-based floor of its own rather than this file inventing one,
   * since a per-frame float belongs next to the frame loop that already produces it.
   */
  loadProgress: number;
  /**
   * Increments once per `tiles-load-start`, i.e. once per view LoadingBar has to describe.
   * LoadingBar keys its own creep-floor timer on this so a NEW stall (the camera arriving
   * somewhere new) does not inherit the previous view's elapsed time.
   */
  episode: number;
  /** `performance.now()` when the current episode began. LoadingBar derives elapsed time from it rather than this file pushing a ticking number every frame. */
  episodeStartMs: number;
  /** The store's own `stage`, so LoadingBar can name what is loading without importing the store itself (state/store.ts is out of scope for this task -- see LoadingBar.tsx's header). */
  stage: number;
};

/**
 * MODULE SCOPE, NOT COMPONENT STATE. The question these counters answer -- "did this page
 * load spend more than one billable request" -- is about the module's lifetime, not about
 * any one render, so a `useRef` that resets on remount would hide exactly the case (a
 * remount rebuilding the tileset) the counters exist to catch. `settled` and `currentTiles`
 * are here for the same reason: one `TilesRendererImpl` per page load (never rebuilt), so
 * its settle state is a property of the page load, not of any one render.
 */
let constructions = 0;
let rootRequests = 0;
let settled = false;
let currentTiles: TilesRendererImpl | null = null;
let episode = 0;
let episodeStartMs = 0;
let currentStage = 0;

const settledListeners = new Set<(settled: boolean) => void>();
/** P11 phase 5: fires on every probe publish, not only on a settled transition -- LoadingBar's progress bar needs the in-between values `settledListeners` was never meant to carry. */
const progressListeners = new Set<(probe: TilesProbe) => void>();
/** Throttles `progressListeners` to ~10 Hz (see `publishProbe()`) -- `useFrame` calls it up to 60x/s, and a progress bar has no use for more re-renders than that. */
let lastProgressNotifyMs = 0;
let lastProbe: TilesProbe | null = null;

/**
 * `TilesRendererBase.stats` is a real runtime field (see the constructor in
 * node_modules/3d-tiles-renderer/src/core/renderer/tiles/TilesRendererBase.js) that the
 * package's own hand-written `.d.ts` simply omits -- `errorTarget`, `lruCache`,
 * `downloadQueue` and `parseQueue` are all declared there, `stats` is not. This cast is
 * for that gap, not for anything this file invents.
 */
type WithStats = { stats: TilesStatsSnapshot };

function publishProbe() {
  const stats = currentTiles ? (currentTiles as unknown as WithStats).stats : undefined;
  const phase: TilesPhase = !currentTiles
    ? "boot"
    : rootRequests === 0
      ? "auth"
      : settled
        ? "settled"
        : "stream";
  const probe: TilesProbe = {
    constructions,
    rootRequests,
    settled,
    stats: stats
      ? {
          queued: stats.queued,
          downloading: stats.downloading,
          parsing: stats.parsing,
          loaded: stats.loaded,
          failed: stats.failed,
          inCache: stats.inCache,
        }
      : null,
    errorTarget: currentTiles?.errorTarget ?? null,
    phase,
    loadProgress: currentTiles?.loadProgress ?? 0,
    episode,
    episodeStartMs,
    stage: currentStage,
  };
  lastProbe = probe;
  (window as unknown as { __tiles?: TilesProbe }).__tiles = probe;

  const now = performance.now();
  if (now - lastProgressNotifyMs >= 100) {
    lastProgressNotifyMs = now;
    progressListeners.forEach((cb) => cb(probe));
  }
}

function setSettled(next: boolean) {
  if (settled === next) return;
  settled = next;
  publishProbe();
  settledListeners.forEach((cb) => cb(settled));
}

/**
 * `useSyncExternalStore`-compatible subscribe, for LoadingBar.tsx -- a plain DOM
 * component outside the Canvas, which cannot read a per-frame `useFrame` value and
 * has no store field to subscribe to (state/store.ts is out of scope for this task).
 * Consistent with this file's own imperative-probe style: a module-scope listener
 * set, the same shape `window.__tiles` itself already is.
 */
export function subscribeSettled(cb: (settled: boolean) => void): () => void {
  settledListeners.add(cb);
  return () => settledListeners.delete(cb);
}

/** Current settle state, read imperatively -- FlyDown.tsx's `useFrame` and LoadingBar's initial snapshot both want this rather than a subscription. */
export function getSettled(): boolean {
  return settled;
}

/**
 * The live TilesRendererImpl, for P13's preloader (Preload.tsx) -- the same instance
 * `window.__tilesImpl` exposes in development, but available in every build: the preloader
 * has to register and later remove synthetic cameras on the ONE renderer this file ever
 * constructs (see this file's own header on why exactly one), which is a production
 * behaviour, not a debug one. `null` before `<Tiles>`'s ref callback has fired.
 */
export function getTiles(): TilesRendererImpl | null {
  return currentTiles;
}

/**
 * `TilesRendererBase.lruCache.cachedBytes` -- like `stats` above, a real runtime field
 * (LRUCache.js's own constructor) the package's hand-written `.d.ts` omits (it declares
 * `minSize`/`maxSize`/`minBytesSize`/`maxBytesSize` but not the live counter). P13's
 * preloader needs this to decide, and later to size, its retention byte cap
 * (docs/phases/P13-PRELOAD.md section 2.2/5 step 0) -- the one number nothing in this app
 * currently reports.
 */
export function getCachedBytes(): number | null {
  if (!currentTiles) return null;
  return (currentTiles.lruCache as unknown as { cachedBytes: number }).cachedBytes;
}

/** Placeholder snapshot for `getProbe()` before `<Tiles>` has ever constructed a renderer -- `phase: "boot"` is the true state then, and every count is genuinely zero. */
const BOOT_PROBE: TilesProbe = {
  constructions: 0,
  rootRequests: 0,
  settled: false,
  stats: null,
  errorTarget: null,
  phase: "boot",
  loadProgress: 0,
  episode: 0,
  episodeStartMs: 0,
  stage: 0,
};

/** `useSyncExternalStore`-compatible subscribe for LoadingBar's progress UI -- see `progressListeners`' own comment for why this is separate from `subscribeSettled`. */
export function subscribeProgress(cb: (probe: TilesProbe) => void): () => void {
  progressListeners.add(cb);
  return () => progressListeners.delete(cb);
}

/** Current probe snapshot, read imperatively -- `useSyncExternalStore`'s required getSnapshot, and LoadingBar's own initial render before any publish has happened. */
export function getProbe(): TilesProbe {
  return lastProbe ?? BOOT_PROBE;
}

/**
 * The fixed ECEF -> site transform, as a THREE.Matrix4.
 *
 * geo/frame.ts's `ecefToSite` already IS M_ecef->site = S . R . T (its own header states
 * this): a fixed rotation (weldBasis, by way of the yup/std axis permutation), a fixed
 * uniform scale (metres to feet), and a translation (by -ECEF(WELD_ORIGIN)), applied in
 * that order to any ECEF point. Re-deriving S, R and T by hand here, in three.js's own
 * Matrix4 vocabulary, would be a second place for the same numbers to drift out of step
 * with frame.ts. Instead this evaluates `ecefToSite` at the ECEF origin and at each unit
 * basis vector: since the map is affine (linear part plus a constant translation, and
 * nothing else -- no dependence on the input beyond that), `ecefToSite([0,0,0])` recovers
 * the translation column exactly, and `ecefToSite(e_i) - ecefToSite([0,0,0])` recovers the
 * i-th column of the linear part exactly, for any orthonormal-plus-scale linear map.
 */
function ecefToSiteMatrix(): THREE.Matrix4 {
  const origin: Vec3 = [0, 0, 0];
  const ex: Vec3 = [1, 0, 0];
  const ey: Vec3 = [0, 1, 0];
  const ez: Vec3 = [0, 0, 1];
  const t = ecefToSite(origin);
  const cx = ecefToSite(ex);
  const cy = ecefToSite(ey);
  const cz = ecefToSite(ez);
  const m = new THREE.Matrix4();
  // THREE.Matrix4.set takes arguments in ROW-major order for a column-major matrix.
  m.set(
    cx[0] - t[0], cy[0] - t[0], cz[0] - t[0], t[0],
    cx[1] - t[1], cy[1] - t[1], cz[1] - t[1], t[1],
    cx[2] - t[2], cy[2] - t[2], cz[2] - t[2], t[2],
    0, 0, 0, 1,
  );
  return m;
}

export function Tiles() {
  const gl = useThree((s) => s.gl);
  const matrixRef = useRef<THREE.Matrix4 | null>(null);
  if (matrixRef.current === null) matrixRef.current = ecefToSiteMatrix();

  /**
   * Shared across every carved material: P11 phase 3 (docs/phases/P11-PHOTOREAL.md
   * section 2.6). One object, held for the component's lifetime and passed by
   * REFERENCE into every material's `onBeforeCompile` (tilesCarve.ts's
   * `applyWeldCarve`), so updating `.value` once below moves every tile material's
   * uniform at once -- the same sharing Threshold.tsx's `useShellPalette` does with
   * one `SweepUniforms` object across three cloned materials.
   */
  const carveRef = useRef<CarveUniforms | null>(null);
  if (carveRef.current === null) carveRef.current = carveUniforms();

  const stage = useStore((s) => s.stage);
  const t = useStore((s) => s.t);
  const reducedMotion = useStore((s) => s.reducedMotion);
  const cutaway = useStore((s) => s.cutaway);

  /**
   * uCarve rides thresholdOpacity()'s own `shell` ramp -- the exact number
   * WeldExterior.tsx's shell opacity is driven from (Experience.tsx passes
   * `opacity={shell}` straight through) -- rather than a second copy of that ramp.
   * `shell` is 1 (opaque, everything before the transit) down to 0 (dissolved,
   * everything from t = SHELL_GONE on): `1 - shell` is 0 while the parametric shell
   * is still fully covering Weld and 1 once it has taken over, which is precisely
   * when Google's own Weld should be gone. Reading `stages.ts`'s export directly
   * -- rather than recomputing the ramp by hand -- is what keeps this unable to
   * drift out of step with the shell it has to agree with; nothing here duplicates
   * that formula, since importing it costs nothing.
   */
  useFrame(() => {
    const { shell } = thresholdOpacity(stage, t, reducedMotion);
    // FULLY CARVED THE MOMENT A CUTAWAY IS PICKED, ahead of the ramp. cutaway.ts's
    // modelMode() is the shared predicate (its docblock has the argument): a cut parametric
    // Weld standing inside an uncut photogrammetric one is the double-building bug this
    // phase exists to remove, just with a hole in it. Outside model mode nothing changes --
    // `1 - shell` is still the threshold's own ramp, and still the same number
    // WeldExterior's dissolve is driven from.
    carveRef.current!.uCarve.value = modelMode(stage, cutaway) ? 1 : 1 - shell;

    // P11 phase 5: the store's own `stage`, read here (this component already subscribes
    // to it above) rather than LoadingBar importing the store itself -- see TilesProbe's
    // own field comment for why.
    currentStage = stage;

    // Live stats snapshot for measurement (phase 4 step 3) and for anything reading
    // `window.__tiles.stats` off a running session -- cheap (a handful of number copies)
    // against the same per-frame budget the uCarve write above already spends.
    publishProbe();
  });

  /**
   * Fires once per genuinely new TilesRendererImpl -- see useApplyRefs in
   * 3d-tiles-renderer/r3f: the ref callback runs in an effect keyed on the instance
   * itself, so it is called exactly once per construction, not once per render.
   *
   * The fixed transform is applied here, imperatively, rather than through the
   * component's `group` prop: this is the one place that holds a real THREE.Group,
   * so there is no ambiguity about how a `matrix` prop would be reconciled onto a
   * `<primitive>`. `matrixAutoUpdate = false` because this matrix never changes --
   * ECEF, feet-per-metre and weldBasis are all constants -- and `updateMatrixWorld(true)`
   * forces the one computation the group needs, since matrixAutoUpdate = false also means
   * three's own per-frame traversal will not recompute it later.
   */
  const onTiles = useCallback((tiles: TilesRendererImpl | null) => {
    if (!tiles) return;
    constructions += 1;
    currentTiles = tiles;
    /**
     * The renderer itself, for measurement only, and NOT in a production bundle.
     *
     * `window.__tiles` above publishes numbers this file chooses to expose; the datum
     * measurement (scripts/measure-align.mjs, the evidence behind geo/frame.ts's
     * WELD_GRADE_H_FT) needs the tile GEOMETRY -- every loaded mesh's vertices in world
     * space -- and there is no cheap summary of that to publish per frame. R3F keeps its
     * scene graph off the DOM (the canvas carries no `__r3f`, and the React fiber tree
     * holds no Object3D stateNodes -- both checked), so a handle here is the only way in.
     *
     * Gated on NODE_ENV so the production build's global surface is unchanged, and set
     * once per construction rather than per frame.
     */
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __tilesImpl?: unknown }).__tilesImpl = tiles;
    }
    publishProbe();

    tiles.group.matrix.copy(matrixRef.current!);
    tiles.group.matrixAutoUpdate = false;
    tiles.group.updateMatrixWorld(true);

    const onRootTileset = () => {
      /**
       * P11 phase 4 step 3 (docs/phases/P11-PHOTOREAL.md decision 11, "quality-first, gate
       * on settled"), tuned and measured against a real session on this machine -- the
       * table is in the phase 4 section of that document.
       *
       * APPLIED HERE, ON `load-root-tileset`, NOT IN `onTiles` ABOVE -- MEASURED, NOT
       * ASSUMED. The obvious place to set these is right after construction, and that was
       * tried first: a property-setter trap on `tiles.errorTarget` (console-logged, then
       * removed) showed `GoogleCloudAuthPlugin.init()` -- which sets `errorTarget = 20` --
       * firing AFTER this ref callback's assignment, not before, even though
       * `TilesPlugin`'s `registerPlugin` runs in a `useLayoutEffect` and this ref callback
       * fires from `useApplyRefs`'s plain `useEffect`. Reading the source predicted layout
       * effects win; the running page did the opposite, because `TilesPlugin` mounts its
       * plugin across TWO effects (construct in one `useLayoutEffect`, `setInstance`;
       * register in a second, gated on `[instance]`) and that second one is a genuinely
       * separate, nested commit that this component's passive effect does not wait for.
       * `load-root-tileset` is provably after both: `loadRootTileset()` fetches through
       * `invokeOnePlugin(plugin => plugin.fetchData && ...)`, and the fetch that produced
       * this event authenticates as a Google Maps session (real photorealistic content, not
       * a 401), which is only possible once `GoogleCloudAuthPlugin` is registered. So this
       * event is the first point in the instance's life that is guaranteed to run after
       * `init()` -- and it fires once, before any content tile is ever selected (`update()`
       * returns before traversal while `root` is null), so nothing is requested under the
       * stale value in between.
       *
       * `errorTarget` 20 -> 8: the plugin's own comment calls 20 "more efficient for the
       * photorealistic tiles" -- tuned for interactive Maps-style navigation, where a frame
       * that never catches up is worse than a slightly coarser one. That tradeoff runs
       * backwards here now that FlyDown pauses on `settled` (this file's own probe) instead
       * of flying through whatever loaded: a frame nobody is forced to look at mid-load can
       * afford to be higher quality once it finally is shown. Measured baseline at 20
       * against the tuned session at 8, six stages, one session each (real key, real
       * network, this machine): baseline never settled stage 3-5 within 30 s (184-213 tiles
       * still parsing); the table in the phase 4 section has both sessions' numbers.
       *
       * `parseQueue.maxJobs` 5 -> 16: the baseline session's own `stats` is the measurement
       * -- at stage 3 every one of 184 pending tiles had ALREADY finished downloading
       * (`stats.downloading === 0`, `stats.queued === 0`) and sat waiting on 5 parse slots.
       * Parsing is CPU-bound glTF/Draco decode, not network, so this is a queue-depth
       * problem with a queue-depth fix, not a bandwidth one -- `downloadQueue.maxJobs`
       * stayed at its default 25 because the baseline never showed a download backlog.
       *
       * `lruCache.maxBytesSize` 0.4 GB -> 1 GB (P11) -> 1.5 GB (P13, this task; `minBytesSize`
       * kept at the same ratio, 0.75 -> 1.2 GB): the P11 baseline's `inCache` dropped from 693
       * at stage 4 to 610 at stage 5 while `loaded` only rose -- eviction, not stage
       * unmounting, since Tiles itself never unmounts. 1 GB was sized against THAT baseline's
       * per-stage footprint, before P13's preloader existed to hold the WHOLE descent's tiles
       * resident at once. Measured against the preloader instead (this task): a full descent's
       * worth of tiles settles at ~1.07-2.7 GB cached depending on the cap itself (a smaller
       * cap that evicts more also traverses less deeply before a batch goes idle, so total
       * cached bytes is not independent of the cap). At the old 1 GB cap -- already below the
       * ~1.07 GB the descent settled at, so it was evicting from the moment it filled, not
       * just under some later edge case -- a stage jump straight after a "complete" preload
       * queued 538 fresh downloads (measured, this session), because the content jumping
       * there needed had already been evicted to make room for whatever loaded after it.
       *
       * 1.5 GB, NOT A MUCH LARGER CAP -- MEASURED AGAINST BOTH FAILURE MODES, NOT JUST THE
       * FIRST ONE. A cap sized to hold the whole descent with near-zero eviction pressure
       * (3 GB, tried first) does cut the re-fetch (538 tiles -> 30 on the same stage jump),
       * but the preload itself went from this codebase's own 228-249s baseline
       * (docs/phases/P13-PRELOAD.md, `preload.spec.ts`'s own deadline comment) to 306-309s at
       * 1.5 GB and further still at 3 GB -- comfortably fitting more into the cache trades
       * against how long the preloader spends filling it, since nothing here bounds the
       * traversal's own depth except cache pressure. 1.5 GB is the smaller of the two sizes
       * actually measured against the specific eviction this task found (538 -> 112 queued on
       * the same stage-2 jump), chosen to keep the preload itself inside a reasonable budget
       * rather than trading one bad wait for a longer one. `preload.spec.ts`'s own deadline
       * comment carries the current measured preload time. The item ceilings
       * (`minSize`/`maxSize`, 6,000/8,000) are untouched: nothing this app does gets within an
       * order of magnitude of them.
       */
      tiles.errorTarget = 8;
      tiles.parseQueue.maxJobs = 16;
      tiles.lruCache.maxBytesSize = 1.5 * 2 ** 30;
      tiles.lruCache.minBytesSize = 1.2 * 2 ** 30;

      rootRequests += 1;
      publishProbe();
    };
    tiles.addEventListener("load-root-tileset", onRootTileset);

    /**
     * P11 phase 4 step 2 (docs/phases/P11-PHOTOREAL.md decision 11): the settled signal
     * FlyDown.tsx pauses on and LoadingBar.tsx renders against.
     *
     * `tiles-load-start` / `tiles-load-end` are `TilesRendererBase`'s own events (see
     * node_modules/3d-tiles-renderer/src/core/renderer/tiles/TilesRendererBase.js's
     * `update()`): `isLoading` flips true the moment the first tile content is queued
     * (`requestTileContents`) and flips back once `downloadQueue.running ||
     * parseQueue.running || processNodeQueue.running` all go false. That is exactly "this
     * view's downloads have caught up" -- not merely "the root tileset JSON arrived" -- so
     * it is the real signal, not a guess (the diagnosis in section 0.3 is a resolution
     * hole, not a missing tileset, and only tile CONTENT settling closes it).
     */
    const onLoadStart = () => {
      // P11 phase 5: a new load episode, for LoadingBar's creep-floor timer -- see
      // TilesProbe's own field comments. Set BEFORE `setSettled`, which only calls
      // `publishProbe()` when `settled` actually changes (it does not on the very first
      // call: `settled` starts `false`, so `setSettled(false)` here is a no-op) -- the
      // explicit `publishProbe()` below is what guarantees `episode`/`episodeStartMs`
      // reach `window.__tiles` on every episode, including the first.
      episode += 1;
      episodeStartMs = performance.now();
      setSettled(false);
      publishProbe();
    };
    const onLoadEnd = () => setSettled(true);
    tiles.addEventListener("tiles-load-start", onLoadStart);
    tiles.addEventListener("tiles-load-end", onLoadEnd);

    /**
     * Weld carve, P11 phase 3 (docs/phases/P11-PHOTOREAL.md section 2.6). Fired once
     * per tile's content load -- see 3d-tiles-renderer's TilesRendererBase.js, whose
     * `load-model` docblock gives `{ scene, tile, url }`, `scene` being the
     * engine-specific (here, three.js) object built for that tile's content -- so
     * every material any tile ever contributes gets the carve, not just whatever is
     * loaded at construction time.
     *
     * `carveRef.current` is shared by every material across every tile (see its own
     * comment above): each material's compiled shader gets its OWN varying and its
     * OWN copy of the discard logic (that is what `onBeforeCompile` does, once per
     * material), but they all read the same `uCarve` object, so the single update in
     * the `useFrame` above moves every carved material at once.
     *
     * Any prior `onBeforeCompile` a material already carries is chained rather than
     * overwritten -- matching 3d-tiles-renderer's own `wrapFadeMaterial` convention
     * (node_modules/3d-tiles-renderer/src/three/plugins/fade/wrapFadeMaterial.js) for
     * layering a second shader customisation onto a material that may already have
     * one, even though nothing in this app's own plugin set currently sets one on a
     * fresh glTF material.
     */
    const onLoadModel = (e: { scene: THREE.Object3D }) => {
      const seen = new Set<THREE.Material>();
      e.scene.traverse((obj) => {
        if (!(obj as THREE.Mesh).isMesh) return;
        const mesh = obj as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          const prevOnBeforeCompile = m.onBeforeCompile;
          m.onBeforeCompile = (shader, renderer) => {
            prevOnBeforeCompile?.call(m, shader, renderer);
            applyWeldCarve(shader, carveRef.current!);
          };
          m.needsUpdate = true;

          /**
           * P13 step 6 (docs/phases/P13-PRELOAD.md): GPU texture upload, paid here rather
           * than on this material's first real draw. `gl.initTexture` is three's own
           * documented preload path ("Useful for preloading a texture rather than waiting
           * until first render, which can cause noticeable lags due to decode and GPU
           * upload overhead" -- WebGLRenderer.js's own comment on the method).
           *
           * GENERIC OVER MATERIAL TYPE, NOT A HAND-ENUMERATED SLOT LIST. glTF content
           * loaded through different tile formats can carry different material classes
           * (MeshStandardMaterial is typical, but nothing here assumes it); a fixed list of
           * slot names (`map`, `normalMap`, `roughnessMap`, ...) would silently miss
           * whatever slot a future material type adds. Every texture-valued OWN property is
           * exactly what three.js's own material disposal code (Material.dispose) also
           * walks generically for the same reason -- there is no narrower correct set.
           */
          for (const val of Object.values(m as unknown as Record<string, unknown>)) {
            if (val instanceof THREE.Texture) gl.initTexture(val);
          }
        }
      });
    };
    tiles.addEventListener("load-model", onLoadModel);
  }, []);

  /**
   * MEMOIZED, NOT AN INLINE LITERAL -- measured, not stylistic.
   *
   * <TilesPlugin>'s own effect depends on `useObjectDep(args)` (3d-tiles-renderer/r3f's
   * utilities/useObjectDep.js), which does a ONE-LEVEL-DEEP shallow compare: for an array
   * dep it compares `a[0] !== b[0]` by reference. An inline `args={[{ apiToken, ... }]}`
   * allocates a new object at index 0 on every render, so that comparison fails every
   * time even though the values inside never change -- which tears the plugin down
   * (`dispose()`, removing its tile-visibility listener) and reconstructs it
   * (`init()`, a fresh `GoogleCloudAuth` with `sessionToken` reset to null) on every
   * re-render of this component. Measured against a live key: `<Tiles>` re-renders on
   * every stage/`t` store update, and mid-flight tile fetches raced against that
   * teardown two ways at once -- `Cannot read properties of undefined (reading
   * 'loadingState')` / `Cannot read properties of null (reading 'removeEventListener')`
   * from the torn-down plugin, and every in-flight .glb content fetch silently
   * downgraded to `res.json()` because the fresh auth object's `sessionToken` was null
   * again, producing `SyntaxError: ... "glTF ..." is not valid JSON` on real binary
   * glTF content. A `useMemo` with an empty dep array (`KEY` is a module-level
   * constant) keeps the args array's index 0 the same object across every render, so
   * `useObjectDep` reports no change and the plugin is constructed exactly once.
   */
  const authArgs = useMemo(() => [{ apiToken: KEY, autoRefreshToken: true }], []);

  return (
    <TilesRendererR3F ref={onTiles}>
      <TilesPlugin plugin={GoogleCloudAuthPlugin} args={authArgs} />
    </TilesRendererR3F>
  );
}
