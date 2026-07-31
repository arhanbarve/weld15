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

  it("opens the three hall doors the resident describes, K off the common room, and the hall into it", () => {
    const doors = openings.filter((o) => o.kind === "door");
    const pair = (a: string, b: string) =>
      doors.some((d) => d.connects.includes(a) && d.connects.includes(b));
    expect(pair("hall", "bedA")).toBe(true);
    expect(pair("hall", "bath")).toBe(true);
    expect(pair("hall", "bedB")).toBe(true);
    // "attached to the common room" -- K is reached through it, not off the hall
    expect(pair("common1", "k")).toBe(true);
    expect(pair("hall", "k")).toBe(false);
    // And the one that was missing until it was added, which is what joined the two
    // halves of the suite: without it route("hall", "common1") was null and no viewer
    // could be walked to the room the suite is named for. Measured, both before and
    // after, in tests/route.test.ts and tests/walk.test.ts.
    expect(pair("hall", "common1")).toBe(true);
    // Six doors: the four interior ones above, the suite entry, and this one. Measured
    // with the eleven openings -- five of them windows -- in the count below.
    expect(doors.map((o) => o.id)).toEqual(["d0", "d1", "d2", "d3", "d4", "d5"]);
    expect(openings.length).toBe(11);
  });

  it("slides the hall's door into the stretch the two rooms share, not the band's centre", () => {
    /*
     * THE MEASUREMENT THE CLAMP IN door() EXISTS FOR, and the reason it is not a
     * refinement. w0 is one merged 21 ft band at v 15 to 15.5 running the whole leg
     * depth: it separates the common room from bedroom A over u 0 to 16, and from the
     * hall over u 16.5 to 20. Centred on the BAND a 3 ft door lands at u 9 to 12, which
     * is in front of bedroom A -- so `connects` would say hall and common room while
     * the hole opened out of the bedroom, walk.ts would cut the void there, and
     * route.ts would stand the hall-side waypoint at u 10.5, v 16.5, inside bedroom A.
     *
     * MEASURED at the defaults: band w0, offset 16.5, width 3, i.e. u 16.5 to 19.5. The
     * band's own centre is u 9 to 12 and the shared face is u 16.5 to 20, so the door is
     * slid to the low end of that face -- its low jamb flush with the line where
     * bedroom A's partition meets the hall. A door in the corner of the hall, and the
     * whole 3 ft of the 3.5 ft the two rooms give it.
     */
    const door = openings.find(
      (o) => o.kind === "door" && o.connects.includes("hall") && o.connects.includes("common1"),
    )!;
    expect(door).toBeDefined();
    const band = walls.find((w) => w.id === door.wallId)!;
    expect([band.id, band.u, band.v, band.du, band.dv]).toEqual(["w0", 0, 15, 21, 0.5]);
    expect([door.offset, door.width]).toEqual([16.5, 3]);

    const hall = suite.rooms.find((r) => r.id === "hall")!;
    const common = suite.rooms.find((r) => r.id === "common1")!;
    // The band runs in u, so the shared face is the overlap of the two rooms' u runs.
    const faceLo = Math.max(band.u, hall.u, common.u);
    const faceHi = Math.min(band.u + band.du, hall.u + hall.du, common.u + common.du);
    expect([faceLo, faceHi]).toEqual([16.5, 20]);
    expect(band.u + door.offset).toBe(faceLo);
    expect(band.u + door.offset + door.width).toBeLessThanOrEqual(faceHi + 1e-9);

    // Non-vacuity, and the whole point: the band centre is NOT where it went, and the
    // band centre is inside bedroom A's stretch rather than the hall's.
    const bandCentre = band.u + (band.du - door.width) / 2;
    expect(bandCentre).toBe(9);
    expect(bandCentre).toBeLessThan(faceLo);
    const bedA = suite.rooms.find((r) => r.id === "bedA")!;
    expect(bandCentre + door.width).toBeLessThanOrEqual(bedA.u + bedA.du);
  });

  it("keeps the four older doors exactly where the band centre already put them", () => {
    // CLAMPED RATHER THAN RE-CENTRED, measured. door() keeps the band centre wherever it
    // already lies inside the shared face, and slides only when it does not. All four
    // doors that existed before the hall-to-common-room one are band-centred, and three
    // other modules have measured them there by their coordinates -- furniture.ts's
    // commonSlots() and clearOfBWalls(), drag.ts's DOOR_CLEARANCE note. Centring on the
    // shared face instead would move K's door from v 6..9 to v 4.5..7.5 and make all
    // three of those records false about a door that was already right.
    // By the rooms it joins and not by its id, so a renumbering in walls.ts cannot quietly
    // exempt a different door from the rule this states about four of them.
    const isTheNewOne = (o: { connects: string[] }) =>
      o.connects.includes("hall") && o.connects.includes("common1");
    for (const o of openings.filter((x) => x.kind === "door" && !isTheNewOne(x))) {
      if (o.connects.includes("outside")) continue; // the entry is hung by face, not by band
      const w = walls.find((x) => x.id === o.wallId)!;
      const alongV = !(w.du > w.dv);
      const along = alongV ? w.dv : w.du;
      expect([o.id, o.offset]).toEqual([o.id, (along - o.width) / 2]);
    }
    // K's door in the numbers those other modules cite, so a move shows up here first.
    const k = openings.find((o) => o.kind === "door" && o.connects.includes("k"))!;
    const kBand = walls.find((w) => w.id === k.wallId)!;
    expect([kBand.v + k.offset, kBand.v + k.offset + k.width]).toEqual([6, 9]);
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

  it("keeps every interior door inside the run its two rooms share, over 200 sets", () => {
    /*
     * THE PROPERTY, rather than the default suite's instance of it. "Within its band" is
     * the assertion above and it is not enough: a merged band runs past rooms it does not
     * divide, so a door can be inside the band and outside both of the rooms it claims to
     * join. That is exactly what the hall-to-common-room door did before door() clamped
     * it, and it is what this would have caught.
     *
     * MEASURED at this seed, and the counts are the non-vacuity that matters: 981 interior
     * doors over the 200 sets, 200 of them slid off their band's centre and every one of
     * those the hall-to-common-room door -- so the clamp bites in every set, not in a
     * corner case. 70 of the 200 are also clipped narrower than 3 ft, the narrowest 1.115
     * ft, which is the shared face being all the door there is room for. Without the door
     * the same sweep gives 781 interior doors, none slid and none clipped.
     *
     * A clipped door can be narrower than the walker: walk.ts's canPass() refuses 15 of
     * route.test.ts's 300 suites their hall-to-common-room door for that reason, and that
     * is the honest answer rather than a 3 ft door hanging off the end of a 0.5 ft face.
     */
    let seed = 4242;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const jitter = (b: number, s: number) => b + (rnd() * 2 - 1) * s;

    let doors = 0;
    let slid = 0;
    let clipped = 0;
    let narrowest = Infinity;
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
      for (const op of o) {
        // The suite entry is excluded because "outside" is not a room this model has, so
        // there is no second run to intersect; walls.ts hangs it by face for that reason.
        if (op.kind !== "door" || op.connects.includes("outside")) continue;
        doors++;
        const band = w.find((x) => x.id === op.wallId)!;
        const alongV = !(band.du > band.dv);
        const lo = alongV ? band.v : band.u;
        const along = alongV ? band.dv : band.du;
        const rooms = op.connects.map((id) => s.rooms.find((r) => r.id === id)!);
        const faceLo = Math.max(lo, ...rooms.map((r) => (alongV ? r.v : r.u)));
        const faceHi = Math.min(
          lo + along,
          ...rooms.map((r) => (alongV ? r.v + r.dv : r.u + r.du)),
        );
        const label = `iteration ${i} ${op.id} (${op.connects.join("/")})`;
        expect(lo + op.offset, `${label} starts before the shared face`).toBeGreaterThanOrEqual(
          faceLo - 1e-9,
        );
        expect(
          lo + op.offset + op.width,
          `${label} runs past the shared face`,
        ).toBeLessThanOrEqual(faceHi + 1e-9);
        if (Math.abs(op.offset - (along - op.width) / 2) > 1e-9) slid++;
        if (op.width < 3 - 1e-9) {
          clipped++;
          narrowest = Math.min(narrowest, op.width);
        }
      }
    }
    expect(doors).toBe(981);
    expect(slid).toBe(200);
    expect(clipped).toBe(70);
    expect(narrowest).toBeCloseTo(1.1152, 4);
  });
});
