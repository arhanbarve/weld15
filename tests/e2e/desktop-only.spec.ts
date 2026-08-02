import { test, expect, type Browser, type Page } from "@playwright/test";

/**
 * The desktop gate. Mobile support is cut on purpose, so the gate is the thing that
 * has to be right: a phone must get the message and never the canvas, and every
 * other shape of viewport must get the canvas and never the message.
 *
 * `isMobile: true` alongside `hasTouch: true` is what makes this a real test rather
 * than a viewport check. hasTouch alone already reports `(pointer: coarse)` in
 * Chromium, but isMobile is what applies the document's `width=device-width`, and
 * without it the page lays out at Chromium's 980 px fallback -- a "phone" whose
 * media queries all say desktop. Measured in this repo: 390 with isMobile, 980
 * without it on the same 390-wide context.
 */

/** A phone, in the sense the gate means: coarse pointer, short side under 600. */
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } as const;

/**
 * Long enough that a canvas which mounts late would still be caught.
 *
 * The canvas is behind a `next/dynamic` chunk, so `toHaveCount(0)` immediately after
 * `goto` would pass against a gate that does nothing at all.
 */
const LATE_MOUNT_MS = 2500;

async function open(browser: Browser, opts: Parameters<Browser["newContext"]>[0]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto("/?preload=0");
  return { ctx, page };
}

const gate = (page: Page) => page.getByTestId("desktop-only");

test("a phone gets the message and no canvas at all", async ({ browser }) => {
  const { ctx, page } = await open(browser, PHONE);
  await expect(gate(page)).toBeVisible();
  await page.waitForTimeout(LATE_MOUNT_MS);
  expect(await page.locator("canvas").count()).toBe(0);
  await ctx.close();
});

test("a desktop gets the canvas and never sees the message", async ({ page }) => {
  await page.goto("/?preload=0");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  expect(await gate(page).count()).toBe(0);
});

test("a narrow desktop window is still a desktop", async ({ browser }) => {
  // The case a width-only check gets wrong, and the reason the gate tests the
  // pointer at all: 420 px is under the threshold, but there is a mouse.
  const { ctx, page } = await open(browser, { viewport: { width: 420, height: 780 } });
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  expect(await gate(page).count()).toBe(0);
  await ctx.close();
});

test("the message has no horizontal scroll at 375", async ({ browser }) => {
  const { ctx, page } = await open(browser, { ...PHONE, viewport: { width: 375, height: 667 } });
  await expect(gate(page)).toBeVisible();
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    // Checked on the gate too, because the body is `overflow: hidden` and a fixed
    // child that overhangs the viewport can leave the body's own numbers equal.
    gate: (() => {
      const el = document.querySelector<HTMLElement>('[data-testid="desktop-only"]')!;
      return el.scrollWidth - el.clientWidth;
    })(),
  }));
  expect(overflow.body, `body scrolls sideways by ${overflow.body}px`).toBeLessThanOrEqual(0);
  expect(overflow.gate, `the message scrolls sideways by ${overflow.gate}px`).toBeLessThanOrEqual(0);
  await ctx.close();
});

test("the message actually says something, at a readable size", async ({ browser }) => {
  // An empty styled box passes a visibility check. What it cannot pass is the text.
  const { ctx, page } = await open(browser, PHONE);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/laptop/i);

  const text = (await gate(page).innerText()).replace(/\s+/g, " ").trim();
  expect(text.length, `the message is nearly empty: "${text}"`).toBeGreaterThan(200);
  // The three things the copy has to carry: what it needs, what it is, and what is
  // on the other side of the gate.
  for (const phrase of ["desktop or a laptop", "3D model", "Weld Hall", "1872"]) {
    expect(text, `the message never mentions ${phrase}`).toContain(phrase);
  }

  // Body prose at MASTER.md's 16 px mobile minimum, and text that resolves to the
  // ground it sits on rather than to a transparent default.
  const prose = await page.locator(".gate-prose").first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: parseFloat(s.fontSize), color: s.color, height: el.getBoundingClientRect().height };
  });
  expect(prose.size).toBeGreaterThanOrEqual(16);
  expect(prose.color).toBe("rgb(228, 235, 246)"); // --ink-scan, ~15:1 on the chip
  expect(prose.height, "the prose has no height").toBeGreaterThan(40);
  await ctx.close();
});

test("rotating out of phone size hands the app over without a reload", async ({ browser }) => {
  // The gate listens to matchMedia rather than reading it once at mount, and this is
  // the assertion that says so: same context, same page, coarse pointer throughout.
  const { ctx, page } = await open(browser, PHONE);
  await expect(gate(page)).toBeVisible();
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator("canvas")).toBeVisible({ timeout: 30_000 });
  expect(await gate(page).count()).toBe(0);
  await ctx.close();
});
