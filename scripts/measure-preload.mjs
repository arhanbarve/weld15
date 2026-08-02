/**
 * P13 step 0 (docs/phases/P13-PRELOAD.md section 5): what does a full descent preload
 * actually cost, in resident bytes and wall-clock, on a real Google Photorealistic 3D
 * Tiles session? Nothing about the retention byte cap Preload.tsx sets in its
 * "finalizing" phase is designed ahead of this number -- it reads window.__preload.
 * cachedBytes at `done` and uses that, so this script's job is just to drive one real
 * page load to completion and print what happened.
 *
 * Requires a real NEXT_PUBLIC_GOOGLE_MAPS_KEY on the dev server this points at, and
 * costs the full descent's worth of tile requests (~2,400, see the phase doc's own
 * quota discussion) -- this is the expensive, deliberate run, not a cheap check.
 *
 * Usage: node scripts/measure-preload.mjs [http://localhost:3022]
 */
import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

page.on("console", (m) => {
  if (m.type() === "error") console.log("[console error]", m.text());
});
page.on("pageerror", (e) => console.log("[page error]", e.message));

const t0 = Date.now();
await page.goto(url);
await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });

const readPreload = () =>
  page.evaluate(() => (window).__preload);
const readTiles = () =>
  page.evaluate(() => (window).__tiles);

let last = null;
// Up to BATCH_TIMEOUT_MS (Preload.tsx) per batch, 7 batches, plus real margin -- NOT
// "a solid minute or two" any more: the first run at this file's own hand measured every
// batch timing out at 20s instead of settling, which is exactly the bug the timeout raise
// exists to fix. A short deadline here would only re-hide the same defect.
const deadline = Date.now() + 700_000;
while (Date.now() < deadline) {
  const p = await readPreload();
  if (!p) {
    await page.waitForTimeout(500);
    continue;
  }
  const key = `${p.phase}:${p.batch}`;
  if (!last || last.key !== key) {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const t = await readTiles();
    const s = t?.stats;
    console.log(
      `+${elapsed}s  phase=${p.phase} batch=${p.batch}/${p.totalBatches} ` +
        `progress=${(p.progress * 100).toFixed(1)}% tilesLoaded=${p.tilesLoaded} ` +
        `cachedBytes=${p.cachedBytes ?? "?"} ` +
        `queued=${s?.queued ?? "?"} downloading=${s?.downloading ?? "?"} parsing=${s?.parsing ?? "?"}`,
    );
    last = { key, probe: p };
  }
  if (p.done) break;
  await page.waitForTimeout(500);
}

const final = await readPreload();
const tiles = await readTiles();
const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log("\n=== P13 step 0 measurement ===");
console.log(`wall clock to done: ${totalElapsed}s`);
console.log(`final probe:`, JSON.stringify(final, null, 2));
console.log(`window.__tiles at done:`, JSON.stringify(tiles, null, 2));
if (final?.cachedBytes != null) {
  console.log(`cachedBytes: ${(final.cachedBytes / 2 ** 30).toFixed(3)} GB`);
}
if (!final?.done) {
  console.log("WARNING: did not reach done within the deadline -- see the log above for where it stalled.");
}

await browser.close();
