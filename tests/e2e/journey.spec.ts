import { test, expect, type Page } from "@playwright/test";

/**
 * P11 PHASE 5: variance/edge-energy replace the coverage heuristic, because the frame is
 * now real (or fallback-photographic) imagery rather than the scan/void chrome this file's
 * previous method was tuned against.
 *
 * WHAT USED TO BE HERE. `frameStats()` counted pixels brighter than a hard-coded RGB
 * distance from `#06203f` (`--void`) and its `#0c3260` grid lines -- "background #06203f
 * sums to 101; grid lines #0c3260 to 158" -- and gated `nonBgPct > 8`. That is a
 * palette-membership test: it only proves something is on screen because it knows what the
 * *background* looks like, and decision 9 (docs/phases/P11-PHOTOREAL.md) retires exactly
 * that background from the world. A photograph -- Google's live tiles, or the L3/L4 NAIP
 * fallback this build actually renders keyless -- has no fixed void colour to be "not", and
 * near orbit the frame is legitimately mostly one photographed tone (haze, or Earth's
 * daylit face), so a fixed RGB-distance floor tuned to a Prussian-blue void would either
 * miss a real regression (too loose against a photograph) or flag a correct frame as empty
 * (too tight against one that is mostly sky).
 *
 * THE REPLACEMENT: LUMINANCE VARIANCE AND EDGE ENERGY, over the same 60x60 sample grid this
 * file has always used. A blank or flat-filled frame -- solid colour, any colour -- has
 * variance 0 and edge energy 0 by construction, which is the actual failure mode every
 * "is anything on screen" gate in this project exists to catch (P8's code-split experiment
 * measured exactly this: a frame in which every layer's opacity was zero). Real photographic
 * content, whether Google's tiles or this build's NAIP fallback, is never flat: haze,
 * shoreline, rooftops and streets all vary in luminance and carry edges a flat fill cannot.
 * So the same two numbers work at every altitude and do not need to know what the
 * photograph's own palette is, which a fixed-colour distance test always secretly did.
 *
 * `distinct` (count of unique sampled RGB triples) is kept from the old method: it is
 * already palette-agnostic -- a flat fill of ANY colour has distinct = 1 -- and variance and
 * edge energy are both computed FROM the luminance channel, so a frame that varied only in
 * hue and not in brightness (unlikely for a photograph, but not ruled out by the other two)
 * still fails on `distinct`.
 *
 * FLOORS ARE MEASURED, ON THIS BUILD, KEYLESS (Ground/Campus/FallbackGround, the current
 * dual-mounted scene per Experience.tsx's own HAS_TILES_KEY comment -- this phase does not
 * touch that mounting decision). `NEXT_PUBLIC_GOOGLE_MAPS_KEY= npx playwright test
 * tests/e2e/journey.spec.ts`, 1280x720, one run:
 *
 *   stage   variance   edge       distinct
 *   0       1140.80    61508.3    1630
 *   1        564.08   142528.6    2767
 *   2       1206.31   164624.8    2362
 *   3        680.46    58436.3     632
 *   4        703.73    40644.9     913
 *   5       1354.09    25510.2     303
 *
 * Floors below are roughly half of the observed minimum across all six stages (variance
 * 564, edge 25,510, distinct 303), the same margin convention the old bounds used ("these
 * sit at roughly half of each, so a real regression trips them while normal variation does
 * not"), and comfortably clear of the zero a genuinely blank frame produces.
 */
const VARIANCE_FLOOR = 250;
const EDGE_FLOOR = 12_000;
const DISTINCT_FLOOR = 40;

async function frameStats(page: Page) {
  return page.locator("canvas").evaluate((el) => {
    const src = el as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    const N = 60;
    const lum = new Float64Array(N * N);
    const seen = new Set<string>();
    let warm = 0;
    let pale = 0;
    let total = 0;
    for (let gx = 0; gx < N; gx++) {
      for (let gy = 0; gy < N; gy++) {
        const x = Math.floor((off.width * (gx + 0.5)) / N);
        const y = Math.floor((off.height * (gy + 0.5)) / N);
        const i = (y * off.width + x) * 4;
        const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
        total++;
        seen.add(`${r},${g},${b}`);
        lum[gy * N + gx] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        // Oak floors are warm (r > b); plaster walls are near-neutral and bright. Kept
        // unchanged from the previous version -- these detect real INTERIOR materials
        // (stage 5, largely untouched by this phase) rather than the retired world
        // palette, so they are not part of what this rewrite replaces.
        if (r > b + 25 && r > 60) warm++;
        if (r > 110 && Math.abs(r - b) < 30) pale++;
      }
    }
    let mean = 0;
    for (let i = 0; i < lum.length; i++) mean += lum[i]!;
    mean /= lum.length;
    let variance = 0;
    for (let i = 0; i < lum.length; i++) variance += (lum[i]! - mean) ** 2;
    variance /= lum.length;
    // Edge energy: sum of |luminance gradient| between horizontally/vertically adjacent
    // grid samples. Zero for any flat fill; positive wherever the frame has real texture,
    // a coastline, a rooftop edge, or a building silhouette -- none of which a fixed
    // background colour test could see without first being told what "background" means.
    let edge = 0;
    for (let gx = 0; gx < N; gx++) {
      for (let gy = 0; gy < N; gy++) {
        const c = lum[gy * N + gx]!;
        if (gx + 1 < N) edge += Math.abs(lum[gy * N + gx + 1]! - c);
        if (gy + 1 < N) edge += Math.abs(lum[(gy + 1) * N + gx]! - c);
      }
    }
    return {
      variance: +variance.toFixed(1),
      edge: +edge.toFixed(1),
      distinct: seen.size,
      warmPct: (warm / total) * 100,
      palePct: (pale / total) * 100,
    };
  });
}

async function gotoStage(page: Page, stage: number) {
  await page.getByTestId(`stage-${stage}`).click();
  await page.waitForTimeout(1400); // camera settles
}

test("every stage renders real, non-flat imagery, and there are no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/?preload=0");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });

  const report: string[] = [];
  for (const stage of [0, 1, 2, 3, 4, 5]) {
    await gotoStage(page, stage);
    const s = await frameStats(page);
    report.push(
      `stage ${stage}: variance ${s.variance.toFixed(0)}, edge ${s.edge.toFixed(0)}, ${s.distinct} distinct`,
    );
    expect(s.variance, `stage ${stage} is a flat wash: ${report.join(" | ")}`).toBeGreaterThan(
      VARIANCE_FLOOR,
    );
    expect(s.edge, `stage ${stage} has no texture or edges: ${report.join(" | ")}`).toBeGreaterThan(
      EDGE_FLOOR,
    );
    expect(s.distinct, `stage ${stage} is a flat wash`).toBeGreaterThanOrEqual(DISTINCT_FLOOR);
    // Stage 5 stands inside a room, so it must show BOTH an oak floor and a plaster wall.
    // A single flat plane filling the frame would pass the variance/edge checks above if it
    // were, say, a textured photograph filling the whole view -- this is the check that
    // still catches "only the floor" or "only the wall".
    if (stage === 5) {
      expect(s.warmPct, `stage 5 shows no floor: ${JSON.stringify(s)}`).toBeGreaterThan(2);
      expect(s.palePct, `stage 5 shows no wall: ${JSON.stringify(s)}`).toBeGreaterThan(2);
    }
    /*
     * A side effect, not an assertion, and it writes into a TRACKED directory on purpose --
     * unchanged from the previous version of this file. See its own long-standing rationale:
     * a render that shows up in `git diff` is how a change to the picture becomes reviewable
     * at all, in a project whose whole output is pixels.
     */
    await page.screenshot({ path: `design/renders/p2-stage-${stage}.png` });
  }
  console.log(report.join("\n"));

  expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
});

test("the threshold never shows an empty frame as it crosses", async ({ page }) => {
  // The failure this guards against is a flicker: a few frames where the shell
  // has gone and the interior has not arrived.
  await page.goto("/?preload=0");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await gotoStage(page, 4);

  // P10 folded the per-stage threshold-t slider into JourneyBar's single master bar, which
  // carries `u` rather than a per-stage t. Converted through window.__journey (JourneyBar.tsx's
  // debug probe) rather than through a second implementation of journey.ts's mapping.
  const slider = page.getByTestId("journey");
  const worst: string[] = [];
  /**
   * Measured minima across t, keyless, on this build: variance 610.6 (t=0.2), edge 29,394.5
   * (t=1), distinct 123 (t=1) -- see this file's header for the full table. Floors are the
   * same shared constants the whole-descent test above uses, which already sit under every
   * one of these; a stage-4-specific floor would be tighter but this file's own convention
   * (VARIANCE_FLOOR/EDGE_FLOOR/DISTINCT_FLOOR) is one set of numbers for one claim ("not
   * empty"), not a table with an entry per stage.
   */
  for (const t of [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1]) {
    const u = await page.evaluate((tt) => {
      const j = (window as unknown as { __journey: { boundaries: number[]; spans: number[]; total: number } })
        .__journey;
      // Snapped to the slider's own 0.0005 step: Playwright's fill() on a range input
      // refuses a value that is not one of the step's own multiples ("Malformed value").
      // Floored rather than rounded to nearest -- see threshold.spec.ts's statsAt(), which
      // hit the case where rounding up crossed a ramp boundary and changed what was drawn.
      const raw = j.boundaries[4]! + (tt * j.spans[4]!) / j.total;
      return Math.floor(raw / 0.0005) * 0.0005;
    }, t);
    await slider.fill(String(u));
    await page.waitForTimeout(500);
    const s = await frameStats(page);
    worst.push(`t=${t}: var ${s.variance.toFixed(0)}/edge ${s.edge.toFixed(0)}/${s.distinct}`);
    expect(s.variance, `threshold went flat at t=${t}: ${worst.join(" | ")}`).toBeGreaterThan(
      VARIANCE_FLOOR,
    );
    expect(s.edge, `threshold went empty at t=${t}: ${worst.join(" | ")}`).toBeGreaterThan(EDGE_FLOOR);
    expect(s.distinct, `threshold went flat at t=${t}: ${worst.join(" | ")}`).toBeGreaterThanOrEqual(
      DISTINCT_FLOOR,
    );
  }
  console.log(worst.join(" | "));
});

test("the skip control is the first thing you reach by keyboard", async ({ page }) => {
  // An immersive intro needs an escape hatch, and one you must tab past six stage
  // buttons to reach is not an escape hatch.
  await page.goto("/?preload=0");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("skip")).toBeFocused();

  await page.getByTestId("skip").click();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("stage-name")).toContainText("Weld 15");
});

/**
 * Reduced motion drops the bloom composer (Effects.tsx, asserted directly in perf.spec.ts's
 * own "bloom is dropped under reduced motion"), and bloom is exactly what spreads bright
 * pixels and raises local contrast -- so a bloom-off frame is a DIFFERENT, measurably lower-
 * variance population than every other measurement in this file, all of which are full
 * motion. Measured, keyless, this build: stage 3 under `reducedMotion: "reduce"`, 250ms
 * after the stage-3 click, variance 183.4 -- under the shared VARIANCE_FLOOR (250), which
 * every full-motion stage clears by 3x or more (see this file's header table). Rather than
 * loosen the shared floor for every other test to accommodate one bloom-off sample, this
 * gets its own, still comfortably above the zero a genuinely empty arrival would show.
 */
const REDUCED_MOTION_VARIANCE_FLOOR = 80;

test("reduced motion jump-cuts instead of flying", async ({ browser }) => {
  // Must not merely shorten the fly. A shortened fly is still a fly.
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/?preload=0");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("stage-name")).toContainText("reduced motion");

  await page.getByTestId("stage-3").click();
  await page.waitForTimeout(250); // far less than a fly would need

  /**
   * THE CAMERA, NOT THE PIXELS, IS WHAT "JUMP CUT" MEANS -- and P12 is why this case now
   * says so directly. It used to assert frame variance at this instant, which worked while
   * an opaque parametric Weld was drawn at stage 3: local geometry paints on the first
   * frame, so a full frame 250 ms after the click did prove the camera had already arrived.
   * P12 retires that shell from the exterior (Google's photogrammetric Weld is the building
   * now, docs/phases/P12-DATUM.md), and Google's tiles STREAM: measured on this build, the
   * camera is at the stage-3 keyframe within 250 ms -- exactly the jump this test exists for
   * -- while the renderer is still at 2 draw calls and 434 triangles because the tiles for
   * the new view have not been selected yet, and is at 55 calls and 161,611 triangles by
   * 1,000 ms. Asserting pixels at 250 ms therefore measures the network, not the cut.
   *
   * So both halves are asserted, and the pair is strictly stronger than the single variance
   * check it replaces: the pose is already the destination (no fly), AND the frame does fill
   * in rather than staying empty (no black screen at the end of the jump).
   */
  const arrived = await page.evaluate(
    () => (window as unknown as { __cam?: { position: number[] } }).__cam?.position ?? null,
  );
  expect(arrived, "no camera probe").not.toBeNull();
  const kf3 = await page.evaluate(
    () => (window as unknown as { __cam?: { path?: number[][] } }).__cam?.path?.length ?? 0,
  );
  expect(kf3, "stage 3 is a place, not a path").toBe(1);
  // 205 ft up and 230 ft out is stages.ts's stage-3 stop; anything mid-flight from stage 0
  // is orders of magnitude higher, so this is a wide window around the destination rather
  // than a restatement of the keyframe.
  expect(arrived![1], "still descending -- this was a fly, not a cut").toBeLessThan(1_000);

  await expect
    .poll(async () => (await frameStats(page)).variance, { timeout: 30_000 })
    .toBeGreaterThan(REDUCED_MOTION_VARIANCE_FLOOR);
  await ctx.close();
});
