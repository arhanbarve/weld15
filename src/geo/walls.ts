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
  /** ids of the rooms this band touches anywhere along its length */
  between: string[];
  /**
   * Room pairs this band genuinely divides: the two rooms sit on OPPOSITE sides
   * of it at the same point along its length.
   *
   * Distinct from `between`, and the distinction is load-bearing. Bands merge, so
   * `between` lists every room a long band runs past -- the band at v = 15 touches
   * the common room, bedroom A and the hall, because it runs the full 21 ft width
   * of the suite. It divides only the common room from bedroom A. wallBetween()
   * used to search `between` and so returned that band for hall/bedroom A, putting
   * bedroom A's door in the common room's wall. Four of the five interior doors
   * were in the wrong wall and every one of them looked plausible in the tables.
   */
  separates: [string, string][];
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
        ...adjacency(u, v, du, dv, rooms),
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
    // `separates` is always measured, never taken from the caller's list. A
    // perimeter band has open space or another suite on one face, so most of them
    // divide nothing and get an empty list -- which is the correct answer and the
    // reason the suite's entry door is hung by face rather than by wallBetween().
    const { separates } = adjacency(u, v, du, dv, suite.rooms);
    out.push({ id: `p${n++}`, u, v, du, dv, kind, between, separates, perimeter: true });
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
      w.between = adjacency(w.u, w.v, w.du, w.dv, suite.rooms).between;
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
 * Which rooms a band touches, and which pairs it actually divides.
 *
 * Sampled along the band's whole length, not just at its midpoint. Bands merge:
 * the partition between the hall and the rooms west of it is one band running
 * past bedroom A, the bathroom and bedroom B. A midpoint-only probe reported
 * whichever room happened to sit at the middle and silently lost the others,
 * which broke every wallBetween() lookup. Caught by the bathroom-door test.
 *
 * Widening that probe to the whole length fixed the lost rooms and introduced the
 * opposite error: `between` then listed rooms that merely sit beside a long band,
 * so a lookup by membership matched bands that divide nothing. Hence the second
 * return value. A pair is recorded only when the two rooms answer the probe on
 * OPPOSITE faces at the SAME point along the band, which is what "divides" means
 * and what membership in a set cannot express.
 */
function adjacency(
  u: number,
  v: number,
  du: number,
  dv: number,
  rooms: Rect[],
): { between: string[]; separates: [string, string][] } {
  const probe = 0.05;
  const step = 0.25;
  const found = new Set<string>();
  const pairs = new Set<string>();

  const at = (pu: number, pv: number) => rooms.find((x) => contains(x, pu, pv))?.id;

  const record = (lo: string | undefined, hi: string | undefined) => {
    if (lo) found.add(lo);
    if (hi) found.add(hi);
    if (!lo || !hi || lo === hi) return;
    // Sorted so a pair is one key whichever face the probe found first.
    pairs.add([lo, hi].sort().join(" "));
  };

  // Across the band's thickness at each step along its length. Which axis is
  // which depends on the band's shape, so probe both; a band is thin in one of
  // them and the other loop contributes nothing.
  for (let t = step / 2; t < dv; t += step) {
    record(at(u - probe, v + t), at(u + du + probe, v + t));
  }
  for (let t = step / 2; t < du; t += step) {
    record(at(u + t, v - probe), at(u + t, v + dv + probe));
  }

  return {
    between: [...found].sort(),
    separates: [...pairs].map((k) => k.split(" ") as [string, string]),
  };
}

/**
 * The wall band dividing two rooms.
 *
 * Searches `separates`, not `between`. See the Wall type for why that matters:
 * searching `between` returned a band that merely runs past both rooms, which put
 * four of five interior doors in the wrong wall.
 */
export function wallBetween(walls: Wall[], a: string, b: string): Wall | undefined {
  return walls.find((w) =>
    w.separates.some(([x, y]) => (x === a && y === b) || (x === b && y === a)),
  );
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

  /**
   * A door in the band that divides two rooms: centred on the band, then slid into the
   * stretch of it where the two rooms actually FACE each other.
   *
   * The slide is not a refinement. It is what makes the hall-to-common-room door a door
   * rather than a hole in front of bedroom A. Bands merge, and w0 is the worst case in
   * the suite: one 21 ft band at v 15 to 15.5 running the whole leg depth, separating
   * the common room from bedroom A over u 0 to 16 and from the hall over u 16.5 to 20.
   * A 3 ft door centred on that BAND lands at u 9 to 12 -- inside bedroom A's stretch,
   * so `connects` would say hall and common room while the hole opened out of the
   * bedroom, walk.ts would cut the void there, and route.ts's thresholdOf() would stand
   * the hall-side waypoint at u 10.5, v 16.5, which is in bedroom A.
   *
   * Third instance of one error, so it is a rule now rather than a fix: the suite entry
   * below was offset from its band's end instead of the hall's, and every facade window
   * was centred on the 44 ft band instead of on the room it lights. Both are recorded
   * where they were fixed. An offset is measured along the band and a door belongs to
   * two rooms, and those are not the same interval.
   *
   * CLAMPED RATHER THAN RE-CENTRED, and that costs one line to say why. Centring on the
   * shared face instead would move K's door: w7 runs the common room's full 15 ft while
   * K is 12 along, so the band centre is v 6 to 9 and the shared-face centre would be
   * v 4.5 to 7.5. v 6 to 9 is already wholly inside K and already right, and three other
   * modules have measured it there by its coordinates -- furniture.ts's commonSlots() and
   * clearOfBWalls(), drag.ts's DOOR_CLEARANCE note. So the band centre is KEPT wherever
   * it already lies within the shared face, which measured is all four doors that existed
   * before this one, and slid to the nearer end of that face when it does not.
   *
   * The width is clipped to the shared face as well. A slider can leave the common room
   * barely reaching the hall -- commonDeep only just past bedDepth + partition -- and the
   * honest answer there is a narrow door that walk.ts's canPass() refuses the walker,
   * rather than a 3 ft door hanging off the end of a 0.5 ft shared face.
   */
  const door = (a: string, b: string, width: number, note?: string) => {
    const w = wallBetween(walls, a, b);
    if (!w) return;
    const ra = byId.get(a);
    const rb = byId.get(b);
    // Both rooms exist by construction: `separates` is measured by probing suite.rooms,
    // so a band that separates a from b was found by finding them. Narrowed rather than
    // asserted because a missing room is not a case this can invent an answer for.
    if (!ra || !rb) return;

    const alongV = !(w.du > w.dv);
    const along = alongV ? w.dv : w.du;
    const lo = alongV ? w.v : w.u;
    const runLo = (r: Rect) => (alongV ? r.v : r.u);
    const runHi = (r: Rect) => (alongV ? r.v + r.dv : r.u + r.du);
    const faceLo = Math.max(lo, runLo(ra), runLo(rb));
    const faceHi = Math.min(lo + along, runHi(ra), runHi(rb));
    // Positive whenever wallBetween() found this band at all, since `separates` records
    // a pair only where both rooms answer the probe at the SAME point along the band.
    // Guarded anyway: walls and rooms can arrive from two different builds.
    if (faceHi - faceLo <= EPS) return;

    const clear = Math.min(width, faceHi - faceLo);
    const centred = (along - clear) / 2;
    out.push({
      id: `d${n++}`,
      wallId: w.id,
      kind: "door",
      offset: Math.min(Math.max(centred, faceLo - lo), faceHi - lo - clear),
      width: clear,
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
  // No door into the unknown strip beside the bathroom, deliberately. Its use is
  // not known, so whose door it would be is not known either; see unreachableRooms
  // in rooms.ts, which is told to exempt kind "unknown" for the same reason.
  //
  // `door()` returning silently when wallBetween finds nothing is what let this go
  // unnoticed before: the bathroom did not touch the hall, so door("hall","bath")
  // should have produced nothing, and it only produced something because
  // wallBetween matched a band that divides nothing. The silence is still right --
  // a slider can legitimately close a room to zero -- but the tests below now
  // assert the door COUNT rather than trusting the call to have worked.

  // The suite entry sits in the hall's inner wall, toward its south end, which
  // is where the stair hall is.
  const hall = byId.get("hall");
  if (hall) {
    const inner = walls.find(
      (w) => w.perimeter === true && w.between.includes("hall") && w.dv > w.du,
    );
    if (inner) {
      // Offset from the HALL's south end, not the band's. The band runs from
      // v = 12.5, past the K bump, while the hall itself only starts at v = 15.5,
      // so a flat offset of 1 put two thirds of a 3.2 ft door outside the hall --
      // it rendered as a shallow niche rather than a hole, because the bands behind
      // it backed it up, which is why it read as fine.
      out.push({
        id: `d${n++}`,
        wallId: inner.id,
        kind: "door",
        offset: hall.v - inner.v + 1,
        width: 3.2,
        connects: ["hall", "outside"],
        note: "suite entry, from the stair hall",
      });
    }
  }

  /**
   * The hall's south end opens into the common room, and this is the door that was
   * missing.
   *
   * WHAT WAS WRONG WITHOUT IT. The five openings above are four interior doors and the
   * entry, and they do not connect the suite: unreachableRooms() in rooms.ts flood-fills
   * over shared WALL SEGMENTS and answered [], while route.ts's reachable() fills over
   * DOORWAYS and answered ["hall", "bedA", "bath", "bedB"]. Both were right about their
   * own question, and the gap between them was this door. The suite's doorway graph was
   * two components -- the hall plus the three rooms off it, and the common room plus K
   * reachable only through it -- so route("hall", "common1") was null and no viewer could
   * be walked to the room the suite is named for. Measured, before and after, in
   * tests/route.test.ts and tests/walk.test.ts.
   *
   * MEASURED, at the defaults: it lands in w0, the 21 ft band at v 15 to 15.5, at offset
   * 16.5 and width 3, i.e. u 16.5 to 19.5. The band's own centre is u 9 to 12 and the
   * hall runs u 16.5 to 21 against the common room's u 0 to 20, so the shared face is
   * u 16.5 to 20 and the 3 ft door is slid to its low end -- see door() above. Its low
   * jamb is therefore flush with the line where bedroom A's partition meets the hall,
   * which is a door in the corner of the hall and is the whole 3.5 ft the two rooms give
   * it. route.ts stands the waypoints at u 18, v 14 in the common room and v 16.5 in the
   * hall, and both answer roomAt() correctly.
   *
   * WHY IT IS EMITTED LAST, WHICH IS NOT WHERE IT BELONGS IN THE STORY. Opening ids are
   * emission order, and three other modules have measured these ones by name: drag.ts
   * reports `["d3", "common1", "k"]` to the UI, furniture.ts's commonSlots() cites d3's
   * landing boundary at u 18, and walk.ts's solidsOf() names d4 as the entry it leaves
   * whole. Emitting this door in narrative order -- with the other interior doors, before
   * the entry -- renumbers d4 and would make every one of those records say something
   * false about a different door. So it goes on the end and says so here, which is the
   * same trade rooms.ts's measuredFacadeStep makes: the awkward arrangement is the one
   * that keeps the other modules' measurements true.
   */
  door("hall", "common1", 3);

  // A window is centred on the ROOM it lights, not on the band it sits in.
  //
  // This used to measure `along` over the whole band, which for the facade is the
  // suite's full 44 ft. Every room then produced width min(44 * 0.55, 8) = 8 at
  // offset (44 - 8) / 2 = 18, so all four facade windows came back as the identical
  // opening at v 18 to 26 -- four windows stacked in one hole in front of bedroom A,
  // and no glass at all in the common room, bedroom B's facade, or the strip. It
  // survived because nothing downstream compared two windows to each other, and
  // because one of the four does land in its own room, which is enough to make a
  // screenshot look right.
  //
  // The same list feeds bayRects() in weldGeometry.ts, so this was also putting the
  // exterior's window bays in the wrong place, on the same wall, by the same amount.
  // Fixing it here fixes both, which is the reason the exterior reads its openings
  // from this function rather than computing its own.
  for (const room of suite.rooms) {
    for (const face of room.windows) {
      const w = wallOnFace(walls, room, face);
      if (!w) continue;
      // The band's long axis is the one the room's run is measured along: the facade
      // band runs in v, the gable band in u.
      const alongV = w.dv > w.du;
      const run = alongV ? room.dv : room.du;
      const roomStart = alongV ? room.v : room.u;
      const bandStart = alongV ? w.v : w.u;
      const width = Math.min(run * 0.55, 8);
      out.push({
        id: `n${n++}`,
        wallId: w.id,
        kind: "window",
        offset: roomStart - bandStart + (run - width) / 2,
        width,
        connects: [room.id],
        note: face,
      });
    }
  }

  return out;
}
