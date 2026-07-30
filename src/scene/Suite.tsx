"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { buildSuite, type SuiteParams, type Rect } from "@/geo/rooms";
import { buildWalls, type Wall } from "@/geo/walls";
import { suiteToThree, floorLevel } from "@/geo/place";

/** Oak floors, plaster walls. Grey-box tones, not the final palette. */
const FLOOR_COLOR: Record<string, string> = {
  common: "#b5813f",
  bed: "#b5813f",
  bath: "#a5732f",
  circ: "#9c6d2c",
  service: "#8c8578",
  unknown: "#6b6b6b",
};

export const WALL_COLOR = { exterior: "#dfdad1", partition: "#f0ede7" } as const;

/**
 * The suite frame's basis vectors, expressed in three.js world space.
 *
 * An earlier version put every mesh inside one rotated group and negated the
 * local coordinates by hand. The negations were wrong and the rooms landed
 * outside the building, which showed up as a single grey plane filling the frame.
 * Deriving the basis from suiteToThree() instead means the only mapping in play is
 * the one place.ts already tests.
 */
export function suiteBasis(params: SuiteParams) {
  const o = suiteToThree(0, 0, 0, params);
  const du = suiteToThree(1, 0, 0, params);
  const dv = suiteToThree(0, 1, 0, params);
  const uDir = new THREE.Vector3(du[0] - o[0], 0, du[2] - o[2]).normalize();
  const vDir = new THREE.Vector3(dv[0] - o[0], 0, dv[2] - o[2]).normalize();
  // A Y-rotation by yaw sends local +x to (cos, 0, -sin). Solve for yaw from uDir.
  const yaw = Math.atan2(-uDir.z, uDir.x);
  return { origin: o, uDir, vDir, yaw };
}

/** World-space centre of a suite-frame rect at a given height. */
export function rectCentre(r: Rect | Wall, z: number, params: SuiteParams): THREE.Vector3 {
  const c = suiteToThree(r.u + r.du / 2, r.v + r.dv / 2, z, params);
  return new THREE.Vector3(c[0], c[1], c[2]);
}

/**
 * Weld 15's interior, straight from the geometry core.
 *
 * Every box is positioned by suiteToThree(), so the interior cannot drift from
 * the plan or from place.ts. Grey-box: flat tones, no openings cut into the wall
 * solids -- doorways read as gaps because buildWalls() already leaves them out of
 * the bands it emits.
 */
export function Suite({
  visible,
  opacity,
  params,
}: {
  visible: boolean;
  opacity: number;
  params: SuiteParams;
}) {
  const { rooms, walls, floor, yaw } = useMemo(() => {
    const suite = buildSuite(params);
    const { walls } = buildWalls(suite);
    return {
      rooms: suite.rooms,
      walls,
      floor: floorLevel(1),
      yaw: suiteBasis(params).yaw,
    };
  }, [params]);

  if (opacity <= 0.001) return null;

  const slab = 0.3;
  const wallH = params.ceiling;
  const rot: [number, number, number] = [0, yaw, 0];

  return (
    <group visible={visible}>
      {rooms.map((r) => (
        <mesh key={`f-${r.id}`} position={rectCentre(r, floor - slab / 2, params)} rotation={rot}>
          <boxGeometry args={[r.du, slab, r.dv]} />
          <meshStandardMaterial
            color={FLOOR_COLOR[r.kind] ?? "#6b6b6b"}
            roughness={0.85}
            transparent={opacity < 1}
            opacity={opacity}
          />
        </mesh>
      ))}

      {walls.map((w) => (
        <mesh key={`w-${w.id}`} position={rectCentre(w, floor + wallH / 2, params)} rotation={rot}>
          <boxGeometry args={[w.du, wallH, w.dv]} />
          {/* DoubleSide because the camera stands inside these rooms. Not
              currently load-bearing for any single assertion, but a FrontSide box
              is invisible from within, and every interior camera position is
              within one. */}
          <meshStandardMaterial
            color={w.kind === "exterior" ? WALL_COLOR.exterior : WALL_COLOR.partition}
            roughness={0.9}
            side={THREE.DoubleSide}
            transparent={opacity < 1}
            opacity={opacity}
          />
        </mesh>
      ))}
    </group>
  );
}
