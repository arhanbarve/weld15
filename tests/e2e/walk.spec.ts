import { test, expect, type Page } from "@playwright/test";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import { buildWalls, suiteFootprint } from "@/geo/walls";
import { containedBy, pointInPolygon } from "@/geo/collide";
import { canPass, clearance, walkContext, RADIUS } from "@/scene/walk";
import { fromThree } from "@/geo/frames";
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
 * published by FirstPerson.tsx, in the SUITE's own frame in feet -- exactly as window.__drag
 * carries a dragged piece. edit.spec.ts's header names the weakness in that: a probe can
 * agree with a broken renderer. It is answered here the way it is answered there, by not
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
  await page.goto("/");
  await page.locator("canvas").waitFor();
  await page.getByTestId("stage-5").click();
  await page.waitForTimeout(1400); // the camera settles; journey.spec.ts's own wait
  await expect.poll(async () => (await weldOf(page)).stage, { timeout: 20_000 }).toBe(5);
  await expect(page.getByTestId("fp-controls")).toBeVisible();
  return errors;
}

/** Stand up, and wait until the walker is actually being advanced. */
async function standUp(page: Page) {
  await page.getByTestId("fp-enter").click();
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

test.describe("P7 -- somebody can stand in Weld 15 and walk it", () => {
  test("stands up and leaves again, by keyboard alone", async ({ page }) => {
    const errors = await openInTheRoom(page);

    // Operated by keyboard, not by pointer: focus the control and press Enter, which is
    // what a keyboard user does and what pointer lock cannot be reached by. MASTER.md
    // requires a keyboard equivalent for every canvas interaction and pointer lock is a
    // mouse affordance, so this is the gate that says first person is not mouse-only.
    const enter = page.getByTestId("fp-enter");
    await enter.focus();
    await expect(enter).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await walkOf(page)).active, { timeout: 20_000 }).toBe(true);

    const at = await walkOf(page);
    // The hall, because places() puts the hub first and every room in this suite is entered
    // from it. And clear before the first frame, which is step()'s precondition.
    expect(at.room).toBe("hall");
    expect(violation(at)).toBeNull();
    expect(await cameraInWeld(page), "the camera is inside Weld's real footprint").toBe(true);
    expect((await camOf(page)).firstPerson, "the camera pose comes from the walker").toBe(true);
    // The notice says how to get out. Escape being folklore is what "do not trap the user"
    // is about.
    expect((await weldOf(page)).notice).toMatch(/Escape/);
    await expect(page.getByTestId("fp-keys")).toContainText("Esc");

    // ESCAPE LEAVES. One press, from wherever focus is.
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await walkOf(page)).active, { timeout: 20_000 }).toBe(false);
    await expect.poll(async () => (await camOf(page)).firstPerson, { timeout: 20_000 }).toBe(false);
    // And the camera is back on the stage's own shot, which is in the hall -- the P7 debt.
    expect(await cameraInWeld(page)).toBe(true);
    await expect(page.getByTestId("fp-enter")).toBeVisible();

    // Pointer lock is an enhancement, and whether it engaged at all is recorded rather than
    // asserted: this environment is headless Chromium, where it may be refused outright.
    await standUp(page);
    const box = (await page.locator("canvas").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    console.log(`pointer lock engaged: ${(await walkOf(page)).locked}`);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("walks the hall end to end without leaving the suite", async ({ page }) => {
    const errors = await openInTheRoom(page);
    await standUp(page);

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
    await standUp(page);

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
     * through. standIn(bedB) sits on the centreline of d2, the door between bedroom B and
     * the hall -- measured, the threshold's centre is (16.25, 39.00) and the room's centre
     * is (8, 39.00) -- so from there the crossing is a straight walk along +u. Arriving in
     * a room faces -u (store.ts's arrivalHeading), so S walks backwards along +u without
     * needing a turn at all.
     */
    await page.getByTestId("fp-go-bedB").click();
    await expect.poll(async () => (await walkOf(page)).room, { timeout: 20_000 }).toBe("bedB");
    const seen = await holdUntil(
      page,
      ["s"],
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

  test("the reduced-motion alternative moves the camera, in one step", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const errors = await openInTheRoom(page);
    expect((await weldOf(page)).reducedMotion, "the media query reached the store").toBe(true);

    /*
     * A JUMP CUT, MEASURED AS ONE. CameraRig keeps the distinct camera positions since the
     * last stage change or first-person toggle on window.__cam.path, at a 0.01 ft threshold,
     * and that is the only way to state "no intermediate position" from outside -- it is a
     * property of a sequence of frames, which a screenshot cannot show. The same device
     * carries docs/phases/P4-P5.md's reduced-motion gate for the stage 4 crossing.
     *
     * Entering first person resets the path, so the first destination leaves exactly one
     * entry and the second leaves two: one new camera position per jump, and no fly.
     */
    await page.getByTestId("fp-go-hall").click();
    await expect.poll(async () => (await walkOf(page)).room, { timeout: 20_000 }).toBe("hall");
    await page.waitForTimeout(600);
    const first = await camOf(page);
    expect(first.firstPerson).toBe(true);
    expect(first.path.length, `path after arriving in the hall: ${first.path.length}`).toBe(1);

    await page.getByTestId("fp-go-bedB").click();
    await expect.poll(async () => (await walkOf(page)).room, { timeout: 20_000 }).toBe("bedB");
    await page.waitForTimeout(600);
    const second = await camOf(page);
    expect(second.path.length, `path after jumping to bedroom B: ${second.path.length}`).toBe(2);
    // It MOVED, and by the distance between the two rooms rather than by a jitter. The hall
    // and bedroom B centres are 13.9 ft apart in the suite frame at the shipped params.
    const moved = Math.hypot(
      second.position[0] - first.position[0],
      second.position[2] - first.position[2],
    );
    expect(moved, `the camera moved ${moved.toFixed(2)} ft`).toBeGreaterThan(10);
    expect(await cameraInWeld(page)).toBe(true);
    expect(violation(await walkOf(page))).toBeNull();

    // Reachable by keyboard as well, which is the other half of the requirement: a control
    // only a mouse can reach is not an alternative for everyone who needs one.
    const bedA = page.getByTestId("fp-go-bedA");
    await bedA.focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await walkOf(page)).room, { timeout: 20_000 }).toBe("bedA");
    // And the control says which room you are in structurally, not by colour.
    await expect(bedA).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("fp-go-bedB")).toHaveAttribute("aria-pressed", "false");

    expect(errors, errors.join("\n")).toEqual([]);
    await ctx.close();
  });

  test("walking stays inside the suite's draw-call budget", async ({ page }) => {
    const errors = await openInTheRoom(page);
    const idle = await perfOf(page);
    expect(idle.calls, "the probe is live").toBeGreaterThan(0);

    await standUp(page);
    // Ten feet of walking, so the sample is taken while the camera is genuinely moving
    // rather than on the frame the key went down.
    const from = await walkOf(page);
    await holdUntil(page, ["w"], (s) => apart(from, s) > 10, "walk a while");
    const walkingPerf = await perfOf(page);

    /*
     * 50, matching edit.spec.ts's own ceiling for the same stage (raised there in P10 for
     * the same reason).
     *
     * RAISED FROM 40 (P7) TO 50 (P10). MEASURED on this build at 1280 x 720, camera
     * settled: 46 idle at stage 5, 43 while walking. First person adds NO geometry --
     * `geometries` and `casters` are unchanged, it moves the camera and nothing else -- so
     * what the walking figure shows is the frustum, not a cost.
     *
     * The 46 is itself new: real furniture (geo/pieces.ts, batched by kind AND material --
     * 11 batches, up from 8), interior sash joinery/glazing (geo/sash.ts) and
     * baseboard/rail/cornice (geo/trim.ts) replaced the old shared-unit-box furniture and
     * flat window panes -- every one of those additions is what the phase set out to draw.
     * 46 + edit.spec.ts's live-gesture headroom of 3 is 49, which is why both ceilings now
     * agree at 50 rather than disagreeing by one call the way 38/40 and 41 did.
     */
    console.log(`draw calls: idle ${idle.calls}, walking ${walkingPerf.calls}`);
    expect(walkingPerf.calls, `walking ${walkingPerf.calls}`).toBeLessThanOrEqual(50);
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
});
