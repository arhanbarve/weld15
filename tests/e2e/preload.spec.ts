import { test, expect, type Page } from "@playwright/test";

/**
 * P13 (docs/phases/P13-PRELOAD.md): the whole descent's tiles, registered as synthetic
 * cameras and settled before the app is reachable. KEYED ONLY -- `window.__preload`
 * (Preload.tsx) is a no-op probe (`done: true` immediately) without a live key, same
 * reasoning as descent.spec.ts and perf.spec.ts's own keyed-only gates.
 *
 * WHAT THIS DOES NOT ASSERT, AND WHY -- MEASURED, NOT ASSUMED. scripts/verify-retention.mjs's
 * own step 4 runs found a genuine, disclosed residual: a full u = 0 -> 1 -> 0 scrub along the
 * exact preloaded path still re-fetches roughly 13-15% more tiles than the preload itself
 * loaded (two independent sessions: 430/2906 and 393/3045). That is NOT a bug -- tile
 * selection is continuous with altitude and no finite discrete sampling of a continuous
 * journey can cover it exactly (doubling `preloadPlan.ts`'s N_POSES from 28 to 56 only moved
 * the residual from 14.8% to 12.9%, confirming density is not the dominant lever) -- so this
 * gate does NOT assert zero re-fetch. It asserts the residual stays BOUNDED, which is the
 * real regression this gate exists to catch: something that breaks retention entirely (the
 * `lruCache` byte cap never getting set, or getting set too low) would blow far past a small
 * bounded residual into re-fetching a large fraction of the whole descent again.
 *
 * WHAT IT DOES ASSERT AS AN ABSOLUTE, because both measured sessions held it exactly:
 * `inCache` never decreasing across the scrub. That is the actual promise of Preload.tsx's
 * finalizing step (raising `minBytesSize`/`maxBytesSize` from the measured `cachedBytes`) --
 * a tile that made it into the preloaded set is never evicted, which is the guarantee that
 * makes returning to an earlier point in the descent free.
 */
const HAS_KEY = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY);

type TilesProbe = {
  constructions: number;
  rootRequests: number;
  stats: { loaded: number; inCache: number } | null;
};
type PreloadProbe = { phase: string; batch: number; totalBatches: number; done: boolean; tilesLoaded: number };

const tilesOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tiles?: TilesProbe }).__tiles);
const preloadOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __preload?: PreloadProbe }).__preload);

/**
 * Measured ceiling with real margin: the step 0 sessions (28 and 56 poses, 1 GB lruCache
 * cap) settled in 228-249s, against which 300s carried comfortable headroom.
 *
 * RAISED TWICE FOR THE lruCache CAP FIX (this task; see Tiles.tsx's own `onRootTileset`
 * comment for the full history). The 1 GB loading-phase cap was already smaller than what
 * the descent settled at (~1.07 GB), so it was evicting from the moment it filled -- a
 * stage jump straight after a "done" preload queued 538 fresh tile downloads. Raising the
 * cap to 1.5 GB fixed a straight stage-N jump but NOT a real user scrubbing continuously
 * through Harvard Square's dense building cluster, which still showed visibly shattered
 * geometry -- parent tiles standing in for children that never finished resident. 4 GB is
 * the smallest cap that produced a clean, fully-resolved frame there (confirmed by
 * screenshot). A bigger cap that evicts less also lets more content accumulate before a
 * batch goes idle, so the preload itself legitimately takes longer -- measured at 510-515s
 * across repeated isolated runs at 4 GB (vs. the 228-249s baseline at 1 GB). 700s keeps
 * comfortable margin over that new baseline, short of "never" if a real regression (e.g. a
 * batch's idle-frame check never firing) reintroduces the timeout-every-batch bug this
 * phase's own history already found once (docs/phases/P13-PRELOAD.md's BATCH_TIMEOUT_MS
 * comment).
 */
const PRELOAD_DEADLINE_MS = 700_000;

test.setTimeout(PRELOAD_DEADLINE_MS + 60_000);

test("the whole descent preloads, settles, and never evicts on a full scrub", async ({ page }) => {
  test.skip(
    !HAS_KEY,
    "keyed-only -- set NEXT_PUBLIC_GOOGLE_MAPS_KEY on the process running Playwright to " +
      "exercise this gate; costs the full descent's tile requests every run, so it is opt-in " +
      "like descent.spec.ts and perf.spec.ts's own keyed gates.",
  );

  await page.goto("/"); // NOT ?preload=0 -- this gate is about the preloader itself.
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });

  const deadline = Date.now() + PRELOAD_DEADLINE_MS;
  let p: PreloadProbe | undefined;
  while (Date.now() < deadline) {
    p = await preloadOf(page);
    if (p?.done) break;
    await page.waitForTimeout(1000);
  }
  expect(p?.done, `preload never reached done within ${PRELOAD_DEADLINE_MS / 1000}s`).toBe(true);

  const afterPreload = await tilesOf(page);
  expect(afterPreload?.constructions, "more than one TilesRendererImpl constructed").toBe(1);
  expect(afterPreload?.rootRequests, "more than one root tileset request").toBe(1);
  const preloadedCount = afterPreload!.stats!.loaded;
  expect(preloadedCount, "preload reported done with zero tiles loaded -- suspicious").toBeGreaterThan(0);

  // Full descent scrub, same technique as journey-continuity.spec.ts's own sweep(): the
  // native setter, not a plain assignment, or React's value tracker sees no change and the
  // slider's handler never runs.
  const STEPS = 40;
  await page.evaluate(async (steps) => {
    const slider = document.querySelector('[data-testid="journey"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (const dir of ["forward", "reverse"] as const) {
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const u = dir === "forward" ? frac : 1 - frac;
        setValue.call(slider, String(u));
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
      }
    }
  }, STEPS);

  const afterScrub = await tilesOf(page);
  expect(afterScrub?.rootRequests, "the scrub triggered a second root tileset request").toBe(1);

  const inCacheAfter = afterScrub!.stats!.inCache;
  expect(
    inCacheAfter,
    `inCache dropped from ${preloadedCount} to ${inCacheAfter} -- the retention cap evicted a preloaded tile`,
  ).toBeGreaterThanOrEqual(preloadedCount);

  // Bounded, not zero -- see this file's own header. 50% is generous headroom above the
  // 13-15% measured residual: a real break in retention (the byte cap never applied, or
  // applied far too low) would blow well past this, while the expected small residual will
  // not.
  const loadedAfter = afterScrub!.stats!.loaded;
  const growth = (loadedAfter - preloadedCount) / preloadedCount;
  expect(
    growth,
    `re-fetch grew loaded tiles by ${(growth * 100).toFixed(1)}% (${preloadedCount} -> ${loadedAfter}) -- ` +
      `past the 50% bound this gate allows for the known, disclosed residual`,
  ).toBeLessThan(0.5);
});
