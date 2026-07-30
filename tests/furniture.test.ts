import { describe, it, expect } from "vitest";
import {
  buildSuite,
  DEFAULT_PARAMS,
  findOverlaps,
  type Rect,
  type Suite,
  type SuiteParams,
} from "@/geo/rooms";
import { GRID, containedBy, footprintOf, overlaps, placeIsLegal } from "@/geo/collide";
import {
  BED_CLEARANCE,
  MATTRESS,
  SIZES,
  bedClearance,
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

      // Desk against the far end wall, chair pulled out in front of it and
      // centred on its frontage.
      expect(desks[i]!.f.u + desks[i]!.f.du, `desk ${i}`).toBeCloseTo(bedA.u + bedA.du, 12);
      expect(chairs[i]!.f.u + chairs[i]!.f.du, `chair ${i}`).toBeCloseTo(desks[i]!.f.u, 12);
      expect(chairs[i]!.f.v - desks[i]!.f.v, `chair ${i}`).toBeCloseTo(
        desks[i]!.f.v + desks[i]!.f.dv - (chairs[i]!.f.v + chairs[i]!.f.dv),
        12,
      );
      expect(chairs[i]!.p.yaw, `chair ${i}`).toBe(90); // turned to face the desk
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

    // Along the 16 ft depth: bed, dresser, chair, desk in a line. Added up from
    // the footprints layout() actually placed, not from SIZES -- which extent of
    // each piece runs along the depth depends on how the recipe turned it, so
    // summing the table is a true statement about the constants and not about
    // this arrangement. It was that substitution that had the dresser down as
    // 18 in when it stands unturned at 30, overstating the free floor by a foot.
    const along = (id: string) => {
      const p = ps.find((x) => x.id === id);
      expect(p, id).toBeDefined();
      return pieceBox(p!).du; // u is the depth in bedroom A
    };
    const depths = ["bed", "dresser", "chair", "desk"].map((k) => along(`bedA-${k}-0`));
    expect(depths.map((d) => Math.round(d * 12))).toEqual([82, 30, 18, 24]);
    const band = depths.reduce((s, d) => s + d, 0);
    expect(band).toBeCloseTo(154 / 12, 12);
    expect(band).toBeCloseTo(12.8333, 4);
    expect(bedA.du - band).toBeCloseTo(3.1667, 4);
    // And station 1's four pieces measure the same, so one station is the band.
    expect(
      ["bed", "dresser", "chair", "desk"].reduce((s, k) => s + along(`bedA-${k}-1`), 0),
    ).toBeCloseTo(band, 12);

    // So the run binds first, and it binds well outside the resident's stated one foot
    // of uncertainty on the 10: the second bed keeps its 2 ft down to 8.67 ft
    // and keeps its place at all down to 6.67 ft.
    expect(2 * SIZES.bed.dv + BED_CLEARANCE).toBeCloseTo(8.6667, 4);
    expect(bedA.dv - (2 * SIZES.bed.dv + BED_CLEARANCE)).toBeGreaterThan(1);
    expect(bedA.du - band).toBeGreaterThan(bedA.dv - (2 * SIZES.bed.dv + BED_CLEARANCE));
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

    // Back to the inner end wall, facing the facade and its window.
    expect(sofa.u + sofa.du).toBeCloseTo(r.u + r.du, 12);
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
    // Centred both ways: a study table you sit round, not a piece of casework.
    expect(table.u - r.u).toBeCloseTo(r.u + r.du - (table.u + table.du), 12);
    expect(table.v - r.v).toBeCloseTo(r.v + r.dv - (table.v + table.dv), 12);
    // Two chairs on each long side, a grid step clear, and the pair at the
    // table's two ends rather than stacked at one.
    const chairs = ps.filter((p) => p.kind === "chair").map(pieceBox);
    expect(chairs.length).toBe(4);
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
    // against walls. Measured at the defaults: 17 of the 29.
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
    // An 11 ft deep bedroom is 1.83 ft short of the bed-dresser-chair-desk band,
    // so the dressers cannot stand where the recipe puts them. bathDeep comes
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
    const band = ["bed", "dresser", "chair", "desk"].reduce(
      (t, k) => t + pieceBox(stated.find((x) => x.id === `bedA-${k}-0`)!).du,
      0,
    );
    expect(band).toBeCloseTo(12.8333, 4);
    expect(band - bedA.du).toBeCloseTo(1.8333, 4);

    const ps = layout(s);
    expect(illegal(s, ps)).toEqual([]);
    expect(collisions(ps)).toEqual([]);
    // Nothing dropped: the dressers were rescued, not abandoned.
    expect(kindsOf(inRoom(ps, "bedA"))).toEqual({ bed: 2, desk: 2, chair: 2, dresser: 2 });
    const dressers = inRoom(ps, "bedA").filter((x) => x.kind === "dresser");
    expect(dressers.map((d) => d.id)).toEqual(["bedA-dresser-0", "bedA-dresser-1"]);
    // Where they actually land. Pinned exactly, because the scan is the only
    // code here that picks coordinates freely and this is the one case that
    // exercises it: both anchors are on collide.ts's 0.5 ft grid, the first is
    // turned a quarter to fit the aisle, and each stays on the side of the room
    // its own station was on rather than crossing over the other's.
    expect(dressers.map((d) => [pieceBox(d).u, pieceBox(d).v, d.yaw])).toEqual([
      [7, 18.5, 90],
      [8.5, 20, 180],
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

  it("gives up on side by side to keep one bed its 2 ft, rather than keeping neither", () => {
    // A 7 ft run cannot take two 40 in beds and a 2 ft aisle. Side by side both
    // beds would be boxed in; end to end along the 16 ft depth one of them keeps
    // its clearance, so that is what settle()'s strict pass goes looking for.
    const s = buildSuite({ ...DEFAULT_PARAMS, bedAAlong: 7 });
    const bedA = roomOf(s, "bedA");
    expect(bedA.dv).toBe(7);
    expect(2 * SIZES.bed.dv + BED_CLEARANCE).toBeGreaterThan(bedA.dv);

    const ps = layout(s);
    expect(illegal(s, ps)).toEqual([]);
    expect(collisions(ps)).toEqual([]);
    const beds = inRoom(ps, "bedA").filter((x) => x.kind === "bed");
    expect(beds.length).toBe(2);
    // End to end, not side by side.
    expect(pieceBox(beds[1]!).u).toBeGreaterThanOrEqual(
      pieceBox(beds[0]!).u + pieceBox(beds[0]!).du,
    );
    const clear = beds.map((b) => bedClearance(b, bedA, inRoom(ps, "bedA")));
    expect(clear[0]).toBeGreaterThanOrEqual(BED_CLEARANCE - EPS);
    // The other one cannot have it -- 7 ft does not stretch -- and the module
    // says so by leaving it tight rather than by pretending.
    expect(clear[1]).toBeLessThan(BED_CLEARANCE);
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
    // Measured at this seed: 4549 of the 4640 slots placed. The bound is tight
    // on purpose -- the generator is deterministic, so it cannot drift, and it
    // is what noticed that dropping the flush-to-the-wall anchors from stops()
    // costs 18 pieces while breaking nothing else.
    expect(placed).toBeGreaterThanOrEqual(4540);
    expect(placed).toBeLessThanOrEqual(160 * 29);
    // Non-vacuity, and the reason this sweep is separate from the one above:
    // both branches have to be exercised or "degrades legally" is untested.
    // Measured at this seed: 133 complete, 27 degraded, bedroom B down to 2.0 ft.
    expect(complete).toBeGreaterThan(60);
    expect(degraded).toBeGreaterThan(10);
    expect(minBedB).toBeLessThan(6);
  });

});
