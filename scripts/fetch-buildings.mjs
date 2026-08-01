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
