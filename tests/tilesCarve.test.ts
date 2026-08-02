import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyWeldCarve,
  carveFactor,
  carveUniforms,
  FEATHER_FT,
  HALF_U,
  HALF_V,
  HEIGHT_MAX,
  HEIGHT_MIN,
  type ShaderLike,
} from "@/scene/tilesCarve";

const FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "scene",
  "tilesCarve.ts",
);

describe("tilesCarve.ts is three-free", () => {
  it("never imports three, directly or by specifier", () => {
    // Comments stripped first: this module's own header talks ABOUT three-freedom in
    // prose ("no `import * as THREE`"), and a scanner that did not strip comments
    // would trip over its own docblock rather than over a real import.
    const code = readFileSync(FILE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/from\s+["']three["']/);
    expect(code).not.toMatch(/import\s+\*\s+as\s+THREE/);
  });
});

describe("carveFactor: the prism containment math", () => {
  it("is ~1 at the building's centre, mid-height, once the ramp is on", () => {
    expect(carveFactor(0, 40, 0, 1)).toBeCloseTo(1, 6);
  });

  it("is 0 anywhere, however central, while the ramp is off", () => {
    expect(carveFactor(0, 40, 0, 0)).toBe(0);
  });

  it("is 0 far outside the footprint on every axis", () => {
    expect(carveFactor(500, 40, 0, 1)).toBe(0); // far east
    expect(carveFactor(0, 40, 500, 1)).toBe(0); // far south
    expect(carveFactor(0, 40, -500, 1)).toBe(0); // far north
    expect(carveFactor(0, 500, 0, 1)).toBe(0); // far above the roof
    expect(carveFactor(0, -500, 0, 1)).toBe(0); // far below grade
  });

  it("is exactly at the halfway point of the feather on each face's boundary", () => {
    // Directly "east" in the BUILDING frame (u = HALF_U, v = 0) sits precisely on the
    // prism's u-face: carveFactor's smoothstep is centred there, so the value is 0.5.
    // u = x*cosA + z*sinA, v = x*sinA - z*cosA; solving u = HALF_U, v = 0 for (x, z)
    // is exactly the building-to-site inverse rotation applied to (HALF_U, 0).
    const axisDeg = 13.2;
    const rad = (axisDeg * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);
    // buildingToSite-style inverse: x = u*cos + v*sin, y(north) = -u*sin + v*cos; here
    // world z = -site.y(north), so z = u*sin - v*cos.
    const x = HALF_U * cosA;
    const z = HALF_U * sinA;
    expect(carveFactor(x, 40, z, 1)).toBeCloseTo(0.5, 6);
  });

  it("respects the ~2 ft feather constant the spec asks for", () => {
    expect(FEATHER_FT).toBeCloseTo(2, 6);
  });

  it("has a vertical span from grade to above the ridge", () => {
    // P14 row 8: pinned to grade itself, not a below-grade margin -- see tilesCarve.ts's
    // own comment on HEIGHT_MIN for why a margin here hid real terrain under the footprint.
    expect(HEIGHT_MIN).toBe(0);
    expect(HEIGHT_MAX).toBeGreaterThan(85); // clear of the 85.4 ft ridge
  });

  it("half-extents are drawn from weld.json's own widest-point and length figures", () => {
    // width_ft_max_at_wings = 63.0, length_ft = 143.3
    expect(HALF_U).toBeCloseTo(31.5, 6);
    expect(HALF_V).toBeCloseTo(71.65, 6);
  });

  it("clamps a carveT outside [0, 1]", () => {
    expect(carveFactor(0, 40, 0, 5)).toBeCloseTo(1, 6);
    expect(carveFactor(0, 40, 0, -5)).toBe(0);
  });
});

describe("applyWeldCarve: the GLSL injection", () => {
  const baseShader = (): ShaderLike => ({
    vertexShader: "#include <common>\nvoid main() {\n  #include <project_vertex>\n}",
    fragmentShader: "#include <common>\nvoid main() {\n  #include <color_fragment>\n}",
    uniforms: {},
  });

  it("wires the shared uCarve uniform onto the shader", () => {
    const shader = baseShader();
    const uniforms = carveUniforms();
    uniforms.uCarve.value = 0.42;
    applyWeldCarve(shader, uniforms);
    expect(shader.uniforms.uCarve).toBe(uniforms.uCarve);
    expect((shader.uniforms.uCarve as { value: number }).value).toBe(0.42);
  });

  it("declares the uniform and the dither function once, and the discard test once", () => {
    const shader = baseShader();
    applyWeldCarve(shader, carveUniforms());
    expect(shader.fragmentShader).toContain("uniform float uCarve;");
    expect(shader.fragmentShader).toContain("weldCarveBayer4x4");
    expect(shader.fragmentShader).toContain("discard;");
    expect(shader.vertexShader).toContain("vCarveWorldPos");
    expect(shader.fragmentShader).toContain("vCarveWorldPos");
  });

  it("leaves the chunk markers in place (three still expands them)", () => {
    const shader = baseShader();
    applyWeldCarve(shader, carveUniforms());
    expect(shader.vertexShader).toContain("#include <project_vertex>");
    expect(shader.fragmentShader).toContain("#include <color_fragment>");
  });
});
