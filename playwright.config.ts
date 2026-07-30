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
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
