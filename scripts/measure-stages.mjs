// Measure every stage and several threshold values, so the e2e thresholds are
// set from data rather than guessed. P0 shipped two vacuous render assertions
// because their bounds were invented.
import { chromium } from "@playwright/test";

const stats = async (pg) =>
  pg.locator("canvas").evaluate((el) => {
    const off = document.createElement("canvas");
    off.width = el.width; off.height = el.height;
    const ctx = off.getContext("2d");
    ctx.drawImage(el, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    const N = 60; let lit = 0, nonBg = 0, total = 0; const seen = new Set();
    for (let gx = 0; gx < N; gx++) for (let gy = 0; gy < N; gy++) {
      const x = Math.floor((off.width * (gx + 0.5)) / N);
      const y = Math.floor((off.height * (gy + 0.5)) / N);
      const i = (y * off.width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      total++; seen.add(`${r},${g},${b}`);
      if (r + g + b > 300) lit++;
      if (Math.abs(r - 6) > 6 || Math.abs(g - 32) > 6 || Math.abs(b - 63) > 6) nonBg++;
    }
    return { lit: +(lit / total * 100).toFixed(1), nonBg: +(nonBg / total * 100).toFixed(1), distinct: seen.size };
  });

const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
await pg.goto("http://localhost:3000");
await pg.locator("canvas").waitFor({ state: "visible" });

for (const s of [0, 1, 2, 3, 4, 5]) {
  await pg.getByTestId(`stage-${s}`).click();
  await pg.waitForTimeout(1500);
  console.log(`stage ${s}`, JSON.stringify(await stats(pg)));
}
await pg.getByTestId("stage-4").click();
await pg.waitForTimeout(1400);
for (const t of [0, 0.2, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
  await pg.getByTestId("threshold-t").fill(String(t));
  await pg.waitForTimeout(600);
  console.log(`t=${t}`, JSON.stringify(await stats(pg)));
}
await b.close();
