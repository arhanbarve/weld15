import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import { boundaries } from "@/scene/journey";

/**
 * P10 step 3's gate: scrubbing the whole descent must never un-settle the camera.
 *
 * BEFORE THIS STEP, CameraRig's un-settle effect watched `stage`, and setJourney (what the
 * master scrubber calls) changes `stage` on every tick that crosses a boundary -- so a smooth
 * drag restarted the ease at each of the five stage transitions, which reads as a pop even
 * though the poses on either side are geometrically identical. The fix (CameraRig.tsx) swapped
 * the dependency from `stage` to `cuts`, a counter store.ts bumps only on a genuine jump
 * (setStage, next, prev, skipToSuite, enter/leaveFirstPerson) and never on setJourney. This
 * spec drives the mapping the other way round from those gates: instead of asserting a jump
 * happens, it asserts one does NOT happen across a continuous drag.
 *
 * THREE X THE MEDIAN, NOT AN ABSOLUTE FOOT FIGURE, because the descent is log-weighted --
 * journey.ts's header explains why -- so a step near the globe covers orders of magnitude more
 * ground than a step inside the suite. A ratio to the sweep's own median step is the only bound
 * that means the same thing at both ends. Under the pre-fix behaviour the boundary steps are
 * exactly where this would have failed: the position either side of a boundary is unchanged, so
 * the old defect was never a large position jump, it was `settled.current` going false and the
 * NEXT frame copying the target instead of easing toward it -- which the `cuts` assertion below
 * catches directly, and which a position-only ratio test could in principle miss if the ease
 * and the copy landed at nearly the same spot. Both assertions are kept for that reason.
 *
 * SKIPPED FOR NOW: `[data-testid="journey"]` is the master slider Step 5 (JourneyBar) adds, and
 * it does not exist yet in this checkout. There is no other way to drive an arbitrary u today --
 * there is no window.__store-style probe in this codebase to call setJourney() from outside, by
 * design (window.__weld in UrlSync.tsx is read-only, on purpose, per its own docblock). Everything
 * below is written to run as soon as the slider lands; the only change Step 5's agent should need
 * to make is deleting `.skip`.
 */
test.setTimeout(120_000);

type Weld = { stage: number };
type Cam = { position: [number, number, number]; u: number; cuts: number };

const weld = (page: Page) => page.evaluate(() => (window as unknown as { __weld: Weld }).__weld);

/** The app, booted, with the descent settled at stage 0. */
async function open(page: Page) {
  await page.goto("/");
  await page.locator("canvas").waitFor();
  await expect.poll(async () => (await weld(page)).stage, { timeout: 15_000 }).toBe(0);
}

const STEPS = 200;
const SETTLE_MS = 60;

/**
 * Drives `[data-testid="journey"]` through STEPS equal ticks of u, one direction, and records
 * __cam at every stop.
 *
 * Runs inside the page rather than round-tripping from Node, same reasoning as
 * a11y.spec.ts's throttle sweep: 200 steps at tens of milliseconds of IPC each would make the
 * gaps between events, not the settle time, the thing being measured.
 *
 * The value goes in through HTMLInputElement.prototype's own setter rather than assigning
 * `.value` directly -- see a11y.spec.ts:313's note. A plain assignment updates React's value
 * tracker along with the DOM, so the dispatched `input` event looks like a no-op change and the
 * handler never runs.
 */
async function sweep(page: Page, direction: "forward" | "reverse"): Promise<Cam[]> {
  return page.evaluate(
    async ({ steps, settleMs, direction }) => {
      const slider = document.querySelector('[data-testid="journey"]') as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      const cams: Cam[] = [];
      for (let i = 0; i <= steps; i++) {
        const frac = i / steps;
        const u = direction === "forward" ? frac : 1 - frac;
        setValue.call(slider, String(u));
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, settleMs));
        const c = (window as unknown as { __cam: Cam }).__cam;
        cams.push({ position: c.position, u: c.u, cuts: c.cuts });
      }
      return cams;
    },
    { steps: STEPS, settleMs: SETTLE_MS, direction },
  );
}

/** Straight-line distance between two recorded camera positions, ft. */
function stepLength(a: Cam, b: Cam): number {
  return Math.hypot(
    b.position[0] - a.position[0],
    b.position[1] - a.position[1],
    b.position[2] - a.position[2],
  );
}

// The five stage transitions journey.ts's boundaries() marks -- 0->1, 1->2, 2->3 (transit),
// 3->4 (threshold), 4->5 (hall) -- named individually because these are exactly the points a
// pre-fix run would have failed at, and a bare index into a 200-entry array would not say why.
const BOUNDARY_NAMES = ["0 -> 1", "1 -> 2", "2 -> 3 (transit)", "3 -> 4 (threshold)", "4 -> 5 (hall)"];

test.skip(
  "scrubbing the whole descent never bumps cuts or pops the camera",
  async ({ page }) => {
    await open(page);

    // boundaries(params)[0] is 0, the start of the sweep rather than a transition; the five
    // transitions are the remaining entries.
    const boundaryUs = boundaries(DEFAULT_PARAMS).slice(1);
    expect(boundaryUs).toHaveLength(5);

    for (const direction of ["forward", "reverse"] as const) {
      const cams = await sweep(page, direction);
      expect(cams).toHaveLength(STEPS + 1);

      const cutsAtStart = cams[0]!.cuts;
      for (const [i, c] of cams.entries()) {
        expect(c.cuts, `cuts changed at step ${i} (${direction}), u=${c.u.toFixed(4)}`).toBe(
          cutsAtStart,
        );
      }

      const lens: number[] = [];
      for (let i = 1; i < cams.length; i++) lens.push(stepLength(cams[i - 1]!, cams[i]!));

      const sorted = [...lens].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)]!;
      const limit = median * 3;

      lens.forEach((len, i) => {
        expect(
          len,
          `step ${i} (${direction}) moved ${len.toFixed(4)} ft, over 3x the median ${median.toFixed(4)} ft`,
        ).toBeLessThanOrEqual(limit);
      });

      // The five boundary steps specifically -- the ones a pre-fix run failed at.
      boundaryUs.forEach((b, idx) => {
        const step = direction === "forward" ? Math.round(b * STEPS) : STEPS - Math.round(b * STEPS);
        const lenIndex = Math.min(lens.length - 1, Math.max(0, step - 1));
        const len = lens[lenIndex]!;
        expect(
          len,
          `boundary ${BOUNDARY_NAMES[idx]} at u=${b.toFixed(4)} (${direction}) moved ` +
            `${len.toFixed(4)} ft, over 3x the median ${median.toFixed(4)} ft`,
        ).toBeLessThanOrEqual(limit);
      });
    }
  },
);
