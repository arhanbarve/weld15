// Diagnostic: capture the threshold at several t values to see what the camera
// actually sees. Kept because the threshold is the phase's risk surface.
import { chromium } from "@playwright/test";
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 900, height: 620 } });
await pg.goto("http://localhost:3000");
await pg.locator("canvas").waitFor({ state: "visible" });
await pg.getByTestId("stage-4").click();
await pg.waitForTimeout(1500);
for (const t of [0.2, 0.35, 0.5, 0.8]) {
  await pg.getByTestId("threshold-t").fill(String(t));
  await pg.waitForTimeout(700);
  await pg.screenshot({ path: `design/renders/dbg-t${String(t).replace(".", "")}.png` });
}
await b.close();
console.log("captured");
