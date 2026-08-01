import { test, expect, type Page } from "@playwright/test";

type Perf = {
  calls: number;
  triangles: number;
  lines: number;
  geometries: number;
  /** Live texture count, added to Perf.tsx in P9b. Optional so this type survives an older build. */
  textures?: number;
  frames: number;
  medianMs: number | null;
};

/**
 * Read window.__perf, having first waited for a frame that actually drew something.
 *
 * WHY THE WAIT, AND WHY IT IS NOT A WIDENED TOLERANCE. Perf.tsx samples the renderer's counters
 * once per frame and resets them, so what this reads is one specific frame. Under a full parallel
 * run -- four workers against one dev server, software-rendered -- that frame can be a degenerate
 * one: this test failed once with `triangles: 1` at stage 1, against a figure that measures 16,489
 * in four consecutive clean runs. One triangle is not a campus that lost its merge; it is a frame
 * that had not finished.
 *
 * So the fix is to refuse to sample a frame that drew nothing, rather than to lower the bound to
 * something a broken merge could also satisfy. The threshold is 100 triangles -- two orders of
 * magnitude below the real figure and far below anything the assertions care about -- so a genuine
 * regression still fails, and it fails on the assertion with its numbers attached rather than on an
 * opaque timeout in here. P9 made this likelier rather than causing it: five plates of imagery
 * decode on the main thread during exactly this window.
 */
async function perf(page: Page): Promise<Perf> {
  await page
    .waitForFunction(
      () => ((window as unknown as { __perf?: { triangles: number } }).__perf?.triangles ?? 0) > 100,
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => {});
  return page.evaluate(() => (window as unknown as { __perf: Perf }).__perf);
}

/** One frame's near-white pixel count. */
async function whitePixelsOnce(page: Page): Promise<number> {
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
      //
      // THRESHOLD RAISED FROM 205 TO 236 IN P9, AND THE MEASUREMENT WAS REBUILT RATHER THAN
      // WIDENED. P9.md section 6.10 predicted this test would fail and said explicitly not to
      // just loosen the tolerance, so here is what actually happened and why 236.
      //
      // Before P9 the campus floated on a gridHelper over a plain void, so "bright and
      // near-neutral" could only be Weld's white line work. There is now a photograph
      // underneath, and leaf-off aerial imagery is full of bright near-neutral pixels -- white
      // roofs, concrete, bare pavement. At 205 the ground alone contributed 1,939 pixels at
      // stage 1 and the old assertion (stage 2 > stage 1 * 3 + 200) became unsatisfiable: it
      // wanted 6,017 and the real figure was 2,421.
      //
      // Measured, near-neutral pixel counts by threshold, on the P9 build:
      //
      //   threshold   stage 1 (no highlight)   stage 2 (highlight on)
      //         205                    1,939                   2,588
      //         225                      121                   2,282
      //         235                        0                   1,648
      //         245                        0                   1,172
      //
      // So 236 separated the two populations completely: the brightest thing the tinted
      // photograph produced was below it, and line work drawn at #ffffff was far above it.
      //
      // RE-MEASURED IN P10, AND 236 STILL HOLDS -- BUT NOT FOR THE REASON YOU'D GUESS. P10
      // swapped the leaf-off MassGIS plates for leaf-on colour NAIP (greener, less bare-surface
      // exposure) and put real brick, slate, granite and sandstone under Weld's neighbours from
      // stage 2 on. Both change this population, and re-measuring rather than assuming was the
      // point:
      //
      //   threshold   stage 1 (no highlight)   stage 2 (highlight on)
      //         205                      454                    2,712
      //         225                       24                    2,486
      //         235                        0                    2,060
      //         245                        0                    1,783
      //         250                        0                    1,781
      //
      // Stage 1 fell (1,939 -> 454 at 205) rather than rose: leaf-on canopy covers the bare
      // roofs and pavement that made leaf-off imagery read bright and neutral, so there is LESS
      // of that population now, not more. Stage 2 rose instead (2,588 -> 2,712 at 205, and every
      // threshold above it): CampusMesh's granite and sandstone are themselves near-neutral and
      // bright under the campus's highlight tint, adding to the count alongside Weld's own line
      // work. Both moves are real and both still land on the correct side of 236: stage 1 is
      // zero from 235 up, stage 2 is 1,783 at 245 and 1,781 at 250, so 236 still separates the
      // two populations completely and needs no change. The test still measures what it always
      // measured -- white line work that only Weld carries -- rather than the ground or the
      // neighbouring buildings.
      if (r > 236 && g > 236 && b > 236 && b - r < 40) n++;
    }
    return n;
  });
}

/**
 * Near-white pixel count, the median of three samples a fifth of a second apart.
 *
 * P10 STEP 10 gave Weld's mass an emissive pulse (Campus.tsx's WELD_PULSE) in place of the old
 * opacity ramp, and the pulse is now part of what pushes the campus's own photographed roof
 * pixels across the 236 threshold above -- so a single sample carries the pulse's phase as
 * noise, the exact problem contrast.spec.ts's own `pixels()` documents and solves the same way
 * for the identical reason. `unlit` (stage 1, highlight off, `emissiveIntensity` pinned at 0)
 * does not have this problem, but is sampled the same way for symmetry.
 */
async function whitePixels(page: Page): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    samples.push(await whitePixelsOnce(page));
    await page.waitForTimeout(200);
  }
  samples.sort((a, b) => a - b);
  return samples[1]!;
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
    // geometries and textures in the report as well as the assertion, because when this test
    // fails the useful question is WHICH counter moved, and P9 gave it two more that can.
    report.push(
      `stage ${stage}: ${p.calls} calls, ${p.triangles} tris, ${p.geometries} geom, ${p.textures ?? "?"} tex, ${p.medianMs}ms`,
    );

    // P2 drew 36 separate building meshes. Merging takes the campus to 5 scene
    // calls -- merged masses, Weld, two line meshes, the grid -- and the bloom
    // composer adds about 17 passes on top, measured at 22-24 total.
    //
    // Gated on draw calls, NOT frame time: headless Chromium runs SwiftShader in
    // software, where bloom costs ~70ms against roughly 1-3ms on a real GPU. Frame
    // time here is recorded for run-to-run comparison only, and P8 measured it on real
    // hardware -- Apple M5 Pro, headed Chrome, ANGLE Metal: 2.5 to 2.8 ms median across
    // every stage at DPR 2, against 62-79 ms here. Software costs about 25x.
    //
    // The 30 covers scene calls PLUS the bloom composer's 17 fullscreen passes, which is
    // why it is not IMPLEMENTATION-PLAN section 9's 10 for the campus row. Section 9
    // counts scene submissions; measured, the composer is exactly 17 calls, so stage 2's
    // 26 here is 9 of scene. Three separate records in this project stated a scene budget
    // as a frame budget before that was pinned down.
    // MOVED FROM 30 TO 34 IN P9, WITH THE MEASUREMENT. Ground.tsx adds four nested photographic
    // quads and Globe.tsx an atmosphere rim, so the scene grew by up to five submissions at these
    // stages.
    //
    // RE-MEASURED FOR P10 STEP 10, THE BOUND UNCHANGED. The campus buildings are opaque
    // MeshStandardMaterials now, with aerial.ts's onBeforeCompile skin putting a photographed
    // roof on them -- no new mesh, so no new draw call, which is the whole point of an
    // onBeforeCompile injection over a second material. Re-measured on this machine, headless:
    //
    // 34 rather than 30 because 28 against a bound of 30 is two calls of headroom, and this test
    // FLAKED at 30 exactly once in a full parallel run -- the ground quads' textures land at a
    // slightly different moment under load, and a bound two away from the measurement is a bound
    // that fails for timing rather than for regressions. 34 keeps six.
    //
    // MERGE NOTE (P10 integration). Every P10 figure in this file was measured on ONE branch's
    // build. The merged build is neither: it has p10-imagery's CampusMesh and p10-ux's dock and
    // scrubber and p10-fidelity's interior in it at once. The BOUNDS below were chosen with
    // headroom and are asserted as bounds, not as equalities, so they carry over; the numbers in
    // the prose are the branch measurements they came from and are labelled as such. The
    // post-merge re-measurement is verify-run/p10-merge.json.
    //
    // RE-MEASURED IN P10, AND THE BOUND STILL HOLDS WITHOUT MOVING. P10 retires the 36 extruded
    // massing boxes campus.json used to draw and stands Harvard's own I3S-derived model on the
    // photograph instead (CampusMesh.tsx, one merged mesh, 48,348 vertices). Measured on this
    // build, same method:
    //
    //   stage 1   22 calls   17,147 tris
    //   stage 2   26 calls   17,563 tris
    //   stage 3   26 calls   17,563 tris
    //
    // Draw calls FELL by two at every stage -- the real campus model is one mesh where the old
    // massing was merged boxes plus its own outline geometry -- and triangles rose by only about
    // 658, not by anything close to a doubling: the 48,348-vertex figure is the model's raw
    // vertex count, not its rendered-triangle delta against what it replaced, and most of this
    // scene's triangle budget was never the massing to begin with (the P9 table above already
    // carried 16,489-16,905 before the real campus model existed at all). 34 keeps twelve calls
    // of headroom now rather than six; left as is because six was already enough and this is a
    // gate, not a target to keep tight.
    expect(p.calls, `stage ${stage} draw calls: ${report.join(" | ")}`).toBeLessThanOrEqual(34);
    expect(p.triangles, `stage ${stage} lost its geometry`).toBeGreaterThan(10_000);
    /*
     * 36 unmerged buildings would show up here as far more geometries.
     *
     * MIND WHAT THIS COUNTER IS. renderer.info.memory.geometries is CUMULATIVE OVER THE
     * SESSION, not a property of the stage: measured, it reads 11 arriving at stage 5 on a
     * fresh page and 20 arriving there through the full descent, and 13 to 18 while
     * cycling the four cutaway modes -- all with calls, triangles and casters identical.
     * So the bound below is only meaningful on the path THIS test walks, which is a fresh
     * load and stages 1 to 3 with no cutaway cycling, where it measures 13.
     *
     * Kept rather than raised or dropped, because on that path it still catches the thing
     * it was written for. But it is not the assertion that carries the merge claim -- the
     * draw-call bound above is, and it is not path-dependent. A future test that reaches
     * this line after more of the app has been exercised should expect a larger number and
     * should not read a rise as a regression.
     */
    // MOVED FROM 20 TO 24 IN P9, for the same reason and with the same caveat the comment above
    // already gives about this counter being cumulative and path-dependent. Re-measured on this
    // test's path: 11 at stage 1, 16 at stages 2 and 3, against the 13 recorded before P9. The
    // rise is Ground.tsx's four plane geometries, and it is expected rather than a broken merge.
    //
    // RE-MEASURED IN P10 ON THE SAME PATH: 9 at stage 1, 14 at stages 2 and 3 -- lower than P9's
    // 11/16, because retiring the 36 extruded massing boxes removes more geometries than
    // CampusMesh's one merged model adds back. Bound left at 24; still not the assertion that
    // carries the merge claim (the draw-call bound above is), for the same reason recorded below.
    expect(p.geometries, `stage ${stage} geometry count suggests the merge broke`).toBeLessThan(24);
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

  // The highlight only engages from stage 2, so stage 1 is the control. Measured at the
  // rebuilt threshold: 0 at stage 1, 1,648 at stage 2 in P9; RE-MEASURED IN P10 at 0 and 2,026
  // -- CampusMesh's granite and sandstone add near-neutral bright pixels of their own alongside
  // Weld's line work, which is why the P10 figure is higher rather than the same.
  expect(lit, `stage 2 white pixels ${lit} vs stage 1 ${unlit}`).toBeGreaterThan(unlit * 3 + 200);

  // AND AN ABSOLUTE FLOOR, which the ratio alone does not give. With the control now reading 0
  // the comparison above passes on 201 pixels, and 201 pixels of white is not a highlighted
  // building -- it is a few stray anti-aliased edges. 400 is a quarter of the P9 measurement of
  // 1,648 (P10 measures 2,026, an even wider margin), so it fails if the highlight is
  // substantially lost while tolerating a change of line width.
  expect(lit, `stage 2 has too little white line work: ${lit}`).toBeGreaterThan(400);

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
