import { test, expect, type Page, type Browser } from "@playwright/test";

/**
 * P8's performance gates, and the one thing in here that is deliberately NOT a gate.
 *
 * The project's standing rule is that frame time is recorded and never asserted, because
 * headless Chromium runs SwiftShader in software: Perf.tsx's header, campus.spec.ts's
 * comment and the playwright config all say so, and the median frame in this environment
 * is 62-79 ms against 1-3 ms on a GPU. P8 finally recorded the real number and it is at
 * the bottom of this file, from a real browser rather than from here. What this file
 * asserts is draw calls and triangles, which are hardware-independent.
 *
 * WHAT WAS ACTUALLY MISSING. `docs/IMPLEMENTATION-PLAN.md` §9 states a budget of 4 / 10 /
 * 8 / 25 draw calls for the globe, the campus, the exterior and the suite, and NOTHING
 * gated it: campus.spec.ts gates stages 1-3 at 30, threshold.spec.ts gates stage 4 at 30
 * and edit.spec.ts gates stage 5 at 45, all three of them numbers chosen to accommodate
 * the bloom composer rather than numbers from §9. Read against the whole frame §9's table
 * is simply wrong -- stage 0 measures 20 calls against its "≤ 4" -- and the reason is a
 * unit error of the same kind found in `WeldExterior.tsx`'s header and `P4-P5.md`'s
 * verification table: the column counts the SCENE's submissions and the frame also carries
 * the composer's. Measured, at 1280 x 720, full motion against reduced motion:
 *
 *   stage 0   20 calls -> 3     stage 3 none        26 -> 9
 *   stage 1   22 calls -> 5     stage 3 roofOff     24 -> 7
 *   stage 2   26 calls -> 9     stage 3 wallsDown   24 -> 7
 *   stage 3   26 calls -> 9     stage 3 section     23 -> 6
 *   stage 4   21 calls -> 4     stage 5 idle        38 -> 21
 *
 * Seventeen at all ten of those, and 17 triangles with them -- one fullscreen triangle per
 * pass. So §9's numbers are right about the thing they are counting, and every one of them
 * passes once the composer is taken off. That is what the first test gates: §9's own
 * budget, on §9's own quantity.
 *
 * EVERY ASSERTION IN HERE WAS BROKEN ON PURPOSE FIRST, because a green gate that cannot
 * fail is not a gate:
 *
 * - Two extra spheres added to Globe.tsx: "Globe is over §9's draw call budget of 4 (was 3
 *   calls / 3,328 tris): Globe (stage 0): 5 calls / 3488 tris". The first attempt put them
 *   at y = ±1.4 and the test still passed -- at the stage 0 keyframe the frustum's vertical
 *   half-extent is 2.6 tan 22.5° = 1.08, so they were culled and never submitted. Which is
 *   worth recording: this gate counts what the frustum admits, not what is mounted.
 * - `reducedMotion` dropped from the budget context, i.e. the budget read against the whole
 *   frame: "Globe is over §9's draw call budget of 4: 20 calls / 3345 tris". That is the
 *   unit error above, reproduced as a failure.
 * - COMPOSER_PASSES set to 16: "the composer's share of stage 2 moved: stage 2: 26 -> 9
 *   calls ... Expected: 16, Received: 17".
 * - `<Perf />` removed from Experience.tsx: "window.__perf is absent: is <Perf /> still
 *   mounted?". The order of the last test's first two lines is because of this run -- the
 *   log line came first and reported a TypeError instead of the reason.
 * - The frame-ring bound needed no deliberate mutation: written as >= 30 it failed on its
 *   own, at 29, the first time all four specs ran together. That failure is the falsifiability
 *   evidence and the reason the bound is now 10; the note beside it records both numbers.
 */

type Perf = {
  calls: number;
  triangles: number;
  lines: number;
  geometries: number;
  shadows: boolean;
  casters: number;
  frames: number;
  medianMs: number | null;
};

const perf = (page: Page): Promise<Perf> =>
  page.evaluate(() => (window as unknown as { __perf: Perf }).__perf);

/**
 * `__perf`, once it has stopped changing. Every COUNTING assertion reads this, not `perf`.
 *
 * WHAT THIS FIXES, MEASURED. The counting tests took one sample after a fixed 2400 ms
 * settle, and under full-suite load that sample could land on a frame that had not
 * rendered: `triangles: 1`, or stage 5 reading 1 draw call where it draws 38. The composer
 * gate failed that way in a full run while passing in isolation with an exact 17-call
 * delta at both stages. Median frame time went from 62-79 ms to 205-300 ms under the same
 * load, so 2400 ms stopped being enough frames to settle in -- the wait was denominated in
 * milliseconds and what it needed was FRAMES.
 *
 * So this waits for the thing the assertion depends on instead of for the clock: two
 * consecutive reads agreeing on both counts, with a floor that rejects the unrendered
 * frame outright. It is the same move as waiting on `window.__weld` rather than sleeping,
 * which is how every other spec in this suite avoids exactly this class of flake.
 *
 * NOT a retry of the assertion. The bounds are untouched and a genuinely over-budget frame
 * still fails: this only refuses to answer with a frame that was never drawn. A draw-call
 * budget that tolerates a frame reading 1 triangle is not a budget, and loosening one was
 * the alternative to this.
 */
async function settled(page: Page, what: string): Promise<Perf> {
  let prev: Perf | null = null;
  for (let i = 0; i < 60; i++) {
    const p = await perf(page);
    if (
      p &&
      p.triangles > 100 &&
      p.calls > 0 &&
      prev &&
      prev.calls === p.calls &&
      prev.triangles === p.triangles
    ) {
      return p;
    }
    prev = p ?? null;
    await page.waitForTimeout(150);
  }
  throw new Error(
    `${what}: __perf never settled over 9 s. Last read: ${JSON.stringify(prev)}. ` +
      `A read of 1 triangle or 1 call means the frame had not rendered.`,
  );
}

async function openAt(page: Page, stage: number) {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`stage-${stage}`).click();
  // The same 2400 ms campus.spec.ts waits: the camera has to settle before the frustum
  // stops changing, and every count in here is a frustum's worth of geometry.
  await page.waitForTimeout(2400);
}

/**
 * The bloom composer's own submissions, at the suite's 1280 x 720 default viewport.
 *
 * Pinned as a constant because the four budget rows below are gated with the composer
 * switched off, and that is only a legitimate reading of §9 if the difference between the
 * two states is exactly the composer and nothing else. Measured at 17 calls and 17
 * triangles at ten separate sample points (the table in this file's header).
 *
 * IT IS A FUNCTION OF THE VIEWPORT, not a constant of the app: bloom builds a mip chain
 * over the render target, so a different canvas size gives a different pass count. That is
 * why the test that pins it fixes the viewport rather than inheriting one, and why this
 * number must not be reused anywhere that resizes the canvas.
 */
const COMPOSER_PASSES = 17;

/**
 * `docs/IMPLEMENTATION-PLAN.md` §9, one row per line, with the stage each row is about and
 * the figure measured against it on 31 July 2026.
 *
 * Stage 2 rather than 1 for the campus row because it is the more expensive of the two --
 * Weld's highlight edges arrive at 2 -- and stage 3 reads identically to stage 2. Stage 4
 * for the exterior row: it is the only stage where the shell is the whole frame.
 */
const BUDGET = [
  { row: "Globe", stage: 0, calls: 4, triangles: 20_000, measured: "3 calls / 3,328 tris" },
  // RAISED FROM 10 TO 13 IN P9, and this is a real rise against a documented budget rather
  // than a flake. Ground.tsx adds four nested photographic quads to the campus stages and
  // Globe.tsx an atmosphere rim; measured on this build with the composer subtracted, stage 2
  // is 11 scene calls against the 9 recorded here before P9. 13 leaves two, which is the same
  // headroom the row had before. The triangle budget is untouched -- four quads are eight
  // triangles, and 16,888 against 120,000 is not the constraint.
  { row: "Campus", stage: 2, calls: 13, triangles: 120_000, measured: "11 calls / 16,888 tris" },
  { row: "Weld exterior", stage: 4, calls: 8, triangles: 40_000, measured: "4 calls / 416 tris" },
  // RAISED FROM 25 TO 35 IN P10. Real furniture (geo/pieces.ts, batched by kind AND
  // material -- 11 batches, up from 8), interior sash joinery and glazing (geo/sash.ts)
  // and baseboard/rail/cornice (geo/trim.ts) replaced the old shared-unit-box furniture
  // and flat window panes: every one of those additions is what the phase set out to
  // draw. Measured on this build, reduced motion, stage 5: 29 calls / 10,044 tris.
  // Triangles stay far under the existing 80,000 ceiling; only calls moved.
  { row: "Suite", stage: 5, calls: 35, triangles: 80_000, measured: "29 calls / 10,044 tris" },
];

/**
 * Reduced motion is how the composer gets switched off, and it is the app's own behaviour
 * rather than a test hook: Effects.tsx drops bloom under `reduce` and campus.spec.ts
 * already asserts that it does. So this context is not a special build -- it is the app as
 * a viewer with the preference set sees it, which is also the configuration in which §9's
 * numbers are the whole frame.
 */
async function reducedPage(browser: Browser) {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  return { ctx, page: await ctx.newPage() };
}

test("§9's budget holds, on the quantity §9 is counting", async ({ browser }) => {
  const { ctx, page } = await reducedPage(browser);
  const report: string[] = [];
  try {
    for (const b of BUDGET) {
      await openAt(page, b.stage);
      const p = await settled(page, `${b.row} (stage ${b.stage})`);
      report.push(`${b.row} (stage ${b.stage}): ${p.calls} calls / ${p.triangles} tris`);
      expect(
        p.calls,
        `${b.row} is over §9's draw call budget of ${b.calls} (was ${b.measured}): ${report.join(" | ")}`,
      ).toBeLessThanOrEqual(b.calls);
      expect(
        p.triangles,
        `${b.row} is over §9's triangle budget of ${b.triangles} (was ${b.measured}): ${report.join(" | ")}`,
      ).toBeLessThanOrEqual(b.triangles);
      // Non-vacuity. A frame that draws nothing satisfies any budget, and this suite has
      // twice been passed by a scene that had stopped rendering.
      expect(p.calls, `${b.row} drew nothing at all: ${report.join(" | ")}`).toBeGreaterThan(0);
      expect(p.triangles, `${b.row} drew no geometry: ${report.join(" | ")}`).toBeGreaterThan(100);
    }
    console.log(report.join("\n"));
  } finally {
    await ctx.close();
  }
});

test("the composer is the whole difference between the frame and the budget", async ({
  browser,
}) => {
  /**
   * The gate that makes the one above readable. Without it, "9 calls at stage 2" and "26
   * calls at stage 2" are two unexplained numbers and the budget could be gated on either;
   * with it, the difference is named and pinned, so a change that quietly adds a scene
   * submission cannot hide inside the composer's share.
   *
   * Two stages, not one: stage 3 is the campus at its heaviest and stage 5 is the suite
   * with the shadow pass running, which are the two rows with the least headroom.
   *
   * STAGE 3 RATHER THAN STAGE 2, SINCE P10 STEP 10c. Full motion at stage 2's own default
   * pose (814.6 ft, stages.ts) sits inside altitude.ts's tint band, so WeldExterior's
   * `progress` is fractional there and Threshold's sweep mesh mounts -- but only under full
   * motion: `drawn = !reduced && progress > 0 && progress < 1` drops it under `reduce`
   * regardless of altitude. That puts a SECOND difference between the full and reduced
   * contexts at stage 2 (measured: 30 -> 11 calls, a diff of 19, not 17), which is exactly
   * what this test exists to rule out -- a second submission hiding inside what should be
   * only the composer's share. Stage 3 sits at 110 ft, under the band's 400 ft floor, so
   * `progress` is 1 and the sweep is gone in both contexts alike; campus.spec.ts's own note
   * that "stage 3 reads identically to stage 2" for the campus's own geometry still holds
   * (both read 11 calls / 16,888 tris under reduced motion, measured), so this substitution
   * changes nothing about which row it stands in for.
   */
  const viewport = { width: 1280, height: 720 };

  const full = await browser.newContext({ viewport });
  const fullPage = await full.newPage();
  const cut = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const cutPage = await cut.newPage();

  const report: string[] = [];
  try {
    for (const stage of [3, 5]) {
      await openAt(fullPage, stage);
      await openAt(cutPage, stage);
      const a = await settled(fullPage, `stage ${stage} full motion`);
      const b = await settled(cutPage, `stage ${stage} reduced motion`);
      report.push(`stage ${stage}: ${a.calls} -> ${b.calls} calls, ${a.triangles} -> ${b.triangles} tris`);
      expect(
        a.calls - b.calls,
        `the composer's share of stage ${stage} moved: ${report.join(" | ")}`,
      ).toBe(COMPOSER_PASSES);
      // And the passes are fullscreen triangles, one apiece, which is the other half of
      // the claim: if the difference were geometry rather than passes the triangle delta
      // would not equal the call delta.
      expect(
        a.triangles - b.triangles,
        `the composer's passes stopped being one triangle each: ${report.join(" | ")}`,
      ).toBe(COMPOSER_PASSES);
    }
    console.log(report.join("\n"));
  } finally {
    await full.close();
    await cut.close();
  }
});

test("the perf probe is publishing a live frame, not a healthy-looking dead one", async ({
  page,
}) => {
  /**
   * Perf.tsx's header records the trap this guards: an earlier version read the stats at
   * `useFrame` priority 1, which hands rendering to the caller and switched the render loop
   * off -- and the probe went on reporting a cheerful 8.3 ms with zero draw calls while the
   * canvas was blank. Every other perf assertion in this suite reads window.__perf, so if
   * the probe can be alive-looking and wrong then all of them can pass against nothing.
   *
   * This is also the only test in the repo that asserts anything about frame time, and what
   * it asserts is only that the field is POPULATED. The value is recorded below and not
   * gated, per the rule at the top of this file.
   */
  await openAt(page, 5);
  // Extra settle time, P10: stage 5 now compiles more materials on first mount
  // (hardware, plaster's tooth, sash joinery among them) and builds a one-time
  // PMREM environment map, both real but one-time costs concentrated in the
  // first few frames after navigation -- openAt's shared 2,400 ms is tuned for
  // every other caller in this file and is not widened here, but this specific
  // assertion (a frame count over a real-time window) needs the ring to have
  // actually filled, not just for the app to be present.
  await page.waitForTimeout(1500);
  const p = await perf(page);
  // Before the log line, which would otherwise throw on the field access and report a
  // TypeError instead of the reason. Verified by removing <Perf /> from Experience.tsx.
  expect(p, "window.__perf is absent: is <Perf /> still mounted?").toBeTruthy();
  console.log(
    `stage 5: ${p.calls} calls, ${p.triangles} tris, ${p.geometries} geometries, ` +
      `${p.casters} casters, median ${p.medianMs} ms over ${p.frames} frames (SwiftShader -- ` +
      `see the record at the bottom of this file for the real-hardware figure)`,
  );

  expect(p.calls, "the probe reports a frame with no draw calls in it").toBeGreaterThan(0);
  expect(p.triangles, "the probe reports a frame with no geometry in it").toBeGreaterThan(0);
  /**
   * Perf.tsx pushes one sample per frame into a 120-deep ring, so a ring with several
   * samples in it is a loop that turned over -- which is the claim, and it is why the bound
   * is nowhere near the observed value. This was written as >= 30 and FAILED at 29 in the
   * first four-spec run: 33 frames when this file runs alone against SwiftShader's 116 ms
   * median, 29 when three other specs are competing for the same software rasteriser. So the
   * tight version of this assertion measures machine load and the loose one measures the
   * loop. Ten, which the broken-probe case cannot reach and contention cannot fall to.
   */
  expect(p.frames, "the frame ring is not filling: is the render loop turning over?").toBeGreaterThanOrEqual(10);
  expect(p.medianMs, "frame time is not being recorded at all").not.toBeNull();
  // The shadow pass, because draw calls cannot see it: turning every caster off LOWERS the
  // count, which a budget assertion reads as an improvement. Perf.tsx's header makes the
  // same point about why these two fields exist.
  expect(p.shadows, "the shadow map is off").toBe(true);
  expect(p.casters, "the suite lost its shadow casters").toBeGreaterThanOrEqual(9);
});

/**
 * THE REAL-HARDWARE FRAME TIME, recorded and not gated. 31 July 2026.
 *
 * Machine: Apple M5 Pro, 20-core GPU, 48 GB, macOS 26.5.2. Browser: Google Chrome
 * 150.0.7871.187, headed, driven by Playwright's `channel: "chrome"` against `next start`
 * on a production build -- not the dev server, and not this suite's headless Chromium.
 * Renderer, read from WEBGL_debug_renderer_info rather than assumed:
 * "ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)", WebGL 2.0.
 *
 * Two probes at each sample point: window.__perf.medianMs, which Perf.tsx already
 * publishes, and a requestAnimationFrame interval series for the p95 that __perf does not
 * carry. Their medians agreed to within 0.2 ms everywhere, which is what makes the second
 * one trustworthy rather than an invented number.
 *
 * At DPR 2, which is what this display actually gives the app (`dpr={[1, 2]}` in
 * Experience.tsx), vsync off so the figure is the renderer's cost and not the panel's:
 *
 *   stage 0   median 2.6 ms   p95 3.1 ms      stage 3 cutaways   2.5 ms   3.6-3.7 ms
 *   stage 1   median 2.7 ms   p95 3.2 ms      stage 5 idle       2.7 ms   3.8 ms
 *   stage 2   median 2.5 ms   p95 3.7 ms      stage 5 walking    2.8 ms   4.0 ms
 *   stage 3   median 2.6 ms   p95 3.8 ms      stage 5 turning    2.6 ms   3.6 ms
 *   stage 4   median 2.6 ms   p95 2.9 ms      stage 0 revisited  2.6 ms   3.0 ms
 *
 * At DPR 1 the same run reads 1.1-2.2 ms median and 2.9-4.1 ms p95. So the whole app fits
 * in a 16.7 ms budget four times over at 60 fps and twice over at 120, and the prediction
 * in Perf.tsx's header -- "roughly 1-3 ms on a real GPU" -- was right.
 *
 * WITH VSYNC ON the same runs read a flat 33.3 ms median and 30.0 fps at every single
 * sample point, stage 4's 433 triangles included. A number identical across a 40-fold
 * range of scene load is a cap and not a cost, so it is recorded here as the cap it is and
 * the uncapped figures above are the app's.
 */
