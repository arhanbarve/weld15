import { test, expect, type Page } from "@playwright/test";

/**
 * THE GATE FOR P11-PHOTOREAL.md section 0.1 (task 7).
 *
 * The bug this spec exists to keep dead: `globeRig.ts`'s old `spinPose()` rotated the
 * camera's position (and its look-at target) about Earth's TRUE centre, which mixes yaw
 * into the camera's site-frame y -- and `altitude.ts` used to read `alt = camera.position.y`
 * directly. Past about 184 px of drag (measured, section 0.1's table), that y went
 * negative, `nearFar()` clamped to nonsense, and the globe's own opacity band read zero:
 * nothing was drawn. Stages 1 and 2 had no drag at all (`CameraRig.tsx`'s old
 * `if (stage !== 0 && stage !== 3 && stage !== 4) return`), which is the other half of the
 * user's original complaint.
 *
 * P11's fix (CameraRig.tsx, orbit.ts) replaces the Earth-centre rotation with an orbit
 * about the STAGE'S OWN LOOK-AT TARGET (orbit.ts's orbitKeyframe, the same function
 * stage 3's free orbit already used) at every stage but the last: heading rotates the
 * camera around a fixed vertical axis and never touches height above the target, and
 * pitch -- the one axis that does -- is clamped per stage (orbit.ts's clampForStage) to a
 * range where `sin(pitch)` stays comfortably positive. Altitude itself is also
 * redefined, from `camera.position.y` to `geo/frame.ts`'s `altitudeOf` (true height above
 * the WGS-84 ellipsoid, correct for a camera anywhere, not only one on Weld's local
 * vertical) -- published on the probe as `window.__cam.alt` -- so this spec can assert the
 * REAL claim ("altitude never goes negative") rather than the coordinate that used to
 * stand in for it.
 *
 * WHY window.__cam AND NOT THE DOM: the thing under test is a WebGL camera, and
 * CameraRig.tsx already publishes exactly the fields this gate needs every frame -- the
 * same reasoning wheel-and-spin.spec.ts and stage4-orbit.spec.ts give for the same probe.
 *
 * KEYLESS BY DELIBERATE CHOICE (docs/phases/P11-PHOTOREAL.md section 6a): this spec drives
 * the camera and the fallback rendering path, neither of which needs a live Google Maps
 * key, so it must never become a billable event. Run it with
 * `NEXT_PUBLIC_GOOGLE_MAPS_KEY= npx playwright test tests/e2e/drag-safety.spec.ts` --
 * the empty override beats whatever `.env.local` sets (Next's own env loading never
 * overrides a variable already present in the process environment), which is what makes
 * `Experience.tsx`'s `HAS_TILES_KEY` false and mounts `<FallbackGround>` instead of
 * `<Tiles>`. This spec does not check that itself -- it is a property of how it is
 * invoked, not of the page -- so the runner is responsible for the override, exactly as
 * the phase spec's "keyless by default, everywhere" rule asks.
 */
test.setTimeout(180_000);

type Cam = {
  stage: number;
  t: number;
  position: [number, number, number];
  target: [number, number, number];
  alt: number;
  u: number;
};

const cam = (page: Page) => page.evaluate(() => (window as unknown as { __cam: Cam }).__cam);

async function open(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1000); // first paint settles
  expect(errors, `page errors on load: ${errors.join("; ")}`).toEqual([]);
}

async function gotoStage(page: Page, stage: number): Promise<void> {
  await page.getByTestId(`stage-${stage}`).click();
  await page.waitForTimeout(1400); // camera settles, same wait every other e2e spec here uses
}

/**
 * Is the canvas a single uniform colour (the black-screen failure mode) or does it show
 * actual geometry?
 *
 * Drawn DOWN to a small fixed-size offscreen canvas (N x N) rather than read back at the
 * source's own resolution -- this runs at every one of a few hundred samples per stage in
 * the sweep below, and a full-resolution getImageData() on a 1280x720 canvas that often is
 * the one thing in this spec's runtime budget that is not "the point of the test": the
 * browser's own drawImage() downscale is what does the sampling, cheaply, and a canvas this
 * small still distinguishes "one flat colour" from "real geometry" exactly as well as a
 * fine grid would, since the failure mode under test (a uniform frame) is uniform at any
 * resolution. `distinct` counting colours catches a uniform frame (black, or any other
 * single colour) regardless of what that colour happens to be, which is the point: the
 * globe's opacity going to zero at some altitudes and one at others means "not black"
 * alone would not catch a frame that is uniformly some OTHER wrong colour.
 */
async function isUniformFrame(page: Page): Promise<{ uniform: boolean; distinct: number }> {
  const distinct = await page.locator("canvas").evaluate((el) => {
    const src = el as HTMLCanvasElement;
    const N = 16;
    const off = document.createElement("canvas");
    off.width = N;
    off.height = N;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(src, 0, 0, N, N);
    const { data } = ctx.getImageData(0, 0, N, N);
    const seen = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    }
    return seen.size;
  });
  return { uniform: distinct <= 1, distinct };
}

/**
 * The three safety properties, asserted at the CURRENT camera pose: real altitude above
 * zero, the target within 1000 ft of `wantTarget`, and -- when `checkFrame` is true -- the
 * frame not black-screened.
 *
 * `checkFrame` DEFAULTS TO true BUT THE SWEEP BELOW THINS IT OUT. Altitude and target are
 * one cheap `window.__cam` read; the frame check is a real canvas readback
 * (`isUniformFrame`), and asserting it at every one of a few hundred 20-30px steps across
 * five stages is real wall-clock time under SwiftShader that buys very little over
 * checking it every few samples -- a black-screen bug (section 0.1's) does not flicker on
 * for one 20px step and off for the next, it holds for a whole sub-range of the drag once
 * it starts, so a stride still lands inside any real failure window while cutting the
 * total number of readbacks.
 */
async function assertSafe(
  page: Page,
  label: string,
  wantTarget: [number, number, number],
  checkFrame = true,
): Promise<void> {
  const c = await cam(page);
  expect(c.alt, `${label}: altitudeOf(camera) went to or below zero`).toBeGreaterThan(0);

  const dTarget = Math.hypot(
    c.target[0] - wantTarget[0],
    c.target[1] - wantTarget[1],
    c.target[2] - wantTarget[2],
  );
  expect(dTarget, `${label}: target drifted ${dTarget.toFixed(1)} ft from the stage's own`).toBeLessThan(
    1000,
  );

  if (!checkFrame) return;
  const { uniform, distinct } = await isUniformFrame(page);
  expect(uniform, `${label}: canvas is a single uniform colour (${distinct} distinct sample)`).toBe(
    false,
  );
}

/**
 * Sweep heading through +-720 degrees (four full turns) in 30 px steps, and separately
 * sweep pitch across a wide vertical range in 30 px steps, asserting altitude and target
 * at EVERY sample and the (expensive) black-screen check every FRAME_STRIDE'th one --
 * see assertSafe's own comment for why a stride still catches the failure mode.
 *
 * ONE CONTINUOUS DRAG PER SWEEP, not one drag per sample: CameraRig's drag handler reads
 * the store's live orbit on every pointermove, so a single mouse.move sequence with many
 * intermediate points exercises exactly the accumulation path a real drag gesture does,
 * which is also what section 0.1's own measured table (60 px steps within one drag) did.
 */
const FRAME_STRIDE = 3;

async function sweepHeadingAndPitch(page: Page, label: string, wantTarget: [number, number, number]) {
  const box = (await page.locator("canvas").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const STEP = 30;
  let sample = 0;
  const nextCheckFrame = () => (sample++ % FRAME_STRIDE === 0);

  // Heading: +-720 degrees equivalent, one continuous drag from +720 down to -720 (a
  // 1440-degree total traversal). DRAG_TURN_DEG is 360 deg per clientHeight
  // (CameraRig.tsx), so 720 degrees is two clientHeights of horizontal drag.
  const turnPx = box.height; // 360 degrees of heading, at CameraRig's own DRAG_TURN_DEG rate
  await page.mouse.move(cx + 2 * turnPx, cy);
  await page.mouse.down();
  let x = cx + 2 * turnPx; // +720 deg
  const leftEdge = cx - 2 * turnPx; // -720 deg
  while (x > leftEdge) {
    x = Math.max(leftEdge, x - STEP);
    await page.mouse.move(x, cy);
    await assertSafe(
      page,
      `${label} heading ${(((x - cx) / turnPx) * 360).toFixed(0)}deg`,
      wantTarget,
      nextCheckFrame(),
    );
  }
  await page.mouse.up();
  await page.waitForTimeout(60);

  // Pitch: swept well past any stage's clamp on both ends (+-360 degrees of drag, twice
  // the widest clamp this app has, 89 - 2 = 87 degrees), so the clamp itself is exercised
  // at both extremes rather than merely approached.
  await page.mouse.move(cx, cy - turnPx);
  await page.mouse.down();
  let y = cy - turnPx;
  const bottomEdge = cy + turnPx;
  while (y < bottomEdge) {
    y = Math.min(bottomEdge, y + STEP);
    await page.mouse.move(cx, y);
    await assertSafe(page, `${label} pitch drag ${y - cy}px`, wantTarget, nextCheckFrame());
  }
  await page.mouse.up();
  await page.waitForTimeout(60);
}

for (const stage of [0, 1, 2, 3, 4]) {
  test(`stage ${stage}: dragging +-720deg of heading and the full pitch clamp never sends altitude negative or black-screens the frame`, async ({
    page,
  }) => {
    await open(page);
    await gotoStage(page, stage);

    const before = await cam(page);
    expect(before.stage, "did not land on the requested stage").toBe(stage);
    await assertSafe(page, `${stage} at rest`, before.target);

    await sweepHeadingAndPitch(page, `stage ${stage}`, before.target);

    // Reset-view returns the orbit to null, which is also the "did the button survive
    // this stage's own redesign" gate: every stage < LAST_STAGE has one now (Hud.tsx).
    await page.getByTestId("reset-view").click();
    await page.waitForTimeout(300);
    const after = await cam(page);
    expect(after.stage, "reset-view changed the stage").toBe(stage);
    await assertSafe(page, `${stage} after reset`, before.target);
  });
}

/**
 * Stage 5 is first-person and pointer-locked (FirstPerson.tsx), not the orbit drag this
 * spec exercises above -- CameraRig.tsx's drag/wheel effect is deliberately unmounted
 * there (`if (stage === LAST_STAGE) return`) so it does not compete with the walker's own
 * pointer-lock look. Its keyboard equivalent (R/F to look up and down, A/D or the arrow
 * keys to turn) is the accessible path MASTER.md requires for every canvas interaction
 * and pointer lock cannot be driven headlessly in CI, so this exercises THAT instead of
 * a mouse drag -- the same three safety properties, at a stage this task's own bug table
 * (section 0.1) never put the fault at, but that must not regress either.
 */
test("stage 5: looking around with the keyboard (R/F pitch, A/D heading) never sends altitude negative or black-screens the frame", async ({
  page,
}) => {
  await open(page);
  await gotoStage(page, 5);
  const before = await cam(page);
  expect(before.stage).toBe(5);
  await assertSafe(page, "stage 5 at rest", before.target);

  const press = async (key: string, times: number) => {
    for (let i = 0; i < times; i++) {
      await page.keyboard.press(key);
      await page.waitForTimeout(40);
    }
  };

  await press("f", 20); // look down, toward -85 degrees
  await assertSafe(page, "stage 5 after looking down", (await cam(page)).target);
  await press("r", 40); // back up and past level, toward +85 degrees
  await assertSafe(page, "stage 5 after looking up", (await cam(page)).target);
  await press("r", 20); // settle back toward the middle of the range
  await press("d", 60); // turn right, well past a full circle at this turn rate
  await assertSafe(page, "stage 5 after turning right", (await cam(page)).target);
  await press("a", 120); // turn left, past a full circle the other way
  await assertSafe(page, "stage 5 after turning left", (await cam(page)).target);
});
