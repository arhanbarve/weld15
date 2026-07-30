import { chromium } from "@playwright/test";
const [out, stage, t] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errs = [];
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto("http://localhost:3000");
await p.locator("canvas").waitFor({ state: "visible", timeout: 30000 });
await p.getByTestId(`stage-${stage}`).click();
if (t !== undefined) {
  await p.locator('[data-testid="threshold-t"]').evaluate((el, v) => {
    el.value = v; el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, t);
}
await p.waitForTimeout(2600);
const stats = await p.locator("canvas").evaluate((el) => {
  const off = document.createElement("canvas");
  off.width = el.width; off.height = el.height;
  off.getContext("2d").drawImage(el, 0, 0);
  const d = off.getContext("2d").getImageData(0, 0, off.width, off.height).data;
  const tones = new Set(); let nonBg = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], bl = d[i+2];
    tones.add(`${r>>4},${g>>4},${bl>>4}`);
    if (Math.abs(r-6) + Math.abs(g-32) + Math.abs(bl-63) > 24) nonBg++;
  }
  return { distinct: tones.size, nonBgPct: +(100*nonBg/(d.length/4)).toFixed(1) };
});
await p.screenshot({ path: out });
console.log(JSON.stringify({ stage, t: t ?? null, ...stats, errors: errs.slice(0,3) }));
await b.close();
