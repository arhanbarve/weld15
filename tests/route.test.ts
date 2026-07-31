/**
 * The suite's circulation, and whether a walker can actually follow it.
 *
 * docs/phases/P7-P8.md asks for two things of route(): that it returns null when no
 * doorway chain exists -- "the case unreachableRooms() exists to detect" -- and a real
 * chain otherwise, with the waypoints asserted walkable by feeding them through step().
 * Both are below, on the default suite and over randomised ones.
 *
 * WHAT THE SWEEP FOUND, because it is the reason route.ts changed. Feeding 6,226
 * randomised routes through step() left 12 doorway segments unwalkable, all of them
 * common room to K, with the walker stopping 0.24 ft into a 2.5 ft crossing. The cause
 * was in walk.ts's solidsOf() rather than here -- a partition split into two bands by a
 * footprint grid line, with the door cut out of only one of them -- and it is pinned in
 * tests/walk.test.ts. This file is where it was visible.
 *
 * WHAT CANNOT BE TESTED FROM HERE, stated rather than quietly skipped. route() prefers
 * the shorter walk when two doorways join the same pair of rooms, and routeRooms() runs
 * Dijkstra weighted by distance rather than by hop count. Neither branch can be reached:
 * buildOpenings() hard-codes the suite's four interior doors, no two of them join the same
 * pair, and the resulting graph is a tree, so every chain is unique and the two orderings
 * cannot disagree. Reaching those branches needs a second door in walls.ts.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_PARAMS,
  buildSuite,
  unreachableRooms,
  type Rect,
  type Suite,
  type SuiteParams,
} from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import {
  RADIUS,
  canPass,
  clearance,
  roomAt,
  step,
  walkContext,
  type Solid,
  type Vec2,
} from "@/scene/walk";
import {
  HUB,
  STANDOFF_MARGIN,
  places,
  reachable,
  route,
  routeRooms,
  standIn,
  thresholds,
  thresholdsIn,
} from "@/scene/route";

const P = DEFAULT_PARAMS;
const suite = buildSuite();
const ctx = walkContext(suite);
const ids = suite.rooms.map((r) => r.id);

/** Same deterministic pseudo-random generator style as tests/collide.test.ts. */
const makeRnd = (seed0: number) => {
  let seed = seed0;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
};

const dist = (a: Vec2, b: Vec2) => Math.hypot(b.u - a.u, b.v - a.v);

/** Does the open segment a -> b enter the interior of rect r? Liang-Barsky. */
function segHitsRect(a: Vec2, b: Vec2, r: Solid): boolean {
  let t0 = 0;
  let t1 = 1;
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-15) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-du, a.u - r.u)) return false;
  if (!clip(du, r.u + r.du - a.u)) return false;
  if (!clip(-dv, a.v - r.v)) return false;
  if (!clip(dv, r.v + r.dv - a.v)) return false;
  return t1 - t0 > 1e-9;
}

const crossesAWall = (a: Vec2, b: Vec2, c = ctx) => c.solids.some((s) => segHitsRect(a, b, s));

/**
 * The doorway graph, read straight off buildWalls()'s openings.
 *
 * Deliberately not route.ts's thresholds(): "route() returns null exactly when no doorway
 * chain exists" is only a statement if the chain is computed some other way. This is a
 * plain BFS over the passable openings whose two rooms both exist, which is the definition
 * the plan gives, in ten lines and with none of route.ts's arithmetic.
 */
function doorwayGraph(s: Suite, radius = RADIUS) {
  const present = new Set(s.rooms.map((r) => r.id));
  const edges = buildWalls(s)
    .openings.filter((o) => canPass(o, radius))
    .filter((o) => o.connects.every((id) => present.has(id)))
    .map((o) => o.connects);
  const neighbours = (id: string) =>
    edges.flatMap((e) => (e[0] === id ? [e[1]!] : e[1] === id ? [e[0]!] : []));
  /** The unique shortest chain of rooms from a to b, or null. */
  const chain = (a: string, b: string): string[] | null => {
    if (!present.has(a) || !present.has(b)) return null;
    if (a === b) return [a];
    const prev = new Map<string, string>([[a, a]]);
    const queue = [a];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const next of neighbours(at)) {
        if (prev.has(next)) continue;
        prev.set(next, at);
        queue.push(next);
      }
    }
    if (!prev.has(b)) return null;
    const out = [b];
    while (out[0] !== a) out.unshift(prev.get(out[0]!)!);
    return out;
  };
  return { edges, chain };
}

const graph = doorwayGraph(suite);

/** A jittered parameter set, the sweep tests/rooms.test.ts uses. legDepth closes. */
function jittered(rnd: () => number): SuiteParams {
  const jitter = (base: number, spread: number) => base + (rnd() * 2 - 1) * spread;
  const p: SuiteParams = {
    ...P,
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
  return p;
}

describe("standIn and the constants", () => {
  it("stands a viewer in the middle of the room", () => {
    // The centre and not an inset: it is the point of a rectangle furthest from every
    // wall, so it is the one most likely to still hold the walker in a room a slider has
    // shrunk, and every segment from it to a doorway waypoint stays inside the room.
    for (const r of suite.rooms) {
      expect(standIn(r)).toEqual({ u: r.u + r.du / 2, v: r.v + r.dv / 2 });
    }
  });

  it("names the hall as the hub, which is what rooms.ts seeds its own fill from", () => {
    expect(HUB).toBe("hall");
    expect(suite.rooms.some((r) => r.id === HUB)).toBe(true);
  });

  it("stands off a doorway by the radius plus a visible margin", () => {
    // The radius is what it takes to be clear of the band at all. The extra quarter foot
    // is the smallest distance anything in this project positions to -- half of
    // collide.ts's grid -- so it is a visible offset in the plan and an invisible detour
    // in the walk.
    expect(STANDOFF_MARGIN).toBe(0.25);
    expect(RADIUS + STANDOFF_MARGIN).toBeGreaterThan(RADIUS);
  });
});

describe("thresholds: the doorways a walker can get through", () => {
  const ts = thresholds(suite);

  it("finds the four interior doors and nothing else", () => {
    // Windows are excluded by canPass; the suite entry is excluded because "outside" is
    // not a room this model has, which is the same reason walk.ts leaves that band whole.
    expect(ts.map((t) => t.id)).toEqual(["d0", "d1", "d2", "d3"]);
    expect(buildWalls(suite).openings.length).toBe(10);
  });

  it("names the wall each door is actually hung in", () => {
    const byId = new Map(buildWalls(suite).openings.map((o) => [o.id, o]));
    for (const t of ts) expect([t.id, t.wallId]).toEqual([t.id, byId.get(t.id)!.wallId]);
  });

  it("puts each standing position in the room it belongs to, and in that order", () => {
    /*
     * THE SIGN TEST, and route.ts's docblock on thresholdOf names the symptom: the two
     * waypoints swapped, so a route into a room begins by walking away from it. Nothing
     * about a swapped pair is visible in the coordinates, and both halves of a swapped
     * route are still walkable -- it just goes the wrong way round. So which side is which
     * is checked against roomAt(), which knows nothing about the band's thin axis.
     */
    for (const t of ts) {
      expect([t.id, roomAt(t.at[0], ctx), roomAt(t.at[1], ctx)]).toEqual([
        t.id,
        t.rooms[0],
        t.rooms[1],
      ]);
    }
  });

  it("stands one standoff clear of the band, on the opening's own centreline", () => {
    const byId = new Map(ctx.walls.map((w) => [w.id, w]));
    const standoff = RADIUS + STANDOFF_MARGIN;
    for (const t of ts) {
      const w = byId.get(t.wallId)!;
      const alongV = !(w.du > w.dv);
      const thin = (p: Vec2) => (alongV ? p.u : p.v);
      const along = (p: Vec2) => (alongV ? p.v : p.u);
      // both sides on one line across the wall, through the middle of the opening
      expect([t.id, along(t.at[0])]).toEqual([t.id, along(t.centre)]);
      expect([t.id, along(t.at[1])]).toEqual([t.id, along(t.centre)]);
      // one on each face, each exactly a standoff out
      const outward = [thin(t.at[0]), thin(t.at[1])].map((x) =>
        x < thin(t.centre) ? (alongV ? w.u : w.v) - x : x - (alongV ? w.u + w.du : w.v + w.dv),
      );
      for (const gap of outward) expect([t.id, gap]).toEqual([t.id, standoff]);
      expect(Math.sign(thin(t.at[0]) - thin(t.centre))).toBe(
        -Math.sign(thin(t.at[1]) - thin(t.centre)),
      );
    }
  });

  it("leaves room for the walker at every standing position", () => {
    // Measured on the default suite: 1.0528 ft at all eight, and the arithmetic is worth
    // writing out because the standoff alone does not produce it. The nearest solid to a
    // waypoint is the END of a jamb, not its face: 1.0 ft away across the wall and 1.5 ft
    // along it, so hypot(1, 1.5) - 0.75 = 1.0528.
    for (const t of ts) {
      expect([t.id, clearance(t.at[0], ctx) > 0]).toEqual([t.id, true]);
      expect([t.id, clearance(t.at[1], ctx) > 0]).toEqual([t.id, true]);
    }
  });

  it("closes every doorway for a walker too wide for a 3 ft door", () => {
    // The radius is a parameter of the walker, and thresholds() filters on canPass.
    expect(thresholds(suite, 1.6)).toEqual([]);
    expect(thresholds(suite, 1.49).length).toBe(4);
  });

  it("refuses to skip an opening that names a wall the suite has no wall for", () => {
    // Loud rather than silent, in the manner of drag.ts's doorsBlockedBy(). Dropping one
    // doorway from the graph would leave every assertion about the others passing.
    const bad = { ...ctx, openings: [{ ...ctx.openings[0]!, wallId: "w-from-a-past-build" }] };
    expect(() => thresholdsIn(bad)).toThrow(/w-from-a-past-build/);
  });
});

describe("reachable: what a walk can get to, against what a door could", () => {
  it("reaches the hall and the three rooms off it, and not the other three", () => {
    /*
     * MEASURED, and the mismatch with unreachableRooms() is not one room but three. Two of
     * them are a gap in walls.ts, not a choice here: buildOpenings() hangs no door between
     * the hall and the common room, so the doorway graph is two components. See route.ts's
     * header for the whole accounting.
     *
     * WHEN THAT DOOR LANDS, this is the assertion to change: reachable() should then
     * return all seven ids except "unknown", and the component test below should collapse
     * to two groups. Nothing in route.ts needs to change with it.
     */
    expect(reachable(suite)).toEqual(["hall", "bedA", "bath", "bedB"]);
    expect(unreachableRooms(suite)).toEqual([]);
  });

  it("agrees with a plain BFS over buildWalls()'s own openings", () => {
    // Independent of route.ts's thresholds(). If these two ever disagree, one of them is
    // reading the openings wrongly.
    expect(reachable(suite)).toEqual(
      ids.filter((id) => graph.chain(HUB, id) !== null),
    );
  });

  it("returns them in the suite's own room order", () => {
    const order = new Map(ids.map((id, i) => [id, i]));
    const got = reachable(suite).map((id) => order.get(id)!);
    expect(got).toEqual([...got].sort((a, b) => a - b));
  });

  it("reaches only the hall when no door admits the walker", () => {
    expect(reachable(suite, 1.6)).toEqual(["hall"]);
  });
});

describe("places: the named destinations a reduced-motion viewer gets", () => {
  const ps = places(suite);

  it("offers the reachable rooms with the hall first", () => {
    expect(ps.map((p) => p.id)).toEqual(["hall", "bedA", "bath", "bedB"]);
  });

  it("puts the hall first even when it is not first in the room list", () => {
    /*
     * The sort, isolated, because on the real suite it is doing nothing. buildSuite() emits
     * the rooms as common1, k, hall, bedA, unknown, bath, bedB, and the two rooms ahead of
     * the hall are exactly the two the missing hall-to-common-room door strands -- so the
     * hall is already first among the reachable ones and `.sort(() => 0)` would pass the
     * test above. It stops being dead code the moment that door lands. So the suite is
     * handed over with its rooms shuffled, which changes nothing about the geometry:
     * buildWalls() sorts its own grid lines and hangs doors by `separates`, not by index.
     */
    const shuffled: Suite = {
      ...suite,
      rooms: [...suite.rooms].reverse(),
    };
    expect(shuffled.rooms.map((r) => r.id).indexOf(HUB)).toBe(4);
    expect(places(shuffled).map((p) => p.id)).toEqual(["hall", "bedB", "bath", "bedA"]);
    expect(reachable(shuffled)).toEqual(["bedB", "bath", "bedA", "hall"]);
  });

  it("carries each room's own label and centre", () => {
    const byId = new Map(suite.rooms.map((r) => [r.id, r]));
    for (const p of ps) {
      expect([p.id, p.label]).toEqual([p.id, byId.get(p.id)!.label]);
      expect([p.id, p.p]).toEqual([p.id, standIn(byId.get(p.id) as Rect)]);
    }
    expect(ps.find((p) => p.id === HUB)!.label).toBe("Hall");
  });

  it("offers nowhere unreachable, so no control sends a viewer somewhere it cannot go", () => {
    for (const p of ps) expect([p.id, route(HUB, p.id, suite)]).not.toEqual([p.id, null]);
  });
});

describe("route: null when there is no doorway chain", () => {
  it("is null for an id that is not a room in this suite", () => {
    expect(route("kitchen", "hall", suite)).toBeNull();
    expect(route("hall", "kitchen", suite)).toBeNull();
    expect(routeRooms("hall", "", suite)).toBeNull();
  });

  it("is null for the unknown strip, in both directions, from every room", () => {
    // The deliberate one, and the only null here that is permanent. rooms.ts exempts the
    // strip from its own reachability gate because "giving it a door would mean choosing
    // whose door it is", so it has no door and route() has nothing to return.
    for (const id of ids) {
      if (id === "unknown") continue;
      expect([id, route(id, "unknown", suite)]).toEqual([id, null]);
      expect([id, route("unknown", id, suite)]).toEqual([id, null]);
    }
    // and it can still be routed to itself, which is a walk of zero length
    expect(route("unknown", "unknown", suite)).toEqual([standIn(suite.rooms[4]!)]);
  });

  it("is null exactly when the BFS says the rooms are in different components", () => {
    // The contract, checked pair by pair against a graph computed some other way. 49
    // ordered pairs, 21 with a route and 28 without.
    let withRoute = 0;
    for (const a of ids) {
      for (const b of ids) {
        const want = graph.chain(a, b) !== null;
        expect([a, b, route(a, b, suite) !== null]).toEqual([a, b, want]);
        if (want) withRoute++;
      }
    }
    expect(withRoute).toBe(21);
    expect(ids.length * ids.length - withRoute).toBe(28);
  });

  it("is null for every pair once the doors are too narrow for the walker", () => {
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        expect([a, b, route(a, b, suite, 1.6)]).toEqual([a, b, null]);
      }
    }
    // from === to is answered before the graph is built, and a viewer asking to be sent
    // where they already are should stay there rather than get an error.
    expect(route("bedA", "bedA", suite, 1.6)).toEqual([standIn(suite.rooms[3]!)]);
  });
});

describe("route: the chain, and its shape", () => {
  it("takes the room chain a BFS finds, which here is the only one", () => {
    // The graph is a tree, so the shortest walk and the fewest hops cannot disagree; see
    // the header. That makes the BFS chain the whole answer and not merely one answer.
    for (const a of ids) {
      for (const b of ids) {
        expect([a, b, routeRooms(a, b, suite)]).toEqual([a, b, graph.chain(a, b)]);
      }
    }
  });

  it("is one point for a room to itself, four for a two-room walk, seven for three", () => {
    // centre(from), then [near side of door, far side of door, centre of next room] per
    // hop. Four points and seven points, and nothing in between.
    expect(route("hall", "hall", suite)).toEqual([standIn(suite.rooms[2]!)]);
    expect(route("hall", "bedB", suite)!.length).toBe(4);
    expect(route("bedA", "bedB", suite)!.length).toBe(7);
    expect(route("common1", "k", suite)!.length).toBe(4);
    for (const a of ids) {
      for (const b of ids) {
        const pts = route(a, b, suite);
        if (!pts) continue;
        expect([a, b, pts.length]).toEqual([a, b, 1 + 3 * (graph.chain(a, b)!.length - 1)]);
      }
    }
  });

  it("starts at the centre of the first room and ends at the centre of the last", () => {
    const byId = new Map(suite.rooms.map((r) => [r.id, r]));
    for (const a of ids) {
      for (const b of ids) {
        const pts = route(a, b, suite);
        if (!pts) continue;
        expect([a, b, pts[0]]).toEqual([a, b, standIn(byId.get(a)!)]);
        expect([a, b, pts[pts.length - 1]]).toEqual([a, b, standIn(byId.get(b)!)]);
      }
    }
  });

  it("is the reverse of the route back", () => {
    for (const a of ids) {
      for (const b of ids) {
        const there = route(a, b, suite);
        const back = route(b, a, suite);
        if (!there || !back) {
          expect([a, b, there, back]).toEqual([a, b, null, null]);
          continue;
        }
        expect([a, b, back]).toEqual([a, b, [...there].reverse()]);
      }
    }
  });

  it("passes through both sides of every doorway on the chain", () => {
    // One waypoint in the middle of the opening is not enough: a segment that ends inside
    // the band has already been in the band, which is where the jambs are.
    const ts = thresholds(suite);
    const pts = route("bedA", "bedB", suite)!;
    for (const id of ["d0", "d2"]) {
      const t = ts.find((x) => x.id === id)!;
      expect([id, pts.some((p) => dist(p, t.at[0]) < 1e-12)]).toEqual([id, true]);
      expect([id, pts.some((p) => dist(p, t.at[1]) < 1e-12)]).toEqual([id, true]);
    }
  });
});

describe("route: the waypoints are walkable, fed through step()", () => {
  /** Every consecutive pair of waypoints of every route the suite admits. */
  const segments = (s: Suite) => {
    const out: { a: string; b: string; i: number; from: Vec2; to: Vec2 }[] = [];
    for (const a of s.rooms) {
      for (const b of s.rooms) {
        const pts = route(a.id, b.id, s);
        if (!pts) continue;
        for (let i = 0; i + 1 < pts.length; i++) {
          out.push({ a: a.id, b: b.id, i, from: pts[i]!, to: pts[i + 1]! });
        }
      }
    }
    return out;
  };

  const segs = segments(suite);

  it("has segments to walk at all", () => {
    // Non-vacuity, measured: 21 routes over the default suite give 60 segments -- seven
    // of the 21 are a room to itself and contribute none, eight are one hop and give three
    // each, six are two hops and give six each.
    expect(segs.length).toBe(60);
  });

  it("arrives at every waypoint rather than stopping against a wall", () => {
    // docs/phases/P7-P8.md's own wording for this: "assert the waypoints are actually
    // walkable by feeding them through step()". A segment that a wall interrupts comes
    // back short of its target, which is what a route through the plaster looks like.
    for (const s of segs) {
      const got = step(s.from, s.to, ctx);
      const label = `${s.a}->${s.b} segment ${s.i}`;
      expect([label, dist(got, s.to) < 1e-6]).toEqual([label, true]);
    }
  });

  it("leaves room for the walker at every waypoint", () => {
    for (const s of segs) {
      expect([`${s.a}->${s.b}`, clearance(s.from, ctx) > 0]).toEqual([`${s.a}->${s.b}`, true]);
    }
  });

  it("keeps every segment clear of every band, not merely walkable end to end", () => {
    // Stronger than the step() check and computed differently: no segment of the polyline
    // may cut a solid at all. This is what keeping each segment inside one convex room,
    // and crossing each band perpendicular through its hole, actually buys.
    for (const s of segs) {
      const label = `${s.a}->${s.b} segment ${s.i}`;
      expect([label, crossesAWall(s.from, s.to)]).toEqual([label, false]);
    }
  });

  it("is buying something: the straight line between the same two rooms does not", () => {
    // Non-vacuity for the test above. A straight line from bedroom A's centre to bedroom
    // B's crosses two partitions, which is exactly the defect stages.ts recorded and
    // could not fix. If this ever stops crossing, the assertion above has gone slack.
    const a = standIn(suite.rooms.find((r) => r.id === "bedA")!);
    const b = standIn(suite.rooms.find((r) => r.id === "bedB")!);
    expect(crossesAWall(a, b)).toBe(true);
    // and the polyline pays for it in distance, not much
    const pts = route("bedA", "bedB", suite)!;
    const walked = pts.slice(1).reduce((acc, p, i) => acc + dist(pts[i]!, p), 0);
    expect(walked).toBeGreaterThan(dist(a, b));
    expect(walked).toBeLessThan(3 * dist(a, b));
  });

  it("walks the whole polyline end to end without leaving it", () => {
    // The segments composed, which is what FirstPerson.tsx will actually do: hand step()
    // the next waypoint every frame and expect to arrive at the last one.
    for (const [a, b] of [
      ["bedA", "bedB"],
      ["bedB", "common1"],
      ["hall", "bath"],
      ["k", "common1"],
    ] as [string, string][]) {
      const pts = route(a, b, suite);
      if (!pts) {
        expect([a, b, routeRooms(a, b, suite)]).toEqual([a, b, null]);
        continue;
      }
      let at = pts[0]!;
      for (const target of pts.slice(1)) {
        // 1/60 s frames at SPEED, with a generous frame budget: the walk is under 60 ft.
        for (let f = 0; f < 600 && dist(at, target) > 1e-6; f++) {
          const d = Math.min(dist(at, target), 4 / 60);
          at = step(
            at,
            {
              u: at.u + ((target.u - at.u) / dist(at, target)) * d,
              v: at.v + ((target.v - at.v) / dist(at, target)) * d,
            },
            ctx,
          );
        }
        expect([a, b, dist(at, target) < 1e-6]).toEqual([a, b, true]);
      }
      expect([a, b, roomAt(at, ctx)]).toEqual([a, b, b]);
    }
  });
});

describe("the sliders move the walls, so all of it again on randomised suites", () => {
  it("routes every pair walkably over 300 suites", () => {
    const rnd = makeRnd(20260731);
    let routes = 0;
    let nulls = 0;
    let segs = 0;
    let worstClearance = Infinity;
    let worstResidual = 0;
    let moved = 0;
    for (let i = 0; i < 300; i++) {
      const p = jittered(rnd);
      const s = buildSuite(p);
      const c = walkContext(s);
      const g = doorwayGraph(s);
      if (Math.abs(p.hallWidth - P.hallWidth) > 0.25) moved++;
      for (const a of s.rooms) {
        for (const b of s.rooms) {
          const pts = route(a.id, b.id, s);
          // null exactly when the BFS says so, in every suite and not only the default
          if ((pts === null) !== (g.chain(a.id, b.id) === null)) {
            expect([i, a.id, b.id, pts, g.chain(a.id, b.id)]).toEqual(["agree", 0, 0, 0, 0]);
          }
          if (!pts) {
            nulls++;
            continue;
          }
          routes++;
          for (const q of pts) worstClearance = Math.min(worstClearance, clearance(q, c));
          for (let j = 0; j + 1 < pts.length; j++) {
            segs++;
            const residual = dist(step(pts[j]!, pts[j + 1]!, c), pts[j + 1]!);
            if (residual > worstResidual) worstResidual = residual;
            if (residual > 1e-6) {
              expect([i, a.id, b.id, j, pts[j], pts[j + 1], residual]).toEqual([
                "walkable",
                0,
                0,
                0,
                0,
                0,
                0,
              ]);
            }
            if (crossesAWall(pts[j]!, pts[j + 1]!, c)) {
              expect([i, a.id, b.id, j]).toEqual(["clear of every band", 0, 0, 0]);
            }
          }
        }
      }
    }
    // Non-vacuity, measured: 6,224 routes and 8,476 nulls over 300 suites, 17,772
    // segments, worst waypoint clearance 0.576 ft and worst step residual 1.0e-13 ft.
    // The residual bound is what the 12 unwalkable doorways showed up as before the
    // sliver fix in walk.ts: they came back 1.75 to 2.25 ft short of the waypoint.
    expect(routes).toBeGreaterThan(6000);
    expect(nulls).toBeGreaterThan(8000);
    expect(segs).toBeGreaterThan(17000);
    expect(moved).toBeGreaterThan(200);
    expect(worstClearance).toBeGreaterThan(0);
    expect(worstResidual).toBeLessThan(1e-6);
  });

  it("keeps the hall as the hub and the strip sealed in every suite", () => {
    // The two topological facts every assertion above leans on. A slider that broke either
    // would make the sweep test a statement about a different suite than it claims.
    const rnd = makeRnd(31337);
    for (let i = 0; i < 300; i++) {
      const s = buildSuite(jittered(rnd));
      expect([i, reachable(s)[0]]).toEqual([i, HUB]);
      expect([i, places(s)[0]!.id]).toEqual([i, HUB]);
      expect([i, reachable(s).includes("unknown")]).toEqual([i, false]);
      expect([i, route("hall", "unknown", s)]).toEqual([i, null]);
      // and the three rooms off the hall are always reachable, which is the model's claim
      for (const id of ["bedA", "bath", "bedB"]) {
        expect([i, id, route(HUB, id, s) !== null]).toEqual([i, id, true]);
      }
    }
  });
});
