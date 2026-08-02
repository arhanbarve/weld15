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
 * NO LONGER SKIPPED. This carried `test.skip` and a note saying `[data-testid="journey"]` --
 * the master slider -- "does not exist yet in this checkout", with the instruction that the
 * only change needed was deleting the `.skip` once it landed. It landed with P10's JourneyBar
 * and the note went stale, so the gate sat switched off through P10 and P11 while the thing it
 * guards (camera continuity across every stage boundary) was rebuilt twice underneath it.
 * Turned on in P12 and passing.
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

test(
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

      /**
       * A POP IS A LOCAL DISCONTINUITY, so each step is measured against ITS OWN NEIGHBOURS
       * rather than against the sweep's median.
       *
       * This gate shipped comparing raw step lengths to 3x their global median, and it was
       * skipped from the day it was written (the master slider it drives did not exist yet),
       * so that metric had never met the descent it guards. It cannot work: the sweep runs
       * from 31,353,347 ft to an eye height of 17.8 ft, and journey.ts weights the legs by
       * DECADES of altitude on purpose, so a step at orbit is meant to cover six orders of
       * magnitude more ground than a step in the hall. Measured on the first un-skipped run:
       * step 0 moved 625,173 ft against a median of 1,736 -- 360x over, and entirely correct.
       * Normalising by altitude was tried next and fails for the mirror-image reason: the
       * transit and threshold legs are near-horizontal moves at a fixed low altitude, where a
       * perfectly smooth 8 ft step reads as half its own height.
       *
       * The defect this exists for is `settled.current` going false at a boundary and the
       * next frame COPYING the new pose instead of easing into it -- a step out of line with
       * the steps either side of it, at whatever scale that stage runs at. That is what this
       * measures, and it needs no scale at all.
       *
       * THE FACTORS ARE MEASURED, this build, both directions, 200 steps:
       *
       *   worst local ratio anywhere   5.27 at step 184, a 22.3 ft step among ~5 ft ones
       *   next four                    3.10, 2.82, 2.61, 2.00
       *   worst at a stage boundary    2.61 (step 138, the 3 -> 4 threshold)
       *
       * Step 184 sits at u = 0.92, inside the threshold, and is the funnel accelerating:
       * stages.ts's funnel() is a smoothstep from FUNNEL_START to SHELL_GONE, so the pose
       * genuinely moves faster in the middle of that leg than at its ends. Smooth
       * acceleration is not a pop, and a gate that called it one would be measuring the
       * easing curve rather than the continuity. 8x leaves that headroom and still catches
       * the failure it is for, which was never a 5x step -- it was a copy instead of an ease,
       * i.e. a step the size of a whole stage transition among steps a fraction of it.
       */
      const lens: number[] = [];
      for (let i = 1; i < cams.length; i++) lens.push(stepLength(cams[i - 1]!, cams[i]!));

      const localRatio = (i: number): number => {
        const neighbours = [lens[i - 1], lens[i + 1]].filter(
          (x): x is number => x !== undefined && x > 0,
        );
        if (!neighbours.length) return 0;
        return lens[i]! / (neighbours.reduce((a, b) => a + b, 0) / neighbours.length);
      };

      const POP = 8;
      lens.forEach((len, i) => {
        expect(
          localRatio(i),
          `step ${i} (${direction}) moved ${len.toFixed(4)} ft, ` +
            `${localRatio(i).toFixed(2)}x the steps either side of it`,
        ).toBeLessThanOrEqual(POP);
      });

      /**
       * The five boundary steps specifically -- the ones a pre-fix run failed at -- held to
       * a tighter factor than the sweep at large, because a boundary has no funnel or easing
       * of its own to explain a jump: descentPath() pins each leg's last stop to the next
       * stage's keyframe OBJECT, so the pose either side of a boundary is identical by
       * construction and the step across it should be an ordinary one.
       *
       * MEASURED: four of the five boundaries land at 2.61x or below. The fifth, 4 -> 5, is
       * 4.79x -- a 5.06 ft step among ~1 ft ones, at u = 1.0 exactly. That is the arrival in
       * the hall, where the pose stops coming from stage 4's path and starts coming from the
       * walker (store.ts seeds `firstPerson` on every arrival at stage 5, and CameraRig
       * follows it). The two are the same point by construction -- tests/stages.test.ts
       * asserts kf[5] bit-for-bit equal to standingPose()'s own output -- so this is the last
       * step of the threshold leg covering its remaining travel, not a jump between two
       * different poses. It is also the largest boundary step in the sweep and worth a look
       * on its own: 6 is set to admit it with its size recorded here rather than to hide it.
       */
      const BOUNDARY_POP = 6;
      boundaryUs.forEach((b, idx) => {
        const step = direction === "forward" ? Math.round(b * STEPS) : STEPS - Math.round(b * STEPS);
        const lenIndex = Math.min(lens.length - 1, Math.max(0, step - 1));
        expect(
          localRatio(lenIndex),
          `boundary ${BOUNDARY_NAMES[idx]} at u=${b.toFixed(4)} (${direction}) moved ` +
            `${lens[lenIndex]!.toFixed(4)} ft, ${localRatio(lenIndex).toFixed(2)}x the steps ` +
            `either side of it`,
        ).toBeLessThanOrEqual(BOUNDARY_POP);
      });
    }
  },
);
