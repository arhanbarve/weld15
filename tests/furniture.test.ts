import { describe, it, expect } from "vitest";
import {
  buildSuite,
  DEFAULT_PARAMS,
  findOverlaps,
  type Rect,
  type Suite,
  type SuiteParams,
} from "@/geo/rooms";
import {
  GRID,
  containedBy,
  footprintOf,
  overlaps,
  placeIsLegal,
  snapToGrid,
  snapToWalls,
  type Box,
} from "@/geo/collide";
import { buildWalls, type Opening, type Wall } from "@/geo/walls";
import {
  BED_CLEARANCE,
  DOOR_CLEARANCE,
  MATTRESS,
  SIZES,
  bedClearance,
  doorLandings,
  layout,
  pieceBox,
  type FurnitureKind,
  type Piece,
} from "@/geo/furniture";

const suite = buildSuite();
const roomOf = (s: Suite, id: string): Rect => {
  const r = s.rooms.find((x) => x.id === id);
  if (!r) throw new Error(`no room ${id}`);
  return r;
};
const inRoom = (ps: Piece[], id: string) => ps.filter((p) => p.room === id);
const kindsOf = (ps: Piece[]) => {
  const t: Partial<Record<FurnitureKind, number>> = {};
  for (const p of ps) t[p.kind] = (t[p.kind] ?? 0) + 1;
  return t;
};

/**
 * The whole contract in one function: every piece legal against the room it
 * names and against every other piece in that room. Returns the reasons so a
 * failure says which piece and why rather than just "false".
 */
function illegal(s: Suite, ps: Piece[]): string[] {
  const bad: string[] = [];
  for (const p of ps) {
    const r = s.rooms.find((x) => x.id === p.room);
    if (!r) {
      bad.push(`${p.id}: names room ${p.room}, which does not exist`);
      continue;
    }
    const others = ps.filter((o) => o !== p && o.room === p.room).map(pieceBox);
    const v = placeIsLegal(pieceBox(p), r, others);
    if (!v.ok) bad.push(`${p.id}: ${v.reason}`);
  }
  return bad;
}

/**
 * Pieces sharing floor anywhere in the suite, across rooms as well as within
 * them. Stronger than illegal(): a piece attributed to the wrong room could in
 * principle be legal there and still stand in another room's furniture.
 */
function collisions(ps: Piece[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < ps.length; i++) {
    for (let j = i + 1; j < ps.length; j++) {
      if (overlaps(pieceBox(ps[i]!), pieceBox(ps[j]!))) {
        bad.push(`${ps[i]!.id} / ${ps[j]!.id}`);
      }
    }
  }
  return bad;
}

/**
 * The clear landing a door needs, worked out here from buildWalls() rather than
 * taken from the module under test.
 *
 * The depth is written as a literal 2 and not imported, so that the landing this
 * file measures against is independent of the one furniture.ts places to. If the
 * assertions asked doorLandings() where the doors are, a wrong landing would agree
 * with itself and "no piece stands in a doorway" would pass on nothing.
 * tests/drag.test.ts carries the same helper for the same reason; the constant is
 * pinned against both modules' copies further down.
 */
const LANDING_DEPTH = 2;

function landing(w: Wall, o: Opening): Box {
  // Axis tie-break copied from buildOpenings(), which is what `offset` is measured
  // along. `offset` runs from the BAND's origin corner, and bands merge, so it
  // cannot be measured off the room.
  const alongV = !(w.du > w.dv);
  const c = LANDING_DEPTH;
  return alongV
    ? { u: w.u - c, v: w.v + o.offset, du: w.du + 2 * c, dv: o.width }
    : { u: w.u + o.offset, v: w.v - c, du: o.width, dv: w.dv + 2 * c };
}

/** Every doorway in a suite, with the floor it needs, id first for the messages. */
function doorwaysOf(s: Suite): { id: string; zone: Box }[] {
  const { walls, openings } = buildWalls(s);
  return openings
    .filter((o) => o.kind === "door")
    .map((o) => ({ id: o.id, zone: landing(walls.find((w) => w.id === o.wallId)!, o) }));
}

/**
 * Pieces standing on a doorway landing, as "piece / door" so a failure says which
 * piece is in which door rather than just how many there are.
 */
function inADoorway(s: Suite, ps: Piece[]): string[] {
  const bad: string[] = [];
  for (const d of doorwaysOf(s)) {
    for (const p of ps) {
      if (overlaps(pieceBox(p), d.zone)) bad.push(`${p.id} / ${d.id}`);
    }
  }
  return bad;
}

/** Clear floor in front of and behind a piece, in its own facing sense. */
function gaps(p: Piece, r: Rect): { back: number; front: number } {
  const f = pieceBox(p);
  const toLoV = f.v - r.v;
  const toHiV = r.v + r.dv - (f.v + f.dv);
  const toLoU = f.u - r.u;
  const toHiU = r.u + r.du - (f.u + f.du);
  switch (p.yaw) {
    case 0:
      return { back: toLoV, front: toHiV };
    case 90:
      return { back: toLoU, front: toHiU };
    case 180:
      return { back: toHiV, front: toLoV };
    default:
      return { back: toHiU, front: toLoU };
  }
}

/** Same deterministic generator as tests/rooms.test.ts and tests/collide.test.ts. */
const makeRnd = (seed0: number) => {
  let seed = seed0;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
};

const EPS = 1e-9;

describe("SIZES", () => {
  it("keeps the one sourced dimension exact: Harvard's 38 x 80 in mattress", () => {
    expect(MATTRESS.dv).toBe(38 / 12);
    expect(MATTRESS.du).toBe(80 / 12);
    expect(MATTRESS.du * MATTRESS.dv).toBeCloseTo(21.111, 3);
  });

  it("gives the bed frame room for that mattress and no less", () => {
    // The frame allowance is an assumption; the mattress it has to hold is not.
    // A frame that did not contain the mattress would be the fabrication this
    // whole table is trying not to be.
    expect(SIZES.bed.du).toBeGreaterThan(MATTRESS.du);
    expect(SIZES.bed.dv).toBeGreaterThan(MATTRESS.dv);
    expect(SIZES.bed.du - MATTRESS.du).toBeCloseTo(2 / 12, 12);
    expect(SIZES.bed.dv - MATTRESS.dv).toBeCloseTo(2 / 12, 12);
  });

  it("has a positive footprint and a height under the ceiling for every kind", () => {
    const kinds = Object.keys(SIZES) as FurnitureKind[];
    expect(kinds.length).toBe(7);
    for (const k of kinds) {
      const s = SIZES[k];
      expect(s.du, k).toBeGreaterThan(0);
      expect(s.dv, k).toBeGreaterThan(0);
      expect(s.h, k).toBeGreaterThan(0);
      // 10.75 ft, from the 12 ft floor-to-floor in docs/DIMENSION-AUDIT.md.
      expect(s.h, k).toBeLessThan(DEFAULT_PARAMS.ceiling);
      // Nothing is deeper than it is wide across its face; the recipes assume
      // du is the frontage when they back a piece against a wall.
      expect(s.du, k).toBeGreaterThanOrEqual(s.dv);
    }
  });
});

describe("layout at the defaults", () => {
  const pieces = layout(suite);

  it("fits out both bedrooms, the common room and K, and nothing else", () => {
    expect(new Set(pieces.map((p) => p.room))).toEqual(
      new Set(["bedA", "bedB", "common1", "k"]),
    );
    // The bath, the hall and the unknown strip are deliberately empty: a WC is a
    // fitting rather than furniture, and the strip's use is unknown, so anything
    // put there would be invented. Guard that these ids EXIST before asserting
    // they are empty -- the list said "closets" after that room was renamed to
    // "unknown", so the assertion was passing against a room that was not there.
    const unfurnished = ["bath", "hall", "unknown"];
    const ids = new Set(suite.rooms.map((r) => r.id));
    for (const id of unfurnished) expect(ids.has(id), `no room ${id}`).toBe(true);
    for (const id of unfurnished) {
      expect(inRoom(pieces, id), id).toEqual([]);
    }
  });

  it("puts four beds, four desks and four dressers in two bedrooms", () => {
    // docs/DIMENSION-AUDIT.md section 3: four people, two bedrooms, "two beds,
    // two desks, two dressers per bedroom".
    for (const id of ["bedA", "bedB"]) {
      expect(kindsOf(inRoom(pieces, id)), id).toEqual({
        bed: 2,
        desk: 2,
        chair: 2,
        dresser: 2,
      });
    }
    expect(kindsOf(inRoom(pieces, "common1"))).toEqual({
      sofa: 1,
      table: 1,
      chair: 2,
      shelf: 2,
    });
    // K as a study: a table, four chairs round it, a bookcase at each end. No
    // desks -- the four desks are the four in the bedrooms, one per student.
    expect(kindsOf(inRoom(pieces, "k"))).toEqual({ table: 1, chair: 4, shelf: 2 });
    expect(kindsOf(pieces)).toEqual({
      bed: 4,
      desk: 4,
      chair: 10,
      dresser: 4,
      sofa: 1,
      table: 2,
      shelf: 4,
    });
    expect(pieces.length).toBe(29);
  });

  it("is legal, piece by piece and pair by pair", () => {
    expect(illegal(suite, pieces)).toEqual([]);
    expect(collisions(pieces)).toEqual([]);
    for (const p of pieces) {
      expect(containedBy(pieceBox(p), roomOf(suite, p.room)), p.id).toBe(true);
    }
  });

  it("stands nothing in a doorway landing", () => {
    // The defect this whole arrangement was rebuilt for. Before layout() could see
    // openings it put six pieces across three of the five doors the suite had then:
    // both bedroom A desks and both bedroom B desks flush against the wall their
    // hall door is in, the common room sofa square across K's door, and one of K's
    // own chairs 0.25 ft into that same landing from the other side. Every one of
    // them was legal by placeIsLegal(), which is the point -- a suite you cannot
    // walk into passes every check collide.ts knows how to make, which is why
    // unreachableRooms() exists in rooms.ts and why this assertion exists here.
    expect(inADoorway(suite, pieces)).toEqual([]);

    // Non-vacuity, in three parts, because "no piece is in a doorway" is also true
    // of a suite with no doorways and of a landing measured as an empty box.
    //
    // SIX DOORS NOW, and d5 -- the hall's door into the common room -- is the one this
    // list has to keep naming, because it is the newest and the one a stale expectation
    // would silently stop covering. Its landing is u 16.5 to 19.5, v 13 to 17.5, and the
    // 2 ft of it that fall inside the common room, v 13 to 15, are floor commonSlots()
    // now has to keep clear. The default arrangement already does: the sofa is the
    // nearest piece and it stands at u 15 to 17.75, v 4.5 to 10.5.
    const doors = doorwaysOf(suite);
    expect(doors.map((d) => d.id)).toEqual(["d0", "d1", "d2", "d3", "d4", "d5"]);
    for (const d of doors) {
      expect(d.zone.du * d.zone.dv, d.id).toBeGreaterThan(0);
    }
    expect(doors.find((d) => d.id === "d5")!.zone).toEqual({ u: 16.5, v: 13, du: 3, dv: 4.5 });
    // And the six old positions really are inside the landings this file measures,
    // so the assertion above is testing the arrangement and not the measurement.
    const oldPositions: [string, Box][] = [
      ["bedA-desk-0", { u: 14, v: 15.5, du: 2, dv: 4 }],
      ["bedA-desk-1", { u: 14, v: 21.5, du: 2, dv: 4 }],
      ["bedB-desk-0", { u: 14, v: 34, du: 2, dv: 4 }],
      ["bedB-desk-1", { u: 14, v: 40, du: 2, dv: 4 }],
      ["common1-sofa-0", { u: 17.25, v: 4.5, du: 2.75, dv: 6 }],
      ["k-chair-1", { u: 22.25, v: 6.5, du: 1.5, dv: 1.5 }],
    ];
    for (const [id, was] of oldPositions) {
      expect(
        doors.some((d) => overlaps(was, d.zone)),
        `${id} used to stand in a doorway`,
      ).toBe(true);
    }
  });

  it("keeps its landing depth equal to the drag handler's, and measures it the same way", () => {
    // furniture.ts and drag.ts each hold their own DOOR_CLEARANCE, because
    // drag.ts imports furniture.ts for pieceBox and the reverse import would be a
    // cycle. Equal by assertion, then, rather than by construction: if they drift,
    // layout() emits an arrangement tryMove() will not let anyone put back.
    // drag.ts's copy is pinned to the same 2 ft in tests/drag.test.ts.
    expect(DOOR_CLEARANCE).toBe(LANDING_DEPTH);
    // And the whole landing, not only its depth: same rectangles, same order, as
    // the helper at the top of this file works out independently from buildWalls().
    expect(doorLandings(suite)).toEqual(doorwaysOf(suite).map((d) => d.zone));
  });

  it("leaves no piece both off the grid and inside GRID / 2 of a landing", () => {
    // THE PROPERTY THAT MAKES THE FIT-OUT RE-DROPPABLE, and the reason it is a
    // disjunction rather than the simpler "every designed anchor is on the grid".
    //
    // Ten of the 29 anchors are not on the grid and cannot be put there without
    // inventing dimensions. A bed frame is 82 x 40 in, so the second bed sits at a
    // third of a foot along the run and the dresser at each bed's foot starts at
    // u 6.833; a chair centred on a 4 ft desk frontage stands 1.25 ft in from its
    // edge. Those are Harvard's mattress and a real centring, and rounding either to
    // the nearest 0.5 ft to tidy this assertion up would be the laundering this
    // module's header refuses.
    //
    // What every piece does have to satisfy is weaker and sufficient. drag.ts snaps a
    // re-drop onto the same 0.5 ft grid, which moves an anchor by at most GRID / 2 on
    // each axis, and an overlap needs both axes to close -- so a piece can be put back
    // where it stands if its anchor is already on the grid, OR it keeps GRID / 2 clear
    // of every landing on at least one axis. Both branches carry real pieces here,
    // which is why the disjunction is asserted and not either half of it: k-chair-1
    // stands exactly ON d3's boundary and is safe only by its grid alignment, and the
    // four bedroom chairs are off the grid and safe only by their 1.25 ft of clearance.
    // The sofa used to satisfy neither, which is the defect commonSlots() closed.
    //
    // WHAT IT IS NOT SUFFICIENT FOR, and this is worth knowing here rather than only
    // where it is fixed: the disjunction is about LANDINGS, and a snap can carry a
    // piece into the FURNITURE beside it just as easily. It did -- the bedroom chair
    // is flush against its own desk, so it has no margin at all on that axis, and
    // once a slider takes a bedroom corner off the grid the snap puts it inside the
    // desk. This test cannot see that and passed throughout. "keeps every piece
    // re-droppable under collide.ts's snapping" at the bottom of this file is the
    // assertion that can, over randomised parameters rather than at the defaults.
    const zones = doorwaysOf(suite).map((d) => d.zone);
    /**
     * How far a landing is from this piece, as the gap a snap would have to close on
     * BOTH axes to put the piece in it -- so the larger of the two axis gaps, and the
     * nearest landing by that measure. Zero for a piece touching a boundary, and
     * negative for one standing in it, which is what inADoorway() above refuses.
     */
    const clear = (p: Piece) => {
      const f = pieceBox(p);
      const gap = (z: Box) =>
        Math.max(
          Math.max(z.u - (f.u + f.du), f.u - (z.u + z.du)),
          Math.max(z.v - (f.v + f.dv), f.v - (z.v + z.dv)),
        );
      return Math.min(...zones.map(gap));
    };
    const anchored = (p: Piece) =>
      [p.u, p.v].every((x) => Math.abs(x / GRID - Math.round(x / GRID)) < EPS);

    expect(
      pieces.filter((p) => !anchored(p) && clear(p) < GRID / 2 - EPS).map((p) => p.id),
    ).toEqual([]);

    // Non-vacuity for each branch separately, with the pieces named, so that a change
    // which empties one of them fails here rather than quietly turning the assertion
    // above into a statement about the other.
    expect(pieces.filter((p) => !anchored(p)).map((p) => p.id)).toEqual([
      "bedA-bed-1",
      "bedA-chair-0",
      "bedA-chair-1",
      "bedA-dresser-0",
      "bedA-dresser-1",
      "bedB-bed-1",
      "bedB-chair-0",
      "bedB-chair-1",
      "bedB-dresser-0",
      "bedB-dresser-1",
    ]);
    expect(pieces.filter((p) => clear(p) < GRID / 2 - EPS).map((p) => p.id)).toEqual([
      "k-chair-1",
    ]);
    // And the two numbers that branch turns on: K's chair has no margin at all, and
    // the sofa now has exactly the half-step, which is the tightest a piece can be and
    // still be safe on clearance alone.
    expect(clear(pieces.find((p) => p.id === "k-chair-1")!)).toBeCloseTo(0, 12);
    expect(clear(pieces.find((p) => p.id === "common1-sofa-0")!)).toBeCloseTo(GRID / 2, 12);
  });

  it("gives every piece a unique id and repeats itself exactly", () => {
    expect(new Set(pieces.map((p) => p.id)).size).toBe(pieces.length);
    // Nothing here may depend on Set or Map iteration luck, or on a clock: the
    // renderer keys instanced meshes off these ids across re-renders.
    expect(layout(suite)).toEqual(pieces);
  });

  it("places both beds in a bedroom against the long walls, heads to the facade", () => {
    // The load-bearing arrangement, spelled out rather than merely asserted to
    // be legal: 16 ft of depth runs along u from the facade at u = 0, and the
    // 10 ft run along v takes one bed against each long wall.
    const bedA = roomOf(suite, "bedA");
    expect([bedA.du, bedA.dv]).toEqual([16, 10]);
    const beds = inRoom(pieces, "bedA").filter((p) => p.kind === "bed");
    expect(beds.map((b) => b.id)).toEqual(["bedA-bed-0", "bedA-bed-1"]);
    for (const b of beds) {
      const f = pieceBox(b);
      expect(f.u, b.id).toBe(bedA.u); // head against the facade wall
      expect(f.du, b.id).toBeCloseTo(SIZES.bed.du, 12); // length along the 16 ft depth
    }
    expect(pieceBox(beds[0]!).v).toBe(bedA.v);
    expect(pieceBox(beds[1]!).v + SIZES.bed.dv).toBeCloseTo(bedA.v + bedA.dv, 12);
    expect(beds[0]!.yaw).toBe(0); // faces +v, into the aisle
    expect(beds[1]!.yaw).toBe(180); // faces -v, into the same aisle
  });

  it("stands each dresser at the foot of its own bed and each chair at its own desk", () => {
    const bedA = roomOf(suite, "bedA");
    const ps = inRoom(pieces, "bedA");
    const pick = (k: FurnitureKind) =>
      ps.filter((p) => p.kind === k).map((p) => ({ p, f: pieceBox(p) }));
    const beds = pick("bed");
    const desks = pick("desk");
    const chairs = pick("chair");
    const dressers = pick("dresser");

    for (const i of [0, 1]) {
      // Dresser at the foot of bed i, against the same long wall, so the two
      // students' things stay on their own sides of the room.
      expect(dressers[i]!.f.u, `dresser ${i}`).toBeCloseTo(
        beds[i]!.f.u + beds[i]!.f.du,
        12,
      );
      const wallV = i === 0 ? bedA.v : bedA.v + bedA.dv;
      expect(
        i === 0 ? dressers[i]!.f.v : dressers[i]!.f.v + dressers[i]!.f.dv,
        `dresser ${i}`,
      ).toBeCloseTo(wallV, 12);
      expect(dressers[i]!.p.yaw, `dresser ${i}`).toBe(beds[i]!.p.yaw);

      // Desk against that same long wall, third in the line, as deep into the
      // room as the hall door's landing allows. It used to stand flush against
      // the far end wall with its 4 ft frontage along the run, which is the
      // position that put two desks across a 3 ft door in that same wall; turned
      // a quarter and pulled back by DOOR_CLEARANCE it clears the landing and
      // stands flush against its edge.
      expect(desks[i]!.f.u + desks[i]!.f.du, `desk ${i}`).toBeCloseTo(
        bedA.u + bedA.du - DOOR_CLEARANCE,
        12,
      );
      expect(
        i === 0 ? desks[i]!.f.v : desks[i]!.f.v + desks[i]!.f.dv,
        `desk ${i}`,
      ).toBeCloseTo(wallV, 12);
      expect(desks[i]!.p.yaw, `desk ${i}`).toBe(beds[i]!.p.yaw);

      // Chair pulled out in front of the desk, centred on its 4 ft frontage and
      // flush against its face, turned to look back at it.
      expect(chairs[i]!.f.u - desks[i]!.f.u, `chair ${i}`).toBeCloseTo(
        desks[i]!.f.u + desks[i]!.f.du - (chairs[i]!.f.u + chairs[i]!.f.du),
        12,
      );
      const deskFace = i === 0 ? desks[i]!.f.v + desks[i]!.f.dv : desks[i]!.f.v;
      const chairAtIt = i === 0 ? chairs[i]!.f.v : chairs[i]!.f.v + chairs[i]!.f.dv;
      expect(chairAtIt, `chair ${i}`).toBeCloseTo(deskFace, 12);
      expect(chairs[i]!.p.yaw, `chair ${i}`).toBe(i === 0 ? 180 : 0);
    }
    // And the two stations are on opposite walls, not stacked on one.
    expect(dressers[0]!.f.v).toBeLessThan(dressers[1]!.f.v);
    expect(desks[0]!.f.v).toBeLessThan(desks[1]!.f.v);
  });

  it("answers the question the phase spec asks: two beds, two desks and two dressers do fit", () => {
    const bedA = roomOf(suite, "bedA");
    const ps = inRoom(pieces, "bedA");

    // Across the 10 ft run: two 40 in beds leave a 3.33 ft aisle, which is the
    // long side of both and comfortably over BED_CLEARANCE.
    const aisle = bedA.dv - 2 * SIZES.bed.dv;
    expect(aisle).toBeCloseTo(3.3333, 4);
    expect(aisle).toBeGreaterThan(BED_CLEARANCE);
    for (const b of ps.filter((p) => p.kind === "bed")) {
      expect(bedClearance(b, bedA, ps), b.id).toBeCloseTo(aisle, 12);
    }

    // Along the 16 ft depth: bed, dresser, desk in one line against the station's
    // own wall. Added up from the footprints layout() actually placed, not from
    // SIZES -- which extent of each piece runs along the depth depends on how the
    // recipe turned it, so summing the table is a true statement about the
    // constants and not about this arrangement. It was that substitution that had
    // the dresser down as 18 in when it stands unturned at 30, overstating the
    // free floor by a foot.
    const along = (id: string) => {
      const p = ps.find((x) => x.id === id);
      expect(p, id).toBeDefined();
      return pieceBox(p!).du; // u is the depth in bedroom A
    };
    const depths = ["bed", "dresser", "desk"].map((k) => along(`bedA-${k}-0`));
    expect(depths.map((d) => Math.round(d * 12))).toEqual([82, 30, 48]);
    const band = depths.reduce((s, d) => s + d, 0);
    expect(band).toBeCloseTo(160 / 12, 12);
    expect(band).toBeCloseTo(13.3333, 4);
    // The desk contributes 48 in and not the 24 it used to, because the door is
    // what turned it a quarter. The band grew by 6 in and the room got EASIER,
    // which is the whole point of the trade: the 2 ft it gave back across the run
    // is what lets a 3 ft door into that wall at all.
    expect(bedA.du - band).toBeCloseTo(2.6667, 4);
    expect(bedA.du - band).toBeGreaterThan(DOOR_CLEARANCE);
    // And station 1's three pieces measure the same, so one station is the band.
    expect(
      ["bed", "dresser", "desk"].reduce((s, k) => s + along(`bedA-${k}-1`), 0),
    ).toBeCloseTo(band, 12);

    // The chair is not in that line: it stands out in front of the desk, inside
    // the desk's own stretch of the depth, which is why it costs the band nothing.
    const desk0 = pieceBox(ps.find((x) => x.id === "bedA-desk-0")!);
    const chair0 = pieceBox(ps.find((x) => x.id === "bedA-chair-0")!);
    expect(chair0.u).toBeGreaterThanOrEqual(desk0.u - EPS);
    expect(chair0.u + chair0.du).toBeLessThanOrEqual(desk0.u + desk0.du + EPS);
    // What it costs instead is the run: desk 24 in plus chair 18 in is 3.5 ft off
    // each station's wall, so the two stations spend 7 ft of the 10 and leave
    // exactly the 3 ft a door needs. That is why the desks stand clear of the far
    // wall rather than in its two corners -- see farLimit().
    expect(SIZES.desk.dv + SIZES.chair.du).toBeCloseTo(3.5, 12);
    expect(bedA.dv - 2 * (SIZES.desk.dv + SIZES.chair.du)).toBeCloseTo(3, 12);

    // So the run still binds first, and it binds well outside the resident's stated one
    // foot of uncertainty on the 10: the second bed keeps its 2 ft down to 8.67 ft
    // and keeps its place at all down to 6.67 ft. The depth binds second, at band
    // plus landing = 15.33 ft, which IS inside that one foot -- so a bedroom at the
    // bottom of the stated range has its desks rescued rather than designed.
    expect(2 * SIZES.bed.dv + BED_CLEARANCE).toBeCloseTo(8.6667, 4);
    expect(bedA.dv - (2 * SIZES.bed.dv + BED_CLEARANCE)).toBeGreaterThan(1);
    expect(band + DOOR_CLEARANCE).toBeCloseTo(15.3333, 4);
    expect(bedA.du - (band + DOOR_CLEARANCE)).toBeLessThan(1);
  });

  it("arranges the common room round the sofa, with the table clear of it", () => {
    const r = roomOf(suite, "common1");
    const ps = inRoom(pieces, "common1");
    const one = (k: FurnitureKind) => {
      const hit = ps.filter((p) => p.kind === k);
      expect(hit.length, k).toBeGreaterThan(0);
      return hit;
    };
    const sofa = pieceBox(one("sofa")[0]!);
    const table = pieceBox(one("table")[0]!);

    // Facing the facade and its window, back toward the inner end wall but not
    // against it: K's door is in that wall, centred on the room's 15 ft run, and a
    // 6 ft sofa centred on the same run covered v 4.5 to 10.5 of it against a
    // doorway at v 6 to 9. The whole group is pulled back by DOOR_CLEARANCE
    // instead, which the 20 ft depth can afford.
    //
    // WHY THIS IS NO LONGER AN EQUALITY. It asserted that the far edge fell exactly
    // ON the landing boundary at u 18, which is where farLimit() alone put it: legal,
    // since touching a landing is not standing in one, and impossible to put back.
    // The anchor was u 15.25, a quarter foot off the grid, so drag.ts snapped a
    // re-drop to 15.5 and carried that edge into the landing. commonSlots() now lands
    // the anchor on the grid instead, which costs the room a quarter foot of depth it
    // has no use for and makes the whole fit-out re-droppable -- see the sofa note
    // there, and tests/drag.test.ts for the half of the claim that involves drag.ts.
    expect(sofa.u).toBe(15);
    expect(sofa.u + sofa.du).toBeCloseTo(r.u + r.du - DOOR_CLEARANCE - GRID / 2, 12);
    // Still as deep as the grid allows: one step further back would waste half a foot
    // of floor, one step forward is inside the landing. Both halves, because "on the
    // grid" alone would also be satisfied by a sofa parked at the window.
    expect(sofa.u + sofa.du + GRID).toBeGreaterThan(r.u + r.du - DOOR_CLEARANCE);
    expect(sofa.u + sofa.du).toBeLessThanOrEqual(r.u + r.du - DOOR_CLEARANCE + EPS);
    expect(one("sofa")[0]!.yaw).toBe(270);
    expect(sofa.v - r.v).toBeCloseTo(r.v + r.dv - (sofa.v + sofa.dv), 12);
    // Clear floor between the sofa and the table, so you can get to the sofa.
    expect(sofa.u - (table.u + table.du)).toBeCloseTo(3 * GRID, 12);
    expect(table.v - r.v).toBeCloseTo(r.v + r.dv - (table.v + table.dv), 12);
    // Chairs flank the table, one to either side, a grid step clear of it.
    const chairs = one("chair").map(pieceBox).sort((a, b) => a.v - b.v);
    expect(chairs.length).toBe(2);
    expect(table.v - (chairs[0]!.v + chairs[0]!.dv)).toBeCloseTo(GRID, 12);
    expect(chairs[1]!.v - (table.v + table.dv)).toBeCloseTo(GRID, 12);
    // Bookcases against the two side walls, clear of the window wall.
    for (const shelf of one("shelf").map(pieceBox)) {
      const toSide = Math.min(shelf.v - r.v, r.v + r.dv - (shelf.v + shelf.dv));
      expect(toSide).toBeCloseTo(0, 12);
      expect(shelf.u - r.u).toBeGreaterThan(0);
    }
  });

  it("centres K's study table with a chair at each end of both long sides", () => {
    const r = roomOf(suite, "k");
    const ps = inRoom(pieces, "k");
    const table = pieceBox(ps.find((p) => p.kind === "table")!);
    // Centred along the room's 12 ft length: a study table you sit round, not a
    // piece of casework.
    expect(table.v - r.v).toBeCloseTo(r.v + r.dv - (table.v + table.dv), 12);
    // Across the 10 ft width it is centred too, until K's own doorway says
    // otherwise. The seated group is the table plus a grid step and a chair on each
    // side, 6.5 ft of the 10, so centred it would leave 1.75 ft either side -- and
    // the door off the common room, in K's u = 20.5 wall, needs DOOR_CLEARANCE. So
    // the group sits a quarter foot off centre, away from that wall, which is the
    // whole cost of making this room door-aware. Rescuing the one chair that stood
    // in the landing would have bought the same 3 inches and left the four chairs
    // no longer symmetric about the table.
    const group = SIZES.table.dv + 2 * (GRID + SIZES.chair.du);
    expect(group).toBeCloseTo(6.5, 12);
    expect((r.du - group) / 2).toBeCloseTo(1.75, 12);
    expect(table.u - r.u).toBeCloseTo(r.u + r.du - (table.u + table.du) + 0.5, 12);
    // Two chairs on each long side, a grid step clear, and the pair at the
    // table's two ends rather than stacked at one.
    const chairs = ps.filter((p) => p.kind === "chair").map(pieceBox);
    expect(chairs.length).toBe(4);
    // The pair on the doorway side stands exactly DOOR_CLEARANCE off that wall.
    expect(Math.min(...chairs.map((c) => c.u)) - r.u).toBeCloseTo(DOOR_CLEARANCE, 12);
    const near = chairs.filter((c) => c.u + c.du <= table.u + 1e-9);
    const far = chairs.filter((c) => c.u >= table.u + table.du - 1e-9);
    expect([near.length, far.length]).toEqual([2, 2]);
    for (const c of near) expect(table.u - (c.u + c.du)).toBeCloseTo(GRID, 12);
    for (const c of far) expect(c.u - (table.u + table.du)).toBeCloseTo(GRID, 12);
    for (const side of [near, far]) {
      expect(side[0]!.v).toBeCloseTo(table.v, 12);
      expect(side[1]!.v + side[1]!.dv).toBeCloseTo(table.v + table.dv, 12);
      expect(side[1]!.v - side[0]!.v).toBeGreaterThan(0);
    }
    // A bookcase flush against each end wall, centred on the room's width so it
    // reads as part of the arrangement rather than shoved into a corner.
    const shelves = inRoom(pieces, "k").filter((p) => p.kind === "shelf").map(pieceBox);
    expect(shelves.length).toBe(2);
    for (const sh of shelves) {
      expect(sh.u - r.u).toBeCloseTo(r.u + r.du - (sh.u + sh.du), 12);
      const toEnd = Math.min(sh.v - r.v, r.v + r.dv - (sh.v + sh.dv));
      expect(toEnd).toBeCloseTo(0, 12);
    }
    expect(shelves[0]!.v).not.toBeCloseTo(shelves[1]!.v, 6); // one at each end
  });

  it("never sits a piece facing a wall with open floor behind it", () => {
    // yaw is the renderer's only cue for which way a desk or a sofa is turned,
    // so a wrong one is invisible to every legality check and glaring on screen.
    let backedToAWall = 0;
    for (const p of pieces) {
      const g = gaps(p, roomOf(suite, p.room));
      if (g.back <= EPS) backedToAWall++;
      else expect(g.front, `${p.id} faces its own wall`).toBeGreaterThan(EPS);
    }
    // Non-vacuity: the claim is only worth anything if pieces really are backed
    // against walls. Measured at the defaults: 16 of the 29 -- 17 before the sofa
    // came off the wall K's door is in.
    expect(backedToAWall).toBeGreaterThanOrEqual(15);
  });

  it("keeps du and dv unrotated, so pieceBox is the thing that turns them", () => {
    for (const p of pieces) {
      expect([p.du, p.dv], p.id).toEqual([SIZES[p.kind].du, SIZES[p.kind].dv]);
      expect(p.h, p.id).toBe(SIZES[p.kind].h);
      const f = pieceBox(p);
      expect(f.du * f.dv, p.id).toBeCloseTo(p.du * p.dv, 12);
      expect(f.rot, p.id).toBe(0); // already discharged, safe to re-footprint
      expect(footprintOf(f), p.id).toEqual(f);
      const turned = p.yaw === 90 || p.yaw === 270;
      expect(f.du, p.id).toBeCloseTo(turned ? p.dv : p.du, 12);
    }
  });
});

describe("opts.beds", () => {
  it("is the occupancy: desks and dressers follow the beds", () => {
    for (const beds of [0, 1, 2, 3, 4]) {
      const ps = layout(suite, { beds });
      const t = kindsOf(ps);
      expect(t.bed ?? 0, `beds ${beds}`).toBe(beds);
      expect(t.desk ?? 0, `beds ${beds}`).toBe(beds);
      expect(t.dresser ?? 0, `beds ${beds}`).toBe(beds);
      // The common room and K are fitted out whether or not anyone sleeps here.
      expect(t.sofa, `beds ${beds}`).toBe(1);
      expect(t.table, `beds ${beds}`).toBe(2);
      expect(illegal(suite, ps), `beds ${beds}`).toEqual([]);
    }
  });

  it("fills bedroom A before bedroom B, which is the door order off the hall", () => {
    const one = layout(suite, { beds: 1 });
    expect(one.filter((p) => p.kind === "bed").map((p) => p.room)).toEqual(["bedA"]);
    const three = layout(suite, { beds: 3 });
    expect(three.filter((p) => p.kind === "bed").map((p) => p.room)).toEqual([
      "bedA",
      "bedA",
      "bedB",
    ]);
  });

  it("caps at two to a bedroom rather than stacking a fifth student in somewhere", () => {
    // Two doubles is what the housing assignment says. A caller asking for six
    // gets four and no overlap, not six beds jammed into 320 sq ft.
    const six = layout(suite, { beds: 6 });
    expect(six.filter((p) => p.kind === "bed").length).toBe(4);
    expect(illegal(suite, six)).toEqual([]);
    expect(collisions(six)).toEqual([]);

    // Tested in a bedroom with room for a third, so that the cap is what holds
    // and not the plaster. A 20 ft run takes six 40 in beds across it.
    const roomy = buildSuite({ ...DEFAULT_PARAMS, bedAAlong: 20, sectionLength: 54 });
    const bedA = roomOf(roomy, "bedA");
    expect(bedA.dv).toBe(20);
    expect(Math.floor(bedA.dv / SIZES.bed.dv)).toBeGreaterThanOrEqual(3);
    const ps = layout(roomy, { beds: 6 });
    expect(inRoom(ps, "bedA").filter((p) => p.kind === "bed").length).toBe(2);
    expect(illegal(roomy, ps)).toEqual([]);
  });
});

describe("bedClearance", () => {
  const bedA = roomOf(suite, "bedA");
  const bed = (v: number, id = "probe"): Piece => ({
    id,
    kind: "bed",
    room: "bedA",
    u: bedA.u,
    v,
    du: SIZES.bed.du,
    dv: SIZES.bed.dv,
    h: SIZES.bed.h,
    yaw: 0,
  });

  it("measures the deeper of the two long sides", () => {
    // Flush against the south partition: 0 behind, the rest of the run in front.
    expect(bedClearance(bed(bedA.v), bedA, [])).toBeCloseTo(bedA.dv - SIZES.bed.dv, 12);
    // Centred: half the slack each side, and the answer is the same half.
    const mid = bedA.v + (bedA.dv - SIZES.bed.dv) / 2;
    expect(bedClearance(bed(mid), bedA, [])).toBeCloseTo((bedA.dv - SIZES.bed.dv) / 2, 12);
  });

  it("counts a shared aisle for both beds, which is why two fit at all", () => {
    const a = bed(bedA.v, "a");
    const b = bed(bedA.v + bedA.dv - SIZES.bed.dv, "b");
    const aisle = bedA.dv - 2 * SIZES.bed.dv;
    expect(bedClearance(a, bedA, [a, b])).toBeCloseTo(aisle, 12);
    expect(bedClearance(b, bedA, [a, b])).toBeCloseTo(aisle, 12);
  });

  it("ignores anything past the foot of the bed, even out in the aisle, and counts one alongside it", () => {
    const a = bed(bedA.v, "a");
    const open = bedA.dv - SIZES.bed.dv;
    const foot: Piece = {
      id: "foot",
      kind: "dresser",
      room: "bedA",
      u: bedA.u + SIZES.bed.du, // beyond the end of the bed, not beside it
      v: bedA.v,
      du: SIZES.dresser.du,
      dv: SIZES.dresser.dv,
      h: SIZES.dresser.h,
      yaw: 0,
    };
    expect(bedClearance(a, bedA, [a, foot])).toBeCloseTo(open, 12);

    // The case that actually pins the span-overlap filter, and the reason `foot`
    // on its own does not: `foot` is flush to the bed's own wall, so it sits
    // inside the bed's side band and the gHi <= lo / gLo >= hi tests throw it out
    // regardless. Move it a foot into the aisle and only the span filter stands
    // between it and a bogus 1 ft answer -- delete that line and this is the
    // assertion that fails.
    const diagonal: Piece = { ...foot, id: "diagonal", v: bedA.v + SIZES.bed.dv + 1 };
    expect(pieceBox(diagonal).u).toBeGreaterThanOrEqual(SIZES.bed.du + bedA.u - EPS);
    expect(pieceBox(diagonal).v).toBeGreaterThan(bedA.v + SIZES.bed.dv);
    expect(bedClearance(a, bedA, [a, diagonal])).toBeCloseTo(open, 12);

    // Slide the same dresser back alongside the bed and it eats the aisle.
    const beside: Piece = { ...diagonal, id: "beside", u: bedA.u };
    expect(bedClearance(a, bedA, [a, beside])).toBeCloseTo(1, 12);
  });
});

describe("degrading when the walls move in", () => {
  it("moves a piece rather than overlapping when its designed slot is gone", () => {
    // An 11 ft deep bedroom is 2.33 ft short of the bed-dresser-desk band, so
    // nothing after the beds can stand where the recipe puts it. bathDeep comes
    // down with it to keep the unknown strip a positive width.
    const p: SuiteParams = { ...DEFAULT_PARAMS, bedDepth: 11, bathDeep: 6 };
    p.legDepth = p.hallWidth + p.partition + p.bedDepth;
    const s = buildSuite(p);
    expect(findOverlaps(s.rooms)).toEqual([]);
    const bedA = roomOf(s, "bedA");
    expect(bedA.du).toBe(11);
    // Same band as the fit test above and measured the same way, off the default
    // suite's 16 ft bedroom where the recipe's own station does stand. Measuring
    // it in this 11 ft room instead would be circular: the pieces here are the
    // rescued positions, which is the thing under test.
    const stated = layout(suite);
    const band = ["bed", "dresser", "desk"].reduce(
      (t, k) => t + pieceBox(stated.find((x) => x.id === `bedA-${k}-0`)!).du,
      0,
    );
    expect(band).toBeCloseTo(13.3333, 4);
    expect(band - bedA.du).toBeCloseTo(2.3333, 4);

    const ps = layout(s);
    expect(illegal(s, ps)).toEqual([]);
    expect(collisions(ps)).toEqual([]);
    expect(inADoorway(s, ps)).toEqual([]);
    // Nothing dropped: the dressers were rescued, not abandoned.
    expect(kindsOf(inRoom(ps, "bedA"))).toEqual({ bed: 2, desk: 2, chair: 2, dresser: 2 });
    const dressers = inRoom(ps, "bedA").filter((x) => x.kind === "dresser");
    expect(dressers.map((d) => d.id)).toEqual(["bedA-dresser-0", "bedA-dresser-1"]);
    // Where they actually land. Pinned exactly, because the scan is the only
    // code here that picks coordinates freely and this is the one case that
    // exercises it: both anchors are on collide.ts's 0.5 ft grid, both keep the
    // orientation the recipe asked for, and each stays on the side of the room its
    // own station was on rather than crossing over the other's.
    expect(dressers.map((d) => [pieceBox(d).u, pieceBox(d).v, d.yaw])).toEqual([
      [8.5, 17.5, 0],
      [8.5, 22, 180],
    ]);
    // The desks are rescued here too, and where they go is what shows the two ways
    // out of a doorway working together: the landing takes u 9 to 11 across v 19 to
    // 22, and each desk goes flush against the far end wall in its own corner --
    // deeper than the recipe designed, which is legal because it clears the door
    // across the run instead of along the depth.
    expect(
      inRoom(ps, "bedA")
        .filter((x) => x.kind === "desk")
        .map((d) => [pieceBox(d).u + pieceBox(d).du, pieceBox(d).v]),
    ).toEqual([
      [11, 15.5],
      [11, 23.5],
    ]);
    for (const d of dressers) {
      const f = pieceBox(d);
      expect(f.u, d.id).not.toBeCloseTo(bedA.u + SIZES.bed.du, 6);
      for (const x of [f.u, f.v]) {
        expect(Math.abs(x / GRID - Math.round(x / GRID)), `${d.id} anchor ${x}`).toBeLessThan(
          1e-9,
        );
      }
    }
    // And the rescue did not eat the aisle, which is the trap: a legal dresser
    // in the gap between the beds would pass every check in collide.ts.
    for (const b of inRoom(ps, "bedA").filter((x) => x.kind === "bed")) {
      expect(bedClearance(b, bedA, inRoom(ps, "bedA")), b.id).toBeGreaterThanOrEqual(
        BED_CLEARANCE - EPS,
      );
    }
  });

  it("drops the second bed instead of overlapping it when the run is too short", () => {
    // 5 ft along the hall holds one 40 in bed across it, not two.
    const s = buildSuite({ ...DEFAULT_PARAMS, bedAAlong: 5 });
    expect(findOverlaps(s.rooms)).toEqual([]);
    const bedA = roomOf(s, "bedA");
    expect(bedA.dv).toBe(5);
    expect(2 * SIZES.bed.dv).toBeGreaterThan(bedA.dv);

    const ps = layout(s);
    expect(illegal(s, ps)).toEqual([]);
    expect(collisions(ps)).toEqual([]);
    // Two still fit, but only end to end along the 16 ft depth, and neither can
    // have its 2 ft any more. Legal and honest beats legal and pretending.
    const beds = inRoom(ps, "bedA").filter((x) => x.kind === "bed");
    expect(beds.length).toBe(2);
    expect(new Set(beds.map((b) => pieceBox(b).u)).size).toBe(2);
    for (const b of beds) {
      expect(bedClearance(b, bedA, inRoom(ps, "bedA")), b.id).toBeLessThan(BED_CLEARANCE);
    }
    // Bedroom B is untouched by A's troubles.
    expect(kindsOf(inRoom(ps, "bedB"))).toEqual({ bed: 2, desk: 2, chair: 2, dresser: 2 });
  });

  it("puts the beds end to end when the run is too short, and the door then costs both of them their 2 ft", () => {
    // A 7 ft run cannot take two 40 in beds and a 2 ft aisle. Side by side both
    // beds would be boxed in; end to end along the 16 ft depth each of them has
    // 3.67 ft of clear floor down its long side, so that is what settle()'s strict
    // pass goes looking for and it is still what it finds.
    const s = buildSuite({ ...DEFAULT_PARAMS, bedAAlong: 7 });
    const bedA = roomOf(s, "bedA");
    expect(bedA.dv).toBe(7);
    expect(2 * SIZES.bed.dv + BED_CLEARANCE).toBeGreaterThan(bedA.dv);

    const ps = layout(s);
    expect(illegal(s, ps)).toEqual([]);
    expect(collisions(ps)).toEqual([]);
    expect(inADoorway(s, ps)).toEqual([]);
    const mine = inRoom(ps, "bedA");
    const beds = mine.filter((x) => x.kind === "bed");
    expect(beds.length).toBe(2);
    // End to end, not side by side.
    expect(pieceBox(beds[1]!).u).toBeGreaterThanOrEqual(
      pieceBox(beds[0]!).u + pieceBox(beds[0]!).du,
    );
    // With the beds alone down, both have their 2 ft: 7 ft of run less a 3.33 ft
    // bed is 3.67, and the two beds do not stand beside each other.
    for (const b of beds) {
      expect(bedClearance(b, bedA, beds), b.id).toBeCloseTo(bedA.dv - SIZES.bed.dv, 12);
    }

    // THEN THE SECOND DESK ARRIVES, AND THE DOORWAY IS WHY IT LANDS WHERE IT DOES.
    // This room is over-full -- 7 x 16 with two beds, two desks, two chairs, two
    // dressers and a 3 ft door -- and it is 3 ft outside the resident's stated 10 with a
    // foot of uncertainty, so it is a degradation case and not a design target. The
    // arithmetic is worth pinning because the doorway is precisely what costs it:
    // with the beds end to end, bed 1 fills station 1's whole far region, and the
    // one remaining spot that would have taken desk 1 without crowding bed 0 is
    // u 14 to 16 turned upright -- which is inside the hall door's landing.
    const desk1 = mine.find((x) => x.id === "bedA-desk-1")!;
    const wouldHaveFit: Box = { u: 14, v: 18.5, du: 2, dv: 4 };
    expect(containedBy(wouldHaveFit, bedA)).toBe(true);
    expect(collisions([...beds, mine.find((x) => x.id === "bedA-desk-0")!])).toEqual([]);
    expect(doorwaysOf(s).some((d) => overlaps(wouldHaveFit, d.zone))).toBe(true);
    // So it is rescued into bed 0's side band instead, and both beds end up tight.
    // Legal, walkable at every door, and stated rather than pretended: the
    // alternative was dropping the desk, which the permissive pass exists not to do.
    expect([pieceBox(desk1).u, pieceBox(desk1).v]).toEqual([3, 20.5]);
    for (const b of beds) {
      expect(bedClearance(b, bedA, mine), b.id).toBeLessThan(BED_CLEARANCE);
    }
  });

  it("returns nothing for a room no piece fits, without throwing", () => {
    const s = buildSuite({ ...DEFAULT_PARAMS, bedAAlong: 0.5 });
    const ps = layout(s);
    expect(inRoom(ps, "bedA")).toEqual([]);
    expect(illegal(s, ps)).toEqual([]);
    expect(collisions(ps)).toEqual([]);
    // Beds allotted to a bedroom that cannot hold them are dropped, not moved
    // next door: occupancy is per room and this module does not reassign it.
    expect(ps.filter((x) => x.kind === "bed").map((x) => x.room)).toEqual(["bedB", "bedB"]);
  });

  it("turns a piece to suit a bedroom whose long axis is the other one", () => {
    // Bedroom B absorbs the section's residual, so a long section makes it
    // longer along v than it is deep. The recipe has to follow.
    const s = buildSuite({ ...DEFAULT_PARAMS, sectionLength: 54 });
    const bedB = roomOf(s, "bedB");
    expect(bedB.dv).toBeGreaterThan(bedB.du);
    const ps = layout(s);
    expect(illegal(s, ps)).toEqual([]);
    const beds = inRoom(ps, "bedB").filter((x) => x.kind === "bed");
    expect(beds.length).toBe(2);
    for (const b of beds) {
      // Length now runs along v, so the footprint is turned.
      expect([b.yaw === 90 || b.yaw === 270, pieceBox(b).dv], b.id).toEqual([
        true,
        SIZES.bed.du,
      ]);
      expect(bedClearance(b, bedB, inRoom(ps, "bedB")), b.id).toBeGreaterThanOrEqual(
        BED_CLEARANCE - EPS,
      );
    }
  });
});

describe("property sweep over randomised suites", () => {
  /**
   * A parameter set with every stated dimension inside its stated tolerance.
   *
   * The section length is derived rather than jittered on its own, because
   * buildSuite() gives bedroom B whatever the section has left over: jittering
   * both independently sets the bedroom's size by subtraction of two random
   * numbers and it goes to nothing. Deriving it keeps residuals.along at zero,
   * which is the closure tests/rooms.test.ts asserts at the defaults.
   *
   * Spreads: the resident's own "could be off by about a foot" on everything he stated,
   * doubled where he gave a range himself (the common room's 15-20 depth) or
   * where the number is inferred rather than stated (the bathroom, the hall).
   */
  const plausible = (rnd: () => number): SuiteParams => {
    const jitter = (base: number, spread: number) => base + (rnd() * 2 - 1) * spread;
    const p: SuiteParams = {
      ...DEFAULT_PARAMS,
      hallWidth: jitter(4.5, 1),
      bedDepth: jitter(16, 1),
      commonAlong: jitter(15, 1),
      commonDeep: jitter(20, 2),
      bedAAlong: jitter(10, 1),
      bedBAlong: jitter(10, 1),
      bathAlong: jitter(8, 2),
      bathDeep: jitter(8, 1.5),
      kDeep: jitter(10, 1),
      kAlong: jitter(12, 1),
    };
    p.legDepth = p.hallWidth + p.partition + p.bedDepth;
    p.sectionLength =
      p.commonAlong + p.bedAAlong + p.bathAlong + p.bedBAlong + 3 * p.partition;
    return p;
  };

  it("keeps the whole fit-out legal over 240 plausible parameter sets", () => {
    const rnd = makeRnd(20260729);
    const seen = { du: [Infinity, -Infinity], dv: [Infinity, -Infinity] };
    for (let i = 0; i < 240; i++) {
      const s = buildSuite(plausible(rnd));
      // If this trips, the generator is wrong, not the layout.
      expect(findOverlaps(s.rooms), `iteration ${i} setup`).toEqual([]);

      const ps = layout(s);
      expect(illegal(s, ps), `iteration ${i}`).toEqual([]);
      expect(collisions(ps), `iteration ${i}`).toEqual([]);
      // Every doorway walkable, at every one of these parameter sets. The doors
      // move with the walls -- buildOpenings() centres each one on its own band --
      // so this is the assertion that says the fit-out follows them rather than
      // that it happens to clear the five it was designed against.
      expect(inADoorway(s, ps), `iteration ${i}`).toEqual([]);
      // Within the stated tolerances the designed arrangement always fits, so
      // nothing may quietly go missing: a drop here means a real conflict.
      expect(ps.length, `iteration ${i}`).toBe(29);
      expect(kindsOf(ps), `iteration ${i}`).toEqual({
        bed: 4,
        desk: 4,
        chair: 10,
        dresser: 4,
        sofa: 1,
        table: 2,
        shelf: 4,
      });
      // And every bed keeps the 2 ft you need to get into it.
      for (const b of ps.filter((p) => p.kind === "bed")) {
        const r = roomOf(s, b.room);
        expect(
          bedClearance(b, r, inRoom(ps, b.room)),
          `iteration ${i} ${b.id}`,
        ).toBeGreaterThanOrEqual(BED_CLEARANCE - EPS);
      }
      for (const b of ["bedA", "bedB"]) {
        const r = roomOf(s, b);
        seen.du = [Math.min(seen.du[0]!, r.du), Math.max(seen.du[1]!, r.du)];
        seen.dv = [Math.min(seen.dv[0]!, r.dv), Math.max(seen.dv[1]!, r.dv)];
      }
    }
    // Non-vacuity: the walls really did move. Measured at this seed, bedroom
    // depth ranged 15.00-17.00 ft and the run along the hall 9.00-11.00 ft.
    expect(seen.du[1]! - seen.du[0]!).toBeGreaterThan(1.8);
    expect(seen.dv[1]! - seen.dv[0]!).toBeGreaterThan(1.8);
  });

  it("degrades legally over 160 sets where the section length is off closure", () => {
    // Now the section length is jittered on its own, so bedroom B gets whatever
    // is left and is sometimes far too small for two beds. This is the case the
    // sliders will actually produce, and the promise is only that the result is
    // legal -- never that it is complete.
    const rnd = makeRnd(31415926);
    let complete = 0;
    let degraded = 0;
    let placed = 0;
    let minBedB = Infinity;
    for (let i = 0; i < 160; i++) {
      const p = plausible(rnd);
      const upToBedB = p.commonAlong + p.bedAAlong + p.bathAlong + 3 * p.partition;
      // Floor it so bedroom B stays a room rather than a negative-width rect,
      // which is a buildSuite() input error and not something layout() claims
      // to survive.
      p.sectionLength = Math.max(upToBedB + 2, 44 + (rnd() * 2 - 1) * 6);
      const s = buildSuite(p);
      expect(findOverlaps(s.rooms), `iteration ${i} setup`).toEqual([]);

      const ps = layout(s);
      expect(illegal(s, ps), `iteration ${i}`).toEqual([]);
      expect(collisions(ps), `iteration ${i}`).toEqual([]);
      // Holds through the degradation too, and it is the harder half of the claim:
      // here pieces are being rescued onto the grid all over the suite, and a rescue
      // is exactly how a piece would end up in a doorway by accident rather than by
      // design. accept() gates the scan's candidates as well as the designed slots.
      expect(inADoorway(s, ps), `iteration ${i}`).toEqual([]);
      expect(ps.length, `iteration ${i}`).toBeLessThanOrEqual(29);
      // Bedroom A is unaffected by the residual, so it is always fully fitted.
      expect(kindsOf(inRoom(ps, "bedA")), `iteration ${i}`).toEqual({
        bed: 2,
        desk: 2,
        chair: 2,
        dresser: 2,
      });
      if (ps.length === 29) complete++;
      else degraded++;
      placed += ps.length;
      minBedB = Math.min(minBedB, roomOf(s, "bedB").dv);
    }
    // A floor on how much of the fit-out survives, which is the only thing that
    // measures how good the rescue is rather than merely that it is legal.
    // Measured at this seed: 4541 of the 4640 slots placed, against 4549 before the
    // doorways were kept clear -- so the whole door rule costs 8 slots out of 4640
    // across 160 suites. The bound is tight on purpose: the generator is
    // deterministic, so it cannot drift, and it is what noticed that dropping the
    // flush-to-the-wall anchors from stops() costs 18 pieces while breaking nothing
    // else.
    expect(placed).toBeGreaterThanOrEqual(4540);
    expect(placed).toBeLessThanOrEqual(160 * 29);
    // Non-vacuity, and the reason this sweep is separate from the one above:
    // both branches have to be exercised or "degrades legally" is untested.
    // Measured at this seed: 124 complete, 36 degraded, bedroom B down to 2.0 ft.
    expect(complete).toBeGreaterThan(60);
    expect(degraded).toBeGreaterThan(10);
    expect(minBedB).toBeLessThan(6);
  });

  /**
   * Every piece survives collide.ts's own snapping being applied to it where it
   * already stands: the arrangement this module ships is one the drag handler will
   * accept back.
   *
   * WHAT THIS ADDS TO "leaves no piece both off the grid and inside GRID / 2 of a
   * landing" ABOVE, WHICH IS THE DEFAULT-SUITE VERSION OF THE SAME IDEA
   *   Two things, and the first is why that test could pass while the fit-out was
   *   broken. Its disjunction is about LANDINGS only -- a piece is safe if it is on
   *   the grid or GRID / 2 clear of every doorway -- and a snap can just as easily
   *   carry a piece into the FURNITURE beside it. That is what it did: the bedroom
   *   chair is designed flush against the front edge of its own desk, so it has no
   *   margin at all on the axis the desk fills, and once a slider takes the bedroom's
   *   corner off the grid the snap puts the chair inside the desk. Measured before
   *   furniture.ts landed that coordinate on the grid, 658 of the 6960 pieces over
   *   the first sweep in this describe could not be put back where they stood -- 606
   *   chairs and 52 dressers -- against exactly one at the defaults.
   *
   *   Second, it composes the snap the drag handler actually applies rather than only
   *   the grid half of it: snapToGrid() then snapToWalls(), which is what collide.ts's
   *   header says the drop path is and what furniture.ts's redroppable() copies. Wall
   *   snap can move a piece whose anchor is already ON the grid, so grid alignment
   *   alone is not the whole of the property either.
   *
   * WHY IT IS HERE AND ALSO IN tests/drag.test.ts, WHICH IS NOT DUPLICATION
   *   This file never imports drag.ts, on purpose: the landings it measures against
   *   are worked out at the top from buildWalls() with a literal 2 ft, so a wrong
   *   landing cannot agree with itself. What is asserted here is that furniture.ts's
   *   output survives collide.ts's snapping -- the two modules this one is allowed to
   *   know about. tests/drag.test.ts asserts the thing a user meets, tryMove()
   *   returning ok, over its own randomised sweep. If those two ever disagree, the
   *   disagreement is the finding.
   */
  it("keeps every piece re-droppable under collide.ts's snapping, over 180 sets", () => {
    const rnd = makeRnd(19640214);
    /** Where a re-drop at the piece's own anchor would put it. drag.ts's place(). */
    const snappedBack = (p: Piece, r: Rect): Piece => {
      const s = snapToWalls(snapToGrid({ u: p.u, v: p.v, du: p.du, dv: p.dv, rot: p.yaw }), r);
      return { ...p, u: s.u, v: s.v };
    };
    const bad: string[] = [];
    let moved = 0;
    let pieces = 0;
    let gridChairs = 0;
    let kCentred = 0;
    let kAligned = 0;
    let degraded = 0;

    for (let i = 0; i < 180; i++) {
      const p = plausible(rnd);
      if (i >= 60) {
        // The off-closure half, so the rescue scan runs and the pieces under test are
        // ones no recipe chose. Same floor as the sweep above, for the same reason.
        const upToBedB = p.commonAlong + p.bedAAlong + p.bathAlong + 3 * p.partition;
        p.sectionLength = Math.max(upToBedB + 2, 44 + (rnd() * 2 - 1) * 6);
      }
      const s = buildSuite(p);
      expect(findOverlaps(s.rooms), `iteration ${i} setup`).toEqual([]);
      const ps = layout(s);
      const zones = doorwaysOf(s).map((d) => d.zone);
      if (ps.length < 29) degraded++;

      for (const q of ps) {
        pieces++;
        const room = roomOf(s, q.room);
        const back = snappedBack(q, room);
        if (Math.abs(back.u - q.u) > EPS || Math.abs(back.v - q.v) > EPS) moved++;
        // Against every other piece in the SUITE and not just in the room, which is
        // the list drag.ts's place() uses. A superset of what placeIsLegal() needs,
        // and the one that survives a piece whose room field is wrong.
        const others = ps.filter((o) => o.id !== q.id).map(pieceBox);
        const v = placeIsLegal(pieceBox(back), room, others);
        if (!v.ok) bad.push(`iteration ${i} ${q.id}: ${v.reason}`);
        for (const z of zones) {
          if (overlaps(pieceBox(back), z)) bad.push(`iteration ${i} ${q.id}: into a landing`);
        }
      }

      // THE RECIPE HALF OF THE FIX, pinned on the coordinate it was made for, and
      // asserted separately from the property above because the gate would otherwise
      // hide it: strip the grid step out of bedroomSlots() or clearOfBWalls() and the
      // rescue scan finds those chairs a legal home, so "every piece is re-droppable"
      // still passes and the designed arrangement is silently gone. This is the
      // assertion that says the recipe aimed rather than that the gate caught.
      //
      // WHICH AXIS, WITHOUT RE-DERIVING frameOf(): the recipes call it b, and b is by
      // definition the one across the room's longer side -- so it is the shorter side,
      // whichever of u and v that turns out to be. Measured at these parameters that
      // is v for a bedroom, which is deeper than it is long, and u for K, which is the
      // other way round; writing it as the shorter side rather than as a literal is
      // what keeps this true if a slider crosses over.
      //
      // WHY THE DISJUNCTION: a chair the scan rescued stands where no recipe chose it,
      // and stops() only offers the grid and flush-against-a-wall. So both halves of
      // the sweep can be covered without weakening the claim -- with the grid step
      // gone, the designed chair is neither.
      for (const q of ps.filter((x) => x.kind === "chair" && x.room.startsWith("bed"))) {
        const room = roomOf(s, q.room);
        const across = room.du >= room.dv ? "v" : "u";
        const f = pieceBox(q);
        const lo = across === "v" ? f.v : f.u;
        const size = across === "v" ? f.dv : f.du;
        const roomLo = across === "v" ? room.v : room.u;
        const roomSize = across === "v" ? room.dv : room.du;
        const onGrid = Math.abs(lo / GRID - Math.round(lo / GRID)) < EPS;
        const flush =
          Math.abs(lo - roomLo) < EPS || Math.abs(lo + size - (roomLo + roomSize)) < EPS;
        if (onGrid) gridChairs++;
        expect(onGrid || flush, `iteration ${i} ${q.id}: ${across} ${lo} neither`).toBe(true);
      }

      // K's seated group, which clearOfBWalls() places and which has TWO legal states
      // rather than one -- so both are pinned, or a change that collapses them into
      // whichever the seed happens to reach would pass. With a door in one of K's b
      // walls the group is landed on the suite grid, because a snap could otherwise
      // round it into that landing; with none, it is left centred across b, because
      // there is then no boundary for a snap to strand it across and the symmetry is
      // worth more than the alignment. Asserted on the group and not the chair: it is
      // the group's near edge clearOfBWalls() returns, and the four chairs and the
      // table all sit a whole number of grid steps off it.
      const kChairs = ps.filter((x) => x.room === "k" && x.kind === "chair");
      if (kChairs.length === 4) {
        const room = roomOf(s, "k");
        const across = room.du >= room.dv ? "v" : "u";
        const roomLo = across === "v" ? room.v : room.u;
        const roomHi = roomLo + (across === "v" ? room.dv : room.du);
        const boxes = kChairs.map(pieceBox);
        const lo = Math.min(...boxes.map((b) => (across === "v" ? b.v : b.u)));
        const hi = Math.max(...boxes.map((b) => (across === "v" ? b.v + b.dv : b.u + b.du)));
        const centred = Math.abs(lo - roomLo - (roomHi - hi)) < EPS;
        const aligned = Math.abs(lo / GRID - Math.round(lo / GRID)) < EPS;
        // Counted exclusively, or neither count is evidence. Measured at this seed the
        // two never in fact coincide -- 15 centred and 165 aligned out of 180, none
        // both -- but a group that was centred AND on the grid by luck would be
        // counted by an inclusive tally under either branch, so the bounds below would
        // then be satisfied by whichever one the seed happened to reach. Each of these
        // says the OTHER branch would not have covered this suite.
        if (centred && !aligned) kCentred++;
        if (aligned && !centred) kAligned++;
        expect(
          centred || aligned,
          `iteration ${i} k group: ${across} ${lo} neither centred nor on the grid`,
        ).toBe(true);
      }
    }

    expect(bad).toEqual([]);
    // Non-vacuity. Measured at this seed: 5127 pieces over the 180 suites, 4103 of them
    // moved by the snap, 687 of the 720 bedroom chairs on the grid across their desk --
    // the other 33 flush against a wall, rescued rather than designed -- K's group on
    // the grid and not centred in 165 of the suites and centred and not on the grid in
    // the other 15, and 31 of the 120 off-closure arrangements degraded.
    //
    // The moved count is the one that matters most: if the snap were the identity
    // everywhere -- which is what it very nearly is at the defaults, where every room
    // corner is on the grid -- this whole property would hold however broken the recipes
    // were, and that is exactly how the defect survived to be measured at 658 pieces.
    expect(pieces).toBeGreaterThan(5000);
    expect(moved, "the snap moved nothing: the property is vacuous").toBeGreaterThan(3500);
    expect(gridChairs, "no bedroom chair landed on the grid").toBeGreaterThan(600);
    // Both of clearOfBWalls's branches, or the assertion above is about one of them and
    // silent about the other.
    expect(kAligned, "K's group never landed on the grid alone").toBeGreaterThan(100);
    expect(kCentred, "K's group was never left centred alone").toBeGreaterThan(0);
    expect(degraded, "nothing degraded: the rescue scan is untested").toBeGreaterThan(10);
  });
});
