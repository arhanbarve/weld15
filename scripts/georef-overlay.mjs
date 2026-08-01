/**
 * Draw campus.json's footprints onto the L4 photograph and write the result to design/renders/.
 *
 * THE ONE VERIFICATION THAT CANNOT BE DONE WITH A NUMBER. P9.md's risk table puts "the imagery is
 * rotated or offset against the model" at high likelihood precisely because it is invisible in
 * code: every coordinate is plausible, every test passes, and the Yard is simply in the wrong
 * place. frames.ts:13-17 makes the same point about mirroring. A picture of the modelled
 * footprints lying on the photographed roofs is the only thing that actually settles it, so this
 * script exists and its output is committed.
 *
 * Run: node scripts/georef-overlay.mjs
 *
 * What to look for, in order of how badly each would matter:
 *   1. Every outline sits on a roof, not beside one. A uniform shift is an origin error.
 *   2. The outlines are not ROTATED as a set about the centre of the frame. A rotation is the
 *      1.4269 degree UTM convergence error the tile-service route is supposed to make impossible
 *      -- see the header of scripts/fetch-imagery.mjs -- so if a rotation is visible here, that
 *      argument is wrong and the whole pipeline needs re-examining.
 *   3. Weld itself, drawn heavier, is the building at the centre of the frame.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const campus = JSON.parse(await import("node:fs").then((m) => m.readFileSync("src/data/campus.json", "utf8")));
const weld = JSON.parse(await import("node:fs").then((m) => m.readFileSync("src/data/weld.json", "utf8")));
const manifest = JSON.parse(await import("node:fs").then((m) => m.readFileSync("src/data/imagery-manifest.json", "utf8")));

const L = manifest.levels.L4;
const [W, H] = L.px;
const { minX, maxX, minY, maxY } = L.extentFt;

/** Site feet to L4 pixel. y is NORTH, and pixel rows run south, hence the flip. */
const toPx = ([x, y]) => [
  ((x - minX) / (maxX - minX)) * W,
  ((maxY - y) / (maxY - minY)) * H,
];

const poly = (ring, stroke, width) => {
  const pts = ring.map(toPx).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return `<polygon points="${pts}" fill="none" stroke="${stroke}" stroke-width="${width}" />`;
};

const parts = [];
for (const b of campus.buildings) {
  if (!b.ring) continue;
  parts.push(poly(b.ring, "#00ffcc", 3));
}
// Weld last and heavier, so it is on top and unmistakable.
for (const ring of weld.rings) parts.push(poly(ring, "#ff2d55", 6));

// Crosshair at the site origin, which is Weld's centroid and therefore the exact centre.
const [cx, cy] = toPx([0, 0]);
parts.push(
  `<line x1="${cx - 60}" y1="${cy}" x2="${cx + 60}" y2="${cy}" stroke="#ffe600" stroke-width="3"/>`,
  `<line x1="${cx}" y1="${cy - 60}" x2="${cx}" y2="${cy + 60}" stroke="#ffe600" stroke-width="3"/>`,
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join("")}</svg>`;

mkdirSync("design/renders", { recursive: true });

// Rasterised to the base's EXACT pixel size first. sharp renders SVG at 72 dpi and rounds, so
// composing the markup directly produced an overlay one pixel larger than the photograph and
// sharp refused it -- "Image to composite must have same dimensions or smaller".
const lines = await sharp(Buffer.from(svg), { density: 72 })
  .resize(W, H, { fit: "fill" })
  .png()
  .toBuffer();

const out = "design/renders/p9-georef-overlay.png";
await sharp("public/imagery/l4.avif")
  .composite([{ input: lines, top: 0, left: 0 }])
  .png()
  .toFile(out);
console.log(`wrote ${out}  (${W}x${H}, ${campus.buildings.length} footprints + Weld)`);

// A smaller crop around Weld, because a 3072 px overview cannot show a 10 ft offset.
const half = 420;
const [x0, y0] = toPx([-half, half]);
const side = Math.round(((2 * half) / (maxX - minX)) * W);
const zoom = "design/renders/p9-georef-weld.png";
// Cropped from the file just written rather than by re-compositing. sharp refuses an extract in
// the same pipeline as a composite of equal size, so this reads the finished overview back.
await sharp(out)
  .extract({ left: Math.round(x0), top: Math.round(y0), width: side, height: side })
  .resize(1200, 1200, { kernel: "nearest" })
  .png()
  .toFile(zoom);
console.log(`wrote ${zoom}  (${2 * half} ft across, centred on Weld)`);
