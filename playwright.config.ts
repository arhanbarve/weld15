import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
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
    /**
     * REUSING AN EXISTING SERVER IS A TRAP WHEN THERE IS MORE THAN ONE CHECKOUT, and it cost a
     * full P9 run before it was noticed. If any dev server is already listening on 3000 --
     * including one started from a different worktree or from the main checkout -- Playwright
     * adopts it and says nothing. The suite then reports green while testing code that has none
     * of your changes in it: the run that caught this reported 46 passed, and the give-away was
     * that /imagery/l4.avif returned 404 on 3000 and 200 on the worktree's own server.
     *
     * Kept true, because for a single checkout it is the right behaviour and turning it off makes
     * every local run pay a cold Next start. BEFORE TRUSTING A GREEN RUN FROM A WORKTREE, check
     * that the server on 3000 is the one you think it is -- request a file only your branch has.
     */
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
