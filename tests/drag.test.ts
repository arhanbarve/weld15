import { describe, it, expect } from "vitest";
import {
  buildSuite,
  DEFAULT_PARAMS,
  findOverlaps,
  type Rect,
  type Suite,
  type SuiteParams,
} from "@/geo/rooms";
import { GRID, WALL_SNAP, containedBy, placeIsLegal, type Box } from "@/geo/collide";
import { SIZES, layout, pieceBox, type Piece } from "@/geo/furniture";
import { buildWalls, type Opening, type Wall } from "@/geo/walls";
import {
  DOOR_CLEARANCE,
  MAX_NUDGE_STEPS,
  nudge,
  tryMove,
  tryRotate,
  type DragCtx,
} from "@/geo/drag";

const suite = buildSuite();
const { walls, openings } = buildWalls(suite);
const pieces = layout(suite);
const ctx: DragCtx = { suite, pieces, openings };

const EPS = 1e-9;

const roomOf = (s: Suite, id: string): Rect => {
  const r = s.rooms.find((x) => x.id === id);
  if (!r) throw new Error(`no room ${id}`);
  return r;
};
const pieceOf = (ps: Piece[], id: string): Piece => {
  const p = ps.find((x) => x.id === id);
  if (!p) throw new Error(`no piece ${id}`);
  return p;
};
const doorOf = (os: Opening[], id: string): Opening => {
  const o = os.find((x) => x.id === id);
  if (!o) throw new Error(`no opening ${id}`);
  return o;
};

/** A free-standing piece, for the cases the default fit-out has no piece for. */
const dresserIn = (id: string, room: string, u: number, v: number): Piece => ({
  id,
  kind: "dresser",
  room,
  u,
  v,
  du: SIZES.dresser.du,
  dv: SIZES.dresser.dv,
  h: SIZES.dresser.h,
  yaw: 0,
});

/**
 * A door's clear landing, worked out again here rather than imported.
 *
 * Deliberate duplication, and the only duplication in this file: drag.ts does not
 * export its zone maths, and a property test that asked drag.ts where the doors are
 * could only ever confirm that drag.ts agrees with itself. The formula is short
 * enough to state twice and the specific-case tests below pin the numbers with
 * literals as well, so all three have to agree.
 */
function landing(w: Wall, o: Opening): Box {
  const alongV = !(w.du > w.dv);
  const c = DOOR_CLEARANCE;
  return alongV
    ? { u: w.u - c, v: w.v + o.offset, du: w.du + 2 * c, dv: o.width }
    : { u: w.u + o.offset, v: w.v - c, du: o.width, dv: w.dv + 2 * c };
}

/** Which doors a piece stands in the way of, by id. */
function blocks(p: Piece, ws: Wall[], os: Opening[]): string[] {
  const box = pieceBox(p);
  return os
    .filter((o) => o.kind === "door")
    .filter((o) => {
      const z = landing(ws.find((x) => x.id === o.wallId)!, o);
      const su = Math.min(box.u + box.du, z.u + z.du) - Math.max(box.u, z.u);
      const sv = Math.min(box.v + box.dv, z.v + z.dv) - Math.max(box.v, z.v);
      return su > EPS && sv > EPS;
    })
    .map((o) => o.id);
}

/** Same deterministic generator as tests/rooms.test.ts, collide.test.ts, furniture.test.ts. */
const makeRnd = (seed0: number) => {
  let seed = seed0;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
};

const onGrid = (x: number) => Math.abs(x / GRID - Math.round(x / GRID)) < EPS;

describe("tryMove at the defaults", () => {
  it("snaps a legal drop onto collide.ts's 0.5 ft grid", () => {
    // The common room's bookcase, out in the middle of the floor where no wall is
    // in reach, so grid snap is the only thing acting.
    const shelf = pieceOf(pieces, "common1-shelf-0");
    const r = tryMove(shelf, { u: 5.3, v: 5.2 }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.piece.u, r.piece.v]).toEqual([5.5, 5]);
    expect(r.snapped).toBe("grid");
    // Everything else about the piece is carried through untouched, ids included:
    // the renderer keys instanced meshes off them.
    expect({ ...r.piece, u: shelf.u, v: shelf.v }).toEqual(shelf);
  });

  it("pulls a legal drop flush against a wall it lands near", () => {
    const shelf = pieceOf(pieces, "common1-shelf-0");
    const common = roomOf(suite, "common1");
    // 0.3 grid-snaps to 0.5, which is inside WALL_SNAP of the facade at u = 0, so
    // wall snap overrides the grid and takes it flush. That override is the whole
    // reason snapToWalls runs second.
    expect(0.5).toBeLessThanOrEqual(WALL_SNAP);
    const r = tryMove(shelf, { u: 0.3, v: 5.2 }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.piece.u).toBe(common.u);
    expect(r.piece.v).toBe(5);
    expect(r.snapped).toBe("wall");
  });

  it("reports none when the target is already on the grid and clear of every wall", () => {
    const r = tryMove(pieceOf(pieces, "common1-shelf-0"), { u: 5.5, v: 5 }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.piece.u, r.piece.v, r.snapped]).toEqual([5.5, 5, "none"]);
  });

  it("refuses a drag into the wall and names the room", () => {
    // Bedroom A is 16 ft deep and a bed is 6.83 ft long, so u = 14 puts nearly 5 ft
    // of it through the wall into the hall. Too far out for wall snap to rescue.
    const bed = pieceOf(pieces, "bedA-bed-0");
    const bedA = roomOf(suite, "bedA");
    expect(14 + pieceBox(bed).du - bedA.du).toBeGreaterThan(WALL_SNAP);
    const r = tryMove(bed, { u: 14, v: 15.5 }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("outside-room");
    expect(r.against).toEqual(["bedA"]);
  });

  it("refuses a drag onto another piece and names every piece it lands on", () => {
    const bed = pieceOf(pieces, "bedA-bed-0");
    const r = tryMove(bed, { u: 0, v: 19 }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("collision");
    expect(r.against).toEqual(["bedA-bed-1"]);

    // Two at once, so `against` is demonstrably a list and not a first hit: K's
    // table slid one chair-gap west sits on both chairs at that end.
    const table = pieceOf(pieces, "k-table-0");
    const two = tryMove(table, { u: 22.25, v: 4 }, ctx);
    expect(two.ok).toBe(false);
    if (two.ok) return;
    expect(two.reason).toBe("collision");
    expect(two.against).toEqual(["k-chair-0", "k-chair-1"]);
  });

  it("refuses a piece dragged clear outside the suite, and does not touch the input", () => {
    const shelf = pieceOf(pieces, "common1-shelf-0");
    const before = structuredClone(shelf);
    const r = tryMove(shelf, { u: 200, v: -50 }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("outside-room");
    expect(r.against).toEqual(["common1"]);
    // A rejected drag must leave the model alone: the UI puts the piece back by
    // simply not applying the result, which only works if nothing was applied.
    expect(shelf).toEqual(before);
    expect(pieces).toEqual(layout(suite));
  });

  it("refuses a piece whose room the suite does not have, naming the room it claims", () => {
    // What a slider that closes a room to nothing leaves behind.
    const orphan = dresserIn("orphan", "cellar", 5, 5);
    const r = tryMove(orphan, { u: 5, v: 5 }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect([r.reason, r.against]).toEqual(["outside-room", ["cellar"]]);
  });
});

describe("blocks-door", () => {
  /**
   * One case per door in the suite, each with its landing written out in literal
   * feet off the wall bands in the dump, so the geometry is pinned independently of
   * both drag.ts and landing() above.
   *
   * EVERY CASE IS NOW A PIECE DELIBERATELY MOVED INTO A LANDING, which it was not
   * always: d0 and d2 used to hand the loop a bedroom desk that already stood in the
   * doorway at the defaults and re-drop it where it was. furniture.ts is door-aware
   * now and the fit-out clears all six doors, so a case built that way tests
   * nothing -- it has to carry the piece in. The three landings no piece can reach at
   * all get a free-standing dresser stood in them, which is the phase spec's own
   * example of the failure: the bathroom, which has no fit-out; and both of the hall's
   * own doors, the suite entry and the door into the common room, because the hall has
   * no fit-out either.
   *
   * PICKING A TARGET THAT `blocks-door` IS ACTUALLY THE RIGHT ANSWER FOR
   *   place() settles containment before it asks about doors, so a target that
   *   overhangs the room is `outside-room` and never reaches the door check. That is
   *   the classification order working as designed, and it is what the old d0 and d2
   *   cases turned into once the desks moved: both aimed at u 14, where a 4 ft desk
   *   runs to u 18 and the bedroom ends at u 16. The landing off a bedroom door
   *   spans u 14 to 18.5 but only u 14 to 16 of it is bedroom floor, so a desk has
   *   to be brought to u 12 -- far edge exactly on the room's inner wall -- to be
   *   both inside its room and in the landing. That is a 2 ft window and the desk
   *   fills it exactly; there is no slack to spare on this door.
   */
  const cases: {
    door: string;
    piece: Piece;
    to: { u: number; v: number };
    zone: string;
    against: string[];
  }[] = [
    {
      door: "d0",
      piece: pieceOf(pieces, "bedA-desk-0"),
      // Dragged in from its designed u 10, v 15.5. Box u 12 to 16, v 19.5 to 21.5:
      // flush against the room's inner wall and squarely in the middle of the 3 ft
      // door, so the desk is contained by bedroom A and standing in the landing at
      // the same time -- which is what makes blocks-door the honest verdict rather
      // than outside-room.
      to: { u: 12, v: 19.5 },
      // wall w4 is u 16 to 16.5, the door runs v 19 to 22
      zone: "u 14 to 18.5, v 19 to 22",
      against: ["d0", "hall", "bedA"],
    },
    {
      door: "d1",
      piece: dresserIn("probe", "bath", 13.5, 29),
      to: { u: 13.5, v: 29 },
      // wall w5 is u 16 to 16.5, the door runs v 28.25 to 31.25
      zone: "u 14 to 18.5, v 28.25 to 31.25",
      against: ["d1", "hall", "bath"],
    },
    {
      door: "d2",
      piece: pieceOf(pieces, "bedB-desk-0"),
      // The same move on the same 2 ft window in bedroom B, which is bedroom A's
      // mirror: box u 12 to 16, v 38 to 40, inside the room and inside the landing.
      to: { u: 12, v: 38 },
      // wall w6 is u 16 to 16.5, the door runs v 37.5 to 40.5
      zone: "u 14 to 18.5, v 37.5 to 40.5",
      against: ["d2", "hall", "bedB"],
    },
    {
      door: "d3",
      piece: pieceOf(pieces, "common1-sofa-0"),
      to: { u: 17.25, v: 5 },
      // wall w7 is u 20 to 20.5, the door runs v 6 to 9
      zone: "u 18 to 22.5, v 6 to 9",
      against: ["d3", "common1", "k"],
    },
    {
      door: "d4",
      piece: dresserIn("probe", "hall", 18.5, 17),
      to: { u: 18.5, v: 17 },
      // wall p12 is u 21 to 21.5, the suite entry runs v 16.5 to 19.7
      zone: "u 19 to 23.5, v 16.5 to 19.7",
      // TWO DOORS, MEASURED, and the probe is left exactly where it was rather than moved
      // to isolate one. The hall's south-west corner is where the entry's landing and the
      // common room door's landing overlap: this dresser's box is u 18.5 to 21, v 17 to
      // 18.5, and d5's landing runs u 16.5 to 19.5, v 13 to 17.5, so half a foot of the
      // dresser stands in each. That overlap is a fact about a 3.2 ft entry and a 3 ft
      // door 4.5 ft apart in a 4.5 ft hall, and hiding it by shifting the probe north
      // would make this case tidier and the record less true. d5's own case below is the
      // one that isolates d5.
      against: ["d4", "hall", "outside", "d5", "common1"],
    },
    {
      door: "d5",
      // The hall's south-west corner, flush in both axes: box u 16.5 to 19, v 15.5 to 17.
      // Far enough west that it clears the entry's landing at u 19 -- touching, so not
      // blocking, for the same reason touching is not colliding -- and clear of d0's at
      // v 19. So this one names d5 alone.
      //
      // A free-standing dresser because the hall has no fit-out piece to carry in, which
      // is the same reason d1's case has one, and because nothing in the common room can
      // reach this landing either: it bites u 16.5 to 19.5, v 13 to 15 of the common room,
      // and the nearest designed piece is the sofa at u 15 to 17.75, v 4.5 to 10.5.
      piece: dresserIn("probe", "hall", 16.5, 15.5),
      to: { u: 16.5, v: 15.5 },
      // wall w0 is v 15 to 15.5 and runs in u; the door runs u 16.5 to 19.5
      zone: "u 16.5 to 19.5, v 13 to 17.5",
      against: ["d5", "hall", "common1"],
    },
  ];

  it("has a case for every door in the suite", () => {
    // Or the loop below silently stops testing a door the moment walls.ts adds one.
    expect(openings.filter((o) => o.kind === "door").map((o) => o.id)).toEqual(
      cases.map((c) => c.door),
    );
  });

  for (const c of cases) {
    it(`refuses ${c.piece.kind} across ${c.door} (landing ${c.zone})`, () => {
      const door = doorOf(openings, c.door);
      const w = walls.find((x) => x.id === door.wallId)!;
      const z = landing(w, door);
      // The landing, in the literal numbers the case names, before anything is
      // dragged into it.
      expect(
        `u ${z.u} to ${z.u + z.du}, v ${z.v} to ${round(z.v + z.dv)}`,
      ).toBe(c.zone);
      expect(DOOR_CLEARANCE).toBe(2);

      const local = [...pieces.filter((p) => p.id !== c.piece.id), c.piece];
      const r = tryMove(c.piece, c.to, { ...ctx, pieces: local });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe("blocks-door");
      expect(r.against).toEqual(c.against);
    });
  }

  it("names each blocked door once, and every room it joins", () => {
    // Every door off the hall names the hall, so a piece standing in more than one
    // landing would repeat it without the de-duplication. Nothing in the fit-out is
    // that big, so this is a 4 x 22 ft absurdity filling most of the corridor --
    // sized to the hall's own 4.5 ft width, because a piece that stuck out of the
    // hall would be refused for that first and never reach the door check.
    const wide: Piece = { ...dresserIn("wide", "hall", 16.5, 17), du: 4, dv: 22 };
    const r = tryMove(wide, { u: 16.5, v: 17 }, { ...ctx, pieces: [wide] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("blocks-door");
    // d0 at v 19-22, d1 at v 28.25-31.25, d2 at v 37.5-40.5 -- the dresser runs
    // v 17 to 39 and u 19 to 23, so it stands in all three, plus the entry, plus the
    // door into the common room: d5's landing reaches u 16.5 to 19.5, v 13 to 17.5, and
    // the dresser's south-west corner is inside it. Five doors and six rooms, in the
    // openings' own emission order, with the hall named once for all four of its doors.
    expect(r.against).toEqual([
      "d0",
      "hall",
      "bedA",
      "d1",
      "bath",
      "d2",
      "bedB",
      "d4",
      "outside",
      "d5",
      "common1",
    ]);
    expect(new Set(r.against).size).toBe(r.against.length);
    // The de-duplication is what this test is for, so count what it suppressed: four of
    // the five doors name the hall and it appears once.
    expect(r.against.filter((x) => x === "hall").length).toBe(1);
    expect(r.against.filter((x) => x.startsWith("d")).length).toBe(5);
  });

  it("finds the default fit-out standing in no doorway landing at all", () => {
    // WHAT THIS ASSERTED BEFORE, kept because it is the reason the assertion is
    // worth making: it recorded the opposite, as a measured defect. layout() could
    // not see openings, so at the defaults it stood six pieces in three of the
    // suite's five doors -- bedA-desk-0 and -1 and bedB-desk-0 and -1 flush against
    // the inner wall at u 14 to 16 across the bedroom doors' u 14 to 18.5 landings,
    // common1-sofa-0 square across K's door, and k-chair-1 a quarter foot into that
    // same landing from K's side. Five of the six could not be re-dropped where they
    // stood, because tryMove() judges the placement it is given and not the change
    // from the last one, so the UI simply refused to move a desk along its own
    // doorway.
    //
    // furniture.ts is door-aware now: doorLandings() feeds both farLimit(), which
    // pulled the bedroom desks off the far wall and the sofa off K's, and accept(),
    // which refuses a landing in either pass so the rescue scan cannot put one back.
    // So this is the inversion of the old record -- a guard against the defect
    // returning rather than a note that it is here. The old numbers stay above as
    // history; what follows is the rule.
    const stuck = pieces.filter((p) => blocks(p, walls, openings).length > 0);
    expect(stuck.map((p) => p.id)).toEqual([]);
    // Non-vacuity for blocks() itself, which is the function the line above trusts:
    // one of those same desks, carried into the doorway by hand, is still found.
    const carried: Piece = { ...pieceOf(pieces, "bedA-desk-0"), u: 12, v: 19.5 };
    expect(blocks(carried, walls, openings)).toEqual(["d0"]);

    // AND EVERY PIECE CAN BE PUT BACK WHERE IT STANDS, which is the stronger claim of
    // the two and did not always hold. "Clear of every landing" is not "re-droppable
    // at its own anchor", and the sofa was the one piece where they came apart: its
    // anchor was u 15.25, a quarter foot off the grid, with its far edge exactly on
    // d3's landing boundary at u 18 -- touching, so not blocking, for the same reason
    // touching is not colliding. Re-dropping it snapped the anchor up to 15.5 and
    // carried that edge 0.25 ft INTO the landing, so place() answered blocks-door to a
    // user putting a piece down where they had just picked it up.
    //
    // The mirror of the k-chair-1 note above, where the same quarter foot of grid snap
    // freed a piece instead of trapping one. furniture.ts's commonSlots() closed it by
    // landing the designed anchor on the grid -- u 15, far edge 17.75 -- rather than by
    // buying clearance above GRID / 2, because on the grid snapToGrid() is the identity
    // and the re-drop is a no-op at any clearance. k-chair-1 is the proof that this is
    // the general rule and not a patch for the sofa: it still stands exactly on that
    // same boundary with no margin whatever, and it re-drops because it is on the grid.
    //
    // The property first and the sofa's numbers second, deliberately: pinning the
    // anchor above this would short-circuit the run and report a moved sofa when what
    // has actually broken is that a piece cannot be put down where it stands.
    const stuckWhereItStands = pieces.filter((p) => !tryMove(p, { u: p.u, v: p.v }, ctx).ok);
    expect(stuckWhereItStands.map((p) => p.id)).toEqual([]);
    const sofa = pieceOf(pieces, "common1-sofa-0");
    expect([sofa.u, pieceBox(sofa).u + pieceBox(sofa).du]).toEqual([15, 17.75]);
    // Accepted AND unmoved, for the sofa, which is what being on the grid buys and
    // what an anchor at 15.25 could not have given however far the door had been.
    const r = tryMove(sofa, { u: sofa.u, v: sofa.v }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.piece.u, r.piece.v, r.snapped]).toEqual([sofa.u, sofa.v, "none"]);

    // Why the claim above is about acceptance and not about staying put: ten of the 29
    // anchors are off the grid for reasons no fix should touch -- a chair centred on
    // its 4 ft desk stands at u 11.25 -- and a re-drop shifts each of them a quarter
    // foot. Legal, clear of every door, and the UI's own snapping rather than a
    // refusal. tests/furniture.test.ts names all ten and pins what keeps them safe.
    const chair = pieceOf(pieces, "bedA-chair-0");
    expect(onGrid(chair.u)).toBe(false);
    const back = tryMove(chair, { u: chair.u, v: chair.v }, ctx);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect([back.piece.u, back.snapped]).toEqual([11.5, "grid"]);

    // THIS USED TO BE A CLAIM ABOUT THIS SUITE ALONE, and it is now a claim about every
    // suite the sliders can build -- see "puts every designed piece back where it
    // stands" in the sweep at the bottom of this file, which is where the rule is
    // asserted and this is just its default case.
    //
    // What it recorded before, kept because it is what the sweep now forbids: 82 of the
    // 870 designed pieces over that sweep could not be re-dropped, every one of them a
    // chair -- 66 snapping into the desk they are centred on and 16 into a landing --
    // and 658 of 6960 over tests/furniture.test.ts's 240-set sweep, chairs and dressers.
    // Both are the 0.5 ft grid meeting walls a slider has taken off it rather than the
    // door rule, and filing that as "the arrangement anybody has actually looked at is
    // this one" was the mistake: a slider is the feature, so every arrangement it
    // reaches is one somebody will look at.
  });

  it("lets a piece standing in a landing move clear of it", () => {
    // The other half of the rule: it refuses a placement, it does not trap a piece.
    //
    // This used to take bedroom A's desk exactly as layout() emitted it, because
    // layout() emitted it in the doorway. Nothing starts in a landing now, so the
    // case has to be built: the desk is put in d0's landing by hand -- the same
    // position the d0 case above drags it to, and refused for the same reason -- and
    // then moved inboard, where it is accepted. Constructing the bad state is the
    // only way left to test getting out of one.
    const desk = pieceOf(pieces, "bedA-desk-0");
    const stuck: Piece = { ...desk, u: 12, v: 19.5 };
    const local = [...pieces.filter((p) => p.id !== stuck.id), stuck];
    expect(blocks(stuck, walls, openings)).toEqual(["d0"]);
    // Where it stands is genuinely refused, so "moves clear" has something to be
    // clear of. drag.ts agreeing with blocks() about that is the point of asking.
    const held = tryMove(stuck, { u: stuck.u, v: stuck.v }, { ...ctx, pieces: local });
    expect(held.ok).toBe(false);
    if (held.ok) return;
    expect(held.reason).toBe("blocks-door");

    // 4 ft inboard, which clears the landing's u 14 edge by 2 ft without changing v
    // -- so the escape is along the axis the door is on, not a shuffle out of the
    // door's reach in the other direction.
    const r = tryMove(stuck, { u: 8, v: 19.5 }, { ...ctx, pieces: local });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.piece.u, r.piece.v, r.snapped]).toEqual([8, 19.5, "none"]);
    expect(blocks(r.piece, walls, openings)).toEqual([]);
  });

  it("ignores windows, and would refuse the same opening if it were a door", () => {
    // Bedroom A's bed stands directly under the facade window and that is not a
    // fault. Relabelling that one opening a door is what proves the kind filter is
    // doing the work, rather than the window happening to be out of reach.
    const bed = pieceOf(pieces, "bedA-bed-0");
    const win = openings.find((o) => o.kind === "window" && o.connects.includes("bedA"))!;
    expect(tryMove(bed, { u: 0, v: 15.5 }, ctx).ok).toBe(true);

    const asDoor: Opening = { ...win, kind: "door" };
    const r = tryMove(bed, { u: 0, v: 15.5 }, { ...ctx, openings: [asDoor] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect([r.reason, r.against]).toEqual(["blocks-door", [win.id, "bedA"]]);
  });

  it("throws rather than skipping a door whose wall this suite has not got", () => {
    // Openings and suite from two different builds. Skipping the check quietly
    // would drop that one door's rule while every other assertion still passed --
    // the failure mode rooms.ts's stepOntoTheWing throws for.
    const bogus: Opening = {
      id: "dX",
      wallId: "not-a-wall",
      kind: "door",
      offset: 0,
      width: 3,
      connects: ["hall", "bedA"],
    };
    expect(() =>
      tryMove(pieceOf(pieces, "common1-shelf-0"), { u: 5.5, v: 5 }, { ...ctx, openings: [bogus] }),
    ).toThrow(/not-a-wall/);
  });
});

describe("tryRotate", () => {
  it("turns a piece that fits, about its own u, v corner", () => {
    // K's south bookcase: 3 x 1 against the end wall, with 3 ft of clear floor
    // north of it, so the quarter turn has somewhere to go.
    const shelf = pieceOf(pieces, "k-shelf-0");
    expect([shelf.yaw, pieceBox(shelf).du, pieceBox(shelf).dv]).toEqual([0, 3, 1]);
    const r = tryRotate(shelf, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.piece.yaw).toBe(90);
    // Anchor fixed, extents transposed. Not a spin about the centre -- see
    // collide.ts's ROTATION note for why the corner is the anchor.
    expect([r.piece.u, r.piece.v]).toEqual([shelf.u, shelf.v]);
    expect([pieceBox(r.piece).du, pieceBox(r.piece).dv]).toEqual([1, 3]);
    // du and dv stay unrotated on the Piece itself, so the renderer's mesh and
    // pieceBox() agree about what yaw means.
    expect([r.piece.du, r.piece.dv]).toEqual([shelf.du, shelf.dv]);
  });

  it("comes back to where it started after four turns", () => {
    let p = pieceOf(pieces, "k-shelf-0");
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = tryRotate(p, ctx);
      expect(r.ok, `turn ${i}`).toBe(true);
      if (!r.ok) return;
      p = r.piece;
      seen.push(p.yaw);
    }
    expect(seen).toEqual([90, 180, 270, 0]);
    expect(p).toEqual(pieceOf(pieces, "k-shelf-0"));
  });

  it("refuses a turn that would swing the piece out of its room", () => {
    // The common room's sofa is 6 ft long with its back to the inner wall. Turned,
    // its length runs into that wall and the far end comes out past u = 20 into K,
    // which it has no right to be in at all -- so the reason has to be outside-room.
    //
    // THE CASE IS NOW CARRIED IN, AND THE PREVIOUS READING SAID WHY IT WOULD HAVE TO
    // BE. It used the sofa exactly as layout() emits it: the overhang was 3.25 ft when
    // the sofa stood flush at u 17.25, then 1.25 ft once farLimit() pulled it 2 ft off
    // K's door, and the note here warned that wall snap would quietly rescue anything
    // smaller and turn this into an accepted turn -- "another foot inboard and this
    // test would stop testing a refusal without saying so". A quarter foot was enough.
    // furniture.ts now lands the anchor on the grid at u 15, the turn overhangs exactly
    // WALL_SNAP, and snapToWalls() takes the boundary case: the sofa goes flush at
    // u 14, is contained after all, and the honest verdict there is blocks-door,
    // because flush at u 14 across v 4.5 to 10.5 stands in d3's landing.
    //
    // So both are asserted. First that the designed anchor no longer reaches this
    // branch, with the equality that is the reason -- if a future clearance change
    // moves the sofa again, this is the line that says which branch it landed in.
    const sofa = pieceOf(pieces, "common1-sofa-0");
    const common = roomOf(suite, "common1");
    const designed = { ...sofa, yaw: 0 } as Piece;
    const reach = pieceBox(designed).u + pieceBox(designed).du - (common.u + common.du);
    expect(reach).toBeCloseTo(WALL_SNAP, 12);
    const rescued = tryRotate(sofa, ctx);
    expect(rescued.ok).toBe(false);
    if (rescued.ok) return;
    expect([rescued.reason, rescued.against]).toEqual(["blocks-door", ["d3", "common1", "k"]]);

    // Then the containment branch itself, on a sofa carried a foot outboard of where
    // the recipe puts it. 2 ft of overhang is past the catchment, so no snap can
    // rescue it and the refusal is about the room rather than the door.
    const out: Piece = { ...sofa, u: 16 };
    const turned = { ...out, yaw: 0 } as Piece;
    const overhang = pieceBox(turned).u + pieceBox(turned).du - (common.u + common.du);
    expect(overhang).toBeCloseTo(2, 12);
    expect(overhang).toBeGreaterThan(WALL_SNAP);
    expect(containedBy(pieceBox(turned), common)).toBe(false);

    // The oldest reading also noted that the swung sofa landed on two of K's chairs,
    // so the overlap list was non-empty and the ordering in place() was load-bearing.
    // From u 16 the turn reaches u 22 and K's nearest chair starts at u 22.5, so this
    // exercises the containment branch alone. The ordering is still covered, by
    // "refuses a piece dragged clear outside the suite" and by the property sweep,
    // which counts both verdicts.
    const nearestInK = Math.min(
      ...pieces.filter((p) => p.room === "k" && p.kind === "chair").map((p) => p.u),
    );
    expect(nearestInK).toBeGreaterThan(pieceBox(turned).u + pieceBox(turned).du);
    const local = [...pieces.filter((p) => p.id !== out.id), out];
    const r = tryRotate(out, { ...ctx, pieces: local });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect([r.reason, r.against]).toEqual(["outside-room", ["common1"]]);
  });

  it("refuses a turn that would land on the neighbour", () => {
    // Bedroom A's first bed, turned, stays inside the room and reaches across the
    // aisle into the second bed. Contained but not clear, so: collision.
    const bed = pieceOf(pieces, "bedA-bed-0");
    expect(containedBy(pieceBox({ ...bed, yaw: 90 }), roomOf(suite, "bedA"))).toBe(true);
    const r = tryRotate(bed, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect([r.reason, r.against]).toEqual(["collision", ["bedA-bed-1"]]);
  });
});

describe("nudge: the same tryMove, asked for the first step that moves", () => {
  it("takes four grid steps to go where one 2 ft drag goes, out in the open", () => {
    // The contract the phase spec asks for in as many words: the pointer path and
    // the keyboard path have to be able to produce identical results. Run out in
    // the middle of the common room, clear of every wall's catchment, so nothing
    // but the step size is under test.
    const start = tryMove(pieceOf(pieces, "common1-shelf-0"), { u: 5.5, v: 5 }, ctx);
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    expect(4 * GRID).toBe(2);

    let stepped = start.piece;
    for (let i = 0; i < 4; i++) {
      const r = nudge(stepped, "u+", ctx);
      expect(r.ok, `step ${i}`).toBe(true);
      if (!r.ok) return;
      stepped = r.piece;
    }
    const dragged = tryMove(start.piece, { u: start.piece.u + 2, v: start.piece.v }, ctx);
    expect(dragged.ok).toBe(true);
    if (!dragged.ok) return;
    expect(stepped).toEqual(dragged.piece);
    expect(stepped.u).toBe(7.5);
    // Non-vacuity: it really did travel, and by the full 2 ft.
    expect(stepped.u - start.piece.u).toBe(2);

    // WHAT THE RETRY DID TO THIS EQUIVALENCE, stated rather than deleted. It holds
    // out here and it holds for the reason it always did -- every offer of one step
    // moves, so nudge() never asks for a second one -- but it is now a claim about
    // open floor and not about nudge() in general. Inside a wall's catchment the
    // first press is worth 1.5 ft and the composition fails by the measured
    // difference below: bedroom A's bed, flush against its wall, is 3 ft along after
    // four presses where the 2 ft drag is 2 ft along.
    //
    // The alternative to that failure was the previous behaviour, where the bed was
    // 0 ft along after four presses and the equivalence held vacuously.
    const flushBed = pieceOf(pieces, "bedA-bed-0");
    let walked = flushBed;
    for (let i = 0; i < 4; i++) {
      const r = nudge(walked, "v+", ctx);
      expect(r.ok, `press ${i}`).toBe(true);
      if (!r.ok) return;
      walked = r.piece;
    }
    const bedDrag = tryMove(flushBed, { u: flushBed.u, v: flushBed.v + 2 }, ctx);
    expect(bedDrag.ok).toBe(true);
    if (!bedDrag.ok) return;
    expect([walked.v - flushBed.v, bedDrag.piece.v - flushBed.v]).toEqual([3, 2]);
  });

  it("moves one grid step in each of the four directions", () => {
    const from = { u: 5.5, v: 5 };
    const shelf = { ...pieceOf(pieces, "common1-shelf-0"), ...from };
    const got: Record<string, [number, number]> = {};
    for (const dir of ["u+", "u-", "v+", "v-"] as const) {
      const r = nudge(shelf, dir, ctx);
      expect(r.ok, dir).toBe(true);
      if (!r.ok) return;
      got[dir] = [r.piece.u, r.piece.v];
      expect(r.snapped, dir).toBe("none");
    }
    expect(got).toEqual({
      "u+": [6, 5],
      "u-": [5, 5],
      "v+": [5.5, 5.5],
      "v-": [5.5, 4.5],
    });
  });

  it("goes through the same door check, and refuses identically to the drag", () => {
    // The property is keyboard/pointer parity ON A REFUSAL, which is the whole
    // reason both paths go through one place(): two paths can agree about a legal
    // move by arithmetic alone and still disagree about which moves are legal, and
    // the refusal is where that shows. So the whole result has to match, not just
    // the verdict.
    //
    // This used to nudge bedroom A's second desk south from where layout() put it,
    // which was already in the doorway. It is not there any more, so the case is set
    // up instead: the desk is parked at u 10, one grid step short of d0's landing at
    // u 14 -- box u 10 to 14, far edge exactly on the landing's edge, touching and
    // therefore legal -- and then nudged the one step that carries it in.
    const parked: Piece = { ...pieceOf(pieces, "bedA-desk-0"), u: 10, v: 19.5 };
    const local = { ...ctx, pieces: [...pieces.filter((p) => p.id !== parked.id), parked] };
    // Where it starts is legal and clear of the door, so the refusal below is the
    // step's and not the starting position's.
    expect(blocks(parked, walls, openings)).toEqual([]);
    expect(tryMove(parked, { u: parked.u, v: parked.v }, local).ok).toBe(true);

    const r = nudge(parked, "u+", local);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect([r.reason, r.against]).toEqual(["blocks-door", ["d0", "hall", "bedA"]]);
    expect(r).toEqual(tryMove(parked, { u: parked.u + GRID, v: parked.v }, local));

    // And the refusal that comes back is the FIRST offer's, per nudge()'s own note,
    // which here is only demonstrable because every offer up to the cap is refused
    // too -- the desk is 4 ft long and the landing 4.5 ft deep, so it cannot step
    // over it. Without this the equality above would also pass on a nudge that
    // stopped at one attempt for the wrong reason.
    for (let steps = 1; steps <= MAX_NUDGE_STEPS; steps++) {
      const d = tryMove(parked, { u: parked.u + steps * GRID, v: parked.v }, local);
      expect(d.ok, `${steps} steps`).toBe(false);
      if (d.ok) return;
      expect(d.reason, `${steps} steps`).toBe("blocks-door");
    }
  });

  it("goes through the same collision check, against ctx.pieces", () => {
    const a = dresserIn("a", "bath", 9, 29);
    const b = dresserIn("b", "bath", 11.5, 29);
    const two: DragCtx = { ...ctx, pieces: [a, b] };
    // Flush against each other to start with, which is legal: touching is not
    // overlapping, per collide.ts.
    expect(tryMove(a, { u: a.u, v: a.v }, two).ok).toBe(true);
    const r = nudge(a, "u+", two);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect([r.reason, r.against]).toEqual(["collision", ["b"]]);
  });

  it("clamps flush when nudged INTO a wall, rather than escalating out of the room", () => {
    // WALL_SNAP is 1 ft and a step is 0.5, so the first two offers into a wall are
    // pulled back flush and neither of them moves the piece. The third clears the
    // catchment on the far side of the wall and is refused outright -- and the
    // result is still the first offer's, because when nothing moves nudge() returns
    // the first attempt. An arrow key into a wall therefore stops the piece at the
    // wall, exactly as it did before the retry existed.
    //
    // This asserted the same three things before the retry, on one attempt instead
    // of three: ok, unchanged v, snapped "wall". What is new is the last two
    // assertions, which are what stop the retry from turning a clamp into an
    // outside-room refusal at the cap.
    expect(WALL_SNAP).toBeGreaterThan(GRID);
    const bed = pieceOf(pieces, "bedA-bed-0");
    expect(pieceBox(bed).v).toBe(roomOf(suite, "bedA").v); // already flush
    const r = nudge(bed, "v-", ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.piece.v).toBe(bed.v);
    expect(r.snapped).toBe("wall");
    // The whole one-step result, so the clamp is demonstrably the pointer path's.
    expect(r).toEqual(tryMove(bed, { u: bed.u, v: bed.v - GRID }, ctx));
    // Non-vacuity for "the first offer and not the last": the offer at the cap is a
    // refusal, and a different answer from the one that came back.
    const atCap = tryMove(bed, { u: bed.u, v: bed.v - MAX_NUDGE_STEPS * GRID }, ctx);
    expect(atCap.ok).toBe(false);
    if (atCap.ok) return;
    expect([atCap.reason, atCap.against]).toEqual(["outside-room", ["bedA"]]);
  });

  it("walks a piece off the wall it was welded to, and leaves the drag where it was", () => {
    // WHAT THIS ASSERTED BEFORE: that the bookcase, 0.5 ft off the facade, answered
    // four consecutive "u+" nudges with u = 0 every time -- and that this was
    // acceptable because a drag to u = 1 lands at u = 0 too. WHAT IT ASSERTS NOW:
    // the walk. The old reading was wrong about the equivalence it claimed: a drag
    // is continuous and gets past the catchment on the way, so the pointer user
    // never meets the trap the keyboard user is held in. Identical arithmetic on
    // one target is not an identical interaction.
    //
    // The pointer half is kept, unchanged, beside the new walk: what moved is what
    // a keypress asks for, and not the snapping it asks through.
    let p = pieceOf(pieces, "common1-shelf-0");
    expect(p.u).toBe(0.5);
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = nudge(p, "u+", ctx);
      expect(r.ok, `press ${i}`).toBe(true);
      if (!r.ok) return;
      p = r.piece;
      seen.push(p.u);
    }
    // The first press is the one that reads oddly and it is the shared snap doing
    // it, not the retry: 0.5 is inside the catchment, one step asks for 1.0, and 1.0
    // snaps flush to 0. That is a real change of position, so the retry stops there
    // and does not escalate past it. The press after it escapes.
    expect(seen).toEqual([0, 1.5, 2, 2.5]);

    const flush = tryMove(pieceOf(pieces, "common1-shelf-0"), { u: 1, v: 0 }, ctx);
    expect(flush.ok).toBe(true);
    if (!flush.ok) return;
    expect(flush.piece.u).toBe(0);
    // Past the catchment a drag is still taken as given -- and it is now the same
    // 1.5 ft the second keypress reaches. One rule, two inputs, both able to get
    // there.
    const far = tryMove(pieceOf(pieces, "common1-shelf-0"), { u: 1.5, v: 0 }, ctx);
    expect(far.ok).toBe(true);
    if (!far.ok) return;
    expect(far.piece.u).toBe(1.5);
  });
});

describe("nudge off a wall: the retry, its cap, and what it refuses to do", () => {
  const bed = pieceOf(pieces, "bedA-bed-0");
  const bedA = roomOf(suite, "bedA");

  it("caps the retry at the smallest number of steps that clears the catchment", () => {
    // The cap is derived from WALL_SNAP and GRID, and this is the derivation as a
    // property rather than as the arithmetic that produced it: one step short of the
    // cap is still inside the catchment -- snapAxis's test is `> threshold`, so a
    // step landing exactly on 1 ft is caught by the wall -- and the cap is the first
    // step outside it.
    expect((MAX_NUDGE_STEPS - 1) * GRID).toBeLessThanOrEqual(WALL_SNAP);
    expect(MAX_NUDGE_STEPS * GRID).toBeGreaterThan(WALL_SNAP);
    // And the numbers themselves, so that moving either constant in collide.ts
    // shows up here as a changed figure and not only as a satisfied inequality.
    expect([WALL_SNAP, GRID, MAX_NUDGE_STEPS]).toEqual([1, 0.5, 3]);
  });

  it("moves a piece flush against a wall away from it on a single keypress", () => {
    // The defect, as the behaviour it should have had all along. Bedroom A's first
    // bed stands flush against the room's south wall; 0.5 ft out is inside the 1 ft
    // catchment, 1.0 ft is still caught, and before the retry one keypress could not
    // reach the 1.5 ft that gets clear -- so the key did nothing at all, which is
    // not the keyboard equivalent design-system/MASTER.md requires of every canvas
    // interaction.
    expect(pieceBox(bed).v).toBe(bedA.v);
    const r = nudge(bed, "v+", ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.piece.v).toBe(17);
    expect(r.piece.v - bed.v).toBe(MAX_NUDGE_STEPS * GRID);
    // Clear of the catchment rather than merely off the wall, which is what makes
    // the next press worth pressing.
    expect(r.piece.v - bedA.v).toBeGreaterThan(WALL_SNAP);
    expect(r.snapped).toBe("none");
    // Only where it is changed, same as a drag: a keypress is not a licence to
    // rewrite the piece.
    expect({ ...r.piece, v: bed.v }).toEqual(bed);
  });

  it("lands on the grid, and on the first position that differs rather than the furthest", () => {
    const r = nudge(bed, "v+", ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(onGrid(r.piece.v)).toBe(true);
    expect(r.piece.v).toBe(bed.v + 3 * GRID);

    // Minimal, and shown by the pointer path's own answers rather than by
    // re-deriving the catchment here: a drag to either of the two offers below the
    // one taken lands the bed back exactly where it started, so 1.5 ft is not a
    // choice of step size, it is the first offer that is not a no-op.
    for (const steps of [1, 2]) {
      const d = tryMove(bed, { u: bed.u, v: bed.v + steps * GRID }, ctx);
      expect(d.ok, `${steps} steps`).toBe(true);
      if (!d.ok) return;
      expect(d.piece.v, `${steps} steps`).toBe(bed.v);
    }

    // And the escalation happens only when one step is a no-op. Out in the middle
    // of the common room one step moves, so one step is all a press is worth --
    // otherwise every keypress anywhere would have become a 1.5 ft jump.
    const open = { ...pieceOf(pieces, "common1-shelf-0"), u: 5.5, v: 5 };
    const one = nudge(open, "u+", ctx);
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(one.piece.u - open.u).toBe(GRID);
  });

  it("walks in even grid steps once it is clear of the catchment", () => {
    // The first press pays for the escape and every press after it is worth exactly
    // one step, because a step from 1.5 ft out is no longer inside the catchment and
    // the retry never engages. Coarse first move, then fine control.
    let p = bed;
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = nudge(p, "v+", ctx);
      expect(r.ok, `press ${i}`).toBe(true);
      if (!r.ok) return;
      p = r.piece;
      seen.push(p.v);
    }
    expect(seen).toEqual([17, 17.5, 18, 18.5]);
    expect(seen.slice(1).map((v, i) => v - seen[i]!)).toEqual([GRID, GRID, GRID]);
  });

  it("snaps flush again in one step when it is nudged back TOWARD the wall", () => {
    // Unchanged by the retry, and it has to be: from 1.5 ft out the one-step offer
    // is 1 ft out, the wall catches that and takes it flush, and a first offer that
    // moves is always the answer. So the piece returns to the wall in one press
    // rather than being carried on to some further offer.
    const out = { ...bed, v: 17 };
    const r = nudge(out, "v-", ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.piece.v).toBe(bedA.v);
    expect(r.snapped).toBe("wall");
    // The whole one-step result, so no retry can have run.
    expect(r).toEqual(tryMove(out, { u: out.u, v: out.v - GRID }, ctx));

    // And from 2 ft out, where one step neither snaps nor is absorbed, the press is
    // worth exactly one step and stops 1.5 ft off the wall. This is the assertion
    // that would catch a retry which escalated unconditionally: at the cap the same
    // press would be at the wall instead, having skipped the only position between
    // the two that the piece can actually rest at.
    const further = { ...bed, v: 17.5 };
    const fine = nudge(further, "v-", ctx);
    expect(fine.ok).toBe(true);
    if (!fine.ok) return;
    expect([fine.piece.v, fine.snapped]).toEqual([17, "none"]);
    expect(fine).toEqual(tryMove(further, { u: further.u, v: further.v - GRID }, ctx));
  });

  it("returns the first attempt's refusal when every step to the cap is refused", () => {
    // Genuinely boxed in: a dresser with a bookcase stood on end against its side
    // and a second bookcase beyond that one. Touching is a legal arrangement to
    // start with, per collide.ts, and every offer up to the cap is refused, so a
    // refusal is all there is to return.
    //
    // WHICH refusal is the point. By 3 steps the dresser has reached the far
    // bookcase as well and `against` names both, which would have the UI announce
    // something 1.5 ft away that the user never asked to touch. What stopped them is
    // the near one.
    const a = dresserIn("a", "bedA", 4, 18);
    const b: Piece = { ...a, id: "b", kind: "shelf", ...SIZES.shelf, u: 6.5, yaw: 90 };
    const c: Piece = { ...b, id: "c", u: 7.5 };
    const boxed: DragCtx = { ...ctx, pieces: [a, b, c] };
    // u 4 to 6.5, 6.5 to 7.5, 7.5 to 8.5, all sharing v 18 upward: flush, legal.
    expect([a, b, c].map((p) => pieceBox(p).u)).toEqual([4, 6.5, 7.5]);
    expect(tryMove(a, { u: a.u, v: a.v }, boxed).ok).toBe(true);

    const r = nudge(a, "u+", boxed);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect([r.reason, r.against]).toEqual(["collision", ["b"]]);

    // Non-vacuity: the cap really was offered, and its answer really is the other
    // one. Without this the assertion above would pass on a nudge that never
    // retried at all.
    const atCap = tryMove(a, { u: a.u + MAX_NUDGE_STEPS * GRID, v: a.v }, boxed);
    expect(atCap.ok).toBe(false);
    if (atCap.ok) return;
    expect([atCap.reason, atCap.against]).toEqual(["collision", ["b", "c"]]);
  });

  it("leaves the pointer path untouched: a drag into the catchment still snaps flush", () => {
    // The retry lives in nudge() and not in place(), so a drag that asks for 0.5 or
    // 1 ft off the wall still gets flush. That is what keeps the ghost the renderer
    // paints on pointer-move the truth about where the piece will land -- a drag
    // that quietly travelled 1.5 ft because 0.5 was absorbed would be a ghost in the
    // wrong place.
    for (const steps of [1, 2]) {
      const d = tryMove(bed, { u: bed.u, v: bed.v + steps * GRID }, ctx);
      expect(d.ok, `${steps} steps`).toBe(true);
      if (!d.ok) return;
      expect([d.piece.v, d.snapped], `${steps} steps`).toEqual([bedA.v, "wall"]);
    }
    // Past the catchment it is taken as given, as it always was, and that is the
    // same position the keypress now reaches.
    const far = tryMove(bed, { u: bed.u, v: bed.v + MAX_NUDGE_STEPS * GRID }, ctx);
    expect(far.ok).toBe(true);
    if (!far.ok) return;
    expect([far.piece.v, far.snapped]).toEqual([17, "none"]);
  });
});

describe("property sweep over randomised suites and targets", () => {
  /**
   * The generator from tests/furniture.test.ts, unchanged except for the facade.
   * Every stated dimension inside the resident's stated tolerance, doubled where he gave a
   * range himself or where the number is inferred; the section length derived so
   * that residuals.along stays zero and bedroom B does not go to nothing.
   *
   * The facade is flipped too, because the phase asks for both. It is worth saying
   * that this costs nothing geometrically: buildSuite() never reads params.facade
   * -- place.ts does, when it puts the finished suite into the building -- so both
   * values produce identical rooms and the sweep is testing that this module does
   * not somehow acquire an opinion about it.
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
      facade: rnd() < 0.5 ? "east" : "west",
    };
    p.legDepth = p.hallWidth + p.partition + p.bedDepth;
    p.sectionLength =
      p.commonAlong + p.bedAAlong + p.bathAlong + p.bedBAlong + 3 * p.partition;
    return p;
  };

  it("never returns ok for a placement placeIsLegal rejects, over 360 drags", () => {
    const rnd = makeRnd(20260730);
    const tally = {
      ok: 0,
      collision: 0,
      "outside-room": 0,
      "blocks-door": 0,
      grid: 0,
      wall: 0,
      none: 0,
      rotates: 0,
      nudges: 0,
      facades: new Set<string>(),
    };

    for (let i = 0; i < 30; i++) {
      const s = buildSuite(plausible(rnd));
      // If this trips, the generator is wrong, not the drag maths.
      expect(findOverlaps(s.rooms), `suite ${i} setup`).toEqual([]);
      const built = buildWalls(s);
      const ps = layout(s);
      const c: DragCtx = { suite: s, pieces: ps, openings: built.openings };
      tally.facades.add(s.params.facade);

      /**
       * The property, stated once: an accepted result must satisfy placeIsLegal
       * against the room the piece names and the other pieces in it -- which is
       * the exact wording of the phase spec -- must not stand in a doorway, and
       * must have been snapped rather than taken as given.
       */
      const check = (what: string, p: Piece, r: ReturnType<typeof tryMove>) => {
        if (!r.ok) {
          // A rejection the UI cannot explain is the failure this is guarding
          // against, so an empty `against` is a failure too.
          expect(r.against.length, `${what} ${r.reason}`).toBeGreaterThan(0);
          tally[r.reason]++;
          return;
        }
        const room = roomOf(s, r.piece.room);
        const others = c.pieces.filter((o) => o.id !== r.piece.id && o.room === r.piece.room);
        const verdict = placeIsLegal(pieceBox(r.piece), room, others.map(pieceBox));
        expect(verdict.ok, `${what}: accepted "${verdict.reason}"`).toBe(true);
        // Stronger than placeIsLegal asks: nothing anywhere in the suite, not just
        // in this room. A piece attributed to the wrong room could be legal in it
        // and still standing in another room's furniture.
        const all = c.pieces.filter((o) => o.id !== r.piece.id);
        expect(
          placeIsLegal(pieceBox(r.piece), room, all.map(pieceBox)).ok,
          `${what}: overlaps across rooms`,
        ).toBe(true);
        expect(blocks(r.piece, built.walls, built.openings), `${what}: in a doorway`).toEqual([]);
        // Snapped, on both axes: either on the grid or flush against a wall of its
        // own room. Sliders move walls off the grid, which is why flush counts.
        const f = pieceBox(r.piece);
        const flush = (lo: number, size: number, roomLo: number, roomSize: number) =>
          Math.abs(lo - roomLo) < EPS || Math.abs(lo + size - (roomLo + roomSize)) < EPS;
        expect(
          onGrid(r.piece.u) || flush(f.u, f.du, room.u, room.du),
          `${what}: u ${r.piece.u} neither on grid nor flush`,
        ).toBe(true);
        expect(
          onGrid(r.piece.v) || flush(f.v, f.dv, room.v, room.dv),
          `${what}: v ${r.piece.v} neither on grid nor flush`,
        ).toBe(true);
        // Identity and size are the piece's own; a move may change only where it
        // is and which way it faces.
        expect({ ...r.piece, u: p.u, v: p.v, yaw: p.yaw }, what).toEqual(p);
        tally[r.snapped]++;
        tally.ok++;
      };

      for (let j = 0; j < 12; j++) {
        const p = ps[Math.floor(rnd() * ps.length)]!;
        const room = roomOf(s, p.room);
        // Three quarters of the targets land in or just beyond the piece's own
        // room, where the interesting rejections are; the rest are thrown well
        // outside the building, which is the case a pointer ray produces when the
        // drag leaves the floor.
        const near = rnd() < 0.75;
        const to = near
          ? {
              u: room.u - 3 + rnd() * (room.du + 6),
              v: room.v - 3 + rnd() * (room.dv + 6),
            }
          : { u: (rnd() - 0.5) * 400, v: (rnd() - 0.5) * 400 };
        // A share of the targets arrive already on the grid, or snapped: "none" is
        // unreachable -- a uniform float is off the grid with probability 1, and a
        // sweep that never produced "none" would not be testing the label at all.
        if (rnd() < 0.4) {
          to.u = Math.round(to.u / GRID) * GRID;
          to.v = Math.round(to.v / GRID) * GRID;
        }
        check(`suite ${i} target ${j}`, p, tryMove(p, to, c));
      }

      // The same property for the other two entry points. nudge() and tryRotate()
      // share place() with tryMove(), so this is a check that they really do rather
      // than an independent claim.
      for (let j = 0; j < 3; j++) {
        const p = ps[Math.floor(rnd() * ps.length)]!;
        const dir = (["u+", "u-", "v+", "v-"] as const)[Math.floor(rnd() * 4)]!;
        check(`suite ${i} nudge ${j}`, p, nudge(p, dir, c));
        tally.nudges++;
        const q = ps[Math.floor(rnd() * ps.length)]!;
        check(`suite ${i} rotate ${j}`, q, tryRotate(q, c));
        tally.rotates++;
      }
    }

    /*
     * Non-vacuity. Every branch has to have been reached, or the property above is
     * a statement about an empty set. Re-measured at this seed against the fit-out
     * as it stands, over 360 drags, 90 nudges and 90 rotations: 179 accepted, 261
     * outside-room, 92 collision, 8 blocks-door, and of the accepted, 86 snapped
     * to the grid, 84 to a wall and 9 needed neither.
     *
     * THOSE WERE 164 / 262 / 104 / 10 AND 72 / 83 / 9 BEFORE THE HALL-TO-COMMON-ROOM
     * DOOR, and 15 of the 540 outcomes moving is more than a new door's own landing can
     * account for. It is not: the door MOVED THE FIT-OUT. furniture.ts's commonSlots()
     * runs farLimit() against every door landing, so d5's landing on the common room's
     * inner face pulls the sofa, the table and its two chairs inboard wherever it
     * reaches them. Measured over this generator's own first 30 suites, by dumping
     * layout() with the door and without it: 5 of the 30 arrangements move, always the
     * same four pieces, always 0.5 to 1.0 ft in u, and never a piece dropped -- 870
     * pieces both ways. So fewer random targets come down on the common room's group
     * and more land on open floor, which is the collision-to-accepted shift above.
     *
     * blocks-door falling from 10 to 8 has the same cause and is the one to watch: the
     * new door adds a landing and the count still went DOWN, because the group it moved
     * was standing in reach of d3's landing and is now further from it. Eight is still
     * eight cases and the bound below is five, but a bound this near its measurement is
     * measuring the seed, which is why the specific-case tests above pin one per door
     * with literals instead.
     *
     * What the retry in nudge() did to that, measured both ways with the same seed:
     * it moved exactly one of the 540 outcomes, a nudge that used to be absorbed by
     * a wall and now lands on the grid a step further out. The four verdict counts
     * were identical. That is the number to expect from a change that alters how far
     * a keypress asks to go and nothing about what the answer may be -- 90 of the
     * 540 cases are nudges at all, and most of those are nowhere near a wall.
     */
    expect(tally.ok + tally.collision + tally["outside-room"] + tally["blocks-door"]).toBe(540);
    expect(tally.nudges).toBe(90);
    expect(tally.rotates).toBe(90);
    expect(tally.facades).toEqual(new Set(["east", "west"]));
    for (const k of ["ok", "collision", "outside-room"] as const) {
      expect(tally[k], `nothing exercised ${k}`).toBeGreaterThan(10);
    }
    // blocks-door carries its own floor, because it is intrinsically the rarest of the
    // four -- layout() keeps the whole fit-out clear of the landings, so a random
    // target has to find one -- and because it sat one case above the shared 10 until
    // the sofa moved, and two below it once the hall-to-common-room door moved the
    // common room's group again. A bound that a quarter-foot design change crosses is
    // measuring the seed rather than the branch; eight is still eight cases, and the
    // specific-case tests above pin one per door with literals.
    expect(tally["blocks-door"], "nothing exercised blocks-door").toBeGreaterThan(5);
    for (const k of ["grid", "wall", "none"] as const) {
      expect(tally[k], `nothing snapped to ${k}`).toBeGreaterThan(5);
    }
  });

  /**
   * THE ROUND TRIP: pick a piece up, put it down without moving the pointer, and the
   * answer must be yes. For every piece of every arrangement layout() emits, not just
   * the default one.
   *
   * WHY IT IS A PROPERTY OVER RANDOMISED PARAMETERS AND NOT A SUITE OF CASES
   *   The whole point of a parametric fit-out is that the sliders move the walls, and
   *   the failure is a quarter-foot one: drag.ts judges the position it is HANDED, and a
   *   re-drop hands it the piece's own anchor SNAPPED onto the 0.5 ft grid, so a piece
   *   with under GRID / 2 of margin on an off-grid anchor is legal where it stands and
   *   refused where it stands. Every room corner in the DEFAULT suite is on the grid --
   *   tests/collide.test.ts asserts that -- so at the defaults snapToGrid() is very
   *   nearly the identity and the defect barely shows: it cost exactly one piece, the
   *   sofa, and the test above pins it. Move a wall a third of a foot and it shows
   *   everywhere. A default-only assertion is therefore the one that CANNOT catch this,
   *   which is why the numbers below were measured over sweeps and not over the suite
   *   anybody looked at.
   *
   * BOTH GENERATORS, DELIBERATELY
   *   The first 60 sets keep the section closed, so the arrangement is the designed one
   *   and what is under test is furniture.ts's recipes -- gridUp() and gridDown() there.
   *   The last 120 jitter the section length on its own, which is what a slider actually
   *   does, so bedroom B is sometimes far too small and pieces are rescued onto the grid
   *   all over the suite. That half is the harder one and it is the half no recipe can
   *   answer for: a rescued piece stands where no recipe chose it, so only
   *   furniture.ts's redroppable() gate covers it. Measured, dropping the gate and
   *   keeping the recipes leaves 52 dressers failing over tests/furniture.test.ts's
   *   240-set sweep and 71 pieces over its 160-set off-closure one.
   *
   * WHAT IS ASSERTED IS ACCEPTANCE, NOT STILLNESS
   *   A re-drop is allowed to move a piece; it is not allowed to refuse one. Ten of the
   *   29 default anchors are off the grid for reasons no fix should touch -- a chair
   *   centred on its 4 ft desk stands at u 11.25 -- and shift a quarter foot when put
   *   back. That is the UI's own snapping. The count below is the non-vacuity that
   *   matters most here: if every anchor were on the grid this property would be a
   *   statement about snapToGrid() being the identity and would hold however broken the
   *   recipes were.
   */
  it("puts every designed piece back where it stands, over 180 randomised suites", () => {
    const rnd = makeRnd(20260731);
    const stuck: string[] = [];
    let pieces = 0;
    let offGrid = 0;
    let shifted = 0;
    let degraded = 0;
    const facades = new Set<string>();

    for (let i = 0; i < 180; i++) {
      const p = plausible(rnd);
      if (i >= 60) {
        // Off closure, so bedroom B gets whatever the section has left. Floored the
        // same way tests/furniture.test.ts floors it, because a negative-width rect is
        // a buildSuite() input error rather than something layout() survives.
        const upToBedB = p.commonAlong + p.bedAAlong + p.bathAlong + 3 * p.partition;
        p.sectionLength = Math.max(upToBedB + 2, 44 + (rnd() * 2 - 1) * 6);
      }
      const s = buildSuite(p);
      // If this trips, the generator is wrong, not the drag maths.
      expect(findOverlaps(s.rooms), `suite ${i} setup`).toEqual([]);
      const built = buildWalls(s);
      const ps = layout(s);
      const c: DragCtx = { suite: s, pieces: ps, openings: built.openings };
      facades.add(s.params.facade);
      if (ps.length < 29) degraded++;

      for (const q of ps) {
        pieces++;
        if (!onGrid(q.u) || !onGrid(q.v)) offGrid++;
        const r = tryMove(q, { u: q.u, v: q.v }, c);
        if (!r.ok) {
          // The id, the verdict and what it hit, so a failure names the piece and the
          // neighbour rather than reporting a count. This is the assertion.
          stuck.push(`suite ${i} ${q.id} ${r.reason} against ${r.against.join(" ")}`);
          continue;
        }
        if (r.snapped !== "none") shifted++;
      }
    }

    expect(stuck).toEqual([]);
    // RE-MEASURED WITH THE HALL-TO-COMMON-ROOM DOOR IN PLACE, and all five numbers below
    // are unchanged: 0 stuck, 5146 / 4903 / 5116 / 21 / 213. The door does move the
    // fit-out -- it pulls the common room's sofa, table and two chairs inboard where its
    // landing reaches them, measured in 5 of the 30 suites of the sweep above -- so this
    // holding still is the statement, not the absence of one: every piece the app ships
    // is still a piece the app will accept, with one more door to clear.
    //
    // Non-vacuity, in the order it matters. Measured at this seed: 5146 pieces over the
    // 180 suites, 4903 of them on an anchor off the grid, 5116 moved by the re-drop, and
    // 21 of the 120 off-closure arrangements degraded.
    //
    // The middle two are close and not equal, and the 213 between them is the sweep
    // earning its keep: those are pieces whose anchor IS on the grid and which the
    // re-drop moved anyway, because snapToWalls() runs second and pulled them flush
    // against a wall a slider had taken off the grid. So the property is not just about
    // snapToGrid() -- it covers the composition drag.ts's place() actually applies, which
    // is the whole reason furniture.ts's redroppable() applies the same two calls in the
    // same order rather than rounding to the grid and calling it done.
    expect(pieces).toBeGreaterThan(5000);
    expect(offGrid, "every anchor on the grid: the property is vacuous").toBeGreaterThan(4000);
    expect(shifted, "no re-drop moved anything: the snapping is untested here").toBeGreaterThan(
      4000,
    );
    expect(shifted - offGrid, "no on-grid anchor was moved: wall snap is untested").toBeGreaterThan(
      50,
    );
    // Or the second half of the sweep is testing the recipes over again rather than the
    // rescue scan, which is the half the gate exists for.
    expect(degraded, "nothing degraded: the rescue scan is untested").toBeGreaterThan(10);
    expect(facades).toEqual(new Set(["east", "west"]));
  });
});

/** Feet to a readable string for the door-landing assertions. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
