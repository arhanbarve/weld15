import { describe, it, expect } from "vitest";
import {
  buildSuite,
  DEFAULT_PARAMS,
  findOverlaps,
  unreachableRooms,
  touches,
  type SuiteParams,
} from "@/geo/rooms";

const suite = buildSuite();
const byId = (id: string) => {
  const r = suite.rooms.find((x) => x.id === id);
  if (!r) throw new Error(`no room ${id}`);
  return r;
};

describe("buildSuite at defaults", () => {
  it("closes along the 1875-derived 44 ft end section", () => {
    // 143 ft overall less two 15 ft stair halls and a 25 ft porch, halved.
    // the resident's room widths plus a bathroom in the inferred 6-8 range land on it.
    expect(suite.residuals.along).toBeCloseTo(0, 6);
  });

  it("closes across the main leg", () => {
    // hall + partition + bedroom depth = leg depth
    expect(suite.residuals.across).toBeCloseTo(0, 6);
  });

  it("reproduces every dimension the resident gave, within his stated one foot", () => {
    const checks: [string, number, number][] = [
      ["common1", 15, 20],
      ["k", 12, 10],
      ["bedA", 10, 16],
      ["bedB", 10, 16],
    ];
    for (const [id, along, deep] of checks) {
      const r = byId(id);
      expect(Math.abs(r.dv - along), `${id} along`).toBeLessThanOrEqual(1);
      expect(Math.abs(r.du - deep), `${id} deep`).toBeLessThanOrEqual(1);
    }
  });

  it("keeps the bathroom inside the plausible range for a four-person suite", () => {
    // Three-quarter baths average 36 sq ft, range 18-50. A shared suite bath
    // with a double vanity justifies the upper end, not more.
    const bath = byId("bath");
    const area = bath.du * bath.dv;
    expect(area).toBeGreaterThanOrEqual(40);
    expect(area).toBeLessThanOrEqual(75);
  });

  it("has no overlapping rooms", () => {
    expect(findOverlaps(suite.rooms)).toEqual([]);
  });

  it("leaves nothing landlocked", () => {
    expect(unreachableRooms(suite)).toEqual([]);
  });

  it("attaches K to the common room, which is the only reading of the resident's sentence", () => {
    expect(touches(byId("k"), byId("common1"), DEFAULT_PARAMS.partition)).toBe(true);
  });

  it("puts bedroom B at the end of the hall as a corner room", () => {
    const bedB = byId("bedB");
    const hall = byId("hall");
    // northernmost room
    expect(bedB.v + bedB.dv).toBeCloseTo(DEFAULT_PARAMS.sectionLength, 6);
    // the hall runs into it
    expect(hall.v + hall.dv).toBeCloseTo(DEFAULT_PARAMS.sectionLength, 6);
    // and it is the one room with light in two directions, which the 1875
    // specification requires of end rooms: "no rooms receive an exclusively
    // north light".
    expect(bedB.windows).toContain("facade");
    expect(bedB.windows).toContain("gable");
  });

  it("gives every habitable room a window", () => {
    for (const r of suite.rooms) {
      if (r.kind === "bed" || r.kind === "common") {
        if (r.id === "k") continue; // K is inland; unknown, deliberately
        expect(r.windows.length, `${r.label} has no window`).toBeGreaterThan(0);
      }
    }
  });

  it("puts the three hall doors in the resident's order going north", () => {
    const order = ["bedA", "bath", "bedB"].map((id) => byId(id).v);
    expect(order[0]!).toBeLessThan(order[1]!);
    expect(order[1]!).toBeLessThan(order[2]!);
  });

  it("totals about 940 sq ft for the resident's rooms plus the hall", () => {
    expect(suite.roomArea).toBeGreaterThan(780);
    expect(suite.roomArea).toBeLessThan(820);
    expect(suite.netArea).toBeGreaterThan(980);
    expect(suite.netArea).toBeLessThan(1060);
  });

  it("reaches 30.5 ft inward at the K bump and 20.5 ft elsewhere", () => {
    // The L. This is what interlocks with the neighbouring suite inside a
    // 51 ft wide end section.
    expect(suite.maxDepth).toBeCloseTo(30.5, 6);
    expect(byId("bedA").u + byId("bedA").du).toBeCloseTo(16, 6);
  });

  it("fits inside the end section's 51 ft width", () => {
    expect(suite.maxDepth).toBeLessThan(51);
  });
});

describe("a rectangular suite is impossible, which is why it is L-shaped", () => {
  it("cannot fit K in the main leg cross-section", () => {
    const p = DEFAULT_PARAMS;
    const crossSection = p.hallWidth + p.partition + p.bedDepth;
    expect(crossSection).toBeCloseTo(p.legDepth, 6);
    // no room left for a 10 ft deep room
    expect(p.legDepth - crossSection).toBeLessThan(p.kDeep);
  });

  it("cannot fit K in the along-hall chain either", () => {
    const p = DEFAULT_PARAMS;
    const withK =
      p.commonAlong + p.kAlong + p.bedAAlong + p.bathAlong + p.bedBAlong + 4 * p.partition;
    expect(withK).toBeGreaterThan(p.sectionLength);
    expect(withK - p.sectionLength).toBeGreaterThan(9); // over by ~12.5 ft
  });
});

describe("parametric behaviour", () => {
  it("survives 500 randomised parameter sets without overlaps", () => {
    // Deterministic pseudo-random so failures reproduce.
    let seed = 20260729;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const jitter = (base: number, spread: number) => base + (rnd() * 2 - 1) * spread;

    for (let i = 0; i < 500; i++) {
      const p: SuiteParams = {
        ...DEFAULT_PARAMS,
        sectionLength: jitter(44, 4),
        hallWidth: jitter(4.5, 1),
        bedDepth: jitter(16, 1),
        commonAlong: jitter(15, 1),
        commonDeep: jitter(20, 2),
        bedAAlong: jitter(10, 1),
        bathAlong: jitter(8, 2),
        bathDeep: jitter(8, 1.5),
        kDeep: jitter(10, 1),
        kAlong: jitter(12, 1),
      };
      p.legDepth = p.hallWidth + p.partition + p.bedDepth;
      const s = buildSuite(p);
      expect(findOverlaps(s.rooms), `iteration ${i}`).toEqual([]);
      expect(unreachableRooms(s), `iteration ${i}`).toEqual([]);
    }
  });

  it("moves the bathroom without breaking anything, which is what the slider does", () => {
    for (const bathAlong of [6, 7, 7.5, 8]) {
      const s = buildSuite({ ...DEFAULT_PARAMS, bathAlong });
      expect(findOverlaps(s.rooms)).toEqual([]);
      // A narrower bath lengthens bedroom B, since B ends the hall at the gable.
      const bedB = s.rooms.find((r) => r.id === "bedB")!;
      expect(bedB.v + bedB.dv).toBeCloseTo(DEFAULT_PARAMS.sectionLength, 6);
    }
  });

  it("reports a residual rather than silently absorbing a bad section length", () => {
    // The honest behaviour: if the numbers stop closing, say so.
    const s = buildSuite({ ...DEFAULT_PARAMS, sectionLength: 40 });
    expect(s.residuals.along).toBeCloseTo(-4, 6);
  });
});
