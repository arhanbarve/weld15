import { test, expect, type Page } from "@playwright/test";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import { buildWalls, suiteFootprint } from "@/geo/walls";
import { containedBy, pointInPolygon } from "@/geo/collide";
import { canPass, clearance, walkContext, RADIUS, PITCH_LIMIT } from "@/scene/walk";
import { fromThree, siteToBuilding } from "@/geo/frames";
import { floorLevel, CLEAR_HALF_U, GABLE_INNER_V } from "@/geo/place";
import { thresholds } from "@/scene/route";
import weld from "@/data/weld.json";

/**
 * 120 s, for edit.spec.ts's reason and one more of its own. Every gate here holds a key
 * down for real seconds of wall-clock time against a SwiftShader renderer at a 62 to 85 ms
 * median frame -- a walk across the 28.5 ft hall at 4 ft/s is seven seconds during which
 * nothing can be hurried, because the thing under test is what happens on each of those
 * frames.
 */
test.setTimeout(120_000);

/**
 * P7's gates: somebody can stand in Weld 15 and walk it, and cannot walk through a wall.
 *
 * WHY THE ASSERTIONS ARE MADE IN NODE AGAINST THE PROBE'S NUMBERS
 * The walker leaves no element behind, so the observable surface is a probe -- window.__walk,
 * published by FirstPerson.tsx, in the SUITE's own frame in feet. edit.spec.ts's header
 * names the weakness in that: a probe can agree with a broken renderer. It is answered
 * here the way it is answered there, by not
 * asking the app for the verdict. The probe supplies raw coordinates; the containment and
 * clearance checks are recomputed in this file from src/geo/walls.ts, src/geo/collide.ts and
 * src/scene/walk.ts, so a walker that reported a clearance of +5 while standing in a
 * partition would fail. This is the first spec in the suite to import the geometry modules,
 * and it can because they are three-free and pure -- which is the property walk.ts's header
 * exists to protect.
 *
 * WHAT IT DELIBERATELY DOES NOT RE-TEST. tests/walk.test.ts owns the maths: the tunnelling
 * guard at absurd step sizes, the corner cases of resolve(), the randomised sweeps. What is
 * here is the claim those cannot make -- that the maths is wired to the keys, the keys to
 * the camera, and the camera to a frame that is still inside the building.
 */

const P = DEFAULT_PARAMS;
const SUITE = buildSuite(P);
const CTX = walkContext(SUITE);
const FOOTPRINT = suiteFootprint(SUITE);
const RING = weld.rings[0] as number[][];

type Walk = {
  active: boolean;
  u: number;
  v: number;
  heading: number;
  /** radians, negative is down -- the current look angle. */
  pitch: number;
  room: string | null;
  clearance: number;
  locked: boolean;
  turnSign: number;
  keys: string[];
  frames: number;
};

type Cam = {
  stage: number;
  position: [number, number, number];
  target: [number, number, number];
  firstPerson: boolean;
  path: [number, number, number][];
};

type Weld = { stage: number; notice: string | null; reducedMotion: boolean };

const walkOf = (page: Page) => page.evaluate(() => (window as unknown as { __walk: Walk }).__walk);
const camOf = (page: Page) => page.evaluate(() => (window as unknown as { __cam: Cam }).__cam);
const weldOf = (page: Page) => page.evaluate(() => (window as unknown as { __weld: Weld }).__weld);
const perfOf = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          __perf: { calls: number; triangles: number; shadows: boolean; casters: number };
        }
      ).__perf,
  );

/**
 * Everything one sample of the walk has to satisfy, checked in node.
 *
 * THREE INDEPENDENT CLAIMS, none of them the app's own opinion.
 *
 * inside the footprint    Against suiteFootprint(), which is the gross L the rooms and the
 *                         wall bands tile. A point in it and clear of every band is exactly
 *                         "on the suite's floor or in one of its doorways" -- walk.ts's
 *                         insideSuite() makes the same argument, and this recomputes it
 *                         rather than importing the app's answer.
 * inside Weld            collide.ts's pointInPolygon() against the ring in weld.json, i.e.
 *                         Harvard's own GIS footprint. tests/stages.test.ts pins the stage-5
 *                         keyframe the same way, and it is the check that would catch a
 *                         suite-to-world conversion that had drifted: a walker can be inside
 *                         a suite rectangle and, if the placement is wrong, in the car park.
 * clear of every band    clearance() recomputed from a WalkCtx built here. Negative means the
 *                         walker's disc overlaps a wall.
 */
function violation(s: Walk): string | null {
  const inFootprint = FOOTPRINT.some(
    (r) => s.u >= r.u - 1e-9 && s.u <= r.u + r.du + 1e-9 && s.v >= r.v - 1e-9 && s.v <= r.v + r.dv + 1e-9,
  );
  if (!inFootprint) return `(${s.u.toFixed(3)}, ${s.v.toFixed(3)}) is outside the suite footprint`;
  const c = clearance({ u: s.u, v: s.v }, CTX);
  if (!(c > -1e-6)) {
    return `(${s.u.toFixed(3)}, ${s.v.toFixed(3)}) is ${(-c).toFixed(3)} ft inside a wall band`;
  }
  // The probe's own clearance has to agree with the one recomputed here, or one of the two
  // is measuring a different suite -- which is the failure a probe-only gate cannot see.
  if (Math.abs(c - s.clearance) > 1e-6) {
    return `the probe says clearance ${s.clearance.toFixed(4)}, this suite says ${c.toFixed(4)}`;
  }
  return null;
}

/** The camera, back in site feet, for the ring test. */
async function cameraInWeld(page: Page): Promise<boolean> {
  const c = await camOf(page);
  const p = fromThree(c.position);
  return pointInPolygon([p.x, p.y], RING);
}

/**
 * Open in the room, at stage 5, with the walk controls mounted.
 *
 * The stage button and not the skip link, for the reason edit.spec.ts records: `.skip` sits
 * at translateY(-200%) until focused, so Playwright reports it outside the viewport and
 * refuses to click it.
 */
async function openInTheRoom(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?preload=0");
  await page.locator("canvas").waitFor();
  await page.getByTestId("stage-5").click();
  await page.waitForTimeout(1400); // the camera settles; journey.spec.ts's own wait
  await expect.poll(async () => (await weldOf(page)).stage, { timeout: 20_000 }).toBe(5);
  await expect(page.getByTestId("fp-controls")).toBeVisible();
  return errors;
}

/**
 * Wait until the walker seeded on arrival is actually being advanced -- no click of any
 * kind. store.ts seeds a walker the instant stage 5 is reached (P10 step 3), so this poll
 * IS the gate for "you arrive standing": if it passes, nobody pressed anything.
 */
async function awaitWalker(page: Page) {
  await expect.poll(async () => (await walkOf(page)).active, { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => (await walkOf(page)).frames, { timeout: 20_000 }).toBeGreaterThan(2);
}

/**
 * Hold keys until something is true, sampling the walker as it goes and checking every
 * sample.
 *
 * SAMPLED FROM NODE, which is the opposite of the choice a11y.spec.ts makes for its
 * throttle sweep and for the opposite reason: there the gaps between round trips would have
 * decided the answer, and here each round trip is a few milliseconds against frames that
 * are 62 to 85 ms long, so a sample per round trip is a sample every frame or two. What
 * must not be missed is a single frame inside a wall.
 *
 * HELD UNTIL A CONDITION, NOT FOR A DURATION, and that is a correction rather than a
 * refinement. The first version of these gates held each key for a fixed number of
 * milliseconds and asserted how far the walker had got, which made every one of them a
 * measurement of the frame rate: two of six failed the moment the run went to six workers
 * against one dev server, having covered 4 ft where they covered 20 alone. What the gates
 * are about is the invariant on each frame and the outcome at the end, neither of which is
 * a statement about time, so the keys are now held until the outcome arrives or a generous
 * deadline expires -- and the deadline failing is reported as itself.
 */
async function holdUntil(
  page: Page,
  keys: string[],
  want: (s: Walk) => boolean,
  what: string,
  maxMs = 20_000,
): Promise<Walk[]> {
  for (const k of keys) await page.keyboard.down(k);
  const seen: Walk[] = [];
  const until = Date.now() + maxMs;
  let got = false;
  try {
    while (Date.now() < until) {
      const s = await walkOf(page);
      seen.push(s);
      expect(violation(s), `while holding ${keys.join("+")} (${what})`).toBeNull();
      if (want(s)) {
        got = true;
        break;
      }
    }
  } finally {
    for (const k of keys) await page.keyboard.up(k);
  }
  // One more after the release: the last frame of a held key lands after the loop.
  const last = await walkOf(page);
  seen.push(last);
  expect(violation(last), `after releasing ${keys.join("+")} (${what})`).toBeNull();
  return got || want(last) ? seen : [...seen, { ...last, room: "TIMED-OUT" }];
}

/** Whether holdUntil() reached its condition. Its sentinel, read back. */
const reached = (seen: Walk[]) => seen[seen.length - 1]!.room !== "TIMED-OUT";

/** The last real sample, ignoring the timeout sentinel. */
const endOf = (seen: Walk[]) => seen.filter((s) => s.room !== "TIMED-OUT").slice(-1)[0]!;

/** How far apart two samples are, ft. */
const apart = (a: Walk, b: Walk) => Math.hypot(b.u - a.u, b.v - a.v);

/** Smallest angle between two bearings, radians. */
function turned(a: number, b: number): number {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

/** Pitch recomputed from the camera's own position and target, radians, negative down. */
function camPitch(c: Cam): number {
  const [px, py, pz] = c.position;
  const [tx, ty, tz] = c.target;
  const horiz = Math.hypot(tx - px, tz - pz);
  return Math.atan2(ty - py, horiz);
}

/**
 * A three.js world point back to the suite's own frame, in feet -- plain vector math, no
 * three.js. fromThree() undoes toThree()'s y-up swap and siteToBuilding() undoes the axis
 * rotation; the last step undoes suiteToBuilding()'s own facade reflection and section
 * offset, which is place.ts's only inverse this file needs.
 */
function threeToSuite(v: [number, number, number]): { u: number; v: number } {
  const site = fromThree(v);
  const b = siteToBuilding({ x: site.x, y: site.y });
  const east = P.facade === "east";
  return {
    u: east ? CLEAR_HALF_U - b.u : b.u + CLEAR_HALF_U,
    v: b.v - GABLE_INNER_V + P.sectionLength,
  };
}

/** Smallest signed difference a - b, radians, in (-pi, pi]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Turn on the keys until the walker faces `target`, in the suite frame.
 *
 * WHICH KEY TURNS WHICH WAY is not assumed: screenTurnSign() flips A and D between the
 * two facades. It is not found by trial either -- an earlier version of this held `d` for
 * a real 150 ms and kept whichever key had shrunk the gap to `target`, which breaks on a
 * target close to directly behind the walker: that gap sits right at the heading's own
 * (-pi, pi] wrap seam, and a burst long enough to cross the seam turns the walker the
 * RIGHT amount and comes out the wrong side of it, where the before/after comparison
 * reads as if the turn had gone the wrong way. Measured: a walker facing -3.06 rad held
 * `d` for its probe, the true turn was -0.33 rad, and wrapping put the result at +2.89 --
 * closer to the seam's far side than to `target`, so the probe wrongly concluded `d` was
 * wrong and held `a` for the rest of the turn, walking the suite the length of the hall
 * and out through the doorway at the OTHER end. `turnSign` is read straight off the
 * walker's own probe instead: it says whether `d` adds to the heading or subtracts from
 * it, which is exactly what deciding a direction needs and what no amount of turning can
 * get wrong by wrapping around.
 */
async function turnToward(page: Page, target: { u: number; v: number }, tol = 0.03) {
  const from = await walkOf(page);
  const desired = Math.atan2(target.u - from.u, target.v - from.v);
  const diff0 = angleDiff(desired, from.heading);
  const key = diff0 > 0 === (from.turnSign === 1) ? "d" : "a";
  await page.keyboard.down(key);
  const until = Date.now() + 15_000;
  let prevAbs = Math.abs(diff0);
  while (Date.now() < until) {
    const s = await walkOf(page);
    const abs = Math.abs(angleDiff(desired, s.heading));
    // TURN_RATE moves the heading 7 to 10+ degrees per rendered frame under SwiftShader --
    // several times tol's width -- so waiting to land INSIDE the window can skip clean
    // over it every single frame and only come near it again a full rotation later.
    // Stopping the instant the gap stops shrinking catches the turn at its closest frame
    // instead of gambling on an exact landing.
    if (abs <= tol || abs > prevAbs) break;
    prevAbs = abs;
  }
  await page.keyboard.up(key);
}

/** Whether a sample has arrived within half a foot of a plan point. */
const near = (s: Walk, t: { u: number; v: number }) => Math.hypot(t.u - s.u, t.v - s.v) < 0.5;

/**
 * Walk to within half a foot of `target`, steering the whole way there rather than
 * turning once and trusting the aim to hold over the distance.
 *
 * turnToward's own closest approach is bounded by a single rendered frame's worth of
 * turn -- 7 to 10+ degrees under SwiftShader -- and a few degrees of residual aim over a
 * room-scale walk is a lateral miss well past near()'s half a foot: measured, a 0.15 rad
 * (8.8 deg) residual over a 9.3 ft approach missed by 1.4 ft, which is what left this walk
 * spending its whole budget short of the doorway rather than reaching it. `w` stays held
 * for the whole approach -- forward and turn are independent axes, so both can be asked
 * for at once -- and a turn key corrects course whenever the bearing to `target` has
 * drifted, held for exactly one PROCESSED FRAME rather than a guessed duration: a duration
 * held across a real wait is this suite's own known failure mode under worker contention
 * (see holdUntil's docblock above), where a tap can be delivered, or released, far later
 * than asked and overshoot by exactly as much. Watching `frames` advance is proof the tap
 * actually reached the app, on whatever frame it lands on.
 */
async function walkToward(page: Page, target: { u: number; v: number }, tol = 0.5, maxMs = 30_000) {
  await turnToward(page, target, 0.15);
  const until = Date.now() + maxMs;
  await page.keyboard.down("w");
  try {
    while (Date.now() < until) {
      const s = await walkOf(page);
      if (near(s, target)) return;
      const desired = Math.atan2(target.u - s.u, target.v - s.v);
      const diff = angleDiff(desired, s.heading);
      if (Math.abs(diff) <= 0.05) continue;
      const key = diff > 0 === (s.turnSign === 1) ? "d" : "a";
      const before = s.frames;
      await page.keyboard.down(key);
      const stepUntil = Date.now() + 2_000;
      let cur = s;
      while (Date.now() < stepUntil && cur.frames <= before) cur = await walkOf(page);
      await page.keyboard.up(key);
    }
  } finally {
    await page.keyboard.up("w");
  }
}

test.describe("P7 -- somebody can stand in Weld 15 and walk it", () => {
  test("walks the hall end to end without leaving the suite", async ({ page }) => {
    const errors = await openInTheRoom(page);
    await awaitWalker(page);

    const hall = SUITE.rooms.find((r) => r.id === "hall")!;
    const start = await walkOf(page);
    /*
     * END TO END, which for the hall is v = 15.5 to v = 44 at the shipped params. The walker
     * arrives facing south (store.ts's arrivalHeading picks the room's long axis toward its
     * low end), so W walks the length of it, and the stop condition is the far wall rather
     * than a stopwatch: a walker whose centre is within 1.25 ft of the hall's south face has
     * its 0.75 ft disc leaning on the band there.
     */
    const stop = 1.25;
    const south = await holdUntil(
      page,
      ["w"],
      (s) => s.v < hall.v + stop,
      "walk south to the end of the hall",
    );
    const far = endOf(south);
    expect(reached(south), `stopped at v = ${far.v.toFixed(2)}, wanted under ${hall.v + stop}`).toBe(
      true,
    );
    expect(apart(start, far), "the walker did not move").toBeGreaterThan(8);
    // Still in the hall the whole way: it is 4.5 ft wide, so a walker that drifted in u
    // would have hit a side wall long before the far end.
    expect(far.room).toBe("hall");
    expect(far.v, "did not pass through the hall's own south wall").toBeGreaterThan(hall.v);

    // Turn round: hold the turn key until the bearing is within 20 degrees of north, which
    // is 0 in walk.ts's frame.
    const round = await holdUntil(page, ["a"], (s) => turned(s.heading, 0) < 0.35, "turn round");
    expect(reached(round), `turned to ${((endOf(round).heading * 180) / Math.PI).toFixed(0)} deg`).toBe(
      true,
    );
    const north = await holdUntil(
      page,
      ["w"],
      (s) => s.v > hall.v + hall.dv - stop,
      "walk back north to the other end",
    );
    const back = endOf(north);
    expect(reached(north), `stopped at v = ${back.v.toFixed(2)}`).toBe(true);
    expect(back.v, "walked back north").toBeGreaterThan(far.v + 8);
    expect(back.v, "did not pass through the hall's own north wall").toBeLessThan(hall.v + hall.dv);

    const samples = [...south, ...north].filter((s) => s.room !== "TIMED-OUT");
    // Non-vacuity: the walk has to have actually reached a wall, or "never left the suite"
    // is a claim about a walker standing still in the middle of a corridor. MEASURED at the
    // shipped params: the hall's centre has 1.5 ft of clearance, so any sample under 1 ft
    // is a walker leaning on something.
    const nearest = Math.min(...samples.map((s) => clearance({ u: s.u, v: s.v }, CTX)));
    expect(nearest, `nearest approach to a wall over ${samples.length} samples`).toBeLessThan(1);
    expect(nearest, "and never through one").toBeGreaterThan(-1e-6);
    console.log(
      `hall end to end: ${samples.length} samples, ` +
        `v ${Math.min(...samples.map((s) => s.v)).toFixed(2)} to ${Math.max(...samples.map((s) => s.v)).toFixed(2)}, ` +
        `nearest wall ${nearest.toFixed(3)} ft`,
    );
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("walks into every wall in turn and is pushed back out of it", async ({ page }) => {
    const errors = await openInTheRoom(page);
    await awaitWalker(page);

    /*
     * Eight bearings, forty-five degrees apart, walked into whatever is there.
     *
     * A TURN THEN A WALK rather than a heading written in, because there is no way to set a
     * bearing from outside and inventing one would be testing a back door instead of the
     * keys. Each round turns 45 degrees -- held until the bearing has moved that far, not
     * for a fixed time, because a fixed time is a measurement of the frame rate -- and then
     * walks until the walker is flush against something or has covered 10 ft, whichever
     * comes first. The 10 ft escape is what keeps the bearings that lead out through a
     * doorway from spending the whole test budget in an open room.
     *
     * What this asserts on every sample is the invariant: in the footprint, and clear of
     * every band. "Resolves to outside it" is what a positive clearance MEANS -- the disc's
     * edge is outside the band -- and it is checked against a WalkCtx built in this file.
     */
    const worst: { bearing: number; clearance: number }[] = [];
    for (let i = 0; i < 8; i++) {
      const from = await walkOf(page);
      const spin = await holdUntil(
        page,
        ["d"],
        (s) => turned(s.heading, from.heading) > Math.PI / 4,
        `turn 45 degrees (round ${i})`,
        10_000,
      );
      expect(reached(spin), `round ${i} could not turn`).toBe(true);
      const at = endOf(spin);
      const pushed = await holdUntil(
        page,
        ["w"],
        (s) => clearance({ u: s.u, v: s.v }, CTX) <= 0.02 || apart(at, s) > 10,
        `walk into whatever is on bearing ${((at.heading * 180) / Math.PI).toFixed(0)}`,
      );
      const end = endOf(pushed);
      worst.push({
        bearing: (end.heading * 180) / Math.PI,
        clearance: Math.min(
          ...pushed.filter((s) => s.room !== "TIMED-OUT").map((s) => clearance({ u: s.u, v: s.v }, CTX)),
        ),
      });
    }
    console.log(
      worst.map((w) => `heading ${w.bearing.toFixed(0)}deg -> ${w.clearance.toFixed(3)} ft`).join(" | "),
    );
    /*
     * NEVER THROUGH A WALL, ON ANY BEARING. That is the assertion, and it is also checked on
     * every intermediate sample inside hold().
     *
     * The non-vacuity half is stated in aggregate rather than per bearing, and the number is
     * measured. With the walk held until the walker is flush, all eight bearings out of the
     * hall's centre end at 0.000 ft of clearance -- 120, 60, 0, -60, -120, -180, 120 and
     * 61 degrees, every one of them leaning on a band, which is what isClear()'s boundary
     * of "greater than minus an epsilon" looks like from outside. The bound is four rather
     * than eight because some of these bearings lead out through a doorway: the earlier
     * fixed-duration version of this loop measured 1.247 ft on the one that goes straight
     * through the bathroom door, whose centreline is at v = 29.75 -- exactly the hall's
     * centre -- and 8 ft of walking landed in the middle of the bathroom instead. Which
     * bearing a turn lands on is not fixed, and the doorways are not evenly spaced.
     */
    for (const w of worst) {
      expect(w.clearance, `bearing ${w.bearing.toFixed(0)} went through a wall`).toBeGreaterThan(
        -1e-6,
      );
    }
    const leaning = worst.filter((w) => w.clearance < 0.2).length;
    expect(leaning, `only ${leaning} of 8 bearings reached a wall at all`).toBeGreaterThanOrEqual(4);
    // And the walker is still somewhere real at the end of all that.
    const end = await walkOf(page);
    expect(violation(end)).toBeNull();
    expect(await cameraInWeld(page)).toBe(true);
    // The walker's own box, per collide.ts, is inside the room it says it is in -- the
    // stricter form of the point test, applied where a single rectangle can hold it.
    if (end.room !== null) {
      const room = SUITE.rooms.find((r) => r.id === end.room)!;
      const box = { u: end.u - RADIUS, v: end.v - RADIUS, du: 2 * RADIUS, dv: 2 * RADIUS };
      expect(
        containedBy(box, room),
        `the walker's own ${(2 * RADIUS).toFixed(1)} ft box is not wholly inside ${end.room}`,
      ).toBe(true);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the doorway is passable, and a 0.5 ft gap is not", async ({ page }) => {
    const errors = await openInTheRoom(page);

    /*
     * THE PREDICATE, in node, against the openings this suite actually has. canPass() is
     * strictly wider than the walker's diameter, so a 3 ft door passes at RADIUS = 0.75 and
     * a 0.5 ft gap does not -- which is docs/phases/P7-P8.md's requirement stated as
     * arithmetic. The 0.5 ft opening is synthesised from a real one so that nothing but the
     * width differs.
     */
    const { openings } = buildWalls(SUITE);
    const doors = openings.filter((o) => o.kind === "door");
    expect(doors.length, "six doors, five of them interior").toBeGreaterThanOrEqual(5);
    for (const d of doors) expect(canPass(d), `${d.id} is ${d.width} ft wide`).toBe(true);
    for (const w of openings.filter((o) => o.kind === "window")) {
      // A window is refused whatever its width: n5 is an 8 ft opening in the facade, above
      // the sill, and a walker who went through it would be in mid-air over Harvard Yard.
      expect(canPass(w), `${w.id} is glazed and ${w.width} ft wide`).toBe(false);
    }
    const narrow = { ...doors[0]!, width: 0.5 };
    expect(canPass(narrow), "a 0.5 ft gap is not a doorway a walker fits through").toBe(false);
    // And the boundary is where it is claimed to be, not merely somewhere below 3 ft.
    expect(canPass({ ...doors[0]!, width: 2 * RADIUS })).toBe(false);
    expect(canPass({ ...doors[0]!, width: 2 * RADIUS + 1e-6 })).toBe(true);

    /*
     * AND THE BEHAVIOUR, in the running app: a walker asked to cross one actually gets
     * through. There is no fp-go-bedB button to jump there any more -- P10 step 3 deletes
     * goToPlace() along with it -- so this walks to bedroom B on the keys first, the same
     * way a real viewer would, and then crosses back out through d2, the door between the
     * hall and bedroom B (measured, its centre is (16.25, 39.00)).
     */
    await awaitWalker(page);
    const d2 = thresholds(SUITE).find((t) => t.rooms.includes("hall") && t.rooms.includes("bedB"))!;
    const atHall = d2.rooms[0] === "hall" ? d2.at[0] : d2.at[1];
    const bedB = SUITE.rooms.find((r) => r.id === "bedB")!;
    const bedBCentre = { u: bedB.u + bedB.du / 2, v: bedB.v + bedB.dv / 2 };

    await walkToward(page, atHall);
    await turnToward(page, bedBCentre);
    const into = await holdUntil(page, ["w"], (s) => s.room === "bedB", "cross d2 into bedroom B");
    expect(reached(into), `stopped at (${endOf(into).u.toFixed(2)}, ${endOf(into).v.toFixed(2)})`).toBe(
      true,
    );

    await turnToward(page, atHall);
    const seen = await holdUntil(
      page,
      ["w"],
      (s) => s.room === "hall",
      "back out of bedroom B through its own door",
    );
    const end = endOf(seen);
    const rooms = seen.filter((s) => s.room !== "TIMED-OUT").map((s) => s.room);
    expect(
      end.room,
      `the walker got through the doorway into the hall; it reached (${end.u.toFixed(2)}, ${end.v.toFixed(2)})`,
    ).toBe("hall");
    // And it was IN the doorway on the way, which is the null roomAt() answers inside a
    // band. A walker that teleported across would never report one.
    expect(rooms, `rooms seen: ${[...new Set(rooms)].join(" -> ")}`).toContain(null);
    console.log(`crossing d2: ${[...new Set(rooms)].map((r) => r ?? "(doorway)").join(" -> ")}`);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("walking stays inside the suite's draw-call budget", async ({ page }) => {
    const errors = await openInTheRoom(page);
    const idle = await perfOf(page);
    expect(idle.calls, "the probe is live").toBeGreaterThan(0);

    await awaitWalker(page);
    // Ten feet of walking, so the sample is taken while the camera is genuinely moving
    // rather than on the frame the key went down.
    const from = await walkOf(page);
    await holdUntil(page, ["w"], (s) => apart(from, s) > 10, "walk a while");
    const walkingPerf = await perfOf(page);

    /*
     * 62, matching edit.spec.ts's own ceiling for the same stage (raised there in P14 for
     * the same reason).
     *
     * RAISED FROM 55 (P14 rows 1-6) TO 62 (P14 row 8). MEASURED on this build at 1280 x
     * 720, camera settled: 57 idle at stage 5, 53 while walking in this run (the frustum
     * varies with heading; facing a window or the entry can differ by a few calls either
     * way, and FallbackGround's own async texture/GLTF load can read a few calls lower on
     * a run that samples before it settles -- see edit.spec.ts's own note on this). First
     * person adds NO geometry -- `geometries` and `casters` are unchanged, it moves the
     * camera and nothing else -- so what the walking figure shows is the frustum, not a
     * cost.
     *
     * The rise from 50 to 57 is Outlook.tsx (P14 row 8): a keyless backdrop -- two
     * FallbackGround ground quads plus one merged campus.glb mesh, +3 -- now mounted
     * through stage 5 as well, since a window is a real hole in the wall (sash.ts) with
     * something on the other side of it now. 57 + edit.spec.ts's live-gesture headroom of
     * 3 is 60, which is why both ceilings now agree at 62 rather than disagreeing the way
     * earlier phases' figures briefly did.
     */
    console.log(`draw calls: idle ${idle.calls}, walking ${walkingPerf.calls}`);
    expect(walkingPerf.calls, `walking ${walkingPerf.calls}`).toBeLessThanOrEqual(62);
    expect(
      walkingPerf.calls - idle.calls,
      `idle ${idle.calls}, walking ${walkingPerf.calls}`,
    ).toBeLessThanOrEqual(3);
    // The frame is still full, so the budget is not being met by drawing nothing -- this
    // suite has shipped two render assertions that passed against broken scenes.
    expect(walkingPerf.triangles, "the room is still being drawn").toBeGreaterThan(1000);
    expect(walkingPerf.shadows).toBe(true);
    expect(walkingPerf.casters).toBeGreaterThanOrEqual(8);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("look up and down", async ({ page }) => {
    const errors = await openInTheRoom(page);
    await awaitWalker(page);

    const tol = (0.5 * Math.PI) / 180;
    const camTol = (0.1 * Math.PI) / 180;
    const before = await walkOf(page);

    const down = await holdUntil(
      page,
      ["f"],
      (s) => s.pitch <= -PITCH_LIMIT + 1e-4,
      "look down to the limit",
    );
    expect(reached(down), `pitch stopped at ${((endOf(down).pitch * 180) / Math.PI).toFixed(2)} deg`).toBe(
      true,
    );
    const atFloor = endOf(down);
    expect(
      Math.abs(atFloor.pitch + PITCH_LIMIT),
      `probe pitch ${((atFloor.pitch * 180) / Math.PI).toFixed(3)} deg`,
    ).toBeLessThan(tol);
    const camDown = camPitch(await camOf(page));
    expect(
      Math.abs(camDown - atFloor.pitch),
      `probe ${((atFloor.pitch * 180) / Math.PI).toFixed(3)} deg, camera ${((camDown * 180) / Math.PI).toFixed(3)} deg`,
    ).toBeLessThan(camTol);
    // Pitch must never move you: the plan point is exactly what it was before either hold.
    expect(atFloor.u, "looking down moved u").toBe(before.u);
    expect(atFloor.v, "looking down moved v").toBe(before.v);

    const up = await holdUntil(page, ["r"], (s) => s.pitch >= PITCH_LIMIT - 1e-4, "look up to the limit");
    expect(reached(up), `pitch stopped at ${((endOf(up).pitch * 180) / Math.PI).toFixed(2)} deg`).toBe(
      true,
    );
    const atCeiling = endOf(up);
    expect(
      Math.abs(atCeiling.pitch - PITCH_LIMIT),
      `probe pitch ${((atCeiling.pitch * 180) / Math.PI).toFixed(3)} deg`,
    ).toBeLessThan(tol);
    const camUp = camPitch(await camOf(page));
    expect(
      Math.abs(camUp - atCeiling.pitch),
      `probe ${((atCeiling.pitch * 180) / Math.PI).toFixed(3)} deg, camera ${((camUp * 180) / Math.PI).toFixed(3)} deg`,
    ).toBeLessThan(camTol);
    expect(atCeiling.u, "looking up moved u").toBe(before.u);
    expect(atCeiling.v, "looking up moved v").toBe(before.v);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the floor is in the frame", async ({ page }) => {
    const errors = await openInTheRoom(page);
    await awaitWalker(page);
    await holdUntil(page, ["f"], (s) => s.pitch <= -PITCH_LIMIT + 1e-4, "look down to the limit");

    /*
     * A RAY, NOT A SCREENSHOT. window.__cam publishes position and target in three.js
     * world space, so the floor -- suiteToThree's height parameter, which lands straight
     * on three's y -- is a plane at floorLevel(1) and the intersection is plain vector
     * math: no renderer, no pixels, the same recomputation this file already does for
     * containment and clearance.
     */
    const cam = await camOf(page);
    const floorY = floorLevel(1);
    const [px, py, pz] = cam.position;
    const [tx, ty, tz] = cam.target;
    const d: [number, number, number] = [tx - px, ty - py, tz - pz];
    expect(d[1], "the camera is looking down").toBeLessThan(0);
    const t = (floorY - py) / d[1];
    expect(t, "the floor is ahead of the camera, not behind it").toBeGreaterThan(0);
    const hit: [number, number, number] = [px + d[0] * t, floorY, pz + d[2] * t];
    const at = threeToSuite(hit);

    const hall = SUITE.rooms.find((r) => r.id === "hall")!;
    expect(at.u, `hit at (${at.u.toFixed(2)}, ${at.v.toFixed(2)})`).toBeGreaterThanOrEqual(hall.u - 1e-6);
    expect(at.u).toBeLessThanOrEqual(hall.u + hall.du + 1e-6);
    expect(at.v).toBeGreaterThanOrEqual(hall.v - 1e-6);
    expect(at.v).toBeLessThanOrEqual(hall.v + hall.dv + 1e-6);

    const walker = await walkOf(page);
    const dist = Math.hypot(at.u - walker.u, at.v - walker.v);
    expect(dist, `the floor hit is ${dist.toFixed(2)} ft from the walker`).toBeLessThan(2);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("arrival is continuous", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/?preload=0");
    await page.locator("canvas").waitFor();
    await page.getByTestId("stage-5").click();

    /*
     * THE 8 DEGREE SNAP, AS A GATE. Before P10 step 1, kf[5]'s pitch was a separately
     * hand-tuned shot and a walker's own starting look was a different number, so the
     * frame the fly-down arrived on and the frame first person started from disagreed --
     * measured at 8 degrees. standingPose() is now the one source both read, and a walker
     * is seeded in the same store update that flips the stage, so every sample from the
     * moment stage 5 is reached should already show the settled pitch, with nothing left
     * to ease toward.
     */
    const target = (-7.965 * Math.PI) / 180;
    const tol = (0.2 * Math.PI) / 180;
    const until = Date.now() + 1500;
    let samples = 0;
    while (Date.now() < until) {
      const c = await camOf(page);
      if (c.stage !== 5) continue;
      samples++;
      expect(c.firstPerson, "the arrival pose came from the walker").toBe(true);
      const p = camPitch(c);
      expect(Math.abs(p - target), `pitch ${((p * 180) / Math.PI).toFixed(3)} deg`).toBeLessThan(tol);
    }
    expect(samples, "no samples landed at stage 5").toBeGreaterThan(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("nothing teleports", async ({ page }) => {
    const errors = await openInTheRoom(page);
    // Every place-menu button P10 removed, and the two testids that used to bracket a
    // session in first person -- gone along with goToPlace() and leaveFirstPerson().
    await expect(page.getByTestId(/^fp-go-/)).toHaveCount(0);
    await expect(page.getByTestId("fp-enter")).toHaveCount(0);
    await expect(page.getByTestId("fp-leave")).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
