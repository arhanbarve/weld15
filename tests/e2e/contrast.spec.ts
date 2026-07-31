import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * MASTER.md's high-contrast toggle, and the two numbers it names.
 *
 * §Accessibility gates does not leave the effect to taste: the toggle "thickens strokes to
 * 2.5px, raises `--mass` opacity to 0.22". docs/CHECKLIST.md measured that no such control
 * existed -- every `<button>` and `<input>` at all six stages scanned for "contrast" in
 * text, `aria-label` or `data-testid`, and the list came back empty -- so this file gates
 * both halves: that the control is a real toggle, and that the two figures reach the GPU.
 *
 * WHY BOTH A PROBE AND PIXELS, WHICH IS THE ONE DESIGN DECISION IN HERE
 * Neither alone is enough and they fail in opposite directions.
 *
 *   Pixels alone cannot say 2.5. Effects.tsx runs a bloom pass, which spreads every bright
 *   pixel, and docs/CHECKLIST.md records that limit against its own stroke histogram: what
 *   a rendered-pixel method establishes reliably is the shape of a distribution and its
 *   response to DPR, not an absolute width to a tenth of a pixel. A gate asserting "2.5"
 *   off a screenshot would be asserting the bloom kernel.
 *
 *   The probe alone cannot say the number reached anything. `window.__campus` is what
 *   Campus.tsx believes it handed to <Line>, and this project's most repeated defect is
 *   exactly that gap -- an accessibility property written where it has no effect, most
 *   recently an `aria-label` on R3F's <Canvas> that landed on a container div. A probe
 *   agreeing with itself is the same class of evidence.
 *
 * So the probe carries the exact figures and the DPR term, and the canvas carries the
 * proof that switching the flag changes the picture. Same division of labour as
 * campus.spec.ts, which reads `window.__perf` for draw calls and the canvas for Weld's
 * highlight.
 *
 * AND `[` / `]`, which are in this file because they are the checklist's other handed-over
 * accessibility gate and they are in the same owner's hands. Measured before: pressing
 * BracketLeft then BracketRight with nothing focused left `window.__weld.stage` at 5, 5, 5.
 */
test.setTimeout(120_000);

/**
 * SERIAL, and this is a measured decision rather than caution.
 *
 * Six tests in this file each drive a WebGL scene, one of them at deviceScaleFactor 2, and
 * `fullyParallel` in playwright.config.ts would put all six on the machine at once beside
 * a11y.spec.ts, campus.spec.ts and perf.spec.ts. Run that way, everything in here passed and
 * `perf.spec.ts`'s frame-ring assertion FAILED at 4 frames against its bound of 10, with
 * median frame time up from the usual 62-79 ms to 205-300 ms under SwiftShader. That file's
 * own header records the same failure happening once before -- "written as >= 30 it failed
 * on its own, at 29, the first time all four specs ran together" -- so it is contention,
 * not a defect this file introduced, and it is not this owner's assertion to relax.
 *
 * Serial holds this file to one worker at a time. Re-measured with it, all four specs together
 * and twice over: 23 passed both times, and perf.spec.ts's ring reads 26 frames against its
 * bound of 10 on the run where it was logged. The cost is wall-clock in one file rather than a
 * neighbouring gate that fails for a reason unrelated to what it is testing.
 */
test.describe.configure({ mode: "serial" });

type Campus = {
  highContrast: boolean;
  dpr: number;
  lineWidth: number;
  weldLineWidth: number;
  massOpacity: number;
};

type Perf = { calls: number; triangles: number; lines: number };

const campus = (page: Page): Promise<Campus> =>
  page.evaluate(() => (window as unknown as { __campus: Campus }).__campus);
const perf = (page: Page): Promise<Perf> =>
  page.evaluate(() => (window as unknown as { __perf: Perf }).__perf);
const stageOf = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __weld: { stage: number } }).__weld.stage);

/** MASTER.md's two figures, and the shipped values they replace. */
const NORMAL = { line: 1.5, weld: 2.2, mass: 0.12 };
const HIGH = { line: 2.5, mass: 0.22 };

/**
 * Booted, hydrated and with the toggle present.
 *
 * The toggle rather than the canvas is what proves the HUD has hydrated -- a11y.spec.ts
 * waits on `a11y-alt-toggle` for the same reason -- and every assertion below is about a
 * control in the HUD or about a flag the HUD writes.
 */
async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("contrast-toggle").waitFor();
  /*
   * And then the probe, which is a SEPARATE wait and not belt-and-braces. The toggle is in
   * the HUD, which hydrates as soon as React does; `window.__campus` is published from
   * inside <Canvas>, which waits for a WebGL context, and under SwiftShader that is a
   * further second or two. The polled expression must not dereference the probe -- a
   * callback that throws ends the poll rather than retrying it, which is how this was first
   * written and how all six tests failed at once.
   */
  await expect
    .poll(() => page.evaluate(() => "__campus" in window), { timeout: 30_000 })
    .toBe(true);
}

/** The stage button, never the skip link: `.skip` is translated out of the viewport. */
async function gotoStage(page: Page, stage: number) {
  await page.getByTestId(`stage-${stage}`).click();
  await expect.poll(async () => stageOf(page), { timeout: 15_000 }).toBe(stage);
  // campus.spec.ts's own settle time. Every pixel count below is a settled frustum.
  await page.waitForTimeout(2400);
}

/** Nothing focused, which is the condition the window keydown is documented against. */
async function blur(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

/**
 * Two numbers off the real canvas, each the median of three samples a fifth of a second
 * apart -- and they are two numbers rather than one because MASTER specifies two changes
 * that show up in opposite parts of the histogram.
 *
 * `white` is campus.spec.ts's own predicate, unchanged: near-neutral and bright, which is
 * Weld's #ffffff highlighted line work and almost nothing else -- the masses are #96c8f5 at
 * 0.12 to 0.22 alpha, markedly blue, so they do not reach it. It is a proxy for STROKE
 * AREA, and a stroke 1.67x wider covers more of the frame.
 *
 * `p75` is the frame's 75th-percentile luminance, which is the MASS. 35 translucent blocks
 * are a large area of small change, so they move a high quantile of the distribution while
 * barely moving its top; strokes are a small area of large change and do the opposite.
 *
 * THE PAIR WAS CHOSEN BY MEASUREMENT, NOT BY REASONING, AND THE FIRST TRY WAS WRONG. This
 * started as `white` plus the frame's MEAN luminance, and the mean passed for the wrong
 * reason: with the mass mutated back to 0.12 -- MASTER's second value simply not honoured
 * -- the mean still rose 10.1 % on the thicker strokes alone and the assertion stayed
 * green. Ratios of on-to-off at stage 2, 1280 x 720, over three builds:
 *
 *   |                              | white | mean  |  p75  |
 *   | both values honoured         | 1.890 | 1.171 | 1.268 |
 *   | strokes 2.5, mass left 0.12  | 1.891 | 1.101 | 1.021 |
 *   | mass 0.22, strokes left 1.5  | 0.973 | 1.079 | 1.250 |
 *
 * So `white` moves only with the strokes and `p75` only with the mass, and the mean cannot
 * tell which of the two happened. Two orthogonal statistics, one per value MASTER names.
 *
 * The median of three samples because Weld's mass pulses continuously -- that pulse is one
 * of its three non-hue signals and campus.spec.ts gates it -- so a single sample carries
 * the phase of the pulse as noise.
 */
async function pixels(page: Page): Promise<{ white: number; p75: number }> {
  const samples: { white: number; p75: number }[] = [];
  for (let i = 0; i < 3; i++) {
    samples.push(
      await page.locator("canvas").evaluate((el) => {
        const src = el as HTMLCanvasElement;
        const off = document.createElement("canvas");
        off.width = src.width;
        off.height = src.height;
        const ctx = off.getContext("2d")!;
        ctx.drawImage(src, 0, 0);
        const { data } = ctx.getImageData(0, 0, off.width, off.height);
        let white = 0;
        const lums = new Float64Array(data.length / 4);
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
          if (r > 205 && g > 205 && b > 205 && b - r < 40) white++;
          lums[i / 4] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        lums.sort();
        return { white, p75: lums[Math.floor(lums.length * 0.75)]! };
      }),
    );
    await page.waitForTimeout(200);
  }
  const mid = <K extends "white" | "p75">(k: K) =>
    samples.map((s) => s[k]).sort((a, b) => a - b)[1]!;
  return { white: mid("white"), p75: mid("p75") };
}

test("the toggle is a real toggle: keyboard, aria-pressed, and a face that changes", async ({
  page,
}) => {
  await open(page);
  const btn = page.getByTestId("contrast-toggle");

  // Off by default, and the accessible name does NOT carry the state: a toggle whose name
  // changes is announced as a different control every press.
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await expect(btn).toHaveText("normal");
  await expect(btn).toHaveAttribute(
    "aria-label",
    "High contrast: thicker campus strokes and denser building masses",
  );

  // MASTER.md's 44 x 44 minimum, on the element rather than on an ancestor.
  const box = (await btn.boundingBox())!;
  expect(box.width, `${box.width} x ${box.height}`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${box.width} x ${box.height}`).toBeGreaterThanOrEqual(44);

  // REACHED AND OPERATED BY KEYBOARD ONLY, which is the requirement -- and with the ring,
  // read off the focused element rather than off the stylesheet.
  await btn.focus();
  const ring = await btn.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      style: s.outlineStyle,
      width: parseFloat(s.outlineWidth),
      color: s.outlineColor,
      visible: el.matches(":focus-visible"),
    };
  });
  expect(ring.style, JSON.stringify(ring)).toBe("solid");
  expect(ring.width, JSON.stringify(ring)).toBeGreaterThanOrEqual(2);
  expect(ring.visible, JSON.stringify(ring)).toBe(true);

  // Enter, the platform's own activation on a real <button>.
  await page.keyboard.press("Enter");
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(btn).toHaveText("high");
  expect((await campus(page)).highContrast).toBe(true);

  /*
   * THREE SIGNALS, TWO OF THEM NOT COLOUR. MASTER.md's rule is that colour is never the
   * sole indicator and the checklist proves it of every other toggle in this app, so it is
   * proved of this one too: the rendered WORD, the font WEIGHT, and aria-pressed -- plus
   * the border, which is the colour one. Read as computed styles, because `.on` is a class
   * name and a class name is not a rendered difference.
   */
  const on = await btn.evaluate((el) => {
    const s = getComputedStyle(el);
    return { weight: s.fontWeight, border: s.borderTopColor };
  });
  await page.keyboard.press(" ");
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  await expect(btn).toHaveText("normal");
  const off = await btn.evaluate((el) => {
    const s = getComputedStyle(el);
    return { weight: s.fontWeight, border: s.borderTopColor };
  });
  expect(Number(on.weight), `${on.weight} on / ${off.weight} off`).toBeGreaterThan(
    Number(off.weight),
  );
  expect(on.border, `${on.border} on / ${off.border} off`).not.toBe(off.border);
});

test("MASTER's two figures reach the scene, and they are CSS pixels", async ({ browser }) => {
  /*
   * DPR 1 AND DPR 2 IN ONE TEST, because the claim is about the relationship between them.
   * 2.5 is a CSS-pixel intent: `gl.lineWidth` is capped at 1 on every WebGL driver, so the
   * width that reaches the GPU is a LineSegments2 quad sized 2.5 x devicePixelRatio, and
   * docs/phases/P7-P8.md records that the line width must be scaled by DPR because the
   * style database rates thin-line-on-dark as poor. A gate that only checked DPR 1 would
   * pass on a build that had dropped the scale term.
   */
  for (const dpr of [1, 2]) {
    const ctx = await browser.newContext({ deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await open(page);

    const before = await campus(page);
    expect(before.dpr, `dpr ${dpr}: ${JSON.stringify(before)}`).toBe(dpr);
    expect(before.lineWidth, `dpr ${dpr}: ${JSON.stringify(before)}`).toBeCloseTo(
      NORMAL.line * dpr,
      5,
    );
    expect(before.weldLineWidth).toBeCloseTo(NORMAL.weld * dpr, 5);
    expect(before.massOpacity).toBeCloseTo(NORMAL.mass, 5);

    await page.getByTestId("contrast-toggle").click();
    await expect
      .poll(async () => (await campus(page)).highContrast, { timeout: 5_000 })
      .toBe(true);
    const after = await campus(page);

    // MASTER.md, quoted: strokes to 2.5px, --mass opacity to 0.22.
    expect(after.lineWidth, `dpr ${dpr}: ${JSON.stringify(after)}`).toBeCloseTo(
      HIGH.line * dpr,
      5,
    );
    expect(after.massOpacity, `dpr ${dpr}: ${JSON.stringify(after)}`).toBeCloseTo(HIGH.mass, 5);

    /*
     * AND WELD IS STILL THE WIDER STROKE. That is not decoration: the checklist measures
     * Weld's highlight as three signals, and stroke width is one of them. 2.5 applied as a
     * literal to the base width alone would take the buildings PAST Weld's 2.2 and delete a
     * signal in the name of an accessibility feature. The ratio is what is asserted, not
     * the difference, because the ratio is what Campus.tsx preserves by construction.
     */
    expect(after.weldLineWidth / after.lineWidth, JSON.stringify(after)).toBeCloseTo(
      NORMAL.weld / NORMAL.line,
      5,
    );
    console.log(
      `dpr ${dpr}: line ${before.lineWidth} -> ${after.lineWidth}, ` +
        `weld ${before.weldLineWidth} -> ${after.weldLineWidth}, ` +
        `mass ${before.massOpacity} -> ${after.massOpacity}`,
    );
    await ctx.close();
  }
});

test("it changes the picture and costs no draw calls", async ({ page }) => {
  await open(page);
  // Stage 2 is the campus at its most expensive: Weld's highlight arrives there, and
  // perf.spec.ts's Campus budget row is measured at the same stage for the same reason.
  await gotoStage(page, 2);

  const before = { ...(await perf(page)), ...(await pixels(page)) };
  await page.getByTestId("contrast-toggle").click();
  await expect.poll(async () => (await campus(page)).highContrast, { timeout: 5_000 }).toBe(true);
  await page.waitForTimeout(600);
  const after = { ...(await perf(page)), ...(await pixels(page)) };
  console.log(`stage 2 off: ${JSON.stringify(before)}\nstage 2 on:  ${JSON.stringify(after)}`);

  /*
   * NO NEW SUBMISSIONS. docs/IMPLEMENTATION-PLAN.md §9 budgets the campus at 10 scene draw
   * calls and perf.spec.ts gates all four of its rows; campus.spec.ts gates stages 1-3 at
   * 30 with the composer included. An accessibility feature that widened a quad by
   * spawning a second line mesh would be spent out of that budget rather than out of
   * nothing, so equality is the assertion and not "still under the cap".
   */
  expect(after.calls, `draw calls ${before.calls} -> ${after.calls}`).toBe(before.calls);
  expect(after.triangles, `triangles ${before.triangles} -> ${after.triangles}`).toBe(
    before.triangles,
  );
  expect(after.lines, `lines ${before.lines} -> ${after.lines}`).toBe(before.lines);

  // Thicker strokes cover more of the frame. Measured 3,045 -> 5,620 near-white pixels at
  // 1280 x 720, a factor of 1.85; gated at 1.4 so the bloom pass and the mass pulse have
  // room. This is the assertion that the flag reaches the GPU rather than only the probe.
  expect(after.white, `white ${before.white} -> ${after.white}`).toBeGreaterThan(
    before.white * 1.4,
  );
  // And the masses are denser, measured on the one statistic that moves for the mass and
  // not for the strokes -- see pixels() above for the three-build table that establishes
  // that. Measured 55.13 -> 69.92, a factor of 1.268, against 1.021 on a build where the
  // strokes thickened and the mass did not; gated at 1.12, between the two.
  expect(after.p75, `p75 luminance ${before.p75.toFixed(2)} -> ${after.p75.toFixed(2)}`).toBeGreaterThan(
    before.p75 * 1.12,
  );
});

test("prefers-contrast: more seeds it, and the control still overrides it", async ({ browser }) => {
  /*
   * THE PLATFORM FIRST. A viewer who has set the OS preference has already said what they
   * need, and making them find a button in a HUD to say it again is the accessibility
   * failure rather than the fix -- so the flag opens at the media query's value, exactly as
   * CameraRig seeds reducedMotion from `prefers-reduced-motion`.
   *
   * AND THEN THE PERSON WINS. The second half of this test is the half that would rot: a
   * `change` listener mirroring the query unconditionally would look correct here and would
   * silently switch high contrast back on for somebody who had just turned it off.
   */
  const ctx = await browser.newContext({ contrast: "more" });
  const page = await ctx.newPage();
  await open(page);

  const btn = page.getByTestId("contrast-toggle");
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await expect(btn).toHaveText("high");
  const seeded = await campus(page);
  expect(seeded.highContrast, JSON.stringify(seeded)).toBe(true);
  expect(seeded.lineWidth, JSON.stringify(seeded)).toBeCloseTo(HIGH.line, 5);
  expect(seeded.massOpacity, JSON.stringify(seeded)).toBeCloseTo(HIGH.mass, 5);

  await btn.click();
  await expect(btn).toHaveAttribute("aria-pressed", "false");
  const overridden = await campus(page);
  expect(overridden.highContrast, JSON.stringify(overridden)).toBe(false);
  expect(overridden.lineWidth, JSON.stringify(overridden)).toBeCloseTo(NORMAL.line, 5);

  /*
   * And the seed is the query's VALUE, not merely the query's existence: the same build
   * with no preference set opens off. Without this, a seeding effect that ignored
   * `mq.matches` and simply switched high contrast on would satisfy everything above --
   * measured, by writing exactly that mutation, and the assertions above stayed green.
   *
   * Worth recording the other half of that measurement, because it moves where a claim can
   * be made: the store's own `highContrast: false` initial value is NOT observable in a
   * browser. Hud.tsx's effect writes the query's value on mount, so shipping the store at
   * `true` changes nothing a page can see and this file cannot gate it.
   * tests/store.test.ts does, at the unit level, where the effect is not in the way.
   */
  const plain = await browser.newContext();
  const p2 = await plain.newPage();
  await open(p2);
  await expect(p2.getByTestId("contrast-toggle")).toHaveAttribute("aria-pressed", "false");
  expect((await campus(p2)).highContrast).toBe(false);

  await plain.close();
  await ctx.close();
});

test("[ and ] step the stage, and clamp at both ends", async ({ page }) => {
  await open(page);
  await gotoStage(page, 5);
  await blur(page);

  // The measured failure this replaces: BracketLeft then BracketRight left the published
  // stage at 5, 5, 5.
  expect(await stageOf(page)).toBe(5);
  await page.keyboard.press("BracketLeft");
  await expect.poll(async () => stageOf(page), { timeout: 5_000 }).toBe(4);
  await page.keyboard.press("BracketRight");
  await expect.poll(async () => stageOf(page), { timeout: 5_000 }).toBe(5);

  // prev() and next() already clamp, and the shortcut must not need its own opinion about
  // where the range ends. Six presses from stage 5 is one more than the range is long.
  for (let i = 0; i < 6; i++) await page.keyboard.press("BracketLeft");
  await expect.poll(async () => stageOf(page), { timeout: 5_000 }).toBe(0);
  for (let i = 0; i < 7; i++) await page.keyboard.press("BracketRight");
  await expect.poll(async () => stageOf(page), { timeout: 5_000 }).toBe(5);
});

test("the bracket guards: a form field, a modifier, and a walker", async ({ page }) => {
  await open(page);
  await gotoStage(page, 5);

  /*
   * A FIELD. Every one of the app's eighteen inputs is a range or a date, and a date field
   * genuinely takes typed characters -- so a bracket arriving at one must not move the
   * camera. This is the same guard the piece-nudge handler above it carries, and the same
   * failure it exists to prevent: a keyboard user's own control silently stolen.
   */
  await page.getByTestId("sun-date").focus();
  await page.keyboard.press("BracketLeft");
  await page.waitForTimeout(400);
  expect(await stageOf(page), "a bracket in the date field moved the camera").toBe(5);
  await page.getByTestId("sun-hour").focus();
  await page.keyboard.press("BracketLeft");
  await page.waitForTimeout(400);
  expect(await stageOf(page), "a bracket in the hour slider moved the camera").toBe(5);
  await blur(page);

  // A MODIFIER. Cmd+[ and Ctrl+[ are the browser's own Back on more than one platform, and
  // going back through history must not also cost a stage.
  await page.keyboard.press("Meta+BracketLeft");
  await page.waitForTimeout(400);
  expect(await stageOf(page), "Meta+[ moved the camera").toBe(5);
  await page.keyboard.press("Control+BracketLeft");
  await page.waitForTimeout(400);
  expect(await stageOf(page), "Control+[ moved the camera").toBe(5);

  /*
   * A WALKER. setStage() drops the walker, so an unguarded bracket would eject somebody
   * mid-stride from a stage they never asked to leave. P7's guard on the piece keys is the
   * same kind and this is the harder case: the walker is the only state a stage change
   * destroys.
   */
  await page.getByTestId("fp-enter").click();
  await page.getByTestId("fp-leave").waitFor();
  await blur(page);
  await page.keyboard.press("BracketLeft");
  await page.waitForTimeout(500);
  expect(await stageOf(page), "[ moved the camera while first person was on").toBe(5);

  // And the guard lifts rather than latching: leaving first person gives the keys back.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("fp-enter")).toBeVisible();
  await blur(page);
  await page.keyboard.press("BracketLeft");
  await expect.poll(async () => stageOf(page), { timeout: 5_000 }).toBe(4);
});
