/**
 * The imagery manifest, and how to load a texture without suspending the canvas.
 *
 * READ CanvasHost.tsx's HEADER BEFORE TOUCHING THE LOADER. R3F wraps <Canvas>'s children in a
 * Suspense whose fallback is <Block>, which sets a promise that never resolves and which
 * CanvasImpl then throws. So a scene child that suspends does not suspend inside the canvas: it
 * suspends the CANVAS, up to the nearest boundary outside it, which in this app is the "LOADING
 * WELD 15" screen. Measured on a served production build during P8, with one chunk delayed
 * 2,500 ms: the page showed real UI at +461 ms, reverted to the loading screen -- HUD, canvas and
 * all -- at +763 ms, and came back at +3,189 ms.
 *
 * P9b is exactly the thing that warning was written for: five textures, the largest 640 KB.
 *
 * SO THERE IS NO useLoader, NO useTexture, AND NO useGLTF ANYWHERE IN THIS PHASE. The loader
 * below is imperative -- a TextureLoader in an effect, writing to state when it arrives -- and a
 * quad whose texture has not arrived renders NOTHING AT ALL. Not a placeholder, not a fallback
 * colour, nothing. altitude.ts's band table is what makes that safe: at every altitude in the
 * descent at least two layers overlap, so there is always something already loaded underneath.
 */

import * as THREE from "three";
import manifestJson from "@/data/imagery-manifest.json";

/** One level's entry, as scripts/fetch-imagery.mjs emits it into src/data. */
export type ImageryLevel = {
  px: [number, number];
  /** Present and true on L0 only: the equirectangular whole-Earth plate, which has no site extent. */
  global?: boolean;
  /**
   * The level's footprint IN SITE FEET.
   *
   * THE QUAD GEOMETRY COMES FROM HERE and is not hard-coded in Ground.tsx. That is the point of
   * putting it in the manifest: the extent the imagery was resampled to and the extent the mesh
   * is built at are then the same number rather than two copies of it, so a change to the
   * pyramid cannot silently disagree with the geometry it is mapped onto.
   */
  extentFt?: { minX: number; maxX: number; minY: number; maxY: number };
  ftPerTexel?: number;
  files: Record<string, { file: string; bytes: number }>;
  provenance: {
    dataset: string;
    flown?: string;
    licence: string;
    attribution: string;
    nativeResolutionFt?: number;
    [k: string]: unknown;
  };
};

export type Manifest = {
  generatedBy: string;
  origin: { lat: number; lon: number };
  frame: string;
  levels: Record<string, ImageryLevel>;
};

export const manifest = manifestJson as unknown as Manifest;

/** The ground quads, outermost first, which is also the order they must be drawn in. */
export const GROUND_LEVELS = ["L1", "L2", "L3", "L4"] as const;
export type GroundLevelId = (typeof GROUND_LEVELS)[number];

/**
 * The URLs to try for a level, best first.
 *
 * A LIST RATHER THAN A CAPABILITY TEST, AND THE FIRST VERSION GOT THIS WRONG. It asked
 * `canvas.toDataURL("image/avif")` and served WebP if that did not come back as AVIF. That tests
 * whether the browser can ENCODE AVIF, which Chrome cannot -- it returns a PNG data URL -- while
 * Chrome decodes AVIF perfectly well. So every Chrome user was served the WebP plates: 2.98 MB
 * instead of 1.76 MB, for a capability they had. A false negative, and an invisible one, because
 * the wrong answer still works.
 *
 * There is no reliable synchronous test for DECODE support, so this stops guessing. The loader
 * tries AVIF, and if the decode fails it tries WebP -- which is what a <picture> element does, and
 * it is correct by construction rather than by a lookup table of browser behaviour. The cost of
 * being wrong is one failed request on a browser without AVIF, against 1.2 MB saved on every
 * browser with it.
 *
 * Both formats still ship, per P9.md section 8's second question answered as proposed: a browser
 * without AVIF must not get a blank Earth, and finding that out from a bug report is not worth the
 * bytes saved by dropping the fallback.
 */
export function levelUrls(id: string): string[] {
  const level = manifest.levels[id];
  if (!level) return [];
  return (["avif", "webp"] as const)
    .map((fmt) => level.files[fmt]?.file)
    .filter((f): f is string => typeof f === "string")
    .map((f) => `/imagery/${f}`);
}

/** The preferred URL for a level, or null. Kept for callers that only want one. */
export function levelUrl(id: string): string | null {
  return levelUrls(id)[0] ?? null;
}

/**
 * A level's extent as the numbers a PlaneGeometry needs: width, height, and centre.
 *
 * Centre rather than "at the origin", because nothing guarantees a level is centred on Weld --
 * L1 is 2048 x 1524, so its footprint is wider than it is tall and a future asymmetric crop
 * would break a mesh that assumed symmetry.
 */
export function quadOf(id: GroundLevelId): {
  width: number;
  height: number;
  cx: number;
  cy: number;
} | null {
  const e = manifest.levels[id]?.extentFt;
  if (!e) return null;
  return {
    width: e.maxX - e.minX,
    height: e.maxY - e.minY,
    cx: (e.minX + e.maxX) / 2,
    cy: (e.minY + e.maxY) / 2,
  };
}

/**
 * Load a texture imperatively, and hand back a disposer.
 *
 * Deliberately NOT a hook, so it can be called from an effect in whatever component needs it
 * without that component becoming a suspense boundary. `live` is the caller's cancellation: a
 * texture that arrives after unmount is disposed rather than written to a dead component.
 *
 * colorSpace is SRGBColorSpace because these are photographs. Left at the default they would be
 * treated as linear data and every ground quad would come out visibly too dark -- the classic
 * symptom, and the one that gets mistaken for a tint bug.
 */
export function loadTexture(
  urls: string | string[],
  onReady: (t: THREE.Texture) => void,
): () => void {
  const queue = typeof urls === "string" ? [urls] : [...urls];
  let live = true;
  let texture: THREE.Texture | null = null;

  const attempt = (): void => {
    const url = queue.shift();
    if (url === undefined || !live) return;
    new THREE.TextureLoader().load(
      url,
      (t) => {
      texture = t;
      if (!live) {
        t.dispose();
        return;
      }
      t.colorSpace = THREE.SRGBColorSpace;
      // The quads are viewed at a grazing angle for most of the descent, which is exactly where
      // anisotropic filtering earns its cost. 4 rather than the maximum: measured on this
      // machine the renderer reports 16, and going past 4 on a texture already being
      // mip-filtered is not visible at these angles.
      t.anisotropy = 4;
      // CLAMP, not the default repeat. A repeating ground quad tiles Harvard Yard across
      // Massachusetts, which is both wrong and hilarious. It matters because the horizon fade
      // samples slightly outside the quad at the very edge.
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        onReady(t);
      },
      undefined,
      () => {
        // FALL THROUGH TO THE NEXT FORMAT, which is what makes levelUrls() a list rather than a
        // choice. A browser that cannot decode AVIF fails here and gets the WebP plate on the next
        // attempt; a browser that can never reaches the second entry.
        //
        // When the queue is empty this returns silently, on purpose: a level that fails entirely
        // leaves its quad unrendered, and altitude.ts's band overlaps mean something else is
        // already covering that altitude. journey.spec.ts asserts no console errors across the
        // descent, so throwing here would fail a gate for a condition the design handles.
        if (live) attempt();
      },
    );
  };

  attempt();
  return () => {
    live = false;
    texture?.dispose();
  };
}
