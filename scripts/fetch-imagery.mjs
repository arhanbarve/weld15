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

const CACHE = ".cache/imagery";
const OUT = "public/imagery";

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

const ATTRIBUTION = {
  bmng: "NASA Earth Observatory / Blue Marble Next Generation",
  massgis:
    "MassGIS (Bureau of Geographic Information), Commonwealth of Massachusetts EOTSS",
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
  { id: "L2", source: "massgis", extentFt: 164_000, px: [2048, 2048], zoom: 13, ocean: true },
  { id: "L3", source: "massgis", extentFt: 16_400, px: [2048, 2048], zoom: 16 },
  { id: "L4", source: "massgis", extentFt: 1_600, px: [3072, 3072], zoom: 20 },
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

  const out = Buffer.alloc(W * H * 4);
  const originX = minX * 256;
  const originY = minY * 256;
  for (let j = 0; j < H; j++) {
    // j = 0 is the TOP of the quad, which is NORTH, which is +y in the site frame. Getting this
    // upside down flips the photograph north-for-south, and a mirrored Yard is exactly the class
    // of error frames.ts's header warns is invisible.
    const sy = half - ((j + 0.5) / H) * level.extentFt;
    for (let i = 0; i < W; i++) {
      const sx = -half + ((i + 0.5) / W) * level.extentFt;
      const { lat, lon } = siteToLatLon(sx, sy);
      const m = merc(lat, lon, z);
      const fx = m.x - originX;
      const fy = m.y - originY;
      const x0 = Math.floor(fx - 0.5);
      const y0 = Math.floor(fy - 0.5);
      const ax = fx - 0.5 - x0;
      const ay = fy - 0.5 - y0;
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const px = Math.min(mosaicW - 1, Math.max(0, x0 + dx));
          const py = Math.min(mosaicH - 1, Math.max(0, y0 + dy));
          const w = (dx ? ax : 1 - ax) * (dy ? ay : 1 - ay);
          const k = (py * mosaicW + px) * 4;
          r += mosaic[k] * w;
          g += mosaic[k + 1] * w;
          b += mosaic[k + 2] * w;
          a += mosaic[k + 3] * w;
        }
      }
      const o = (j * W + i) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { data: out, width: W, height: H };
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
    } else {
      raw = await resampleMassGIS(level);
      const processing = [
        "EPSG:3857 (Web Mercator) source; grid north IS true north, so no convergence rotation is applied or needed",
        "per-output-pixel inverse mapping into the site frame, bilinear",
      ];
      if (level.ocean) {
        const under = await bmngCrop(level.extentFt, level.extentFt, ...level.px);
        raw = composite(under, raw);
        processing.push(
          "composited over an upsampled Blue Marble crop, so no-data outside the state boundary receives ocean rather than black",
        );
      }
      provenance = {
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

await main();
