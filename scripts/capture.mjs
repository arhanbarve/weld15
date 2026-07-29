// Capture a PNG of the running app. Headless Chromium renders reliably; a
// browser tab that is not frontmost throttles requestAnimationFrame and can
// composite a stale or empty frame, so screenshots for evidence come from here.
//
//   node scripts/capture.mjs [outPath] [url] [width] [height]

import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const out = process.argv[2] ?? "design/renders/app.png";
const url = process.argv[3] ?? "http://localhost:3000";
const w = Number(process.argv[4] ?? 1440);
const h = Number(process.argv[5] ?? 900);

await mkdir(dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
await page.goto(url);
await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
await page.waitForTimeout(1800); // damped controls settle
await page.screenshot({ path: out });
await browser.close();

console.log(`captured ${w}x${h} @2x -> ${out}`);
