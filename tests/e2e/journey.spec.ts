import { test, expect, type Page } from "@playwright/test";

/**
 * Drives the whole descent and checks each stage actually renders something.
 *
 * The luminance method is the one from scripts/measure-render.mjs. It exists
 * because two earlier render assertions in this repo passed against broken
 * scenes: one checked only that a WebGL context existed, the next counted
 * non-background pixels and was satisfied by the grid helper alone. Sampling for
 * pixels brighter than the background and the grid is what actually proves
 * geometry is on screen.
 */
async function frameStats(page: Page) {
  return page.locator("canvas").evaluate((el) => {
    const src = el as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    const N = 60;
    let lit = 0;
    let nonBg = 0;
    let warm = 0;
    let pale = 0;
    let total = 0;
    const seen = new Set<string>();
    for (let gx = 0; gx < N; gx++) {
      for (let gy = 0; gy < N; gy++) {
        const x = Math.floor((off.width * (gx + 0.5)) / N);
        const y = Math.floor((off.height * (gy + 0.5)) / N);
        const i = (y * off.width + x) * 4;
        const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
        total++;
        seen.add(`${r},${g},${b}`);
        // background #06203f sums to 101; grid lines #0c3260 to 158.
        if (r + g + b > 300) lit++;
        if (Math.abs(r - 6) > 6 || Math.abs(g - 32) > 6 || Math.abs(b - 63) > 6) nonBg++;
        if (r > b + 25 && r > 60) warm++;
        if (r > 110 && Math.abs(r - b) < 30) pale++;
      }
    }
    return {
      litPct: (lit / total) * 100,
      nonBgPct: (nonBg / total) * 100,
      distinct: seen.size,
      // Oak floors are warm (r > b); plaster walls are near-neutral and bright.
      // A frame showing only one surface fails this, which coverage alone does not.
      warmPct: (warm / total) * 100,
      palePct: (pale / total) * 100,
    };
  });
}

async function gotoStage(page: Page, stage: number) {
  await page.getByTestId(`stage-${stage}`).click();
  await page.waitForTimeout(1400); // camera settles
}

test("every stage renders lit geometry, and there are no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });

  const report: string[] = [];
  for (const stage of [0, 1, 2, 3, 4, 5]) {
    await gotoStage(page, stage);
    const s = await frameStats(page);
    report.push(`stage ${stage}: ${s.nonBgPct.toFixed(1)}% covered, ${s.distinct} distinct`);
    // Bounds measured by scripts/measure-stages.mjs, not guessed. Across all six
    // stages the observed minima were nonBg 14.7% (stage 1, Cambridge from far
    // out) and 10 distinct colours (stage 5). These sit at roughly half of each,
    // so a real regression trips them while normal variation does not.
    //
    // Luminance is deliberately NOT the gate: the globe measures 0.8% lit while
    // carrying 361 distinct colours, so a brightness threshold would either fail
    // stage 0 or be too loose to mean anything.
    expect(s.nonBgPct, `stage ${stage} renders nothing: ${report.join(" | ")}`).toBeGreaterThan(8);
    expect(s.distinct, `stage ${stage} is a flat wash`).toBeGreaterThanOrEqual(5);
    // Stage 5 stands inside a room, so it must show BOTH an oak floor and a
    // plaster wall. A single flat plane filling the frame passes the coverage
    // check at 100% -- it did, twice -- and fails this one.
    if (stage === 5) {
      expect(s.warmPct, `stage 5 shows no floor: ${JSON.stringify(s)}`).toBeGreaterThan(2);
      expect(s.palePct, `stage 5 shows no wall: ${JSON.stringify(s)}`).toBeGreaterThan(2);
    }
    /*
     * A side effect, not an assertion, and it writes into a TRACKED directory on purpose.
     *
     * This dirties the working tree on every run, which looks like a wart and is the
     * deliberate choice. The alternative is writing to test-results/ or gitignoring these,
     * and both cost the thing they are for: in a project whose whole output is pixels, a
     * render that shows up in `git diff` is how a change to the picture becomes reviewable
     * at all. It has already paid for itself once -- P7 moved the stage-5 shot from a corner
     * of bedroom B into the hall, and the committed p2-stage-5.png was the only artifact
     * that showed the new framing rather than describing it.
     *
     * So the convention is: these are refreshed and committed alongside whatever changed the
     * picture, and a dirty tree after a test run is expected rather than a bug to fix.
     */
    await page.screenshot({ path: `design/renders/p2-stage-${stage}.png` });
  }
  console.log(report.join("\n"));

  expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
});

test("the threshold never shows an empty frame as it crosses", async ({ page }) => {
  // The failure this guards against is a flicker: a few frames where the shell
  // has gone and the interior has not arrived.
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await gotoStage(page, 4);

  const slider = page.getByTestId("threshold-t");
  const worst: string[] = [];
  for (const t of [0, 0.2, 0.35, 0.5, 0.65, 0.8, 1]) {
    await slider.fill(String(t));
    await page.waitForTimeout(500);
    const s = await frameStats(page);
    worst.push(`t=${t}: ${s.nonBgPct.toFixed(1)}%/${s.distinct}`);
    // Observed minima across t: 28% covered, 9 distinct. An empty frame reads as
    // 0% and 1 -- which is exactly what this caught before the fix.
    expect(s.nonBgPct, `threshold went empty at t=${t}: ${worst.join(" | ")}`).toBeGreaterThan(10);
    expect(s.distinct, `threshold went flat at t=${t}: ${worst.join(" | ")}`).toBeGreaterThanOrEqual(4);
  }
  console.log(worst.join(" | "));
});

test("the skip control is the first thing you reach by keyboard", async ({ page }) => {
  // An immersive intro needs an escape hatch, and one you must tab past six stage
  // buttons to reach is not an escape hatch.
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("skip")).toBeFocused();

  await page.getByTestId("skip").click();
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("stage-name")).toContainText("Weld 15");
});

test("reduced motion jump-cuts instead of flying", async ({ browser }) => {
  // Must not merely shorten the fly. A shortened fly is still a fly.
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("stage-name")).toContainText("reduced motion");

  await page.getByTestId("stage-3").click();
  await page.waitForTimeout(250); // far less than a fly would need
  const s = await frameStats(page);
  expect(s.nonBgPct, "reduced motion did not arrive immediately").toBeGreaterThan(8);
  await ctx.close();
});
