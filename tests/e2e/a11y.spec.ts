import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

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
     * Every scan reports exactly one: color-contrast, and its TWELVE nodes at stage 0
     * (six that axe cannot resolve against a gradient, six it calls too short) are all
     * (the count has moved several times and is worth tracking rather than rounding:
     * fourteen until `.hud-num` took an opaque --void-deep ground in 5bcb253 -- its
     * contrast was 4.15:1 against a ground that moved with the frame, because 18% of
     * Earth's lit limb came through --chip-scan behind it, and it is 5.06:1 flat now --
     * then thirteen, then fifteen when the high-contrast toggle added `button[data-testid=
     * "contrast-toggle"]` and `.hud-orbit > span[aria-hidden="true"]`, both the gradient
     * cause. P10 step 5 folded the sun and Sources into the dock and replaced the per-stage
     * HUD with `.dock-card`, which removed `.hud-num` from this list (it inherits the
     * dock's own ground now) and added `.imagery-chip`, `journey-read` and the two
     * disclosure summaries -- `.dock-fold` and `.sources-toggle` -- each still sitting on
     * --chip-scan. Step 6 then retired the contrast toggle outright rather than build the
     * missing control, which is why RE-MEASURED at twelve rather than fourteen or fifteen:
     * gradient nodes are `.imagery-chip`, `.hud-stage`, `journey-read`, `.fly`,
     * `.dock-fold > summary` and `summary[data-testid="sources-toggle"]`; too-short nodes
     * are `.on` -- the current stage tick -- and the five OTHER stage buttons, `Stage 1`
     * through `Stage 5`. `.hud-orbit > span[aria-hidden="true"]` is NOT among them at
     * stage 0: it belongs to the first-person walk row, which only mounts at stage 5, and
     * step 8's orbit keys have not landed yet either)
     * in other owners' chrome. Two causes, both read out of axe's own messages:
     * "background color could not be determined due to a background gradient", because the
     * dock sits on --chip-scan over .vignette's radial gradient, and "content is too short
     * to determine if it is actual text content" for the single-digit stage buttons.
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
   * It walks by the reduced-motion place menu rather than by holding keys, and that is not
   * a shortcut: goToPlace() is the alternative that exists so a reduced-motion viewer can
   * move at all, it lands the walker in a known room deterministically, and it therefore
   * asserts the same override with none of the timing that makes a key-held walk flaky
   * under SwiftShader. walk.spec.ts holds the keys.
   */
  test("the written description follows the walker into another room", async ({ page }) => {
    await open(page);
    await gotoStage(page, 5);
    await page.getByTestId("a11y-alt-toggle").click();
    const live = page.getByTestId("a11y-alt-live");

    // Standing on the stage-5 keyframe, which P7 put in the hall.
    await expect(live).toContainText("Hall");

    await page.getByTestId("fp-enter").click();
    await page.getByTestId("fp-go-bedA").click();

    // The sentence now names bedroom A, and says it is walking rather than standing --
    // both, because naming the room while still claiming to be on the keyframe would be
    // half a fix, and the wording is what tells a reader the camera is theirs now.
    await expect(live).toContainText("Bedroom A", { timeout: 20_000 });
    await expect(live).toContainText("Walking");
    const walked = await live.textContent();

    // And it goes back, so the override is not a one-way latch.
    await page.getByTestId("fp-go-hall").click();
    await expect(live).toContainText("Hall", { timeout: 20_000 });
    expect(walked, `walked sentence: ${walked}`).not.toContain("Hall");

    // Leaving first person hands the sentence back to the stage.
    await page.keyboard.press("Escape");
    await expect(live).toContainText("Standing", { timeout: 20_000 });
    await expect(live).not.toContainText("Walking");
    console.log(`walking: ${walked}`);
  });

  test("announcements are throttled across a camera move", async ({ page }) => {
    await open(page);
    await gotoStage(page, 4);

    /*
     * Stage 4's OWN SHARE of the master bar IS a camera move: it flies the camera
     * thirty-odd feet through Weld's north gable wall, and the description names the
     * percentage it is through, so every input event changes the sentence. That makes it
     * the one control in the app that can flood a live region, and P8's requirement -- "a
     * live region that fires on every frame is worse than none" -- is measured here rather
     * than asserted from the presence of a setTimeout.
     *
     * P10 step 5 replaced the stage-4-only `threshold-t` slider with `journey`, one input
     * for the whole descent (JourneyBar.tsx). Sweeping its full 0..1 range would fly
     * through all six stages rather than flood stage 4's own sentence, so the sweep below
     * is confined to stage 4's slice of the bar, `[boundaries[4], boundaries[5])`, read
     * off `window.__journey`, the same probe the slider itself publishes.
     *
     * KEPT SHORT OF THE TOP BY MORE THAN HALF A STEP, AND THAT MARGIN IS MEASURED, NOT
     * GUESSED. `fromJourney` names u = boundaries[5] (which is 1) {stage: 5, t: 0} rather
     * than {stage: 4, t: 1} -- those are the same pose, named from the far side of the
     * seam -- so reaching it would swap the stage the sweep is flooding a live region
     * about, mid-sweep. The obvious fix, capping at u = 0.999 of the way from lo to hi,
     * measured as landing on stage 5 anyway: Chromium's range input rounds a
     * PROGRAMMATICALLY set `.value` to the nearest `step` (0.0005 here) even though the
     * spec's sanitisation algorithm only documents clamping to min/max, and 0.999 of a
     * ~13%-of-bar-wide leg lands within a quarter-step of the top, so it snapped up to
     * exactly 1. `marginU` below is chosen to sit inside the one window that clears both
     * constraints: bigger than half a step, so Chromium rounds down instead of up, and
     * small enough that the stopping point still names "100 per cent" (t >= 0.995).
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
      const slider = document.querySelector('[data-testid="journey"]') as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      const boundaries = (window as unknown as { __journey: { boundaries: number[] } }).__journey
        .boundaries;
      const lo = boundaries[4]!;
      const hi = boundaries[5]!;
      const step = Number(slider.step) || 0.0005;
      // Between 0.5 step (Chromium's own rounding radius) and 0.5% of the leg's span
      // (the room "100 per cent" has before it rounds down to "99"). See above.
      const marginU = step * 0.9;

      const emitted: string[] = [];
      const record = () => {
        const text = el.textContent ?? "";
        if (text !== emitted[emitted.length - 1]) emitted.push(text);
      };
      record();
      const obs = new MutationObserver(record);
      obs.observe(el, { childList: true, characterData: true, subtree: true });

      // 40 events over roughly a second, which is a slow deliberate drag rather than a
      // flick: a fast one would be an easier test to pass. Capped at hi - marginU rather
      // than hi itself, for the reason above.
      const values: string[] = [];
      const cap = Math.min(1, Math.max(0, 1 - marginU / (hi - lo)));
      for (let i = 0; i < n; i++) {
        const frac = Math.min(cap, i / (n - 1));
        const v = String(lo + frac * (hi - lo));
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
     * right-hand dock is top-right. Tab has to walk top-left before top-right.
     */
    /*
     * FOUR STOPS, AND THE THIRD CHANGED UNDER P10 STEP 5, NOT STEP 6. Through P9 the fly-down
     * sat at the top centre of the viewport on its own, ahead of the HUD's stage buttons in
     * tab order, so the third stop was `fly-down`. Step 5 folded the fly-down into the one
     * dock's `.dock-card`, behind JourneyBar -- and JourneyBar's own `journey` input, the
     * master scrubber, is now the first focusable thing inside the card, ahead of both the
     * fly-down button and the stage ticks it carries. So the third stop is `journey`, not
     * `fly-down`; this was a step 5 regression this test did not catch until step 6 re-ran it.
     *
     * The claim this test exists to make is unchanged and is still the first two entries: skip
     * is first, and the description toggle is second. The tail pins whichever control the dock
     * puts first, so a later control cannot quietly insert itself ahead of the description.
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
      "journey",
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
     * AND IT DOES NOT COVER A CONTROL. Through P9 the HUD moved to the top of the frame at
     * stage 5, the same corner this description dock lives in; P10 step 5 put the right-hand
     * dock at the top on every stage, so the two docks are always in the same corner and the
     * panel is at its tallest when open regardless of stage. globals.css's .sources rule
     * records this exact defect being shipped once already -- a 38rem disclosure over the
     * stage buttons -- so it is gated rather than commented. The check is on the boxes,
     * because "it looked fine" is what shipped it.
     *
     * LEFT DOCK VS RIGHT DOCK, NOT LEFT DOCK VS TWO OF THE RIGHT DOCK'S CHILDREN. Through
     * P9 the HUD and Sources were separate fixed elements, so `[data-testid="hud"]` and
     * `[data-testid="sources"]` were the two boxes worth checking against the left-hand
     * description panel. P10 step 5 put both inside one `.dock`, `data-testid="dock"`
     * (Hud.tsx), which is now the single fixed element on the right -- `hud` is a
     * `.dock-card` nested inside it, and `sources` sits alongside that card in the same
     * column. Checking the two children individually would miss the disclosure between
     * them (`view-fold`) overlapping the left dock while both named children stayed
     * clear, so this compares the two OUTER boxes, which is the property that actually
     * matters: do the two sides of the screen collide.
     */
    await gotoStage(page, 5);
    await page.getByTestId("a11y-alt").waitFor();
    const overlap = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      const left = box(".a11y-alt-dock");
      const right = box('[data-testid="dock"]');
      const hits = (p: DOMRect, q: DOMRect) =>
        p.left < q.right && q.left < p.right && p.top < q.bottom && q.top < p.bottom;
      const r = (x: DOMRect) => [x.left, x.right, x.top, x.bottom].map(Math.round);
      return { hits: hits(left, right), leftBox: r(left), rightBox: r(right) };
    });
    expect(overlap.hits, `left ${overlap.leftBox} vs right ${overlap.rightBox}`).toBe(false);
    console.log(`stage 5 boxes [l,r,t,b]: left dock ${overlap.leftBox}, right dock ${overlap.rightBox}`);
  });
});
