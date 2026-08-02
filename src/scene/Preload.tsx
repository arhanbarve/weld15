"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useStore } from "@/state/store";
import { preloadPoses, TOTAL_BATCHES, type PreloadPose } from "./preloadPlan";
import { HAS_TILES_KEY, getTiles, getProbe, getCachedBytes } from "./Tiles";
import { nearFar } from "./altitude";

/**
 * Registers a synthetic camera at every sampled descent pose (preloadPlan.ts), batched
 * high-altitude first, and waits for each batch's tiles to settle before registering the
 * next -- see docs/phases/P13-PRELOAD.md sections 2.1-2.4 for why this works at all
 * (TilesRenderer takes the UNION of every registered camera's selection, and marks that
 * union used every frame, which is what makes a tile eviction-proof for as long as its
 * camera stays registered) and why polling stats rather than trusting
 * tiles-load-start/tiles-load-end is required (a batch whose tiles are already resident
 * fires no load-start event at all, so an event-based wait would hang forever).
 *
 * MOUNTED UNCONDITIONALLY INSIDE <Tiles>'S OWN SIBLING SLOT, but a no-op whenever
 * `!HAS_TILES_KEY` or `preloadDisabled()` -- both checked once, at the top of the frame
 * loop, so the keyless fallback path and the `?preload=0` escape hatch (docs/phases/
 * P13-PRELOAD.md section 1 decision 4) cost nothing beyond the check itself.
 *
 * PUBLISHES THE SAME SHAPE Tiles.tsx DOES: a module-scope probe plus a listener set,
 * because Preloader.tsx is a plain DOM component outside the Canvas (same reason
 * LoadingBar.tsx cannot use a per-frame useFrame value or subscribe to a store field --
 * see that file's own header).
 */

export type PreloadPhase = "boot" | "auth" | "loading" | "finalizing" | "done";

export type PreloadProbe = {
  phase: PreloadPhase;
  /** 0-indexed batch currently loading, or TOTAL_BATCHES once every batch has settled. */
  batch: number;
  totalBatches: number;
  /** (batches fully settled + current batch's own load fraction) / totalBatches. Monotone across batch boundaries; real, not a time-based floor. */
  progress: number;
  cachedBytes: number | null;
  tilesLoaded: number;
  done: boolean;
};

const BOOT_PROBE: PreloadProbe = {
  phase: "boot",
  batch: 0,
  totalBatches: TOTAL_BATCHES,
  progress: 0,
  cachedBytes: null,
  tilesLoaded: 0,
  done: false,
};

/** `!HAS_TILES_KEY` short-circuits to `done` immediately -- see BOOT_PROBE's own field, published once below. */
const DISABLED_PROBE: PreloadProbe = { ...BOOT_PROBE, phase: "done", batch: TOTAL_BATCHES, progress: 1, done: true };

let lastProbe: PreloadProbe = HAS_TILES_KEY ? BOOT_PROBE : DISABLED_PROBE;
const listeners = new Set<(p: PreloadProbe) => void>();
let lastNotifyMs = 0;

function publish(p: PreloadProbe) {
  lastProbe = p;
  (window as unknown as { __preload?: PreloadProbe }).__preload = p;
  const now = performance.now();
  if (now - lastNotifyMs >= 100 || p.done) {
    lastNotifyMs = now;
    listeners.forEach((cb) => cb(p));
  }
}

export function subscribePreload(cb: (p: PreloadProbe) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPreloadProbe(): PreloadProbe {
  return lastProbe;
}

/**
 * `?preload=0` in the address bar. Checked once per mount, not on every render -- there is
 * no live control that changes this mid-session, only a page load either carrying the
 * param or not. UrlSync.tsx's own `write()` only ever sets/deletes SNAPSHOT_PARAM, so this
 * param survives every replaceState it makes.
 */
export function preloadDisabled(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("preload") === "0";
}

/** Consecutive idle frames (queues empty) required before a batch is considered settled. */
const IDLE_FRAMES_REQUIRED = 8;

/**
 * Ceiling on how long a single batch is allowed to hold the flight before moving on anyway
 * -- the same escape-hatch shape FlyDown.tsx's MAX_STALL_SECONDS already establishes for
 * this codebase, sized for a batch of four poses rather than one stage.
 *
 * MEASURED, NOT GUESSED -- and the first value here (20 s) was wrong, caught by
 * scripts/measure-preload.mjs's own step 0 run rather than assumed correct: every one of 7
 * batch transitions landed at 19.9-20.9 s, an unmistakable signature of the TIMEOUT firing
 * every single time rather than the idle-frame condition ever actually being met. The
 * run's own final stats confirmed it directly -- `parsing: 2881` still in flight the
 * instant `done` fired -- so the escape hatch had become the only path, defeating the
 * whole point of the phase: a preload that calls itself finished while 2,881 tiles are
 * still mid-parse is not a preload.
 *
 * WHY 20 s WAS TOO SHORT: cameras ACCUMULATE across batches (this file never clears
 * `j.cams` until finalizing), so batch N's settle condition is the union of every camera
 * registered so far, not just batch N's own four poses -- batch 6 has to satisfy 28
 * cameras at once. Parsing is CPU-bound and single-threaded (Tiles.tsx's own
 * `load-root-tileset` comment), so a growing union takes genuinely longer to drain per
 * batch, not a fixed amount.
 *
 * 90 s is a first correction, sized to give real settlement room rather than to hit a
 * particular total wall-clock figure -- re-measure after this change and adjust again if
 * transitions still cluster at the ceiling rather than spreading out below it.
 */
const BATCH_TIMEOUT_MS = 90_000;

/** docs/phases/P13-PRELOAD.md section 4's copy table, one line per batch. */
const BATCH_COPY = [
  "Downloading Earth from orbit",
  "Resolving the eastern seaboard",
  "Bringing Boston into focus",
  "Streaming Cambridge rooftops",
  "Reading Harvard Yard, tree by tree",
  "Finding Weld Hall's brick",
  "Crossing the threshold",
] as const;

export function batchCopy(batch: number): string {
  return BATCH_COPY[Math.min(batch, BATCH_COPY.length - 1)] ?? BATCH_COPY[0]!;
}

type Job = {
  phase: PreloadPhase;
  batch: number;
  cams: THREE.PerspectiveCamera[];
  registeredBatches: Set<number>;
  idleFrames: number;
  batchStartMs: number;
};

export function Preload() {
  const params = useStore((s) => s.params);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const mainCamera = useThree((s) => s.camera);

  const poses = useMemo(() => preloadPoses(params), [params]);
  const disabled = useMemo(() => !HAS_TILES_KEY || preloadDisabled(), []);

  const job = useRef<Job>({ phase: "boot", batch: 0, cams: [], registeredBatches: new Set(), idleFrames: 0, batchStartMs: 0 });

  useEffect(() => {
    if (disabled) publish(DISABLED_PROBE);
  }, [disabled]);

  useFrame(() => {
    if (disabled || job.current.phase === "done") return;

    const j = job.current;
    const tiles = getTiles();
    const probe = getProbe();

    if (j.phase === "boot" || j.phase === "auth") {
      // Mirrors Tiles.tsx's own phase derivation (publishProbe): nothing to register until
      // a renderer exists and the root tileset has actually arrived -- registering a camera
      // before that is harmless but pointless, since update() has nothing to select yet.
      j.phase = tiles === null ? "boot" : probe.rootRequests >= 1 ? "loading" : "auth";
      publish({ ...lastProbe, phase: j.phase });
      if (j.phase !== "loading") return;
    }

    if (j.phase === "loading") {
      if (!tiles) return;

      // Register this batch's cameras the first frame we enter it -- once per batch, not
      // once per frame: `registeredBatches` is the explicit record of which batches have
      // already had their cameras built, since `j.cams` itself only ever accumulates.
      const batchPoses: PreloadPose[] = poses.filter((p) => p.batch === j.batch);
      if (!j.registeredBatches.has(j.batch) && batchPoses.length > 0) {
        j.registeredBatches.add(j.batch);
        for (const p of batchPoses) {
          const cam = new THREE.PerspectiveCamera(p.pose.fov, size.width / Math.max(1, size.height), 1, 1);
          const { near, far } = nearFar(p.pose.position[1]);
          cam.near = near;
          cam.far = far;
          cam.position.set(...p.pose.position);
          cam.lookAt(new THREE.Vector3(...p.pose.target));
          cam.updateMatrixWorld(true);
          cam.updateProjectionMatrix();
          tiles.setCamera(cam);
          tiles.setResolutionFromRenderer(cam, gl);
          j.cams.push(cam);
        }
        j.idleFrames = 0;
        j.batchStartMs = performance.now();
      }

      const { queued, downloading, parsing, loaded } = probe.stats ?? {
        queued: 0,
        downloading: 0,
        parsing: 0,
        loaded: 0,
      };
      const idle = queued === 0 && downloading === 0 && parsing === 0;
      j.idleFrames = idle ? j.idleFrames + 1 : 0;
      const timedOut = performance.now() - j.batchStartMs > BATCH_TIMEOUT_MS;

      const total = loaded + queued + downloading + parsing;
      const batchFrac = total > 0 ? loaded / total : 0;
      publish({
        phase: "loading",
        batch: j.batch,
        totalBatches: TOTAL_BATCHES,
        progress: Math.min(1, (j.batch + batchFrac) / TOTAL_BATCHES),
        cachedBytes: getCachedBytes(),
        tilesLoaded: loaded,
        done: false,
      });

      if (j.idleFrames >= IDLE_FRAMES_REQUIRED || timedOut) {
        j.batch += 1;
        j.idleFrames = 0;
        if (j.batch >= TOTAL_BATCHES) j.phase = "finalizing";
      }
      return;
    }

    if (j.phase === "finalizing") {
      // Measured, not assumed (docs/phases/P13-PRELOAD.md section 5 step 0): the retention
      // cap this file sets is a function of what this run actually cached, not a guess made
      // ahead of time.
      const bytes = getCachedBytes() ?? 0;
      if (tiles) {
        const cap = Math.max(bytes * 1.25, 1 * 2 ** 30);
        tiles.lruCache.minBytesSize = cap;
        tiles.lruCache.maxBytesSize = cap;
        tiles.lruCache.minSize = 12_000;
        tiles.lruCache.maxSize = 16_000;

        for (const cam of j.cams) tiles.deleteCamera(cam);
        j.cams = [];

        // Shader compile + GPU upload for the whole retained set, paid here rather than on
        // the first real frame that draws it.
        gl.compile(scene, mainCamera);
      }

      j.phase = "done";
      publish({
        phase: "done",
        batch: TOTAL_BATCHES,
        totalBatches: TOTAL_BATCHES,
        progress: 1,
        cachedBytes: bytes,
        tilesLoaded: probe.stats?.loaded ?? 0,
        done: true,
      });
    }
  });

  return null;
}
