import { describe, it, expect, beforeEach } from "vitest";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import { doorLandings, layout, pieceBox } from "@/geo/furniture";
import { containedBy } from "@/geo/collide";
import { tryMove } from "@/geo/drag";
import { buildWalls } from "@/geo/walls";
import { CUTAWAY_MODES } from "@/scene/cutaway";
import { OCCUPANCY_RANGE, DEFAULT_OCCUPANCY, pieceLabel, useStore } from "@/state/store";
import { clearance, isClear, walkContext } from "@/scene/walk";
import { standIn, standingPose } from "@/scene/route";
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
    // High contrast opens OFF, and this assertion is about the default rather than about
    // the feature: Hud.tsx seeds the flag from `prefers-contrast: more`, and a store that
    // shipped `true` would put every viewer in high contrast on a machine with no such
    // preference and no media query would ever say otherwise.
    expect(s.highContrast).toBe(false);
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

/**
 * The high-contrast flag, and the one thing about it that is a decision rather than a
 * setter.
 *
 * MASTER.md §Accessibility gates asks for the toggle and states its effect -- strokes to
 * 2.5 px, `--mass` opacity to 0.22 -- and Campus.tsx honours those two numbers;
 * tests/e2e/contrast.spec.ts is where they are measured, because they are a line width and
 * a fill opacity inside a WebGL frame. What is testable HERE is the field's standing: it is
 * the reader's own accessibility preference, on the same footing as `reducedMotion`, so
 * neither a shared link nor a reset button may touch it. Both of those are one line of
 * plausible tidiness away from being wrong, which is why they are gated rather than
 * commented.
 */
describe("high contrast", () => {
  it("has exactly one writer, and it writes both ways", () => {
    useStore.setState({ highContrast: false });
    useStore.getState().setHighContrast(true);
    expect(useStore.getState().highContrast).toBe(true);
    useStore.getState().setHighContrast(false);
    expect(useStore.getState().highContrast).toBe(false);
  });

  it("survives resetAll, because a reset is about the model and not about the reader", () => {
    useStore.getState().setHighContrast(true);
    useStore.getState().setParams({ ceiling: 9 });
    useStore.getState().resetAll();
    // The model went back; the preference did not. A "start over" that switched somebody's
    // high contrast off would be the app overruling them.
    expect(useStore.getState().params).toEqual(DEFAULT_PARAMS);
    expect(useStore.getState().highContrast).toBe(true);
    useStore.getState().setHighContrast(false);
  });

  it("survives hydrate, for the reason reducedMotion does: a link carries the model", () => {
    useStore.getState().setHighContrast(true);
    const s = decode(encode({ ...DEFAULT_SNAPSHOT, stage: 3, cutaway: "roofOff" }))!;
    useStore.getState().hydrate(s);
    expect(useStore.getState().stage, "the snapshot did not arrive").toBe(3);
    // url.ts refuses to encode either preference, so a recipient's own setting is what
    // decides how the model they were sent is drawn.
    expect(useStore.getState().highContrast).toBe(true);
    useStore.getState().setHighContrast(false);
  });
});

/**
 * P7: standing up in the suite.
 *
 * The store is where first person BEGINS and ENDS, and both are conditional on geometry
 * rather than on a flag. walk.ts has no spawn() and step()'s guarantee is conditional on
 * starting from a clear position -- from a wedged one it returns where it started, every
 * frame, forever -- so a seed has to be verified before the first frame, and a slider
 * that closes a wall onto somebody has to say so rather than leave them stuck. Those two
 * are what these gates are about; the walking itself is tests/walk.test.ts's and
 * tests/e2e/walk.spec.ts's.
 */
describe("first person", () => {
  const suite = buildSuite();
  const hall = suite.rooms.find((r) => r.id === "hall")!;
  const ctx = walkContext(suite);

  it("stands the viewer in the hall, clear of every wall band, on the shot's own gaze", () => {
    useStore.getState().enterFirstPerson();
    const fp = useStore.getState().firstPerson;
    expect(fp, "first person is on").not.toBeNull();
    // The hall and not a bedroom: places() returns the hub first because the hall is what
    // every room in this suite is entered from, and route.ts and rooms.ts both seed there.
    expect(fp!.room).toBe("hall");
    expect(fp!.p).toEqual(standIn(hall));
    // The invariant every later frame depends on. MEASURED at the shipped params: 1.5 ft
    // of clearance, i.e. a 0.75 ft disc standing 2.25 ft from each side of a 4.5 ft hall.
    expect(isClear(fp!.p, ctx), "the seed is clear").toBe(true);
    expect(clearance(fp!.p, ctx)).toBeCloseTo(1.5, 9);
    // heading and pitch come from standingPose(), the same arithmetic stages.ts's kf[5] is
    // built from -- NOT Math.PI, which is what the seed used to hard-code and which is the
    // 8-degree-up, 4.5-degree-yaw snap this phase exists to remove. Arrival is now
    // continuous with the fly-down's last frame instead.
    const pose = standingPose(suite);
    expect(fp!.heading).toBeCloseTo(pose.heading, 9);
    expect(fp!.pitch).toBeCloseTo(pose.pitch, 9);
    // No notice on a successful seed (D7): the keys are in the HUD row, and a toast on
    // every arrival at stage 5 would be noise rather than news.
    expect(useStore.getState().notice).toBe(null);
  });

  it("gives the arrow keys' owner nothing to fight over", () => {
    // Hud.tsx hands the arrow keys to the walker while first person is on, so a piece left
    // selected would be a piece whose keyboard controls had silently stopped working.
    useStore.getState().select("bedB-bed-0");
    useStore.getState().enterFirstPerson();
    expect(useStore.getState().selected).toBe(null);
  });

  it("seeds on arrival at stage 5, by every path, and drops on departure", () => {
    const standingSomewhere = () => {
      const fp = useStore.getState().firstPerson;
      expect(fp, "a walker is present at stage 5").not.toBeNull();
      expect(isClear(fp!.p, walkContext(buildSuite(useStore.getState().params)))).toBe(true);
      return fp!;
    };

    // setStage, directly.
    useStore.getState().setStage(5);
    standingSomewhere();

    // next(), stepping onto 5 from 4.
    useStore.getState().setStage(4);
    useStore.getState().next();
    expect(useStore.getState().stage).toBe(5);
    standingSomewhere();

    // skipToSuite().
    useStore.getState().setStage(0);
    useStore.getState().skipToSuite();
    standingSomewhere();

    // flyStep() cannot reach 5 by itself -- it stops at FLY_DOWN_END -- so this checks
    // both halves: no walker at the stop it does reach, one on arrival at 5 by another path.
    useStore.getState().setStage(0);
    useStore.getState().flyStep();
    useStore.getState().flyStep();
    useStore.getState().flyStep();
    expect(useStore.getState().stage).toBe(3);
    expect(useStore.getState().firstPerson).toBe(null);
    useStore.getState().setStage(5);
    standingSomewhere();

    // hydrate(), a link opening at stage 5.
    const snap = decode(encode({ ...DEFAULT_SNAPSHOT, stage: 5 }))!;
    useStore.getState().hydrate(snap);
    expect(useStore.getState().stage).toBe(5);
    standingSomewhere();

    // resetAll(), seeded with the params it is resetting TO, at stage 5.
    useStore.getState().resetAll();
    expect(useStore.getState().stage).toBe(5);
    standingSomewhere();

    // Off stage 5, by setStage and by prev(), the walker is gone again.
    useStore.getState().setStage(2);
    expect(useStore.getState().firstPerson).toBe(null);
    useStore.getState().setStage(5);
    standingSomewhere();
    useStore.getState().prev();
    expect(useStore.getState().firstPerson).toBe(null);
  });

  it("skips a hall nobody can stand in, and refuses when no room will do", () => {
    /*
     * THE PARAMS ARE FORCED PAST setParams() HERE, and that is the point of the comment
     * rather than a shortcut. walk.ts's precondition is that a seed must be clear, and no
     * suite the sliders can reach has an unstandable hall: the hall's width bottoms out at
     * Panel.tsx's 3 ft, which leaves 0.75 ft of clearance, and its length is tied to the
     * bedroom chain -- every commonAlong from 30 to 43 ft was swept and all twelve were
     * refused with "Bedroom B would have no floor left" before the hall got short. So the
     * fall-through is a guard on a documented precondition rather than on a reachable
     * state, and the only way to exercise it is to write the params in directly, which is
     * what a hand-edited URL or a future slider range would do.
     *
     * MEASURED at hallWidth 1: the hall's centre has -0.25 ft of clearance and bedroom A's
     * has 4.25, so the seed falls through to bedroom A rather than wedging in the hall.
     */
    useStore.setState({ params: { ...DEFAULT_PARAMS, hallWidth: 1 } });
    useStore.getState().enterFirstPerson();
    const fp = useStore.getState().firstPerson;
    expect(fp, "some room is standable, so first person is on").not.toBeNull();
    expect(fp!.room).not.toBe("hall");
    expect(isClear(fp!.p, walkContext(buildSuite(useStore.getState().params)))).toBe(true);

    // And when nothing is standable it refuses in words rather than seeding somewhere
    // wedged, where step() would return the same position every frame forever.
    useStore.setState({
      params: {
        ...DEFAULT_PARAMS,
        hallWidth: 1,
        bedDepth: 1,
        bedAAlong: 1,
        bedBAlong: 1,
        bathAlong: 1,
        bathDeep: 1,
        commonAlong: 1,
        commonDeep: 1,
        kAlong: 1,
        kDeep: 1,
        legDepth: 2,
        sectionLength: 3,
      },
      firstPerson: null,
    });
    useStore.getState().enterFirstPerson();
    expect(useStore.getState().firstPerson).toBe(null);
    expect(useStore.getState().notice).toMatch(/^Refused: Every room in this suite is narrower/);
  });

  it("re-seeds the walker when a slider closes a wall onto it, and says where", () => {
    /*
     * The viewer is furniture too, for this one purpose, and re-seeding rather than
     * dropping is the same choice setParams() makes about a bed: refusing the slider would
     * mean a dimension the audit tags INFERRED could not be corrected while somebody
     * happened to be standing in the way. walkerFor() is the same verified-seed loop
     * enterFirstPerson() uses, so the viewer lands somewhere standable rather than losing
     * the walker outright, as long as some room still is.
     *
     * MEASURED: standing at the centre of bedroom B, (8, 39), a section shortened from
     * 44 ft to 38 ft brings the gable south past that point, and the hall is still
     * standable in the resulting suite. setWalk() places the walker directly, the way
     * goToPlace() used to before it was deleted -- there is no other action left that
     * jump-cuts a walker to a named room.
     */
    useStore.getState().setWalk({ p: { u: 8, v: 39 }, heading: 0, pitch: 0, room: "bedB" });
    useStore.getState().setParams({ sectionLength: 38 });
    expect(useStore.getState().params.sectionLength, "the slider was not refused").toBe(38);
    const fp = useStore.getState().firstPerson;
    expect(fp, "moved rather than dropped -- another room is still standable").not.toBeNull();
    expect(fp!.room).toBe("hall");
    expect(isClear(fp!.p, walkContext(buildSuite(useStore.getState().params)))).toBe(true);
    expect(useStore.getState().notice).toMatch(
      /A wall closed onto where you were standing, so you were moved to Hall\./,
    );
  });

  it("leaves a walker alone when the slider does not reach it", () => {
    // The guard against fixing the wedge by moving the walker on every slider move, which
    // would make the dimensions unusable from inside the room.
    useStore.getState().setWalk({ p: { u: 8, v: 39 }, heading: 0, pitch: 0, room: "bedB" });
    const before = useStore.getState().firstPerson;
    useStore.getState().setParams({ ceiling: 9 });
    expect(useStore.getState().firstPerson).toBe(before);
    expect(useStore.getState().notice).toBe(null);
  });
});
