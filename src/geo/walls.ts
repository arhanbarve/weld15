/**
 * Wall bands and openings, derived from the room layout.
 *
 * The defect this module exists to prevent: in the SVG prototype every room
 * drew its own outline, so every shared edge was stroked twice and the drawing
 * looked muddy. Walls here are emitted exactly once, because they are computed
 * as the complement of the rooms within the suite footprint rather than as
 * per-room borders.
 *
 * Method: collect every room edge coordinate into a grid, classify each grid
 * cell as room or wall, then merge adjacent wall cells into maximal rectangles.
 * Area is conserved by construction, which is the property the tests lean on --
 * rooms plus walls tile the footprint with nothing double-counted and nothing
 * dropped.
 *
 * Frame is the suite frame from rooms.ts: u = feet inward from the facade,
 * v = feet north along the end section.
 */

import type { Rect, Suite } from "./rooms";

export type WallKind = "exterior" | "partition";

export type Wall = {
  id: string;
  u: number;
  v: number;
  du: number;
  dv: number;
  kind: WallKind;
  /** ids of the rooms on either side, where there is one */
  between: string[];
  /**
   * True for the suite's enclosing walls rather than its internal partitions.
   * Kept separate because area conservation is checked against the NET interior
   * footprint; the perimeter sits outside it.
   */
  perimeter?: true;
};

export type Opening = {
  id: string;
  wallId: string;
  kind: "door" | "window";
  /** distance along the wall's long axis from its origin corner */
  offset: number;
  width: number;
  connects: string[];
  note?: string;
};

const EPS = 1e-9;

/** The suite's gross footprint: the main leg plus the K bump. An L. */
export function suiteFootprint(suite: Suite): Rect[] {
  const p = suite.params;
  const k = suite.rooms.find((r) => r.id === "k");

  // Derive the leg's depth from where the rooms actually reach, not from
  // params. A slider can push the common room deeper than legDepth, and if the
  // footprint were taken from the param the room would stick out of it and area
  // conservation would silently fail. Found by the randomised sweep.
  const legOuter = Math.max(
    p.legDepth,
    ...suite.rooms.filter((r) => r.id !== "k").map((r) => r.u + r.du),
  );
  const kOuter = k ? k.u + k.du : legOuter;

  const parts: Rect[] = [
    {
      id: "leg",
      label: "main leg",
      u: 0,
      v: 0,
      du: legOuter,
      dv: p.sectionLength,
      kind: "unknown",
      windows: [],
    },
  ];
  if (k && kOuter > legOuter + EPS) {
    parts.push({
      id: "bump",
      label: "K bump",
      u: legOuter,
      v: 0,
      du: kOuter - legOuter,
      dv: k.dv,
      kind: "unknown",
      windows: [],
    });
  }
  return parts;
}

export function footprintArea(suite: Suite): number {
  return suiteFootprint(suite).reduce((a, r) => a + r.du * r.dv, 0);
}

function uniqSorted(xs: number[]): number[] {
  const out = [...xs].sort((a, b) => a - b);
  return out.filter((x, i) => i === 0 || x - out[i - 1]! > EPS);
}

function contains(r: Rect, u: number, v: number): boolean {
  return (
    u > r.u - EPS &&
    u + EPS < r.u + r.du &&
    v > r.v - EPS &&
    v + EPS < r.v + r.dv
  );
}

export function buildWalls(suite: Suite): { walls: Wall[]; openings: Opening[] } {
  const fp = suiteFootprint(suite);
  const rooms = suite.rooms;

  // Grid lines: every room edge and every footprint edge.
  const us = uniqSorted([
    ...rooms.flatMap((r) => [r.u, r.u + r.du]),
    ...fp.flatMap((r) => [r.u, r.u + r.du]),
  ]);
  const vs = uniqSorted([
    ...rooms.flatMap((r) => [r.v, r.v + r.dv]),
    ...fp.flatMap((r) => [r.v, r.v + r.dv]),
  ]);

  // Mark each cell: is it inside the footprint, and is it inside a room?
  const nU = us.length - 1;
  const nV = vs.length - 1;
  const isWall: boolean[][] = [];
  for (let i = 0; i < nU; i++) {
    isWall[i] = [];
    for (let j = 0; j < nV; j++) {
      const cu = (us[i]! + us[i + 1]!) / 2;
      const cv = (vs[j]! + vs[j + 1]!) / 2;
      const inFootprint = fp.some((r) => contains(r, cu, cv));
      const inRoom = rooms.some((r) => contains(r, cu, cv));
      isWall[i]![j] = inFootprint && !inRoom;
    }
  }

  // Merge wall cells into maximal rectangles: grow right, then down while the
  // whole row matches. Greedy is fine; the result is a partition either way.
  const used: boolean[][] = Array.from({ length: nU }, () =>
    Array.from({ length: nV }, () => false),
  );
  const walls: Wall[] = [];
  let n = 0;

  for (let i = 0; i < nU; i++) {
    for (let j = 0; j < nV; j++) {
      if (!isWall[i]![j] || used[i]![j]) continue;

      let jEnd = j;
      while (jEnd + 1 < nV && isWall[i]![jEnd + 1] && !used[i]![jEnd + 1]) jEnd++;

      let iEnd = i;
      grow: while (iEnd + 1 < nU) {
        for (let jj = j; jj <= jEnd; jj++) {
          if (!isWall[iEnd + 1]![jj] || used[iEnd + 1]![jj]) break grow;
        }
        iEnd++;
      }

      for (let ii = i; ii <= iEnd; ii++) {
        for (let jj = j; jj <= jEnd; jj++) used[ii]![jj] = true;
      }

      const u = us[i]!;
      const v = vs[j]!;
      const du = us[iEnd + 1]! - u;
      const dv = vs[jEnd + 1]! - v;
      walls.push({
        id: `w${n++}`,
        u,
        v,
        du,
        dv,
        kind: classify(),
        between: neighbours(u, v, du, dv, rooms),
      });
    }
  }

  walls.push(...perimeterWalls(suite, n));
  return { walls, openings: buildOpenings(suite, walls) };
}

/**
 * The suite's enclosing walls.
 *
 * These are not derivable from the room complement, because they lie outside the
 * footprint rather than in a gap between rooms. Without them there is no band to
 * hang the suite's entry door on, and no band for bedroom B's gable window --
 * both of which the tests caught.
 *
 * Masonry on the two building faces, the facade and the north gable, per the
 * 1875 description of brick with sandstone belts. Partition thickness elsewhere,
 * because those faces abut interior space: the neighbouring suite to the inner
 * side, and the stair hall to the south.
 */
function perimeterWalls(suite: Suite, startId: number): Wall[] {
  const p = suite.params;
  const fp = suiteFootprint(suite);
  const leg = fp[0]!;
  const bump = fp[1];
  const legOuter = leg.du;
  const kOuter = bump ? bump.u + bump.du : legOuter;
  const m = p.masonry;
  const t = p.partition;
  const out: Wall[] = [];
  let n = startId;

  const add = (
    u: number,
    v: number,
    du: number,
    dv: number,
    kind: WallKind,
    between: string[],
  ) => {
    if (du <= EPS || dv <= EPS) return;
    out.push({ id: `p${n++}`, u, v, du, dv, kind, between, perimeter: true });
  };

  const facing = (uu: number, vv: number) =>
    suite.rooms.filter((r) => contains(r, uu, vv)).map((r) => r.id);

  // facade, exterior masonry
  add(-m, 0, m, p.sectionLength, "exterior", uniqueIds(suite, 0.05, "facade"));
  // north gable, exterior masonry
  add(0, p.sectionLength, legOuter, m, "exterior", uniqueIds(suite, 0.05, "gable"));
  // south wall, to the stair hall
  add(0, -t, kOuter, t, "partition", facing(1, -1));
  // Inner face of the leg, north of the bump: the party wall to the neighbouring
  // suite. It starts ABOVE the step wall, not at the bump's top edge, or the two
  // overlap in the corner -- which the no-overlap test caught.
  const bumpTop = bump ? bump.dv + t : 0;
  add(legOuter, bumpTop, t, p.sectionLength - bumpTop, "partition", []);
  // outer face of the bump
  if (bump) add(kOuter, 0, t, bump.dv, "partition", []);
  // the step where the bump meets the leg
  if (bump) add(legOuter, bump.dv, kOuter - legOuter, t, "partition", []);

  // attribute the party wall and the bump faces to whichever rooms touch them
  for (const w of out) {
    if (w.between.length === 0) {
      w.between = neighbours(w.u, w.v, w.du, w.dv, suite.rooms);
    }
  }
  return out;
}

/** Rooms declaring a window on the given face, so the face's wall knows them. */
function uniqueIds(suite: Suite, _probe: number, face: "facade" | "gable"): string[] {
  return suite.rooms.filter((r) => r.windows.includes(face)).map((r) => r.id);
}

/**
 * Grid-derived bands are always partitions.
 *
 * They live in the gaps BETWEEN rooms, inside the footprint, so none of them is
 * a building face -- the facade and the gable are handled by perimeterWalls().
 * An earlier version tested "reaches v = sectionLength" and wrongly flagged the
 * hall's long partition as exterior, because that partition does run all the way
 * to the gable. Caught by the classification test.
 */
function classify(): WallKind {
  return "partition";
}

/**
 * Which rooms this band separates.
 *
 * Sampled along the band's whole length, not just at its midpoint. Bands merge:
 * the partition between the hall and the rooms west of it is one band running
 * past bedroom A, the bathroom and bedroom B. A midpoint-only probe reported
 * whichever room happened to sit at the middle and silently lost the others,
 * which broke every wallBetween() lookup. Caught by the bathroom-door test.
 */
function neighbours(u: number, v: number, du: number, dv: number, rooms: Rect[]): string[] {
  const probe = 0.05;
  const found = new Set<string>();
  const step = 0.25;

  for (let t = step / 2; t < dv; t += step) {
    for (const pu of [u - probe, u + du + probe]) {
      const r = rooms.find((x) => contains(x, pu, v + t));
      if (r) found.add(r.id);
    }
  }
  for (let t = step / 2; t < du; t += step) {
    for (const pv of [v - probe, v + dv + probe]) {
      const r = rooms.find((x) => contains(x, u + t, pv));
      if (r) found.add(r.id);
    }
  }
  return [...found].sort();
}

/** The wall band separating two rooms, if there is exactly one. */
export function wallBetween(walls: Wall[], a: string, b: string): Wall | undefined {
  return walls.find((w) => w.between.includes(a) && w.between.includes(b));
}

/** The wall band on a room's facade or gable face. */
function wallOnFace(walls: Wall[], room: Rect, face: "facade" | "gable"): Wall | undefined {
  return walls.find((w) => {
    if (w.kind !== "exterior" || !w.perimeter) return false;
    if (!w.between.includes(room.id)) return false;
    // The facade band runs along v at u < 0; the gable band runs along u above
    // the section's north end.
    return face === "facade" ? w.dv > w.du : w.du > w.dv;
  });
}

function buildOpenings(suite: Suite, walls: Wall[]): Opening[] {
  const out: Opening[] = [];
  const byId = new Map(suite.rooms.map((r) => [r.id, r]));
  let n = 0;

  const door = (a: string, b: string, width: number, note?: string) => {
    const w = wallBetween(walls, a, b);
    if (!w) return;
    const along = w.du > w.dv ? w.du : w.dv;
    out.push({
      id: `d${n++}`,
      wallId: w.id,
      kind: "door",
      offset: Math.max(0, (along - width) / 2),
      width: Math.min(width, along),
      connects: [a, b],
      note,
    });
  };

  // the resident's sequence: three doors off the hall going north, in this order.
  door("hall", "bedA", 3);
  door("hall", "bath", 3);
  door("hall", "bedB", 3);
  // K opens off the common room. That is what "attached to the common room"
  // means, and it is the only reading the geometry allows.
  door("common1", "k", 3);
  // Closets are reached from the hall.
  door("hall", "closets", 2.5);

  // The suite entry sits in the hall's inner wall, toward its south end, which
  // is where the stair hall is.
  const hall = byId.get("hall");
  if (hall) {
    const inner = walls.find(
      (w) => w.perimeter === true && w.between.includes("hall") && w.dv > w.du,
    );
    if (inner) {
      out.push({
        id: `d${n++}`,
        wallId: inner.id,
        kind: "door",
        offset: 1,
        width: 3.2,
        connects: ["hall", "outside"],
        note: "suite entry, from the stair hall",
      });
    }
  }

  for (const room of suite.rooms) {
    for (const face of room.windows) {
      const w = wallOnFace(walls, room, face);
      if (!w) continue;
      const along = w.du > w.dv ? w.du : w.dv;
      const width = Math.min(along * 0.55, 8);
      out.push({
        id: `n${n++}`,
        wallId: w.id,
        kind: "window",
        offset: (along - width) / 2,
        width,
        connects: [room.id],
        note: face,
      });
    }
  }

  return out;
}
