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
