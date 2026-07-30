// Generate the reference floor plan SVG from the same geometry the app uses.
//
// This replaces the hand-written layout function that lived inside
// design/weld15-plan-derivation.html. That duplicate is how "54 x 151" survived
// across three artifacts: nothing tested the drawing, so it could disagree with
// the model indefinitely. Now the drawing cannot drift, because it has no
// numbers of its own.
//
//   node scripts/emit-plan.mjs > design/weld15-plan.svg

import { buildSuite, DEFAULT_PARAMS } from "../src/geo/rooms.ts";
import { buildWalls, footprintArea } from "../src/geo/walls.ts";

const suite = buildSuite();
const { walls, openings } = buildWalls(suite);
const p = suite.params;

const S = 13; // px per foot
const PAD = 62;

// Screen frame: north (v) up, facade (u = 0) on the right, which is east.
const maxU = suite.maxDepth;
const W = Math.max(maxU * S + PAD * 2, 640);
const H = p.sectionLength * S + PAD * 2;
const X = (u) => PAD + (maxU - u) * S;
const Y = (v) => PAD + (p.sectionLength - v) * S;

const FILL = {
  common: "rgba(143,196,242,0.26)",
  bed: "rgba(143,196,242,0.15)",
  bath: "rgba(157,182,212,0.16)",
  circ: "rgba(157,182,212,0.07)",
  service: "rgba(228,161,94,0.13)",
  unknown: "none",
};

const f = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Rects are drawn from their (u,v) corner; screen x is the far corner because u
// runs right-to-left.
const rect = (r, attrs) =>
  `<rect x="${X(r.u + r.du).toFixed(1)}" y="${Y(r.v + r.dv).toFixed(1)}" ` +
  `width="${(r.du * S).toFixed(1)}" height="${(r.dv * S).toFixed(1)}" ${attrs}/>`;

const out = [];
out.push(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" ` +
    `role="img" aria-label="Floor plan of Weld 15, generated from buildSuite()">`,
);
out.push(`<style>
  .lbl{font:500 12px ui-monospace,"SF Mono",Menlo,monospace;fill:#E4EBF6}
  .dim{font:400 10px ui-monospace,"SF Mono",Menlo,monospace;fill:#6C87AC}
  .tag{font:400 8.5px ui-monospace,"SF Mono",Menlo,monospace}
  .note{font:400 10px ui-monospace,"SF Mono",Menlo,monospace;fill:#9DB6D4}
</style>`);
out.push(`<rect width="100%" height="100%" fill="#0A2547"/>`);

// 1. floors
for (const r of suite.rooms) {
  out.push(rect(r, `fill="${FILL[r.kind] ?? "none"}"`));
}

// 2. walls, each emitted once because buildWalls computes them as the room
//    complement rather than as per-room outlines
for (const w of walls) {
  const col = w.kind === "exterior" ? "#3E6A9E" : "#5783B4";
  out.push(rect(w, `fill="${col}"`));
}

// 3. openings. Doors are gaps; windows are glazing within the wall, which keeps
//    the masonry reading as continuous.
for (const o of openings) {
  const w = walls.find((x) => x.id === o.wallId);
  if (!w) continue;
  const horiz = w.du > w.dv;
  const seg = horiz
    ? { u: w.u + o.offset, v: w.v, du: o.width, dv: w.dv }
    : { u: w.u, v: w.v + o.offset, du: w.du, dv: o.width };
  if (o.kind === "door") {
    const isEntry = o.connects.includes("outside");
    out.push(rect(seg, `fill="#0A2547"`));
    out.push(rect(seg, `fill="${isEntry ? "#E4526F" : "#8FC4F2"}" opacity="0.9"`));
  } else {
    out.push(rect(seg, `fill="#8FC4F2" opacity="0.45"`));
  }
}

// 3b. the space outside the L belongs to the neighbouring suite, not to us.
//     Left unmarked it reads as a large empty room, which is exactly the kind of
//     ambiguity this drawing exists to remove.
const kRoom = suite.rooms.find((r) => r.id === "k");
if (kRoom && maxU > p.legDepth) {
  const outside = { u: p.legDepth, v: kRoom.dv, du: maxU - p.legDepth, dv: p.sectionLength - kRoom.dv };
  out.push(rect(outside, `fill="none" stroke="#6C87AC" stroke-width="1" stroke-dasharray="5 4" opacity="0.5"`));
  out.push(
    `<text class="note" x="${X(outside.u + outside.du / 2).toFixed(1)}" y="${Y(outside.v + outside.dv / 2).toFixed(1)}" ` +
      `text-anchor="middle" opacity="0.75">not part of</text>`,
  );
  out.push(
    `<text class="note" x="${X(outside.u + outside.du / 2).toFixed(1)}" y="${(Y(outside.v + outside.dv / 2) + 14).toFixed(1)}" ` +
      `text-anchor="middle" opacity="0.75">the suite</text>`,
  );
}

// 4. labels, with the provenance of each dimension
for (const r of suite.rooms) {
  if (r.du * r.dv < 40) continue;
  const cx = X(r.u + r.du / 2);
  const cy = Y(r.v + r.dv / 2);
  if (r.du < 6) {
    // Too narrow for horizontal text. Run it along the room.
    out.push(
      `<text class="lbl" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(-90)" text-anchor="middle">` +
        `${esc(r.label)}  <tspan class="dim">${f(r.du)} x ${f(r.dv)}</tspan></text>`,
    );
    continue;
  }
  const given = r.stated && /^\d/.test(r.stated);
  // Short form: the full "K - second common room" overruns a 10 ft room.
  const short = r.label.split(" \u2014 ")[0];
  out.push(
    `<text class="lbl" x="${cx.toFixed(1)}" y="${(cy - 4).toFixed(1)}" text-anchor="middle">${esc(short)}</text>`,
  );
  out.push(
    `<text class="dim" x="${cx.toFixed(1)}" y="${(cy + 10).toFixed(1)}" text-anchor="middle">${f(r.du)} x ${f(r.dv)}</text>`,
  );
  out.push(
    `<text class="tag" x="${cx.toFixed(1)}" y="${(cy + 22).toFixed(1)}" text-anchor="middle" ` +
      `fill="${given ? "#7FD1A6" : "#E4A15E"}">${given ? "GIVEN " + esc(r.stated) : "INFERRED"}</text>`,
  );
}

// 5. dimension strings and orientation
const gy = Y(p.sectionLength) - 20;
out.push(
  `<line x1="${X(maxU)}" y1="${gy}" x2="${X(0)}" y2="${gy}" stroke="#6C87AC" stroke-width="1"/>`,
);
out.push(
  `<text class="dim" x="${((X(0) + X(maxU)) / 2).toFixed(1)}" y="${(gy - 6).toFixed(1)}" text-anchor="middle">${f(maxU)} ft deep at the K bump</text>`,
);
const dx = X(0) + 22;
out.push(`<line x1="${dx}" y1="${Y(0)}" x2="${dx}" y2="${Y(p.sectionLength)}" stroke="#6C87AC" stroke-width="1"/>`);
out.push(
  `<text class="dim" transform="translate(${dx + 13},${((Y(0) + Y(p.sectionLength)) / 2).toFixed(1)}) rotate(90)" text-anchor="middle">${f(p.sectionLength)} ft end section</text>`,
);
out.push(
  `<text class="note" x="${PAD}" y="${(Y(p.sectionLength) - 40).toFixed(1)}">N &#8593;  gable at top &#183; ${p.facade} facade on the right</text>`,
);
out.push(
  `<text class="note" x="${PAD}" y="${(H - 24).toFixed(0)}">generated from buildSuite() and buildWalls() &#183; ${f(suite.netArea)} sq ft net &#183; ${f(footprintArea(suite))} sq ft gross</text>`,
);
out.push(
  `<text class="note" x="${PAD}" y="${(H - 10).toFixed(0)}">residuals: along ${p.sectionLength - (p.commonAlong + p.bedAAlong + p.bathAlong + p.bedBAlong + 3 * p.partition)} &#183; ceiling ${f(p.ceiling)} ft &#183; scale 1 ft = ${S} px</text>`,
);
out.push(`</svg>`);

console.log(out.join("\n"));
