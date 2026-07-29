// Diagnostic: sample the WebGL drawing buffer and report what is on screen.
// Used to pick visual-assertion thresholds from measurement rather than guesswork.
// Reused by later phases as the basis for their visual gates.
//
//   node scripts/measure-render.mjs [url]

import { chromium } from "@playwright/test";

const url = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url);
await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
await page.waitForTimeout(1500);

const m = await page.locator("canvas").evaluate((el) => {
  const src = el;
  const off = document.createElement("canvas");
  off.width = src.width;
  off.height = src.height;
  const ctx = off.getContext("2d");
  ctx.drawImage(src, 0, 0);
  const { data } = ctx.getImageData(0, 0, off.width, off.height);

  const N = 60;
  let total = 0;
  let nonBg = 0;
  let bright = 0;
  const seen = new Set();
  const hist = { bg: 0, dim: 0, mid: 0, bright: 0 };

  for (let gx = 0; gx < N; gx++) {
    for (let gy = 0; gy < N; gy++) {
      const x = Math.floor((off.width * (gx + 0.5)) / N);
      const y = Math.floor((off.height * (gy + 0.5)) / N);
      const i = (y * off.width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const lum = r + g + b;
      total++;
      seen.add(`${r},${g},${b}`);
      const isBg = Math.abs(r - 6) < 6 && Math.abs(g - 32) < 6 && Math.abs(b - 63) < 6;
      if (!isBg) nonBg++;
      if (lum > 300) bright++;
      if (lum < 130) hist.bg++;
      else if (lum < 220) hist.dim++;
      else if (lum <= 300) hist.mid++;
      else hist.bright++;
    }
  }
  return {
    buffer: `${off.width}x${off.height}`,
    total,
    nonBgPct: +((nonBg / total) * 100).toFixed(1),
    brightPct: +((bright / total) * 100).toFixed(1),
    distinct: seen.size,
    hist,
  };
});

console.log(JSON.stringify(m, null, 2));
await browser.close();
