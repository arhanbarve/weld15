import { chromium } from "@playwright/test";
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
await pg.goto("http://localhost:3000");
await pg.locator("canvas").waitFor({ state: "visible" });
await pg.getByTestId("stage-5").click();
await pg.waitForTimeout(1600);
const s = await pg.locator("canvas").evaluate((el) => {
  const off = document.createElement("canvas");
  off.width = el.width; off.height = el.height;
  const c = off.getContext("2d"); c.drawImage(el, 0, 0);
  const { data } = c.getImageData(0, 0, off.width, off.height);
  const N = 60; let nonBg = 0, total = 0; const seen = new Set();
  for (let gx = 0; gx < N; gx++) for (let gy = 0; gy < N; gy++) {
    const x = Math.floor(off.width * (gx + .5) / N), y = Math.floor(off.height * (gy + .5) / N);
    const i = (y * off.width + x) * 4, r = data[i], g = data[i+1], bl = data[i+2];
    total++; seen.add(`${r},${g},${bl}`);
    if (Math.abs(r-6)>6 || Math.abs(g-32)>6 || Math.abs(bl-63)>6) nonBg++;
  }
  return { nonBg: +(nonBg/total*100).toFixed(1), distinct: seen.size };
});
console.log("stage5", JSON.stringify(s));
await b.close();
