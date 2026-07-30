import { describe, it, expect } from "vitest";
import {
  buildSuite,
  DEFAULT_PARAMS,
  unreachableRooms,
  type SuiteParams,
} from "@/geo/rooms";
import {
  buildWalls,
  footprintArea,
  suiteFootprint,
  wallBetween,
  type Wall,
} from "@/geo/walls";

const suite = buildSuite();
const { walls, openings } = buildWalls(suite);

const area = (r: { du: number; dv: number }) => r.du * r.dv;
const overlap = (a: Wall, b: Wall) => {
  const eps = 1e-9;
  const sep =
    a.u + a.du <= b.u + eps ||
    b.u + b.du <= a.u + eps ||
    a.v + a.dv <= b.v + eps ||
    b.v + b.dv <= a.v + eps;
  return !sep;
};

describe("area conservation", () => {
  it("tiles the suite footprint: rooms plus walls, nothing lost or double-counted", () => {
    // The strongest correctness check available. It is what catches the
    // doubled-wall class of bug that muddied the SVG prototype: a wall counted
    // twice shows up here as excess area.
    const roomArea = suite.rooms.reduce((a, r) => a + area(r), 0);
    const interior = walls.filter((w) => !w.perimeter);
    const wallArea = interior.reduce((a, w) => a + area(w), 0);
    expect(roomArea + wallArea).toBeCloseTo(footprintArea(suite), 2);
    // and the perimeter is real, not an empty list
    expect(walls.filter((w) => w.perimeter).length).toBeGreaterThan(3);
  });

  it("has a footprint matching the L: main leg plus the K bump", () => {
    const p = DEFAULT_PARAMS;
    const k = suite.rooms.find((r) => r.id === "k")!;
    const expected = p.legDepth * p.sectionLength + (k.u + k.du - p.legDepth) * k.dv;
    expect(footprintArea(suite)).toBeCloseTo(expected, 6);
    expect(suiteFootprint(suite)).toHaveLength(2);
  });

  it("emits every wall exactly once, so no two bands overlap", () => {
    const bad: string[] = [];
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        if (overlap(walls[i]!, walls[j]!)) bad.push(`${walls[i]!.id}/${walls[j]!.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("never puts a wall band inside a room", () => {
    const bad: string[] = [];
    for (const w of walls) {
      for (const r of suite.rooms) {
        const eps = 1e-9;
        const sep =
          w.u + w.du <= r.u + eps ||
          r.u + r.du <= w.u + eps ||
          w.v + w.dv <= r.v + eps ||
          r.v + r.dv <= w.v + eps;
        if (!sep) bad.push(`${w.id} in ${r.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("produces walls at all, so the checks above are not vacuous", () => {
    expect(walls.filter((w) => !w.perimeter).length).toBeGreaterThan(4);
    expect(walls.reduce((a, w) => a + area(w), 0)).toBeGreaterThan(30);
  });
});

describe("classification", () => {
  it("marks exterior only on the facade or the north gable", () => {
    const p = DEFAULT_PARAMS;
    for (const w of walls.filter((x) => x.kind === "exterior")) {
      const onFacade = w.u < 1e-9;
      const onGable = w.v + 1e-9 >= p.sectionLength;
      expect(onFacade || onGable, `${w.id} is exterior but on neither face`).toBe(true);
    }
  });

  it("finds both an exterior and a partition band", () => {
    expect(walls.some((w) => w.kind === "exterior")).toBe(true);
    expect(walls.some((w) => w.kind === "partition")).toBe(true);
  });
});

describe("openings land inside the room they belong to", () => {
  // The bug these exist for: every face window was centred on its BAND rather than
  // on its room, so all four facade windows came back as the identical opening at
  // v 18 to 26 -- stacked in one hole in front of bedroom A, with no glass at all in
  // the common room, bedroom B's facade, or the strip. Nothing compared two windows
  // to each other, so nothing caught it, and one of the four does land correctly,
  // which is enough to make a screenshot look right.

  /** An opening's span in the band's own long axis, as absolute suite coordinates. */
  const span = (o: (typeof openings)[number]) => {
    const w = walls.find((x) => x.id === o.wallId)!;
    const alongV = w.dv > w.du;
    const start = (alongV ? w.v : w.u) + o.offset;
    return { alongV, start, end: start + o.width };
  };

  it("gives every window a distinct position", () => {
    const keys = openings
      .filter((o) => o.kind === "window")
      .map((o) => {
        const s = span(o);
        return `${o.wallId}:${s.start.toFixed(3)}:${s.end.toFixed(3)}`;
      });
    expect(new Set(keys).size, `coincident windows: ${keys.join(" | ")}`).toBe(keys.length);
  });

  it("puts each window inside the run of the room it lights", () => {
    for (const o of openings.filter((x) => x.kind === "window")) {
      const room = suite.rooms.find((r) => r.id === o.connects[0])!;
      const s = span(o);
      const lo = s.alongV ? room.v : room.u;
      const hi = lo + (s.alongV ? room.dv : room.du);
      expect(s.start, `${o.id} (${room.id}) starts before the room`).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(s.end, `${o.id} (${room.id}) ends past the room`).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  it("gives every room that declares a window an actual window", () => {
    for (const room of suite.rooms) {
      for (const face of room.windows) {
        const mine = openings.filter(
          (o) => o.kind === "window" && o.connects.includes(room.id) && o.note === face,
        );
        expect(mine, `${room.id} declares a ${face} window and has none`).toHaveLength(1);
      }
    }
  });

  it("puts the suite entry door inside the hall, not in the band beyond it", () => {
    // The band runs from v = 12.5, past the K bump; the hall starts at v = 15.5. A
    // flat offset left two thirds of the door outside the hall, backed by the bands
    // behind it, so it read as a shallow niche instead of a hole.
    const entry = openings.find((o) => o.connects.includes("outside"))!;
    const hall = suite.rooms.find((r) => r.id === "hall")!;
    const s = span(entry);
    expect(s.start).toBeGreaterThanOrEqual(hall.v - 1e-9);
    expect(s.end).toBeLessThanOrEqual(hall.v + hall.dv + 1e-9);
  });
});

describe("openings", () => {
  it("places every opening wholly within exactly one wall band", () => {
    for (const o of openings) {
      const w = walls.find((x) => x.id === o.wallId);
      expect(w, `${o.id} references a missing wall`).toBeDefined();
      const along = w!.du > w!.dv ? w!.du : w!.dv;
      expect(o.offset, `${o.id} starts before its wall`).toBeGreaterThanOrEqual(-1e-9);
      expect(o.offset + o.width, `${o.id} runs past its wall`).toBeLessThanOrEqual(along + 1e-9);
      expect(o.width).toBeGreaterThan(0);
    }
  });

  it("puts the bathroom door on a wall that genuinely divides the hall from the bath", () => {
    // This test existed before and passed while the door was in the wrong wall,
    // because it asserted membership in `between` -- and `between` lists every room
    // a merged band runs past. The band at v = 25.5 touches the bath AND the hall
    // without dividing them, so the assertion was satisfied by a wall 8 ft away
    // from the one the door needed to be in. Assert `separates` instead, which is
    // the relation the door actually depends on.
    const w = wallBetween(walls, "hall", "bath");
    expect(w, "no wall divides the hall from the bathroom").toBeDefined();
    expect(
      w!.separates.some(
        ([a, b]) =>
          (a === "hall" && b === "bath") || (a === "bath" && b === "hall"),
      ),
      `${w!.id} touches both but divides ${JSON.stringify(w!.separates)}`,
    ).toBe(true);

    // And the geometry has to agree: the two rooms sit on opposite faces of it.
    const bath = suite.rooms.find((r) => r.id === "bath")!;
    const hall = suite.rooms.find((r) => r.id === "hall")!;
    expect(w!.u).toBeCloseTo(bath.u + bath.du, 6);
    expect(w!.u + w!.du).toBeCloseTo(hall.u, 6);

    const door = openings.find((o) => o.kind === "door" && o.connects.includes("bath"));
    expect(door).toBeDefined();
    expect(door!.wallId).toBe(w!.id);
  });

  it("gives the unknown strip no door, and does not call that unreachable", () => {
    // The strip beside the bathroom is space the project can measure and cannot
    // name, so it gets no opening -- see rooms.ts. What must NOT happen is a door
    // appearing there by accident, which is how it would acquire an invented use.
    const strip = suite.rooms.find((r) => r.id === "unknown")!;
    expect(strip.kind).toBe("unknown");

    const its = openings.filter((o) => o.connects.includes("unknown"));
    expect(its.filter((o) => o.kind === "door")).toEqual([]);
    // It does keep the facade window, which is the whole reason the bathroom took
    // the hall side rather than this strip: one of the two had to be the interior
    // room, and a windowless bathroom is ordinary where a windowless unknown is
    // just less informative. So assert the window is present, not merely allowed.
    expect(its.filter((o) => o.kind === "window")).toHaveLength(1);
    expect(unreachableRooms(suite)).toEqual([]);
  });

  it("opens the three hall doors the resident describes, plus K off the common room", () => {
    const doors = openings.filter((o) => o.kind === "door");
    const pair = (a: string, b: string) =>
      doors.some((d) => d.connects.includes(a) && d.connects.includes(b));
    expect(pair("hall", "bedA")).toBe(true);
    expect(pair("hall", "bath")).toBe(true);
    expect(pair("hall", "bedB")).toBe(true);
    // "attached to the common room" -- K is reached through it, not off the hall
    expect(pair("common1", "k")).toBe(true);
    expect(pair("hall", "k")).toBe(false);
  });

  it("has a suite entry door in the hall's inner wall", () => {
    const entry = openings.find((o) => o.connects.includes("outside"));
    expect(entry).toBeDefined();
    const w = walls.find((x) => x.id === entry!.wallId)!;
    expect(w.kind).toBe("partition");
    expect(w.between).toContain("hall");
  });

  it("glazes every room that rooms.ts says has a window", () => {
    for (const r of suite.rooms) {
      for (const face of r.windows) {
        const win = openings.find(
          (o) => o.kind === "window" && o.connects.includes(r.id) && o.note === face,
        );
        expect(win, `${r.label} has no ${face} window`).toBeDefined();
      }
    }
  });

  it("gives K no window, because whether it has one is unknown", () => {
    expect(openings.some((o) => o.kind === "window" && o.connects.includes("k"))).toBe(false);
  });
});

describe("robustness across the sliders", () => {
  it("conserves area over 200 randomised parameter sets", () => {
    let seed = 4242;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const jitter = (b: number, s: number) => b + (rnd() * 2 - 1) * s;

    for (let i = 0; i < 200; i++) {
      const p: SuiteParams = {
        ...DEFAULT_PARAMS,
        sectionLength: jitter(44, 3),
        hallWidth: jitter(4.5, 0.8),
        bedDepth: jitter(16, 1),
        commonAlong: jitter(15, 1),
        commonDeep: jitter(20, 1.5),
        bedAAlong: jitter(10, 1),
        bathAlong: jitter(7.5, 1.5),
        bathDeep: jitter(8, 1),
        kDeep: jitter(10, 1),
        kAlong: jitter(12, 1),
      };
      p.legDepth = p.hallWidth + p.partition + p.bedDepth;
      const s = buildSuite(p);
      const { walls: w, openings: o } = buildWalls(s);
      const total =
        s.rooms.reduce((a, r) => a + area(r), 0) +
        w.filter((x) => !x.perimeter).reduce((a, x) => a + area(x), 0);
      expect(total, `iteration ${i} area`).toBeCloseTo(footprintArea(s), 2);
      for (const op of o) {
        const wall = w.find((x) => x.id === op.wallId)!;
        const along = wall.du > wall.dv ? wall.du : wall.dv;
        expect(op.offset + op.width, `iteration ${i} opening ${op.id}`).toBeLessThanOrEqual(
          along + 1e-9,
        );
      }
    }
  });
});
