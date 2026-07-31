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
 * Which encoding this browser gets.
 *
 * Decided ONCE, at module load, rather than per texture. It is a synchronous canvas capability
 * test rather than an async decode probe, because the answer is needed before the first texture
 * request and an async test would either delay every load or race the first one.
 *
 * AVIF is supported by every browser this desktop-only app targets (DesktopOnly.tsx gates it),
 * and the WebP plates are 2.6x the bytes. They ship anyway for one release, per P9.md section
 * 8's second question answered as proposed -- a browser without AVIF must not get a blank Earth,
 * and finding that out from a bug report rather than from a fallback is not worth 3.4 MB.
 */
function pickFormat(): "avif" | "webp" {
  if (typeof document === "undefined") return "avif";
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    if (c.toDataURL("image/avif").startsWith("data:image/avif")) return "avif";
  } catch {
    // A browser that throws on an unknown mime type is a browser without AVIF.
  }
  return "webp";
}

let format: "avif" | "webp" | null = null;

export function imageryFormat(): "avif" | "webp" {
  if (format === null) format = pickFormat();
  return format;
}

/** The URL for a level in the format this browser can decode. */
export function levelUrl(id: string): string | null {
  const level = manifest.levels[id];
  if (!level) return null;
  const entry = level.files[imageryFormat()] ?? level.files.avif ?? level.files.webp;
  return entry ? `/imagery/${entry.file}` : null;
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
  url: string,
  onReady: (t: THREE.Texture) => void,
): () => void {
  let live = true;
  let texture: THREE.Texture | null = null;
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
      // Swallowed on purpose: a level that fails to load leaves its quad unrendered, and the
      // band overlaps mean something else is already covering that altitude. journey.spec.ts
      // asserts no console errors across the descent, so a throw here would fail a gate for a
      // condition the design already handles.
    },
  );
  return () => {
    live = false;
    texture?.dispose();
  };
}
