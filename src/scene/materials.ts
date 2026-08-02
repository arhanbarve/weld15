/**
 * The material palette for both stages.
 *
 * Three things this module exists to enforce.
 *
 * Singletons. A `<meshStandardMaterial>` written inline in a component is rebuilt
 * on every re-render, and each one compiles a shader program and holds GPU memory
 * until the GC gets round to it. That is the classic R3F leak. materials() hands
 * out the same eight objects for the life of the process; disposeMaterials() is
 * the only thing that drops them.
 *
 * No texture files. The oak grain is drawn with 2D canvas calls the first time it
 * is asked for. That keeps binary assets out of the bundle, but it also means the
 * module has to survive `import` under vitest in Node, where there is no
 * `document`. The canvas path is guarded: headless, oakNormalMap() returns an
 * imageless Texture and the oak material simply carries no normal map.
 *
 * Colours come from design-system/MASTER.md, which app/globals.css mirrors as CSS
 * custom properties. The test cross-checks the two files, so a hex edited in one
 * place and not the other fails instead of drifting.
 *
 * Two colours the design system does not have. MASTER.md's tables stop at the
 * interior finishes, so there is no --brick and no --slate, but weld.json records
 * the building as "brick with light sandstone belts" under a "slate" roof and
 * materials() has to supply both. Rather than invent hexes, each is one documented
 * operation on tokens that do exist -- see BRICK and SLATE below.
 */

import * as THREE from "three";

export const SCAN = { void: "#06203F", voidDeep: "#041426", grid: "#0C3260",
                      line: "#8FC4F2", lineHi: "#FFFFFF", mark: "#E4526F" } as const;
export const DAY  = { sky: "#D9E2EC", plaster: "#F0EDE7", plasterSh: "#DFDAD1",
                      oak: "#B5813F", oakDeep: "#A5732F", crimson: "#A41034",
                      glass: "#CFE4F2", edge: "#8C8578" } as const;

/**
 * Mix two tokens. THREE.Color converts sRGB hex into the linear working space on
 * construction, so this interpolates in linear light and converts back -- the same
 * arithmetic the renderer does, not the gamma-space blend a paint program does.
 */
function mix(a: string, b: string, t: number): string {
  return "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

/** Scale a token's linear radiance. Values are clamped on the way back to sRGB. */
function scale(a: string, k: number): string {
  return "#" + new THREE.Color(a).multiplyScalar(k).getHexString();
}

/**
 * Weld's brick: the palette's crimson pulled a third of the way to oak's warm
 * brown. Grounded in weld.json `wall_material` -- red brick with sandstone belts
 * -- and deliberately warm, because the one thing this must not be is the
 * cyanotype blue the exterior wears at stage 3.
 */
const BRICK = mix(DAY.crimson, DAY.oakDeep, 0.35);

/**
 * Weld's slate roof, per weld.json `roof_material`. `edge` is the palette's only
 * mineral grey; halfway to `sky` takes the warmth out of it, and 0.14 of the
 * linear value lands on the dark blue-grey a slate roof reads as in daylight.
 */
const SLATE = scale(mix(DAY.edge, DAY.sky, 0.5), 0.14);

/**
 * Furniture hardware -- drawer pulls, nothing else. No source gives a finish, so
 * this is one documented operation on `edge`, in the manner of BRICK and SLATE
 * rather than an invented hex: a third of the way toward black, which is what
 * turns a mineral grey satin rather than leaving it reading as stone.
 */
const HARDWARE = scale(DAY.edge, 0.65);

/**
 * Weld's sandstone belts, per weld.json `wall_material` -- "brick with light sandstone belts".
 * One documented operation on two DAY tokens, the same way BRICK and SLATE are derived: plaster
 * warmed a third of the way toward oak, which is the pale buff a dressed sandstone course reads as
 * in daylight.
 */
const SANDSTONE = mix(DAY.plaster, DAY.oak, 0.3);

/**
 * The granite water table at the base of a Yard building. `edge` is the palette's only mineral
 * grey and 0.55 of its linear value is the cold dark a granite plinth reads as in shade.
 */
const GRANITE = scale(DAY.edge, 0.55);

/**
 * The exterior masonry palette, exported so CampusMesh.tsx and WeldExterior.tsx cannot disagree
 * about what brick is. P10: before this existed the campus had no materials at all, so the question
 * could not come up; it can now.
 */
export const MASONRY = { brick: BRICK, slate: SLATE, sandstone: SANDSTONE, granite: GRANITE } as const;

/**
 * Bathroom tile and sanitary ware (P14). No source gives Weld 15's bathroom a
 * single fact -- rooms.ts's own header calls it interior and windowless and
 * leaves the rest unstated -- so this is one documented operation on two DAY
 * tokens, the same convention BRICK/SLATE/SANDSTONE/GRANITE already use
 * rather than an invented hex: `plaster` cooled a fifth of the way toward
 * `edge`, the palette's only mineral grey. Ceramic reads cooler and harder
 * than a trowelled wall; the low roughness below (0.2 against plaster's 0.88)
 * carries the rest of that difference.
 */
const PORCELAIN = mix(DAY.plaster, DAY.edge, 0.2);

/**
 * Nominal oak board width, ft.
 *
 * No source in the project gives one: not weld.json, not the 1875 specification,
 * not the FYE email. 6 in is the phase brief's own figure and is flagged as a gap
 * rather than presented as sourced.
 */
export const BOARD_FT = 0.5;

/**
 * Boards drawn across one tile of the grain canvas.
 *
 * Eight rather than four so the tile spans 4 ft and the pattern visibly repeats
 * half as often. At the default 512 px that still leaves 128 texels per foot of
 * floor, which is more than the geometry will ever ask for.
 */
const BOARDS_PER_TILE = 8;

/** Feet of floor one tile of the grain texture spans. */
export const OAK_TILE_FT = BOARDS_PER_TILE * BOARD_FT;

/**
 * Board width is carried by the geometry, not by the texture.
 *
 * Box and plane UVs run 0..1 across whatever face they are on, so any repeat set
 * on the shared texture is right for exactly one face size. Every floor here is a
 * different size -- common room 20 x 15, bedrooms 16 x 10, hall 4.5 x 28.5,
 * bathroom 8 x 7.5, K 10 x 12 -- and the earlier calibration on a 16 ft bedroom
 * gave 6 in boards there and boards over three times too wide across the hall's
 * 4.5 ft axis. Cloning the texture per room would fix the width by multiplying the
 * one texture this module exists to hand out. So the repeat stays at 1 and
 * scaleFloorUv() writes the room's real size into the UVs instead: one texture,
 * one material, correct boards at any size.
 *
 * duFt and dvFt are the face's real extent in feet along its own u and v axes, in
 * that order -- for a floor built from a Rect that is du then dv.
 *
 * Two traps. The multiply is applied to the UVs already on the geometry, so this is
 * not idempotent: call it once per geometry, not once per render. And needsUpdate
 * on a BufferAttribute is write-only -- the setter bumps `version` and there is no
 * getter -- so `version` is the only thing a caller or a test can read back.
 *
 * A geometry with no `uv` throws rather than being skipped. Left at 0..1 the floor
 * shows one tile stretched over the whole room, which reads as a single enormous
 * board: wrong, but quiet enough in a screenshot to survive review.
 */
export function scaleFloorUv(
  geometry: THREE.BufferGeometry,
  duFt: number,
  dvFt: number,
): void {
  if (!geometry.hasAttribute("uv")) {
    throw new Error(
      "scaleFloorUv: geometry has no uv attribute, so the oak grain cannot be " +
        "scaled to the floor; it would tile once across the whole room.",
    );
  }
  const uv = geometry.getAttribute("uv");
  const su = duFt / OAK_TILE_FT;
  const sv = dvFt / OAK_TILE_FT;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}

const DEFAULT_GRAIN_PX = 512;

/** Fixed seed. Math.random would redraw the floor on every reload. */
const GRAIN_SEED = 0x15;

const BANDS_PER_BOARD = 6;
const BAND_TILT = 0.1;
/** How much a whole board tilts relative to its neighbours. Boards cup. */
const BOARD_BIAS_TILT = 0.07;
const SEAM_PX = 2;
const SEAM_TILT = 0.72;
/** Fine lines are spaced by texel, not counted per board, so they stay even. */
const LINE_SPACING_PX = 9;
const MIN_LINES_PER_BOARD = 4;
const LINE_TILT = 0.22;
const LINE_STEPS = 8;
const WANDER_PX = 2.4;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Canvas2D = HTMLCanvasElement | OffscreenCanvas;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A tangent-space normal as a canvas colour, tilted across the grain only.
 *
 * Green is pinned at 128 and blue at 255: the surface never tilts ALONG a board,
 * which is exactly what separates grain from noise. Isotropic perturbation of all
 * three channels is what makes procedural wood read as television static. The
 * shader normalises, so a constant blue rather than sqrt(1 - x^2) is fine.
 */
function tiltX(dx: number): string {
  return `rgb(${Math.round(clamp(128 + dx * 127, 0, 255))},128,255)`;
}

/**
 * Oak grain, drawn once.
 *
 * Grain runs along one axis: every fill spans the full height of the tile and only
 * varies across it. Three layers, coarse to fine -- broad low-frequency figure, a
 * bevelled seam at each board edge, then fine lines that wander a couple of pixels
 * over the tile.
 *
 * Two traps recorded. The wander has to end where it started, or the texture kinks
 * visibly at every vertical wrap. And the bands are drawn a pixel wider than their
 * step: at fractional x, adjacent strips leave a hairline of the base colour
 * between them, and a regular hairline every few pixels reads as corduroy.
 *
 * No butt joints between board ends. A tile spans 2 ft, real boards run 3-8 ft, so
 * a joint every tile would be both wrong and conspicuously periodic.
 */
function drawGrain(ctx: Ctx2D, size: number): void {
  const rand = mulberry32(GRAIN_SEED);
  const board = size / BOARDS_PER_TILE;

  ctx.fillStyle = tiltX(0);
  ctx.fillRect(0, 0, size, size);

  for (let b = 0; b < BOARDS_PER_TILE; b++) {
    const x0 = b * board;
    const phase = rand() * Math.PI * 2;
    // A whole-board offset on top of the figure. Without it every board carried
    // the same average tone and the floor read as one wide panel scored into
    // strips rather than as separate boards.
    const bias = (rand() - 0.5) * 2 * BOARD_BIAS_TILT;

    const bandPx = board / BANDS_PER_BOARD;
    for (let i = 0; i < BANDS_PER_BOARD; i++) {
      const t = (i + 0.5) / BANDS_PER_BOARD;
      const tilt =
        bias +
        BAND_TILT * Math.sin(phase + t * Math.PI * 2) +
        (BAND_TILT / 2) * Math.sin(phase * 3 + t * Math.PI * 6);
      ctx.fillStyle = tiltX(tilt);
      ctx.fillRect(x0 + i * bandPx, 0, bandPx + 1, size);
    }

    // The seam reads as a groove: one side tilted away, the other toward. Two
    // pixels rather than one, so it survives the first mip level.
    ctx.fillStyle = tiltX(-SEAM_TILT);
    ctx.fillRect(x0, 0, SEAM_PX, size);
    ctx.fillStyle = tiltX(SEAM_TILT);
    ctx.fillRect(x0 + SEAM_PX, 0, SEAM_PX, size);

    const inner0 = x0 + 2 * SEAM_PX + 1;
    const inner1 = x0 + board - 1;
    const lines = Math.max(MIN_LINES_PER_BOARD, Math.round(board / LINE_SPACING_PX));
    for (let i = 0; i < lines; i++) {
      const start = inner0 + rand() * (inner1 - inner0);
      let x = start;
      ctx.strokeStyle = tiltX((rand() - 0.5) * 2 * LINE_TILT);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let s = 1; s <= LINE_STEPS; s++) {
        x =
          s === LINE_STEPS
            ? start
            : clamp(x + (rand() - 0.5) * WANDER_PX, inner0, inner1);
        ctx.lineTo(x, (size * s) / LINE_STEPS);
      }
      ctx.stroke();
    }
  }
}

/**
 * A drawable canvas, or null when there is none.
 *
 * getContext is called inside each branch rather than on a union: the two canvas
 * types have incompatible overload sets and TypeScript refuses the union call.
 */
function grainCanvas(size: number): { canvas: Canvas2D; ctx: Ctx2D } | null {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    return ctx ? { canvas, ctx } : null;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    return ctx ? { canvas, ctx } : null;
  }
  return null;
}

const grainCache = new Map<number, THREE.Texture>();

/** Procedural oak grain as a normal map. No texture files: CanvasTexture at build time. */
export function oakNormalMap(size: number = DEFAULT_GRAIN_PX): THREE.Texture {
  const hit = grainCache.get(size);
  if (hit) return hit;

  const surface = grainCanvas(size);
  let tex: THREE.Texture;
  if (surface) {
    drawGrain(surface.ctx, size);
    tex = new THREE.CanvasTexture(surface.canvas);
  } else {
    // Headless. An imageless Texture rather than a throw, so importing this module
    // in Node is harmless; materials() checks .image and leaves normalMap null.
    tex = new THREE.Texture();
  }

  tex.name = `oak-grain-${size}`;
  // RepeatWrapping is what makes a UV above 1 tile instead of clamping to the last
  // texel, so it stays load-bearing even at a unit repeat: scaleFloorUv() puts the
  // room's size into the UVs and this is what honours it.
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  // colorSpace stays NoColorSpace. A normal map is a vector, not a colour; tagging
  // it sRGB applies a transfer function to the xyz components and flattens the map.
  grainCache.set(size, tex);
  return tex;
}

const DEFAULT_PLASTER_PX = 256;

/** Fixed seed, distinct from the oak grain's. */
const PLASTER_SEED = 0x9e;

/**
 * Plaster's tooth is isotropic -- unlike oak's grain, which is deliberately
 * anisotropic (see tiltX() above) -- so it tilts in BOTH x and y, at an
 * amplitude an order of magnitude below the grain's: a trowelled surface, not
 * a plank. ASSUMED, like every surface figure in this module without a
 * source.
 */
const PLASTER_TILT = 0.05;
/** Specks per pixel^2 of canvas, at DEFAULT_PLASTER_PX. ASSUMED density. */
const PLASTER_DENSITY = 1 / 300;
const PLASTER_SPECK_PX = 2;

function tiltXY(dx: number, dy: number): string {
  return `rgb(${Math.round(clamp(128 + dx * 127, 0, 255))},${Math.round(clamp(128 + dy * 127, 0, 255))},255)`;
}

/**
 * The plaster tooth, drawn once: a neutral field of small, randomly tilted
 * specks. Only fillRect is used, for the same reason drawGrain() avoids arc
 * -- tests/materials.test.ts's canvas stub implements fillRect and stroked
 * paths, not curves, and this module has to survive that stub as well as a
 * real canvas.
 */
function drawPlasterTooth(ctx: Ctx2D, size: number): void {
  const rand = mulberry32(PLASTER_SEED);
  ctx.fillStyle = tiltXY(0, 0);
  ctx.fillRect(0, 0, size, size);

  const count = Math.round(size * size * PLASTER_DENSITY);
  for (let i = 0; i < count; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const dx = (rand() - 0.5) * 2 * PLASTER_TILT;
    const dy = (rand() - 0.5) * 2 * PLASTER_TILT;
    ctx.fillStyle = tiltXY(dx, dy);
    ctx.fillRect(x, y, PLASTER_SPECK_PX, PLASTER_SPECK_PX);
  }
}

const plasterCache = new Map<number, THREE.Texture>();

/** Procedural plaster tooth as a normal map. No texture file, same machinery as oakNormalMap(). */
export function plasterNormalMap(size: number = DEFAULT_PLASTER_PX): THREE.Texture {
  const hit = plasterCache.get(size);
  if (hit) return hit;

  const surface = grainCanvas(size);
  let tex: THREE.Texture;
  if (surface) {
    drawPlasterTooth(surface.ctx, size);
    tex = new THREE.CanvasTexture(surface.canvas);
  } else {
    tex = new THREE.Texture();
  }

  tex.name = `plaster-tooth-${size}`;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  plasterCache.set(size, tex);
  return tex;
}

export type Palette = {
  plaster: THREE.MeshStandardMaterial;
  oak: THREE.MeshStandardMaterial;
  masonry: THREE.MeshStandardMaterial;
  glazing: THREE.MeshPhysicalMaterial;
  crimson: THREE.MeshStandardMaterial;
  oakDeep: THREE.MeshStandardMaterial;
  slate: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  hardware: THREE.MeshStandardMaterial;
  porcelain: THREE.MeshStandardMaterial;
};

let cache: Palette | null = null;

/** Cached singletons -- a new material per frame is the classic R3F leak. */
export function materials(): Palette {
  if (cache) return cache;

  // Plaster on the interior faces of partitions; masonry is the interior face of
  // the 1.5 ft exterior walls, so it is plaster over brick rather than bare brick
  // -- the shaded token, and coarser, because the render sits on a rougher ground.
  // Bare brick is the `brick` material, for the exterior.
  const plaster = new THREE.MeshStandardMaterial({
    color: DAY.plaster,
    roughness: 0.88,
    metalness: 0,
  });
  const masonry = new THREE.MeshStandardMaterial({
    color: DAY.plasterSh,
    roughness: 0.95,
    metalness: 0,
  });
  // Both are the same trowelled surface, just shaded and tinted differently,
  // so both take the same tooth -- unlike the oak grain, low-amplitude and
  // isotropic enough that neither needs scaleFloorUv()'s per-face scaling.
  const tooth = plasterNormalMap();
  if (tooth.image) {
    plaster.normalMap = tooth;
    plaster.normalScale.set(0.18, 0.18);
    masonry.normalMap = tooth;
    masonry.normalScale.set(0.18, 0.18);
  }

  // Satin-finished boards: enough sheen to catch the north light, nowhere near
  // gloss.
  const oak = new THREE.MeshStandardMaterial({
    color: DAY.oak,
    roughness: 0.6,
    metalness: 0,
  });
  const grain = oakNormalMap();
  if (grain.image) {
    oak.normalMap = grain;
    oak.normalScale.set(0.55, 0.55);
  }

  // No grain on oakDeep: it dresses furniture sides, and furniture geometry does not
  // go through scaleFloorUv, so its 0..1 UVs would put a whole 4 ft tile across a
  // 3 ft drawer front.
  const oakDeep = new THREE.MeshStandardMaterial({
    color: DAY.oakDeep,
    roughness: 0.6,
    metalness: 0,
  });

  // Bedding and textiles. Cloth has effectively no specular lobe.
  const crimson = new THREE.MeshStandardMaterial({
    color: DAY.crimson,
    roughness: 0.97,
    metalness: 0,
  });

  /**
   * Glazing has to read as glass rather than as a blue plane, which here takes
   * three things: a smooth surface so it holds a highlight, the ior of soda-lime
   * float glass so it brightens at grazing angles, and partial opacity so the room
   * beyond shows through.
   *
   * Transmission is the obvious fourth and it is deliberately off -- see the note on
   * the property itself, which records what it measured. An earlier version used
   * transmission 0.92 with a 0.02 ft thickness for a nominal quarter-inch pane;
   * both are gone, because thickness only matters on the refraction path and there
   * is no refraction path now.
   *
   * DoubleSide because every window is seen from both sides -- from the Yard at
   * stage 4 and from inside the room at stage 5 and in first person.
   */
  const glazing = new THREE.MeshPhysicalMaterial({
    color: DAY.glass,
    roughness: 0.05,
    metalness: 0,
    // transmission is deliberately 0, and this is a performance decision with a
    // measured basis rather than a preference.
    //
    // A non-zero transmission makes three render the scene a SECOND time into a
    // transmission render target, so every visible mesh is drawn twice. Measured at
    // stage 5: 37 draw calls with transmission against 27 without, and the doubling
    // scales with what the camera can see -- the roof-off cutaway sees the whole
    // suite, which would put it over the 25-call scene budget in
    // docs/IMPLEMENTATION-PLAN.md section 9. A full extra scene render is a lot to
    // pay for refraction through a quarter-inch pane seen at room distance, where
    // there is nothing behind the glass close enough to visibly bend.
    //
    // What carries the glass instead: a low roughness for the specular highlight,
    // an ior that still drives the Fresnel falloff so it brightens at grazing
    // angles, and opacity. Lighting.tsx's scene.environment (P10) is the envMap
    // this note used to call the next step, not transmission.
    transmission: 0,
    ior: 1.52,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
  });

  // Slate has a slight sheen -- it is a cleaved stone, not a matte one.
  const slate = new THREE.MeshStandardMaterial({
    color: SLATE,
    roughness: 0.4,
    metalness: 0,
  });

  // Brick and its mortar joints: rougher than plaster, still not the roughest
  // thing here.
  const brick = new THREE.MeshStandardMaterial({
    color: BRICK,
    roughness: 0.92,
    metalness: 0,
  });

  // The one metal in the palette: drawer and dresser pulls. Satin, not mirror --
  // enough metalness to read as hardware rather than painted wood, roughness high
  // enough that it never throws a hard specular pinpoint under the single sun.
  const hardware = new THREE.MeshStandardMaterial({
    color: HARDWARE,
    roughness: 0.45,
    metalness: 0.85,
  });

  // Glazed tile and sanitary porcelain: smooth enough to hold a highlight,
  // nowhere near glass. No normal map -- ceramic's own tooth is finer than
  // this project's texel budget can usefully carry, unlike plaster's trowel
  // marks or oak's grain, both of which are the point of their own surface.
  const porcelain = new THREE.MeshStandardMaterial({
    color: PORCELAIN,
    roughness: 0.2,
    metalness: 0,
  });

  cache = { plaster, oak, masonry, glazing, crimson, oakDeep, slate, brick, hardware, porcelain };
  return cache;
}

export function disposeMaterials(): void {
  if (cache) for (const m of Object.values(cache)) m.dispose();
  cache = null;
  for (const t of grainCache.values()) t.dispose();
  grainCache.clear();
  for (const t of plasterCache.values()) t.dispose();
  plasterCache.clear();
}
