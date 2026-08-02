/**
 * Where does Google's own ground sit, in site feet, under Weld?
 *
 * The measurement behind geo/frame.ts's WELD_GRADE_H_FT. That constant is derived from
 * public geodesy (USGS EPQS + NOAA GEOID12B, see frame.ts) but has to AGREE with the
 * surface Google actually renders, and the two frames differ by one to two metres. So this
 * samples the loaded tile meshes' own vertices in world (site) space, in rings around the
 * origin, and reports where the ground and the roof land:
 *
 *   grade right  -> `gradeFt.median` and `gradeFarFt.median` bracket 0, within the ~3 ft
 *                   the real ground rises between the two rings
 *   grade right  -> `roofTopFt` lands near weld.json's 85.4 ft ridge, a little under it
 *   grade wrong  -> all three are displaced by the SAME constant, which is the residual to
 *                   add to WELD_GRADE_H_FT
 *
 * Vertices, not bounding boxes: a photogrammetric tile's AABB spans whatever else is in
 * that tile (trees, taller neighbours), so its min/max says nothing about the ground under
 * one building. Quantiles rather than min/max for the same reason -- a single stray vertex
 * under an overhang should not set the answer.
 *
 * NEEDS a live key and a dev server (window.__tilesImpl, Tiles.tsx's dev-only handle, is
 * how it reaches the geometry). The key is referrer-restricted to http://localhost:3000, so
 * the server has to be on THAT port -- overriding Referer/Origin from Playwright was tried
 * and Google still answers 403. Pass a different port as argv[2] if the key allows one.
 */
import { chromium } from "@playwright/test";

const PORT = process.argv[2] ?? "3000";
const SETTLE_MS = 30_000;

const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4_000);
// Stage 3 stands 110 ft over Weld: the closest the descent gets with the whole building in
// frame, so it is where the finest tiles over Weld itself are loaded.
await page.getByTestId("stage-3").click();
await page.waitForTimeout(SETTLE_MS);

const out = await page.evaluate(() => {
  const tiles = window.__tilesImpl;
  if (!tiles) return { error: "no window.__tilesImpl -- is the [TEMP-align] hook in Tiles.tsx?" };
  const group = tiles.group;
  group.updateMatrixWorld(true);

  const rings = [30, 100, 300, 1000];
  const buckets = rings.map(() => []);
  /**
   * The yard just outside Weld: past the widest half-width (31.5 ft) and the gable ends
   * (71.7 ft), inside the neighbours. This annulus is the honest place to read GRADE --
   * inside it every low vertex is a wall base rather than open ground, and outside it the
   * next building's own terrain starts. Trees pollute the HIGH quantiles here and are why
   * this reports the low ones.
   */
  const yard = [];
  const cells = new Map();
  const farCells = new Map();
  let meshes = 0;
  let roofTop = -Infinity;

  group.traverse((o) => {
    const pos = o.isMesh ? o.geometry?.attributes?.position : null;
    if (!pos) return;
    meshes++;
    const m = o.matrixWorld.elements;
    // Subsample: a settled stage-3 view is ~1,500 tiles, and the quantiles this reports are
    // stable well below full vertex counts.
    const step = Math.max(1, Math.floor(pos.count / 3000));
    for (let i = 0; i < pos.count; i += step) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const d = Math.hypot(wx, wz);
      if (d <= 30 && wy > roofTop) roofTop = wy;
      if (d >= 35 && d <= 75) {
        yard.push(wy);
        /**
         * The same annulus, as a coarse DEM: lowest vertex per 20 ft cell, and the answer
         * is the MEDIAN over cells. That is the estimator this measurement actually turns
         * on. A global low percentile reads whatever the deepest artifact in the whole ring
         * is (a basement well, a mesh skirt under a path) and a median reads tree canopy;
         * per-cell minima are the ground under each patch, and taking their median throws
         * out both tails.
         */
        const cell = `${Math.floor(wx / 20)},${Math.floor(wz / 20)}`;
        let bin = cells.get(cell);
        if (!bin) cells.set(cell, (bin = []));
        bin.push(wy);
      }
      if (d >= 80 && d <= 160) {
        const fc = `${Math.floor(wx / 20)},${Math.floor(wz / 20)}`;
        let fbin = farCells.get(fc);
        if (!fbin) farCells.set(fc, (fbin = []));
        fbin.push(wy);
      }
      for (let r = 0; r < rings.length; r++) {
        if (d <= rings[r]) {
          buckets[r].push(wy);
          break;
        }
      }
    }
  });

  const stat = (arr) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const q = (p) => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1);
    return { n: s.length, p01: q(0.01), p05: q(0.05), p25: q(0.25), med: q(0.5), p95: q(0.95), p99: q(0.99) };
  };

  return {
    meshes,
    settled: window.__tiles?.settled,
    loaded: window.__tiles?.stats?.loaded,
    byRing: Object.fromEntries(rings.map((r, i) => [`r<=${r}ft`, stat(buckets[i])])),
    /** Grade, read in the yard ring. p05/p01 are the ground; the median is shrubbery upward. */
    yard: stat(yard),
    /**
     * THE ESTIMATOR: per-cell 10th percentile, then the median over cells. 0 means aligned.
     *
     * A percentile per cell rather than the cell's MINIMUM, because a minimum over ~185
     * samples of a noisy mesh reads about a foot below the surface it is sampling -- it is
     * an estimate of the noise floor, not of the ground. The median over cells then drops
     * the cells whose lowest visible surface is a neighbour's roof rather than the yard.
     */
    gradeFarFt: farCells.size
      ? (() => {
          const perCell = [...farCells.values()].map((bin) => {
            const s2 = bin.slice().sort((a, b) => a - b);
            return s2[Math.floor(0.1 * s2.length)];
          });
          const st = stat(perCell);
          return { cells: farCells.size, median: st.med, p25: st.p25 };
        })()
      : null,
    gradeFt: cells.size
      ? (() => {
          const perCell = [...cells.values()].map((bin) => {
            const s = bin.slice().sort((a, b) => a - b);
            return s[Math.floor(0.1 * s.length)];
          });
          const st = stat(perCell);
          return { cells: cells.size, median: st.med, p25: st.p25, p75: st.p95 };
        })()
      : null,
    /**
     * The highest vertex over Weld's own footprint. weld.json's ridge is 85.4 ft above
     * grade, so this is the independent cross-check on the datum: a mesh top far from 85.4
     * means the offset is wrong, not that the roof is. Photogrammetry rounds ridges off, so
     * a couple of feet short is expected and a couple of feet OVER is not.
     */
    roofTopFt: +roofTop.toFixed(1),
  };
});

console.log(JSON.stringify(out, null, 2));
await browser.close();
