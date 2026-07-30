import * as THREE from "three";
import { extrude } from "@/geo/extrude";

/**
 * Adapter from extrude.ts's plain typed arrays to a three BufferGeometry.
 *
 * extrude.ts deliberately imports no three, so it stays testable in Node. This is
 * the only place that bridges the two.
 */
export function extrudedGeometry(
  ring: number[][],
  height: number,
  base = 0,
): THREE.BufferGeometry {
  const { positions, normals, indices } = extrude(ring, height, base);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  return g;
}
