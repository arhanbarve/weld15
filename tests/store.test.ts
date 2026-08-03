import { describe, it, expect, beforeEach } from "vitest";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import { layout, pieceBox } from "@/geo/furniture";
import { containedBy } from "@/geo/collide";
import { CUTAWAY_MODES } from "@/scene/cutaway";
import { OCCUPANCY_RANGE, DEFAULT_OCCUPANCY, pieceLabel, useStore } from "@/state/store";
import { clearance, isClear, walkContext } from "@/scene/walk";
import { standIn, standingPose } from "@/scene/route";
import { DEFAULT_SNAPSHOT, decode, encode } from "@/state/url";

/**
 * The editable store: occupancy, refit, reset, cutaway, and first-person seeding.
 *
 * `params` itself is fixed at DEFAULT_PARAMS now -- there is no longer any action that
 * patches it at runtime, so the tests here that move `params` do it by writing the
 * store's state directly (`useStore.setState({ params: ... })`), the same way a
 * hand-edited URL or a future feature would arrive at a non-default suite.
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
    useStore.setState({ params: { ...DEFAULT_PARAMS, ceiling: 9 } });
    useStore.getState().setCutaway("section");
    useStore.getState().setHour(2);
    useStore.getState().setOccupancy(2);
    useStore.getState().refit();
    useStore.getState().resetAll();
    const s = useStore.getState();
    expect(s.params).toEqual(DEFAULT_PARAMS);
    expect(s.pieces).toBe(DEFAULT_SNAPSHOT.pieces);
    expect(s.cutaway).toBe("none");
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
    useStore.setState({ params: { ...DEFAULT_PARAMS, ceiling: 9 } });
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
     * THE PARAMS ARE WRITTEN DIRECTLY HERE, and that is the point of the comment rather
     * than a shortcut. walk.ts's precondition is that a seed must be clear, and params is
     * fixed at DEFAULT_PARAMS in this app now -- there is no control left that can reach
     * an unstandable hall. So the fall-through is a guard on a documented precondition
     * rather than on a reachable state, and the only way to exercise it is to write the
     * params in directly, which is what a hand-edited URL would do.
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

});

/**
 * P10: telling a cut from a move.
 *
 * `cuts` is what CameraRig will un-settle on instead of `stage`, so what matters here is
 * exactly which actions bump it and which do not -- setStage, next, prev, skipToSuite and
 * entering first person are jumps; setT, setJourney and flyStep are the continuous motion
 * the counter has to stay silent for, or the fly-down would pop at every stage it crosses.
 *
 * LEAVING first person was the sixth cut and is not one any more: P10's walk-in work made
 * standing a property of being at stage 5 rather than a mode with an exit, so
 * `leaveFirstPerson()` is gone from the store and the only way the walker goes away is a
 * stage change -- which is already one of the five above.
 */
describe("cuts", () => {
  it("bumps by exactly one for each of the five cut actions", () => {
    const before = useStore.getState().cuts;
    useStore.getState().setStage(2);
    expect(useStore.getState().cuts).toBe(before + 1);

    useStore.getState().next();
    expect(useStore.getState().cuts).toBe(before + 2);

    useStore.getState().prev();
    expect(useStore.getState().cuts).toBe(before + 3);

    useStore.getState().skipToSuite();
    expect(useStore.getState().cuts).toBe(before + 4);

    useStore.getState().enterFirstPerson();
    expect(useStore.getState().firstPerson, "the suite stands somebody up").not.toBeNull();
    expect(useStore.getState().cuts).toBe(before + 5);
  });

  it("does not move for setT, setJourney or flyStep, the continuous ones", () => {
    const before = useStore.getState().cuts;
    useStore.getState().setT(0.4);
    useStore.getState().setJourney(2, 0.6);
    useStore.getState().flyStep();
    expect(useStore.getState().cuts).toBe(before);
  });

  it("resets to zero and false on resetAll, and hydrate leaves both alone", () => {
    useStore.getState().setStage(3);
    expect(useStore.getState().cuts).toBeGreaterThan(0);
    useStore.getState().setScrubbing(true);
    useStore.getState().resetAll();
    expect(useStore.getState().cuts).toBe(0);
    expect(useStore.getState().scrubbing).toBe(false);

    useStore.getState().setStage(1);
    useStore.getState().setScrubbing(true);
    const beforeCuts = useStore.getState().cuts;
    const s = decode(encode({ ...DEFAULT_SNAPSHOT, stage: 4 }))!;
    useStore.getState().hydrate(s);
    expect(useStore.getState().stage, "the snapshot did arrive").toBe(4);
    expect(useStore.getState().cuts, "hydrate is not a cut").toBe(beforeCuts);
    expect(useStore.getState().scrubbing, "hydrate does not touch session facts").toBe(true);
  });
});

describe("setJourney", () => {
  it("sets stage and t together, and leaves cuts unchanged", () => {
    const beforeCuts = useStore.getState().cuts;
    useStore.getState().setJourney(4, 0.5);
    const after = useStore.getState();
    expect(after.stage).toBe(4);
    expect(after.t).toBe(0.5);
    expect(after.cuts).toBe(beforeCuts);
  });

  it("clamps t to [0, 1]", () => {
    useStore.getState().setJourney(2, -0.5);
    expect(useStore.getState().t).toBe(0);
    useStore.getState().setJourney(2, 1.5);
    expect(useStore.getState().t).toBe(1);
  });

  it("clears the walker, for the reason setStage does: the walker owns a different camera", () => {
    useStore.getState().enterFirstPerson();
    expect(useStore.getState().firstPerson).not.toBeNull();
    useStore.getState().setJourney(2, 0.3);
    expect(useStore.getState().firstPerson).toBeNull();
  });
});

describe("setScrubbing", () => {
  it("writes the flag both ways", () => {
    useStore.getState().setScrubbing(true);
    expect(useStore.getState().scrubbing).toBe(true);
    useStore.getState().setScrubbing(false);
    expect(useStore.getState().scrubbing).toBe(false);
  });
});

/**
 * `orbit` stops surviving a change of anchor.
 *
 * Stage 3's orbit is about kf[3].target = [0, 42, 0]; stage 4's is about
 * MASSING_CENTER (orbit.ts's stage4OrbitKeyframe). The same three numbers
 * read at the other stage is not a stale pose, it is the WRONG one -- a
 * valid-looking camera position about a pivot the viewer never chose one
 * relative to. `orbitStage` is what lets a stage change tell that apart from
 * "returning to the stage this orbit already belongs to", which must still
 * work exactly as it always has.
 */
describe("orbit survives only a return to its own anchor stage", () => {
  const SOME_ORBIT = { headingDeg: 12, pitchDeg: 40, rangeFt: 200 };

  it("keeps the orbit and its stage across a round trip through a non-anchor stage", () => {
    useStore.getState().setStage(3);
    useStore.getState().setOrbit(SOME_ORBIT);
    expect(useStore.getState().orbitStage).toBe(3);

    useStore.getState().setStage(2);
    expect(useStore.getState().orbit).toEqual(SOME_ORBIT);
    expect(useStore.getState().orbitStage).toBe(3);

    useStore.getState().setStage(3);
    expect(useStore.getState().orbit).toEqual(SOME_ORBIT);
    expect(useStore.getState().orbitStage).toBe(3);
  });

  it("clears a stage-3 orbit on a direct move to stage 4", () => {
    useStore.getState().setStage(3);
    useStore.getState().setOrbit(SOME_ORBIT);
    useStore.getState().setStage(4);
    expect(useStore.getState().orbit).toBeNull();
    expect(useStore.getState().orbitStage).toBeNull();
  });

  it("clears a stage-4 orbit on a direct move to stage 3", () => {
    useStore.getState().setStage(4);
    useStore.getState().setOrbit(SOME_ORBIT);
    useStore.getState().setStage(3);
    expect(useStore.getState().orbit).toBeNull();
  });

  it("clears a stale orbit even on a jump that skips the anchor stage entirely", () => {
    // The gap a simpler "only clear on a direct 3<->4 move" rule would leave: set at
    // stage 3, wander to stage 2 (orbit persists, unread), then jump straight to stage
    // 4 without passing through 3 again. The orbit is still stage 3's and must not
    // apply at stage 4 just because nothing happened to touch it in between.
    useStore.getState().setStage(3);
    useStore.getState().setOrbit(SOME_ORBIT);
    useStore.getState().setStage(2);
    expect(useStore.getState().orbit).toEqual(SOME_ORBIT); // still there, still stage 3's
    useStore.getState().setStage(4);
    expect(useStore.getState().orbit).toBeNull();
  });

  it("clears via next()/prev() the same way as setStage()", () => {
    useStore.getState().setStage(3);
    useStore.getState().setOrbit(SOME_ORBIT);
    useStore.getState().next(); // 3 -> 4
    expect(useStore.getState().orbit).toBeNull();

    useStore.getState().setStage(4);
    useStore.getState().setOrbit(SOME_ORBIT);
    useStore.getState().prev(); // 4 -> 3
    expect(useStore.getState().orbit).toBeNull();
  });

  it("clears via setJourney() too, since the master scrubber can cross 3 <-> 4", () => {
    useStore.getState().setStage(3);
    useStore.getState().setOrbit(SOME_ORBIT);
    useStore.getState().setJourney(4, 0);
    expect(useStore.getState().orbit).toBeNull();
  });

  it("leaves the orbit alone when the stage does not actually change", () => {
    useStore.getState().setStage(3);
    useStore.getState().setOrbit(SOME_ORBIT);
    useStore.getState().setStage(3);
    expect(useStore.getState().orbit).toEqual(SOME_ORBIT);
  });

  it("resetAll clears all three fields", () => {
    useStore.getState().setStage(3);
    useStore.getState().setOrbit(SOME_ORBIT);
    useStore.getState().resetAll();
    expect(useStore.getState().orbit).toBeNull();
    expect(useStore.getState().orbitStage).toBeNull();
    expect(useStore.getState().orbitSeedT).toBeNull();
  });

  it("hydrate derives orbitStage from the incoming stage, not the wire format", () => {
    useStore.getState().hydrate({
      stage: 4,
      t: 0.5,
      params: DEFAULT_SNAPSHOT.params,
      pieces: DEFAULT_SNAPSHOT.pieces,
      cutaway: "none",
      hour: 9,
      date: "2026-07-31",
      orbit: SOME_ORBIT,
      occupancy: 4,
    });
    expect(useStore.getState().orbitStage).toBe(4);
  });

  /**
   * orbitSeedT: the stage-local t pose.ts's decay measures a resumed wheel forward from
   * (see pose.ts's own header on the fix this field exists for).
   */
  it("setOrbit seeds orbitSeedT from the current t, and clears it with the orbit", () => {
    useStore.getState().setStage(1);
    useStore.getState().setT(0.4);
    useStore.getState().setOrbit(SOME_ORBIT);
    expect(useStore.getState().orbitSeedT).toBe(0.4);

    useStore.getState().setOrbit(null);
    expect(useStore.getState().orbitSeedT).toBeNull();
  });

  it("re-seeds orbitSeedT on every fresh drag, not just the first", () => {
    useStore.getState().setStage(1);
    useStore.getState().setT(0.1);
    useStore.getState().setOrbit(SOME_ORBIT);
    expect(useStore.getState().orbitSeedT).toBe(0.1);

    // t moves on (the wheel), then a second drag re-seeds from where it now is.
    useStore.getState().setT(0.6);
    useStore.getState().setOrbit({ ...SOME_ORBIT, headingDeg: 99 });
    expect(useStore.getState().orbitSeedT).toBe(0.6);
  });

  it("clearing the orbit on a stage mismatch clears orbitSeedT with it", () => {
    useStore.getState().setStage(3);
    useStore.getState().setOrbit(SOME_ORBIT);
    useStore.getState().setStage(4);
    expect(useStore.getState().orbitSeedT).toBeNull();
  });

  it("hydrate seeds orbitSeedT from the incoming t, the same way orbitStage comes from the incoming stage", () => {
    useStore.getState().hydrate({
      stage: 4,
      t: 0.5,
      params: DEFAULT_SNAPSHOT.params,
      pieces: DEFAULT_SNAPSHOT.pieces,
      cutaway: "none",
      hour: 9,
      date: "2026-07-31",
      orbit: SOME_ORBIT,
      occupancy: 4,
    });
    expect(useStore.getState().orbitSeedT).toBe(0.5);

    useStore.getState().hydrate({
      stage: 2,
      t: 0.3,
      params: DEFAULT_SNAPSHOT.params,
      pieces: DEFAULT_SNAPSHOT.pieces,
      cutaway: "none",
      hour: 9,
      date: "2026-07-31",
      orbit: null,
      occupancy: 4,
    });
    expect(useStore.getState().orbitSeedT).toBeNull();
  });
});

// globeSpin -- P10 step 7's globe-drag state -- and its store field are removed as
// part of P11 (docs/phases/P11-PHOTOREAL.md section 2.4: `globeSpin` and `spinPose()`
// are deleted, the false-altitude bug in section 0.1). The describe block that lived
// here asserted setGlobeSpin()/resetAll()/hydrate() against a field the store no
// longer has.
