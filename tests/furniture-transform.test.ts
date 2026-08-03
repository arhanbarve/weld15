import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildSuite, DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";
import { pieceBox, SIZES, type FurnitureKind, type Piece } from "@/geo/furniture";
import { suiteBasis } from "@/scene/Suite";
import { pieceMatrix } from "@/scene/Furniture";

/**
 * The double-rotation trap, caught arithmetically.
 *
 * Furniture.tsx builds one merged geometry per (kind, material) from
 * partsOf(kind), in the piece's own true, UNROTATED frame, recentred on the
 * footprint SIZES[kind] declares. pieceMatrix() then has to place that
 * geometry so it occupies exactly the box collide.ts's pieceBox() already
 * says the piece occupies -- footprintOf()'s "keep the anchor, swap du/dv
 * when turned" convention, which is NOT the same rectangle a naive rotation
 * about the piece's own unrotated centre would produce whenever du != dv.
 * Getting this wrong either turns an asymmetric part (a headboard, a bank of
 * drawers) the wrong way, or leaves the rendered piece's footprint disagreeing
 * with the box collide.ts already says it occupies.
 *
 * The check: build the SAME kind's full nominal footprint as one local box,
 * transform it by pieceMatrix() at the piece's real yaw, and compare its
 * world corners against the UNCONTROVERSIAL reference -- the SAME kind's
 * pieceBox()-reported (already swapped, already axis-aligned) footprint,
 * placed with pieceMatrix() at yaw 0. If the two disagree, either the
 * rotation or the anchor is wrong.
 */

const KINDS = Object.keys(SIZES) as FurnitureKind[];
const YAWS = [0, 90, 180, 270] as const;

const PARAM_SETS: SuiteParams[] = [
  DEFAULT_PARAMS,
  { ...DEFAULT_PARAMS, facade: "west" },
  { ...DEFAULT_PARAMS, hallWidth: 5.5 },
  { ...DEFAULT_PARAMS, sectionLength: 46, bedAAlong: 11 },
  { ...DEFAULT_PARAMS, wingStep: true },
  { ...DEFAULT_PARAMS, ceiling: 11.5, masonry: 1.75 },
];

/**
 * The 8 world corners of a box spanning the FULL footprint of `p` (its own
 * du x dv, recentred, exactly as Furniture.tsx builds the shared per-kind
 * geometry), transformed by pieceMatrix.
 */
function worldCorners(p: Piece, suiteYaw: number, params: SuiteParams): THREE.Vector3[] {
  const m = pieceMatrix(p, suiteYaw, params);
  const halfDu = p.du / 2;
  const halfDv = p.dv / 2;
  const out: THREE.Vector3[] = [];
  for (const lu of [-halfDu, halfDu]) {
    for (const lv of [-halfDv, halfDv]) {
      for (const ly of [0, 1]) {
        out.push(new THREE.Vector3(lu, ly, lv).applyMatrix4(m));
      }
    }
  }
  return out;
}

function bounds(corners: THREE.Vector3[]): { x: [number, number]; z: [number, number] } {
  const xs = corners.map((c) => c.x);
  const zs = corners.map((c) => c.z);
  return { x: [Math.min(...xs), Math.max(...xs)], z: [Math.min(...zs), Math.max(...zs)] };
}

describe("pieceMatrix places a rotated piece exactly where pieceBox() says it is", () => {
  for (const params of PARAM_SETS) {
    // Confirms the params actually place, so a broken param set does not pass
    // this test by accident -- buildSuite throws on an infeasible layout.
    buildSuite(params);
    const suiteYaw = suiteBasis(params).yaw;

    for (const kind of KINDS) {
      for (const yaw of YAWS) {
        it(`${kind} at yaw ${yaw}, params ${JSON.stringify(params).slice(0, 40)}`, () => {
          const { du, dv, h } = SIZES[kind];
          const p: Piece = { id: "t", kind, room: "x", u: 2, v: 3, du, dv, h, yaw };
          const box = pieceBox(p);
          const reference: Piece = {
            id: "ref", kind, room: "x",
            u: box.u, v: box.v, du: box.du, dv: box.dv, h, yaw: 0,
          };

          const got = bounds(worldCorners(p, suiteYaw, params));
          const want = bounds(worldCorners(reference, suiteYaw, params));

          expect(got.x[0]).toBeCloseTo(want.x[0], 9);
          expect(got.x[1]).toBeCloseTo(want.x[1], 9);
          expect(got.z[0]).toBeCloseTo(want.z[0], 9);
          expect(got.z[1]).toBeCloseTo(want.z[1], 9);
        });
      }
    }
  }
});
