import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import { boundaries } from "@/scene/journey";
import { keyframes } from "@/scene/stages";
import { R_EARTH_FT } from "@/scene/altitude";

/**
 * P10 step 7: the wheel drives the descent at every stage but the last, and dragging at
 * stage 0 turns the globe instead of orbiting Weld.
 *
 * WHY window.__cam AND NOT THE DOM, same reasoning as edit.spec.ts and journey.spec.ts: the
 * thing under test is a WebGL camera, and CameraRig.tsx already publishes exactly the
 * fields these gates need -- position, target, u -- every frame.
 *
 * Slower than the 30 s default for the reason edit.spec.ts's own note gives: real pointer
 * gestures and real wheel notches against a SwiftShader renderer at a 62 ms median frame.
 */
test.setTimeout(120_000);

type Cam = {
  stage: number;
  t: number;
  position: [number, number, number];
  target: [number, number, number];
  alt: number;
  u: number;
};

const cam = (page: Page) => page.evaluate(() => (window as unknown as { __cam: Cam }).__cam);

/** MOVE_EPS from CameraRig.tsx: how far a copied pose is allowed to differ, in ft. */
const MOVE_EPS = 0.01;

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
}

async function gotoStage(page: Page, stage: number) {
  await page.getByTestId(`stage-${stage}`).click();
  await page.waitForTimeout(1400); // camera settles, same wait journey.spec.ts uses
}

/**
 * One wheel notch over the canvas's centre. Chrome's own notch is 100 of deltaY.
 *
 * The wait after is 250 ms, not 50: playwright.config.ts records a 62 ms MEDIAN frame
 * under SwiftShader at three workers, with tails past 200 ms under contention, and
 * window.__cam is only written once a frame actually renders. A wait shorter than a
 * frame reads the PREVIOUS notch's result rather than this one's -- measured directly,
 * a 50 ms wait made ten notches look like nine, the first one silently invisible.
 */
async function wheelNotch(page: Page, deltaY: number) {
  const box = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
  await page.waitForTimeout(250);
}

/** A pointer drag of (dx, dy) px, centred on the canvas. */
async function drag(page: Page, dx: number, dy: number) {
  const box = (await page.locator("canvas").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 10 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 });
  await page.mouse.up();
}

/** The average screen-x of the crimson Weld marker (#e4526f), or null if none is on screen. */
async function markerX(page: Page): Promise<number | null> {
  return page.locator("canvas").evaluate((el) => {
    const src = el as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    let sumX = 0;
    let count = 0;
    for (let y = 0; y < off.height; y++) {
      for (let x = 0; x < off.width; x++) {
        const i = (y * off.width + x) * 4;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        if (Math.abs(r - 228) < 30 && Math.abs(g - 82) < 30 && Math.abs(b - 111) < 30) {
          sumX += x;
          count++;
        }
      }
    }
    return count > 0 ? sumX / count : null;
  });
}

test("stage 1: wheel notches down scrub the journey forward and descend, and up reverses it", async ({
  page,
}) => {
  await open(page);
  await gotoStage(page, 1);
  const before = await cam(page);

  const samples: Cam[] = [before];
  for (let i = 0; i < 10; i++) {
    await wheelNotch(page, 100);
    samples.push(await cam(page));
  }
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i]!.u, `notch ${i} did not advance u`).toBeGreaterThan(samples[i - 1]!.u);
    expect(samples[i]!.alt, `notch ${i} did not descend`).toBeLessThan(samples[i - 1]!.alt);
  }

  for (let i = 0; i < 10; i++) await wheelNotch(page, -100);
  const back = await cam(page);
  // Within one notch's worth of u of where the sweep started.
  expect(Math.abs(back.u - before.u)).toBeLessThan(0.02 + 1e-6);
});

test("stage 3: wheel changes the orbit radius and leaves u alone", async ({ page }) => {
  await open(page);
  await gotoStage(page, 3);
  const before = await cam(page);
  const radiusOf = (c: Cam) =>
    Math.hypot(
      c.position[0] - c.target[0],
      c.position[1] - c.target[1],
      c.position[2] - c.target[2],
    );

  await wheelNotch(page, 100);
  const after = await cam(page);

  expect(radiusOf(after)).not.toBeCloseTo(radiusOf(before), 1);
  expect(after.u).toBeCloseTo(before.u, 9);
});

test("stage 0: a 200px drag turns the globe, moving the camera measurably", async ({ page }) => {
  await open(page);
  // Stage 0 is the default, but wait for the settle the same way gotoStage does elsewhere.
  await page.waitForTimeout(1400);
  const before = await cam(page);
  const distToCentre = Math.hypot(before.position[0], before.position[1] + R_EARTH_FT, before.position[2]);

  await drag(page, 200, 0);
  await page.waitForTimeout(400);
  const after = await cam(page);

  const moved = Math.hypot(
    after.position[0] - before.position[0],
    after.position[1] - before.position[1],
    after.position[2] - before.position[2],
  );
  expect(moved, `moved ${moved.toFixed(1)} ft against 1% of ${distToCentre.toFixed(1)} ft`).toBeGreaterThan(
    distToCentre * 0.01,
  );
});

/**
 * scrub to a given u via the master slider (pointerdown first, so `scrubbing` is true and
 * CameraRig copies the pose rather than easing toward it).
 *
 * The DOM range input's own value-sanitisation algorithm snaps whatever is written to the
 * nearest multiple of its `step` (0.0005, JourneyBar.tsx) -- measured directly: writing
 * boundaries(params)[1] verbatim came back as stage 0 at t = 0.999839, not t = 1, because
 * the exact tie point is not itself a multiple of the step. So this is never exact at a
 * boundary; it is exact to within half a step of u, which is what the two tests below are
 * built around rather than fighting.
 */
async function scrubTo(page: Page, u: number) {
  await page.evaluate((uu) => {
    const slider = document.querySelector('[data-testid="journey"]') as HTMLInputElement;
    slider.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(slider, String(uu));
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }, u);
  // Over one SwiftShader frame (62 ms median, see wheelNotch's own note), so the copy this
  // depends on has actually rendered by the time __cam is read.
  await page.waitForTimeout(400);
}

test("stage 0: approaching boundaries[1] shrinks the turn's effect toward zero, and stage 1's own tick lands exactly on kf[1]", async ({
  page,
}) => {
  await open(page);
  await page.waitForTimeout(1400);

  // Turn the globe first, so the guarantee actually has something to survive: without this,
  // globeSpin is null throughout and every assertion below would hold trivially.
  await drag(page, 150, 40);
  await page.waitForTimeout(300);

  const u1 = boundaries(DEFAULT_PARAMS)[1]!;
  const kf1 = keyframes(DEFAULT_PARAMS)[1]!;
  const distTo1 = (c: Cam) =>
    Math.hypot(
      c.position[0] - kf1.position[0],
      c.position[1] - kf1.position[1],
      c.position[2] - kf1.position[2],
    );

  // Three points approaching the boundary from below, each a step closer. Still stage 0 --
  // (1 - t) is still positive at all three -- so the turn still has SOME effect, but the
  // (1 - t) factor shrinks it as t climbs toward 1.
  const STEP = 0.0005;
  const distances: number[] = [];
  for (const back of [6, 3, 1]) {
    await scrubTo(page, u1 - back * STEP);
    const c = await cam(page);
    expect(c.stage, `u1 - ${back} steps landed outside stage 0`).toBe(0);
    distances.push(distTo1(c));
  }
  expect(distances[1]!, "did not shrink between step 6 and step 3").toBeLessThan(distances[0]!);
  expect(distances[2]!, "did not shrink between step 3 and step 1").toBeLessThan(distances[1]!);

  // Stage 1's own tick: an exact jump (setStage bumps `cuts`, so CameraRig copies rather
  // than eases) to t = 0 with no spin branch at all, since spinPose only ever applies at
  // stage 0. This is the (1 - t) guarantee's actual endpoint -- whatever the globe was
  // turned to, arriving at stage 1 lands on kf[1] exactly, not on a place the turn left off.
  await page.getByTestId("stage-1").click();
  await page.waitForTimeout(300);
  const at = await cam(page);
  expect(at.stage).toBe(1);
  expect(
    distTo1(at),
    `got ${JSON.stringify(at.position)}, want ${JSON.stringify(kf1.position)}`,
  ).toBeLessThan(MOVE_EPS);
});

test("reset-view at stage 0 turns the globe back off", async ({ page }) => {
  await open(page);
  await page.waitForTimeout(1400);
  const before = await cam(page);
  const centre = { x: 0, y: -R_EARTH_FT, z: 0 };
  const radius = Math.hypot(before.position[0] - centre.x, before.position[1] - centre.y, before.position[2] - centre.z);

  // A small turn, not the 200px used elsewhere: the ease back to kf[0] converges
  // exponentially regardless of how far the drag went, so a modest turn is enough to prove
  // the button works without the test itself needing a long settle.
  await drag(page, 60, 15);
  await page.waitForTimeout(300);
  const turned = await cam(page);
  const movedAway = Math.hypot(
    turned.position[0] - before.position[0],
    turned.position[1] - before.position[1],
    turned.position[2] - before.position[2],
  );
  expect(movedAway, "the drag did not turn the globe").toBeGreaterThan(radius * 0.0005);

  await page.getByTestId("reset-view").click();

  await expect
    .poll(
      async () => {
        const c = await cam(page);
        return (
          Math.hypot(
            c.position[0] - before.position[0],
            c.position[1] - before.position[1],
            c.position[2] - before.position[2],
          ) / radius
        );
      },
      { timeout: 15_000, message: "reset-view did not converge back to kf[0]" },
    )
    .toBeLessThan(1e-4);
});

/**
 * SIGN CHECK, BY SCREENSHOT RATHER THAN BY MATHS.
 *
 * The sign is a choice, and CameraRig.tsx's drag comment at stage 0 states the convention it
 * is made to agree with: the same "surface under the cursor follows the cursor" rule stage
 * 3's orbit drag already uses. This is the gate that keeps the two agreeing -- it asserts
 * whatever direction that convention actually produces, measured, rather than an assumed one.
 */
test("stage 0: dragging right moves the crimson marker's screen-x, in the direction CameraRig's drag comment establishes", async ({
  page,
}) => {
  await open(page);
  await page.waitForTimeout(1400);
  const before = await markerX(page);
  expect(before, "the marker was not visible before the drag").not.toBeNull();

  // A modest drag, not the 200 px used above: 200 px is 100 degrees of yaw at this
  // viewport's clientHeight, which turns the marker past the limb entirely and off
  // screen -- measured, not assumed. 60 px (30 degrees) is a real drag that keeps the
  // marker on screen at every viewport this suite runs at.
  await drag(page, 60, 0);
  await page.waitForTimeout(300);
  const after = await markerX(page);
  expect(after, "the marker was not visible after the drag").not.toBeNull();

  // The direction itself, MEASURED rather than assumed: dragging right at stage 0 turns
  // the globe so the marker's screen-x increases, the same "surface under the cursor
  // follows the cursor" direction stage 3's orbit drag already establishes.
  expect(after!, `marker cx before=${before} after=${after}`).toBeGreaterThan(before!);
});
