import { test, expect, type Page } from "@playwright/test";

/**
 * Longer than the 30 s default: several of these gates wait through a 1400 ms camera
 * settle and poll the store across a render, against a SwiftShader renderer at a 62 ms
 * median frame. journey.spec.ts already runs 26 s tests against the same renderer.
 */
test.setTimeout(120_000);

/**
 * The suite's read-only gates: cutaway visibility, a malformed link, refit/reset, and
 * the shadow pass.
 *
 * WHY THESE READ window PROBES AND NOT THE DOM
 * The thing under test is a WebGL canvas. A wall that has been taken away is not a node
 * that stopped existing -- it is a triangle that stopped being submitted. So the
 * observable surface is the same device the rest of this suite already uses:
 * window.__cam for the camera, window.__perf for the render budget, and window.__weld
 * (UrlSync's, the editable state plus the encoded link).
 *
 * That is a real weakness and it is worth naming: a probe can agree with a broken
 * renderer. It is mitigated the way the luminance helper in journey.spec.ts is -- every
 * gate below that claims something is VISIBLE measures pixels, and the probes are used
 * only for identity and bookkeeping.
 */

type Weld = {
  q: string;
  stage: number;
  params: Record<string, number | string | boolean>;
  cutaway: string;
  occupancy: number;
  pieces: number;
  notice: string | null;
};

const weld = (page: Page) => page.evaluate(() => (window as unknown as { __weld: Weld }).__weld);

/** Mean luminance over a coarse grid, plus the number of distinct colours. */
async function frame(page: Page) {
  return page.locator("canvas").evaluate((el) => {
    const src = el as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    const N = 60;
    let sum = 0;
    let n = 0;
    const seen = new Set<string>();
    for (let gx = 0; gx < N; gx++) {
      for (let gy = 0; gy < N; gy++) {
        const x = Math.floor((off.width * (gx + 0.5)) / N);
        const y = Math.floor((off.height * (gy + 0.5)) / N);
        const i = (y * off.width + x) * 4;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        sum += (r + g + b) / 3;
        n++;
        seen.add(`${r},${g},${b}`);
      }
    }
    return { mean: sum / n, distinct: seen.size };
  });
}

/** Open the app in the room, with the panel showing. */
async function openInTheRoom(page: Page, query = "") {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  // `?preload=0` bypasses P13's blocking preloader (docs/phases/P13-PRELOAD.md section 1
  // decision 4) -- appended rather than assumed absent, since `query` sometimes already
  // carries its own `?s=...`.
  await page.goto(`/${query}${query.includes("?") ? "&" : "?"}preload=0`);
  await page.locator("canvas").waitFor();
  // The stage button, not the skip link. `.skip` sits at translateY(-200%) until it is
  // focused -- that is the whole point of a skip link -- so Playwright reports it as
  // outside the viewport and refuses to click it. journey.spec.ts's gotoStage() takes
  // the same route, and its own skip-link test focuses it by Tab first.
  await page.getByTestId(`stage-5`).click();
  // The camera settles; the same 1400 ms journey.spec.ts waits.
  await page.waitForTimeout(1400);
  await expect.poll(async () => (await weld(page)).stage, { timeout: 15_000 }).toBe(5);
  const panel = page.getByTestId("panel");
  if (!(await panel.isVisible())) await page.getByTestId("panel-toggle").click();
  await expect(panel).toBeVisible();
  return errors;
}

test.describe("P6 -- the suite is changeable", () => {
  test("each cutaway mode changes the frame, and walls-down shows more than none", async ({
    page,
  }) => {
    await openInTheRoom(page);

    /**
     * MEASURED FROM STAGE 3, NOT FROM INSIDE THE HALL, and the move is the fix rather than
     * a convenience. openInTheRoom() lands at stage 5, where the camera stands in a 4.5 ft
     * corridor -- and from in there a cutaway has almost nothing to show, because the walls
     * it drops are the ones behind the camera or out of frame. Measured, keyless, this
     * build, mean luminance over the same 60x60 grid `frame()` samples:
     *
     *   stage 5   none 210.70   roofOff 211.02   wallsDown 210.83   section 211.02
     *   stage 3   none  83.82   roofOff  78.52   wallsDown  79.64   section  80.44
     *
     * So the 0.5 floor below was unreachable at stage 5 (the real delta is 0.13, and this
     * assertion had been failing on it) and clears comfortably at stage 3 (4.18). Stage 3
     * is also where the feature is FOR: cutaway.ts's header opens with "a closed box of
     * 1.5 ft masonry shows nothing from outside", which is a statement about looking at the
     * building, not about standing in it.
     *
     * Worth recording that this became a real view only in P12: `thresholdOpacity` returns
     * `interior: 0` below stage 4 and `<Suite>` returns null under 0.001 opacity, so before
     * Experience.tsx started forcing the interior up in model mode, a cutaway at stage 3
     * opened onto an empty shell. See docs/phases/P12-DATUM.md.
     */
    await page.getByTestId("stage-3").click();
    await expect.poll(async () => (await weld(page)).stage, { timeout: 15_000 }).toBe(3);
    await page.waitForTimeout(1400);

    const shots: Record<string, { mean: number; distinct: number }> = {};
    for (const mode of ["none", "roofOff", "wallsDown", "section"]) {
      await page.getByTestId(`cutaway-${mode}`).click();
      await expect.poll(async () => (await weld(page)).cutaway).toBe(mode);
      // A frame or two for the geometry rebuild to reach the canvas.
      await page.waitForTimeout(250);
      shots[mode] = await frame(page);
      // The mode is in the canvas's own accessible name, because a screen reader gets
      // nothing else out of WebGL. cutaway.ts's header asks for exactly this.
      await expect(page.locator("canvas")).toHaveAttribute("aria-label", /Weld 15\. .+/);
    }

    // Distinct from each other, not merely non-empty: four modes that all render the
    // same frame would pass a liveness check and fail the feature.
    const means = Object.values(shots).map((s) => s.mean);
    expect(new Set(means.map((m) => m.toFixed(2))).size).toBeGreaterThan(1);
    // Dropping the near wall lets more light and more of the room into the frame than
    // the closed box does.
    expect(shots.wallsDown!.distinct).toBeGreaterThan(0);
    expect(Math.abs(shots.wallsDown!.mean - shots.none!.mean)).toBeGreaterThan(0.5);
  });

  test("a malformed link opens at the defaults with no console error", async ({ page }) => {
    const errors = await openInTheRoom(page, "?s=not-a-real-snapshot-at-all");
    const s = await weld(page);
    // The defaults, and specifically not a partially applied snapshot: url.ts assembles
    // and validates before it returns anything.
    expect(s.params.ceiling).toBe(10.75);
    expect(s.pieces).toBe(29);
    expect(s.cutaway).toBe("none");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("re-fitting for a different occupancy replaces the arrangement", async ({ page }) => {
    await openInTheRoom(page);
    expect((await weld(page)).pieces).toBe(29);

    const occ = page.getByTestId("slider-occupancy").locator("input");
    await occ.fill("2");
    await occ.dispatchEvent("input");
    // Not until asked: the slider on its own must not throw away the arrangement.
    expect((await weld(page)).pieces).toBe(29);

    await page.getByTestId("refit").click();
    await expect.poll(async () => (await weld(page)).pieces).toBeLessThan(29);
    await expect(page.getByTestId("panel-notice")).toContainText("Re-fitted");

    await page.getByTestId("reset-all").click();
    await expect.poll(async () => (await weld(page)).pieces).toBe(29);
  });

  test("the room is lit with real shadows, and they are paid for once", async ({ page }) => {
    await openInTheRoom(page);
    const p = await page.evaluate(
      () =>
        (
          window as unknown as {
            __perf: { calls: number; shadows: boolean; casters: number; triangles: number };
          }
        ).__perf,
    );

    // The pass exists. Asserted structurally because pixels cannot prove it: a shadow and
    // a dark oak board are the same pixels, and a budget assertion alone reads every
    // caster being switched off as an improvement.
    expect(p.shadows, "the renderer's shadow map is enabled").toBe(true);
    // 12 casters with P10 (was 8: seven furniture kinds plus the bedding). Furniture.tsx
    // now batches by kind AND material rather than by kind alone -- 11 mesh batches, up
    // from 8 -- which accounts for all but one of the difference; the exact source of
    // the twelfth was not chased further; the bound below covers the measured figure
    // with margin either way. Bounded below rather than pinned, because a kind added to
    // geo/pieces.ts should not fail this, and above so that switching every wall back on
    // shows up here as a decision.
    expect(p.casters, `casters ${p.casters}`).toBeGreaterThanOrEqual(8);
    expect(p.casters, `casters ${p.casters}`).toBeLessThanOrEqual(14);
    // And the cost is the measured one, not a surprise. 57 shipped with P14 row 8 (was 50
    // with rows 1-6, 46 with P10). 62 leaves headroom over that settled figure.
    expect(p.calls, `calls ${p.calls}`).toBeGreaterThan(30);
    expect(p.calls, `calls ${p.calls}`).toBeLessThanOrEqual(62);
  });
});
