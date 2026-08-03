"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeBufferGeometries } from "three-stdlib";
import { type SuiteParams } from "@/geo/rooms";
import { pieceBox, SIZES, type FurnitureKind, type Piece } from "@/geo/furniture";
import { partsOf, type Part, type PartMaterial } from "@/geo/pieces";
import { suiteToThree, floorLevel } from "@/geo/place";
import { materials } from "./materials";

/**
 * The suite's fit-out, instanced per (kind, material).
 *
 * WHY PER (KIND, MATERIAL) AND NOT PER PIECE
 * furniture.ts places 29 pieces at the defaults and would place more if the
 * occupancy rose. One mesh each is 29 draw calls against a budget of 25 for the
 * whole suite -- the fit-out alone would blow it and leave nothing for the room it
 * stands in. Batched by kind and material it is 11 draw calls whatever the
 * piece count, because an InstancedMesh draws every instance in one submission
 * and a kind's own geometry never varies between instances.
 *
 * WHY THE GEOMETRY IS BUILT ONCE, IN THE PIECE'S OWN TRUE FRAME
 * partsOf(kind) (geo/pieces.ts) returns every part of a kind at its real
 * construction, in the piece's own unrotated frame -- legs, rails, a headboard,
 * a bank of drawer fronts. That geometry is shared by every instance of the
 * kind; only the instance MATRIX differs, and it is now RIGID (translation and
 * rotation, scale exactly 1) rather than the scaled-unit-cube the old version
 * used, because a rotation applied to a scaled box would turn an asymmetric
 * part -- a headboard, a drawer front -- into the wrong shape as well as the
 * wrong place.
 *
 * pieceBox() is READ HERE, ONLY FOR THE WORLD POSITION -- NOT FOR SCALE
 * collide.ts's footprintOf() keeps a piece's anchor (u, v) fixed and swaps
 * du/dv when the piece is turned 90 or 270, rather than rotating its footprint
 * about the visual centre -- collide.ts's own header says a view that wants a
 * true rotation "composes its own translation on top". pieceMatrix() is that
 * translation: pieceBox(p)'s own centre is exactly where a true rotation about
 * the piece's real geometric centre has to land for the rendered assembly to
 * occupy precisely the box collide.ts's arithmetic already agrees it occupies
 * -- proven for all four yaws in
 * tests/furniture-transform.test.ts, which is what a bed 6.833 ft along u
 * coming out 6.833 ft along v (rather than swapped, rotated, and in the right
 * place) would fail. What is NOT read is pieceBox()'s du/dv as a SCALE: the
 * shared geometry is built once, at SIZES[kind]'s true unrotated size, and
 * rotated by the piece's yaw exactly once. Scaling by the already-swapped
 * extents and then rotating on top of that is the double turn the old header
 * warned about; using pieceBox() for a translation is not it.
 *
 * There is no furniture in the room of kind "unknown", and that is furniture.ts's
 * decision, not a filter here: layout() fits out bedrooms and commons. Naming a use
 * for that room by furnishing it is exactly what the project will not do.
 */

type Palette = {
  oakDeep: THREE.Material;
  crimson: THREE.Material;
  hardware: THREE.Material;
};

function materialFor(kind: PartMaterial, pal: Palette): THREE.Material {
  if (kind === "textile") return pal.crimson;
  if (kind === "hardware") return pal.hardware;
  return pal.oakDeep;
}

/**
 * The two palette materials this component paints with, cloned once.
 *
 * Same reasoning as useSuitePalette() in Suite.tsx: the palette's singletons are
 * shared, `opacity` is this component's threshold state and `side` is a fact about
 * where the camera stands, so both are written to clones made once per mount and
 * disposed on unmount rather than onto the shared objects.
 */
function useFurniturePalette(opacity: number): Palette {
  const pal = useMemo(() => {
    const m = materials();
    const p = { oakDeep: m.oakDeep.clone(), crimson: m.crimson.clone(), hardware: m.hardware.clone() };
    // The camera stands in these rooms; FrontSide culls every interior face.
    for (const x of Object.values(p)) x.side = THREE.DoubleSide;
    return p;
  }, []);

  useEffect(() => {
    return () => {
      for (const x of Object.values(pal)) x.dispose();
    };
  }, [pal]);

  useMemo(() => {
    for (const x of Object.values(pal)) {
      x.transparent = opacity < 1;
      x.opacity = opacity;
      // See Suite.tsx: depth writes at partial opacity sort wrong against the
      // dissolving shell.
      x.depthWrite = opacity > 0.99;
    }
  }, [pal, opacity]);

  return pal;
}

/**
 * One part as a positioned BufferGeometry, in the KIND's own local frame:
 * recentred on the footprint SIZES[kind] declares, so the origin is the
 * piece's true geometric centre and X/Z map to u/v exactly as suiteToThree()
 * does for every other box in the scene. Y is left absolute -- the floor this
 * kind of piece stands on is always y = 0 in this frame, and the instance
 * matrix's own translation carries it to floorLevel(1).
 */
function partGeometry(kind: FurnitureKind, part: Part): THREE.BufferGeometry {
  const { du: fullDu, dv: fullDv } = SIZES[kind];
  const g = new THREE.BoxGeometry(part.du, part.y1 - part.y0, part.dv);
  g.translate(
    part.u + part.du / 2 - fullDu / 2,
    (part.y0 + part.y1) / 2,
    part.v + part.dv / 2 - fullDv / 2,
  );
  return g;
}

/** Every part of `kind` that paints with `material`, merged into one geometry. */
function kindMaterialGeometry(
  kind: FurnitureKind,
  material: PartMaterial,
): THREE.BufferGeometry | null {
  const parts = partsOf(kind).filter((p) => p.material === material);
  if (parts.length === 0) return null;
  const boxes = parts.map((p) => partGeometry(kind, p));
  const merged = mergeBufferGeometries(boxes, false);
  for (const b of boxes) b.dispose();
  if (!merged) throw new Error(`Furniture: mergeBufferGeometries returned null for ${kind}/${material}`);
  merged.computeBoundingSphere();
  return merged;
}

/**
 * The rigid world transform for one piece, at its true size.
 *
 * See the module header for why pieceBox() is read here for POSITION and
 * never for the local geometry's SCALE. `suiteYaw` is suiteBasis(params).yaw,
 * the same angle every other oriented box in the scene turns by to match
 * suiteToThree()'s own embedding; `p.yaw` turns this ONE piece an additional
 * amount within the suite. Piece.yaw is documented as clockwise in plan where
 * 0 faces +v; three's Y-rotation is counter-clockwise looking down, hence the
 * negation.
 */
export function pieceMatrix(p: Piece, suiteYaw: number, params: SuiteParams): THREE.Matrix4 {
  const box = pieceBox(p);
  const c = suiteToThree(box.u + box.du / 2, box.v + box.dv / 2, floorLevel(1), params);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(c[0], c[1], c[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, suiteYaw - (p.yaw * Math.PI) / 180, 0)),
    new THREE.Vector3(1, 1, 1),
  );
}

/**
 * One InstancedMesh over a shared, real geometry.
 *
 * The trap here, and it is invisible until the camera moves: an InstancedMesh
 * inherits its bounding sphere from its GEOMETRY, which for these merged parts
 * sits near the piece's own centre rather than the world origin, but STILL has
 * to be recomputed from the instance matrices whenever they change, or
 * frustum culling drops the whole batch the moment the reference geometry's
 * own sphere leaves the frame.
 */
function Batch({
  matrices,
  geometry,
  material,
  shadows = false,
}: {
  matrices: THREE.Matrix4[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Off below full opacity: see Suite.tsx, where the same gate is explained. */
  shadows?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]!);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [matrices]);

  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, matrices.length]}
      castShadow={shadows}
      receiveShadow={shadows}
    />
  );
}

const KINDS = Object.keys(SIZES) as FurnitureKind[];
const MATERIAL_KINDS: PartMaterial[] = ["oak", "textile", "hardware"];

/**
 * The fit-out for a suite.
 *
 * `pieces` is a PROP and no longer a call to layout() inside this component's own
 * render, and that one change is what made the model changeable. While the
 * arrangement was a pure function of the params there was nowhere for a drag to be
 * recorded -- any move would have been recomputed away on the next render. The store
 * owns the arrangement now, seeded from layout() once, and this component draws what
 * it is handed.
 *
 * So occupancy is not this file's business either. It is store.ts's `occupancy`, and
 * refit() is the act that applies it.
 */
export function Furniture({
  opacity,
  params,
  yaw,
  pieces,
  visible = true,
}: {
  opacity: number;
  params: SuiteParams;
  /** The suite yaw from suiteBasis(). See pieceMatrix() for why it is a prop. */
  yaw: number;
  /** The arrangement to draw, from the store. */
  pieces: Piece[];
  visible?: boolean;
}) {
  const pal = useFurniturePalette(opacity);

  // Shared geometry, one per (kind, material) that actually has parts. Built
  // once: it depends only on geo/pieces.ts, never on the suite or the
  // arrangement.
  const geometries = useMemo(() => {
    const out = new Map<string, THREE.BufferGeometry>();
    for (const kind of KINDS) {
      for (const material of MATERIAL_KINDS) {
        const g = kindMaterialGeometry(kind, material);
        if (g) out.set(`${kind}:${material}`, g);
      }
    }
    return out;
  }, []);
  useEffect(() => {
    return () => {
      for (const g of geometries.values()) g.dispose();
    };
  }, [geometries]);

  // One set of rigid matrices per kind, shared by every material batch of
  // that kind -- the transform is a property of the PIECE, not of which part
  // material happens to be drawn with it.
  const matricesByKind = useMemo(() => {
    const byKind = new Map<FurnitureKind, THREE.Matrix4[]>(KINDS.map((k) => [k, []]));
    for (const p of pieces) {
      byKind.get(p.kind)?.push(pieceMatrix(p, yaw, params));
    }
    return byKind;
  }, [params, yaw, pieces]);

  if (opacity <= 0.001) return null;

  return (
    <group visible={visible}>
      {KINDS.flatMap((kind) => {
        const matrices = matricesByKind.get(kind);
        if (!matrices || matrices.length === 0) return [];
        return MATERIAL_KINDS.flatMap((material) => {
          const geometry = geometries.get(`${kind}:${material}`);
          if (!geometry) return [];
          return (
            <Batch
              key={`${kind}:${material}`}
              matrices={matrices}
              geometry={geometry}
              material={materialFor(material, pal)}
              shadows={opacity > 0.99}
            />
          );
        });
      })}
    </group>
  );
}
