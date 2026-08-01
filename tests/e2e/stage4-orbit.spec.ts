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

/** Scrubs the master slider to t = 1 and waits for the eased position to settle. */
async function scrubToCrossingAndSettle(page: Page): Promise<Cam> {
  const slider = page.getByTestId("threshold-t").first();
  await slider.evaluate((el: HTMLInputElement) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, "1");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  // The exponential ease needs real settle time, not one frame -- 1 - exp(-delta * 3.2)
  // converges gradually rather than snapping, so this waits several seconds under
  // SwiftShader rather than the ~1.4 s other specs use for a plain stage change.
  await page.waitForTimeout(4000);
  return cam(page);
}

test("scrubbing to t = 1 after a drag still lands at the undragged crossing", async ({ page }) => {
  // The regression fence's real-browser counterpart: stage4Pose's funnel(t) = 1
  // identity at SHELL_GONE means the dragged pose and the undragged one must
  // converge to the SAME position at t = 1, however far apart they started at
  // t = 0. BOTH sides of the comparison must be taken AT t = 1 -- comparing a
  // dragged t = 1 pose against an undragged t = 0 one is a different bug this
  // spec's first draft made, and it fails for a reason that has nothing to do
  // with the funnel: kf[4] (t = 0) and kf[5] (t = 1) are simply different poses.
  await atStage4(page);
  const undragged = await scrubToCrossingAndSettle(page);
  expect(undragged.t).toBe(1);

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
  expect(settled.t).toBe(1);
  const residual = Math.hypot(
    settled.position[0] - undragged.position[0],
    settled.position[1] - undragged.position[1],
    settled.position[2] - undragged.position[2],
  );
  expect(residual, "the dragged and undragged runs disagree at the crossing").toBeLessThan(0.05);
});
