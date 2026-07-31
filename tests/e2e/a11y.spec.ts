import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import { thresholds } from "@/scene/route";

/**
 * P8's accessibility gate: axe-core clean on all six stages, and the written
 * description actually behaves like a live region rather than merely looking like one.
 *
 * WHY EVERY CLAIM IN HERE IS READ OUT OF THE RENDERED DOM
 * An accessibility property written where it has no effect is this project's most
 * repeated defect -- three times, most recently an `aria-label` passed to R3F's
 * <Canvas>, which lands on a container div and was measured absent from both the div and
 * the canvas, so the whole descent had no accessible name at all. Reading the source
 * would have shown a label. Only the browser showed the truth, and Experience.tsx's
 * CanvasLabel exists because a gate like this one found it. So nothing below is asserted
 * from what a component says it does: the roles, the aria-live, the focus ring, the tab
 * order and the box geometry are all read back out of a real page.
 *
 * WHY THE 120 s BUDGET
 * playwright.config.ts already allows 90 s because headless Chromium runs SwiftShader in
 * software. Each axe test boots the app, flies to its stage, waits for the camera to settle
 * and runs axe twice -- closed and open, which are two different documents. edit.spec.ts
 * sets the same 120 s for the same class of reason. scanStage's docblock records why the
 * stage loop is outside the test rather than inside it, which is the one thing here that
 * was changed by a failure rather than designed.
 */
test.setTimeout(120_000);

type Weld = { stage: number };

/** UrlSync publishes this on every store change; it is how a gate waits for real state. */
const weld = (page: Page) => page.evaluate(() => (window as unknown as { __weld: Weld }).__weld);

type Walk = {
  room: string | null;
  heading: number;
  u: number;
  v: number;
  turnSign: number;
  frames: number;
};

/** window.__walk, published by FirstPerson.tsx, in the suite frame -- see walk.spec.ts. */
const walkOf = (page: Page) => page.evaluate(() => (window as unknown as { __walk: Walk }).__walk);

const SUITE = buildSuite(DEFAULT_PARAMS);
const DOOR_HALL_BEDA = thresholds(SUITE).find(
  (t) => t.rooms.includes("hall") && t.rooms.includes("bedA"),
)!;

/** Smallest signed difference a - b, radians, in (-pi, pi]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Turn on the keys until the walker faces `target`, in the suite frame -- walk.spec.ts's
 * own turnToward(), duplicated rather than shared, since this project keeps each e2e file
 * self-contained.
 *
 * WHICH KEY TURNS WHICH WAY is not assumed: screenTurnSign() flips A and D between the two
 * facades. It is not found by trial either -- an earlier version of this held `d` for a
 * real 150 ms and kept whichever key had shrunk the gap to `target`, which breaks on a
 * target close to directly behind the walker: that gap sits right at the heading's own
 * (-pi, pi] wrap seam, and a burst long enough to cross the seam turns the walker the RIGHT
 * amount and comes out the wrong side of it, where the before/after comparison reads as if
 * the turn had gone the wrong way -- which is how the walker ended up in the wrong room.
 * `turnSign` is read straight off the walker's own probe instead: it says whether `d` adds
 * to the heading or subtracts from it, which is exactly what deciding a direction needs.
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

/** Hold W until `stop` is true of the walker's own sample. */
async function walkUntil(page: Page, stop: (s: Walk) => boolean, maxMs = 20_000): Promise<Walk> {
  await page.keyboard.down("w");
  const until = Date.now() + maxMs;
  let s = await walkOf(page);
  try {
    while (Date.now() < until && !stop(s)) s = await walkOf(page);
  } finally {
    await page.keyboard.up("w");
  }
  return s;
}

/** Whether a sample has arrived within half a foot of a plan point. */
const near = (s: Walk, t: { u: number; v: number }) => Math.hypot(t.u - s.u, t.v - s.v) < 0.5;

/**
 * Walk to within half a foot of `target`, steering the whole way there rather than
 * turning once and trusting the aim to hold over the distance -- walk.spec.ts's own
 * walkToward(), duplicated for the reason turnToward() above already is.
 *
 * turnToward's own closest approach is bounded by a single rendered frame's worth of
 * turn -- 7 to 10+ degrees under SwiftShader -- and a few degrees of residual aim over a
 * room-scale walk is a lateral miss well past near()'s half a foot, which is what left
 * this walk spending its whole budget short of the doorway rather than reaching it. `w`
 * stays held for the whole approach and a turn key corrects course whenever the bearing
 * to `target` has drifted, held for exactly one PROCESSED FRAME rather than a guessed
 * duration -- a duration held across a real wait is this suite's own known failure mode
 * under worker contention, where a tap can be delivered, or released, far later than
 * asked and overshoot by exactly as much.
 */
async function walkToward(page: Page, target: { u: number; v: number }, tol = 0.5, maxMs = 30_000) {
  await turnToward(page, target, 0.15);
  const until = Date.now() + maxMs;
  await page.keyboard.down("w");
  try {
    while (Date.now() < until) {
      const s = await walkOf(page);
      if (Math.hypot(target.u - s.u, target.v - s.v) < tol) return;
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

/** The app, booted and hydrated, with the description mounted. */
async function open(page: Page) {
  await page.goto("/");
  await page.locator("canvas").waitFor();
  // The toggle rather than the canvas is what proves the HUD has hydrated, and the
  // description with it.
  await page.getByTestId("a11y-alt-toggle").waitFor();
  await expect.poll(async () => (await weld(page)).stage, { timeout: 15_000 }).toBe(0);
}

/**
 * The stage button, never the skip link.
 *
 * `.skip` sits at translateY(-200%) until it is focused -- that is the whole point of a
 * skip link -- so Playwright reports it as outside the viewport and refuses to click it.
 * edit.spec.ts and journey.spec.ts both take this route for the same reason.
 *
 * The wait is on the store and then on the clock: the published stage flips on the click,
 * but the camera keeps flying for a second afterwards, and axe should not run against a
 * document mid-transition. 1400 ms is journey.spec.ts's settled figure.
 */
async function gotoStage(page: Page, stage: number) {
  await page.getByTestId(`stage-${stage}`).click();
  await expect.poll(async () => (await weld(page)).stage, { timeout: 15_000 }).toBe(stage);
  await page.waitForTimeout(1400);
}

/** Every violation, formatted so a failure names the rule and the node rather than a count. */
function describeViolations(vs: { id: string; impact?: string | null; help: string; nodes: { target: unknown[] }[] }[]) {
  return vs
    .map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help}\n` +
        v.nodes.map((n) => `        at ${n.target.join(" ")}`).join("\n"),
    )
    .join("\n");
}

const STAGE_NAMES = ["Orbit", "Cambridge", "Harvard Yard", "Weld Hall", "Threshold", "Weld 15"];

/**
 * Both axe scans for one stage. The stage loop is OUTSIDE the test, for a measured reason.
 *
 * As one test walking all six stages this took 1.2 minutes on its own and then exceeded the
 * 120 s budget above when the whole e2e suite ran, because five other specs are driving
 * WebGL scenes through SwiftShader on the same cores. That is the third time this project
 * has met the same failure -- campus.spec.ts failed only under parallel load, journey.spec.ts
 * tipped over the 30 s default as the suite grew -- and the two earlier fixes both raised a
 * budget.
 *
 * Six tests is the better fix here, and not because the work is smaller: it is slightly
 * larger, since each test boots and hydrates the app again. What changes is that each stage
 * gets the whole 120 s instead of a sixth of it, Playwright spreads them across workers, and
 * a failure names the stage instead of naming the loop. Trimming the scans was never an
 * option -- twelve is what covers six stages in two states, and the states are two different
 * documents.
 */
async function scanStage(page: Page, stage: number): Promise<string[]> {
  const report: string[] = [];
  // TWO scans per stage, because they are two different documents and the shipping
  // default is the closed one. Closed, the page carries the toggle and a live region
  // whose text has just changed; open, it carries a heading tree, a scrollable
  // region, an eight-column table of seven rooms and a second button. A gate that
  // only scanned the expanded form would pass a broken default, and one that only
  // scanned the default would never look at the table at all.
  for (const state of ["closed", "open"] as const) {
    const expanded = (await page.getByTestId("a11y-alt-toggle").getAttribute("aria-expanded")) === "true";
    if (expanded !== (state === "open")) {
      await page.getByTestId("a11y-alt-toggle").click();
    }
    // The disclosure's own state, from the DOM, before anything is measured against it.
    await expect(page.getByTestId("a11y-alt-toggle")).toHaveAttribute(
      "aria-expanded",
      state === "open" ? "true" : "false",
    );
    if (state === "open") await page.getByTestId("a11y-alt").waitFor();
    else await expect(page.getByTestId("a11y-alt")).toHaveCount(0);

    const r = await new AxeBuilder({ page }).analyze();
    report.push(
      `stage ${stage} ${state}: ${r.violations.length} violations, ` +
        `${r.passes.length} passes, ${r.incomplete.length} incomplete`,
    );
    expect(
      r.violations,
      `stage ${stage}, description ${state}:\n${describeViolations(r.violations)}`,
    ).toEqual([]);

    /*
     * The one INCOMPLETE result, accounted for rather than ignored.
     *
     * Every scan reports exactly one: color-contrast, and its FIFTEEN nodes at stage 0
     * (9 that axe cannot resolve against a gradient, 6 it calls too short) are all
     * (the count has moved twice and is worth tracking rather than rounding: fourteen
     * until `.hud-num` took an opaque --void-deep ground in 5bcb253 -- its contrast was
     * 4.15:1 against a ground that moved with the frame, because 18% of Earth's lit limb
     * came through --chip-scan behind it, and it is 5.06:1 flat now -- then thirteen,
     * then fifteen when the high-contrast toggle added `button[data-testid=
     * "contrast-toggle"]` and `.hud-orbit > span[aria-hidden="true"]`. Both are the
     * gradient cause, and the toggle deliberately keeps --chip-scan so it looks like
     * every other HUD button; an opaque ground would resolve it and single it out)
     * in other owners' chrome -- `.hud-stage`, `.hud-num`, the six stage buttons,
     * the two `.hud-t` rows, the sun readout, the area readout and Sources' summary.
     * Two causes, both read out of axe's own messages: "background color could not
     * be determined due to a background gradient", because the HUD sits on
     * --chip-scan over .vignette's radial gradient, and "content is too short to
     * determine if it is actual text content" for the single-digit stage buttons.
     * Neither is a failure and neither is this owner's to fix.
     *
     * What IS asserted is that none of those nodes is A11yAlt's. That is not
     * bookkeeping: it is the gate on the choice globals.css records, which is that
     * this panel takes an opaque --void-deep ground instead of a translucent chip
     * precisely so a contrast ratio can be determined at all. A panel axe cannot
     * measure is a panel nobody has checked, on either of the two grounds the app
     * crosses.
     */
    const unresolved = r.incomplete.flatMap((v) =>
      v.nodes.map((n) => n.target.join(" ")).filter((t) => t.includes("a11y-alt")),
    );
    expect(
      unresolved,
      `stage ${stage} ${state}: axe could not resolve contrast on ${unresolved.join(", ")}`,
    ).toEqual([]);
  }
  return report;
}

test.describe("P8 -- the model has a text alternative", () => {
  for (const stage of [0, 1, 2, 3, 4, 5]) {
    test(`axe-core finds nothing at stage ${stage}, description open or closed`, async ({ page }) => {
      await open(page);
      await gotoStage(page, stage);
      console.log((await scanStage(page, stage)).join("\n"));
    });
  }

  test("the live region is in the accessibility tree, and its text follows the stage", async ({
    page,
  }) => {
    await open(page);
    const live = page.getByTestId("a11y-alt-live");

    // The properties that make it a live region at all, from the rendered element.
    await expect(live).toHaveAttribute("role", "status");
    await expect(live).toHaveAttribute("aria-live", "polite");
    // Atomic, because the sentence is replaced wholesale rather than appended to: without
    // it a reader may announce only the words that differ, which turns "Stage 4 of 5,
    // Threshold" into "4".
    await expect(live).toHaveAttribute("aria-atomic", "true");

    /*
     * AND THAT IT IS ACTUALLY IN THE TREE, which is the assertion that would have caught
     * two of this project's three accessibility regressions. A region is removed from the
     * accessibility tree by display: none, by visibility: hidden, by the `hidden`
     * attribute and by aria-hidden on ANY ancestor -- and every one of those leaves the
     * markup looking correct. The element is clipped to a 1 px box on purpose, so its
     * size proves nothing either way; what is checked is the four things that would
     * silence it.
     */
    const tree = await live.evaluate((el) => {
      const s = getComputedStyle(el);
      const hidden: string[] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        if (n.getAttribute("aria-hidden") === "true") hidden.push(`${n.tagName}[aria-hidden]`);
        if (n.hasAttribute("hidden")) hidden.push(`${n.tagName}[hidden]`);
      }
      return { display: s.display, visibility: s.visibility, hidden };
    });
    expect(tree.display, "display: none removes it from the tree").not.toBe("none");
    expect(tree.visibility, "visibility: hidden removes it from the tree").not.toBe("hidden");
    expect(tree.hidden, `hidden ancestors: ${tree.hidden.join(", ")}`).toEqual([]);

    // The opening sentence, which a reader browsing the page meets before touching
    // anything. Stage 0 is the globe, and the description has to say so.
    await expect(live).toHaveText(/^Stage 0 of 5, Orbit\. /);
    const first = (await live.textContent()) ?? "";

    // And it CHANGES with the stage. Each of the six is checked rather than one, because
    // the failure this guards against is a region that holds the sentence it was mounted
    // with -- which reads correctly at whichever stage you happen to load.
    const said: string[] = [first];
    for (const stage of [1, 2, 3, 4, 5]) {
      await gotoStage(page, stage);
      await expect(live).toHaveText(
        new RegExp(`^Stage ${stage} of 5, ${STAGE_NAMES[stage]}\\. `),
        { timeout: 10_000 },
      );
      said.push((await live.textContent()) ?? "");
    }
    /*
     * Six stages, six different descriptions -- with the "Stage N of 5, Name." prefix
     * STRIPPED before they are compared, which is the whole point of this assertion.
     * Six full sentences are distinct the moment the stage number is in them, so
     * comparing them whole would be a check that 0 through 5 are different integers and
     * it would pass against a region that said nothing else about the frame at all. What
     * has to differ is the part that describes what is on screen.
     */
    const described = said.map((s) => s.replace(/^Stage \d of 5, [^.]+\. /, ""));
    expect(new Set(described).size, described.join("\n")).toBe(6);
    // Stage 5 stands in a room, and naming the room is the whole point of the exercise --
    // stages.ts positions that shot, and cameraInSuite() is what turns the world position
    // back into a room. A sentence that named the wrong room would be worse than none.
    //
    // THE ROOM MOVED, AND THE MACHINERY DID NOT. This asserted "Bedroom B" until P7 routed
    // the stage 4 -> 5 path through the doorway and stood the final shot in the hall, which
    // is what stages.ts always wanted and could not have: a straight blend from bedroom B
    // to the hall passes through the partition between them, and it clears at the shipped
    // params only by luck -- measured worst clearance +0.264 ft, and -0.354 ft at
    // hallWidth = 3, which is the panel's own slider minimum. So this is a stale
    // expectation rather than a regression, and the fact that it failed is the gate working.
    expect(said[5]).toContain("Hall");
    console.log(said.map((s, i) => `stage ${i}: ${s}`).join("\n"));
  });

  /*
   * The description has to follow the WALKER, not the stage.
   *
   * P7 introduced the one thing that moves the camera without changing the stage, and
   * whereIs() derived its position from cameraKeyframe(stage, t) -- so the sentence said
   * "Standing in Hall" while somebody walked into bedroom A. It was found by reading the
   * component, which is the wrong way round for this project: an accessibility property
   * written where it has no effect is its most repeated defect, three times over, and the
   * cure was always a gate that reads the rendered page. So this is that gate.
   *
   * IT WALKS BY HOLDING KEYS NOW, not by a place menu. goToPlace() and the fp-go-* buttons
   * it drove are gone (P10 step 3): standing at stage 5 is automatic, and the only way
   * anywhere from it is the keys walk.spec.ts drives -- A/D to aim at the doorway between
   * the hall and bedroom A, W to cross it, the same turnToward()/walkUntil() this file
   * grew for the purpose. The corresponding SwiftShader-flakiness worry the old comment
   * named is walk.spec.ts's to own, since its holds are already condition-based rather
   * than duration-based for exactly that reason.
   */
  test("the written description follows the walker into another room", async ({ page }) => {
    await open(page);
    await gotoStage(page, 5);
    await page.getByTestId("a11y-alt-toggle").click();
    const live = page.getByTestId("a11y-alt-live");

    // Standing on the stage-5 keyframe, which P7 put in the hall -- and already walking,
    // since a walker is seeded automatically the instant stage 5 is reached (P10 step 3).
    await expect(live).toContainText("Hall");

    const bedA = SUITE.rooms.find((r) => r.id === "bedA")!;
    const bedACentre = { u: bedA.u + bedA.du / 2, v: bedA.v + bedA.dv / 2 };
    const atHall = DOOR_HALL_BEDA.rooms[0] === "hall" ? DOOR_HALL_BEDA.at[0] : DOOR_HALL_BEDA.at[1];
    const atBedA = DOOR_HALL_BEDA.rooms[0] === "hall" ? DOOR_HALL_BEDA.at[1] : DOOR_HALL_BEDA.at[0];

    await walkToward(page, atHall);
    await turnToward(page, bedACentre);
    await walkUntil(page, (s) => s.room === "bedA");

    // The sentence now names bedroom A, and says it is walking -- both, because naming
    // the room while still claiming to be on the keyframe would be half a fix, and the
    // wording is what tells a reader the camera is theirs now.
    await expect(live).toContainText("Bedroom A", { timeout: 20_000 });
    await expect(live).toContainText("Walking");
    const walked = await live.textContent();

    // And it goes back, so the override is not a one-way latch.
    await walkToward(page, atBedA);
    await turnToward(page, atHall);
    await walkUntil(page, (s) => s.room === "hall");
    await expect(live).toContainText("Hall", { timeout: 20_000 });
    expect(walked, `walked sentence: ${walked}`).not.toContain("Hall");
    console.log(`walking: ${walked}`);
  });

  test("announcements are throttled across a camera move", async ({ page }) => {
    await open(page);
    await gotoStage(page, 4);

    /*
     * Stage 4's threshold slider IS a camera move: it flies the camera thirty-odd feet
     * through Weld's north gable wall, and the description names the percentage it is
     * through, so every input event changes the sentence. That makes it the one control
     * in the app that can flood a live region, and P8's requirement -- "a live region
     * that fires on every frame is worse than none" -- is measured here rather than
     * asserted from the presence of a setTimeout.
     *
     * The whole sweep runs INSIDE the page. Forty round trips from Node would each take
     * tens of milliseconds under SwiftShader and the gaps between them, not the throttle,
     * would decide the answer.
     *
     * The value goes in through HTMLInputElement's own prototype setter rather than by
     * assigning `.value`, because React tracks the last value it wrote on the DOM node:
     * a plain assignment updates that tracker too, so React sees no change and the
     * handler never runs. Going through the prototype setter leaves the tracker stale,
     * which is what makes the dispatched event look like a real one.
     */
    const N = 40;
    const measured = await page.evaluate(async (n) => {
      const el = document.querySelector('[data-testid="a11y-alt-live"]')!;
      const slider = document.querySelector('[data-testid="threshold-t"]') as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

      const emitted: string[] = [];
      const record = () => {
        const text = el.textContent ?? "";
        if (text !== emitted[emitted.length - 1]) emitted.push(text);
      };
      record();
      const obs = new MutationObserver(record);
      obs.observe(el, { childList: true, characterData: true, subtree: true });

      // 40 events over roughly a second, which is a slow deliberate drag rather than a
      // flick: a fast one would be an easier test to pass.
      const values: string[] = [];
      for (let i = 0; i < n; i++) {
        const v = String(i / (n - 1));
        values.push(v);
        setValue.call(slider, v);
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 25));
      }
      // Longer than the 500 ms throttle, so the final announcement has landed.
      await new Promise((r) => setTimeout(r, 1200));
      obs.disconnect();
      return { emitted, sent: values.length, distinctSent: new Set(values).size };
    }, N);

    console.log(
      `threshold sweep: ${measured.sent} input events (${measured.distinctSent} distinct values), ` +
        `${measured.emitted.length - 1} announcement(s)\n` +
        measured.emitted.map((t, i) => `  ${i === 0 ? "before" : `say ${i}`}: ${t}`).join("\n"),
    );

    // It spoke at all. A region that never updates is not a throttled region, it is a
    // broken one, and every ceiling below is satisfied by silence.
    expect(measured.emitted.length - 1, "it announced nothing at all").toBeGreaterThanOrEqual(1);
    // And the sweep really drove the model: the last sentence names the value it stopped
    // on, so a slider wired to nothing fails here rather than passing the ceiling.
    // Checked in this order because the two are independent claims and each has to be
    // able to fail on its own -- silence fails the line above, a wrong number this one.
    expect(measured.emitted.at(-1), "the last announcement names where the drag ended").toContain(
      "100 per cent",
    );
    // And it spoke a handful of times rather than once per event. MEASURED on this build:
    // 40 input events carrying 40 distinct percentages produce ONE announcement, so the
    // ceiling is 4 -- room for a SwiftShader stall long enough to open a 500 ms gap
    // mid-sweep, and still an order of magnitude below the unthrottled 40.
    expect(
      measured.emitted.length - 1,
      `${measured.sent} events produced ${measured.emitted.length - 1} announcements`,
    ).toBeLessThanOrEqual(4);
  });

  test("the description is second in tab order, focus-visible, and clear of the HUD", async ({
    page,
  }) => {
    await open(page);

    /*
     * TAB ORDER FIRST, and skip stays first within it. journey.spec.ts asserts that the
     * escape hatch is the first thing a keyboard reaches, and a focusable element mounted
     * ahead of it silently takes that place -- so this repeats the claim from the other
     * side, as the gate that fails if A11yAlt is ever moved up.
     *
     * Second is then the toggle, and that is a visual-order claim rather than an
     * arbitrary one: the dock is top-left, directly under where skip appears, and the
     * HUD's stage buttons are centred. Tab has to walk top-left before centre.
     */
    /*
     * FOUR STOPS SINCE P9, NOT THREE, and the addition is placed by the same visual-order rule
     * this test already argues from rather than appended for convenience. P9 adds a fly-down
     * control, and it sits at the TOP CENTRE of the viewport -- above the HUD, which is bottom
     * centre. So the walk is top-left, top-left, top-centre, bottom-centre: skip, the description
     * toggle, the fly-down, then the stage buttons.
     *
     * The claim this test exists to make is unchanged and is still the first two entries: skip is
     * first, and the description toggle is second. The tail is what pins the new control's place
     * so that a later control cannot quietly insert itself ahead of the description.
     *
     * The fly-down is not mounted under reduced motion or at stage 3 and beyond, and this test
     * runs at stage 0 with motion on, so it is present here.
     */
    const stops: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      stops.push(
        await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null),
      );
    }
    expect(stops, `tab stops: ${stops.join(" -> ")}`).toEqual([
      "skip",
      "a11y-alt-toggle",
      "fly-down",
      "stage-0",
    ]);

    // The focus ring is REAL, measured on the focused element. A keyboard user who cannot
    // see where they are has no tab order at all. Focus arrived by Tab above, so this is
    // :focus-visible rather than :focus.
    // TWO presses back, because the walk above is now four stops and ends on the HUD.
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("a11y-alt-toggle")).toBeFocused();
    const ring = await page.getByTestId("a11y-alt-toggle").evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor };
    });
    expect(ring.style, JSON.stringify(ring)).not.toBe("none");
    expect(ring.width, JSON.stringify(ring)).toBeGreaterThanOrEqual(2);

    // Enter opens it -- the platform's own activation on a real <button>, not a click.
    await page.keyboard.press("Enter");
    await page.getByTestId("a11y-alt").waitFor();
    await expect(page.getByTestId("a11y-alt-toggle")).toHaveAttribute("aria-expanded", "true");
    // aria-controls points at something that exists. A dangling reference is the shape of
    // this project's repeated defect: an attribute that reads correctly and does nothing.
    const controls = await page.getByTestId("a11y-alt-toggle").getAttribute("aria-controls");
    expect(await page.locator(`#${controls}`).count(), `aria-controls="${controls}"`).toBe(1);

    // The content is generated from the model rather than written: seven rooms, which is
    // buildSuite()'s five named rooms plus the hall plus the unnamed strip.
    await expect(page.locator('[data-testid="a11y-alt-rooms"] tbody tr')).toHaveCount(7);
    // The scroll container is reachable. An eight-column table is wider than a 26rem
    // panel, and a scrollable region a keyboard cannot enter is axe-core's
    // scrollable-region-focusable -- a serious failure, and there is nothing focusable
    // inside a table of numbers to satisfy it by accident.
    await expect(page.getByTestId("a11y-alt-scroll")).toHaveAttribute("tabindex", "0");

    /*
     * AND IT DOES NOT COVER A CONTROL. At stage 5 the HUD moves to the top of the frame,
     * which is the same corner this dock lives in, and the panel is at its tallest when
     * open. globals.css's .sources rule records this exact defect being shipped once
     * already -- a 38rem disclosure over the stage buttons -- so it is gated rather than
     * commented. The check is on the boxes, because "it looked fine" is what shipped it.
     */
    await gotoStage(page, 5);
    await page.getByTestId("a11y-alt").waitFor();
    const overlap = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const a = box(".a11y-alt-dock");
      const b = box('[data-testid="hud"]');
      const c = box('[data-testid="sources"]');
      const hits = (p: DOMRect, q: DOMRect) =>
        p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom;
      const r = (x: DOMRect) => [x.left, x.right, x.top, x.bottom].map(Math.round);
      return { hud: hits(a, b), sources: hits(a, c), dock: r(a), hudBox: r(b), sourcesBox: r(c) };
    });
    expect(overlap.hud, `dock ${overlap.dock} vs hud ${overlap.hudBox}`).toBe(false);
    expect(overlap.sources, `dock ${overlap.dock} vs sources ${overlap.sourcesBox}`).toBe(false);
    console.log(
      `stage 5 boxes [l,r,t,b]: dock ${overlap.dock}, hud ${overlap.hudBox}, sources ${overlap.sourcesBox}`,
    );
  });
});
