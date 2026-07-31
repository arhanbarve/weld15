import { test, expect, type Page } from "@playwright/test";

/**
 * Longer than the 30 s default for edit.spec.ts's reason: every measurement below waits
 * for a camera settle and for the perf probe to catch up against a SwiftShader renderer at
 * an 85 ms median frame, and there are four of them in one test.
 */
test.setTimeout(120_000);

/**
 * P4's threshold, gated where the defect actually is: the scanline sweep rides the shell
 * the CUTAWAY LEFT STANDING, not the whole building.
 *
 * The bug this locks down: Threshold.tsx built its sweep surface from the full buildWeld()
 * and knew nothing about the cut, so with a cutaway active the seam and its bright line
 * rode a gable and walls the renderer was no longer drawing. Visible only while
 * 0 < progress < 1, which is why it outlived the commit that taught the shell about the cut.
 *
 * CAN A PIXEL GATE TELL THE TWO STATES APART? YES, AND IT WAS MEASURED RATHER THAN
 * ASSUMED. This suite's rule is that pixels are the evidence where pixels are the thing,
 * and its counter-rule is that a shadow and a dark oak board are the same pixels -- so the
 * question was settled by photographing both states at stage 4, t = 0.35, mode roofOff and
 * counting, over all 921,600 pixels, those whose channels sum above 450 out of 765:
 *
 *   broken   10,898 above 450. 3,498 at t = 0.3, and 3,502 on returning to the same state
 *            later in the run, so the reading repeats to within four pixels.
 *   fixed    0. Zero at t = 0.3 and t = 0.35 alike, over three samples.
 *
 * journey.spec.ts's own two metrics move with it: 26.36% coverage and 134 distinct colours
 * broken against 24.64% and 48 fixed, at t = 0.3. That is a clean separation and not a
 * tuned threshold, and the reason it is so clean is worth stating, because it is also the
 * reason it does not generalise. With the roof off, the tallest thing left standing is the
 * 60 ft eaves; the seam at progress 0.3 sits at 68 ft with a 3 ft glow, so a sweep built
 * from the CUT shell has nothing to draw up there at all, and the line is the only source
 * of near-white in the frame -- the shell's own scan palette does not reach 450 anywhere.
 *
 * So the pixel assertion is here, and it is the visual claim: with the roof off, mid-sweep,
 * nothing in the frame is lit. What it CANNOT do is carry the whole gate, for three
 * reasons. It asserts an ABSENCE, which a blank canvas satisfies -- this suite has shipped
 * two render assertions that passed against broken scenes for exactly that reason, so the
 * absence is stated in the same test as the triangle counts that prove the frame is full.
 * It only separates the two states in the one mode where the surviving geometry is entirely
 * below the seam: at section and wallsDown the difference is a wall quad or two at the edge
 * of frame, and at none there is no difference at all. And it says nothing about WHAT the
 * sweep was built from, which is the actual invariant.
 *
 * That invariant is what window.__perf can state exactly: the sweep is one merged mesh, so
 * what the cutaway takes off it shows up in the renderer's own triangle total, as an
 * integer, hardware-independently (Perf.tsx says why). Both gates are below, the structural
 * one first.
 */

type Perf = { calls: number; triangles: number };
type Weld = { stage: number; cutaway: string };

const perf = (page: Page) => page.evaluate(() => (window as unknown as { __perf: Perf }).__perf);
const weld = (page: Page) => page.evaluate(() => (window as unknown as { __weld: Weld }).__weld);

/**
 * Stage 4 with the panel open, which is where the two controls this needs live.
 *
 * stage-4 by testid and not the skip link, for the reason edit.spec.ts records: `.skip`
 * sits at translateY(-200%) until it is focused, so Playwright reports it as outside the
 * viewport and refuses to click it.
 */
async function openAtTheThreshold(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("stage-4").click();
  await page.waitForTimeout(1400); // the camera settles; journey.spec.ts's own wait
  await expect.poll(async () => (await weld(page)).stage, { timeout: 15_000 }).toBe(4);
  const panel = page.getByTestId("panel");
  if (!(await panel.isVisible())) await page.getByTestId("panel-toggle").click();
  await expect(panel).toBeVisible();
  return errors;
}

/**
 * The renderer's totals at one cutaway mode and one point in the crossing.
 *
 * THE SLIDER NEEDS BOTH HALVES, AND THIS COST THE MOST TIME IN WRITING THIS FILE. A bare
 * fill() on the range input moves the thumb without reaching React's onChange, so the store
 * keeps the PREVIOUS t -- and because the change does land on the next interaction, the
 * readings come out LAGGED BY ONE STEP rather than obviously wrong, which reads as a
 * perfectly plausible table of numbers. It is the same fill()-then-dispatchEvent("input")
 * pair edit.spec.ts uses on every one of the panel's sliders.
 *
 * So the store is polled through the Hud's own read-out of `t` rather than trusted:
 * window.__weld does not carry t, and that span is the number the scene is drawing from.
 *
 * The final wait is for the perf probe, which reports the PREVIOUS frame's accumulated
 * totals (Perf.tsx's second trap); 500 ms at an 85 ms frame is six frames of slack on a
 * geometry rebuild that takes one.
 */
async function statsAt(page: Page, mode: string, t: number): Promise<Perf> {
  // P10 folded the per-stage threshold-t slider into JourneyBar's single master bar, which
  // carries `u` -- the whole descent, orbit to hall -- rather than a per-stage t. `t` here is
  // still stage 4's own progress, so it is converted through window.__journey (JourneyBar.tsx's
  // debug probe) rather than through a second implementation of journey.ts's mapping.
  const slider = page.getByTestId("journey");
  const u = await page.evaluate((tt) => {
    const j = (window as unknown as { __journey: { boundaries: number[]; spans: number[]; total: number } })
      .__journey;
    // Snapped to the slider's own 0.0005 step: Playwright's fill() on a range input
    // refuses a value that is not one of the step's own multiples ("Malformed value").
    // FLOORED, not rounded to nearest -- BEFORE is exactly thresholdOpacity()'s own
    // `lo` argument (0.2), the ramp's zero point, and rounding to nearest pushed the
    // decoded t a hair past 0.2 (0.20019), which was enough for `ramp()` to read a
    // nonzero progress and draw the sweep where the test needs shell-only. Flooring
    // always lands at or under the target t, which the ramp resolves to exactly 0.
    const raw = j.boundaries[4]! + (tt * j.spans[4]!) / j.total;
    return Math.floor(raw / 0.0005) * 0.0005;
  }, t);
  await slider.fill(String(u));
  await slider.dispatchEvent("input");
  await expect
    // The span immediately after the range input, and it still reads stage 4's own t --
    // JourneyBar.tsx displays the stage's t, not u -- so the assertion is unchanged.
    .poll(async () => slider.locator("+ span.tabular").textContent(), { timeout: 10_000 })
    .toBe(t.toFixed(2));
  await page.getByTestId(`cutaway-${mode}`).click();
  await expect.poll(async () => (await weld(page)).cutaway, { timeout: 10_000 }).toBe(mode);
  await page.waitForTimeout(500);
  return perf(page);
}

/**
 * How much of the frame is lit, over every pixel rather than a grid.
 *
 * journey.spec.ts samples 60 x 60 because it is asking how much of the frame is covered,
 * where a grid is enough. This is asking whether a thin bright line is present, and a
 * 3,600-point grid can miss one: at t = 0.3 the whole signal is about 3,500 pixels, which
 * is four tenths of one percent of the frame. The two grid metrics come back as well, so a
 * failure can say whether the frame was full.
 */
async function litPixels(page: Page) {
  return page.locator("canvas").evaluate((el) => {
    const src = el as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    let over450 = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! + data[i + 1]! + data[i + 2]! > 450) over450++;
    }
    const N = 60;
    let nonBg = 0;
    let total = 0;
    const seen = new Set<string>();
    for (let gx = 0; gx < N; gx++) {
      for (let gy = 0; gy < N; gy++) {
        const x = Math.floor((off.width * (gx + 0.5)) / N);
        const y = Math.floor((off.height * (gy + 0.5)) / N);
        const i = (y * off.width + x) * 4;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        total++;
        seen.add(`${r},${g},${b}`);
        if (Math.abs(r - 6) > 6 || Math.abs(g - 32) > 6 || Math.abs(b - 63) > 6) nonBg++;
      }
    }
    return {
      px: off.width * off.height,
      over450,
      nonBgPct: +((nonBg / total) * 100).toFixed(2),
      distinct: seen.size,
    };
  });
}

/**
 * The two points in the crossing, and why they are these two.
 *
 * BEFORE is t = 0.2, where thresholdOpacity()'s shell ramp is still 1: progress is 0, so
 * Threshold mounts no mesh at all and the total is the shell's alone. DURING is t = 0.35,
 * progress 0.3, where the sweep is drawn and the seam is still above the eaves. Both are
 * below 0.4, which is where the same function starts the INTERIOR ramp -- Suite returns
 * null at opacity <= 0.001 -- so the interior contributes nothing at either t and cannot
 * leak into a difference. Campus is already unmounted at stage 4 (visibility()), and the
 * composer's own passes are the same at both.
 */
const BEFORE = 0.2;
const DURING = 0.35;

/**
 * How many times the renderer submits one transparent double-sided mesh: back faces, then
 * front faces. three does that for `transparent && side === DoubleSide` unless
 * forceSinglePass is set, and every material in this scene's threshold is both -- the
 * shell's three, because the camera passes through the shell, and the line's own.
 *
 * MEASURED, not assumed, and it is why the arithmetic below divides. At t = 0.2 the shell
 * is still fully opaque, so `transparent` is false and each of its meshes is submitted
 * once: mode none reads 433 triangles and 21 calls against roofOff's 243 and 19, a
 * difference of 190 triangles over 2 calls. At t = 0.35 the same two modes read 1513 / 27
 * and 801 / 23 -- and before the fix, 1133 / 23 -- where every difference is doubled.
 */
const PASSES = 2;

/**
 * The whole frame's budget at stage 4, mid-crossing. Measured on this build: 27 calls at
 * mode none, which is 17 for the composer and the scene's fixtures plus 10 for five
 * transparent double-sided meshes -- the shell's four and the sweep, two passes each.
 * campus.spec.ts gates stages 1 to 3 at the same 30.
 *
 * OUTSIDE the crossing this costs nothing at all, which was measured the same way rather
 * than argued from the source: at stage 3, cycling none, roofOff, wallsDown, section and
 * back to none, window.__perf reads 26 calls / 16,899 triangles, 24 / 16,709, 24 / 16,691,
 * 23 / 16,595 and 26 / 16,899 -- the table in WeldExterior's header, to the triangle. The
 * sweep mounts no mesh at progress 0 and, since the fix, builds no geometry there either.
 */
const CALL_BUDGET = 30;

test.describe("P4 -- the seam rides the shell that is actually there", () => {
  test("the sweep surface loses what the cutaway took off the shell", async ({ page }) => {
    const errors = await openAtTheThreshold(page);

    const noneBefore = await statsAt(page, "none", BEFORE);
    const noneDuring = await statsAt(page, "none", DURING);
    const roofBefore = await statsAt(page, "roofOff", BEFORE);
    const roofDuring = await statsAt(page, "roofOff", DURING);
    // The frame the last of those measured, kept for the pixel claim at the bottom.
    const lit = await litPixels(page);

    const report =
      `none ${noneBefore.triangles}t/${noneBefore.calls}c -> ` +
      `${noneDuring.triangles}t/${noneDuring.calls}c, ` +
      `roofOff ${roofBefore.triangles}t/${roofBefore.calls}c -> ` +
      `${roofDuring.triangles}t/${roofDuring.calls}c`;

    /**
     * The two modes differenced at each t, which is what makes this independent of
     * everything else in the frame: the composer's passes and the scene's fixtures are
     * identical in both modes, so they cancel and no constant has to be known.
     *
     * roofOff is the mode it is measured in because it is the one cutaway that needs no
     * camera -- weldCut() answers ROOF_CUT for it wherever the flight has reached -- so
     * the numbers cannot depend on when the probe was read.
     *
     * BEFORE the sweep exists, the difference is what the roof takes off the SHELL: the
     * gable, the two roof features and the eaves lid. DURING, it is that same shell
     * difference plus whatever the cutaway takes off the SWEEP, times the two passes.
     */
    const shellOnly = noneBefore.triangles - roofBefore.triangles;
    const withSweep = (noneDuring.triangles - roofDuring.triangles) / PASSES;
    const sweepLost = withSweep - shellOnly;
    console.log(
      `${report} | shell ${shellOnly}, with sweep ${withSweep}, sweep lost ${sweepLost} | ` +
        `${lit.over450} of ${lit.px} px lit, ${lit.nonBgPct}% covered, ${lit.distinct} distinct`,
    );

    /**
     * What it costs, first, because the two claims after it are about a frame drawn to a
     * budget rather than about any frame at all.
     *
     * The sweep is still ONE mesh. It merges walls and roof for exactly this reason
     * (Threshold's header), and the two-pass submission is what makes the arithmetic below
     * divisible: were the sweep mounted as two meshes, mode none would carry one more of
     * them than roofOff does and this difference would be 6 rather than 4.
     */
    expect(noneDuring.calls - roofDuring.calls, `draw calls: ${report}`).toBe(
      PASSES * (noneBefore.calls - roofBefore.calls),
    );
    expect(noneDuring.calls, `draw calls: ${report}`).toBeLessThanOrEqual(CALL_BUDGET);

    /**
     * Then the pixels, because that is what a person sees: with the roof off, mid-sweep,
     * there is nothing left up there for the line to be drawn on, so nothing in the frame
     * is lit.
     *
     * 20 and not 0, on a measurement of 0 across three samples against 10,898 broken: the
     * bound is loose enough that a stray anti-aliased pixel is not a failure and tight
     * enough that a five-hundredth of the defect is. It asserts an ABSENCE, which is why it
     * is stated in the same test as the counts below rather than in one of its own -- those
     * are what prove the frame was full while it was dark, and they are in this message so
     * that a failure can say which of the two it was.
     */
    expect(
      lit.over450,
      `roofOff mid-sweep should light nothing: ${lit.nonBgPct}% covered, ` +
        `${lit.distinct} distinct, ${report}`,
    ).toBeLessThanOrEqual(20);

    // 166 is the gable (112) plus the eaves lid (54 of the shell's 220), which is exactly
    // the part of roofOff's 190 the sweep rides: the two roof features are the other 24 and
    // they are not in the merge. Pinned rather than bounded, because the parts it is made of
    // are pinned in tests/weldGeometry.test.ts -- so a re-digitised ring fails there too,
    // and a failure here alone is this component having stopped reading the cut.
    expect(sweepLost, `the sweep gave up the roof it no longer stands on: ${report}`).toBe(166);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  /**
   * The other two modes, mid-sweep, for the one thing that can only be checked by running
   * them: that the merge survives a CLIPPED wall.
   *
   * roofOff removes whole parts, and the test above measures it exactly because it needs no
   * camera. section does not remove a wall so much as cut it -- shellGeometry() splits the
   * two ring edges the plane crosses and pushes four fresh vertices per split -- and
   * wallsDown drops a set of quads that depends on where the flight has reached. Neither
   * count can be pinned from outside without pinning the camera with it, so what is asserted
   * is the part that is not camera-dependent: mergeBufferGeometries() takes the result, and
   * nothing throws on the way. A throw here would be a blank canvas for the whole crossing,
   * which is the failure this cheap gate is worth having for.
   */
  test("the other two cutaways also survive being ridden", async ({ page }) => {
    const errors = await openAtTheThreshold(page);
    const seen: string[] = [];
    for (const mode of ["wallsDown", "section"]) {
      const p = await statsAt(page, mode, DURING);
      seen.push(`${mode} ${p.triangles}t/${p.calls}c`);
    }
    // Recorded rather than asserted: measured at 665 triangles over 23 calls for wallsDown
    // and 465 over 21 for section, both against mode none's 1513 over 27 at the same t, so
    // the sweep came down in these two as well. Not pinned, because both depend on where the
    // flight had reached when the cut was last sampled -- which is the whole reason the
    // exact measurement above is taken in the one mode that needs no camera.
    console.log(seen.join(" | "));
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

