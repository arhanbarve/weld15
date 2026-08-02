"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeBufferGeometries } from "three-stdlib";
import { buildingToSite, toThree, WELD_AXIS_DEG } from "@/geo/frames";
import { DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";
import {
  loggiaFootprint,
  stairHallFootprint,
  stairSteps,
  corridorFootprint,
  suiteEntryBuildingV,
  FLOOR_TO_FLOOR_FT,
  type Box,
} from "@/geo/common";
import { materials, DAY } from "./materials";

/**
 * Weld's own common parts, drawn: the west front loggia, the north stair
 * hall, its stair, and the corridor connecting that stair hall to the
 * suite's own entry door -- geo/common.ts's own header explains what these
 * are and why they exist. This file only converts that geometry to world
 * space and picks materials; the placement math lives there.
 *
 * WHY BUILDING FRAME, NOT SUITE FRAME
 * These parts exist independent of any suite param -- they are the building
 * itself, not the suite -- so there is no per-suite yaw the way Suite.tsx's
 * suiteBasis() has one for `params.facade`. `buildingYaw()` below is its
 * exact analogue, one fixed rotation derived from WELD_AXIS_DEG rather than
 * from a suite param, computed the same way (two points run through the real
 * conversion, not the axis degrees converted by hand) for the same reason
 * Suite.tsx's own comment gives: it is the one mapping frames.ts already
 * tests, so a box here cannot drift from the ring however the code around it
 * changes.
 *
 * MATERIALS, AND WHY ONLY ONE IS NEW
 * The loggia floor is "marble-paved" (weld.json's own 1875 text) and gets a
 * new `marble` token -- everything else reuses Suite.tsx's existing palette
 * (masonry for every wall, oakDeep for the stair treads) rather than
 * inventing a second new material for a backdrop nobody stands in. `corridor`
 * shares the same masonry/oak pair. Three meshes total: masonry (walls +
 * corridor + stair-hall walls), oakDeep (stair treads), marble (loggia
 * floor) -- +2 draw calls over Suite.tsx's own budget for a mesh most stages
 * never mount (see Experience.tsx for when this is visible at all).
 */

function buildingYaw(): number {
  const o = toThree(buildingToSite({ u: 0, v: 0 }).x, buildingToSite({ u: 0, v: 0 }).y);
  const du = toThree(buildingToSite({ u: 1, v: 0 }).x, buildingToSite({ u: 1, v: 0 }).y);
  const uDir = new THREE.Vector3(du[0] - o[0], 0, du[2] - o[2]).normalize();
  return Math.atan2(-uDir.z, uDir.x);
}

/** A building-frame Box, positioned and sized in world space. */
function boxGeometry(b: Box, yaw: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.du, b.y1 - b.y0, b.dv);
  const centreSite = buildingToSite({ u: b.u + b.du / 2, v: b.v + b.dv / 2 });
  const c = toThree(centreSite.x, centreSite.y, (b.y0 + b.y1) / 2);
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(c[0], c[1], c[2]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return g;
}

function mergeBoxes(boxes: Box[], yaw: number, what: string): THREE.BufferGeometry | null {
  if (boxes.length === 0) return null;
  const parts = boxes.map((b) => boxGeometry(b, yaw));
  const merged = mergeBufferGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error(`CommonParts: mergeBufferGeometries returned null for ${what}`);
  merged.computeBoundingSphere();
  return merged;
}

/** Wall thickness for the loggia and stair hall's own enclosure, ft. ASSUMED, matching the suite's own masonry figure. */
const WALL_T = 1.5;
/** Floor and ceiling slab thickness, ft -- same figures Suite.tsx uses for its own floor/ceiling plates. */
const FLOOR_SLAB = 0.3;

/** The four walls of a rectangular room, as Box perimeter bands, `WALL_T` thick, floor to `wallH`. */
function perimeterWalls(footprint: Box, wallH: number): Box[] {
  const y0 = footprint.y1;
  const y1 = y0 + wallH;
  return [
    { u: footprint.u - WALL_T, v: footprint.v - WALL_T, du: footprint.du + 2 * WALL_T, dv: WALL_T, y0, y1 },
    { u: footprint.u - WALL_T, v: footprint.v + footprint.dv, du: footprint.du + 2 * WALL_T, dv: WALL_T, y0, y1 },
    { u: footprint.u - WALL_T, v: footprint.v, du: WALL_T, dv: footprint.dv, y0, y1 },
    { u: footprint.u + footprint.du, v: footprint.v, du: WALL_T, dv: footprint.dv, y0, y1 },
  ];
}

/** Ceiling height for the common parts, ft. Same as the suite's own default -- no source gives this floor's own ceiling a figure. */
const CEILING_H = DEFAULT_PARAMS.ceiling;

function useCommonPartsPalette() {
  const pal = useMemo(() => {
    const m = materials();
    const p = {
      masonry: m.masonry.clone(),
      oakDeep: m.oakDeep.clone(),
      // A fresh material, not a masonry clone: marble is smooth paving, not
      // trowelled plaster, and inheriting masonry's own normal map would
      // carry a texture across that has nothing to do with cut stone.
      marble: new THREE.MeshStandardMaterial({ color: MARBLE, roughness: 0.15, metalness: 0 }),
    };
    for (const x of Object.values(p)) x.side = THREE.DoubleSide;
    return p;
  }, []);
  useEffect(() => {
    return () => {
      for (const x of Object.values(pal)) x.dispose();
    };
  }, [pal]);
  return pal;
}

/**
 * Marble paving, per weld.json's own "marble-paved" loggia. One documented
 * operation on a DAY token, the same convention materials.ts's BRICK/SLATE
 * use: plaster brightened rather than warmed, since marble reads paler and
 * cooler than a trowelled wall, and the low roughness on the material itself
 * (set above, not baked into the colour) carries the rest of the polish.
 */
const MARBLE = "#" + new THREE.Color(DAY.plaster).lerp(new THREE.Color(DAY.sky), 0.35).getHexString();

export function CommonParts({ visible, params = DEFAULT_PARAMS }: { visible: boolean; params?: SuiteParams }) {
  const yaw = useMemo(buildingYaw, []);
  const pal = useCommonPartsPalette();

  const geo = useMemo(() => {
    const loggiaFloor = loggiaFootprint(FLOOR_SLAB);
    const stairHallFloor = stairHallFootprint(FLOOR_SLAB);
    const entryV = suiteEntryBuildingV(params);
    const corridorFloor = corridorFootprint(entryV, FLOOR_SLAB);
    const steps = stairSteps(FLOOR_TO_FLOOR_FT);

    const marble = mergeBoxes([{ ...loggiaFloor, y0: 0 }], yaw, "loggia floor");
    const oakDeep = mergeBoxes(steps, yaw, "stair treads");
    const masonry = mergeBoxes(
      [
        { ...stairHallFloor, y0: 0 },
        { ...corridorFloor, y0: 0 },
        ...perimeterWalls(loggiaFloor, CEILING_H),
        ...perimeterWalls(stairHallFloor, CEILING_H),
        ...perimeterWalls(corridorFloor, CEILING_H),
      ],
      yaw,
      "common-parts masonry",
    );

    return { marble, oakDeep, masonry };
  }, [params, yaw]);

  useEffect(() => {
    return () => {
      for (const g of Object.values(geo)) g?.dispose();
    };
  }, [geo]);

  return (
    <group visible={visible}>
      {geo.masonry ? <mesh geometry={geo.masonry} material={pal.masonry} receiveShadow /> : null}
      {geo.marble ? <mesh geometry={geo.marble} material={pal.marble} receiveShadow /> : null}
      {geo.oakDeep ? <mesh geometry={geo.oakDeep} material={pal.oakDeep} receiveShadow /> : null}
    </group>
  );
}
