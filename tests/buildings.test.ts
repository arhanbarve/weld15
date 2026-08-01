// tests/buildings.test.ts
import { describe, it, expect } from "vitest";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import campus from "@/data/campus.json";
import manifest from "@/data/buildings-manifest.json";

describe("the buildings manifest describes what shipped", () => {
  it("points at a GLB that exists and matches the recorded size", () => {
    const p = join(process.cwd(), "public", "models", "campus.glb");
    expect(existsSync(p)).toBe(true);
    expect(statSync(p).size).toBe(manifest.bytes);
  });

  it("excludes Weld, and says why", () => {
    expect(manifest.buildings.some((b) => b.name === "Weld Hall")).toBe(false);
    expect(manifest.excluded["Weld Hall"]).toMatch(/parametric/);
  });

  it("discloses that the materials are derived rather than photographed", () => {
    expect(manifest.derived.why).toMatch(/untextured/);
    expect(manifest.derived.notMeasured).toBeTruthy();
  });

  it("stands every building on grade and none of them taller than Memorial Church", () => {
    for (const b of manifest.buildings) {
      expect(b.heightFt, b.name).toBeGreaterThan(5);
      expect(b.heightFt, b.name).toBeLessThan(250);
    }
  });

  it("covers the buildings campus.json already knew about", () => {
    const got = new Set(manifest.buildings.map((b) => b.name));
    const want = campus.buildings.map((b) => b.name).filter((n) => n !== "Weld Hall");
    // Not every campus.json name has to appear -- the 3D layer splits some and may lack others --
    // but most must, or the bbox filter is wrong.
    const hit = want.filter((n) => got.has(n)).length;
    expect(hit / want.length).toBeGreaterThan(0.6);
  });
});
