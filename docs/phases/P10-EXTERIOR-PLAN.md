# P10 Implementation Plan — colour on the ground, real buildings on it

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a leaf-on colour aerial photograph under stages 1–3, and stand the real Harvard
buildings — Weld included — on it in brick, sandstone and slate with their real roof forms.

**Architecture:** Three changes that must land together (see P10-EXTERIOR.md §6.1). (A) The imagery pyramid's
L2/L3 switch to USDA NAIP and L4 becomes a MassGIS-luma / NAIP-colour hybrid, with all extents, grids
and the resampler unchanged. (B) `Ground.tsx` scales the tint ramp by 0.35 so colour survives the
descent. (C) A build-time script extracts Harvard's own I3S 3D model into a committed GLB, and one
shader colours it by a per-vertex material class that is derived from the geometry, blended out of
the scan palette by the same altitude ramp the ground already uses.

**Tech Stack:** Next.js 16 / React 19 / three 0.185 / @react-three/fiber 9 / three-stdlib / zustand /
vitest / Playwright / sharp. Node 26 imports TypeScript directly, so pure maths lives once in `src/`
and is imported by both the app and the build scripts.

**Read first:** `docs/phases/P10-EXTERIOR.md` is the spec and carries every measurement this plan relies on.

---

## Ground rules for whoever executes this

1. **This repo's discipline is that a claim carries its source.** Comments here are not decoration.
   When a step says to write a header comment explaining a number, that is part of the step.
2. **Never loosen a failing gate.** Three e2e gates are expected to fail (Task 13). Each is rebuilt
   from a fresh measurement, the way P9 rebuilt the 236 threshold. `docs/phases/P9.md` §6.10 is the
   precedent and it says this explicitly.
3. **Work in the worktree `/Users/arhanbarve/Code/weld15-imagery` on branch `p10-imagery`.** Three
   sibling worktrees are running other sessions. Do not touch them. Do not commit to `main`.
   File ownership is agreed and recorded in `docs/phases/P10-EXTERIOR.md` §11: this branch owns
   `Ground.tsx`, `Campus.tsx`, `CampusMesh.tsx`, `WeldExterior.tsx`, `weldGeometry.ts` and the two
   fetch scripts. **Two files are shared.** In `src/scene/materials.ts` touch only the exterior
   tokens near `BRICK`/`SLATE`; leave everything from `drawGrain()` down alone. In
   `src/scene/Experience.tsx` Task 13 adds exactly two lines — add no more. Do not open
   `stages.ts`, `orbit.ts`, `Suite.tsx`, `furniture.ts`, `walls.ts` or `Hud.tsx`; they belong to
   other live sessions.
4. **New pure modules must stay three-free and alias-free** (no `import ... from "three"`, no `@/`),
   because the build scripts import them directly with Node's TypeScript stripping, which resolves
   neither. `src/scene/altitude.ts` is the existing precedent for a three-free module.
5. **Node's type stripping has limits:** no `enum`, no `namespace`, and type-only imports must use
   `import type`. The codebase already writes it that way.
6. Dev server for this worktree runs on **port 3200**. Ports 3007, 3010 and 3100 belong to other
   sessions.

---

## File Structure

**Created**

| file | responsibility |
|---|---|
| `src/imagery/hybrid.ts` | pure per-pixel luma/chroma recombination and the vegetation mask. Three-free. |
| `src/scene/i3s.ts` | pure I3S decode: buffer layout, leaf filtering, the degree/metre transform. Three-free. |
| `src/scene/glb.ts` | pure GLB container writer. Three-free. |
| `src/scene/CampusMesh.tsx` | loads `campus.glb` imperatively and draws it with the classified-material shader. |
| `scripts/fetch-buildings.mjs` | the extractor, and the provenance record for it. |
| `src/data/buildings-manifest.json` | emitted: names, heights, provenance, derived-materials disclosure. |
| `public/models/campus.glb` | emitted: the extracted campus. |
| `tests/hybrid.test.ts` | unit tests for `src/imagery/hybrid.ts`. |
| `tests/i3s.test.ts` | unit tests for `src/scene/i3s.ts` and `src/scene/glb.ts`. |
| `tests/buildings.test.ts` | asserts the emitted manifest and GLB against `campus.json`. |

**Modified**

| file | change |
|---|---|
| `scripts/fetch-imagery.mjs` | NAIP source; the resampler split into a sampler-agnostic core; L4 hybrid; header rewritten |
| `src/data/imagery-manifest.json` | regenerated |
| `public/imagery/l2,l3,l4.{avif,webp}` | regenerated |
| `src/scene/Ground.tsx` | `TINT_SCALE` |
| `src/scene/materials.ts` | export the masonry palette; add sandstone and granite |
| `src/scene/Campus.tsx` | mounts `CampusMesh`; drops the two mass meshes and the non-Weld edge line |
| `src/scene/Experience.tsx` | computes and passes `palette` to `WeldExterior` |
| `src/scene/WeldExterior.tsx` | new optional `palette` prop drives the seam |
| `src/ui/ImageryChip.tsx` | new attribution |
| `src/ui/Provenance.tsx` | NAIP and Harvard 3D entries |
| `design-system/MASTER.md` | amend the photographic-layer table |
| `docs/SOURCES.md` | NAIP; Harvard `Facilities3D_Facilities`; derived-materials disclosure |
| `tests/e2e/campus.spec.ts`, `imagery.spec.ts`, `perf.spec.ts` | gates rebuilt (Task 13) |

---

# PART A — the imagery pyramid learns about summer

### Task 1: Pin NAIP's provenance before using it

The manifest must record a real flight date and a real ground-sample distance. The service's
`pixelSizeX: 1` is a mosaic default, not the flown resolution (P10-EXTERIOR.md §4, A2). **If this task cannot
produce both figures, stop and report — do not proceed with a guess.**

**Files:**
- Create: `scripts/probe-naip.mjs` (throwaway; deleted in Task 5)

- [ ] **Step 1: Write the probe**

```js
// scripts/probe-naip.mjs — throwaway. Answers P10-EXTERIOR.md §4 A2 before the manifest claims anything.
const IMG = "https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer";
const DEG = Math.PI / 180;
const WELD = { lat: 42.3739244, lon: -71.1171195 };
const R = 6378137;
const x = R * WELD.lon * DEG;
const y = R * Math.log(Math.tan(Math.PI / 4 + (WELD.lat * DEG) / 2));
const d = 400; // metres either side of Weld

const geom = encodeURIComponent(
  JSON.stringify({ xmin: x - d, ymin: y - d, xmax: x + d, ymax: y + d, spatialReference: { wkid: 3857 } }),
);
const url =
  `${IMG}/query?f=json&where=1%3D1&geometry=${geom}&geometryType=esriGeometryEnvelope` +
  `&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&resultRecordCount=10`;

const j = await (await fetch(url)).json();
console.log("fields:", (j.fields || []).map((f) => f.name).join(", "));
for (const f of j.features || []) console.log(JSON.stringify(f.attributes));
```

- [ ] **Step 2: Run it**

Run: `node scripts/probe-naip.mjs`
Expected: one or more mosaic catalog rows. Look for a date field (`SRC_IMG_DATE`, `AcquisitionDate`,
`Year`, or similar) and a resolution field (`SRC_RES`, `HighPS`, `LowPS`, `PixelSize`).

- [ ] **Step 3: Record the two figures**

Write them into a scratch note. If the query returns no usable date or resolution, try
`${IMG}?f=json` and read `minPS`/`maxPS`, and try `${IMG}/info/metadata`. **If after both there is
still no date, stop and report to the user rather than inventing one.** The whole point of this repo
is that the manifest does not guess.

- [ ] **Step 4: Commit nothing yet.** The probe is throwaway and is deleted in Task 5.

---

### Task 2: Split the resampler so it does not care where pixels come from

`resampleMassGIS()` currently welds three things together: working out which Web Mercator tiles a
level spans, mosaicking them, and the inverse per-output-pixel mapping into the site frame. Only the
third is reusable, and NAIP needs it. Split it before adding a second source, so there is one
inverse mapping rather than two copies that can drift.

**Files:**
- Modify: `scripts/fetch-imagery.mjs`

- [ ] **Step 1: Extract the inverse mapping into `resampleInverse`**

Replace the body of the resampling loop in `resampleMassGIS()` with a call to this new function,
placed just above it:

```js
/**
 * The inverse per-output-pixel mapping, with the source abstracted behind a sampler.
 *
 * SPLIT OUT IN P10 BECAUSE THERE ARE NOW TWO SOURCES. This is the half of the old
 * resampleMassGIS() that is not about tiles: for each pixel of the quad, work out where on Earth
 * it is, convert to Web Mercator pixels at the working zoom, and ask the sampler for the colour
 * there. The other direction -- walk the source and scatter -- leaves holes wherever the scale is
 * not exactly 1 and is the classic way to get a moire.
 *
 * `sample(fx, fy)` takes FRACTIONAL Web Mercator pixel coordinates at zoom `z` and returns
 * [r, g, b, a]. Bilinear is the sampler's business, not this function's, because the tile mosaic
 * and the single NAIP raster have different edge behaviour: the mosaic must let alpha go to zero
 * outside coverage so the ocean composite shows through, and a single raster must clamp.
 *
 * j = 0 is the TOP of the quad, which is NORTH, which is +y in the site frame. Getting this upside
 * down flips the photograph north-for-south, and a mirrored Yard is exactly the class of error
 * frames.ts's header warns is invisible.
 */
function resampleInverse(level, z, sample) {
  const [W, H] = level.px;
  const half = level.extentFt / 2;
  const out = Buffer.alloc(W * H * 4);
  for (let j = 0; j < H; j++) {
    const sy = half - ((j + 0.5) / H) * level.extentFt;
    for (let i = 0; i < W; i++) {
      const sx = -half + ((i + 0.5) / W) * level.extentFt;
      const { lat, lon } = siteToLatLon(sx, sy);
      const m = merc(lat, lon, z);
      const [r, g, b, a] = sample(m.x, m.y);
      const o = (j * W + i) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { data: out, width: W, height: H };
}

/** Bilinear sampler over a raw RGBA buffer laid out in Web Mercator pixels at zoom z. */
function mosaicSampler(mosaic, mosaicW, mosaicH, originX, originY) {
  return (fx, fy) => {
    const px = fx - originX;
    const py = fy - originY;
    const x0 = Math.floor(px - 0.5);
    const y0 = Math.floor(py - 0.5);
    const ax = px - 0.5 - x0;
    const ay = py - 0.5 - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const cx = Math.min(mosaicW - 1, Math.max(0, x0 + dx));
        const cy = Math.min(mosaicH - 1, Math.max(0, y0 + dy));
        const w = (dx ? ax : 1 - ax) * (dy ? ay : 1 - ay);
        const k = (cy * mosaicW + cx) * 4;
        r += mosaic[k] * w;
        g += mosaic[k + 1] * w;
        b += mosaic[k + 2] * w;
        a += mosaic[k + 3] * w;
      }
    }
    return [r, g, b, a];
  };
}
```

- [ ] **Step 2: Rewrite `resampleMassGIS` to use them**

Keep everything in `resampleMassGIS()` down to and including the `console.log` that reports tile
coverage. Then replace the whole `const out = Buffer.alloc(...)` block through `return {...}` with:

```js
  return resampleInverse(level, z, mosaicSampler(mosaic, mosaicW, mosaicH, minX * 256, minY * 256));
```

- [ ] **Step 3: Verify it is a pure refactor**

Run: `node scripts/fetch-imagery.mjs`
Expected: it reads from `.cache/imagery/` so no network cost, and the emitted plates are
byte-identical to what is committed.

Confirm with: `git diff --stat public/imagery src/data/imagery-manifest.json`
Expected: **no output.** If any plate changed, the refactor is not pure — find the difference before
going on. A silent one-pixel shift here would move the whole photograph under the model.

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-imagery.mjs
git commit -m "Split the resampler from the tile mosaic, because a second source is coming"
```

---

### Task 3: NAIP as a source, applied to L3 only

L3 is 16,400 ft across at 8.01 ft/texel. NAIP at ~2 ft native is a 4x downsample, so this is the
level where NAIP is unambiguously correct and the smallest useful test of the whole path.

**Files:**
- Modify: `scripts/fetch-imagery.mjs`

- [ ] **Step 1: Add the NAIP fetch and sampler**

```js
const NAIP =
  "https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/exportImage";

/**
 * NAIP over a level's footprint, as a raw RGBA raster in Web Mercator pixels at zoom `z`.
 *
 * WHY NAIP AND NOT MASSGIS, WHICH IS THE WHOLE OF P10 PART A. Every MassGIS layer is flown
 * LEAF-OFF -- state orthos are, on purpose, because bare canopy is what planimetric mapping wants.
 * Measured over Weld at z19, mean green excess (G - (R+B)/2) per source: MassGIS 2025 +3.0,
 * orthos2023 +7.4, orthos2021 +3.9, USGS 2019 -1.5, DigitalGlobe 2011/12 +7.7. NAIP is +9.7 and
 * Esri World Imagery is +11.1. Those last two are the only leaf-on options, and Esri's basemap
 * terms do not allow caching derived plates into a repository. So: NAIP.
 *
 * NAIP is a work of the US Department of Agriculture, Farm Service Agency, and is in the public
 * domain. No permission is needed and no attribution is required; both are recorded anyway,
 * because this project records where things came from.
 *
 * REQUESTED IN EPSG:3857 ON THE LEVEL'S OWN MERCATOR WINDOW, so the raster that comes back is in
 * the same coordinate system the tile mosaic would have been and resampleInverse() cannot tell the
 * difference. That is the entire reason Task 2 split the resampler.
 */
async function naipRaster(level, z) {
  const half = level.extentFt / 2;
  const corners = [
    siteToLatLon(-half, half),
    siteToLatLon(half, half),
    siteToLatLon(-half, -half),
    siteToLatLon(half, -half),
  ];
  const mercs = corners.map((c) => merc(c.lat, c.lon, z));
  const minX = Math.floor(Math.min(...mercs.map((m) => m.x)));
  const maxX = Math.ceil(Math.max(...mercs.map((m) => m.x)));
  const minY = Math.floor(Math.min(...mercs.map((m) => m.y)));
  const maxY = Math.ceil(Math.max(...mercs.map((m) => m.y)));
  const W = maxX - minX;
  const H = maxY - minY;
  if (W > 4096 || H > 4096) throw new Error(`${level.id}: NAIP window ${W}x${H} exceeds 4096`);

  // Web Mercator pixel -> EPSG:3857 metres. The world is 256 * 2^z pixels across and
  // 2 * PI * R metres across, so one is a scale and an offset from the other.
  const SPAN = 2 * Math.PI * 6378137;
  const n = 256 * Math.pow(2, z);
  const toM = (px, py) => [(px / n) * SPAN - SPAN / 2, SPAN / 2 - (py / n) * SPAN];
  const [x0, y1] = toM(minX, minY);
  const [x1, y0] = toM(maxX, maxY);

  const bbox = [x0, y0, x1, y1].join(",");
  const url =
    `${NAIP}?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${W},${H}` +
    `&format=png&interpolation=RSP_BilinearInterpolation&f=image`;
  const buf = await cached(`naip-${level.id}-z${z}-${W}x${H}.png`, url);
  const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  console.log(`  ${level.id}: NAIP ${W}x${H} at z${z}`);
  return { data, width: W, height: H, originX: minX, originY: minY };
}
```

- [ ] **Step 2: Add a NAIP branch to `main()`'s level loop**

In `LEVELS`, change L3 to `{ id: "L3", source: "naip", extentFt: 16_400, px: [2048, 2048], zoom: 16 }`.

In `main()`, above the existing `} else {` that handles MassGIS, insert:

```js
    } else if (level.source === "naip") {
      const r = await naipRaster(level, level.zoom);
      raw = resampleInverse(
        level,
        level.zoom,
        mosaicSampler(r.data, r.width, r.height, r.originX, r.originY),
      );
      provenance = naipProvenance(level);
```

and add, near the other provenance builders:

```js
/**
 * NAIP's provenance block.
 *
 * NAIP_FLOWN and NAIP_NATIVE_FT come from the mosaic catalog and are pinned by
 * scripts/probe-naip.mjs (P10-EXTERIOR-PLAN Task 1). They are NOT the ImageServer's advertised
 * `pixelSizeX`, which is a mosaic default of 1 and says nothing about what was flown.
 */
function naipProvenance(level) {
  return {
    dataset: "USDA NAIP (National Agriculture Imagery Program), USDA_CONUS_PRIME mosaic",
    flown: NAIP_FLOWN,
    leafState: "leaf-on",
    nativeResolutionFt: NAIP_NATIVE_FT,
    sampledGridFt: +(level.extentFt / level.px[0]).toFixed(4),
    zoom: level.zoom,
    url: `${NAIP}?bbox={bbox}&bboxSR=3857&imageSR=3857&size={w},{h}&format=png&f=image`,
    licence:
      "Work of the US Department of Agriculture, Farm Service Agency. Public domain in the United States; no permission required and no attribution required.",
    attribution: ATTRIBUTION.naip,
    processing: [
      "EPSG:3857 (Web Mercator) request; grid north IS true north, so no convergence rotation is applied or needed",
      "per-output-pixel inverse mapping into the site frame, bilinear",
    ],
  };
}
```

Add to `ATTRIBUTION`: `naip: "USDA Farm Service Agency, National Agriculture Imagery Program"`.
Add the two constants near the top, with the figures Task 1 produced:

```js
// Pinned by scripts/probe-naip.mjs against the mosaic catalog. See P10-EXTERIOR-PLAN Task 1.
const NAIP_FLOWN = "<from Task 1>";
const NAIP_NATIVE_FT = <from Task 1>;
```

- [ ] **Step 3: Regenerate and measure**

Run: `node scripts/fetch-imagery.mjs`

Then run this check:

```bash
node -e "
const sharp=require('sharp');
(async()=>{
  const {data,info}=await sharp('public/imagery/l3.webp').raw().toBuffer({resolveWithObject:true});
  let sat=0,g=0,n=0;
  for(let i=0;i<data.length;i+=info.channels){
    const R=data[i],G=data[i+1],B=data[i+2];
    const mx=Math.max(R,G,B),mn=Math.min(R,G,B);
    sat+=mx?(mx-mn)/mx:0; g+=G-(R+B)/2; n++;
  }
  console.log('l3 meanSat',(sat/n).toFixed(3),'greenExcess',(g/n).toFixed(1));
})();"
```

Expected: `meanSat` rises from **0.077** to above **0.20**, and `greenExcess` becomes clearly
positive (the leaf-off plate measured +3.0 at tile level; expect roughly +8 or better here).
If `greenExcess` is near zero, NAIP is not being sampled where you think it is — check the bbox
before touching anything else.

- [ ] **Step 4: Verify the georeferencing did not move**

Run: `node scripts/georef-overlay.mjs`
Expected: it regenerates `design/renders/p9-georef-overlay.png`. **Open it.** All 36 `campus.json`
footprints must still land on the buildings in the photograph. A source swap that is off by a few
feet looks fine in every number and wrong in this one picture — `frames.ts:13-17` and
`tests/imagery.test.ts`'s header both make this point.

- [ ] **Step 5: Run the unit tests**

Run: `npm run test -- tests/imagery.test.ts`
Expected: PASS. This file asserts manifest shape, nesting extents and resolution claims, none of
which changed.

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-imagery.mjs public/imagery/l3.avif public/imagery/l3.webp src/data/imagery-manifest.json design/renders/p9-georef-overlay.png
git commit -m "L3 comes from NAIP, because every MassGIS layer is flown leaf-off"
```

---

### Task 4: Decide the L4 hybrid on one tile before building it

L4 outputs 0.52 ft/texel and fills the frame at stages 2 and 3. NAIP at ~2 ft would be a 3.8x
upsample there — blur exactly where you look hardest. MassGIS z20 is the only source with the
detail. So L4 takes detail from one and colour from the other.

**The risk this task exists to settle (P10-EXTERIOR.md §4, Q1):** MassGIS is leaf-off and NAIP is leaf-on. Under
a tree, MassGIS luma is a picture of pavement through bare branches while NAIP colour says green.
Combined naively that paints green onto footpaths.

**Files:**
- Create: `src/imagery/hybrid.ts`
- Create: `tests/hybrid.test.ts`
- Create: `scripts/probe-hybrid.mjs` (throwaway; deleted in Task 5)

- [ ] **Step 1: Write the failing test**

```ts
// tests/hybrid.test.ts
import { describe, it, expect } from "vitest";
import { vegetationMask, recombine, blur } from "@/imagery/hybrid";

const rgba = (r: number, g: number, b: number) => Uint8ClampedArray.from([r, g, b, 255]);

describe("vegetationMask", () => {
  it("is 1 for saturated green and 0 for grey", () => {
    const green = vegetationMask(rgba(60, 130, 55), 1, 1);
    const grey = vegetationMask(rgba(130, 130, 130), 1, 1);
    expect(green[0]).toBe(1);
    expect(grey[0]).toBe(0);
  });

  it("ramps between the thresholds rather than stepping", () => {
    // green excess = G - (R+B)/2. With T0=6 and T1=24, an excess of 15 sits at (15-6)/18 = 0.5.
    const mid = vegetationMask(rgba(100, 115, 100), 1, 1);
    expect(mid[0]).toBeCloseTo(0.5, 2);
  });
});

describe("recombine", () => {
  it("takes luma from the detail source where the mask is 0", () => {
    // Detail is black, colour source is mid-grey. Mask 0 => output luma is the detail's.
    const out = recombine(rgba(0, 0, 0), rgba(128, 128, 128), 0);
    expect(out[0]).toBeLessThan(8);
    expect(out[1]).toBeLessThan(8);
    expect(out[2]).toBeLessThan(8);
  });

  it("takes luma from the colour source where the mask is 1", () => {
    const out = recombine(rgba(0, 0, 0), rgba(128, 128, 128), 1);
    expect(out[0]).toBeCloseTo(128, -1);
  });

  it("always takes chroma from the colour source", () => {
    // Grey detail, green colour, mask 0: the result must be green, at the detail's brightness.
    const out = recombine(rgba(128, 128, 128), rgba(60, 130, 55), 0);
    expect(out[1]).toBeGreaterThan(out[0]);
    expect(out[1]).toBeGreaterThan(out[2]);
  });

  it("is the identity when both sources are the same pixel", () => {
    const p = rgba(90, 140, 70);
    const out = recombine(p, p, 0);
    for (let i = 0; i < 3; i++) expect(out[i]).toBeCloseTo(p[i]!, -1);
  });
});

describe("blur", () => {
  it("preserves a constant field", () => {
    const field = new Float32Array(64).fill(0.5);
    const out = blur(field, 8, 8, 2);
    for (const v of out) expect(v).toBeCloseTo(0.5, 5);
  });

  it("spreads an impulse without changing its total", () => {
    const field = new Float32Array(64);
    field[8 * 4 + 4] = 1;
    const out = blur(field, 8, 8, 1.5);
    const total = out.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 2);
    expect(out[8 * 4 + 4]!).toBeLessThan(1);
    expect(out[8 * 4 + 5]!).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -- tests/hybrid.test.ts`
Expected: FAIL — `Failed to resolve import "@/imagery/hybrid"`.

- [ ] **Step 3: Implement `src/imagery/hybrid.ts`**

```ts
/**
 * Luma from one photograph, colour from another.
 *
 * WHY THIS EXISTS. L4 is the plate that fills the frame at stages 2 and 3, at 0.52 ft/texel. The
 * only source with that detail over Cambridge is MassGIS's 2025 orthoimagery, and it is flown
 * LEAF-OFF: bare canopy, dormant turf, and measured mean saturation of 0.095 in the plate that
 * shipped. The only leaf-on sources this project may redistribute are NAIP (public domain) and
 * nothing else -- and NAIP is about 2 ft, which at L4's grid would be a 3.8x upsample.
 *
 * So the detail comes from the source that has detail and the colour from the source that has
 * colour. In aerial imagery chroma is low-frequency anyway -- a roof is one colour across its whole
 * span -- so borrowing it costs nothing that is visible.
 *
 * THE VEGETATION MASK IS NOT AN OPTIMISATION, IT IS THE WHOLE IDEA. Where there is canopy the two
 * photographs disagree about what is on the ground, not merely about its colour: the leaf-off plate
 * is a picture of pavement seen through bare branches. Painting NAIP's green onto that gives green
 * footpaths. So canopy takes BOTH its luma and its colour from the leaf-on plate, going soft in the
 * one place softness is invisible -- a tree crown has no hard edge to lose -- and everywhere else
 * keeps the 15 cm detail.
 *
 * THREE-FREE AND ALIAS-FREE. scripts/fetch-imagery.mjs imports this module directly, and Node's
 * TypeScript stripping resolves neither "three" nor the "@/" alias. tests/i3s.test.ts asserts the
 * same property for the other build-script module.
 */

/**
 * Green-excess thresholds for the vegetation mask, in 8-bit units of G - (R+B)/2.
 *
 * Tuned by eye on one 1,600 ft tile; see P10-EXTERIOR-PLAN Task 4 step 6 for the render these came from.
 * Below T0 nothing is treated as canopy; above T1 everything is.
 */
export const VEG_T0 = 6;
export const VEG_T1 = 24;

/** Rec. 709 luma, the same weights Ground.tsx's shader desaturates with. */
export function luma(p: ArrayLike<number>, o = 0): number {
  return 0.2126 * p[o]! + 0.7152 * p[o + 1]! + 0.0722 * p[o + 2]!;
}

/**
 * Per-pixel vegetation mask over a raw RGBA buffer, as a 0..1 field.
 *
 * Returns Float32Array of width*height so it can be blurred before use -- a hard mask edge would
 * cut a visible line across the middle of a tree.
 */
export function vegetationMask(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const k = i * 4;
    const excess = rgba[k + 1]! - (rgba[k]! + rgba[k + 2]!) / 2;
    out[i] = Math.min(1, Math.max(0, (excess - VEG_T0) / (VEG_T1 - VEG_T0)));
  }
  return out;
}

/**
 * Separable Gaussian blur over a scalar field, edges clamped.
 *
 * Separable because a 2D Gaussian is the product of two 1D ones, so an r-radius blur costs 2r
 * samples per pixel rather than r^2. At the sigmas here that is the difference between a second
 * and a minute over a 3072 x 3072 plate.
 */
export function blur(field: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma <= 0) return field.slice();
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp((-i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i]! /= sum;

  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r]! * field[y * width + clamp(x + i, width - 1)]!;
      tmp[y * width + x] = a;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r]! * tmp[clamp(y + i, height - 1) * width + x]!;
      out[y * width + x] = a;
    }
  }
  return out;
}

/**
 * One pixel: luma chosen by the mask, chroma always from the colour source.
 *
 * Works in YCbCr rather than by scaling RGB, because scaling RGB toward a target luma shifts the
 * hue of anything saturated -- a red roof rescaled to a darker luma goes brown. YCbCr moves
 * brightness without touching the colour difference channels, which is exactly the operation
 * wanted here and is why broadcast has used it for sixty years.
 */
export function recombine(
  detail: ArrayLike<number>,
  colour: ArrayLike<number>,
  mask: number,
  detailOffset = 0,
  colourOffset = 0,
): [number, number, number] {
  const yDetail = luma(detail, detailOffset);
  const yColour = luma(colour, colourOffset);
  const y = yDetail + (yColour - yDetail) * mask;

  const cr = colour[colourOffset]! - yColour;
  const cb = colour[colourOffset + 2]! - yColour;

  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const r = y + cr;
  const b = y + cb;
  // G falls out of the luma identity: y = 0.2126r + 0.7152g + 0.0722b.
  const g = (y - 0.2126 * r - 0.0722 * b) / 0.7152;
  return [clamp(r), clamp(g), clamp(b)];
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- tests/hybrid.test.ts`
Expected: PASS, all 7.

- [ ] **Step 5: Write the throwaway comparison probe**

```js
// scripts/probe-hybrid.mjs — throwaway. Answers P10-EXTERIOR.md §4 Q1 by eye. Delete after Task 5.
// Emits three 1,600 ft variants side by side so a human can choose.
import { writeFileSync, mkdirSync } from "node:fs";
import sharp from "sharp";
import { vegetationMask, blur, recombine } from "../src/imagery/hybrid.ts";

// Import the two rasters the way fetch-imagery.mjs builds them. Easiest route: temporarily export
// resampleMassGIS and naipRaster from fetch-imagery.mjs, or copy the L4 level literal here and call
// them. Whichever, BOTH must go through resampleInverse at the same level so they are co-registered
// by construction -- that is the property the whole hybrid rests on.
import { buildL4Sources } from "./fetch-imagery.mjs"; // add this named export temporarily

const OUT = "design/renders/p10-hybrid-trial";
mkdirSync(OUT, { recursive: true });

const { mass, naip, W, H, ftPerTexel } = await buildL4Sources();

const write = async (name, data) =>
  writeFileSync(
    `${OUT}/${name}.png`,
    await sharp(Buffer.from(data), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer(),
  );

await write("a-naip-only", naip);
await write("b-massgis-only", mass);

for (const [name, sigmaMask] of [["c-hybrid-masked", 4 / ftPerTexel], ["d-hybrid-naive", 0]]) {
  const veg = sigmaMask > 0 ? blur(vegetationMask(naip, W, H), W, H, sigmaMask) : new Float32Array(W * H);
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const [r, g, b] = recombine(mass, naip, veg[i]!, i * 4, i * 4);
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
  }
  await write(name, out);
}
console.log(`wrote four variants to ${OUT}`);
```

- [ ] **Step 6: Run it and LOOK AT THE OUTPUT**

Run: `node scripts/probe-hybrid.mjs`
Then open all four PNGs in `design/renders/p10-hybrid-trial/`.

**This is a human decision, not an assertion.** The question is only: does `c-hybrid-masked` beat
`a-naip-only`? Specifically —

- Are the Yard's footpaths still grey/buff, or have they gone green? Green paths mean the mask is
  too generous: raise `VEG_T0`.
- Do tree crowns read as trees, or as green smears with branch detail showing through? Smears mean
  the mask is too tight or the blur too small.
- Is Weld's slate roof sharp? It must be — that is the entire reason for not using NAIP alone.

Tune `VEG_T0`, `VEG_T1` and the blur sigma and re-run until it is right, then **write the chosen
figures into `hybrid.ts`'s constants along with a note saying they were chosen here**.

**If the masked hybrid does not beat NAIP-only, take NAIP-only for L4** and record the blur as a
known cost in the manifest. Do not ship a clever thing that looks worse. P10-EXTERIOR.md §10 has the third
fallback if both are bad.

- [ ] **Step 7: Commit the decision**

```bash
git add src/imagery/hybrid.ts tests/hybrid.test.ts design/renders/p10-hybrid-trial
git commit -m "Luma from the sharp plate, colour from the leaf-on one, and the trial that chose the mask"
```

---

### Task 5: Apply the choice to L4, move L2 to NAIP, regenerate the pyramid

**Files:**
- Modify: `scripts/fetch-imagery.mjs`
- Delete: `scripts/probe-naip.mjs`, `scripts/probe-hybrid.mjs`

- [ ] **Step 1: Set L2 and L4 in `LEVELS`**

```js
  { id: "L2", source: "naip", extentFt: 164_000, px: [2048, 2048], zoom: 13, ocean: true },
  { id: "L3", source: "naip", extentFt: 16_400, px: [2048, 2048], zoom: 16 },
  { id: "L4", source: "hybrid", extentFt: 1_600, px: [3072, 3072], zoom: 20, naipZoom: 18 },
```

`ocean: true` stays on L2 — NAIP is CONUS land only, so a 50 km frame centred on Cambridge still has
no data over Massachusetts Bay and the Blue Marble composite is still what fills it. `naipZoom: 18`
because requesting NAIP at z20 would ask the service for a 4x upsample of its own pixels; z18 is
0.58 m/px, closest to NAIP's native, and `resampleInverse` downsamples from there.

- [ ] **Step 2: Add the hybrid branch to `main()`**

```js
    } else if (level.source === "hybrid") {
      const mass = await resampleMassGIS(level);
      const nr = await naipRaster(level, level.naipZoom);
      const col = resampleInverse(
        level,
        level.naipZoom,
        mosaicSampler(nr.data, nr.width, nr.height, nr.originX, nr.originY),
      );
      raw = hybridise(mass, col, level);
      provenance = hybridProvenance(level);
```

and the two functions:

```js
/**
 * L4: MassGIS's detail wearing NAIP's colour. src/imagery/hybrid.ts carries the argument.
 *
 * The two rasters are co-registered BY CONSTRUCTION rather than by alignment: both have been
 * through resampleInverse() into the same output grid, so pixel i of each is the same point on
 * Earth. Nothing here searches for a match, and nothing here could.
 */
function hybridise(detail, colour, level) {
  const [W, H] = level.px;
  const ftPerTexel = level.extentFt / W;
  const veg = blur(vegetationMask(colour.data, W, H), W, H, VEG_BLUR_FT / ftPerTexel);
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const k = i * 4;
    const [r, g, b] = recombine(detail.data, colour.data, veg[i], k, k);
    out[k] = r;
    out[k + 1] = g;
    out[k + 2] = b;
    // Detail's alpha, because it is the one with coverage gaps at the edges of the MassGIS pyramid.
    out[k + 3] = detail.data[k + 3];
  }
  return { data: out, width: W, height: H };
}

/**
 * L4's provenance, which has to name BOTH parents.
 *
 * `nativeResolutionFt` describes the LUMINANCE only. Reading 0.492 here and concluding the colour
 * is also 15 cm would be wrong, so `composite` says so in words rather than leaving it to be
 * inferred from two numbers in different blocks.
 */
function hybridProvenance(level) {
  const m = massgisProvenance(level);
  return {
    ...m,
    composite: {
      luminance: "MassGIS 2025 Aerial Imagery, leaf-off, 0.492 ft native",
      chrominance: `USDA NAIP, leaf-on, ${NAIP_NATIVE_FT} ft native`,
      method:
        "Per-pixel YCbCr recombination. Chrominance is always NAIP's. Luminance is MassGIS's except " +
        "under vegetation, where a blurred green-excess mask takes luminance from NAIP too -- the " +
        "leaf-off plate shows the ground through bare canopy, so its detail there is detail of the " +
        "wrong subject. src/imagery/hybrid.ts carries the reasoning and the tuned thresholds.",
      resolutionCaveat:
        "nativeResolutionFt describes the luminance channel. The colour is NAIP's and is coarser.",
    },
    attribution: `${ATTRIBUTION.massgis} (detail); ${ATTRIBUTION.naip} (colour)`,
  };
}
```

Refactor the existing inline MassGIS provenance object in `main()` into a `massgisProvenance(level)`
function so `hybridProvenance` can extend it rather than restate it. Add at the top of the file:

```js
import { blur, recombine, vegetationMask } from "../src/imagery/hybrid.ts";

/** Vegetation-mask blur radius in site feet. Chosen in P10-EXTERIOR-PLAN Task 4 step 6. */
const VEG_BLUR_FT = 4;
```

- [ ] **Step 3: Regenerate**

Run: `node scripts/fetch-imagery.mjs`
Expected: all five levels emit. Note the printed byte counts.

- [ ] **Step 4: Verify size and colour**

```bash
du -sh public/imagery
node -e "
const sharp=require('sharp');
(async()=>{
 for (const f of ['l2','l3','l4']) {
  const {data,info}=await sharp('public/imagery/'+f+'.webp').raw().toBuffer({resolveWithObject:true});
  let sat=0,g=0,n=0;
  for(let i=0;i<data.length;i+=info.channels){
   const R=data[i],G=data[i+1],B=data[i+2];
   const mx=Math.max(R,G,B),mn=Math.min(R,G,B);
   sat+=mx?(mx-mn)/mx:0; g+=G-(R+B)/2; n++;
  }
  console.log(f,'meanSat',(sat/n).toFixed(3),'greenExcess',(g/n).toFixed(1));
 }
})();"
```

Expected: every one of l2/l3/l4 above **0.20** meanSat with clearly positive green excess, against
today's 0.138 / 0.077 / 0.095. Total `public/imagery` within ~10% of today's **5.7 MB**; if it has
grown more, drop AVIF quality from 55 to 50 before adding a level.

- [ ] **Step 5: Verify the georeferencing again, on the deepest plate**

Run: `node scripts/georef-overlay.mjs`
**Open `design/renders/p9-georef-overlay.png` and `p9-georef-weld.png`.** Footprints must land on
buildings. This is the only check that can catch a rotated or offset photograph.

- [ ] **Step 6: Delete the throwaways and run everything**

```bash
rm scripts/probe-naip.mjs scripts/probe-hybrid.mjs
```
Also remove the temporary `buildL4Sources` export from `fetch-imagery.mjs` that Task 4 step 5 added.

Run: `npm run test && npm run typecheck`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A public/imagery src/data/imagery-manifest.json scripts design/renders
git commit -m "The whole pyramid is leaf-on now, and L4 keeps its fifteen centimetres"
```

---

### Task 6: Tell the truth about where it came from

**Files:**
- Modify: `src/ui/ImageryChip.tsx`, `src/ui/Provenance.tsx`, `docs/SOURCES.md`
- Modify: `scripts/fetch-imagery.mjs` (header)

- [ ] **Step 1: Rewrite the chip**

`ImageryChip.tsx` currently renders `MassGIS orthoimagery · {year} · leaf-off`. Both the source and
the leaf state are now wrong. Replace the returned JSX with:

```tsx
  return (
    <div className="imagery-chip" data-testid="imagery-chip" aria-hidden="true">
      {stage === 0 ? (
        <>NASA Blue Marble · 2004</>
      ) : (
        <>USDA NAIP{year ? ` · ${year}` : ""} · MassGIS detail</>
      )}
    </div>
  );
```

and change the year lookup to read the colour source rather than the composite:

```tsx
  const flown = manifest.levels.L3?.provenance.flown;
```

- [ ] **Step 2: Rewrite the chip's header comment**

The current header's third paragraph explains a discrepancy that no longer exists in the same form —
it says "every tree in the Yard is bare". After this phase the trees are in leaf and the *new*
disclosure is that L4's colour and its detail come from different photographs flown in different
seasons. Rewrite that paragraph to say that instead. **Do not leave the old text; it would be
actively false.**

- [ ] **Step 3: Add the sources**

In `docs/SOURCES.md`, add USDA NAIP beside the existing MassGIS entry, with the licence string from
`naipProvenance()`, and add:

```
- **Harvard PPM public ArcGIS**, `Facilities3D_Facilities/SceneServer` — the 3D massing the campus is
  drawn from. Item `d371f09c273e417f907577d92004127b`, public. Untextured: every node's texture is a
  blank white plate (measured: channel means 251.3/251.3/251.3, stdev 7.8 across six nodes), so the
  masonry, slate and window openings this project draws on it are DERIVED FROM THE GEOMETRY and are
  not photographed. src/scene/CampusMesh.tsx carries the derivation.
```

- [ ] **Step 4: Update the Provenance panel**

Add NAIP and the Harvard 3D layer to `src/ui/Provenance.tsx` following the existing entries' shape.
Read the file first and match it; do not invent a new format.

- [ ] **Step 5: Rewrite `fetch-imagery.mjs`'s header**

The header block titled "WHY THE TILE SERVICE AND NOT THE JP2 ORTHOS" is still true and stays. Add a
new block above it, in the same register, explaining the P10 source change: the leaf-off measurement
table from P10-EXTERIOR.md §1.1, why Esri was rejected on licensing, and what the hybrid does. This file
calls itself "THE PROVENANCE" — it has to carry this.

- [ ] **Step 6: Verify in a browser**

```bash
npx next dev -p 3200
```
Navigate to `http://localhost:3200`, step to stages 0, 1 and 2, read the chip bottom-right.
Expected: stage 0 says Blue Marble; stages 1 and 2 say `USDA NAIP · <year> · MassGIS detail`.

Run: `npm run test:e2e -- tests/e2e/a11y.spec.ts`
Expected: PASS — the chip is `aria-hidden` and axe still has nothing to say.

- [ ] **Step 7: Commit**

```bash
git add src/ui docs/SOURCES.md scripts/fetch-imagery.mjs
git commit -m "Say where the colour came from, and that it is not the same photograph as the detail"
```

---

# PART B — the tint

### Task 7: Scale the tint ramp to 0.35

**Files:**
- Modify: `src/scene/Ground.tsx`
- Modify: `design-system/MASTER.md`

- [ ] **Step 1: Add the constant**

In `src/scene/Ground.tsx`, below `SAT_MIN`:

```ts
/**
 * How much of altitude.ts's tint ramp actually reaches the photograph.
 *
 * P10. The ramp itself still runs a clean 0 to 1 from 40,000 ft to 400 ft -- altitude.ts is
 * untouched and tests/altitude.test.ts still asserts yard.tint === 1 -- and this is the design
 * layer deciding how much of it to spend. Measured at the three stage altitudes the camera actually
 * sits at (window.__cam), before and after:
 *
 *   stage 1, 16,332 ft   tint 0.195   was 15% desaturated / 16% blue   now  5% / 5.6%
 *   stage 2,    815 ft   tint 0.846   was 63% / 69%                    now 22% / 24%
 *   stage 3,    110 ft   tint 1.000   was 75% / 82%                    now 26% / 29%
 *
 * SCALED, NOT CLAMPED, and the difference matters. A clamp at 0.35 would plateau around 8,000 ft
 * and the photograph would then stop changing for the last two stages of a descent whose whole
 * subject is continuous change. Scaling shortens the ramp's reach and keeps its shape.
 *
 * WHAT SURVIVES AT 0.35 IS NOT A WEAKENED CYANOTYPE, IT IS AERIAL HAZE. The campus is no longer
 * drawn as translucent blue massing over the photograph -- CampusMesh.tsx stands real brick and
 * slate on it -- so a residual quarter-strength blue is the distance cue that stops the ground
 * reading as a decal under the buildings. MASTER.md's photographic-layer table is amended to match.
 */
const TINT_SCALE = 0.35;
```

- [ ] **Step 2: Apply it**

In `Quad`'s `useFrame`, change the one line:

```ts
    mat.uniforms.uTint!.value = o.tint * TINT_SCALE;
```

- [ ] **Step 3: Amend MASTER.md**

In §"Token: the photographic layer", change the `tint ceiling` row from `0.82` to
`0.82 × 0.35 = 0.287` and add a row for the scale, with a sentence recording that P10 shortened the
ramp's reach because the campus stopped being a drawing. Also amend the P9 blockquote above it: the
sentence "by the time the camera reaches Weld it has been desaturated to 25% and pushed 82% of the
way to `--void`" is now false and must be restated with the P10 figures.

- [ ] **Step 4: Verify against the table**

```bash
npx next dev -p 3200
```

Then, in the browser console at each of stages 1, 2 and 3:
```js
window.__cam.position[1]
```
Expected: 16332, 815, 110 — unchanged, because nothing about the camera moved.

Take screenshots at all three stages. Compare against `design/renders/`'s existing plates: the ground
must be visibly greener and less blue at stages 1 and 2, and the buildings must be exactly as before
(Part C has not landed yet).

- [ ] **Step 5: Run the unit tests**

Run: `npm run test -- tests/altitude.test.ts`
Expected: PASS, including `expect(yard.tint).toBe(1)` — the ramp did not move, only what reads it.

- [ ] **Step 6: Commit**

```bash
git add src/scene/Ground.tsx design-system/MASTER.md
git commit -m "Spend a third of the tint ramp, not all of it"
```

---

# PART C — the buildings

### Task 8: Decode Harvard's I3S, as pure arithmetic

Everything in this task is maths over a byte buffer, so it is tested without a network or a renderer.
The numbers it is tested against were measured during diagnosis and are recorded in P10-EXTERIOR.md §1.3.

**Files:**
- Create: `src/scene/i3s.ts`, `tests/i3s.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/i3s.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeGeometry, decodeStrings, leafNodes, toSiteFeet, BUFFER_STRIDE } from "@/scene/i3s";

/**
 * A synthetic node buffer in geometryDefinitions[1]'s layout: 8-byte header, then
 * non-interleaved position/normal/uv0/color/uvRegion, then per-feature featureId and faceRange.
 */
function fixture(vertexCount: number, featureCount: number): Buffer {
  const b = Buffer.alloc(8 + vertexCount * BUFFER_STRIDE + featureCount * 16);
  b.writeUInt32LE(vertexCount, 0);
  b.writeUInt32LE(featureCount, 4);
  return b;
}

describe("the buffer layout is guarded", () => {
  it("accepts a buffer whose length matches the header", () => {
    expect(() => decodeGeometry(fixture(3, 1))).not.toThrow();
  });

  it("throws on a buffer whose length does not", () => {
    const b = fixture(3, 1).subarray(0, 40);
    expect(() => decodeGeometry(b)).toThrow(/length/i);
  });

  it("has a stride of 44 bytes per vertex", () => {
    // 12 position + 12 normal + 8 uv0 + 4 color + 8 uvRegion. This arithmetic is what proved the
    // layout during diagnosis: 8 + 960*44 + 1*16 = 42,264, which is exactly what the service
    // returned for Weld Hall.
    expect(BUFFER_STRIDE).toBe(44);
    expect(8 + 960 * BUFFER_STRIDE + 1 * 16).toBe(42_264);
  });
});

describe("leafNodes", () => {
  it("keeps meshes with no children and drops parents that also carry a mesh", () => {
    const nodes = [
      { index: 0, mesh: { geometry: { resource: 0, vertexCount: 9, featureCount: 1 } }, children: [1] },
      { index: 1, mesh: { geometry: { resource: 5, vertexCount: 9, featureCount: 1 } } },
      { index: 2, children: [] },
    ];
    // It is a MESH PYRAMID: parents carry a coarser copy of their children. Taking them would draw
    // every building twice.
    expect(leafNodes(nodes).map((n) => n.index)).toEqual([1]);
  });
});

describe("toSiteFeet", () => {
  const WELD = { lon: -71.1171195, lat: 42.3739244 };

  it("puts the origin at the origin", () => {
    const [x, y, z] = toSiteFeet([WELD.lon, WELD.lat, 0], WELD);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  it("treats z as metres and xy as degrees", () => {
    // 10 m of elevation is 32.808 ft. The mixed-unit convention is invisible if you assume
    // otherwise, which is why it is asserted.
    const [, , z] = toSiteFeet([WELD.lon, WELD.lat, 10], WELD);
    expect(z).toBeCloseTo(32.8084, 3);
  });

  it("puts north at +y and east at +x", () => {
    const [, north] = toSiteFeet([WELD.lon, WELD.lat + 0.001, 0], WELD);
    const [east] = toSiteFeet([WELD.lon + 0.001, WELD.lat, 0], WELD);
    expect(north).toBeGreaterThan(0);
    expect(east).toBeGreaterThan(0);
    // A degree of longitude at this latitude is shorter than a degree of latitude.
    expect(east).toBeLessThan(north);
  });
});

describe("decodeStrings", () => {
  it("reads I3S's length-prefixed UTF-8 attribute block", () => {
    const names = ["Weld Hall", "Grays Hall"];
    const encoded = names.map((n) => Buffer.from(n + "\0", "utf8"));
    const total = encoded.reduce((a, e) => a + e.length, 0);
    const b = Buffer.alloc(8 + names.length * 4 + total);
    b.writeUInt32LE(names.length, 0);
    b.writeUInt32LE(total, 4);
    let o = 8;
    for (const e of encoded) { b.writeUInt32LE(e.length, o); o += 4; }
    for (const e of encoded) { e.copy(b, o); o += e.length; }
    expect(decodeStrings(b)).toEqual(names);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -- tests/i3s.test.ts`
Expected: FAIL — `Failed to resolve import "@/scene/i3s"`.

- [ ] **Step 3: Implement `src/scene/i3s.ts`**

```ts
/**
 * Harvard's own 3D campus, decoded.
 *
 * WHAT THIS IS. `Facilities3D_Facilities` is an I3S 3D-object scene layer published by Harvard's
 * GIS group -- the same org this project already cites for the 2D footprints in campus.json, of
 * which this is the 3D parent. It carries real roof forms: gables, dormers, towers, the eaves line.
 * Node 13's OBB centre is -71.11712048, 42.37392690, which is Weld's origin in frames.ts to six
 * decimal places, and decoded into the site frame it stands 0.0 to 87.0 ft against campus.json's
 * height_ft of 87.01.
 *
 * WHAT IT IS NOT. It is UNTEXTURED. Six node textures were downloaded and measured during
 * diagnosis: every one is a blank white plate, channel means 251.3/251.3/251.3, stdev 7.8. There is
 * no photographic skin to take, so the materials CampusMesh.tsx draws are derived from this
 * geometry and are labelled as derived wherever they are described.
 *
 * THREE-FREE AND ALIAS-FREE, because scripts/fetch-buildings.mjs imports it directly and Node's
 * TypeScript stripping resolves neither "three" nor "@/". The same rule altitude.ts follows.
 */

/** Bytes per vertex in geometryDefinitions[1]: position 12, normal 12, uv0 8, color 4, uvRegion 8. */
export const BUFFER_STRIDE = 44;

/** Bytes per feature: featureId UInt64 (8) + faceRange UInt32x2 (8). */
export const FEATURE_STRIDE = 16;

export type NodeRef = {
  index: number;
  children?: number[];
  obb?: { center: [number, number, number]; halfSize: [number, number, number] };
  mesh?: { geometry: { resource: number; vertexCount: number; featureCount: number } };
};

export type DecodedGeometry = {
  vertexCount: number;
  featureCount: number;
  position: Float32Array;
  normal: Float32Array;
  /** [firstTriangle, triangleCount] per feature, as I3S stores it. */
  faceRange: Uint32Array;
};

/**
 * Leaves only.
 *
 * IT IS A MESH PYRAMID. 608 of the layer's 609 nodes carry a mesh and only 224 are leaves; the
 * other 384 are coarser copies of their own children. Drawing them all submits every building
 * three or four times over, which is a bug that looks like z-fighting rather than like a mistake.
 */
export function leafNodes(nodes: NodeRef[]): NodeRef[] {
  return nodes.filter((n) => n.mesh !== undefined && (n.children === undefined || n.children.length === 0));
}

/**
 * Decode one uncompressed geometry buffer.
 *
 * `geometries/0` and NOT `geometries/1`. The second is Draco, and taking the first means this
 * project needs no decoder -- verified served for every leaf in the extract.
 *
 * THE LENGTH CHECK IS THE POINT OF THIS FUNCTION AS MUCH AS THE DECODE IS. The layout was
 * established during diagnosis by exactly this arithmetic, and a service that changed its
 * geometryDefinition would otherwise decode into plausible garbage rather than fail.
 */
export function decodeGeometry(buf: Uint8Array): DecodedGeometry {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const vertexCount = dv.getUint32(0, true);
  const featureCount = dv.getUint32(4, true);
  const expected = 8 + vertexCount * BUFFER_STRIDE + featureCount * FEATURE_STRIDE;
  if (buf.byteLength !== expected) {
    throw new Error(
      `i3s: buffer length ${buf.byteLength} does not match header (${vertexCount} verts, ` +
        `${featureCount} features => ${expected}). The geometryDefinition has changed.`,
    );
  }

  // NON-INTERLEAVED: all positions, then all normals, then all uv0, then all colours, then all
  // uvRegions. Reading it as interleaved is the obvious mistake and produces a cloud of noise.
  let o = 8;
  const position = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount * 3; i++) position[i] = dv.getFloat32(o + i * 4, true);
  o += vertexCount * 12;
  const normal = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount * 3; i++) normal[i] = dv.getFloat32(o + i * 4, true);
  o += vertexCount * 12;
  o += vertexCount * 8; // uv0 — unused: the textures are blank
  o += vertexCount * 4; // color — unused: uniformly white
  o += vertexCount * 8; // uvRegion — unused, same reason

  o += featureCount * 8; // featureId
  const faceRange = new Uint32Array(featureCount * 2);
  for (let i = 0; i < featureCount * 2; i++) faceRange[i] = dv.getUint32(o + i * 4, true);

  return { vertexCount, featureCount, position, normal, faceRange };
}

/** I3S's length-prefixed UTF-8 string attribute block: count, byteCount, lengths[], bytes[]. */
export function decodeStrings(buf: Uint8Array): string[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = dv.getUint32(0, true);
  let o = 8;
  const lengths: number[] = [];
  for (let i = 0; i < count; i++) {
    lengths.push(dv.getUint32(o, true));
    o += 4;
  }
  const dec = new TextDecoder();
  const out: string[] = [];
  for (const len of lengths) {
    out.push(dec.decode(buf.subarray(o, o + len)).replace(/\0+$/, ""));
    o += len;
  }
  return out;
}

/**
 * Feet per degree, COPIED FROM src/geo/frames.ts and guarded by the caller.
 *
 * scripts/fetch-buildings.mjs runs assertFramesAgree() against frames.ts's own source text, the
 * same way fetch-imagery.mjs does, because a drifted origin would move the whole campus under the
 * photograph and nothing would look obviously broken -- the buildings would simply be in the wrong
 * place.
 */
const FEET_PER_DEGREE_LAT = 111_320 * 3.280839895;
const FEET_PER_METRE = 3.280839895;

/**
 * One I3S vertex to site feet.
 *
 * THE UNITS ARE MIXED AND THAT IS THE TRAP. `lonlatZ` is [degrees east, degrees north, METRES up]
 * — the layer's spatial reference is WKID 4326 so the horizontal is angular, while elevation is
 * linear. Treating all three as degrees gives a building 230 ft wide instead of 143, which is
 * exactly the wrong answer this got during diagnosis before the units were checked.
 *
 * Flat-plate, using the same constants and the same small-angle assumption frames.ts and
 * fetch-imagery.mjs already use. Over the Yard's 1,269 ft extent that is well inside a foot.
 */
export function toSiteFeet(
  lonlatZ: [number, number, number],
  origin: { lon: number; lat: number },
): [number, number, number] {
  const feetPerDegreeLon = FEET_PER_DEGREE_LAT * Math.cos((origin.lat * Math.PI) / 180);
  return [
    (lonlatZ[0] - origin.lon) * feetPerDegreeLon,
    (lonlatZ[1] - origin.lat) * FEET_PER_DEGREE_LAT,
    lonlatZ[2] * FEET_PER_METRE,
  ];
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- tests/i3s.test.ts`
Expected: PASS, all 8.

- [ ] **Step 5: Assert the module stays three-free**

`tests/place.test.ts` already walks the import graph to prove `altitude.ts` reaches no renderer
package. Read it, and add `src/scene/i3s.ts` and `src/imagery/hybrid.ts` to whatever list it drives.

Run: `npm run test -- tests/place.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scene/i3s.ts tests/i3s.test.ts tests/place.test.ts
git commit -m "Decode Harvard's I3S, and guard the byte layout that proved it"
```

---

### Task 9: A GLB writer

three-stdlib's `GLTFLoader` reads GLB; nothing in the project writes it. A minimal container writer
is ~80 lines and avoids a devDependency for a file this project generates once.

**Files:**
- Create: `src/scene/glb.ts`
- Modify: `tests/i3s.test.ts`

- [ ] **Step 1: Write the failing test** (append to `tests/i3s.test.ts`)

```ts
import { writeGlb } from "@/scene/glb";

describe("writeGlb", () => {
  const mesh = {
    position: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normal: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    materialClass: Uint8Array.from([0, 1, 2]),
    index: Uint32Array.from([0, 1, 2]),
  };

  it("emits a valid glTF 2.0 binary header", () => {
    const glb = writeGlb(mesh);
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x46546c67); // "glTF"
    expect(dv.getUint32(4, true)).toBe(2);
    expect(dv.getUint32(8, true)).toBe(glb.byteLength);
  });

  it("pads both chunks to four bytes, as the spec requires", () => {
    const glb = writeGlb(mesh);
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    const jsonLen = dv.getUint32(12, true);
    expect(jsonLen % 4).toBe(0);
    const binLen = dv.getUint32(12 + 8 + jsonLen, true);
    expect(binLen % 4).toBe(0);
  });

  it("declares accessor counts that match the arrays it was given", () => {
    const glb = writeGlb(mesh);
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
    expect(json.accessors[0].count).toBe(3);
    expect(json.accessors[json.meshes[0].primitives[0].indices].count).toBe(3);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test -- tests/i3s.test.ts`
Expected: FAIL — cannot resolve `@/scene/glb`.

- [ ] **Step 3: Implement `src/scene/glb.ts`**

```ts
/**
 * A minimal glTF 2.0 binary writer.
 *
 * WHY HAND-WRITTEN. This project generates exactly one GLB, at build time, from one script, and it
 * needs four attributes and no materials, animations, skins or scenes worth the name. A writer
 * library would be a devDependency carrying a hundred features for the one this uses. The reader
 * side is already covered -- three-stdlib's GLTFLoader is a dependency.
 *
 * THREE-FREE AND ALIAS-FREE, for the reason i3s.ts's header gives.
 *
 * _MATCLASS is a custom vertex attribute. glTF requires application-specific semantics to be
 * underscore-prefixed, and GLTFLoader passes them through onto the BufferGeometry under that exact
 * name, which is what CampusMesh.tsx's shader reads.
 */

export type GlbMesh = {
  position: Float32Array;
  normal: Float32Array;
  /** 0 wall, 1 roof, 2 base, 3 trim. See CampusMesh.tsx. */
  materialClass: Uint8Array;
  index: Uint32Array;
};

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const pad4 = (n: number) => (n + 3) & ~3;

function bounds(a: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = a[i + c]!;
      if (v < min[c]!) min[c] = v;
      if (v > max[c]!) max[c] = v;
    }
  }
  return { min, max };
}

export function writeGlb(mesh: GlbMesh): Uint8Array {
  const count = mesh.position.length / 3;
  if (mesh.normal.length !== mesh.position.length) throw new Error("glb: normal/position length mismatch");
  if (mesh.materialClass.length !== count) throw new Error("glb: materialClass length mismatch");

  // Every buffer view must start on a multiple of its component size; f32 is 4, so pad each.
  const parts: { data: Uint8Array; byteLength: number }[] = [
    { data: new Uint8Array(mesh.position.buffer, mesh.position.byteOffset, mesh.position.byteLength), byteLength: mesh.position.byteLength },
    { data: new Uint8Array(mesh.normal.buffer, mesh.normal.byteOffset, mesh.normal.byteLength), byteLength: mesh.normal.byteLength },
    { data: mesh.materialClass, byteLength: mesh.materialClass.byteLength },
    { data: new Uint8Array(mesh.index.buffer, mesh.index.byteOffset, mesh.index.byteLength), byteLength: mesh.index.byteLength },
  ];

  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let offset = 0;
  for (const p of parts) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: p.byteLength });
    offset = pad4(offset + p.byteLength);
  }
  const binLength = offset;

  const bb = bounds(mesh.position);
  const json = {
    asset: { version: "2.0", generator: "weld15 scripts/fetch-buildings.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, _MATCLASS: 2 }, indices: 3 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: "VEC3", min: bb.min, max: bb.max },
      { bufferView: 1, componentType: 5126, count, type: "VEC3" },
      { bufferView: 2, componentType: 5121, count, type: "SCALAR" },
      { bufferView: 3, componentType: 5125, count: mesh.index.length, type: "SCALAR" },
    ],
    bufferViews: views,
    buffers: [{ byteLength: binLength }],
  };

  // JSON chunk padded with SPACES and BIN with ZEROS, which is what the spec says and what several
  // loaders check.
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonLength + 8 + binLength;

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLength, true);
  dv.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);

  const binStart = 20 + jsonLength;
  dv.setUint32(binStart, binLength, true);
  dv.setUint32(binStart + 4, CHUNK_BIN, true);
  let o = binStart + 8;
  for (const p of parts) {
    out.set(p.data, o);
    o = binStart + 8 + pad4(o - (binStart + 8) + p.byteLength);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test -- tests/i3s.test.ts`
Expected: PASS, all 11.

- [ ] **Step 5: Commit**

```bash
git add src/scene/glb.ts tests/i3s.test.ts
git commit -m "Write GLB by hand, because one generated file is not worth a dependency"
```

---

### Task 10: The extractor

**Files:**
- Create: `scripts/fetch-buildings.mjs`
- Create (emitted): `public/models/campus.glb`, `src/data/buildings-manifest.json`

- [ ] **Step 1: Write the script**

```js
/**
 * Build public/models/campus.glb from Harvard's own 3D scene layer.
 *
 * THIS SCRIPT IS THE PROVENANCE, in the same sense scripts/fetch-imagery.mjs is: everything
 * committed under public/models/ is a derived work and what it was derived from has to be readable
 * here rather than remembered.
 *
 * Run: node scripts/fetch-buildings.mjs
 * Downloads are cached in .cache/buildings/ (git-ignored).
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT HARVARD PUBLISHES, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------------------------
 * Facilities3D_Facilities is an I3S 3D-object scene layer, item d371f09c273e417f907577d92004127b,
 * public. It is the 3D parent of the footprint layer docs/SOURCES.md already cites. 609 nodes, 608
 * with a mesh, 224 leaves. Real roof forms.
 *
 * IT HAS NO TEXTURES. Six node textures were downloaded during P10 diagnosis and every one is a
 * blank white plate: channel means 251.3/251.3/251.3, stdev 7.8. So this script does not fetch
 * textures, does not decode uv0 or uvRegion, and the materials the app draws are DERIVED from the
 * geometry -- see classify() below and CampusMesh.tsx. That is disclosed in the manifest, in
 * docs/SOURCES.md and on screen, because a project that records the resampling kernel of a
 * photograph does not get to quietly invent windows.
 *
 * WELD IS EXTRACTED AND THEN DROPPED, ON PURPOSE. src/scene/weldGeometry.ts is parametric -- the
 * dimension sliders reshape it, the four cutaway modes cut it, the threshold sweeps it, and its
 * window bays are derived from the interior suite's own perimeter so the gable bay the camera flies
 * through is the opening bedroom B actually has. A static mesh cannot do any of that. But Harvard's
 * Weld is the best possible CHECK on this whole coordinate pipeline, because campus.json states its
 * height independently: 87.01 ft. So it is decoded, compared, and then discarded. assertWeld()
 * below is the most valuable function in this file.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { decodeGeometry, decodeStrings, leafNodes, toSiteFeet } from "../src/scene/i3s.ts";
import { writeGlb } from "../src/scene/glb.ts";
import campus from "../src/data/campus.json" with { type: "json" };

const LAYER =
  "https://services6.arcgis.com/xj2fNQwUFCYCWY8a/arcgis/rest/services/Facilities3D_Facilities/SceneServer/layers/0";
const CACHE = ".cache/buildings";
const WELD = { lat: 42.3739244, lon: -71.1171195 };
const WELD_NAME = "Weld Hall";

/** How far outside campus.json's own footprint bbox to take buildings, in feet. */
const MARGIN_FT = 200;

/** Material classes. Must match CampusMesh.tsx's MATCLASS. */
const CLASS = { wall: 0, roof: 1, base: 2, trim: 3 };

/** Below this height everything is the granite water table, ft. */
const BASE_FT = 3;

/** A face counts as roof if its normal points up by more than this. */
const ROOF_NORMAL_Y = 0.5;

/** Half-height of the sandstone belt at the eaves break, ft. */
const TRIM_BAND_FT = 2;

// Guard the copied origin, exactly as fetch-imagery.mjs does and for the same reason.
function assertFramesAgree() {
  const src = readFileSync("src/geo/frames.ts", "utf8");
  const lat = Number(/lat:\s*([\d.-]+)/.exec(src)?.[1]);
  const lon = Number(/lon:\s*([\d.-]+)/.exec(src)?.[1]);
  if (lat !== WELD.lat || lon !== WELD.lon) {
    throw new Error(`origin drift: frames.ts has ${lat},${lon}, this script has ${WELD.lat},${WELD.lon}`);
  }
  console.log(`frames.ts agrees: origin ${lat}, ${lon}`);
}

async function cached(name, url) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, name);
  if (existsSync(path)) return readFileSync(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return buf;
}

async function allNodes() {
  const out = [];
  for (let p = 0; ; p++) {
    const res = await fetch(`${LAYER}/nodepages/${p}?f=json`);
    if (!res.ok) break;
    const j = await res.json();
    if (!j.nodes?.length) break;
    out.push(...j.nodes);
  }
  return out;
}

/** campus.json's own footprint bbox, in site feet, plus MARGIN_FT. */
function campusBox() {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of campus.buildings) {
    for (const [x, y] of b.ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX: minX - MARGIN_FT, maxX: maxX + MARGIN_FT, minY: minY - MARGIN_FT, maxY: maxY + MARGIN_FT };
}

/**
 * One building's vertices, in site feet, plus its per-vertex material class.
 *
 * THE EAVES BREAK IS DERIVED PER BUILDING and is not a constant. It is the highest point that still
 * has vertical faces around it: above that the building is roof. For Weld the vertex histogram puts
 * it at 60 ft, which is where campus data independently says Weld's eaves are, and five floors at
 * 12 ft is exactly 60. Deriving it means a flat-roofed neighbour gets no spurious gable trim.
 */
function classify(verts, normals) {
  let eaves = 0;
  for (let i = 0; i < verts.length / 3; i++) {
    if (Math.abs(normals[i * 3 + 2]) < ROOF_NORMAL_Y) eaves = Math.max(eaves, verts[i * 3 + 2]);
  }
  const out = new Uint8Array(verts.length / 3);
  for (let i = 0; i < out.length; i++) {
    const z = verts[i * 3 + 2];
    const up = normals[i * 3 + 2];
    if (z < BASE_FT) out[i] = CLASS.base;
    else if (up > ROOF_NORMAL_Y && z > eaves - TRIM_BAND_FT) out[i] = CLASS.roof;
    else if (Math.abs(z - eaves) < TRIM_BAND_FT) out[i] = CLASS.trim;
    else out[i] = CLASS.wall;
  }
  return { matclass: out, eaves };
}

/**
 * The check that proves the whole coordinate pipeline.
 *
 * campus.json states Weld's height independently of this service: 87.01 ft. Diagnosis measured the
 * decoded mesh at 0.0 to 87.0. If the degree/metre transform, the origin, or the OBB convention
 * were wrong, this is where it shows -- and it shows as a number rather than as a campus that is
 * subtly in the wrong place.
 */
function assertWeld(verts) {
  let maxZ = -Infinity, minZ = Infinity, sx = 0, sy = 0;
  const n = verts.length / 3;
  for (let i = 0; i < n; i++) {
    maxZ = Math.max(maxZ, verts[i * 3 + 2]);
    minZ = Math.min(minZ, verts[i * 3 + 2]);
    sx += verts[i * 3];
    sy += verts[i * 3 + 1];
  }
  const stated = campus.buildings.find((b) => b.name === WELD_NAME)?.height_ft;
  const height = maxZ - minZ;
  const cx = sx / n, cy = sy / n;
  console.log(`  Weld check: height ${height.toFixed(2)} ft vs campus.json ${stated}; centroid ${cx.toFixed(1)}, ${cy.toFixed(1)}`);
  if (Math.abs(height - stated) > 1) {
    throw new Error(`Weld height ${height.toFixed(2)} ft disagrees with campus.json's ${stated} by more than 1 ft`);
  }
  if (Math.hypot(cx, cy) > 5) {
    throw new Error(`Weld centroid is ${Math.hypot(cx, cy).toFixed(1)} ft from the origin; expected under 5`);
  }
  if (Math.abs(minZ) > 1) throw new Error(`Weld's base is at ${minZ.toFixed(2)} ft, not grade`);
}

async function main() {
  assertFramesAgree();
  const nodes = await allNodes();
  const leaves = leafNodes(nodes);
  console.log(`${nodes.length} nodes, ${leaves.length} leaves`);

  const box = campusBox();
  const inBox = leaves.filter((n) => {
    const [x, y] = toSiteFeet([n.obb.center[0], n.obb.center[1], 0], WELD);
    return x > box.minX && x < box.maxX && y > box.minY && y < box.maxY;
  });
  console.log(`${inBox.length} leaves inside campus.json's bbox + ${MARGIN_FT} ft`);

  const position = [], normal = [], matclass = [], index = [];
  const buildings = [];
  const shas = [];
  let weldSeen = false;

  for (const node of inBox) {
    const res = node.mesh.geometry.resource;
    const gbuf = await cached(`geom-${res}.bin`, `${LAYER}/nodes/${res}/geometries/0`);
    const nbuf = await cached(`name-${res}.bin`, `${LAYER}/nodes/${res}/attributes/f_1/0`);
    shas.push({ resource: res, geometry: createHash("sha256").update(gbuf).digest("hex") });

    const g = decodeGeometry(gbuf);
    const names = decodeStrings(nbuf);
    if (names.length !== g.featureCount) {
      throw new Error(`resource ${res}: ${names.length} names for ${g.featureCount} features`);
    }

    // The whole node's vertices, transformed once.
    const c = node.obb.center;
    const world = new Float32Array(g.vertexCount * 3);
    for (let i = 0; i < g.vertexCount; i++) {
      const [x, y, z] = toSiteFeet(
        [c[0] + g.position[i * 3], c[1] + g.position[i * 3 + 1], c[2] + g.position[i * 3 + 2]],
        WELD,
      );
      world[i * 3] = x;
      world[i * 3 + 1] = y;
      world[i * 3 + 2] = z;
    }

    // Split by faceRange. I3S geometry is a triangle soup in vertex order, so feature f owns
    // vertices [first*3, (first+count)*3).
    for (let f = 0; f < g.featureCount; f++) {
      const first = g.faceRange[f * 2];
      const tris = g.faceRange[f * 2 + 1] - first + 1;
      const v0 = first * 3;
      const vn = tris * 3;
      const verts = world.subarray(v0 * 3, (v0 + vn) * 3);
      const norms = g.normal.subarray(v0 * 3, (v0 + vn) * 3);
      const name = names[f];

      if (name === WELD_NAME) {
        assertWeld(verts);
        weldSeen = true;
        continue; // see the header: Weld stays parametric
      }

      const { matclass: mc, eaves } = classify(verts, norms);
      const base = position.length / 3;
      for (let i = 0; i < vn; i++) {
        // Site feet (x east, y north, z up) to three.js world (x east, y up, z south).
        // place.ts owns this convention: world -z is NORTH.
        position.push(verts[i * 3], verts[i * 3 + 2], -verts[i * 3 + 1]);
        normal.push(norms[i * 3], norms[i * 3 + 2], -norms[i * 3 + 1]);
        matclass.push(mc[i]);
        index.push(base + i);
      }
      let maxZ = 0;
      for (let i = 0; i < vn; i++) maxZ = Math.max(maxZ, verts[i * 3 + 2]);
      buildings.push({ name, resource: res, feature: f, heightFt: +maxZ.toFixed(2), eavesFt: +eaves.toFixed(2), vertices: vn });
    }
  }

  if (!weldSeen) throw new Error("Weld Hall was not in the extract; the cross-check did not run");

  const glb = writeGlb({
    position: Float32Array.from(position),
    normal: Float32Array.from(normal),
    materialClass: Uint8Array.from(matclass),
    index: Uint32Array.from(index),
  });
  mkdirSync("public/models", { recursive: true });
  writeFileSync("public/models/campus.glb", glb);
  console.log(`\npublic/models/campus.glb  ${(glb.length / 1024 / 1024).toFixed(2)} MB, ${buildings.length} buildings, ${position.length / 3} vertices`);

  // Names in campus.json that this extract did not produce, and vice versa. Printed, not swallowed.
  const got = new Set(buildings.map((b) => b.name));
  const want = new Set(campus.buildings.map((b) => b.name).filter((n) => n !== WELD_NAME));
  const missing = [...want].filter((n) => !got.has(n));
  const extra = [...got].filter((n) => !want.has(n));
  if (missing.length) console.log(`\nin campus.json but not in the 3D layer: ${missing.join(", ")}`);
  if (extra.length) console.log(`\nin the 3D layer but not in campus.json: ${extra.join(", ")}`);

  writeFileSync(
    "src/data/buildings-manifest.json",
    JSON.stringify(
      {
        generatedBy: "scripts/fetch-buildings.mjs",
        origin: WELD,
        frame: "three.js world feet, x east, y up, z south, origin at Weld Hall's centroid (src/geo/frames.ts)",
        file: "/models/campus.glb",
        bytes: glb.length,
        buildings,
        excluded: {
          "Weld Hall":
            "Drawn by src/scene/weldGeometry.ts instead, which is parametric: the dimension sliders, " +
            "the four cutaway modes, the threshold sweep and the window bays that align with the " +
            "interior suite all run through it. Harvard's mesh is still decoded on every run as a " +
            "cross-check of this script's coordinate transform, then discarded.",
        },
        provenance: {
          dataset: "Harvard PPM, Facilities3D_Facilities (I3S 3D object scene layer)",
          item: "d371f09c273e417f907577d92004127b",
          url: LAYER,
          access: "public",
          geometry: "uncompressed PerAttributeArray buffers (geometries/0); no Draco decoder needed",
          sourceSha256: shas,
        },
        derived: {
          what: "materialClass, per vertex: 0 wall, 1 roof, 2 base, 3 trim. And the window grid CampusMesh.tsx draws on wall faces.",
          why: "Harvard's layer is untextured -- every node texture is a blank white plate, measured at channel means 251.3/251.3/251.3, stdev 7.8.",
          how: `roof = normal.y > ${ROOF_NORMAL_Y} above the per-building eaves break; base = below ${BASE_FT} ft; trim = within ${TRIM_BAND_FT} ft of the eaves break; wall = the rest. The eaves break is the highest vertex that still has a vertical face.`,
          notMeasured:
            "No source in this project gives the materials, the courses or the window positions of any building other than Weld. These are a plausible reading of the massing, not a record of it.",
        },
      },
      null,
      2,
    ) + "\n",
  );
  console.log("wrote src/data/buildings-manifest.json");
}

await main();
```

- [ ] **Step 2: Add the cache to .gitignore**

Append `.cache/` if it is not already there. Check first: `grep -n "cache" .gitignore`

- [ ] **Step 3: Run it**

Run: `node scripts/fetch-buildings.mjs`

Expected output shape:
```
frames.ts agrees: origin 42.3739244, -71.1171195
609 nodes, 224 leaves
30 leaves inside campus.json's bbox + 200 ft
  Weld check: height 87.0x ft vs campus.json 87.01; centroid x.x, y.y

public/models/campus.glb  1.1x MB, 61 buildings, 4xxxx vertices
```

**The Weld check is the gate.** If it throws, the coordinate transform is wrong and nothing
downstream is worth doing. The likely causes, in order: `geometries/0` vs the resource id (node index
is not resource index — node 13's resource is 12), the degree/metre mixed units, or an OBB
convention this plan got wrong.

- [ ] **Step 4: Sanity-check the emitted GLB**

```bash
node -e "
const { readFileSync } = require('node:fs');
const b = readFileSync('public/models/campus.glb');
const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
console.log('magic ok', dv.getUint32(0,true) === 0x46546c67, 'bytes', b.length);
const jl = dv.getUint32(12,true);
const j = JSON.parse(new TextDecoder().decode(b.subarray(20, 20+jl)));
console.log('accessors', j.accessors.map(a=>a.type+':'+a.count).join(' '));
console.log('bbox', j.accessors[0].min, j.accessors[0].max);
"
```

Expected: `magic ok true`; bbox roughly x −750..800, y 0..200, z −820..850 in three.js world feet
(x east, y up, z south). **If y is not roughly 0..200, the axis swap in the extractor is wrong** —
buildings would be lying on their side.

- [ ] **Step 5: Write the manifest test**

```ts
// tests/buildings.test.ts
import { describe, it, expect } from "vitest";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import campus from "@/data/campus.json";
import manifest from "@/data/buildings-manifest.json";

describe("the buildings manifest describes what shipped", () => {
  it("points at a GLB that exists and matches the recorded size", () => {
    const p = join(process.cwd(), "public", "models", "campus.glb");
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBe(manifest.bytes);
  });

  it("excludes Weld, and says why", () => {
    expect(manifest.buildings.some((b) => b.name === "Weld Hall")).toBe(false);
    expect(manifest.excluded["Weld Hall"]).toMatch(/parametric/);
  });

  it("discloses that the materials are derived rather than photographed", () => {
    expect(manifest.derived.why).toMatch(/untextured/);
    expect(manifest.derived.notMeasured).toBeTruthy();
  });

  it("stands every building on grade and none of them taller than Memorial Church", () => {
    for (const b of manifest.buildings) {
      expect(b.heightFt, b.name).toBeGreaterThan(5);
      expect(b.heightFt, b.name).toBeLessThan(250);
    }
  });

  it("covers the buildings campus.json already knew about", () => {
    const got = new Set(manifest.buildings.map((b) => b.name));
    const want = campus.buildings.map((b) => b.name).filter((n) => n !== "Weld Hall");
    // Not every campus.json name has to appear -- the 3D layer splits some and may lack others --
    // but most must, or the bbox filter is wrong.
    const hit = want.filter((n) => got.has(n)).length;
    expect(hit / want.length).toBeGreaterThan(0.6);
  });
});
```

- [ ] **Step 6: Run it**

Run: `npm run test -- tests/buildings.test.ts`
Expected: PASS. If the last one fails, read the script's "in campus.json but not in the 3D layer"
line — the names may differ in wording rather than the buildings being absent, in which case relax
the assertion to a count rather than a name match and note why.

- [ ] **Step 7: Commit**

```bash
git add scripts/fetch-buildings.mjs public/models/campus.glb src/data/buildings-manifest.json tests/buildings.test.ts .gitignore
git commit -m "Take Harvard's own 3D campus, and let Weld's 87 feet prove the transform"
```

---

### Task 11: Draw it, flat, over the existing campus

Mount the mesh with one plain material and check it lands on the footprints **before** adding
materials. Georeferencing errors are invisible under a good-looking shader.

**Files:**
- Create: `src/scene/CampusMesh.tsx`
- Modify: `src/scene/Campus.tsx`

- [ ] **Step 1: Write `CampusMesh.tsx` with a flat material**

```tsx
"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three-stdlib";
import manifest from "@/data/buildings-manifest.json";

/**
 * Harvard's campus, as Harvard models it.
 *
 * LOADED IMPERATIVELY AND NOT WITH useGLTF, and src/scene/imagery.ts's header is the reason: R3F
 * wraps <Canvas>'s children in a Suspense whose fallback throws, so a scene child that suspends
 * suspends the CANVAS, up to the "LOADING WELD 15" screen outside it. P8 measured that at 2.5 s of
 * the whole UI disappearing and coming back. A 1.1 MB GLB is exactly the thing that warning was
 * written for. So: a loader in an effect, and nothing rendered until it arrives.
 *
 * NOTHING IS DRAWN WHILE IT LOADS. Not a placeholder, not a wireframe. The ground is already
 * underneath at every altitude this is mounted at, so an empty frame is a frame with a photograph
 * in it rather than a hole.
 */
export function CampusMesh({ visible }: { visible: boolean }) {
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let live = true;
    let loaded: THREE.BufferGeometry | null = null;
    new GLTFLoader().load(manifest.file, (gltf) => {
      const mesh = gltf.scene.getObjectByProperty("type", "Mesh") as THREE.Mesh | undefined;
      if (!mesh) return;
      loaded = mesh.geometry;
      if (!live) {
        loaded.dispose();
        return;
      }
      setGeo(loaded);
    });
    return () => {
      live = false;
      loaded?.dispose();
    };
  }, []);

  if (!geo) return null;

  return (
    <mesh geometry={geo} visible={visible}>
      <meshStandardMaterial color="#b06a4a" roughness={0.9} metalness={0} />
    </mesh>
  );
}
```

- [ ] **Step 2: Mount it beside the existing campus, temporarily**

In `src/scene/Campus.tsx`, inside the returned `<group>`, above the two mass meshes:

```tsx
      <CampusMesh visible={visible} />
```

with `import { CampusMesh } from "./CampusMesh";` at the top. **Leave the blue masses in place for
this step** — seeing both at once is the check.

- [ ] **Step 3: Look at it**

```bash
npx next dev -p 3200
```

Go to stage 2. Expected: solid brown-ish buildings standing **exactly inside** the blue wireframe
boxes, with roofs rising above their flat tops. The wireframes are `campus.json`'s footprints and the
solids are Harvard's 3D layer; if they agree, the transform is right.

**Failure modes and what they mean:**
- Solids offset from the wireframes → origin or degree/metre error in `toSiteFeet`.
- Solids mirrored north-for-south → the `-verts[i*3+1]` axis swap in the extractor.
- Solids lying flat → the y/z swap.
- Solids at the right place but ten times too big → a feet/metres slip.

- [ ] **Step 4: Capture the overlay as evidence**

Screenshot stage 2 and save it to `design/renders/p10-campus-overlay.png`. **This is the
georeferencing gate and it is visual** — the same argument `tests/imagery.test.ts`'s header makes
about the photograph. Commit the image.

- [ ] **Step 5: Check the draw calls**

In the browser console at stages 1, 2, 3:
```js
window.__perf
```
Expected: `calls` has gone up by 1 from today's 24 / 28 / 28 → 25 / 29 / 29. Still under the gate's
34. (Task 12 removes four and takes it below where it started.)

- [ ] **Step 6: Commit**

```bash
git add src/scene/CampusMesh.tsx src/scene/Campus.tsx design/renders/p10-campus-overlay.png
git commit -m "Stand Harvard's campus on the photograph, flat, and prove it lands where it should"
```

---

### Task 12: Materials, and retire the cyanotype massing

**Files:**
- Modify: `src/scene/materials.ts`, `src/scene/CampusMesh.tsx`, `src/scene/Campus.tsx`

- [ ] **Step 1: Export the masonry palette from `materials.ts`**

`BRICK` and `SLATE` are module-private consts today. Weld and its neighbours must not end up
different shades of brick, so there is one source. Below the existing `SLATE`:

```ts
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
```

- [ ] **Step 2: Replace CampusMesh's material with the classified shader**

Replace the `<meshStandardMaterial>` in `CampusMesh.tsx` and add above the component:

```tsx
import { MASONRY } from "./materials";
import { SCAN } from "./materials";
import { layerOpacity } from "./altitude";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";

/** Must match scripts/fetch-buildings.mjs's CLASS. */
const MATCLASS = { wall: 0, roof: 1, base: 2, trim: 3 } as const;

/** Nominal storey height, ft. The same 12 ft weldGeometry derives Weld's five floors from. */
const FLOOR_FT = 12;

/** Turn the window grid off if it reads as wallpaper rather than as windows. */
const WINDOWS = true;

const CAMPUS_VERT = /* glsl */ `
  attribute float _MATCLASS;
  varying float vClass;
  varying vec3 vWorld;
  varying vec3 vNormal2;
  void main() {
    vClass = _MATCLASS;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal2 = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

/**
 * Colour by class, add a window grid on walls, then blend the whole thing out of the scan palette
 * by altitude.
 *
 * THE SCAN BLEND IS WHY THIS IS ONE SHADER AND NOT FOUR MATERIALS. At 40,000 ft these buildings are
 * a few pixels each and the cyanotype is the right drawing; by stage 3 they are the subject and
 * brick is. layerOpacity().massing is the same ramp Campus.tsx's mass fill already climbed, so the
 * crossing happens at the altitude the design system already chose rather than at a new one.
 *
 * THE WINDOW GRID IS DERIVED AND IS NOT A RECORD OF ANYTHING. No source in this project gives the
 * fenestration of any building but Weld. It is a 12 ft storey rhythm on vertical faces, which is a
 * plausible reading of a 19th-century Yard dormitory and nothing more. buildings-manifest.json's
 * `derived` block says so, and WINDOWS above turns it off.
 */
const CAMPUS_FRAG = /* glsl */ `
  uniform vec3 uBrick;
  uniform vec3 uSlate;
  uniform vec3 uGranite;
  uniform vec3 uSandstone;
  uniform vec3 uScan;
  uniform float uReal;      // 0 = scan massing, 1 = masonry
  uniform float uWindows;
  varying float vClass;
  varying vec3 vWorld;
  varying vec3 vNormal2;

  void main() {
    vec3 base =
        vClass < 0.5 ? uBrick
      : vClass < 1.5 ? uSlate
      : vClass < 2.5 ? uGranite
      : uSandstone;

    // Windows: a storey rhythm in y, and a bay rhythm along whichever horizontal axis the wall
    // faces across. Only on walls, and only where the face is vertical.
    if (uWindows > 0.5 && vClass < 0.5) {
      float across = abs(vNormal2.x) > abs(vNormal2.z) ? vWorld.z : vWorld.x;
      float sy = fract((vWorld.y - 4.0) / ${FLOOR_FT}.0);
      float sx = fract(across / 10.0);
      float win = step(0.18, sy) * step(sy, 0.68) * step(0.30, sx) * step(sx, 0.70);
      base = mix(base, uSlate * 0.55, win * 0.85);
    }

    // Lambert against a fixed key, so this needs no lights and stays one draw call. Lighting.tsx's
    // sun drives the interior; out here the buildings are seen from above and a full PBR pass buys
    // nothing a gradient does not.
    float lambert = 0.45 + 0.55 * clamp(dot(normalize(vNormal2), normalize(vec3(0.4, 0.85, 0.3))), 0.0, 1.0);
    vec3 lit = base * lambert;

    gl_FragColor = vec4(mix(uScan, lit, uReal), 1.0);
  }
`;
```

and inside the component, replacing the `<mesh>` return:

```tsx
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uBrick: { value: new THREE.Color(MASONRY.brick) },
      uSlate: { value: new THREE.Color(MASONRY.slate) },
      uGranite: { value: new THREE.Color(MASONRY.granite) },
      uSandstone: { value: new THREE.Color(MASONRY.sandstone) },
      uScan: { value: new THREE.Color(SCAN.line) },
      uReal: { value: 0 },
      uWindows: { value: WINDOWS ? 1 : 0 },
    }),
    [],
  );

  useFrame(({ camera }) => {
    const mat = material.current;
    if (!mat) return;
    // The same band Campus.tsx's mass fill climbed. One ramp, one crossing.
    mat.uniforms.uReal!.value = layerOpacity(camera.position.y).massing;
  });

  if (!geo) return null;

  return (
    <mesh geometry={geo} visible={visible} castShadow={false} receiveShadow={false}>
      <shaderMaterial
        ref={material}
        vertexShader={CAMPUS_VERT}
        fragmentShader={CAMPUS_FRAG}
        uniforms={uniforms}
      />
    </mesh>
  );
```

- [ ] **Step 3: Retire Campus.tsx's mass fills and the non-Weld edge line**

In `src/scene/Campus.tsx`:
- Delete the two `<mesh geometry={geo.others}>` and `<mesh geometry={geo.weld}>` blocks and the
  `otherMass` / `weldMass` refs and their `useFrame` writes.
- Delete the `<Line points={edgePoints} ...>` for the other buildings.
- **Keep** the Weld `<Line points={weldEdgePoints}>` and the `<Html>` chip. They are Weld's
  highlight, which MASTER.md requires to be three signals and never hue alone, and Weld's white
  outline over its own brick still reads.
- **Keep `massAt()`, its constants, and the whole `window.__campus` effect exactly as they are.**
  `tests/e2e/contrast.spec.ts` asserts `massOpacity` 0.12/0.22, `massCeiling`, `lineWidth` and
  `weldLineWidth` off that probe, and `tests/labels.test.ts` asserts the derived gain. The ramp is
  still live — `CampusMesh` reads the same `layerOpacity().massing` band — so the probe still
  describes something real.
- Replace the retired code with a note in the same style as the existing `gridHelper` note, saying
  what came out and why. That comment convention is this file's, and it is load-bearing.

- [ ] **Step 4: Add a note to `campusGeometry.ts`**

`buildCampusGeometry()` now has two dead return fields (`others`, `otherEdges`). Do **not** delete
the function — `tests/campusGeometry.test.ts` covers it and `weldEdges` is still drawn. Trim the
unused fields, update the test, and add a header note recording that the merged masses were retired
when Harvard's real geometry arrived.

- [ ] **Step 5: Look at it**

```bash
npx next dev -p 3200
```

Stages 1, 2, 3. Expected: at stage 1 the campus is still blue massing (correct — a few pixels each).
By stage 2 it has crossed to brick and slate. At stage 3 the neighbours are brick buildings with
slate roofs on a green photograph, and Weld is still blue (Task 14 fixes that).

Judge the window grid here. If it reads as wallpaper, set `WINDOWS = false` and record the decision
in the shader header. **That is a legitimate outcome, not a failure.**

- [ ] **Step 6: Check the draw calls against the ledger**

```js
window.__perf
```
Expected per P10-EXTERIOR.md §6.6: 24/28/28 minus 4 (two masses, one line) plus 1 (the GLB) = **21 / 25 / 25**.
Triangles roughly double, to ~33,000.

- [ ] **Step 7: Run the tests**

Run: `npm run test`
Expected: PASS. `contrast.spec` is e2e and comes in Task 15.

- [ ] **Step 8: Commit**

```bash
git add src/scene/CampusMesh.tsx src/scene/Campus.tsx src/scene/campusGeometry.ts src/scene/materials.ts tests/campusGeometry.test.ts
git commit -m "Brick, slate, granite and sandstone, derived from the massing that had none"
```

---

### Task 13: Weld wears its brick from stage 3

Today `WeldExterior` derives seam progress from `1 − opacity`, which is 0 for all of stages 2 and 3,
so Weld only becomes brick during stage 4's slider. That is the complaint. Decouple the palette from
the dissolve.

**Files:**
- Modify: `src/scene/WeldExterior.tsx`, `src/scene/Experience.tsx`

- [ ] **Step 1: Add the prop**

In `WeldExterior`'s signature add `palette,` and to its type:

```tsx
  /**
   * How far across the scan-to-masonry seam the shell is, 0..1, INDEPENDENT OF THE DISSOLVE.
   *
   * P10 split this from `opacity`. It used to be `1 - opacity` outright, which tied "is Weld brick
   * yet" to "is Weld fading yet" and meant the building could not be brick while it was still
   * solid -- so it stayed cyanotype through the whole of stages 2 and 3 and only crossed during
   * stage 4's slider. Once CampusMesh.tsx stood real brick neighbours around it at stage 2, Weld
   * was the one blue building on a street of red ones.
   *
   * Defaulted to `1 - opacity` so the old behaviour is what a call site that does not pass it
   * still gets, which keeps every existing test of this component honest.
   */
  palette?: number;
```

- [ ] **Step 2: Use it**

```tsx
  const progress = 1 - opacity;
  const seam = palette ?? progress;
```

Pass `seam` to `useShellPalette` in place of `progress` — **only** for the seam. The dissolve's own
`progress`, the `reduced` branch and `<Threshold progress={progress} …>` are unchanged: the sweep is
still the dissolve, and only the recolour has moved.

```tsx
  const pal = useShellPalette(shell, seam, reduced);
```

- [ ] **Step 3: Compute it in Experience**

In `src/scene/Experience.tsx`, above the return:

```tsx
  /**
   * Weld is masonry from stage 2 onward, which is where its neighbours are.
   *
   * CampusMesh crosses out of the scan palette on layerOpacity().massing, which is fully over well
   * before stage 2's 815 ft. Weld crossing later would leave one blue building in a brick Yard, so
   * it crosses on the stage instead of on the altitude -- the shell is mounted from stage 2 and
   * that is exactly when it should already be brick.
   */
  const weldPalette = stage >= 2 ? 1 : 0;
```

and pass it: `<WeldExterior visible={vis.weld} opacity={shell} palette={weldPalette} />`

- [ ] **Step 4: Look at all four stages and all four cutaways**

```bash
npx next dev -p 3200
```

- Stage 2: Weld is brick with a slate roof, among brick neighbours, with its white highlight outline
  and its label chip still on.
- Stage 3: same, closer. **This is the shot the complaint was about.**
- Stage 4, slider at 0: brick gable, not blue.
- Stage 4, slider swept 0 → 1: the shell still dissolves and the interior still comes up behind it.
- Stage 3, each of the four cutaway modes: all four still cut.
- Reduced motion on, stage 4: still a jump cut, no partial-opacity frames.

- [ ] **Step 5: Run the threshold e2e**

Run: `npm run test:e2e -- tests/e2e/threshold.spec.ts`
Expected: PASS. If it asserts a colour at a given `t`, it is measuring the seam it was written for
and now needs the P10 figures — rebuild it with a measurement, do not delete the assertion.

- [ ] **Step 6: Commit**

```bash
git add src/scene/WeldExterior.tsx src/scene/Experience.tsx
git commit -m "Weld is brick when its neighbours are, not four stages later"
```

---

# PART D — reconcile

### Task 14: Rebuild the gates that this phase invalidated

Three e2e gates are **expected** to fail. Each is a real measurement. **Rebuild each from a fresh
measurement; do not widen a tolerance.**

**Files:**
- Modify: `tests/e2e/campus.spec.ts`, `tests/e2e/imagery.spec.ts`, `tests/e2e/perf.spec.ts`

- [ ] **Step 1: Run the whole e2e suite and record what actually breaks**

Run: `npm run test:e2e`
Write down every failure. Do not fix anything yet — the list is the input to the next steps, and
fixing them one at a time hides the ones that share a cause.

- [ ] **Step 2: Rebuild campus.spec.ts's near-neutral threshold**

The test counts bright near-neutral pixels to find Weld's white line work. Its header records that
P9 raised the threshold from 205 to 236 because leaf-off imagery is full of bright neutral pixels.
This phase made the photograph **brighter, greener and less tinted**, so that population has moved.

Reproduce the header's own table on the new build — count near-neutral pixels at thresholds 205,
225, 235, 245, 250 at stage 1 (no highlight) and stage 2 (highlight on) — and pick the threshold that
**separates the two populations completely**, exactly as 236 did. Replace the table in the header
with the new one and say it was re-measured in P10 and why.

**If no threshold separates them**, the discriminator has to change: a leaf-on photograph is
markedly *less* neutral than a leaf-off one, so tightening `b - r < 40` toward `< 12` is the natural
next move. Record whichever you do, with the numbers.

- [ ] **Step 3: Rebuild imagery.spec.ts's tint magnitudes**

Its comments cite "a 19% effect at the first and 85% at the second". Both are now wrong. Replace with
the measured figures from `Ground.tsx`'s `TINT_SCALE` header: 5.6% at stage 1, 24% at stage 2.

- [ ] **Step 4: Re-record the perf baseline**

Run `npm run test:e2e -- tests/e2e/perf.spec.ts`, take the new numbers, and write them in with a note
that triangles roughly doubled because the campus stopped being 36 extruded footprints and started
being Harvard's own 49,000-vertex model, while draw calls **fell** from 28 to 25.

- [ ] **Step 5: Add the regression test for the original complaint**

This is the test that would catch a future source swap silently going grey again. Add to
`tests/e2e/imagery.spec.ts`:

```ts
test("the ground is in colour at the stages the viewer looks at it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });

  for (const stage of [1, 2]) {
    await page.getByTestId(`stage-${stage}`).click();
    await page.waitForTimeout(2400);

    /**
     * Mean saturation over the frame, excluding the HUD.
     *
     * P10 EXISTS BECAUSE THIS WAS 0.077. The plates were MassGIS 2025, flown leaf-off in March, and
     * between the bare canopy and Ground.tsx's tint ramp the Yard arrived on screen grey. The floor
     * below is deliberately well under what the leaf-on build measures, because this is a guard
     * against the photograph going grey again -- not a pin on a particular plate.
     */
    const sat = await page.evaluate(() => { /* sample the canvas, skip the HUD's bounding boxes */ });
    expect(sat, `stage ${stage} mean saturation`).toBeGreaterThan(0.12);
  }
});
```

Fill the `page.evaluate` body by copying the canvas-sampling helper `campus.spec.ts` already uses;
do not write a second one. Then run it, read the real numbers, and set the floor to roughly **half**
the measured value so it guards without pinning.

- [ ] **Step 6: Run the full e2e suite**

Run: `npm run test:e2e`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e
git commit -m "Re-measure the three gates this phase moved, and add the one that would have caught it"
```

---

### Task 15: Verify everything and refresh the record

- [ ] **Step 1: The full suite**

```bash
npm run typecheck && npm run test && npm run test:e2e && npm run build
```
Expected: all four clean. **Per this repo's rule, do not report done from inspection — paste the
output.**

- [ ] **Step 2: Refresh the stage renders**

Run `node scripts/capture.mjs` (read it first for the port it expects) and refresh
`design/renders/`'s stage plates. The old ones show a grey photograph and blue boxes and would
misrepresent the build.

- [ ] **Step 3: Update `docs/CHECKLIST.md`**

Add a P10 section recording: the measured saturation before and after; the tint figures before and
after; the draw-call ledger 28 → 25; the triangle count; the GLB's size; the Weld cross-check's
actual numbers; the answers to Q1 and Q2; and anything that turned out differently from this plan.
**The divergences are the valuable part** — `docs/phases/P9.md`'s "record every divergence from the
spec" commit is the precedent.

- [ ] **Step 4: Accessibility and contrast**

Run: `npm run test:e2e -- tests/e2e/a11y.spec.ts tests/e2e/contrast.spec.ts`
Expected: PASS. In particular the high-contrast toggle must still put `massOpacity` on MASTER's 0.22
through `window.__campus`, and Weld's highlight must still be three signals — its white outline is
now the brightest thing on a brick building rather than on a blue one, so **look at it under the
high-contrast toggle** and not only at the number.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "P10: the ground is in colour and the buildings are the buildings"
```

- [ ] **Step 6: Report, do not merge**

Summarise for the user: what landed, the before/after measurements, the answers to Q1 and Q2, and
anything that diverged. **Do not merge to `main` and do not push** — three sibling worktrees are
live and merging is the user's call. `docs/phases/P10-EXTERIOR.md` §11 has the worktree list.

---

## Self-review against the spec

| P10-EXTERIOR.md section | covered by |
|---|---|
| §5.1 pyramid table | Tasks 3, 5 |
| §5.2 why NAIP for L2/L3 not L4 | Task 3 step 1 header, Task 5 step 1 |
| §5.3 the hybrid | Task 4 (`src/imagery/hybrid.ts`), Task 5 step 2 |
| §5.4 provenance | Tasks 5 step 2, 6 |
| §6.2 extraction | Tasks 8, 9, 10 |
| §6.3 derived materials | Task 10 `classify()`, Task 12 shader, both disclosed |
| §6.4 tint | Task 7 |
| §6.5 Weld keeps its geometry, gets materials early | Task 10 (excluded + cross-check), Task 13 |
| §6.6 draw-call budget | Task 11 step 5, Task 12 step 6 |
| §9 gates | Task 14 |
| §4 Q1 | Task 4 step 6 — an explicit human decision point |
| §4 Q2 | Task 7 step 4, Task 12 step 5 |
| §4 A2 NAIP resolution | Task 1, which is allowed to stop the phase |

**Known thin spots, stated rather than hidden:**

- Task 4 step 5's `buildL4Sources` export is a temporary seam in `fetch-imagery.mjs` for the
  throwaway probe. Task 5 step 6 removes it. If it survives into a commit, that is a mistake.
- Task 14 step 5's `page.evaluate` body is deliberately left to be copied from the existing helper
  rather than written twice. That is the one place this plan does not paste code, and it is because
  pasting it would duplicate a helper the repo already has.
- The window-grid shader's bay spacing (10 ft) is a guess with no source, unlike the 12 ft storey
  which `weldGeometry` derives. If Task 12 step 5 finds it reads badly, `WINDOWS = false` is the
  supported answer and is not a failure.
