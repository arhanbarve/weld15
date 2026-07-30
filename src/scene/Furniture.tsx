"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { type SuiteParams } from "@/geo/rooms";
import { pieceBox, MATTRESS, SIZES, type FurnitureKind, type Piece } from "@/geo/furniture";
import { suiteToThree, floorLevel } from "@/geo/place";
import { materials } from "./materials";

/**
 * The suite's fit-out, instanced per kind.
 *
 * WHY PER KIND AND NOT PER PIECE
 * furniture.ts places 29 pieces at the defaults and would place more if the
 * occupancy rose. One mesh each is 29 draw calls against a budget of 25 for the
 * whole suite -- the fit-out alone would blow it and leave nothing for the room it
 * stands in. Batched by kind it is seven draw calls whatever the count, because an
 * InstancedMesh draws every instance in one submission. The eighth is the bedding.
 *
 * WHY THE BEDDING IS ITS OWN BATCH
 * A bed is two materials: an oak frame and cloth on top of it. One instanced mesh
 * carries one material, so the bedding is a second batch of boxes sitting in the
 * frames, inset by the frame's own allowance. That inset is derived from SIZES and
 * MATTRESS rather than tabulated, so it stays correct if the frame allowance in
 * furniture.ts ever changes.
 *
 * WHY NOTHING HERE ROTATES A PIECE BY ITS YAW
 * A Piece's du and dv are UNROTATED, as furniture.ts's header says, and pieceBox()
 * is what applies the quarter turn. So every extent used below comes out of
 * pieceBox() and the only rotation applied is the suite's own yaw. Turning a box by
 * its yaw AND using pieceBox()'s extents would turn it twice: a bed 6.8 ft along u
 * would come out 6.8 ft along v, which is the sort of error that looks like a
 * layout bug rather than a rendering one.
 *
 * There is no furniture in the room of kind "unknown", and that is furniture.ts's
 * decision, not a filter here: layout() fits out bedrooms and commons. Naming a use
 * for that room by furnishing it is exactly what the project will not do.
 */

/**
 * Bedding thickness above the frame, ft. ASSUMED, like every furniture dimension
 * except the mattress: a mattress with a blanket turned over it.
 */
const BEDDING_H = 0.45;

/**
 * How far the bedding sits inside the frame on each side.
 *
 * Derived, not tabulated. SIZES.bed is the mattress plus a frame allowance on each
 * of the four sides, so half the difference is that allowance -- and it stays right
 * if furniture.ts's allowance changes, which a hard-coded inch would not.
 */
const BEDDING_INSET = (SIZES.bed.du - MATTRESS.du) / 2;

type Palette = { oakDeep: THREE.Material; crimson: THREE.Material };

/**
 * One kind's material.
 *
 * The sofa is crimson because MASTER.md gives crimson to "bedding, textiles" and a
 * sofa is upholstery; everything else is oak. Costs nothing -- the batching is per
 * kind already, so a per-kind material is free.
 */
function materialFor(kind: FurnitureKind, pal: Palette): THREE.Material {
  return kind === "sofa" ? pal.crimson : pal.oakDeep;
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
    const p = { oakDeep: m.oakDeep.clone(), crimson: m.crimson.clone() };
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
 * A world matrix for one axis-aligned suite-frame box.
 *
 * Every position goes through suiteToThree() and every rotation is the suite yaw
 * derived by suiteBasis(), which is the mechanism tests/suite-transform.test.ts
 * exists to keep. yaw arrives as a prop rather than being derived here so that this
 * module does not have to import Suite.tsx, which imports this one: a cycle between
 * the two would hand one of them a half-initialised copy of the other.
 */
function boxMatrix(
  u: number,
  v: number,
  du: number,
  dv: number,
  y0: number,
  y1: number,
  yaw: number,
  params: SuiteParams,
): THREE.Matrix4 {
  const c = suiteToThree(u + du / 2, v + dv / 2, (y0 + y1) / 2, params);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(c[0], c[1], c[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
    new THREE.Vector3(du, y1 - y0, dv),
  );
}

/**
 * One InstancedMesh over a shared unit box.
 *
 * The trap here, and it is invisible until the camera moves: an InstancedMesh
 * inherits its bounding sphere from its GEOMETRY, which is a unit cube at the
 * world origin -- 900 ft from the suite. Frustum culling then drops the whole batch
 * the moment the origin leaves the frame, so the furniture vanishes at exactly the
 * stage it is meant to be seen. InstancedMesh.computeBoundingSphere() reads the
 * instance matrices instead, and has to be called again whenever they change.
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
  /** The suite yaw from suiteBasis(). See boxMatrix() for why it is a prop. */
  yaw: number;
  /** The arrangement to draw, from the store. */
  pieces: Piece[];
  visible?: boolean;
}) {
  const pal = useFurniturePalette(opacity);

  // One unit cube for every batch. Instance matrices carry the real extents, so
  // the geometry is shared and the scaling costs nothing.
  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => {
    return () => box.dispose();
  }, [box]);

  const batches = useMemo(() => {
    const floor = floorLevel(1);

    // Keyed off SIZES rather than a second list of kinds, so a kind added to
    // furniture.ts gets a batch here without this file being edited.
    const byKind = new Map<FurnitureKind, THREE.Matrix4[]>(
      (Object.keys(SIZES) as FurnitureKind[]).map((k) => [k, []]),
    );
    const bedding: THREE.Matrix4[] = [];

    for (const p of pieces) {
      const f = pieceBox(p);
      byKind.get(p.kind)?.push(
        boxMatrix(f.u, f.v, f.du, f.dv, floor, floor + p.h, yaw, params),
      );
      if (p.kind !== "bed") continue;
      const i = BEDDING_INSET;
      bedding.push(
        boxMatrix(
          f.u + i,
          f.v + i,
          f.du - 2 * i,
          f.dv - 2 * i,
          floor + p.h,
          floor + p.h + BEDDING_H,
          yaw,
          params,
        ),
      );
    }

    return { byKind: [...byKind].filter(([, m]) => m.length > 0), bedding };
  }, [params, yaw, pieces]);

  if (opacity <= 0.001) return null;

  return (
    <group visible={visible}>
      {batches.byKind.map(([kind, matrices]) => (
        <Batch
          key={kind}
          matrices={matrices}
          geometry={box}
          material={materialFor(kind, pal)}
          shadows={opacity > 0.99}
        />
      ))}
      {batches.bedding.length > 0 ? (
        <Batch
          matrices={batches.bedding}
          geometry={box}
          material={pal.crimson}
          shadows={opacity > 0.99}
        />
      ) : null}
    </group>
  );
}
