"use client";

import { useCallback, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { TilesRenderer as TilesRendererR3F, TilesPlugin } from "3d-tiles-renderer/r3f";
import { GoogleCloudAuthPlugin } from "3d-tiles-renderer/plugins";
import type { TilesRenderer as TilesRendererImpl } from "3d-tiles-renderer/three";
import { ecefToSite, type Vec3 } from "./geo/frame";
import { useStore } from "@/state/store";
import { thresholdOpacity } from "./stages";
import { applyWeldCarve, carveUniforms, type CarveUniforms } from "./tilesCarve";

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

const settledListeners = new Set<(settled: boolean) => void>();

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
  (window as unknown as { __tiles?: TilesProbe }).__tiles = {
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
  };
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
    carveRef.current!.uCarve.value = 1 - shell;

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
       * `lruCache.maxBytesSize` 0.4 GB -> 1 GB (`minBytesSize` 0.3 -> 0.75 GB, same ratio):
       * the baseline's `inCache` dropped from 693 at stage 4 to 610 at stage 5 while
       * `loaded` only rose -- eviction, not stage unmounting, since Tiles itself never
       * unmounts. ~650-700 photorealistic mesh tiles at the default 0.4 GB cap is right
       * where the byte ceiling (not the 8,000-item ceiling, never close) starts trading a
       * tile this session already paid to download for one it has not, on a page about to
       * need both again if the viewer scrubs back. The item ceilings (`minSize`/`maxSize`,
       * 6,000/8,000) are untouched: nothing this app does gets within an order of magnitude
       * of them.
       */
      tiles.errorTarget = 8;
      tiles.parseQueue.maxJobs = 16;
      tiles.lruCache.maxBytesSize = 1 * 2 ** 30;
      tiles.lruCache.minBytesSize = 0.75 * 2 ** 30;

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
    const onLoadStart = () => setSettled(false);
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
