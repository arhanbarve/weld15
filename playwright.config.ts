import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  /**
   * Three workers, not the default one-per-core-half.
   *
   * MEASURED, and it is the same story this file's timeout note tells one level up: every
   * spec here drives a WebGL scene through SwiftShader in software, and the contention is
   * for the thing the tests are measuring. At six workers `perf.spec.ts` intermittently
   * samples an UNRENDERED frame -- `triangles: 1`, or stage 5 reading 1 draw call where it
   * draws 38 -- and its frame-ring assertion read 4 frames against a bound of 10 while
   * median frame time went from 62-79 ms up to 205-300 ms. At three workers the whole
   * suite passes: 53 tests, 3.1 minutes.
   *
   * Attribution was measured both ways rather than pinned on the newest spec: the suite
   * WITHOUT contrast.spec.ts fails `§9's budget holds`, and WITH it fails `the composer is
   * the whole difference`. So it is load, not a spec -- which is why the fix is the worker
   * count and not a serial mode on whichever file happened to lose the race.
   *
   * Capping workers rather than loosening the bounds, because a draw-call budget that
   * tolerates a frame reading 1 triangle is not a budget. The cost is wall clock: 2.3
   * minutes at six workers against 3.1 at three.
   */
  workers: 3,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  /**
   * 90 s, not Playwright's 30.
   *
   * Every spec in here drives a WebGL scene under SwiftShader, which runs at a 62 ms
   * median frame in this environment -- so a test that walks all six stages, waits 1.4 s
   * at each for the camera to settle, samples 3,600 pixels and writes a screenshot is
   * legitimately half a minute of work. journey.spec.ts measured 26.5 s and then tipped
   * over the default as the suite grew, and campus.spec.ts failed only when run in
   * parallel with the rest, which is the same story: contention, not a defect.
   *
   * Raising the budget rather than trimming the work, because what these tests do IS the
   * verification -- the pixels are the evidence. tests/e2e/edit.spec.ts sets 120 s of its
   * own on top of this, for the pointer gestures.
   */
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
