import { test, expect, type Page } from "@playwright/test";

type Perf = {
  calls: number;
  triangles: number;
  lines: number;
  geometries: number;
  frames: number;
  medianMs: number | null;
};

async function perf(page: Page): Promise<Perf> {
  return page.evaluate(() => (window as unknown as { __perf: Perf }).__perf);
}

/** Count pixels that are near-white, which is what Weld's highlighted edges are. */
async function whitePixels(page: Page): Promise<number> {
  return page.locator("canvas").evaluate((el) => {
    const src = el as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      // The campus edge colour is #8fc4f2, which is markedly blue: b - r is 99.
      // Weld's highlight is #ffffff, so near-neutral and bright.
      if (r > 205 && g > 205 && b > 205 && b - r < 40) n++;
    }
    return n;
  });
}

async function gotoStage(page: Page, stage: number) {
  await page.getByTestId(`stage-${stage}`).click();
  await page.waitForTimeout(2400);
}

test("merging holds: many triangles in few draw calls", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });

  const report: string[] = [];
  for (const stage of [1, 2, 3]) {
    await gotoStage(page, stage);
    const p = await perf(page);
    report.push(`stage ${stage}: ${p.calls} calls, ${p.triangles} tris, ${p.medianMs}ms`);

    // P2 drew 36 separate building meshes. Merging takes the campus to 5 scene
    // calls -- merged masses, Weld, two line meshes, the grid -- and the bloom
    // composer adds about 17 passes on top, measured at 22-24 total.
    //
    // Gated on draw calls, NOT frame time: headless Chromium runs SwiftShader in
    // software, where bloom costs ~70ms against roughly 1-3ms on a real GPU. Frame
    // time here is recorded for run-to-run comparison only, and P8 measures it on
    // real hardware.
    expect(p.calls, `stage ${stage} draw calls: ${report.join(" | ")}`).toBeLessThanOrEqual(30);
    expect(p.triangles, `stage ${stage} lost its geometry`).toBeGreaterThan(10_000);
    // 36 unmerged buildings would show up here as far more geometries.
    expect(p.geometries, `stage ${stage} geometry count suggests the merge broke`).toBeLessThan(20);
  }
  console.log(report.join("\n"));
});

test("Weld is marked by more than hue", async ({ page }) => {
  // MASTER.md: colour is never the only indicator. Weld carries brighter and wider
  // edges, a pulse, and a label chip. This checks the first of those, and the chip.
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });

  await gotoStage(page, 1);
  const unlit = await whitePixels(page);

  await gotoStage(page, 2);
  const lit = await whitePixels(page);

  // The highlight only engages from stage 2, so stage 1 is the control.
  expect(lit, `stage 2 white pixels ${lit} vs stage 1 ${unlit}`).toBeGreaterThan(unlit * 3 + 200);

  // And the label chip is real DOM, so screen readers and zoom get it too.
  await expect(page.locator(".weld-chip")).toBeVisible();
  await expect(page.locator(".weld-chip")).toHaveText("Weld Hall");
});

test("the label chip disappears when Weld is not highlighted", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await gotoStage(page, 1);
  await expect(page.locator(".weld-chip")).toHaveCount(0);
});

test("bloom is dropped under reduced motion", async ({ browser }) => {
  // Bloom is not motion, but it is extra visual intensity, and dropping it is the
  // cheap respectful default. Draw calls are how you can tell: the composer's
  // passes vanish.
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await gotoStage(page, 2);
  const p = await perf(page);
  console.log(`reduced motion: ${p.calls} calls, ${p.triangles} tris`);
  expect(p.calls, "bloom still running under reduced motion").toBeLessThan(12);
  // but the scene itself is still there
  expect(p.triangles).toBeGreaterThan(10_000);
  await ctx.close();
});
