/**
 * Build the imagery pyramid in public/imagery/ from public sources.
 *
 * THIS SCRIPT IS THE PROVENANCE. Everything committed under public/imagery/ is a derived work,
 * and what it was derived from -- which URL, which day, which projection, which resampling --
 * has to be readable here rather than remembered. docs/SOURCES.md carries the prose version;
 * this is the executable one, and manifest.json is what it emits for the app to read.
 *
 * Run: node scripts/fetch-imagery.mjs
 * Downloads are cached in .cache/imagery/ (git-ignored), so a re-run is cheap and a re-encode
 * costs no bandwidth.
 *
 * ------------------------------------------------------------------------------------------
 * WHY P10 STOPPED USING MASSGIS ALONE, AND WHY IT DID NOT SWITCH TO ESRI INSTEAD
 * ------------------------------------------------------------------------------------------
 *
 * Every MassGIS aerial layer -- not just the 2025 flight P9 used, every one of them -- is flown
 * LEAF-OFF. That is not an accident of scheduling: state orthophotography is flown in early
 * spring on purpose, because bare canopy is what planimetric mapping wants. It is the wrong
 * thing for a model whose default instant is a September afternoon and whose trees, before
 * P10, were bare under a summer sun for no reason a viewer could see without opening this file.
 *
 * Measured directly rather than assumed: mean "green excess" (G - (R+B)/2) over Weld at zoom
 * 19, per source --
 *
 *   MassGIS 2025            +3.0
 *   MassGIS orthos2023      +7.4
 *   MassGIS orthos2021      +3.9
 *   USGS 2019               -1.5
 *   DigitalGlobe 2011/12    +7.7
 *   USDA NAIP               +9.7
 *   Esri World Imagery      +11.1
 *
 * Every MassGIS vintage clusters low; NAIP and Esri are the only two leaf-on options this
 * project could use at all, and they are well clear of the rest. Esri measures higher still,
 * and was rejected anyway: its basemap terms do not permit caching derived plates into a
 * repository, which is exactly what this script does to every level. NAIP has no such
 * restriction -- it is a work of the USDA Farm Service Agency, public domain, no permission or
 * attribution legally required -- so NAIP is what L2 and L3 now source from directly.
 *
 * L4 is not that simple, because NAIP's ~1 ft native resolution (see NAIP_NATIVE_FT) is not
 * enough to hold Weld's roofline at the 1,600 ft frame's density, and MassGIS's 2025 flight,
 * despite being leaf-off, is still the sharpest thing this project can legally cache at 0.492 ft
 * native. So L4 is a hybrid, not a straight swap: MassGIS supplies luminance/detail, NAIP
 * supplies chrominance/colour, recombined per pixel in YCbCr space (see hybridise() and
 * naipProvenance()/massgisProvenance()/hybridProvenance() below). A flat recombination would
 * still show MassGIS's bare canopy wherever there is a tree, because the leaf-off plate is
 * looking at different ground than the leaf-on one is -- not just different-coloured ground, a
 * different scene, since a leaf-off flight sees soil and roots where a leaf-on flight sees
 * leaves. So the blend is masked: under a blurred, green-excess-based vegetation mask, NAIP
 * supplies both luminance and colour instead of just colour, and MassGIS's detail is used only
 * where the two photographs are actually looking at the same thing. `src/imagery/hybrid.ts`
 * carries the mask math and the tuning story that arrived at it. The result is two real
 * photographs, flown two years apart in different seasons, blended into one plate -- which is
 * why `src/ui/ImageryChip.tsx` names both of them rather than one.
 *
 * ------------------------------------------------------------------------------------------
 * WHY THE TILE SERVICE AND NOT THE JP2 ORTHOS -- A DELIBERATE DEPARTURE FROM P9.md SECTION 6.3
 * ------------------------------------------------------------------------------------------
 *
 * The plan specifies per-tile JP2 downloads from MassGIS's S3 bucket, which are EPSG:6348 --
 * NAD83(2011) UTM zone 19N. It then requires every derived level to be rotated by +1.4269
 * degrees during resampling, because UTM grid north is not true north: the convergence
 * gamma = (lambda - lambda_0) * sin(phi) is -1.4269 degrees at Weld, which over the Yard's
 * 1,269 ft extent is 31.6 ft of corner-to-corner misalignment against campus.json. P9.md's own
 * risk table puts that at "high" likelihood and describes it as invisible in code.
 *
 * This script uses MassGIS's cached tile service instead, which serves the same imagery in
 * EPSG:3857 -- Web Mercator. Web Mercator's grid north IS true north everywhere: it is a
 * normal-aspect cylindrical projection, so meridians are vertical lines and the convergence
 * term is identically zero. The 1.4269 degree rotation is therefore not "applied carefully",
 * it does not exist, and the highest-likelihood risk in the phase is removed rather than
 * mitigated. The projection still needs handling -- Mercator stretches latitude by 1/cos(phi)
 * -- but that is a per-pixel scalar in a formula, not an angle that silently rotates a city.
 *
 * The cost of the departure, stated honestly:
 *   - The tiles are 8-bit RGB, not the 4-band (RGB + NIR) originals. Nothing here wants NIR.
 *   - They are a resampled pyramid rather than the native raster. z20 is 0.362 ft/px, which is
 *     FINER than the 15 cm (0.492 ft) the imagery was actually flown at, so the extra grid
 *     density is interpolation and not information. The manifest records the native figure as
 *     the resolution and the grid as the grid, because claiming 0.362 ft would be claiming
 *     detail that was never captured.
 *   - z21 returns 404, so z20 is the floor.
 *
 * The licence is the same either way: MassGIS 2025 Aerial Imagery, "No restrictions apply to
 * these data... Acknowledgement of MassGIS would be appreciated for products derived from
 * these data." The 2015 WorldView layer is the one that may NOT be redistributed, and the
 * OpenStreetMap wiki's warning to that effect is about that layer and not this one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { blur, recombine, vegetationMask } from "../src/imagery/hybrid.ts";

const CACHE = ".cache/imagery";
const OUT = "public/imagery";

/** Vegetation-mask blur radius in site feet. See src/imagery/hybrid.ts's VEG_T0/VEG_T1 doc comment
 * for the full retuning story — this pairs with those thresholds and must not be changed alone. */
const VEG_BLUR_FT = 8;

const DEG = Math.PI / 180;

// Weld's origin and the site frame's scale, COPIED FROM src/geo/frames.ts rather than imported.
// A plain-node script cannot resolve the "@/" alias, and frames.ts is a TypeScript module; the
// alternative is a build step for a script that runs by hand. Copied constants need a guard, so
// there is one: assertFramesAgree() below re-derives these from frames.ts's own source text and
// throws if they have drifted.
const WELD = { lat: 42.3739244, lon: -71.1171195 };
const FEET_PER_DEGREE_LAT = 111_320 * 3.280839895;
const FEET_PER_DEGREE_LON = FEET_PER_DEGREE_LAT * Math.cos(WELD.lat * DEG);

const MASSGIS_TILES =
  "https://tiles.arcgis.com/tiles/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Aerial_Imagery_2025/MapServer/tile";

const BMNG =
  "https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/august/world.topo.bathy.200408.3x21600x10800.jpg";

const NAIP =
  "https://gis.apfo.usda.gov/arcgis/rest/services/NAIP/USDA_CONUS_PRIME/ImageServer/exportImage";

// Pinned by scripts/probe-naip.mjs against the mosaic catalog. See P10-EXTERIOR-PLAN Task 1.
const NAIP_FLOWN = "2023-07-07";
// Same probe, same pin: 0.3 metres native GSD, expressed in feet -- this file's other resolution
// figures (e.g. sampledGridFt below) are all in feet, hence the non-integer literal.
const NAIP_NATIVE_FT = 0.3 * 3.280839895;

const ATTRIBUTION = {
  bmng: "NASA Earth Observatory / Blue Marble Next Generation",
  massgis:
    "MassGIS (Bureau of Geographic Information), Commonwealth of Massachusetts EOTSS",
  naip: "USDA Farm Service Agency, National Agriculture Imagery Program",
};

/**
 * The pyramid.
 *
 * `extentFt` is the full width of the quad in site feet, centred on Weld. Each level is 10x the
 * last, so each is a factor of 10 sharper over its own footprint -- that is what makes a
 * four-quad stack cover five decades of altitude with four draw calls.
 *
 * `px` is the output grid. `zoom` is the Web Mercator level the samples come from, chosen as the
 * shallowest zoom whose native resolution still beats the output grid, so every level is a
 * DOWNSAMPLE of real pixels rather than an upsample of fewer.
 */
const LEVELS = [
  {
    // The whole Earth, for the globe at stage 0. Equirectangular 2:1, which is exactly what a
    // three.js SphereGeometry's default UV mapping wants -- u from the prime meridian, v from
    // the south pole -- so it needs no remapping in the shader.
    //
    // 4096 x 2048 AND NOT 8192 x 4096. The globe subtends at most a 758 px disc on a 720 px
    // viewport, so across the visible hemisphere 4096 gives about 2.7 source texels per screen
    // pixel. Doubling it would add roughly 1.5 MB for detail that is already past the point
    // where L1 has taken over.
    id: "L0",
    source: "bmng",
    global: true,
    px: [4096, 2048],
  },
  {
    id: "L1",
    source: "bmng",
    extentFt: 3_280_000, // 1,000 km
    px: [2048, 1524],
  },
  // tileGrid: 3 -- see naipRasterTiled()'s header comment. L2's 50 km footprint intersects
  // ~79 NAIP source scenes, and the ImageServer refuses to mosaic more than
  // maxMosaicImageCount (50, queried live) into one exportImage response; the ~29 scenes past
  // the cap simply come back as no-data. A single request is fine at L3/L4's tighter windows,
  // which intersect far fewer source scenes, so this flag is L2-only.
  { id: "L2", source: "naip", extentFt: 164_000, px: [2048, 2048], zoom: 13, ocean: true, tileGrid: 3 },
  { id: "L3", source: "naip", extentFt: 16_400, px: [2048, 2048], zoom: 16 },
  { id: "L4", source: "hybrid", extentFt: 1_600, px: [3072, 3072], zoom: 20, naipZoom: 18 },
];

/** Web Mercator pixel coordinates at a zoom, 256 px tiles. */
const merc = (lat, lon, z) => {
  const n = 256 * Math.pow(2, z);
  const s = Math.sin(lat * DEG);
  return {
    x: ((lon + 180) / 360) * n,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n,
  };
};

const siteToLatLon = (x, y) => ({
  lat: WELD.lat + y / FEET_PER_DEGREE_LAT,
  lon: WELD.lon + x / FEET_PER_DEGREE_LON,
});

/**
 * Check the constants above still match src/geo/frames.ts.
 *
 * The whole pipeline is a coordinate conversion, so a drifted origin would move the entire
 * photograph under the model and nothing would look obviously broken -- the Yard would simply be
 * in the wrong place. Cheap to check, so it is checked.
 */
function assertFramesAgree() {
  const src = readFileSync("src/geo/frames.ts", "utf8");
  const lat = Number(/lat:\s*([\d.-]+)/.exec(src)?.[1]);
  const lon = Number(/lon:\s*([\d.-]+)/.exec(src)?.[1]);
  const mpd = Number(/METRES_PER_DEGREE\s*=\s*([\d_]+)/.exec(src)?.[1].replace(/_/g, ""));
  const fpm = Number(/FEET_PER_METRE\s*=\s*([\d.]+)/.exec(src)?.[1]);
  if (lat !== WELD.lat || lon !== WELD.lon) {
    throw new Error(`origin drift: frames.ts has ${lat},${lon}, this script has ${WELD.lat},${WELD.lon}`);
  }
  if (Math.abs(mpd * fpm - FEET_PER_DEGREE_LAT) > 1e-6) {
    throw new Error(`scale drift: frames.ts gives ${mpd * fpm} ft/deg lat, this script ${FEET_PER_DEGREE_LAT}`);
  }
  console.log(`frames.ts agrees: origin ${lat}, ${lon}`);
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function cached(name, url, { range } = {}) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, name);
  if (existsSync(path)) return readFileSync(path);
  const res = await fetch(url, range ? { headers: { Range: range } } : undefined);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return buf;
}

/** One tile as raw RGBA, or null when the service has no coverage there. */
async function tile(z, x, y) {
  const name = `massgis-${z}-${x}-${y}.png`;
  const path = join(CACHE, name);
  let buf;
  if (existsSync(path)) {
    buf = readFileSync(path);
    if (buf.length === 0) return null;
  } else {
    mkdirSync(CACHE, { recursive: true });
    const res = await fetch(`${MASSGIS_TILES}/${z}/${y}/${x}`);
    if (!res.ok) {
      // A 404 is "outside the published pyramid", which happens at the edges of every level.
      // Cached as an empty file so a re-run does not ask again.
      writeFileSync(path, Buffer.alloc(0));
      return null;
    }
    buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(path, buf);
  }
  const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data; // 256*256*4
}

/** Fetch many tiles with a bounded number in flight. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

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

/**
 * NAIP over a level's footprint, fetched as a `grid` x `grid` block of exportImage sub-requests
 * and mosaicked into one raw RGBA raster -- same output shape as naipRaster() (a Web Mercator
 * pixel raster with an origin), so it drops into the same resampleInverse()/mosaicSampler() call
 * in main() unchanged.
 *
 * WHY THIS EXISTS, MEASURED NOT GUESSED. A single exportImage request over L2's 50 km footprint
 * came back ~37.6% no-data, in large hard-edged rectangular blocks -- not the soft, low-percentage
 * gaps a genuine coverage hole would leave. Querying the ImageServer's own service info
 * (`?f=json`) shows `maxMosaicImageCount: 50`: it will only composite 50 source scenes into one
 * response. Querying `/query?returnCountOnly=true` over L2's exact bbox returns 79 intersecting
 * scenes. (79-50)/79 = 36.7%, against a measured 37.64% -- close enough that the cap, not a
 * pyramid gap, is the cause. A probe fetch at 8192x8192 over the same bbox (same source scenes,
 * just more raw pixels) didn't move the number at all, which rules out "not enough sampling
 * density" as the explanation; splitting the same bbox into a 3x3 grid of sub-requests instead
 * (each intersecting far fewer than 50 scenes) dropped no-data to 1.42%, with the entire remainder
 * being real open ocean over Boston Harbor that NAIP (CONUS land only) never had data for anyway.
 *
 * Each sub-tile is cached individually under its own grid coordinates, so a re-run after a code
 * change to an unrelated level costs no extra bandwidth here.
 */
async function naipRasterTiled(level, z, grid) {
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

  const SPAN = 2 * Math.PI * 6378137;
  const n = 256 * Math.pow(2, z);
  const toM = (px, py) => [(px / n) * SPAN - SPAN / 2, SPAN / 2 - (py / n) * SPAN];

  const tileW = Math.ceil(W / grid);
  const tileH = Math.ceil(H / grid);
  const jobs = [];
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const px0 = minX + gx * tileW;
      const px1 = Math.min(maxX, px0 + tileW);
      const py0 = minY + gy * tileH;
      const py1 = Math.min(maxY, py0 + tileH);
      if (px1 > px0 && py1 > py0) jobs.push({ gx, gy, px0, px1, py0, py1 });
    }
  }
  console.log(`  ${level.id}: NAIP ${W}x${H} at z${z}, tiled ${grid}x${grid} (${jobs.length} sub-requests)`);

  const mosaic = Buffer.alloc(W * H * 4);
  await pool(jobs, 4, async ({ gx, gy, px0, px1, py0, py1 }) => {
    const w = px1 - px0;
    const h = py1 - py0;
    const [x0, y1] = toM(px0, py0);
    const [x1, y0] = toM(px1, py1);
    const bbox = [x0, y0, x1, y1].join(",");
    const url =
      `${NAIP}?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${w},${h}` +
      `&format=png&interpolation=RSP_BilinearInterpolation&f=image`;
    const buf = await cached(`naip-${level.id}-z${z}-g${grid}-${gx}-${gy}-${w}x${h}.png`, url);
    const { data } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const ox = px0 - minX;
    const oy = py0 - minY;
    for (let r = 0; r < h; r++) {
      data.copy(mosaic, ((oy + r) * W + ox) * 4, r * w * 4, (r + 1) * w * 4);
    }
  });

  return { data: mosaic, width: W, height: H, originX: minX, originY: minY };
}

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
 * MassGIS's provenance block, extracted so hybridProvenance() can extend it rather than restate it.
 */
function massgisProvenance(level) {
  const processing = [
    "EPSG:3857 (Web Mercator) source; grid north IS true north, so no convergence rotation is applied or needed",
    "per-output-pixel inverse mapping into the site frame, bilinear",
  ];
  if (level.ocean) {
    processing.push(
      "composited over an upsampled Blue Marble crop, so no-data outside the state boundary receives ocean rather than black",
    );
  }
  const provenance = {
    dataset: "MassGIS 2025 Aerial Imagery (Massachusetts_Aerial_Imagery_2025)",
    flown: "2025-03-18/2025-04-23, leaf-off",
    nativeResolutionFt: 0.492,
    sampledGridFt: +((156_543.034 * Math.cos(WELD.lat * DEG)) / 2 ** level.zoom * 3.280839895).toFixed(4),
    zoom: level.zoom,
    url: `${MASSGIS_TILES}/{z}/{y}/{x}`,
    licence:
      "No restrictions apply to these data. Acknowledgement of MassGIS would be appreciated for products derived from these data.",
    attribution: ATTRIBUTION.massgis,
    processing,
  };
  if (level.ocean) provenance.oceanBase = ATTRIBUTION.bmng;
  return provenance;
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

/**
 * Resample a MassGIS level into the site frame.
 *
 * PER OUTPUT PIXEL, INVERSELY -- for each pixel of the quad, work out where on Earth it is and
 * go and get that colour. The other direction (walk the source and scatter into the output)
 * leaves holes wherever the scale is not exactly 1 and is the classic way to get a moire.
 *
 * Bilinear between the four neighbouring source pixels. Alpha is carried through the same
 * interpolation, so a pixel that straddles the edge of coverage comes out partly transparent and
 * the ocean composite shows through it rather than a hard black step appearing.
 */
async function resampleMassGIS(level) {
  const [W, H] = level.px;
  const z = level.zoom;
  const half = level.extentFt / 2;

  // The Mercator pixel window the quad's four corners span, in whole tiles.
  const corners = [
    siteToLatLon(-half, half),
    siteToLatLon(half, half),
    siteToLatLon(-half, -half),
    siteToLatLon(half, -half),
  ].map((c) => merc(c.lat, c.lon, z));
  const minX = Math.floor(Math.min(...corners.map((c) => c.x)) / 256);
  const maxX = Math.floor(Math.max(...corners.map((c) => c.x)) / 256);
  const minY = Math.floor(Math.min(...corners.map((c) => c.y)) / 256);
  const maxY = Math.floor(Math.max(...corners.map((c) => c.y)) / 256);

  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;
  const jobs = [];
  for (let ty = minY; ty <= maxY; ty++) for (let tx = minX; tx <= maxX; tx++) jobs.push([tx, ty]);
  console.log(`  ${level.id}: z${z}, ${cols}x${rows} = ${jobs.length} tiles`);

  const mosaicW = cols * 256;
  const mosaicH = rows * 256;
  const mosaic = Buffer.alloc(mosaicW * mosaicH * 4); // zeroed = transparent = no coverage
  let got = 0;
  await pool(jobs, 12, async ([tx, ty]) => {
    const data = await tile(z, tx, ty);
    if (!data) return;
    got++;
    const ox = (tx - minX) * 256;
    const oy = (ty - minY) * 256;
    for (let r = 0; r < 256; r++) {
      data.copy(mosaic, ((oy + r) * mosaicW + ox) * 4, r * 256 * 4, (r + 1) * 256 * 4);
    }
  });
  console.log(`  ${level.id}: ${got}/${jobs.length} tiles had coverage`);

  return resampleInverse(level, z, mosaicSampler(mosaic, mosaicW, mosaicH, minX * 256, minY * 256));
}

/**
 * Crop the Blue Marble to a level's extent, equirectangularly.
 *
 * BMNG is a plate carree global image: 21600 x 10800 for 360 x 180 degrees, so the mapping is
 * linear in both axes and the crop is a rectangle. Used for L1 outright and, for L2, as the
 * ocean underneath -- MassGIS coverage stops at the state boundary, so a 50 km frame centred on
 * Cambridge has no-data over Massachusetts Bay and the composite is what fills it.
 */
async function bmngCrop(extentFtX, extentFtY, W, H) {
  const src = await cached("bmng-august.jpg", BMNG);
  const halfX = extentFtX / 2;
  const halfY = extentFtY / 2;
  const nw = siteToLatLon(-halfX, halfY);
  const se = siteToLatLon(halfX, -halfY);
  const img = sharp(src, { limitInputPixels: 300_000_000 });
  const { width: SW, height: SH } = await img.metadata();
  const px = (lon) => ((lon + 180) / 360) * SW;
  const py = (lat) => ((90 - lat) / 180) * SH;
  const left = Math.max(0, Math.floor(px(nw.lon)));
  const top = Math.max(0, Math.floor(py(nw.lat)));
  const right = Math.min(SW, Math.ceil(px(se.lon)));
  const bottom = Math.min(SH, Math.ceil(py(se.lat)));
  const { data } = await sharp(src, { limitInputPixels: 300_000_000 })
    .extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) })
    .resize(W, H, { fit: "fill", kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: W, height: H, sourceSha: sha256(src) };
}

/** Paint `over` on top of `under`, using over's alpha. Both raw RGBA at the same size. */
function composite(under, over) {
  const out = Buffer.alloc(over.data.length);
  for (let i = 0; i < over.data.length; i += 4) {
    const a = over.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      out[i + c] = over.data[i + c] * a + under.data[i + c] * (1 - a);
    }
    out[i + 3] = 255;
  }
  return { data: out, width: over.width, height: over.height };
}

async function encode(id, raw) {
  mkdirSync(OUT, { recursive: true });
  const files = {};
  for (const [ext, opts] of [
    ["avif", { quality: 55, effort: 4 }],
    ["webp", { quality: 80 }],
  ]) {
    const name = `${id.toLowerCase()}.${ext}`;
    const buf = await sharp(raw.data, {
      raw: { width: raw.width, height: raw.height, channels: 4 },
    })
      .removeAlpha()
      [ext](opts)
      .toBuffer();
    writeFileSync(join(OUT, name), buf);
    files[ext] = { file: name, bytes: buf.length };
    console.log(`    ${name}  ${(buf.length / 1024).toFixed(0)} KB`);
  }
  return files;
}

async function main() {
  assertFramesAgree();
  const levels = {};

  for (const level of LEVELS) {
    console.log(
      level.global
        ? `${level.id}: the whole Earth, ${level.px.join("x")} px`
        : `${level.id}: ${level.extentFt.toLocaleString()} ft across, ${level.px.join("x")} px`,
    );
    let raw;
    let provenance;

    if (level.global) {
      const src = await cached("bmng-august.jpg", BMNG);
      const [W, H] = level.px;
      const { data } = await sharp(src, { limitInputPixels: 300_000_000 })
        .resize(W, H, { fit: "fill", kernel: "lanczos3" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      raw = { data, width: W, height: H };
      provenance = {
        dataset: "NASA Blue Marble Next Generation, topography and bathymetry, August 2004",
        instrument: "MODIS, 500 m",
        url: BMNG,
        licence:
          "US federal work, not subject to copyright in the United States. Acknowledgement requested, not required.",
        attribution: ATTRIBUTION.bmng,
        sourceSha256: sha256(src),
        projection: "equirectangular (plate carree), 360 x 180 degrees",
        processing: [
          "lanczos3 downsample from 21600 x 10800 to the output grid",
          "AUGUST composite, not December: the December plate carries heavy snow over New England",
        ],
      };
    } else if (level.source === "bmng") {
      const [W, H] = level.px;
      // L1 is wider than it is tall in pixels, so its extent is too -- the quad is square in
      // feet, so a non-square pixel grid would stretch it. Keep the aspect by extending the
      // sampled extent in x, not by squashing the image.
      const c = await bmngCrop(level.extentFt, (level.extentFt * H) / W, W, H);
      raw = c;
      provenance = {
        dataset: "NASA Blue Marble Next Generation, topography and bathymetry, August 2004",
        instrument: "MODIS, 500 m",
        url: BMNG,
        licence:
          "US federal work, not subject to copyright in the United States. Acknowledgement requested, not required.",
        attribution: ATTRIBUTION.bmng,
        sourceSha256: c.sourceSha,
        processing: [
          "equirectangular crop about Weld's origin",
          "lanczos3 downsample to the output grid",
        ],
      };
    } else if (level.source === "naip") {
      const r = level.tileGrid
        ? await naipRasterTiled(level, level.zoom, level.tileGrid)
        : await naipRaster(level, level.zoom);
      raw = resampleInverse(
        level,
        level.zoom,
        mosaicSampler(r.data, r.width, r.height, r.originX, r.originY),
      );
      provenance = naipProvenance(level);
      if (level.tileGrid) {
        provenance.processing.push(
          `fetched as a ${level.tileGrid}x${level.tileGrid} grid of exportImage sub-requests, not one request -- ` +
            "see naipRasterTiled()'s header comment: the ImageServer's maxMosaicImageCount (50) is smaller " +
            "than the ~79 source scenes this footprint intersects, so a single request came back ~37.6% no-data",
        );
      }
      // L2 keeps ocean:true -- NAIP is CONUS land only, so a 50 km frame centred on Cambridge still
      // has no data over Massachusetts Bay, and the Blue Marble composite is still what fills it.
      if (level.ocean) {
        const under = await bmngCrop(level.extentFt, level.extentFt, ...level.px);
        raw = composite(under, raw);
        provenance.processing.push(
          "composited over an upsampled Blue Marble crop, so no-data outside NAIP's CONUS land coverage receives ocean rather than black",
        );
        provenance.oceanBase = ATTRIBUTION.bmng;
      }
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
    } else {
      raw = await resampleMassGIS(level);
      if (level.ocean) {
        const under = await bmngCrop(level.extentFt, level.extentFt, ...level.px);
        raw = composite(under, raw);
      }
      provenance = massgisProvenance(level);
    }

    const files = await encode(level.id, raw);
    if (level.global) {
      levels[level.id] = { px: level.px, global: true, files, provenance };
      continue;
    }
    const halfX = level.extentFt / 2;
    const halfY = (level.extentFt * level.px[1]) / level.px[0] / 2;
    levels[level.id] = {
      px: level.px,
      // THE EXTENT IS IN SITE FEET, which is what makes the manifest the single source of the
      // quad geometry: Ground.tsx builds each plane from these numbers rather than from its own
      // copy, so an imagery change cannot silently disagree with the mesh it is mapped onto.
      extentFt: { minX: -halfX, maxX: halfX, minY: -halfY, maxY: halfY },
      ftPerTexel: +(level.extentFt / level.px[0]).toFixed(4),
      files,
      provenance,
    };
  }

  const manifest = {
    generatedBy: "scripts/fetch-imagery.mjs",
    origin: WELD,
    frame: "site feet, x east, y north, origin at Weld Hall's centroid (src/geo/frames.ts)",
    levels,
  };
  // WRITTEN INTO src/data AND NOT INTO public, so it is IMPORTED rather than fetched.
  //
  // Two reasons, and the first is a claim this project already makes: MASTER.md:80 says the app
  // works offline, and a manifest fetched at boot is a network request on the critical path that
  // would have to succeed before any ground could be drawn. Bundled, it cannot fail. The second
  // is that a bundled JSON import is type-checked at the point of use, so a level renamed here
  // is a tsc error in imagery.ts rather than a runtime undefined.
  //
  // Only ONE copy exists. public/imagery holds the plates; src/data holds the description of
  // them.
  const dest = "src/data/imagery-manifest.json";
  writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nwrote ${dest}`);
}

// GUARDED, NOT A BARE CALL, so that importing this module (rather than running it as a script)
// never triggers the entire pyramid rebuild -- every network fetch, every encode -- as a side
// effect of the import.
if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
