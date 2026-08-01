import { test, expect, type Page } from "@playwright/test";

/**
 * P10's D3: stage 4 takes the drag, and the funnel resolves it back onto the
 * crossing regardless of where the viewer left the camera.
 *
 * Mirrors journey.spec.ts's own stage-3 conventions: window.__cam is the
 * probe (CameraRig.tsx), stage-4 by testid rather than the skip link (which
 * sits off-screen until focused -- edit.spec.ts's own note).
 */
test.setTimeout(120_000);

type Cam = {
  stage: number;
  t: number;
  position: [number, number, number];
  target: [number, number, number];
};

const cam = (page: Page) => page.evaluate(() => (window as unknown as { __cam: Cam }).__cam);

async function atStage4(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("stage-4").click();
  await page.waitForTimeout(1400);
  await expect.poll(async () => (await cam(page)).stage, { timeout: 15_000 }).toBe(4);
}

/** A drag on the canvas, well clear of the HUD panel, which sits centred. */
async function dragCanvas(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 20 });
  await page.mouse.up();
}

test("dragging at stage 4 changes the camera position", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await atStage4(page);
  const before = await cam(page);
  expect(before.t).toBe(0);

  await dragCanvas(page, [200, 400], [700, 200]);
  await page.waitForTimeout(1000);
  const after = await cam(page);

  const moved = Math.hypot(
    after.position[0] - before.position[0],
    after.position[1] - before.position[1],
    after.position[2] - before.position[2],
  );
  expect(moved, "the drag did not move the camera").toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

/**
 * Scrubs stage 4 past its funnel and waits for the eased position to settle.
 *
 * MERGE NOTE (P10 integration), and it changes the target as well as the control.
 *
 * THE CONTROL. This drove `threshold-t`, the per-stage slider stage 4 used to carry. `p10-ux`
 * folded every per-stage scrubber into one master bar -- `journey`, which carries `u` across the
 * whole descent rather than a per-stage `t` -- so that testid no longer exists and this helper
 * timed out waiting for it. The conversion goes through `window.__journey` (JourneyBar.tsx's own
 * probe), exactly as threshold.spec.ts's `statsAt()` does, rather than through a second copy of
 * journey.ts's mapping, and is floored onto the slider's own 0.0005 step for the reason that
 * spec records (fill() rejects a value off the step).
 *
 * THE TARGET, AND WHY IT IS NO LONGER t = 1. Stage 4 at t = 1 and stage 5 at t = 0 are the same
 * point of the journey, and fromJourney() resolves that point to STAGE 5 (journey.ts's `x >= 1`
 * branch). Asking the master bar for stage 4's t = 1 therefore lands on stage 5, where the walker
 * -- seeded on every arrival since p10-walk-in -- owns the camera, and the funnel identity this
 * test exists to prove is not what would be under test any more.
 *
 * SO IT ASKS FOR t = 0.9, AND THE PROPERTY IS UNCHANGED, because funnel() is not a ramp to 1 at
 * t = 1: stages.ts clamps it to exactly 1 for every t >= SHELL_GONE = 0.7. Above that threshold
 * stage4Pose() ignores the held orbit entirely and returns the path pose, so the dragged and
 * undragged runs must agree at 0.9 for precisely the same reason they had to agree at 1.0, and
 * 0.9 has the margin over 0.7 that 1.0 has over the stage boundary.
 */
const CROSSING_T = 0.9;

async function scrubToCrossingAndSettle(page: Page): Promise<Cam> {
  const slider = page.getByTestId("journey");
  const u = await page.evaluate((tt) => {
    const j = (window as unknown as { __journey: { boundaries: number[]; spans: number[]; total: number } })
      .__journey;
    const raw = j.boundaries[4]! + (tt * j.spans[4]!) / j.total;
    return Math.floor(raw / 0.0005) * 0.0005;
  }, CROSSING_T);
  await slider.fill(String(u));
  await slider.dispatchEvent("input");
  // The exponential ease needs real settle time, not one frame -- 1 - exp(-delta * 3.2)
  // converges gradually rather than snapping, so this waits several seconds under
  // SwiftShader rather than the ~1.4 s other specs use for a plain stage change.
  await page.waitForTimeout(4000);
  return cam(page);
}

test("scrubbing past the funnel after a drag still lands at the undragged crossing", async ({ page }) => {
  // The regression fence's real-browser counterpart: stage4Pose's funnel(t) = 1
  // identity above SHELL_GONE means the dragged pose and the undragged one must
  // converge to the SAME position there, however far apart they started at t = 0.
  // BOTH sides of the comparison must be taken at the SAME t -- comparing a dragged
  // late pose against an undragged t = 0 one is a different bug this spec's first
  // draft made, and it fails for a reason that has nothing to do with the funnel:
  // kf[4] (t = 0) and the crossing are simply different poses. See
  // scrubToCrossingAndSettle's header for why that shared t is 0.9 and not 1.
  await atStage4(page);
  const undragged = await scrubToCrossingAndSettle(page);
  expect(undragged.stage, "the scrub must stay on stage 4, not tip into 5").toBe(4);
  expect(undragged.t).toBeGreaterThanOrEqual(0.7);

  await page.getByTestId("stage-4").click(); // back to t = 0, fresh
  await page.waitForTimeout(1000);
  const beforeDrag = await cam(page);
  await dragCanvas(page, [150, 500], [750, 150]);
  await page.waitForTimeout(1000);
  const dragged = await cam(page);
  // Confirms the drag actually moved it before proving the endpoint agrees anyway.
  const preMove = Math.hypot(
    dragged.position[0] - beforeDrag.position[0],
    dragged.position[1] - beforeDrag.position[1],
    dragged.position[2] - beforeDrag.position[2],
  );
  expect(preMove).toBeGreaterThan(20);

  const settled = await scrubToCrossingAndSettle(page);
  expect(settled.stage).toBe(4);
  expect(settled.t).toBeCloseTo(undragged.t, 6);
  const residual = Math.hypot(
    settled.position[0] - undragged.position[0],
    settled.position[1] - undragged.position[1],
    settled.position[2] - undragged.position[2],
  );
  expect(residual, "the dragged and undragged runs disagree at the crossing").toBeLessThan(0.05);
});
