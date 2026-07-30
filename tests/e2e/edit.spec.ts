import { test, expect, type Page } from "@playwright/test";

/**
 * Longer than the 30 s default, because these gates drive REAL pointer gestures against
 * a SwiftShader renderer at a 62 ms median frame. One probe is a press, three moves and
 * a release, each of which has to be seen by the page, so a search over a dozen
 * candidate positions is tens of seconds on its own. journey.spec.ts already runs 26 s
 * tests against the same renderer.
 */
test.setTimeout(120_000);

/**
 * P6's gates: the model is changeable, it says so when it refuses, and a link reopens
 * exactly what the sender was looking at.
 *
 * WHY THESE READ window PROBES AND NOT THE DOM
 * The thing under test is a WebGL canvas. A dragged bed leaves no element behind, and a
 * wall that has been taken away is not a node that stopped existing -- it is a triangle
 * that stopped being submitted. So the observable surface is the same device the rest of
 * this suite already uses: window.__cam for the camera, window.__perf for the render
 * budget, and now window.__drag (DragLayer's, live gesture state) and window.__weld
 * (UrlSync's, the editable state plus the encoded link).
 *
 * That is a real weakness and it is worth naming: a probe can agree with a broken
 * renderer. It is mitigated the way the luminance helper in journey.spec.ts is -- every
 * gate below that claims something is VISIBLE measures pixels, and the probes are used
 * only for identity and bookkeeping (which piece, which reason, which id).
 */

type Weld = {
  q: string;
  stage: number;
  params: Record<string, number | string | boolean>;
  cutaway: string;
  occupancy: number;
  pieces: number;
  selected: string | null;
  notice: string | null;
};

type Drag = {
  enabled: boolean;
  selected: string | null;
  dragging: boolean;
  ghost: { u: number; v: number; ok: boolean; reason?: string; against?: string[] } | null;
  last: { id: string; ok: boolean; u?: number; v?: number; reason?: string; against?: string[] } | null;
  attempts: number;
  refusals: number;
  pieces: { id: string; u: number; v: number; yaw: number }[];
};

const weld = (page: Page) => page.evaluate(() => (window as unknown as { __weld: Weld }).__weld);
const drag = (page: Page) => page.evaluate(() => (window as unknown as { __drag: Drag }).__drag);

/** A piece by id, as the drag layer sees it. */
async function piece(page: Page, id: string) {
  const d = await drag(page);
  return d.pieces.find((p) => p.id === id);
}

/**
 * A piece the pointer can actually reach, found rather than assumed.
 *
 * Hard-coding an id does not work and the reason is worth stating, because it is a fact
 * about the shot rather than about the test. Stage 5 stands inside bedroom B looking
 * diagonally down, so only part of that room's floor is in frame: of 29 pieces, four
 * project inside the viewport at 1280 x 720, and which four depends on the camera, the
 * params and the fit-out -- all three of which move. bedA's furniture is in another room
 * behind a wall, and bedB-bed-0's corner projects off the top of the screen.
 *
 * It also checks what is ON TOP at that pixel with elementFromPoint. That is not
 * belt-and-braces: the HUD used to sit bottom-centre, exactly where the floor projects,
 * and every one of those four pieces was behind an opaque panel -- a press landed on an
 * <input> and never reached the canvas. The HUD moves to the top of the frame at this
 * stage now, and this check is what would catch it coming back.
 */
async function firstPickable(page: Page): Promise<{ id: string; u: number; v: number }> {
  const found = await page.evaluate(() => {
    const d = (window as unknown as { __drag: Drag & { screenOf(u: number, v: number): { x: number; y: number } } }).__drag;
    for (const p of d.pieces) {
      const s = d.screenOf(p.u + 0.5, p.v + 0.5);
      if (s.x < 0 || s.x > window.innerWidth || s.y < 0 || s.y > window.innerHeight) continue;
      const el = document.elementFromPoint(s.x, s.y);
      if (el && el.tagName === "CANVAS") return { id: p.id, u: p.u, v: p.v };
    }
    return null;
  });
  if (!found) throw new Error("no piece is both in frame and unobstructed at stage 5");
  return found;
}

/** Mean luminance over a coarse grid, plus the number of distinct colours. */
async function frame(page: Page) {
  return page.locator("canvas").evaluate((el) => {
    const src = el as HTMLCanvasElement;
    const off = document.createElement("canvas");
    off.width = src.width;
    off.height = src.height;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    const N = 60;
    let sum = 0;
    let n = 0;
    const seen = new Set<string>();
    for (let gx = 0; gx < N; gx++) {
      for (let gy = 0; gy < N; gy++) {
        const x = Math.floor((off.width * (gx + 0.5)) / N);
        const y = Math.floor((off.height * (gy + 0.5)) / N);
        const i = (y * off.width + x) * 4;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        sum += (r + g + b) / 3;
        n++;
        seen.add(`${r},${g},${b}`);
      }
    }
    return { mean: sum / n, distinct: seen.size };
  });
}

/** Open the app in the room, with the panel showing. */
async function openInTheRoom(page: Page, query = "") {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`/${query}`);
  await page.locator("canvas").waitFor();
  // The stage button, not the skip link. `.skip` sits at translateY(-200%) until it is
  // focused -- that is the whole point of a skip link -- so Playwright reports it as
  // outside the viewport and refuses to click it. journey.spec.ts's gotoStage() takes
  // the same route, and its own skip-link test focuses it by Tab first.
  await page.getByTestId(`stage-5`).click();
  // The camera settles; the same 1400 ms journey.spec.ts waits.
  await page.waitForTimeout(1400);
  await expect.poll(async () => (await weld(page)).stage, { timeout: 15_000 }).toBe(5);
  await expect.poll(async () => (await drag(page)).enabled, { timeout: 15_000 }).toBe(true);
  const panel = page.getByTestId("panel");
  if (!(await panel.isVisible())) await page.getByTestId("panel-toggle").click();
  await expect(panel).toBeVisible();
  return errors;
}

/**
 * Drag one piece to a suite-frame point with a real pointer.
 *
 * The projection comes from the drag layer's own screenOf(), so the test aims at the
 * same pixel the renderer would put that floor point at -- rather than reimplementing a
 * 13.2 degree rotation and a facade reflection, which is the second copy of place.ts's
 * mapping that every module in this project refuses to write.
 */
async function dragPiece(page: Page, id: string, to: { u: number; v: number }) {
  const from = await piece(page, id);
  if (!from) throw new Error(`no piece ${id}`);
  const a = await project(page, from.u + 0.5, from.v + 0.5);
  const b = await project(page, to.u + 0.5, to.v + 0.5);
  // Off-frame targets are refused HERE rather than aimed at, and this is the trap that
  // cost the most time in writing these gates: a suite point behind the camera projects
  // to a coordinate hundreds of pixels outside the viewport, and page.mouse.move() to
  // one of those does not error -- it hangs until the test times out. Worse, an
  // intermediate move that lands off-frame leaves the gesture holding the last ghost it
  // saw, so a refusal gate reads ok: true and passes for the wrong reason.
  for (const [what, p] of [
    ["source", a],
    ["target", b],
  ] as const) {
    if (!onFrame(p)) {
      throw new Error(
        `${id}: the ${what} projects to (${Math.round(p.x)}, ${Math.round(p.y)}), off frame`,
      );
    }
  }
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  // Two intermediate moves, not one: a single move can be coalesced with the up, and
  // the ghost is what the mid-gesture assertions read.
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
}

/** A suite-frame floor point as viewport pixels, through the layer's own projection. */
async function project(page: Page, u: number, v: number) {
  return page.evaluate(
    ([uu, vv]) =>
      (window as unknown as { __drag: { screenOf(u: number, v: number): { x: number; y: number } } })
        .__drag.screenOf(uu as number, vv as number),
    [u, v],
  );
}

const VIEW = { w: 1280, h: 720 };

function onFrame(p: { x: number; y: number }): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0 && p.x < VIEW.w && p.y > 0 && p.y < VIEW.h;
}

/**
 * Drag a piece around its own room until the ghost says what the gate is looking for.
 *
 * A search and not an aimed drag, because both halves of the aim are unstable: which
 * floor points are in frame is the camera's business, and which of those are legal is
 * layout()'s and drag.ts's. Writing a coordinate in here would be a fourth copy of
 * facts the geometry already owns, and it would go stale the first time a recipe moved.
 *
 * Returns the ghost that satisfied `want`, with the gesture still open so the caller can
 * assert on it and then release.
 */
async function dragUntil(
  page: Page,
  id: string,
  want: (g: NonNullable<Drag["ghost"]>) => boolean,
): Promise<NonNullable<Drag["ghost"]> | null> {
  const start = (await piece(page, id))!;

  // Every candidate is projected in ONE evaluate, not one per probe. That is a real
  // constraint rather than tidiness: a probe is two round trips for the projection plus
  // three pointer moves plus a probe read, and an earlier version that projected inside
  // the loop spent the whole 30 second test budget on 112 candidates without ever
  // pressing the mouse. The list is capped for the same reason, and what is dropped is
  // logged rather than silently truncated.
  const { pts, considered } = await page.evaluate(
    ([u0, v0]) => {
      const d = (
        window as unknown as {
          __drag: { screenOf(u: number, v: number): { x: number; y: number } };
        }
      ).__drag;
      const out: { u: number; v: number; x: number; y: number; d: number }[] = [];
      let considered = 0;
      for (let du = -14; du <= 14; du++) {
        for (let dv = -14; dv <= 14; dv++) {
          if (du === 0 && dv === 0) continue;
          considered++;
          const u = (u0 as number) + du;
          const v = (v0 as number) + dv;
          const s = d.screenOf(u + 0.5, v + 0.5);
          if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue;
          if (s.x < 4 || s.x > window.innerWidth - 4) continue;
          if (s.y < 4 || s.y > window.innerHeight - 4) continue;
          if (document.elementFromPoint(s.x, s.y)?.tagName !== "CANVAS") continue;
          out.push({ u, v, x: s.x, y: s.y, d: Math.hypot(du, dv) });
        }
      }
      // Nearest first: a one-foot move is the interesting accepted case, and the nearest
      // refusal is the one a person would actually hit.
      out.sort((a, b) => a.d - b.d);
      return { pts: out.slice(0, 10), considered };
    },
    [start.u, start.v],
  );
  if (pts.length === 0) return null;

  const a = await project(page, start.u + 0.5, start.v + 0.5);
  if (!onFrame(a)) return null;

  for (const p of pts) {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + p.x) / 2, (a.y + p.y) / 2, { steps: 3 });
    await page.mouse.move(p.x, p.y, { steps: 3 });
    const g = (await drag(page)).ghost;
    // Left OPEN on success, so the caller can assert on the live ghost.
    if (g && want(g)) return g;
    await page.mouse.up();
    // Put it back if that probe happened to be accepted, so each probe starts from the
    // designed position rather than walking the piece across the room.
    const now = (await piece(page, id))!;
    if (now.u !== start.u || now.v !== start.v) {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(a.x, a.y, { steps: 3 });
      await page.mouse.up();
    }
  }
  console.log(`dragUntil ${id}: ${pts.length} of ${considered} candidates were reachable`);
  return null;
}

test.describe("P6 -- the suite is changeable", () => {
  test("a dragged piece survives the link that describes it", async ({ page }) => {
    const errors = await openInTheRoom(page);
    // The opening state's own encoding, for the "the link actually changed" check below.
    await page.waitForTimeout(500);
    const opening = new URL(page.url()).searchParams.get("s");
    expect(opening, "the URL carries a snapshot from the start").not.toBeNull();

    const target = await firstPickable(page);
    const before = (await piece(page, target.id))!;

    // Somewhere this piece can legally go, found rather than assumed -- see dragUntil().
    const ghost = await dragUntil(
      page,
      target.id,
      (g) => g.ok && (g.u !== before.u || g.v !== before.v),
    );
    expect(ghost, `nowhere in frame is a legal position for ${target.id}`).not.toBeNull();
    await page.mouse.up();

    const moved = (await piece(page, target.id))!;
    expect(
      Math.hypot(moved.u - before.u, moved.v - before.v),
      `${target.id} did not move`,
    ).toBeGreaterThan(0.01);
    expect((await drag(page)).last?.ok).toBe(true);

    // The URL has to carry it. UrlSync debounces, so poll rather than read once.
    await expect
      .poll(async () => new URL(page.url()).searchParams.get("s"), { timeout: 5000 })
      .not.toBeNull();
    // Wait for the debounce to FLUSH, then compare. Polling the address bar against the
    // probe's own `q` looked like the careful thing to do and is not: UrlSync publishes
    // the probe on every store change but only rewrites the URL on a 150 ms trailing
    // debounce, so before the flush the two agree on the PREVIOUS state and the poll
    // passes on a stale pair. That is how this gate came to reopen a link describing the
    // bed's designed position while asserting against the position it had been dragged to
    // -- u 10 against u 12. 500 ms is over three times the debounce.
    await page.waitForTimeout(500);
    const link = page.url();
    expect(new URL(link).searchParams.get("s")).toBe((await weld(page)).q);
    // And the link is not merely present, it is NEW: the opening state has its own
    // encoding, and a URL that never changed would satisfy everything above.
    expect(new URL(link).searchParams.get("s")).not.toBe(opening);

    // Reopen the link in a clean page and find the bed where it was left.
    await page.goto("about:blank");
    await page.goto(link);
    await page.locator("canvas").waitFor();
    await expect.poll(async () => (await weld(page)).stage, { timeout: 15_000 }).toBe(5);
    // And wait for the drag layer's probe, which is a SEPARATE publisher: __weld comes
    // from UrlSync on the DOM side and __drag from a component inside the canvas, so a
    // hydrated stage does not imply a mounted drag layer. Reading through the gap threw
    // "cannot read properties of undefined" under parallel load, which is the sort of
    // flake that gets a real failure dismissed later.
    await expect
      .poll(async () => (await drag(page))?.pieces?.length ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);
    const reopened = (await piece(page, target.id))!;
    expect(reopened.u).toBeCloseTo(moved.u, 6);
    expect(reopened.v).toBeCloseTo(moved.v, 6);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the keyboard moves the same piece the same way", async ({ page }) => {
    await openInTheRoom(page);
    // Selection by pointer, movement by keyboard only. The selection has to come from
    // somewhere, and a canvas cannot be tabbed into -- which is the limitation the
    // panel's own nudge buttons exist to cover, and they are exercised below.
    const target = await firstPickable(page);
    const before = (await piece(page, target.id))!;
    await dragPiece(page, target.id, { u: before.u, v: before.v });
    await page.mouse.up();
    await expect.poll(async () => (await weld(page)).selected).toBe(target.id);
    // A press that changes nothing is a selection and nothing else, so the piece is
    // exactly where it was before any key is touched.
    expect((await piece(page, target.id))!).toEqual(before);

    // One key press has to move it. WHICH key is not asserted, and that is deliberate:
    // which of the four directions a designed piece can take depends on what it is
    // standing against, and layout() puts most pieces flush against something. So all
    // four are tried and the claim is that the keyboard moved the selection at all.
    const keys = [
      { key: "ArrowUp", undo: "nudge-v-" },
      { key: "ArrowDown", undo: "nudge-v+" },
      { key: "ArrowRight", undo: "nudge-u-" },
      { key: "ArrowLeft", undo: "nudge-u+" },
    ] as const;
    let moved: { after: { u: number; v: number }; undo: string } | null = null;
    for (const { key, undo } of keys) {
      await page.keyboard.press(key);
      const after = (await piece(page, target.id))!;
      if (after.u !== before.u || after.v !== before.v) {
        moved = { after, undo };
        break;
      }
    }
    expect(moved, `no arrow key could move ${target.id}`).not.toBeNull();

    // The panel's buttons are the same nudge(), so the opposite direction has to bring it
    // back where the key found it. One code path, two inputs -- which is what
    // docs/phases/P6.md's risk table asks for against "keyboard path is an afterthought".
    await page.getByTestId(moved!.undo).click();
    const back = (await piece(page, target.id))!;
    expect(back.u).toBeCloseTo(before.u, 6);
    expect(back.v).toBeCloseTo(before.v, 6);
  });

  test("a refusal is visible, named, and leaves the piece where it was", async ({ page }) => {
    await openInTheRoom(page);
    const target = await firstPickable(page);
    const before = (await piece(page, target.id))!;

    // Somewhere in frame that the piece may not go. Searched, not aimed: 20 ft down u is
    // outside the building and would be a certain refusal, but it is also behind the
    // camera, and a target the camera cannot see is a target the pointer cannot reach.
    const ghost = await dragUntil(page, target.id, (g) => !g.ok);
    expect(ghost, "nowhere in frame is illegal for this piece").not.toBeNull();
    expect(ghost!.ok, "the ghost reads as refused").toBe(false);
    expect(ghost!.reason, "and it carries the reason").toMatch(
      /collision|outside-room|blocks-door/,
    );
    expect(ghost!.against?.length, "and names what it hit").toBeGreaterThan(0);
    await page.mouse.up();

    const after = (await piece(page, target.id))!;
    expect(after.u).toBeCloseTo(before.u, 6);
    expect(after.v).toBeCloseTo(before.v, 6);

    const d = await drag(page);
    expect(d.last?.ok).toBe(false);
    expect(d.refusals).toBeGreaterThan(0);
    // Named, not swallowed: the notice reaches the panel and says what was hit.
    await expect(page.getByTestId("panel-notice")).toContainText(/would (leave|overlap|block)/);
    // A room's own label, so the sentence is about the suite and not about ids.
    expect((await weld(page)).notice).toMatch(/Bedroom|Common|Hall|K\b/);
  });

  /*
   * P6.md's fourth gate -- "drag a dresser across the bathroom door and assert
   * blocks-door" -- is NOT here, and it is worth saying where it went and why rather than
   * quietly dropping it.
   *
   * It was written here first, driving the panel's nudge buttons a grid step at a time
   * until a landing refused. It works and it is far too slow to keep: a doorway landing
   * is at the edge of the room, which is exactly the part of the floor the stage-5 camera
   * does not show, so the pointer cannot reach one at all, and walking a piece there
   * through the UI is up to 120 button presses against a 62 ms frame -- over the two
   * minute budget on its own, and every second of it re-testing nudge() rather than the
   * door rule.
   *
   * So the gate is split at the seam where the cost is. The refusal above proves the
   * whole chain from a real pointer gesture to worded text on screen. The door rule
   * itself lives in tests/drag.test.ts, where twelve mutations of the door check are all
   * caught, and its WORDING lives in tests/store.test.ts, which asserts the "block the
   * door between X and Y (dN)" sentence for a real blocked placement. Nothing is
   * untested; what is gone is a slow duplicate.
   */

  test("the dimension sliders change the model, and refuse what is not a suite", async ({
    page,
  }) => {
    await openInTheRoom(page);
    const before = await frame(page);

    // Ceiling: an INFERRED number that appears in no public source, which is exactly
    // why it ships as a control. Driving it has to change the picture.
    const ceiling = page.getByTestId("slider-ceiling").locator("input");
    await ceiling.fill("9");
    await ceiling.dispatchEvent("input");
    await expect.poll(async () => (await weld(page)).params.ceiling).toBe(9);
    await expect
      .poll(async () => Math.abs((await frame(page)).mean - before.mean) > 0.5, { timeout: 5000 })
      .toBe(true);

    // Bathroom depth: bounded 6 to 8 by two arithmetic checks and never sourced. Inside
    // the bracket it applies; a value that would leave the unknown strip with no floor
    // is refused, and the params do not move.
    const bath = page.getByTestId("slider-bathDeep").locator("input");
    await bath.fill("8");
    await bath.dispatchEvent("input");
    await expect.poll(async () => (await weld(page)).params.bathDeep).toBe(8);

    // And the illegal end. A 60 ft section is wider than Weld's waist, so the facade
    // masonry would be drawn outside the shell -- and the panel's own control cannot
    // even express it: Playwright refuses fill("60") on a range whose max is 45 with
    // "Malformed value", which is the browser enforcing the bound rather than the app.
    // So the refusal is driven the way a stale link or a hand-edited URL would drive it,
    // straight at the input's value, and what is asserted is that the model did not take
    // it either way.
    const section = page.getByTestId("slider-sectionLength").locator("input");
    expect(Number(await section.getAttribute("max")), "the control's own ceiling").toBeLessThan(51);
    const held = (await weld(page)).params.sectionLength;
    await section.evaluate((el) => {
      const input = el as HTMLInputElement;
      input.value = "60";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const landed = Number((await weld(page)).params.sectionLength);
    expect(landed).not.toBe(60);
    // Either the range clamped it on the way through or the store refused it. Both are
    // correct answers; the wrong answer is a 60 ft suite.
    expect(landed === Number(held) || landed <= 45).toBe(true);
  });

  test("each cutaway mode changes the frame, and walls-down shows more than none", async ({
    page,
  }) => {
    await openInTheRoom(page);
    const shots: Record<string, { mean: number; distinct: number }> = {};
    for (const mode of ["none", "roofOff", "wallsDown", "section"]) {
      await page.getByTestId(`cutaway-${mode}`).click();
      await expect.poll(async () => (await weld(page)).cutaway).toBe(mode);
      // A frame or two for the geometry rebuild to reach the canvas.
      await page.waitForTimeout(250);
      shots[mode] = await frame(page);
      // The mode is in the canvas's own accessible name, because a screen reader gets
      // nothing else out of WebGL. cutaway.ts's header asks for exactly this.
      await expect(page.locator("canvas")).toHaveAttribute("aria-label", /Weld 15\. .+/);
    }

    // Distinct from each other, not merely non-empty: four modes that all render the
    // same frame would pass a liveness check and fail the feature.
    const means = Object.values(shots).map((s) => s.mean);
    expect(new Set(means.map((m) => m.toFixed(2))).size).toBeGreaterThan(1);
    // Dropping the near wall lets more light and more of the room into the frame than
    // the closed box does.
    expect(shots.wallsDown!.distinct).toBeGreaterThan(0);
    expect(Math.abs(shots.wallsDown!.mean - shots.none!.mean)).toBeGreaterThan(0.5);
  });

  test("a malformed link opens at the defaults with no console error", async ({ page }) => {
    const errors = await openInTheRoom(page, "?s=not-a-real-snapshot-at-all");
    const s = await weld(page);
    // The defaults, and specifically not a partially applied snapshot: url.ts assembles
    // and validates before it returns anything.
    expect(s.params.ceiling).toBe(10.75);
    expect(s.pieces).toBe(29);
    expect(s.cutaway).toBe("none");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("re-fitting for a different occupancy replaces the arrangement", async ({ page }) => {
    await openInTheRoom(page);
    expect((await weld(page)).pieces).toBe(29);

    const occ = page.getByTestId("slider-occupancy").locator("input");
    await occ.fill("2");
    await occ.dispatchEvent("input");
    // Not until asked: the slider on its own must not throw away a drag.
    expect((await weld(page)).pieces).toBe(29);

    await page.getByTestId("refit").click();
    await expect.poll(async () => (await weld(page)).pieces).toBeLessThan(29);
    await expect(page.getByTestId("panel-notice")).toContainText("Re-fitted");

    await page.getByTestId("reset-all").click();
    await expect.poll(async () => (await weld(page)).pieces).toBe(29);
  });

  test("the drag layer stays inside the suite's draw-call budget", async ({ page }) => {
    await openInTheRoom(page);
    const calls = async () =>
      page.evaluate(() => (window as unknown as { __perf?: { calls: number } }).__perf?.calls ?? 0);
    const idle = await calls();
    expect(idle, "the probe is live").toBeGreaterThan(0);

    const target = await firstPickable(page);
    const before = (await piece(page, target.id))!;
    await dragPiece(page, target.id, { u: target.u, v: target.v });
    const midDrag = await calls();
    await page.mouse.up();

    // Measured on this build: 26 to 27 idle at stage 5, and three more while a gesture is
    // live. Three rather than the two the layer's own header predicts (a ghost and an
    // outline), and the difference is that the outline appears on SELECTION and the ghost
    // on DRAG, so a live gesture carries both plus the frame's own bookkeeping -- the perf
    // probe reads the previous frame's accumulated totals, so a rebuild frame can land in
    // the sample. Bounded rather than pinned for that reason.
    //
    // The ceiling is 30, which is campus.spec.ts's whole-scene budget and not a number
    // chosen here. The hit plane itself is never submitted: its material is invisible,
    // which keeps it raycastable without costing a call.
    expect(midDrag - idle, `idle ${idle}, mid-drag ${midDrag}`).toBeLessThanOrEqual(3);
    expect(midDrag, `idle ${idle}, mid-drag ${midDrag}`).toBeLessThanOrEqual(30);
  });
});
