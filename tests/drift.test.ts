import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The anti-drift gate.
 *
 * "54 x 151" survived across three separate artifacts because each one carried
 * its own copy of the geometry and nothing compared them. The drawing and the
 * docs are now generated from buildSuite() and buildWalls(), and these tests
 * fail if the committed output stops matching what the code produces -- which is
 * what makes "generated" a guarantee rather than a comment.
 */
function generate(script: string): string {
  return execFileSync("node", [join(root, "scripts", script)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

describe("generated artifacts match the geometry", () => {
  it("design/weld15-plan.svg is current", () => {
    const generated = generate("emit-plan.mjs").trim();
    const committed = readFileSync(join(root, "design/weld15-plan.svg"), "utf8").trim();
    expect(
      committed === generated,
      "design/weld15-plan.svg is stale. Run `npm run plan`.",
    ).toBe(true);
  });

  it("docs/FINAL-LAYOUT.md carries the current layout tables", () => {
    const generated = generate("emit-layout.mjs").trim();
    const doc = readFileSync(join(root, "docs/FINAL-LAYOUT.md"), "utf8");
    // Skip the generated-by comment line; compare the tables themselves.
    const body = generated.split("\n").slice(2).join("\n").trim();
    expect(
      doc.includes(body),
      "docs/FINAL-LAYOUT.md is stale. Run `npm run plan` and re-splice.",
    ).toBe(true);
  });

  it("the generators actually produce content, so the checks are not vacuous", () => {
    const svg = generate("emit-plan.mjs");
    expect(svg).toContain("<svg");
    expect(svg).toContain("Bedroom A");
    expect(svg.length).toBeGreaterThan(3000);
    const layout = generate("emit-layout.mjs");
    expect(layout).toContain("| Room |");
    expect(layout).toContain("Residuals at defaults");
  });
});
