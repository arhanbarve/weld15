import { test, expect, type Page } from "@playwright/test";
import { buildSuite, DEFAULT_PARAMS } from "@/geo/rooms";
import { PITCH_LIMIT } from "@/scene/walk";

/**
 * P10 step 7's six-shot manual verification, run as a script rather than trusted from reading
 * code (spec §6.3). Not part of the gated suite -- it lives outside tests/e2e on purpose, so a
 * normal `npx playwright test` run never picks it up. Screenshots land beside this file, in
 * verify-run/, which stays untracked exactly as spec §6.3 says.
 *
 * Reuses walk.spec.ts's own turn/walk pattern (turnSign read off the probe, never guessed) so
 * this script's aim is exactly as reliable as the gate that already proved it out.
 */

const P = DEFAULT_PARAMS;
const SUITE = buildSuite(P);

type Walk = {
  active: boolean;
  u: number;
  v: number;
  heading: number;
  pitch: number;
  room: string | null;
  turnSign: number;
  frames: number;
};
type Cam = { position: [number, number, number]; target: [number, number, number] };

const walkOf = (page: Page) => page.evaluate(() => (window as unknown as { __walk: Walk }).__walk);
const camOf = (page: Page) => page.evaluate(() => (window as unknown as { __cam: Cam }).__cam);

function camPitch(c: Cam): number {
  const [px, py, pz] = c.position;
  const [tx, ty, tz] = c.target;
  return (Math.atan2(ty - py, Math.hypot(tx - px, tz - pz)) * 180) / Math.PI;
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

async function turnToward(page: Page, target: { u: number; v: number }, tol = 0.03) {
  const from = await walkOf(page);
  const desired = Math.atan2(target.u - from.u, target.v - from.v);
  const diff0 = angleDiff(desired, from.heading);
  const key = diff0 > 0 === (from.turnSign === 1) ? "d" : "a";
  await page.keyboard.down(key);
  const until = Date.now() + 15_000;
  let prevAbs = Math.abs(diff0);
  while (Date.now() < until) {
    const s = await walkOf(page);
    const abs = Math.abs(angleDiff(desired, s.heading));
    if (abs <= tol || abs > prevAbs) break;
    prevAbs = abs;
  }
  await page.keyboard.up(key);
}

const near = (s: Walk, t: { u: number; v: number }) => Math.hypot(t.u - s.u, t.v - s.v) < 0.5;

async function walkToward(page: Page, target: { u: number; v: number }, maxMs = 30_000) {
  await turnToward(page, target, 0.15);
  const until = Date.now() + maxMs;
  await page.keyboard.down("w");
  try {
    while (Date.now() < until) {
      const s = await walkOf(page);
      if (near(s, target) || s.room === "bedA") return;
      const desired = Math.atan2(target.u - s.u, target.v - s.v);
      const diff = angleDiff(desired, s.heading);
      if (Math.abs(diff) <= 0.05) continue;
      const key = diff > 0 === (s.turnSign === 1) ? "d" : "a";
      const before = s.frames;
      await page.keyboard.down(key);
      const stepUntil = Date.now() + 2_000;
      let cur = s;
      while (Date.now() < stepUntil && cur.frames <= before) cur = await walkOf(page);
      await page.keyboard.up(key);
    }
  } finally {
    await page.keyboard.up("w");
  }
}

test.setTimeout(60_000);

test("P10 six-shot verification", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`[console] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

  // 1. Load, arrive at stage 5, no click of any kind after that.
  await page.goto("/");
  await page.locator("canvas").waitFor();
  await page.getByTestId("stage-5").click();
  await page.waitForTimeout(1400);
  await expect.poll(async () => (await walkOf(page)).active, { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => (await walkOf(page)).frames, { timeout: 20_000 }).toBeGreaterThan(2);
  const arriveCam = await camOf(page);
  const arrivePitchDeg = camPitch(arriveCam);
  console.log(`1. arrival: __walk.active=true, camera pitch = ${arrivePitchDeg.toFixed(3)} deg`);
  await page.screenshot({ path: "verify-run/01-arrival.png" });

  // 2. Hold F (look down) 1 s.
  await page.keyboard.down("f");
  await page.waitForTimeout(1000);
  await page.keyboard.up("f");
  const afterF = await walkOf(page);
  console.log(`2. after F: pitch = ${((afterF.pitch * 180) / Math.PI).toFixed(3)} deg`);
  await page.screenshot({ path: "verify-run/02-look-down.png" });

  // 3. Hold R (look up) 2 s.
  await page.keyboard.down("r");
  await page.waitForTimeout(2000);
  await page.keyboard.up("r");
  const afterR = await walkOf(page);
  console.log(`3. after R: pitch = ${((afterR.pitch * 180) / Math.PI).toFixed(3)} deg`);
  await page.screenshot({ path: "verify-run/03-look-up.png" });

  // Return to level-ish before walking, so the walk screenshot isn't taken staring at the ceiling.
  await page.keyboard.down("f");
  const until = Date.now() + 5_000;
  while (Date.now() < until && Math.abs((await walkOf(page)).pitch) > 0.05) {
    // settle toward 0
  }
  await page.keyboard.up("f");

  // 4. Walk W into bedroom A, on foot, no button.
  const bedA = SUITE.rooms.find((r) => r.id === "bedA")!;
  const bedACentre = { u: bedA.u + bedA.du / 2, v: bedA.v + bedA.dv / 2 };
  await walkToward(page, bedACentre);
  const afterWalk = await walkOf(page);
  console.log(`4. after walking: room = ${afterWalk.room}`);
  await page.screenshot({ path: "verify-run/04-in-bedroom-a.png" });

  // 5. The HUD row.
  await page.screenshot({ path: "verify-run/05-hud-row.png", clip: { x: 0, y: 0, width: 1280, height: 720 } });
  const rowText = await page.getByTestId("fp-controls").innerText();
  console.log(`5. fp-controls text:\n${rowText}`);

  // 6. Console errors, checked at the end against everything collected above.
  console.log(`6. console errors: ${errors.length === 0 ? "none" : errors.join(" | ")}`);
  await page.screenshot({ path: "verify-run/06-final.png" });

  console.log(`\nPITCH_LIMIT = ${((PITCH_LIMIT * 180) / Math.PI).toFixed(3)} deg`);
  console.log(`arrival pitch (camera) = ${arrivePitchDeg.toFixed(3)} deg, expected close to -7.965 deg`);
  console.log(`F-held pitch = ${((afterF.pitch * 180) / Math.PI).toFixed(3)} deg, expected close to -85 deg`);
  console.log(`R-held pitch = ${((afterR.pitch * 180) / Math.PI).toFixed(3)} deg, expected close to +85 deg`);
  console.log(`arrived room after walking toward bedroom A = ${afterWalk.room}, expected bedA`);
  console.log(`console errors: ${errors.length}`);
});
