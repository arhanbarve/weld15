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
