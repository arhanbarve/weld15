import { describe, it, expect } from "vitest";
import {
  buildSuite,
  DEFAULT_PARAMS,
  findOverlaps,
  unreachableRooms,
  touches,
  type SuiteParams,
} from "@/geo/rooms";
// Not only for facadeStep's value. Importing place.ts is what registers the ring
// measurement with rooms.ts -- see provideFacadeStep -- so a stepped suite cannot
// be built without it, deliberately and loudly.
import { facadeStep } from "@/geo/place";

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

/**
 * params.wingStep, both ways round.
 *
 * The half of this that matters most is the OFF half. wingStep is a new field on an
 * interface four other modules build against, and the claim attached to it is that
 * nothing whatever changes until somebody turns it on -- so the straight layout is
 * pinned against a table written out by hand rather than against buildSuite()'s own
 * output, which would agree with itself however it drifted.
 */
describe("the wing step, off", () => {
  /**
   * Every room at the defaults, as of the commit that added wingStep. Frozen, and
   * literal on purpose: this is the layout in docs/FINAL-LAYOUT.md, in
   * design/weld15-plan.svg and in every render in design/renders.
   */
  const TODAY: [string, number, number, number, number][] = [
    ["common1", 0, 0, 20, 15],
    ["k", 20.5, 0, 10, 12],
    ["hall", 16.5, 15.5, 4.5, 28.5],
    ["bedA", 0, 15.5, 16, 10],
    ["unknown", 0, 26, 7.5, 7.5],
    ["bath", 8, 26, 8, 7.5],
    ["bedB", 0, 34, 16, 10],
  ];

  it("is off by default", () => {
    expect(DEFAULT_PARAMS.wingStep).toBe(false);
  });

  it("leaves the default layout exactly where it was", () => {
    expect(suite.rooms.map((r) => r.id)).toEqual(TODAY.map(([id]) => id));
    for (const [id, u, v, du, dv] of TODAY) {
      const r = byId(id);
      expect([r.u, r.v, r.du, r.dv], id).toEqual([u, v, du, dv]);
    }
    expect(suite.netArea).toBeCloseTo(984.5, 9);
    expect(suite.roomArea).toBeCloseTo(800, 9);
    expect(suite.maxDepth).toBeCloseTo(30.5, 9);
  });

  it("reads the flag rather than the shape", () => {
    // Both halves are needed. The first says an explicit false is the default; the
    // second says the flag does something, which is what stops "nothing changed"
    // from being satisfied by a step that never fires.
    const off = buildSuite({ ...DEFAULT_PARAMS, wingStep: false });
    expect(JSON.stringify(off.rooms)).toBe(JSON.stringify(suite.rooms));
    const on = buildSuite({ ...DEFAULT_PARAMS, wingStep: true });
    expect(JSON.stringify(on.rooms)).not.toBe(JSON.stringify(suite.rooms));
  });
});

describe("the wing step, on", () => {
  const params: SuiteParams = { ...DEFAULT_PARAMS, wingStep: true };
  const stepped = buildSuite(params);
  const step = facadeStep(params);
  const at = (s: ReturnType<typeof buildSuite>, id: string) => {
    const r = s.rooms.find((x) => x.id === id);
    if (!r) throw new Error(`no room ${id}`);
    return r;
  };

  it("moves the common room's outer face out by the projection the ring measures", () => {
    // 5.165 ft east. The value is asserted against the ring in tests/place.test.ts;
    // here the only claim is that the room moved by it and by nothing else.
    expect(step.projection).toBeGreaterThan(5);
    expect(at(stepped, "common1").u).toBeCloseTo(-step.projection, 9);
  });

  it("holds the common room's inner face, which K and the hall are hung off", () => {
    const c = at(stepped, "common1");
    expect(c.du).toBeCloseTo(DEFAULT_PARAMS.commonDeep + step.projection, 9);
    // The face the partition to K sits on. Moving it is what makes K landlocked.
    expect(c.u + c.du).toBeCloseTo(DEFAULT_PARAMS.commonDeep, 9);
    expect(c.dv).toBe(DEFAULT_PARAMS.commonAlong);
    expect(stepped.maxDepth).toBeCloseTo(suite.maxDepth, 9);
  });

  it("leaves every other room alone, including bedroom A, which straddles the step", () => {
    for (const r of suite.rooms) {
      if (r.id === "common1") continue;
      expect(JSON.stringify(at(stepped, r.id)), r.id).toBe(JSON.stringify(r));
    }
    // The straddle itself, so that "left straight" is recorded as a choice rather
    // than as a room that happened not to qualify: bedroom A starts south of the
    // step and ends north of it, 6.8 ft in the wing zone and 3.2 in the end zone.
    const bedA = at(stepped, "bedA");
    expect(bedA.v).toBeLessThan(step.v);
    expect(bedA.v + bedA.dv).toBeGreaterThan(step.v);
    expect(step.v - bedA.v).toBeCloseTo(6.8046, 3);
    expect(bedA.v + bedA.dv - step.v).toBeCloseTo(3.1954, 3);
  });

  it("adds 77.48 sq ft, all of it in the common room", () => {
    // projection 5.1651 ft across the common room's 15 ft. Nothing else changes, so
    // the same figure has to show up in both totals.
    const expected = step.projection * DEFAULT_PARAMS.commonAlong;
    expect(expected).toBeCloseTo(77.4763, 4);
    expect(stepped.netArea - suite.netArea).toBeCloseTo(expected, 9);
    expect(stepped.roomArea - suite.roomArea).toBeCloseTo(expected, 9);
  });

  it("still closes on the residuals the layout was derived from", () => {
    // Both residuals are arithmetic on the params, so the step must not touch them.
    // If it ever does, the step has changed the suite's derivation and not its shape.
    expect(stepped.residuals).toEqual(suite.residuals);
  });

  it("keeps the plan legal: no overlaps, nothing landlocked, K still on the common room", () => {
    expect(findOverlaps(stepped.rooms)).toEqual([]);
    expect(unreachableRooms(stepped)).toEqual([]);
    expect(touches(at(stepped, "k"), at(stepped, "common1"), params.partition)).toBe(true);
  });

  it("steps the west facade too, by its own measured amount", () => {
    // The west wing projects 5.298 ft against the east's 5.165 -- the ring is not
    // symmetric, and a step that used one number for both facades would be a guess
    // dressed as a measurement on whichever side it was not measured from.
    const west: SuiteParams = { ...params, facade: "west" };
    const w = buildSuite(west);
    const wStep = facadeStep(west);
    expect(wStep.projection).not.toBeCloseTo(step.projection, 2);
    expect(at(w, "common1").u).toBeCloseTo(-wStep.projection, 9);
    expect(findOverlaps(w.rooms)).toEqual([]);
    expect(unreachableRooms(w)).toEqual([]);
  });

  it("survives 500 randomised parameter sets stepped, as the straight suite does", () => {
    let seed = 20260730;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const jitter = (base: number, spread: number) => base + (rnd() * 2 - 1) * spread;

    for (let i = 0; i < 500; i++) {
      const p: SuiteParams = {
        ...DEFAULT_PARAMS,
        wingStep: true,
        facade: rnd() < 0.5 ? "east" : "west",
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
