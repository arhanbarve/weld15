import { chromium } from "@playwright/test";
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
await pg.goto("http://localhost:3000");
await pg.locator("canvas").waitFor({ state: "visible" });
for (const s of [1, 2, 3, 5]) {
  await pg.getByTestId(`stage-${s}`).click();
  await pg.waitForTimeout(2500);
  console.log(`stage ${s}`, JSON.stringify(await pg.evaluate(() => window.__perf)));
}
await b.close();
