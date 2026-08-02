import { test, expect, type Page } from "@playwright/test";

/**
 * P11 PHASE 5: draw-call budgets retired in favour of triangles, frame time and tile memory
 * (docs/phases/P11-PHOTOREAL.md phase 5, item 1).
 *
 * WHY DRAW CALLS STOP BEING THE GATE. Every number the old BUDGET table (P8's §9 rows,
 * re-measured through P9/P10) asserted was a call count for Globe/Campus/WeldExterior/Suite
 * -- components this phase's own do-not-touch list forbids editing, and which decision 2
 * (docs/phases/P11-PHOTOREAL.md) retires outright once the "switch" phase lands (Globe.tsx,
 * Ground.tsx, CampusMesh.tsx, campusGeometry.ts deleted, per that document's section 3.1).
 * That deletion has NOT happened yet -- Experience.tsx's own HAS_TILES_KEY comment records
 * that Globe/Ground/Campus stay mounted through this phase, alongside Tiles/FallbackGround,
 * as deliberate phase-1 wiring -- so a draw-call budget pinned to today's dual-mounted scene
 * would be re-measuring numbers that are about to become meaningless rather than gating
 * anything this phase actually changed. Triangles and frame time are stable across that
 * swap in a way call counts are not: a live tileset's own internal batching is 3d-tiles-
 * renderer's concern, not this app's, so asserting geometry volume and recording cost is the
 * gate that survives the switch. Tile memory (window.__tiles.stats) is the one figure that
 * is NEW to this phase and genuinely did not exist before Tiles.tsx did.
 *
 * FRAME TIME STAYS RECORDED, NEVER GATED, unchanged from every prior phase's rule: headless
 * Chromium runs SwiftShader in software, at roughly 25x the cost of the real hardware this
 * file's own bottom section records (Apple M5 Pro, headed Chrome, ANGLE Metal: 2.5-2.8 ms
 * median at every stage, DPR 2, against 46-79 ms measured here keyless on this build). A
 * frame-time assertion in this environment would be measuring the test runner's own
 * contention, not the app.
 */

type Perf = {
  calls: number;
  triangles: number;
  lines: number;
  geometries: number;
  textures?: number;
  shadows: boolean;
  casters: number;
  frames: number;
  medianMs: number | null;
};

const perf = (page: Page): Promise<Perf> =>
  page.evaluate(() => (window as unknown as { __perf: Perf }).__perf);

/**
 * `__perf`, once it has stopped changing. Unchanged from the pre-P11 version of this file --
 * see its own long-standing rationale: a fixed-time wait can sample a frame that has not
 * actually rendered (`triangles: 1`), which no bound, tight or loose, should be asked to
 * tolerate.
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
  await page.waitForTimeout(2400);
}

/**
 * Per-stage triangle bounds, MEASURED KEYLESS ON THIS BUILD rather than carried over from
 * §9. `NEXT_PUBLIC_GOOGLE_MAPS_KEY= npx playwright test tests/e2e/perf.spec.ts`, 1280x720,
 * settled __perf, one run:
 *
 *   stage   calls   triangles   frame time (median ms)
 *   0        21      12,465     46.1
 *   1        23      32,257     46.6
 *   2        29      33,011     62.0
 *   3        29      33,011     66.2
 *   4        29      33,011     67.1
 *   5        46      10,061     67.3
 *
 * Stages 1-4 read identically because the current build keeps the SAME dual-mounted world
 * (Ground + Campus + FallbackGround, no key) through all of them -- `visibility()`'s own
 * `tiles: stage <= 4` (stages.ts) mounts the same geometry across that whole range; only the
 * camera moves. Floors are half the measured minimum per group (the same margin convention
 * §9 and this file's own predecessor both used) and ceilings are generous headroom, not a
 * tight budget -- see this file's header for why a tight call-count budget is not this
 * phase's gate.
 *
 * THIS IS NOT §9'S TABLE, AND IT WILL MOVE AGAIN. Once the "switch" phase (out of scope
 * here, per this phase's do-not-touch list) deletes Globe/Ground/CampusMesh in favour of
 * Tiles alone, these figures describe a scene that no longer exists. Recorded as a
 * checkpoint of what this build draws today, not as a permanent architectural budget.
 */
const TRIANGLE_BUDGET: { stage: number; floor: number; ceiling: number; measured: number }[] = [
  { stage: 0, floor: 5_000, ceiling: 80_000, measured: 12_465 },
  { stage: 1, floor: 15_000, ceiling: 150_000, measured: 32_257 },
  { stage: 2, floor: 15_000, ceiling: 150_000, measured: 33_011 },
  { stage: 3, floor: 15_000, ceiling: 150_000, measured: 33_011 },
  { stage: 4, floor: 15_000, ceiling: 150_000, measured: 33_011 },
  { stage: 5, floor: 4_000, ceiling: 80_000, measured: 10_061 },
];

test("triangles stay in a sane range at every stage, and frame time is recorded", async ({ page }) => {
  const report: string[] = [];
  for (const b of TRIANGLE_BUDGET) {
    await openAt(page, b.stage);
    const p = await settled(page, `stage ${b.stage}`);
    report.push(`stage ${b.stage}: ${p.triangles} tris, ${p.calls} calls, ${p.medianMs}ms`);
    expect(
      p.triangles,
      `stage ${b.stage} lost its geometry (was ${b.measured}): ${report.join(" | ")}`,
    ).toBeGreaterThanOrEqual(b.floor);
    expect(
      p.triangles,
      `stage ${b.stage} triangle count exploded (was ${b.measured}): ${report.join(" | ")}`,
    ).toBeLessThanOrEqual(b.ceiling);
    // Non-vacuity: a frame that draws nothing satisfies any floor/ceiling pair.
    expect(p.calls, `stage ${b.stage} drew nothing at all: ${report.join(" | ")}`).toBeGreaterThan(0);
  }
  console.log(report.join("\n"));
});

/**
 * Folded forward from campus.spec.ts (deleted this phase): bloom is dropped under reduced
 * motion. Not campus-specific in substance -- Effects.tsx's own composer is what this reads
 * -- so it survives the retirement of the file it used to live in.
 */
test("bloom is dropped under reduced motion", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await openAt(page, 2);
  const p = await settled(page, "stage 2, reduced motion");
  console.log(`reduced motion: ${p.calls} calls, ${p.triangles} tris`);
  expect(p.calls, "bloom still running under reduced motion").toBeLessThan(20);
  expect(p.triangles).toBeGreaterThan(10_000);
  await ctx.close();
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
   */
  await openAt(page, 5);
  await page.waitForTimeout(1500);
  const p = await perf(page);
  expect(p, "window.__perf is absent: is <Perf /> still mounted?").toBeTruthy();
  console.log(
    `stage 5: ${p.calls} calls, ${p.triangles} tris, ${p.geometries} geometries, ` +
      `${p.casters} casters, median ${p.medianMs} ms over ${p.frames} frames (SwiftShader -- ` +
      `see the record at the bottom of this file for the real-hardware figure)`,
  );

  expect(p.calls, "the probe reports a frame with no draw calls in it").toBeGreaterThan(0);
  expect(p.triangles, "the probe reports a frame with no geometry in it").toBeGreaterThan(0);
  expect(p.frames, "the frame ring is not filling: is the render loop turning over?").toBeGreaterThanOrEqual(10);
  expect(p.medianMs, "frame time is not being recorded at all").not.toBeNull();
  expect(p.shadows, "the shadow map is off").toBe(true);
  expect(p.casters, "the suite lost its shadow casters").toBeGreaterThanOrEqual(9);
});

/**
 * TILE MEMORY, KEYED ONLY. `window.__tiles` (Tiles.tsx) does not exist at all in the
 * keyless build this file's other tests run against -- FallbackGround mounts instead, per
 * Experience.tsx's HAS_TILES_KEY -- so there is nothing to gate here without a live
 * NEXT_PUBLIC_GOOGLE_MAPS_KEY. Skipped by default to protect the P11 session budget
 * (docs/phases/P11-PHOTOREAL.md §6a: "Keyless by default, everywhere... A key is set only
 * for the specific screenshot or measurement that needs one").
 *
 * THE ROOT-TILESET-REQUEST AND SETTLE-TIME GATES LIVE IN descent.spec.ts, NOT HERE -- they
 * are a property of the tileset's construction and its load lifecycle (docs/phases/
 * P11-PHOTOREAL.md's own new-gates list, phase 5 item 4), where this test's claim is about
 * the cache's steady-state size. Each is its own opt-in test and each costs one page load
 * -- one billable root tileset request -- when explicitly run keyed; §6a's "one page load
 * per capture, batched" governs interactive measurement sessions taken while building a
 * phase (this file's own header measurements above were taken that way), not the number of
 * permanent, individually-skippable CI gates a finished phase leaves behind.
 *
 * MEASURED, ONE SESSION, THIS BUILD, real key, 2026-08-01 (see descent.spec.ts for its own
 * separate session log): `inCache` reached 2,434 tiles after a continuous 0->1 journey scrub, well
 * under the `lruCache` item ceiling `minSize`/`maxSize` of 6,000/8,000 (Tiles.tsx's own
 * `load-root-tileset` comment) and nowhere near the 1 GB `maxBytesSize` this build sets --
 * `stats` carries no byte count of its own (TilesRendererBase exposes counts, not bytes), so
 * an item-count ceiling is the gate this probe can actually support.
 */
const HAS_KEY = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY);

test("tile cache stays under its configured item ceiling", async ({ page }) => {
  test.skip(
    !HAS_KEY,
    "keyed-only -- set NEXT_PUBLIC_GOOGLE_MAPS_KEY on the process running Playwright to " +
      "exercise this gate; skipped by default per docs/phases/P11-PHOTOREAL.md §6a.",
  );
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);

  type TilesProbe = { stats: { inCache: number } | null };
  const tiles = () => page.evaluate(() => (window as unknown as { __tiles?: TilesProbe }).__tiles);

  for (const stage of [1, 2, 3]) {
    await page.getByTestId(`stage-${stage}`).click();
    await page.waitForTimeout(1500);
    const t = await tiles();
    console.log(`stage ${stage}: inCache ${t?.stats?.inCache}`);
    // 8,000 is the lruCache `maxSize` item ceiling Tiles.tsx's own load-root-tileset
    // handler sets; well above anything the schedule below reaches, so this fails only
    // on a genuine leak (a cache that never evicts) rather than on normal fluctuation.
    expect(t?.stats?.inCache ?? 0, `stage ${stage} tile cache over its item ceiling`).toBeLessThan(
      8_000,
    );
  }
});

/**
 * THE REAL-HARDWARE FRAME TIME, recorded and not gated. 31 July 2026 (P8; unchanged by this
 * phase -- the interior scene this figure was taken against is untouched).
 *
 * Machine: Apple M5 Pro, 20-core GPU, 48 GB, macOS 26.5.2. Browser: Google Chrome
 * 150.0.7871.187, headed, driven by Playwright's `channel: "chrome"` against `next start`
 * on a production build -- not the dev server, and not this suite's headless Chromium.
 * Renderer, read from WEBGL_debug_renderer_info rather than assumed:
 * "ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)", WebGL 2.0.
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
 * in a 16.7 ms budget four times over at 60 fps and twice over at 120.
 *
 * WITH VSYNC ON the same runs read a flat 33.3 ms median and 30.0 fps at every single
 * sample point. A number identical across a 40-fold range of scene load is a cap and not a
 * cost, so it is recorded here as the cap it is and the uncapped figures above are the
 * app's.
 *
 * NOT RE-MEASURED FOR P11: this figure is about the interior/exterior scene (stages 2-5),
 * which this phase's do-not-touch list keeps untouched. The keyless triangle table above
 * this comment is the P11-specific measurement; this section is carried over rather than
 * re-taken, since re-measuring real hardware for geometry this phase did not change would
 * not answer anything the phase 4 tables (docs/phases/P11-PHOTOREAL.md §4.1) do not already
 * cover for the live-tiles path.
 */
