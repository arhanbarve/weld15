import { describe, it, expect } from "vitest";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import campus from "@/data/campus.json";
import weld from "@/data/weld.json";
import { latLonToSite, WELD_ORIGIN } from "@/geo/frames";
import { GROUND_LEVELS, manifest, quadOf } from "@/scene/imagery";

/**
 * The manifest, the plates, and the georeferencing.
 *
 * WHAT THIS CAN AND CANNOT CHECK, said plainly, because the important verification for P9b is a
 * PICTURE and not a number. design/renders/p9-georef-overlay.png draws all 36 campus.json
 * footprints onto the deepest plate, and that is the only thing that can actually settle whether
 * the photograph is rotated or offset against the model -- every coordinate here would be equally
 * plausible if the imagery were turned 1.4 degrees. frames.ts:13-17 makes the same point about
 * mirroring being invisible.
 *
 * So what this file does is the half a number CAN carry: that the manifest describes the files that
 * exist, that the extents nest, that the site-feet mapping puts known buildings inside the plate
 * that is supposed to contain them, and that the resolution claims are not inflated.
 */

const PUBLIC = join(process.cwd(), "public", "imagery");

describe("the manifest describes what actually shipped", () => {
  it("has all five levels", () => {
    expect(Object.keys(manifest.levels).sort()).toEqual(["L0", "L1", "L2", "L3", "L4"]);
  });

  it("names files that exist on disk, in both formats", () => {
    for (const [id, level] of Object.entries(manifest.levels)) {
      for (const fmt of ["avif", "webp"]) {
        const entry = level.files[fmt];
        expect(entry, `${id} has no ${fmt}`).toBeDefined();
        const path = join(PUBLIC, entry!.file);
        expect(existsSync(path), `${path} is missing`).toBe(true);
        // The recorded byte count is the file's, so a re-encode that was not re-manifested fails.
        expect(statSync(path).size, `${entry!.file} size drifted`).toBe(entry!.bytes);
      }
    }
  });

  it("stays inside the budget the plan set", () => {
    // P9.md section 6.2 budgeted about 2.6 MB of AVIF and 4.1 MB shipping WebP alongside. Measured
    // here: 2.20 MB and 5.66 MB. The AVIF total came in UNDER and the combined total over, because
    // WebP is 2.6x AVIF on photographic content rather than the 1.5x the plan assumed. Both are
    // asserted so a level added without thought shows up as a failure rather than as a fat repo.
    const total = (fmt: string) =>
      Object.values(manifest.levels).reduce((n, l) => n + (l.files[fmt]?.bytes ?? 0), 0);
    expect(total("avif")).toBeLessThan(2.6 * 1024 * 1024);
    expect(total("avif") + total("webp")).toBeLessThan(6 * 1024 * 1024);
  });

  it("records a licence and an attribution for every level", () => {
    // NOT DECORATION. Every plate here is redistributed third-party imagery, and both sources ask
    // for acknowledgement. A level that arrived without provenance would be the one thing in this
    // repository that is genuinely not allowed to ship.
    for (const [id, level] of Object.entries(manifest.levels)) {
      expect(level.provenance.licence, `${id} licence`).toBeTruthy();
      expect(level.provenance.attribution, `${id} attribution`).toBeTruthy();
      expect(level.provenance.dataset, `${id} dataset`).toBeTruthy();
    }
  });

  it("does not claim more resolution than was flown", () => {
    // The tile service serves z20 at 0.362 ft/px, which is FINER than the 0.492 ft the imagery was
    // actually captured at, so the extra grid density is interpolation. The manifest must keep the
    // two figures separate rather than presenting the grid as the resolution -- docs/SOURCES.md
    // says so and this is the assertion behind it.
    //
    // EXPECTED VALUE IS PER-LEVEL, NOT A SHARED CONSTANT, because P10 moved L3 to USDA NAIP while
    // L2 and L4 are still MassGIS: 0.492 ft (leaf-off) and 0.9842519685 ft (NAIP's 0.3 m, leaf-on)
    // are both real flown resolutions, just from different sources. This map will need another
    // update when a later task moves more levels off MassGIS.
    const EXPECTED_NATIVE_FT: Record<string, number> = { L2: 0.492, L3: 0.9842519685, L4: 0.492 };
    for (const id of ["L2", "L3", "L4"]) {
      const p = manifest.levels[id]!.provenance;
      expect(p.nativeResolutionFt, `${id} native resolution`).toBeCloseTo(EXPECTED_NATIVE_FT[id]!, 3);
    }
  });
});

describe("the ground quads nest and are centred on Weld", () => {
  it("gets strictly smaller from L1 inward", () => {
    const widths = GROUND_LEVELS.map((id) => quadOf(id)!.width);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!, `${GROUND_LEVELS[i]} is not inside ${GROUND_LEVELS[i - 1]}`).toBeLessThan(
        widths[i - 1]!,
      );
    }
    // And each is about a decade smaller, which is the property that makes four plates cover five
    // decades of altitude. L1 to L2 is 20x because L1 is a 1,000 km Blue Marble crop rather than a
    // tenth of one; the rest are 10x.
    expect(widths[0]! / widths[1]!).toBeGreaterThan(9);
    expect(widths[1]! / widths[2]!).toBeCloseTo(10, 5);
    expect(widths[2]! / widths[3]!).toBeCloseTo(10.25, 1);
  });

  it("centres every quad on the site origin", () => {
    // The site origin IS Weld's centroid (frames.ts), so a non-zero centre would mean the
    // photograph was resampled about some other point and the whole model would sit off it.
    for (const id of GROUND_LEVELS) {
      const q = quadOf(id)!;
      expect(q.cx, `${id} cx`).toBeCloseTo(0, 6);
      expect(q.cy, `${id} cy`).toBeCloseTo(0, 6);
    }
  });

  it("has no site extent on the global plate", () => {
    // L0 is the whole Earth in equirectangular, so a site-feet extent would be meaningless. It is
    // deliberately absent, and Ground.tsx never asks for it -- GROUND_LEVELS starts at L1.
    expect(manifest.levels.L0!.global).toBe(true);
    expect(manifest.levels.L0!.extentFt).toBeUndefined();
    expect(GROUND_LEVELS as readonly string[]).not.toContain("L0");
  });

  it("agrees with its own ftPerTexel", () => {
    for (const id of GROUND_LEVELS) {
      const level = manifest.levels[id]!;
      const q = quadOf(id)!;
      expect(level.ftPerTexel!, `${id}`).toBeCloseTo(q.width / level.px[0], 3);
    }
  });
});

describe("the georeferencing puts real buildings where they belong", () => {
  /** A building's ring, projected to site feet if it is not already there. */
  const rings = campus.buildings.filter((b) => Array.isArray(b.ring)).map((b) => b.ring as number[][]);

  it("contains the whole modelled campus inside the 5 km plate", () => {
    // campus.json spans 1,149 x 1,269 ft, so L3 at 16,400 ft should swallow it many times over. If
    // this fails the extent in the manifest is wrong, not the buildings.
    const q = quadOf("L3")!;
    for (const ring of rings) {
      for (const [x, y] of ring) {
        expect(Math.abs(x!), `x ${x} outside L3`).toBeLessThan(q.width / 2);
        expect(Math.abs(y!), `y ${y} outside L3`).toBeLessThan(q.height / 2);
      }
    }
  });

  it("contains Weld itself inside the deepest plate, with room to spare", () => {
    // L4 is only 1,600 ft across, so this is the one that could genuinely fail: Weld is 143 ft
    // long and the plate has to hold it plus enough of the Yard to be worth having.
    const q = quadOf("L4")!;
    const xs = weld.rings.flat().map((p) => (p as number[])[0]!);
    const ys = weld.rings.flat().map((p) => (p as number[])[1]!);
    expect(Math.max(...xs.map(Math.abs))).toBeLessThan(q.width / 2);
    expect(Math.max(...ys.map(Math.abs))).toBeLessThan(q.height / 2);
    // And it occupies a sensible fraction of it: a Weld that filled the plate would mean the
    // extent was mis-scaled by an order of magnitude, which is the failure mode a containment
    // check alone would miss.
    const span = Math.max(...ys) - Math.min(...ys);
    expect(span / q.height).toBeGreaterThan(0.05);
    expect(span / q.height).toBeLessThan(0.5);
  });

  it("uses the same origin the frames module does", () => {
    // The fetch script copies WELD_ORIGIN rather than importing it, because a plain-node script
    // cannot resolve the "@/" alias. assertFramesAgree() guards that at generation time; this
    // guards the artefact it produced, so a manifest generated against a since-changed origin
    // fails here rather than silently placing the Yard in the wrong field.
    expect(manifest.origin.lat).toBeCloseTo(WELD_ORIGIN.lat, 9);
    expect(manifest.origin.lon).toBeCloseTo(WELD_ORIGIN.lon, 9);
    // latLonToSite is the function the resampling inverted, so the origin must map to (0, 0).
    const o = latLonToSite(WELD_ORIGIN.lat, WELD_ORIGIN.lon);
    expect(o.x).toBeCloseTo(0, 9);
    expect(o.y).toBeCloseTo(0, 9);
  });

  it("puts Widener south-east of Weld, which is where it is", () => {
    // ONE ORIENTATION CHECK WITH A REAL ANSWER, because containment cannot catch a mirror and a
    // mirror is the error frames.ts warns is invisible. Widener Library sits across the Yard to
    // the south and east of Weld; its centroid must therefore have x > 0 and y < 0 in site feet.
    // If the site frame were flipped in either axis this fails, and the committed overlay is the
    // picture that confirms it.
    const widener = campus.buildings.find((b) => b.name === "Widener Library");
    expect(widener, "Widener is in campus.json").toBeDefined();
    const ring = widener!.ring as number[][];
    const cx = ring.reduce((n, p) => n + p[0]!, 0) / ring.length;
    const cy = ring.reduce((n, p) => n + p[1]!, 0) / ring.length;
    expect(cx, "Widener is east of Weld").toBeGreaterThan(0);
    expect(cy, "Widener is south of Weld").toBeLessThan(0);
  });
});
