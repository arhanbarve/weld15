/**
 * P13 step 4 (docs/phases/P13-PRELOAD.md): the load-bearing correctness claim of the whole
 * phase. A preloader that loads everything and then lets the LRU evict it on the very
 * first real scrub has fixed nothing -- so this drives one full u=0 -> 1 -> 0 sweep AFTER
 * Preload.tsx reaches `done`, and asserts `stats.loaded` never increases (no re-fetch) and
 * `stats.inCache` never decreases (no eviction) at any sampled point along the way.
 *
 * Requires a real NEXT_PUBLIC_GOOGLE_MAPS_KEY on the dev server this points at.
 *
 * Usage: node scripts/verify-retention.mjs [http://localhost:3022]
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:3000";
const STEPS = 40;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("[page error]", e.message));

const t0 = Date.now();
await page.goto(url);
await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });

const readPreload = () => page.evaluate(() => (window).__preload);
const readTiles = () => page.evaluate(() => (window).__tiles);

// Wait for the real preload to finish -- same deadline reasoning as measure-preload.mjs.
const deadline = Date.now() + 700_000;
while (Date.now() < deadline) {
  const p = await readPreload();
  if (p?.done) break;
  await page.waitForTimeout(1000);
}
const afterPreload = await readPreload();
if (!afterPreload?.done) {
  console.log("FAIL: preload never reached done within the deadline.");
  await browser.close();
  process.exit(1);
}
console.log(`preload done at +${((Date.now() - t0) / 1000).toFixed(1)}s, tilesLoaded=${afterPreload.tilesLoaded}`);

const before = (await readTiles()).stats;
console.log("stats before scrub:", JSON.stringify(before));

// Drive the master scrubber 0 -> 1 -> 0, sampling stats at every step, exactly the
// technique tests/e2e/journey-continuity.spec.ts's own sweep() uses.
const samples = await page.evaluate(
  async ({ steps }) => {
    const slider = document.querySelector('[data-testid="journey"]');
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const out = [];
    const sweepOnce = async (dir) => {
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const u = dir === "forward" ? frac : 1 - frac;
        setValue.call(slider, String(u));
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        const t = window.__tiles;
        out.push({ u, loaded: t.stats.loaded, inCache: t.stats.inCache, queued: t.stats.queued });
      }
    };
    await sweepOnce("forward");
    await sweepOnce("reverse");
    return out;
  },
  { steps: STEPS },
);

const after = (await readTiles()).stats;
console.log("stats after scrub:", JSON.stringify(after));

let maxLoaded = before.loaded;
let minInCache = before.inCache;
let refetchAt = null;
let evictAt = null;
for (const s of samples) {
  if (s.loaded > maxLoaded) {
    if (refetchAt === null) refetchAt = s;
    maxLoaded = s.loaded;
  }
  if (s.inCache < minInCache) {
    if (evictAt === null) evictAt = s;
    minInCache = s.inCache;
  }
}

console.log("\n=== P13 step 4: retention verification ===");
console.log(`loaded: ${before.loaded} -> max ${maxLoaded} -> ${after.loaded}`);
console.log(`inCache: ${before.inCache} -> min ${minInCache} -> ${after.inCache}`);
if (refetchAt) console.log(`RE-FETCH DETECTED at u=${refetchAt.u.toFixed(3)}: loaded jumped to ${refetchAt.loaded}`);
if (evictAt) console.log(`EVICTION DETECTED at u=${evictAt.u.toFixed(3)}: inCache dropped to ${evictAt.inCache}`);

const pass = !refetchAt && !evictAt;
console.log(pass ? "PASS: no re-fetch, no eviction across the full scrub." : "FAIL: see above.");

await browser.close();
process.exit(pass ? 0 : 1);
