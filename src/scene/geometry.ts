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

/**
 * A hipped roof over a ring: the ring lifted to `eaves`, tapered to a ridge at
 * `ridge`. Crude on purpose for P2 -- Weld's real roof has gables, oriels and
 * chimney stacks, all of which are P4's problem. What matters here is that Weld
 * reads as 60 ft of wall under a pitched top rather than an 87 ft box.
 */
export function roofGeometry(
  ring: number[][],
  eaves: number,
  ridge: number,
): THREE.BufferGeometry {
  const pts = ring.slice(0, -1);
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0]!;
    cy += p[1]!;
  }
  cx /= pts.length;
  cy /= pts.length;

  const position: number[] = [];
  const index: number[] = [];
  // apex first, then the eaves ring, fanned
  position.push(cx, ridge, -cy);
  for (const p of pts) position.push(p[0]!, eaves, -p[1]!);
  for (let i = 0; i < pts.length; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % pts.length);
    index.push(0, b, a);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
