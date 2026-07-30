import { describe, it, expect, beforeEach } from "vitest";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import { doorLandings, layout, pieceBox } from "@/geo/furniture";
import { containedBy } from "@/geo/collide";
import { tryMove } from "@/geo/drag";
import { buildWalls } from "@/geo/walls";
import { CUTAWAY_MODES } from "@/scene/cutaway";
import { OCCUPANCY_RANGE, DEFAULT_OCCUPANCY, pieceLabel, useStore } from "@/state/store";
import { DEFAULT_SNAPSHOT, decode, encode } from "@/state/url";

/**
 * The editable store: what a slider is allowed to do to the furniture standing on it.
 *
 * The three outcomes of setParams() are the substance here, and the middle one is the
 * reason P6 exists. A dimension the audit tags INFERRED has to be correctable, so a
 * patch that produces a legal suite must go through even if a bed is standing in the
 * way -- and then it must SAY that the bed went. The two failures being tested against
 * are the opposite pairing: silently overlapping furniture, which is the failure
 * docs/phases/P6.md names, and a slider that cannot be moved at all because something
 * is on it.
 *
 * Every fixture below is a measured outcome, not a guess. The patches were probed
 * against the real recipes and the counts and names recorded; a recipe change that
 * moves them should show up here as a diff to read rather than as a test to re-green.
 */

/** The store is a module singleton, so every test starts from the shipped defaults. */
beforeEach(() => {
  useStore.getState().resetAll();
  useStore.setState({ notice: null });
});

describe("the shipped opening state", () => {
  it("is url.ts's DEFAULT_SNAPSHOT, so the default arrangement is shareable", () => {
    const s = useStore.getState();
    expect(s.pieces).toBe(DEFAULT_SNAPSHOT.pieces);
    expect(s.cutaway).toBe("none");
    expect(s.occupancy).toBe(DEFAULT_OCCUPANCY);
    expect(s.selected).toBe(null);
    // The point of sharing the object rather than re-deriving it: the app's own
    // opening state is a fixed point of the format.
    expect(decode(encode({ ...DEFAULT_SNAPSHOT, pieces: s.pieces }))?.pieces).toEqual(s.pieces);
  });

  it("agrees with furniture.ts about the default occupancy", () => {
    // store.ts copies furniture.ts's unexported DEFAULT_BEDS as DEFAULT_OCCUPANCY.
    // This is the anti-drift gate for the copy, pinned against layout()'s behaviour
    // rather than against a literal.
    const suite = buildSuite();
    expect(layout(suite, { beds: DEFAULT_OCCUPANCY })).toEqual(layout(suite));
    // Non-vacuity, and it has to go DOWN rather than up: the recipes cap at four
    // beds -- bedroomSlots() holds a two-to-a-bedroom limit -- so `beds: 5` produces
    // exactly the default fit-out and an upward check would pass while proving
    // nothing. Measured: 1 -> 1 bed, 2 -> 2, 3 -> 3, 4 -> 4, 5 -> 4, 6 -> 4.
    expect(layout(suite, { beds: DEFAULT_OCCUPANCY - 1 })).not.toEqual(layout(suite));
    expect(layout(suite, { beds: DEFAULT_OCCUPANCY + 1 })).toEqual(layout(suite));
  });

  it("stops the occupancy range where the recipes stop, not where the building does", () => {
    // The cap is bedroomSlots()'s, not Weld's: the building is documented as having
    // housed quints and sextuplets. A control that offered 6 would silently return 4,
    // so the range stops at 4 and the panel's note says whose limit it is. If a
    // future change to the recipes lifts the cap, this test is what says so.
    const suite = buildSuite();
    const bedsAt = (n: number) => layout(suite, { beds: n }).filter((p) => p.kind === "bed").length;
    expect(bedsAt(OCCUPANCY_RANGE.max)).toBe(OCCUPANCY_RANGE.max);
    expect(bedsAt(OCCUPANCY_RANGE.max + 1)).toBe(OCCUPANCY_RANGE.max);
    expect(bedsAt(6), "quints and sextuplets are not expressible today").toBe(4);
  });
});

describe("setParams refuses a suite that is not a suite", () => {
  /**
   * Each of these is a different gate in whyIllegal(), in the order the function
   * checks them, and each message names the thing that would have been wrong. A
   * viewer cannot tell a broken model from a correct one by looking at it, which is
   * why refusing is the answer rather than rendering it with a warning.
   */
  const refusals = [
    { patch: { bathDeep: 20 }, says: /Unknown would have no floor left/ },
    { patch: { sectionLength: 60 }, says: /wider than Weld's waist/ },
    { patch: { legDepth: 18 }, says: /Hall and Bedroom A would overlap/ },
    { patch: { ceiling: 0 }, says: /ceiling has to be a positive length/ },
  ] as const;

  for (const { patch, says } of refusals) {
    it(`refuses ${JSON.stringify(patch)} and says why`, () => {
      const before = useStore.getState();
      useStore.getState().setParams(patch);
      const after = useStore.getState();
      expect(after.notice).toMatch(says);
      expect(after.notice).toMatch(/^Refused: /);
      // Nothing moved. Not the params, and not the furniture either -- a refusal
      // that dropped a piece on the way out would be the worst of both answers.
      expect(after.params).toEqual(before.params);
      expect(after.pieces).toBe(before.pieces);
    });
  }
});

describe("setParams drops what no longer fits, and names it", () => {
  /**
   * Measured outcomes. The counts come from running these patches against the
   * recipes, so they are a record of what the geometry does rather than a bound
   * somebody chose.
   */
  const drops = [
    // The bedrooms get shallower than the bed-dresser-chair-desk band needs, so both
    // desks and both chairs go in each room. Eight pieces, symmetric across A and B,
    // which is itself a check: an asymmetric result here would mean the two bedrooms
    // had stopped being mirror images.
    { patch: { bedDepth: 12 }, left: 21, names: [/Bedroom A desk 0/, /Bedroom B chair 1/] },
    // One bedroom gets shorter along the section, so the SECOND of each pair goes --
    // fitOut places in priority order, so what is lost is the furniture the room
    // could least afford, not an arbitrary one.
    { patch: { bedAAlong: 8 }, left: 26, names: [/Bedroom A bed 1/, /Bedroom A dresser 1/] },
    // The common room shrinking moves bedroom A along v as well, because the along-
    // hall chain is one sum: a slider on one room is not local to that room.
    { patch: { commonAlong: 12 }, left: 24, names: [/Common room shelf 1/, /Bedroom A bed 1/] },
  ] as const;

  for (const { patch, left, names } of drops) {
    it(`${JSON.stringify(patch)} leaves ${left} pieces`, () => {
      const before = useStore.getState().pieces.length;
      expect(before).toBe(29);
      useStore.getState().setParams(patch);
      const after = useStore.getState();
      expect(after.pieces.length).toBe(left);
      expect(after.params).toMatchObject(patch);
      for (const n of names) expect(after.notice).toMatch(n);
      expect(after.notice).toMatch(/no longer fit and were removed/);

      // The survivors are not merely fewer: every one of them stands inside its own
      // room in the NEW suite. This is the assertion that would catch a drop pass
      // that counted correctly and kept the wrong pieces.
      const suite = buildSuite(after.params);
      for (const p of after.pieces) {
        const room = suite.rooms.find((r) => r.id === p.room)!;
        expect(containedBy(pieceBox(p), room), pieceLabel(suite, p.id)).toBe(true);
      }
    });
  }

  it("keeps everything when the change does not touch the floor plan", () => {
    // Non-vacuity for the whole block above: if survivors() dropped pieces
    // indiscriminately these would go too. The ceiling is a height and bathDeep 8 is
    // the top of the audit's own bracket, so both are legal and neither moves a room
    // out from under a piece.
    for (const patch of [{ ceiling: 9 }, { bathDeep: 8 }] as const) {
      useStore.getState().resetAll();
      useStore.getState().setParams(patch);
      const after = useStore.getState();
      expect(after.pieces.length, JSON.stringify(patch)).toBe(29);
      expect(after.notice).toBe(null);
    }
  });

  it("clears the selection when the selected piece is one of the dropped", () => {
    useStore.getState().select("bedA-desk-0");
    useStore.getState().setParams({ bedDepth: 12 });
    expect(useStore.getState().selected).toBe(null);
  });

  it("keeps a selection that survived", () => {
    // The other half of the branch. bedA-bed-0 is the first bed placed and stays.
    useStore.getState().select("bedA-bed-0");
    useStore.getState().setParams({ bedDepth: 12 });
    expect(useStore.getState().pieces.some((p) => p.id === "bedA-bed-0")).toBe(true);
    expect(useStore.getState().selected).toBe("bedA-bed-0");
  });
});

describe("moving one piece", () => {
  it("nudges it a grid step and clears the notice", () => {
    useStore.setState({ notice: "stale" });
    const before = useStore.getState().pieces.find((p) => p.id === "bedA-bed-0")!;
    useStore.getState().nudge("bedA-bed-0", "v+");
    const after = useStore.getState().pieces.find((p) => p.id === "bedA-bed-0")!;
    expect(after.v).toBeGreaterThan(before.v);
    expect(useStore.getState().notice).toBe(null);
    expect(useStore.getState().selected).toBe("bedA-bed-0");
  });

  it("words a refusal in terms of what it hit, rather than swallowing it", () => {
    // Driven until something refuses rather than assuming a particular step does:
    // the arrangement is the recipes' business and it moves. What is asserted is that
    // a refusal, when it comes, names something -- a room, a piece or a door -- and
    // that the piece did not move on the frame it was refused.
    // v+, not u-. The bed stands flush against the facade at u 0, so nudging it west
    // is caught by snapToWalls() and comes back accepted-but-unmoved for ever --
    // which is correct behaviour and useless as a refusal fixture. Along v it runs
    // into the second bed instead, and that is a refusal drag.ts has to name.
    let refused: string | null = null;
    for (let i = 0; i < 40 && refused === null; i++) {
      const before = useStore.getState().pieces.find((p) => p.id === "bedA-bed-0")!;
      useStore.getState().nudge("bedA-bed-0", "v+");
      const after = useStore.getState().pieces.find((p) => p.id === "bedA-bed-0")!;
      const notice = useStore.getState().notice;
      if (notice) {
        refused = notice;
        expect(after, "the piece must not move on the frame it was refused").toEqual(before);
      }
    }
    expect(refused, "20 ft north of its corner is out of a 10 ft bedroom").not.toBe(null);
    expect(refused).toMatch(/would (leave|overlap|block)/);
    // Naming something is the contract, not just refusing: drag.ts guarantees
    // `against` is non-empty, and a message with no subject in it would mean the
    // wording dropped what the geometry knew.
    expect(refused).toMatch(/Bedroom A|bed|door/);
  });

  it("words a blocked doorway as a sentence about circulation", () => {
    /*
     * The wording gate for the one refusal that is about the suite rather than about a
     * piece. drag.ts returns `["d1", "hall", "bath"]` -- the door, then the two rooms it
     * joins -- precisely so that this can read as "would block the door between the hall
     * and the bathroom" rather than as an id, and this is where that promise is kept.
     *
     * It lives here rather than in tests/e2e/edit.spec.ts, where docs/phases/P6.md's
     * fourth gate originally put it, because a doorway landing sits at the edge of a room
     * and the stage-5 camera does not show the edges: reaching one through the UI takes up
     * to 120 nudge presses against a 62 ms frame. The rule itself is pinned in
     * drag.test.ts, the chain from pointer to visible text is pinned in the e2e refusal
     * gate, and what is left -- the sentence -- is pinned here in a millisecond.
     *
     * Searched rather than aimed: doorLandings() is layout()'s business and moves.
     */
    const suite = buildSuite();
    const landings = doorLandings(suite);
    expect(landings.length, "the suite has doorways").toBeGreaterThan(0);

    let notice: string | null = null;
    outer: for (const p of useStore.getState().pieces) {
      for (const landing of landings) {
        // Aim the piece's anchor at the middle of a landing. tryMove snaps, so this is a
        // request rather than a placement, which is exactly what a drag is.
        useStore.getState().resetAll();
        useStore.setState({ notice: null });
        const before = useStore.getState().pieces.find((q) => q.id === p.id)!;
        useStore.getState().commit(
          p.id,
          tryMove(
            before,
            { u: landing.u + landing.du / 2, v: landing.v + landing.dv / 2 },
            {
              suite,
              pieces: useStore.getState().pieces,
              openings: buildWalls(suite).openings,
            },
          ),
        );
        const n = useStore.getState().notice;
        if (n && /block the door/.test(n)) {
          notice = n;
          break outer;
        }
      }
    }

    expect(notice, "some piece can be asked to stand in some doorway").not.toBeNull();
    // The shape of the sentence, not one particular door: which door a given piece can be
    // pushed into depends on the fit-out.
    expect(notice).toMatch(/would block the door between .+ and .+ \(d\d+\)\.$/);
    // And it names ROOMS, not ids: "hall" would mean the label lookup silently fell
    // through to the id, which is the failure this assertion exists for.
    expect(notice).not.toMatch(/between (hall|bath|bedA|bedB|common1|k) /);
  });

  it("does nothing at all for an id that is not in the suite", () => {
    const before = useStore.getState();
    useStore.getState().nudge("nowhere-bed-0", "u+");
    useStore.getState().rotate("nowhere-bed-0");
    expect(useStore.getState().pieces).toBe(before.pieces);
    expect(useStore.getState().notice).toBe(null);
  });
});

describe("refit", () => {
  it("re-runs the recipes at the current occupancy", () => {
    const bedsAfterRefit = (n: number) => {
      useStore.getState().resetAll();
      useStore.getState().setOccupancy(n);
      useStore.getState().refit();
      return useStore.getState().pieces.filter((p) => p.kind === "bed").length;
    };
    // One bed per student, up to the cap. Both ends are asserted because the middle
    // of the range is where an off-by-one in the split across the two bedrooms would
    // hide: at 1 and at 4 an even split and a greedy one agree.
    expect(bedsAfterRefit(1)).toBe(1);
    expect(bedsAfterRefit(3)).toBe(3);
    expect(bedsAfterRefit(OCCUPANCY_RANGE.max)).toBe(OCCUPANCY_RANGE.max);
    // And the notice says what happened, because a re-fit throws away every drag and
    // doing that silently would be indistinguishable from a bug.
    expect(useStore.getState().notice).toMatch(/Re-fitted for 4 students/);
  });

  it("does not take an occupancy until asked", () => {
    // setOccupancy() on its own must not rearrange anything: a slider that re-fitted
    // on input would throw away every drag the moment somebody wondered what three
    // students would look like.
    const before = useStore.getState().pieces;
    useStore.getState().setOccupancy(3);
    expect(useStore.getState().pieces).toBe(before);
    expect(useStore.getState().occupancy).toBe(3);
  });

  it("clamps the bed count to the range the panel offers", () => {
    useStore.getState().setOccupancy(99);
    expect(useStore.getState().occupancy).toBe(OCCUPANCY_RANGE.max);
    useStore.getState().setOccupancy(-4);
    expect(useStore.getState().occupancy).toBe(OCCUPANCY_RANGE.min);
  });
});

describe("cutaway", () => {
  it("accepts each of the four modes", () => {
    for (const m of CUTAWAY_MODES) {
      useStore.getState().setCutaway(m);
      expect(useStore.getState().cutaway).toBe(m);
    }
  });

  it("refuses a mode that does not exist, rather than storing it", () => {
    useStore.getState().setCutaway("roofOff");
    // @ts-expect-error -- the point is what happens when the type is bypassed, which
    // is what a stale URL or a hand-edited link amounts to.
    useStore.getState().setCutaway("wallsUp");
    expect(useStore.getState().cutaway).toBe("roofOff");
    expect(useStore.getState().notice).toMatch(/No cutaway mode/);
  });
});

describe("hydrate", () => {
  it("takes a whole snapshot and leaves the reader's own motion preference alone", () => {
    useStore.getState().setReducedMotion(true);
    const s = decode(encode({ ...DEFAULT_SNAPSHOT, stage: 5, t: 1, cutaway: "section" }))!;
    useStore.getState().hydrate(s);
    const after = useStore.getState();
    expect(after.stage).toBe(5);
    expect(after.cutaway).toBe("section");
    expect(after.pieces).toEqual(s.pieces);
    // The one field a link must not carry. url.ts refuses to encode it for the same
    // reason: it is the recipient's accessibility preference, not shared state.
    expect(after.reducedMotion).toBe(true);
  });
});

describe("resetAll", () => {
  it("puts every editable field back, including the arrangement", () => {
    useStore.getState().setParams({ ceiling: 9 });
    useStore.getState().setCutaway("section");
    useStore.getState().setHour(2);
    useStore.getState().nudge("bedA-bed-0", "v+");
    useStore.getState().resetAll();
    const s = useStore.getState();
    expect(s.params).toEqual(DEFAULT_PARAMS);
    expect(s.pieces).toBe(DEFAULT_SNAPSHOT.pieces);
    expect(s.cutaway).toBe("none");
    expect(s.selected).toBe(null);
    expect(s.notice).toMatch(/sourced dimensions/);
  });
});
