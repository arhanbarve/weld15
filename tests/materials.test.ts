/**
 * Materials.
 *
 * Two things are hard to test here and both are done rather than skipped.
 *
 * The grain is a canvas drawing, so the canvas is stubbed with a recorder and the
 * drawing is asserted from the ops: strips that span the full height, lines that
 * run along one axis only, a green channel that never moves. That is what
 * separates grain from isotropic noise, and it is checkable without a GPU.
 *
 * The module has two code paths -- canvas and headless -- and vitest only ever
 * sees the headless one by default, so the canvas path is exercised by installing
 * a stub `document` for the duration of the call. No module reset: re-importing
 * would give a second copy of three and every `instanceof` check would go false.
 * disposeMaterials() clears the caches instead.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { DEFAULT_PARAMS, buildSuite } from "@/geo/rooms";
import {
  DAY,
  SCAN,
  BOARD_FT,
  OAK_TILE_FT,
  materials,
  oakNormalMap,
  scaleFloorUv,
  disposeMaterials,
} from "@/scene/materials";

// ---------------------------------------------------------------- canvas stub

type Pt = { x: number; y: number };
type FillRect = { x: number; y: number; w: number; h: number; fill: string };
type StrokePath = { pts: Pt[]; stroke: string; lineWidth: number };
type Recording = { width: number; height: number; rects: FillRect[]; paths: StrokePath[] };

type StubCtx = {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
};

function installStubDocument(): Recording[] {
  const records: Recording[] = [];

  const createElement = (tag: string) => {
    if (tag !== "canvas") throw new Error(`stub document only makes canvases, got ${tag}`);
    const rec: Recording = { width: 0, height: 0, rects: [], paths: [] };
    records.push(rec);
    let path: Pt[] = [];
    const ctx: StubCtx = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      fillRect(x, y, w, h) {
        rec.rects.push({ x, y, w, h, fill: ctx.fillStyle });
      },
      beginPath() {
        path = [];
      },
      moveTo(x, y) {
        path.push({ x, y });
      },
      lineTo(x, y) {
        path.push({ x, y });
      },
      stroke() {
        rec.paths.push({ pts: [...path], stroke: ctx.strokeStyle, lineWidth: ctx.lineWidth });
      },
    };
    return {
      get width() {
        return rec.width;
      },
      set width(v: number) {
        rec.width = v;
      },
      get height() {
        return rec.height;
      },
      set height(v: number) {
        rec.height = v;
      },
      getContext: (kind: string) => (kind === "2d" ? ctx : null),
    };
  };

  Object.defineProperty(globalThis, "document", {
    value: { createElement },
    configurable: true,
    writable: true,
  });
  return records;
}

function removeStubDocument(): void {
  Reflect.deleteProperty(globalThis, "document");
}

function withStubCanvas<T>(fn: () => T): { value: T; records: Recording[] } {
  const records = installStubDocument();
  try {
    return { value: fn(), records };
  } finally {
    removeStubDocument();
  }
}

// ------------------------------------------------------------------- helpers

function channels(css: string): [number, number, number] {
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(css);
  if (!m) throw new Error(`grain used a colour the test cannot parse: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function bytes(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function hexOf(c: THREE.Color): string {
  return "#" + c.getHexString();
}

/** Every --custom-property in the stylesheet the design system is mirrored into. */
function cssTokens(): Map<string, string> {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const out = new Map<string, string>();
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out.set(m[1]!, m[2]!.trim().toLowerCase());
  }
  return out;
}

const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

beforeEach(() => {
  disposeMaterials();
  removeStubDocument();
});
afterEach(() => {
  disposeMaterials();
  removeStubDocument();
});

// -------------------------------------------------------------------- tokens

describe("tokens", () => {
  it("carries the SCAN and DAY tables the contract names, and nothing else", () => {
    expect(Object.keys(SCAN)).toEqual(["void", "voidDeep", "grid", "line", "lineHi", "mark"]);
    expect(Object.keys(DAY)).toEqual([
      "sky",
      "plaster",
      "plasterSh",
      "oak",
      "oakDeep",
      "crimson",
      "glass",
      "edge",
    ]);
  });

  it("matches app/globals.css token for token", () => {
    // The design system lives in two files -- MASTER.md and the stylesheet that
    // mirrors it -- and this module is a third copy. Pinning it to the stylesheet
    // means a hex edited in one place and not the other fails here instead of
    // producing a scene that quietly disagrees with the HUD.
    const css = cssTokens();
    const checked: string[] = [];
    for (const [k, v] of Object.entries({ ...SCAN, ...DAY })) {
      const name = kebab(k);
      expect(css.get(name), `--${name} missing from globals.css`).toBeDefined();
      expect(css.get(name)).toBe(v.toLowerCase());
      checked.push(name);
    }
    expect(checked).toHaveLength(14);
  });

  it("uses six-digit hex that survives a round trip through the working space", () => {
    for (const [k, v] of Object.entries({ ...SCAN, ...DAY })) {
      expect(v, k).toMatch(/^#[0-9A-F]{6}$/);
      expect(hexOf(new THREE.Color(v)), k).toBe(v.toLowerCase());
    }
  });
});

// --------------------------------------------------------------- grain, drawn

describe("procedural oak grain, canvas path", () => {
  const SIZE = 512;
  /** A seam is a hairline strip. Bands are an order of magnitude wider. */
  const HAIRLINE_PX = 3;

  let tex: THREE.Texture;
  let rec: Recording;
  let board: number;
  let seams: FillRect[];
  let boardsPerTile: number;

  beforeEach(() => {
    const r = withStubCanvas(() => oakNormalMap(SIZE));
    tex = r.value;
    expect(r.records).toHaveLength(1);
    rec = r.records[0]!;
    seams = rec.rects.filter((x) => x.w <= HAIRLINE_PX);
    // Each board boundary is a two-strip bevel: one tilted away, one toward.
    boardsPerTile = seams.filter((x) => channels(x.fill)[0] < 128).length;
    // Guarded here rather than per test: with no seams found, boardsPerTile is 0,
    // board is Infinity, and half the assertions below iterate empty lists and
    // pass. Deleting the seams was caught by exactly one test until this line.
    expect(boardsPerTile).toBeGreaterThan(1);
    board = SIZE / boardsPerTile;
  });

  it("draws onto a canvas of the requested size, with no texture file involved", () => {
    expect(tex).toBeInstanceOf(THREE.CanvasTexture);
    expect(rec.width).toBe(SIZE);
    expect(rec.height).toBe(SIZE);
    expect(tex.image).not.toBeNull();
  });

  it("stays a normal map: NoColorSpace, tiling in both axes", () => {
    // Tagging a normal map sRGB applies a transfer function to what are vector
    // components and flattens the relief.
    expect(tex.colorSpace).toBe(THREE.NoColorSpace);
    // RepeatWrapping with a unit repeat: the UVs carry the room's size, and wrapping
    // is what lets a UV above 1 tile rather than clamp to the last texel.
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.RepeatWrapping);
    expect(tex.repeat.x).toBe(1);
    expect(tex.repeat.y).toBe(1);
  });

  it("lands on 6-inch boards in both axes on every floor of the suite", () => {
    // Closes the loop end to end and across sizes: boards counted off the recorded
    // seams, times the texture's own repeat, times the UVs scaleFloorUv writes, on
    // the real room rects from buildSuite. A single reference dimension would only
    // restate the calibration, which is what the old version of this test did.
    const rooms = buildSuite(DEFAULT_PARAMS).rooms;
    const floors = ["common1", "bedA", "hall", "bath", "k"].map((id) => {
      const r = rooms.find((x) => x.id === id);
      expect(r, `${id} missing from the suite`).toBeDefined();
      return r!;
    });
    // Guard: if the ids ever collapse onto rooms of one shape the loop below stops
    // testing size-independence while still passing.
    expect(new Set(floors.map((r) => `${r.du}x${r.dv}`)).size).toBe(5);
    expect(new Set(floors.flatMap((r) => [r.du, r.dv])).size).toBeGreaterThan(4);

    for (const r of floors) {
      const g = new THREE.PlaneGeometry(r.du, r.dv);
      scaleFloorUv(g, r.du, r.dv);
      const uv = g.getAttribute("uv");
      let maxU = -Infinity;
      let maxV = -Infinity;
      for (let i = 0; i < uv.count; i++) {
        maxU = Math.max(maxU, uv.getX(i));
        maxV = Math.max(maxV, uv.getY(i));
      }
      // What the shader actually samples with: repeat times UV.
      const boardsU = tex.repeat.x * maxU * boardsPerTile;
      const boardsV = tex.repeat.y * maxV * boardsPerTile;
      expect((r.du / boardsU) * 12, `${r.id} across u (${r.du} ft)`).toBeCloseTo(6, 6);
      expect((r.dv / boardsV) * 12, `${r.id} across v (${r.dv} ft)`).toBeCloseTo(6, 6);
      g.dispose();
    }
    // And the module's own figure agrees with the 6 in the assertions above assume.
    expect(BOARD_FT * 12).toBeCloseTo(6, 6);
    expect(OAK_TILE_FT / boardsPerTile).toBeCloseTo(BOARD_FT, 6);
  });

  it("marks the rewritten UVs for upload", () => {
    // needsUpdate is write-only on BufferAttribute; the setter bumps version, and a
    // rewrite that never bumps it leaves the GPU holding the 0..1 UVs.
    const g = new THREE.PlaneGeometry(20, 15);
    // PlaneGeometry's uv is a plain BufferAttribute. getAttribute's declared type
    // is the union with InterleavedBufferAttribute, which has no `version`, so the
    // narrowing is what lets the version check compile rather than a cast that
    // would also hide a genuinely interleaved attribute.
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const before = uv.version;
    scaleFloorUv(g, 20, 15);
    expect((g.getAttribute("uv") as THREE.BufferAttribute).version).toBeGreaterThan(before);
    g.dispose();
  });

  it("throws on a geometry with no UVs rather than tiling once across the room", () => {
    // Silently doing nothing leaves a floor that reads as one enormous board -- easy
    // to miss, and impossible to attribute to this module later.
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));
    expect(() => scaleFloorUv(g, 20, 15)).toThrow(/uv/i);
    g.dispose();
  });

  it("spaces the board seams evenly, so the tile reads as boards", () => {
    expect(seams).toHaveLength(2 * boardsPerTile);
    const dark = seams
      .filter((x) => channels(x.fill)[0] < 128)
      .map((x) => x.x)
      .sort((a, b) => a - b);
    dark.forEach((x, i) => expect(x).toBeCloseTo(i * board, 6));
    // A real bevel, not a shading nudge: much stronger than any banding tilt.
    for (const s of seams) expect(Math.abs(channels(s.fill)[0] - 128)).toBeGreaterThan(50);
  });

  it("runs the grain along one axis: every fill spans the full height", () => {
    // The requirement this file exists to defend. Isotropic perturbation reads as
    // static; wood varies across the board and barely along it.
    expect(rec.rects.length).toBeGreaterThan(10);
    for (const r of rec.rects) {
      expect(r.y).toBe(0);
      expect(r.h).toBe(SIZE);
    }
  });

  it("runs every grain line along the boards, never across them", () => {
    expect(rec.paths.length).toBeGreaterThan(0);
    for (const p of rec.paths) {
      expect(p.pts.length).toBeGreaterThan(2);
      for (let i = 1; i < p.pts.length; i++) {
        const a = p.pts[i - 1]!;
        const b = p.pts[i]!;
        expect(Math.abs(b.y - a.y)).toBeGreaterThan(Math.abs(b.x - a.x));
      }
    }
  });

  it("returns each grain line to where it started, so the tile does not kink", () => {
    // A line that drifts sideways over the tile's height meets its own start at
    // the wrap and shows a visible kink every 2 ft of floor.
    expect(rec.paths.length).toBeGreaterThan(0);
    for (const p of rec.paths) {
      expect(p.pts[p.pts.length - 1]!.x).toBeCloseTo(p.pts[0]!.x, 6);
    }
  });

  it("keeps each grain line inside one board", () => {
    expect(rec.paths.length).toBeGreaterThan(0);
    for (const p of rec.paths) {
      const xs = p.pts.map((q) => q.x);
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      expect(hi - lo).toBeLessThan(board);
      expect(Math.floor(lo / board)).toBe(Math.floor(hi / board));
    }
  });

  it("modulates the cross-grain tilt only, leaving the other two channels fixed", () => {
    // Green is the along-grain tilt and blue is the surface normal's z. If either
    // moves, the map has cross-grain relief and the floor reads as noise.
    const colours = [...rec.rects.map((r) => r.fill), ...rec.paths.map((p) => p.stroke)];
    const reds = new Set<number>();
    for (const c of colours) {
      const [r, g, b] = channels(c);
      expect(g).toBe(128);
      expect(b).toBe(255);
      reds.add(r);
    }
    expect(reds.size).toBeGreaterThan(8);
    expect(Math.min(...reds)).toBeLessThan(128);
    expect(Math.max(...reds)).toBeGreaterThan(128);
  });

  it("layers low-frequency banding under fine lines", () => {
    const flat = rec.rects[0]!;
    expect(flat.w).toBe(SIZE);
    expect(channels(flat.fill)).toEqual([128, 128, 255]);

    const bands = rec.rects.filter((r) => r.w > HAIRLINE_PX && r.w < SIZE);
    expect(bands.length).toBeGreaterThanOrEqual(3 * boardsPerTile);
    expect(Math.max(...bands.map((b) => b.w))).toBeGreaterThan(board / 8);

    expect(rec.paths.length).toBeGreaterThanOrEqual(4 * boardsPerTile);
    for (let b = 0; b < boardsPerTile; b++) {
      const onBoard = rec.paths.filter((p) => Math.floor(p.pts[0]!.x / board) === b);
      expect(onBoard.length, `board ${b}`).toBeGreaterThanOrEqual(4);
    }
    for (const p of rec.paths) expect(p.lineWidth).toBeLessThanOrEqual(2);
  });

  it("draws once per size and caches, so no render can redraw it", () => {
    // Second call has no document at all: if it returned a texture, the cache is
    // doing its job.
    expect(oakNormalMap(SIZE)).toBe(tex);
    const other = withStubCanvas(() => oakNormalMap(256));
    expect(other.value).not.toBe(tex);
    expect(other.records[0]!.width).toBe(256);
    expect(other.value.repeat.x).toBe(tex.repeat.x);
  });

  it("gives oak a normal map and oakDeep none", () => {
    const m = withStubCanvas(() => materials()).value;
    expect(m.oak.normalMap).toBeInstanceOf(THREE.CanvasTexture);
    // Furniture never goes through scaleFloorUv, so grain on it would tile wrong.
    expect(m.oakDeep.normalMap).toBeNull();
    expect(m.oak.normalScale.x).toBeGreaterThan(0);
    expect(m.oak.normalScale.x).toBe(m.oak.normalScale.y);
  });
});

// ------------------------------------------------------------ grain, headless

describe("headless, where vitest and any SSR pass live", () => {
  it("has no document to draw on", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof OffscreenCanvas).toBe("undefined");
  });

  it("returns an imageless texture instead of throwing", () => {
    const tex = oakNormalMap();
    expect(tex).toBeInstanceOf(THREE.Texture);
    expect(tex).not.toBeInstanceOf(THREE.CanvasTexture);
    expect(tex.image).toBeNull();
    // Still configured, so a consumer that copies settings off it is not surprised.
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.repeat.x).toBe(1);
    expect(tex.repeat.y).toBe(1);
  });

  it("builds the full palette with no normal map anywhere", () => {
    const m = materials();
    expect(m.oak.normalMap).toBeNull();
    expect(m.oakDeep.normalMap).toBeNull();
    // The rest of the material is unaffected: only the relief is missing.
    expect(hexOf(m.oak.color)).toBe(DAY.oak.toLowerCase());
    expect(m.oak.roughness).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------- palette

describe("palette", () => {
  it("returns exactly the eight keys in the contract", () => {
    expect(Object.keys(materials()).sort()).toEqual([
      "brick",
      "crimson",
      "glazing",
      "masonry",
      "oak",
      "oakDeep",
      "plaster",
      "slate",
    ]);
  });

  it("is a set of cached singletons", () => {
    // The gate from the phase spec. A material built inside a render is the leak
    // this module exists to prevent.
    const a = materials();
    const b = materials();
    expect(a).toBe(b);
    for (const k of Object.keys(a) as (keyof typeof a)[]) {
      expect(a[k], k).toBe(b[k]);
    }
  });

  it("takes every finish colour from the DAY table", () => {
    const m = materials();
    expect(hexOf(m.plaster.color)).toBe(DAY.plaster.toLowerCase());
    expect(hexOf(m.masonry.color)).toBe(DAY.plasterSh.toLowerCase());
    expect(hexOf(m.oak.color)).toBe(DAY.oak.toLowerCase());
    expect(hexOf(m.oakDeep.color)).toBe(DAY.oakDeep.toLowerCase());
    expect(hexOf(m.crimson.color)).toBe(DAY.crimson.toLowerCase());
    expect(hexOf(m.glazing.color)).toBe(DAY.glass.toLowerCase());
  });

  it("keeps oakDeep darker than oak, per the token table", () => {
    const m = materials();
    const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    expect(lum(m.oakDeep.color)).toBeLessThan(lum(m.oak.color));
  });

  it("is entirely non-metal", () => {
    for (const [k, mat] of Object.entries(materials())) {
      expect(mat.metalness, k).toBe(0);
    }
  });

  it("makes plaster rough and masonry rougher", () => {
    const m = materials();
    expect(m.plaster.roughness).toBeGreaterThan(0.8);
    expect(m.masonry.roughness).toBeGreaterThan(m.plaster.roughness);
    // Brick and its mortar joints are coarser than a plastered wall.
    expect(m.brick.roughness).toBeGreaterThan(m.plaster.roughness);
    // Cloth has effectively no specular lobe.
    expect(m.crimson.roughness).toBeGreaterThan(0.9);
  });

  it("makes glazing read as glass rather than a blue plane", () => {
    const m = materials();
    expect(m.glazing).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    // What carries the glass now that transmission is off: a tight specular lobe,
    // the Fresnel falloff that ior drives, and partial opacity.
    expect(m.glazing.roughness).toBeLessThan(0.15);
    expect(m.glazing.ior).toBeCloseTo(1.52, 2);
    expect(m.glazing.transparent).toBe(true);
    expect(m.glazing.opacity).toBeGreaterThan(0);
    expect(m.glazing.opacity).toBeLessThan(0.6);
    // Seen from the Yard at stage 4 and from inside the room at stage 5.
    expect(m.glazing.side).toBe(THREE.DoubleSide);
    expect(m.glazing.roughness).toBeLessThan(m.slate.roughness);
  });

  it("keeps transmission off, because it costs a whole extra scene render", () => {
    // Not a style assertion. A non-zero transmission makes three render the scene a
    // second time into a transmission target, so every visible mesh is drawn twice.
    // Measured at stage 5: 37 draw calls with it against 27 without, and the
    // doubling scales with what the camera sees -- the roof-off cutaway sees the
    // whole suite and would breach the 25-call scene budget in
    // docs/IMPLEMENTATION-PLAN.md section 9.
    //
    // This test exists because the cost is invisible in the material's own
    // appearance: someone tuning the glass would reasonably turn transmission up and
    // have no way to see what it bought them.
    expect(materials().glazing.transmission).toBe(0);
  });

  it("makes slate dark, cool and slightly glossy", () => {
    const m = materials();
    const [r, g, b] = bytes(hexOf(m.slate.color));
    expect(Math.max(r, g, b)).toBeLessThan(110);
    // Cool, not the warm grey `edge` starts as.
    expect(b).toBeGreaterThanOrEqual(r);
    // Glossier than an oiled floor, nowhere near glass.
    expect(m.slate.roughness).toBeLessThan(m.oak.roughness);
    expect(m.slate.roughness).toBeGreaterThan(m.glazing.roughness);
  });

  it("makes brick Weld's red brick, not the cyanotype blue", () => {
    const m = materials();
    const hex = hexOf(m.brick.color);
    const [r, g, b] = bytes(hex);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r - b).toBeGreaterThan(60);
    const hsl = m.brick.color.getHSL({ h: 0, s: 0, l: 0 });
    expect(hsl.h * 360).toBeLessThan(40);
    for (const [k, v] of Object.entries(SCAN)) {
      expect(hex, `brick took the ${k} token`).not.toBe(v.toLowerCase());
    }
  });

  it("disposes every material and the grain texture, then rebuilds fresh", () => {
    const first = withStubCanvas(() => materials()).value;
    const grain = oakNormalMap();
    const fired: string[] = [];
    for (const [k, mat] of Object.entries(first)) {
      mat.addEventListener("dispose", () => fired.push(k));
    }
    grain.addEventListener("dispose", () => fired.push("grain"));

    disposeMaterials();

    expect(fired.sort()).toEqual([
      "brick",
      "crimson",
      "glazing",
      "grain",
      "masonry",
      "oak",
      "oakDeep",
      "plaster",
      "slate",
    ]);
    expect(materials()).not.toBe(first);
    expect(oakNormalMap()).not.toBe(grain);
  });

  it("survives dispose with nothing built", () => {
    expect(() => disposeMaterials()).not.toThrow();
    expect(() => disposeMaterials()).not.toThrow();
  });
});
