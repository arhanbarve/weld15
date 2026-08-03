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
type PreloadProbe = {
  phase: string;
  batch: number;
  totalBatches: number;
  done: boolean;
  unlockable: boolean;
  tilesLoaded: number;
};

const tilesOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tiles?: TilesProbe }).__tiles);
const preloadOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __preload?: PreloadProbe }).__preload);

/**
 * Measured ceiling with real margin: the step 0 sessions (28 and 56 poses, 1 GB lruCache
 * cap) settled in 228-249s, against which 300s carried comfortable headroom.
 *
 * RAISED, THEN LOWERED AGAIN, ACROSS THIS TASK'S OWN HISTORY. The 1 GB loading-phase cap
 * was already smaller than what the descent settled at (~1.07 GB), evicting from the
 * moment it filled -- a stage jump straight after a "done" preload queued 538 fresh tile
 * downloads. 1.5 GB fixed a straight stage-N jump but not a real user scrubbing through
 * Harvard Square's dense building cluster, which still showed shattered geometry; 4 GB is
 * the smallest cap that produced a clean, fully-resolved frame there. That bigger cap alone
 * pushed total preload time to 510-515s (the deadline was raised to 700s to match).
 *
 * THEN THE ACTUAL BOTTLENECK GOT FIXED, NOT JUST WORKED AROUND. Two changes, same task:
 * `tiles.parseQueue.maxJobs` 16 -> 64 (Tiles.tsx's own comment carries the live-instrumented
 * measurement: parsing was never CPU-bound, it was queue-depth-bound, waiting on
 * `createImageBitmap` round trips that were already off-thread), and `Preload.tsx` hiding
 * `tiles.group` for the blocking span nobody can see anyway (Preloader.tsx's overlay is up
 * the whole time) -- `TilesRenderer` draws the union of every registered camera's selection
 * every frame regardless of visibility, so several thousand `drawElements` calls a frame
 * were competing with `parseQueue` for the same main thread. Both together: a clean isolated
 * run went from 510-515s to 235.8s, and this very gate (preload plus the full scrub below)
 * dropped from 9.4-9.7 minutes to 4.9. 400s restores real margin over that new, faster
 * baseline rather than leaving 700s of slack that would hide a real regression, short of
 * "never" if a batch's idle-frame check stops firing (docs/phases/P13-PRELOAD.md's
 * BATCH_TIMEOUT_MS comment already found that failure mode once).
 */
const PRELOAD_DEADLINE_MS = 400_000;

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
  // Poll indices (this loop's own tick count), not wall-clock ms: two fast transitions
  // landing inside the same 1s poll window would otherwise be a false tie either way, so a
  // tick number is the more honest unit for "which poll first saw this true" than a
  // millisecond timestamp neither transition is actually synchronized to.
  let tick = 0;
  let unlockableTick: number | null = null;
  let doneTick: number | null = null;
  while (Date.now() < deadline) {
    p = await preloadOf(page);
    if (p?.unlockable && unlockableTick === null) unlockableTick = tick;
    if (p?.done) {
      doneTick = tick;
      break;
    }
    tick += 1;
    await page.waitForTimeout(1000);
  }
  expect(p?.done, `preload never reached done within ${PRELOAD_DEADLINE_MS / 1000}s`).toBe(true);

  /**
   * Progressive unlock (this task; see Preload.tsx's own `UNLOCK_AFTER_BATCH` comment):
   * Preloader.tsx's blocking overlay is meant to gate on `unlockable`, not `done` -- the app
   * should become interactive once batch `UNLOCK_AFTER_BATCH` (currently 5, one short of the
   * last batch this descent produces) settles, while that last batch and `finalizing` keep
   * running silently in the background (LoadingBar.tsx's own `shouldShow` picks that
   * remainder up, gated on `unlockable` the same way -- see that file's comment above the
   * `subscribePreload` call). `unlockableTick`/`doneTick` are the first poll indices above
   * that observed each flag true; `unlockable` is asserted monotone the same as `done`
   * (Preload.tsx's own `PreloadProbe.unlockable` comment), so the first poll to see it true
   * is a real lower bound on when it actually flipped, not an artifact of polling order.
   *
   * WHAT A FAILURE HERE WOULD ACTUALLY MEAN, NOT JUST THAT IT FAILED:
   *  - `unlockableTick` staying `null` (never observed true at all) means
   *    `window.__preload.unlockable` never flips during a real run -- either the field isn't
   *    being published at all, or `UNLOCK_AFTER_BATCH` has drifted to equal or exceed
   *    `TOTAL_BATCHES - 1`, the exact invariant tests/preload.test.ts's own unit coverage
   *    checks directly (`UNLOCK_AFTER_BATCH` must leave a batch strictly before the last to
   *    publish `unlockable: true` during "loading", or it can only ever coincide with `done`).
   *  - `unlockableTick` landing at or after `doneTick` means batch 5 is NOT settling
   *    meaningfully earlier than the whole descent (batch 6 plus `finalizing`) finishing --
   *    i.e. batch 5 never settles before batch 7 does in practice, so the progressive-unlock
   *    gate is dead weight: Preloader.tsx is coded to release the viewer early but never
   *    actually does, and this descent-wide preload would still be gating the FULL wait it
   *    was built to shrink.
   */
  expect(unlockableTick, "window.__preload.unlockable never observed true before the deadline").not.toBeNull();
  expect(
    unlockableTick,
    `unlockable first observed true at poll #${unlockableTick} but done didn't flip until poll #${doneTick} -- ` +
      `expected unlockable strictly before done, proving progressive unlock actually unlocks early rather than ` +
      `just carrying a field that happens to also be true at the end`,
  ).toBeLessThan(doneTick!);

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
