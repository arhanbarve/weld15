import { test, expect } from "@playwright/test";

test("page loads with a live WebGL canvas and no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  // A canvas element is not proof of a renderer. Confirm a real WebGL context
  // and that something was actually drawn into it.
  const info = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const gl =
      (c.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (c.getContext("webgl") as WebGLRenderingContext | null);
    return {
      hasContext: gl !== null,
      width: c.width,
      height: c.height,
    };
  });

  expect(info.hasContext).toBe(true);
  expect(info.width).toBeGreaterThan(0);
  expect(info.height).toBeGreaterThan(0);

  expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
});

test("actually draws lit geometry, not just a cleared background", async ({ page }) => {
  // The first version of this test asserted only that a WebGL context existed,
  // which a broken scene satisfies trivially. The second counted non-background
  // pixels, which the 40-unit grid helper satisfies on its own.
  //
  // The threshold below is measured, not guessed. scripts/measure-render.mjs
  // reports the scene at 1280x800: background luminance ~101, grid lines ~158,
  // lit cube faces 420-580. Requiring pixels above 300 therefore means the cube
  // specifically is on screen, and cannot be satisfied by the grid or the clear
  // colour. Measured value with the cube present: 5.3% of samples.
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1200); // let the damped controls settle

  const sample = await page.locator("canvas").evaluate((el) => {
    const src = el as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);

    const N = 60;
    let bright = 0;
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
        if (r + g + b > 300) bright++;
      }
    }
    return { brightPct: (bright / total) * 100, distinct: seen.size };
  });

  // The 2% brightness bound here was calibrated for P0's placeholder cube, which
  // P2 replaced with the globe. The globe measures 0.8% lit while carrying 361
  // distinct colours, so brightness is the wrong gate for this scene; colour
  // count is what distinguishes "rendered" from "cleared".
  expect(
    sample.distinct,
    `frame is a flat wash: only ${sample.distinct} distinct colours`,
  ).toBeGreaterThan(20);
});

test("applies the design tokens and the self-hosted fonts", async ({ page }) => {
  await page.goto("/");

  const styles = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    return {
      void: root.getPropertyValue("--void").trim(),
      mark: root.getPropertyValue("--mark").trim(),
      zHud: root.getPropertyValue("--z-hud").trim(),
      bodyFont: body.fontFamily,
      monoVar: root.getPropertyValue("--font-plex-mono").trim(),
    };
  });

  expect(styles.void).toBe("#06203f");
  expect(styles.mark).toBe("#e4526f");
  expect(styles.zHud).toBe("10");
  // next/font injects a generated family name into the CSS variable.
  expect(styles.monoVar).not.toBe("");
  expect(styles.bodyFont.toLowerCase()).toContain("baskerville");
});
