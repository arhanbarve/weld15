// P10 Step 0 -- baseline measurement, committed as a script rather than kept in
// anyone's head. Run against a live dev server; prints one JSON blob and writes
// it to --out. See docs/phases/P10-IMPL.md's Step 0 for the rationale and the
// recorded baseline this is meant to reproduce (approximately -- the app has
// moved on since that run).
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);
const PORT = args.port ?? 3010;
const OUT = args.out ?? "verify-run/p10-baseline.json";
const URL = `http://localhost:${PORT}/`;

/** The boxes to track at every stage, testid/class selectors as given in P10-IMPL.md. */
const BOX_SELECTORS = {
  hud: '[data-testid="hud"]',
  a11yAltDock: ".a11y-alt-dock",
  a11yAltToggle: '[data-testid="a11y-alt-toggle"]',
  sources: '[data-testid="sources"]',
  panelToggle: '[data-testid="panel-toggle"]',
  flyDown: '[data-testid="fly-down"]',
  imageryChip: ".imagery-chip",
};

/** getBoundingClientRect() for every tracked selector, rounded, null if absent. */
async function readBoxes(page) {
  return page.evaluate((sel) => {
    const round = (r) => ({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    });
    const out = {};
    for (const [name, selector] of Object.entries(sel)) {
      const el = document.querySelector(selector);
      out[name] = el ? round(el.getBoundingClientRect()) : null;
    }
    return out;
  }, BOX_SELECTORS);
}

/** window.__cam, whatever shape it currently publishes, alt rounded. */
async function readCam(page) {
  return page.evaluate(() => {
    const c = window.__cam;
    if (!c) return null;
    return { stage: c.stage, t: c.t, alt: Math.round(c.alt * 100) / 100, fov: c.fov };
  });
}

/** window.__perf, published whole. */
async function readPerf(page) {
  return page.evaluate(() => window.__perf ?? null);
}

/**
 * The crimson marker's pixel bounding box at stage 0.
 *
 * Crimson test per P10-IMPL.md: r > 170 && g < 130 && 80 <= b <= 160 && r - g > 60.
 * Reads the canvas back via a 2D copy -- preserveDrawingBuffer is on
 * (Experience.tsx's <Canvas gl={{...}}>), so this sees the last drawn frame.
 */
async function readMarker(page) {
  return page.locator("canvas").evaluate((el) => {
    const off = document.createElement("canvas");
    off.width = el.width;
    off.height = el.height;
    const ctx = off.getContext("2d");
    ctx.drawImage(el, 0, 0);
    const { data } = ctx.getImageData(0, 0, off.width, off.height);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let found = false;
    for (let y = 0; y < off.height; y++) {
      for (let x = 0; x < off.width; x++) {
        const i = (y * off.width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        if (r > 170 && g < 130 && b >= 80 && b <= 160 && r - g > 60) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return null;
    // Report in CSS pixels, not device pixels: el.width/height are the canvas's
    // backing-store size, which can be devicePixelRatio times the CSS box.
    const rect = el.getBoundingClientRect();
    const scaleX = rect.width / off.width;
    const scaleY = rect.height / off.height;
    return {
      w: Math.round((maxX - minX + 1) * scaleX),
      h: Math.round((maxY - minY + 1) * scaleY),
    };
  });
}

/**
 * Mean rgb and mean HSV saturation of a 360 x 200 patch at (40, 0.45 * height).
 *
 * Sampled every ~97th pixel, per P10-IMPL.md, rather than every pixel -- cheap and
 * plenty for a mean over a 72,000 px patch.
 */
async function readGroundPatch(page) {
  return page.locator("canvas").evaluate((el) => {
    const off = document.createElement("canvas");
    off.width = el.width;
    off.height = el.height;
    const ctx = off.getContext("2d");
    ctx.drawImage(el, 0, 0);
    const rect = el.getBoundingClientRect();
    const scaleX = off.width / rect.width;
    const scaleY = off.height / rect.height;
    const px = Math.round(40 * scaleX);
    const py = Math.round(0.45 * rect.height * scaleY);
    const pw = Math.round(360 * scaleX);
    const ph = Math.round(200 * scaleY);
    const x0 = Math.max(0, px);
    const y0 = Math.max(0, py);
    const x1 = Math.min(off.width, px + pw);
    const y1 = Math.min(off.height, py + ph);
    if (x1 <= x0 || y1 <= y0) return null;
    const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    let rSum = 0, gSum = 0, bSum = 0, satSum = 0, n = 0;
    const w = x1 - x0;
    const h = y1 - y0;
    const total = w * h;
    const stride = 97;
    for (let i = 0; i < total; i += stride) {
      const px4 = i * 4;
      const r = data[px4], g = data[px4 + 1], b = data[px4 + 2];
      rSum += r; gSum += g; bSum += b;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      satSum += max === 0 ? 0 : (max - min) / max;
      n++;
    }
    return {
      mean: [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)],
      meanSat: +(satSum / n).toFixed(3),
    };
  });
}

/**
 * At stage 5: project every piece's anchor through DragLayer's own screenOf(),
 * exactly the maths Experience.tsx:160-180 cites, then ask document.elementFromPoint
 * whether it lands on the canvas. window.__drag publishes both the pieces (u, v)
 * and screenOf() -- see DragLayer.tsx's probe.
 */
async function readReach(page) {
  return page.evaluate(() => {
    const drag = window.__drag;
    if (!drag) return null;
    const canvas = document.querySelector("canvas");
    let reachable = 0;
    for (const p of drag.pieces) {
      const { x, y } = drag.screenOf(p.u, p.v);
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      const el = document.elementFromPoint(x, y);
      if (el === canvas || (el && canvas && canvas.contains(el))) reachable++;
    }
    return { reachable, total: drag.pieces.length };
  });
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL);
  await page.locator('[data-testid="hud"]').waitFor({ state: "visible" });

  const result = { boxes: {}, marker: null, groundPatch: {}, perf: {}, cam: {}, reach: null };

  for (const stage of [0, 1, 2, 3, 4, 5]) {
    await page.getByTestId(`stage-${stage}`).click();
    await page.waitForTimeout(stage === 0 ? 2500 : 1800);

    result.boxes[stage] = await readBoxes(page);
    result.cam[stage] = await readCam(page);
    result.perf[stage] = await readPerf(page);

    if (stage === 0) {
      result.marker = await readMarker(page);
    }
    if (stage === 1 || stage === 2 || stage === 3) {
      result.groundPatch[stage] = await readGroundPatch(page);
    }
    if (stage === 5) {
      result.reach = await readReach(page);
    }
  }

  await browser.close();

  const json = JSON.stringify(result, null, 2);
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, json);
  console.log(json);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
