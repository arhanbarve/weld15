// Hue histogram over a rendered frame, or a fractional crop of one.
//
// Built for P10 step 10's check 2 -- "brick is present at stage 3: a hue histogram over
// Weld's projected box has a peak in 10-30 degrees where the baseline has none" -- and kept
// as a reusable measurement rather than thrown away after that one use, since a hue
// histogram over an arbitrary screen region is exactly the tool the next palette question
// will also want. `--box=x0,y0,x1,y1` (fractions of the canvas, default the whole frame) is
// what makes it reusable: the whole-frame histogram at stage 3 is dominated by sky (blue,
// ~210 degrees, ~90% of colour-bearing pixels measured), which drowns a building-sized
// signal to well under 1% -- so isolating Weld's own patch of frame is not optional.
import { chromium } from "@playwright/test";

const PORT = process.env.PORT ?? 3010;
const URL = `http://localhost:${PORT}/`;
const args = process.argv.slice(2);
const STAGE = Number(args.find((a) => !a.startsWith("--")) ?? 3);
const boxArg = args.find((a) => a.startsWith("--box="));
const BOX = boxArg
  ? boxArg
      .slice("--box=".length)
      .split(",")
      .map(Number)
  : [0, 0, 1, 1];

async function readHue(page, box) {
  return page.locator("canvas").evaluate((el, [x0, y0, x1, y1]) => {
    const off = document.createElement("canvas");
    off.width = el.width;
    off.height = el.height;
    const ctx = off.getContext("2d");
    ctx.drawImage(el, 0, 0);
    const px0 = Math.floor(x0 * off.width);
    const py0 = Math.floor(y0 * off.height);
    const pw = Math.ceil((x1 - x0) * off.width);
    const ph = Math.ceil((y1 - y0) * off.height);
    const { data } = ctx.getImageData(px0, py0, pw, ph);
    const bins = new Array(36).fill(0); // 10-degree hue bins
    let counted = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const d = max - min;
      // skip near-black / near-gray / near-white -- not colour-bearing
      if (d < 0.06 || max < 0.05) continue;
      let h;
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = h * 60;
      if (h < 0) h += 360;
      bins[Math.floor(h / 10) % 36]++;
      counted++;
    }
    return { bins, counted, box: [px0, py0, pw, ph] };
  }, box);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL);
  await page.locator('[data-testid="hud"]').waitFor({ state: "visible" });
  await page.getByTestId(`stage-${STAGE}`).click();
  await page.waitForTimeout(2600);
  const { bins, counted, box } = await readHue(page, BOX);
  console.log(`stage ${STAGE}, box px ${JSON.stringify(box)}: ${counted} colour-bearing samples`);
  for (let i = 0; i < 36; i++) {
    if (bins[i] > 0) console.log(`  hue ${i * 10}-${i * 10 + 10}: ${bins[i]} (${((bins[i] / counted) * 100).toFixed(1)}%)`);
  }
  await browser.close();
}
main();
