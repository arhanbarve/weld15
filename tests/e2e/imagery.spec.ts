import { test, expect, type Page } from "@playwright/test";

/**
 * P9b -- the photograph loads, fades in by altitude, and never costs the page its first paint.
 *
 * THE GATE THIS FILE EXISTS FOR IS THE LAST ONE: the loading fallback must never reappear after
 * first paint. CanvasHost.tsx measured what happens when it does, on a served production build with
 * one chunk delayed 2,500 ms -- the page showed real UI at +461 ms, reverted to "LOADING WELD 15"
 * at +763 ms with the HUD and canvas gone, and came back at +3,189 ms. R3F wraps <Canvas>'s children
 * in a Suspense whose fallback throws a promise that never resolves, so a scene child that suspends
 * suspends the whole page up to the boundary OUTSIDE the canvas.
 *
 * P9b adds five textures, the largest 640 KB, which is exactly the thing that warning was written
 * for. imagery.ts loads them imperatively for that reason and says so at length. This is the gate
 * that would catch someone reaching for useTexture in six months.
 */

const LOADING = "Loading Weld 15";

async function stage(page: Page, n: number) {
  await page.getByTestId(`stage-${n}`).click();
  await page.waitForTimeout(1_200);
}

/** The altitude the scene is actually at, from CameraRig's probe. */
async function alt(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __cam: { alt: number } }).__cam.alt,
  );
}

test("the loading fallback never comes back after first paint", async ({ page }) => {
  /*
   * WATCHED CONTINUOUSLY RATHER THAN SAMPLED, because the failure is transient by nature -- P8's
   * measurement had the page away for 2.4 seconds and back again, and a screenshot on either side
   * of that window shows nothing wrong. A MutationObserver installed before the canvas exists
   * records every appearance of the fallback text, so a revert of any duration is caught.
   *
   * Installed on documentElement with subtree: true, and it records rather than fails, so the
   * assertion can report WHAT it saw and WHEN.
   */
  await page.addInitScript(() => {
    const w = window as unknown as { __loadingSightings: number[] };
    w.__loadingSightings = [];
    const start = Date.now();
    const check = () => {
      if (document.body?.textContent?.includes("Loading Weld 15")) {
        w.__loadingSightings.push(Date.now() - start);
      }
    };
    new MutationObserver(check).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    check();
  });

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { __cam?: unknown }).__cam !== undefined,
    undefined,
    { timeout: 30_000 },
  );

  // FIRST PAINT IS THE HUD, and everything after this point must not lose it.
  await expect(page.getByTestId("hud")).toBeVisible();
  const firstPaint = await page.evaluate(
    () => (window as unknown as { __loadingSightings: number[] }).__loadingSightings.length,
  );

  // Now walk the descent, which is when every texture actually gets requested: L0 at stage 0, then
  // the four ground plates as the altitude bands open.
  for (const n of [0, 1, 2, 3]) await stage(page, n);
  await page.waitForTimeout(1_500);

  const after = await page.evaluate(
    () => (window as unknown as { __loadingSightings: number[] }).__loadingSightings,
  );

  // Sightings BEFORE the canvas existed are legitimate -- that is the fallback doing its job. What
  // must be zero is any sighting after it, and the count is what distinguishes the two.
  expect(
    after.length,
    `fallback seen ${after.length} times (${after.join("ms, ")}ms); ${firstPaint} of those were before first paint`,
  ).toBe(firstPaint);

  await expect(page.getByTestId("hud")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(LOADING);
});

test("every plate is served, and in the format the browser can decode", async ({ page }) => {
  const seen: { file: string; status: number }[] = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/imagery/")) seen.push({ file: u.split("/").pop()!, status: r.status() });
  });

  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  for (const n of [0, 1, 2, 3]) await stage(page, n);
  await page.waitForTimeout(1_500);

  // All five levels arrive. Which FORMAT is not asserted -- imagery.ts tries AVIF and falls through
  // to WebP on a decode failure, so the answer legitimately differs by browser, and pinning it here
  // would be pinning a Chromium build rather than a requirement.
  for (const level of ["l0", "l1", "l2", "l3", "l4"]) {
    const hit = seen.find((s) => s.file.startsWith(level));
    expect(hit, `${level} was never requested: ${seen.map((s) => s.file).join(", ")}`).toBeDefined();
    expect(hit!.status, `${level} -> ${hit!.status}`).toBe(200);
  }

  // AND NOTHING 404s. A missing plate is silent by design -- loadTexture swallows the error so a
  // failed level cannot fail journey.spec.ts's no-console-errors gate -- so this is the only place
  // that would notice a file renamed out from under the manifest.
  expect(seen.filter((s) => s.status >= 400), JSON.stringify(seen)).toEqual([]);
});

test("the ground arrives with altitude and is a photograph, not a fill", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { __cam?: unknown }).__cam !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(2_000);

  const frame = async () =>
    page.locator("canvas").evaluate((el) => {
      const src = el as HTMLCanvasElement;
      const off = document.createElement("canvas");
      off.width = src.width;
      off.height = src.height;
      const ctx = off.getContext("2d")!;
      ctx.drawImage(src, 0, 0);
      const { data } = ctx.getImageData(0, 0, off.width, off.height);
      const N = 60;
      let nonBg = 0;
      let total = 0;
      let sat = 0;
      const seen = new Set<string>();
      for (let gx = 0; gx < N; gx++) {
        for (let gy = 0; gy < N; gy++) {
          const x = Math.floor((off.width * (gx + 0.5)) / N);
          const y = Math.floor((off.height * (gy + 0.5)) / N);
          const i = (y * off.width + x) * 4;
          const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
          total++;
          seen.add(`${r},${g},${b}`);
          if (Math.abs(r - 6) > 6 || Math.abs(g - 32) > 6 || Math.abs(b - 63) > 6) nonBg++;
          sat += Math.max(r, g, b) - Math.min(r, g, b);
        }
      }
      return {
        nonBg: +((nonBg / total) * 100).toFixed(1),
        distinct: seen.size,
        chroma: +(sat / total).toFixed(1),
      };
    });

  await stage(page, 1);
  const high = await frame();
  const highAlt = await alt(page);

  await stage(page, 2);
  const low = await frame();
  const lowAlt = await alt(page);

  // The photograph is there at both, which before P9b it was not: at 16,332 ft the frame used to be
  // 1.3% non-background with 12 distinct colours, because the globe had faded and nothing replaced
  // it. Anything above the journey gate's 8% means the ground arrived.
  expect(highAlt).toBeGreaterThan(lowAlt);
  expect(high.nonBg, `stage 1 coverage at ${highAlt.toFixed(0)} ft`).toBeGreaterThan(50);
  expect(low.nonBg, `stage 2 coverage at ${lowAlt.toFixed(0)} ft`).toBeGreaterThan(50);

  // A photograph, not a flat fill: hundreds of distinct colours rather than the handful a tinted
  // solid would give.
  expect(high.distinct, `stage 1 distinct colours`).toBeGreaterThan(300);
  expect(low.distinct, `stage 2 distinct colours`).toBeGreaterThan(300);

  /*
   * THE TINT RAMP IS DELIBERATELY NOT ASSERTED FROM PIXELS HERE, and the first version of this test
   * tried and was wrong. It measured mean chroma over the frame and expected it to fall as the tint
   * came up. Measured: 4.4 at stage 1 and 18.9 at stage 2 -- it RISES, and the reason is that the
   * metric is confounded by content rather than that the tint is broken. At 16,332 ft the frame is
   * the 50 km plate at 80 ft per texel, which is uniformly grey greater-Boston seen at a grazing
   * angle; at 815 ft it is the 0.52 ft plate plus the blue massing at 0.34, white edges, a crimson
   * chip and Weld's highlight. The tint is a 19% effect at the first and 85% at the second, and it
   * is swamped both times.
   *
   * The ramp is a pure function of altitude and IS asserted, in tests/altitude.test.ts, which checks
   * it is zero at orbit, monotonic, and 1.0 by stage 3. That is the right level for it. A pixel
   * assertion that cannot separate the tint from the subject would pin the plate, not the design.
   */
  expect(high.chroma, "recorded for comparison, not asserted").toBeGreaterThan(0);
});

test("a place label appears, and it is not in the tab order", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => (window as unknown as { __cam?: unknown }).__cam !== undefined,
    undefined,
    { timeout: 30_000 },
  );
  const chip = page.locator(".place-chip", { hasText: "Harvard Yard" });
  const boston = page.locator(".place-chip", { hasText: "Boston" });

  /*
   * HIDDEN AT ORBIT AND SHOWN AT THE YARD, asserted in that order, because the first version of this
   * test only checked "visible at stage 2" and that PASSED AT EVERY ALTITUDE. drei's <Html> keeps its
   * node mounted, so making the three.js group invisible left the element in the document, and
   * Playwright counts opacity 0 as visible. Labels.tsx now sets display: none as well; this is the
   * assertion that would have caught the earlier version, and it is the reason both halves are here.
   */
  await stage(page, 0);
  await page.waitForTimeout(800);
  await expect(chip, "Harvard Yard must not be labelled from orbit").toBeHidden();

  await stage(page, 2);
  await page.waitForTimeout(800);

  // Harvard Yard's band is 5,200 -> 260 ft, and stage 2 sits at 815, so its chip is up here.
  await expect(chip).toBeVisible();
  // And Boston's band ended at 26,000 ft, so it must be gone -- bands are exclusive at the ends.
  await expect(boston, "Boston should have left by the Yard").toBeHidden();

  // aria-hidden and unfocusable: it duplicates what the canvas label and A11yAlt already say, and
  // a11y.spec.ts asserts a four-stop tab order that six chips would destroy.
  await expect(chip).toHaveAttribute("aria-hidden", "true");
  expect(await chip.evaluate((el) => el.tabIndex)).toBeLessThan(0);

  // And it does not sit on top of Weld's own chip, which is what placing it at Weld's coordinates
  // did. Both are on screen at this stage; their boxes must not intersect.
  const weld = page.locator(".weld-chip", { hasText: "Weld Hall" });
  await expect(weld).toBeVisible();
  const a = (await chip.boundingBox())!;
  const b = (await weld.boundingBox())!;
  const overlaps =
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps, `place chip ${JSON.stringify(a)} overlaps Weld chip ${JSON.stringify(b)}`).toBe(
    false,
  );
});
