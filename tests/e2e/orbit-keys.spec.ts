import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import { keyframes } from "@/scene/stages";
import {
  STAGE3_CLAMP,
  clampOrbit,
  orbitKeyframe,
  orbitOf,
  transitPose,
  MASSING_CENTER,
  type Orbit,
} from "@/scene/orbit";
import { fromJourney } from "@/scene/journey";
import { LAST_STAGE } from "@/state/store";

/**
 * P10 step 8: the orbit keys move from six on-screen buttons to a window handler, at
 * stage 3 only. The buttons are gone (step 5); this file is the gate that keeps their
 * keyboard behaviour alive without them.
 *
 * Slower than the 30 s default for the reason wheel-and-spin.spec.ts's own note gives:
 * real key events against a SwiftShader renderer at a 62 ms median frame, and the
 * ease CameraRig applies to every orbit nudge needs real wall-clock time to converge.
 */
test.setTimeout(120_000);

type Cam = {
  stage: number;
  u: number;
  position: [number, number, number];
};

const cam = (page: Page) => page.evaluate(() => (window as unknown as { __cam: Cam }).__cam);

/** MOVE_EPS from CameraRig.tsx: how far a copied pose is allowed to differ, in ft. */
const MOVE_EPS = 0.01;

/**
 * Degrees per press and the zoom factor per press, computed the same way Hud.tsx
 * derives them -- from STAGE3_CLAMP's own span -- so this file cannot drift from the
 * production constants without both changing together.
 */
const STEP_DEG = 5;
const ZOOM_PRESSES = 15;
const ZOOM_PER_PRESS = (STAGE3_CLAMP.maxRadius / STAGE3_CLAMP.minRadius) ** (1 / ZOOM_PRESSES);

const KF3 = keyframes(DEFAULT_PARAMS)[3]!;
const KF4 = keyframes(DEFAULT_PARAMS)[4]!;
const SEED: Orbit = orbitOf(KF3);

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
}

async function gotoStage(page: Page, stage: number) {
  await page.getByTestId(`stage-${stage}`).click();
  await page.waitForTimeout(1400); // camera settles, same wait wheel-and-spin.spec.ts uses
}

/**
 * A keydown dispatched straight on the window, bypassing Playwright's own keyboard
 * layout mapping -- the same choice wheel-and-spin.spec.ts's scrubTo() makes for the
 * master scrubber, and for the same reason here: `+`, `=`, `-` and `_` all sit behind a
 * Shift-dependent US layout, and this way the event's `key` is exactly the string the
 * handler switches on, with no layout in between to get wrong.
 */
async function pressWindowKey(page: Page, key: string) {
  await page.evaluate((k) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  }, key);
}

/** Euclidean distance between two [x, y, z] triples. */
function dist(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * The ten keys this handler owns, and the orbit each predicts starting from SEED --
 * kf[3]'s own orbit, which is what stage 3 opens on before any key or drag touches it.
 */
type Nudge = { az?: number; polar?: number; zoom?: number };

const NUDGES: { key: string; nudge: Nudge }[] = [
  { key: "ArrowLeft", nudge: { az: -STEP_DEG } },
  { key: "ArrowRight", nudge: { az: STEP_DEG } },
  { key: "ArrowUp", nudge: { polar: STEP_DEG } },
  { key: "ArrowDown", nudge: { polar: -STEP_DEG } },
  { key: "PageUp", nudge: { zoom: 1 / ZOOM_PER_PRESS } },
  { key: "+", nudge: { zoom: 1 / ZOOM_PER_PRESS } },
  { key: "=", nudge: { zoom: 1 / ZOOM_PER_PRESS } },
  { key: "PageDown", nudge: { zoom: ZOOM_PER_PRESS } },
  { key: "-", nudge: { zoom: ZOOM_PER_PRESS } },
  { key: "_", nudge: { zoom: ZOOM_PER_PRESS } },
];

/** nudgeOrbit's own arithmetic (Hud.tsx), reproduced here so the prediction is independent. */
function predict(seed: Orbit, n: Nudge): Orbit {
  return clampOrbit({
    azimuthDeg: seed.azimuthDeg + (n.az ?? 0),
    polarDeg: seed.polarDeg + (n.polar ?? 0),
    radius: seed.radius * (n.zoom ?? 1),
  });
}

for (const { key, nudge } of NUDGES) {
  test(`stage 3: "${key}" moves the camera by STEP_DEG/ZOOM_PER_PRESS, within 1%`, async ({ page }) => {
    await open(page);
    await gotoStage(page, 3);

    const before = await cam(page);
    const wantOrbit = predict(SEED, nudge);
    const want = orbitKeyframe(KF3, wantOrbit);
    const wantMove = dist(want.position, before.position);
    expect(wantMove, "the predicted move is zero -- the test itself is broken").toBeGreaterThan(0.01);

    await pressWindowKey(page, key);

    // Poll rather than a fixed wait: CameraRig eases toward the target at rate 3.2/s
    // (k = 1 - exp(-delta * 3.2)), so the residual error after a fixed wait depends on
    // frame timing under contention. Polling to within 1% of the predicted move is the
    // actual claim under test, not a proxy for "waited long enough".
    await expect
      .poll(
        async () => {
          const c = await cam(page);
          return dist(c.position, want.position) / wantMove;
        },
        { timeout: 10_000, message: `"${key}" did not converge on the predicted pose` },
      )
      .toBeLessThan(0.01);
  });
}

test("a held ArrowLeft (30 keydowns, no keyup) moves 30 steps, not 1", async ({ page }) => {
  await open(page);
  await gotoStage(page, 3);

  const before = await cam(page);
  const wantOrbit = clampOrbit({ ...SEED, azimuthDeg: SEED.azimuthDeg - 30 * STEP_DEG });
  const want = orbitKeyframe(KF3, wantOrbit);
  const wantMove = dist(want.position, before.position);

  // Thirty keydowns with no keyup between them, dispatched in one page-side loop so
  // nothing outside the browser paces them apart. If nudgeOrbit read `orbit` from a
  // stale render closure rather than useStore.getState(), every one of the thirty would
  // apply its 5 degrees on top of the SAME starting angle and the net result would be
  // one step, not thirty -- this is the property nudgeOrbit's own docblock exists for.
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    }
  });

  await expect
    .poll(
      async () => {
        const c = await cam(page);
        return dist(c.position, want.position) / wantMove;
      },
      { timeout: 10_000, message: "30 held ArrowLeft keydowns did not add up to 30 steps" },
    )
    .toBeLessThan(0.01);

  // And the one-step reading is a real, different place -- ruling out a coincidence
  // where 30 steps and 1 step land close together (they do not: 30 x 5 = 150 degrees of
  // azimuth against 5).
  const oneStep = orbitKeyframe(KF3, predict(SEED, { az: -STEP_DEG }));
  expect(dist(want.position, oneStep.position)).toBeGreaterThan(wantMove * 0.5);
});

test("typing `[` into the sun-date input changes neither stage nor the stage-3 pose", async ({ page }) => {
  await open(page);
  await gotoStage(page, 3);
  const before = await cam(page);

  await page.getByTestId("view-fold").locator("summary").click();
  await page.getByTestId("sun-date").focus();
  await page.keyboard.press("[");
  await page.waitForTimeout(300);

  const after = await cam(page);
  expect(after.stage, "the bracket key changed stage from inside a text field").toBe(3);
  expect(dist(after.position, before.position), "the orbit moved").toBeLessThan(MOVE_EPS);
});

test("ArrowRight while the master scrubber has focus scrubs the journey and does not orbit", async ({ page }) => {
  await open(page);
  await gotoStage(page, 3);
  const before = await cam(page);

  await page.getByTestId("journey").focus();
  await page.keyboard.press("ArrowRight");

  // Polled, not a fixed wait: stage and u come straight from the store every frame, not
  // from the eased camera, but "every frame" still means waiting for a frame to actually
  // render, and playwright.config.ts records tails past 200 ms under SwiftShader
  // contention -- long enough that a fixed 150 ms wait intermittently read __cam before
  // ArrowRight's frame had landed (found by P10 step 11's full-suite reruns).
  await expect
    .poll(async () => (await cam(page)).u, {
      timeout: 5_000,
      message: "ArrowRight on the focused scrubber did not scrub",
    })
    .toBeGreaterThan(before.u);

  const after = await cam(page);
  expect(after.stage, "the scrub crossed a stage boundary -- shrink the test's own step").toBe(3);

  // The orbit handler must NOT also have fired. Predict the pose the scrub ALONE
  // produces: CameraRig's own stage-3 formula, transitPose from kf[3]'s orbit at SEED
  // (untouched) toward kf[4], at the t the ACTUAL scrubbed u implies. If the arrow key
  // had also nudged the orbit (a missed target gate), this prediction -- built from the
  // un-nudged seed -- would miss by the size of one orbit step (see the stage-3 key
  // tests above: several feet to tens of feet), not by float or ease noise.
  const { stage, t } = fromJourney(after.u, DEFAULT_PARAMS);
  expect(stage).toBe(3);
  const want = transitPose(orbitKeyframe(KF3, SEED), KF4, MASSING_CENTER, t);

  // Polled, not a fixed wait, for the reason the stage-3 key tests above poll: the
  // eased approach needs real wall-clock time and the tolerance is the actual claim.
  await expect
    .poll(
      async () => {
        const c = await cam(page);
        return dist(c.position, want.position);
      },
      { timeout: 10_000, message: "did not converge on the scrub-only prediction" },
    )
    .toBeLessThan(0.5);
});

test("orbit-live announces once, throttled, after a burst of key presses", async ({ page }) => {
  await open(page);
  await gotoStage(page, 3);
  await page.waitForTimeout(200);

  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="orbit-live"]')!;
    const w = window as unknown as { __liveHits: string[] };
    w.__liveHits = [];
    const obs = new MutationObserver(() => w.__liveHits.push(el.textContent ?? ""));
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    (w as unknown as { __liveObs: MutationObserver }).__liveObs = obs;
  });

  // A burst of five presses, 30 ms apart -- faster than ANNOUNCE_MS's 400, the same
  // shape a held key's OS repeat produces (30-90 ms at default macOS settings).
  for (let i = 0; i < 5; i++) {
    await pressWindowKey(page, "ArrowRight");
    await page.waitForTimeout(30);
  }

  // Well under ANNOUNCE_MS since the last press: nothing should have spoken yet.
  await page.waitForTimeout(200);
  const midHits = await page.evaluate(() => (window as unknown as { __liveHits: string[] }).__liveHits.length);
  expect(midHits, "announced before the burst settled").toBe(0);

  /*
   * Now past ANNOUNCE_MS since the last press -- POLLED for the arrival rather than waited out on
   * a flat 400 ms, and then held still to prove it stayed at exactly one.
   *
   * MERGE NOTE (P10 integration). The flat wait gave 200 ms of margin over ANNOUNCE_MS and it
   * failed on the merged build while passing on `p10-ux` alone. Measured against a dev server, the
   * announcement is correct and singular -- one hit, "Azimuth 167 degrees, polar 74 degrees, 251
   * feet out." against an opening reading of 142 -- it simply lands after 600 ms rather than
   * inside it. The merged scene is heavier than any one branch's (CampusMesh's real Harvard
   * geometry, the rebuilt interior and the dock, all at once), so the re-render that follows the
   * timeout costs more wall clock under SwiftShader than it did on the branch this was written on.
   *
   * BOTH HALVES OF THE CLAIM SURVIVE, and that is the reason this is a widened window rather than
   * a weakened gate. Silent during the burst is still asserted on its own tight 200 ms window
   * above. Exactly one afterwards is asserted below -- polling for the arrival and then settling
   * for longer than the throttle before counting, so a handler that spoke twice still fails.
   */
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => (window as unknown as { __liveHits: string[] }).__liveHits)).length,
      { timeout: 10_000, message: "the throttled announcement never arrived" },
    )
    .toBeGreaterThan(0);
  await page.waitForTimeout(800);
  const hits = await page.evaluate(() => (window as unknown as { __liveHits: string[] }).__liveHits);
  expect(hits.length, `announced ${hits.length} times, want exactly one: ${JSON.stringify(hits)}`).toBe(1);
});

test("the six retired orbit-* buttons are absent from the DOM at every stage", async ({ page }) => {
  await open(page);
  const ids = ["left", "right", "up", "down", "in", "out"];
  for (let stage = 0; stage <= LAST_STAGE; stage++) {
    await gotoStage(page, stage);
    for (const id of ids) {
      await expect(page.locator(`[data-testid="orbit-${id}"]`)).toHaveCount(0);
    }
  }
});
