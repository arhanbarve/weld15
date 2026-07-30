import { describe, it, expect } from "vitest";
import { GRID, footprintOf, placeIsLegal } from "@/geo/collide";
import { SIZES, layout, pieceBox, type FurnitureKind, type Piece } from "@/geo/furniture";
import { buildSuite, DEFAULT_PARAMS, type Suite, type SuiteParams } from "@/geo/rooms";
import { MAX_SECTION_LENGTH } from "@/scene/weldGeometry";
import { useStore } from "@/state/store";
import { DEFAULT_SNAPSHOT, SNAPSHOT_PARAM, decode, encode, type Snapshot } from "@/state/url";

/** Same deterministic pseudo-random generator style as tests/collide.test.ts. */
const makeRnd = (seed0: number) => {
  let seed = seed0;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
};

type Rnd = () => number;

/** Inclusive integer. Everything randomised here is randomised in whole units. */
const intIn = (rnd: Rnd, lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
const pickOne = <T,>(rnd: Rnd, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

/**
 * The lattice the format is defined on: whole inches, as a DIVISION.
 *
 * n / 12, never n * (1/12). furniture.ts's inches() makes the same point and it
 * is the whole reason these tests can ask for exact deep equality rather than
 * closeTo: 40 * (1/12) and 40/12 are different doubles, and every flush
 * placement in the suite is built from the second.
 */
const inch = (n: number) => n / 12;

const KINDS: readonly FurnitureKind[] = ["bed", "desk", "chair", "dresser", "sofa", "table", "shelf"];
const YAWS = [0, 90, 180, 270] as const;

/** Whole days since the epoch to "YYYY-MM-DD". Kept to years 1000-9999. */
const dateOf = (days: number) => new Date(days * 86_400_000).toISOString().slice(0, 10);

// --- generators -----------------------------------------------------------

/**
 * A randomised suite that is actually a suite.
 *
 * Every length is drawn in whole inches, and the constraints below are the ones
 * buildSuite() implies rather than a taste: the hall has to clear the bedrooms
 * (legDepth), the common room has to reach the hall's inner wall or
 * unreachableRooms() reports it, K has to stay south of the hall, and the
 * along-hall chain has to fit the section. Generating outside those and filtering
 * would test the filter; the yield assertion in the round-trip test is what
 * proves this is not doing that.
 */
function randomParams(rnd: Rnd): SuiteParams {
  const partition = intIn(rnd, 6, 9);
  const hallWidth = intIn(rnd, 48, 60);
  const bedDepth = intIn(rnd, 180, 204);
  const legDepth = bedDepth + partition + hallWidth + intIn(rnd, 0, 12);
  const commonAlong = intIn(rnd, 168, 192);
  const bedAAlong = intIn(rnd, 108, 132);
  const bedBAlong = intIn(rnd, 108, 132);
  const bathAlong = intIn(rnd, 78, 102);
  const chain = commonAlong + bedAAlong + bathAlong + bedBAlong + 3 * partition;
  return {
    // The full legal range, from "the rooms just fit" to Weld's waist. Past
    // MAX_SECTION_LENGTH the suite is wider than the building.
    sectionLength: inch(intIn(rnd, chain, Math.floor(MAX_SECTION_LENGTH * 12))),
    legDepth: inch(legDepth),
    hallWidth: inch(hallWidth),
    bedDepth: inch(bedDepth),
    commonAlong: inch(commonAlong),
    // Strictly past the hall's inner wall at legDepth - hallWidth, or the common
    // room does not touch the hall and the whole suite is unreachable.
    commonDeep: inch(legDepth - hallWidth + intIn(rnd, 6, 60)),
    bedAAlong: inch(bedAAlong),
    bedBAlong: inch(bedBAlong),
    bathAlong: inch(bathAlong),
    bathDeep: inch(intIn(rnd, 72, 96)),
    kDeep: inch(intIn(rnd, 108, 132)),
    // K sits off the common room's south end, so it cannot run past it into the
    // hall's band.
    kAlong: inch(intIn(rnd, 120, commonAlong)),
    partition: inch(partition),
    masonry: inch(intIn(rnd, 12, 24)),
    ceiling: inch(intIn(rnd, 108, 144)),
    facade: rnd() < 0.5 ? "east" : "west",
    wingStep: rnd() < 0.5,
  };
}

/**
 * A random legal fit-out, positions and all.
 *
 * Not layout()'s: the point is to randomise the piece positions rather than to
 * re-encode the designed ones, so every piece gets a random kind, a random
 * quarter turn and a random anchor on the inch lattice inside its room, and is
 * kept only if placeIsLegal() accepts it. Ordinals count per room and kind,
 * which is furniture.ts's own id scheme.
 */
function randomPieces(rnd: Rnd, suite: Suite): Piece[] {
  const out: Piece[] = [];
  for (const room of suite.rooms) {
    const kept: Piece[] = [];
    for (let i = intIn(rnd, 0, 4); i > 0; i--) {
      const kind = pickOne(rnd, KINDS);
      const yaw = pickOne(rnd, YAWS);
      const size = SIZES[kind];
      const f = footprintOf({ u: 0, v: 0, du: size.du, dv: size.dv, rot: yaw });
      const uLo = Math.ceil(room.u * 12);
      const uHi = Math.floor((room.u + room.du - f.du) * 12);
      const vLo = Math.ceil(room.v * 12);
      const vHi = Math.floor((room.v + room.dv - f.dv) * 12);
      if (uHi < uLo || vHi < vLo) continue;
      const piece: Piece = {
        id: `${room.id}-${kind}-${kept.filter((k) => k.kind === kind).length}`,
        kind,
        room: room.id,
        u: inch(intIn(rnd, uLo, uHi)),
        v: inch(intIn(rnd, vLo, vHi)),
        du: size.du,
        dv: size.dv,
        h: size.h,
        yaw,
      };
      if (!placeIsLegal(pieceBox(piece), room, kept.map(pieceBox)).ok) continue;
      kept.push(piece);
    }
    out.push(...kept);
  }
  return out;
}

function randomSnapshot(rnd: Rnd): Snapshot {
  const params = randomParams(rnd);
  return {
    stage: pickOne(rnd, [0, 1, 2, 3, 4, 5] as const),
    t: intIn(rnd, 0, 1000) / 1000,
    params,
    pieces: randomPieces(rnd, buildSuite(params)),
    cutaway: rnd() < 0.5,
    hour: intIn(rnd, 0, 1440) / 60,
    date: dateOf(intIn(rnd, -25_000, 25_000)),
    orbit:
      rnd() < 0.5
        ? null
        : {
            azimuthDeg: intIn(rnd, -18_000, 18_000) / 100,
            polarDeg: intIn(rnd, 0, 18_000) / 100,
            radius: intIn(rnd, 100, 30_000) / 100,
          },
  };
}

// --- a full, realistic snapshot, used by several tests --------------------

const defaultSuite = buildSuite();

/**
 * The shipped fit-out, on the lattice.
 *
 * layout()'s own output is one ulp off it in one coordinate -- see the ulp test
 * below, which is where that is measured rather than worked around. Everything
 * that asks for exact round-trip equality uses this.
 */
const onLattice = (pieces: Piece[]): Piece[] =>
  pieces.map((p) => ({ ...p, u: Math.round(p.u * 12) / 12, v: Math.round(p.v * 12) / 12 }));

/** A full snapshot: every room furnished, the camera parked, the roof off. */
const realistic: Snapshot = {
  stage: 5,
  t: 1,
  params: DEFAULT_PARAMS,
  pieces: onLattice(layout(defaultSuite)),
  cutaway: true,
  hour: 17.5,
  date: "2026-12-21",
  orbit: { azimuthDeg: -113.25, polarDeg: 42.5, radius: 121.75 },
};

describe("DEFAULT_SNAPSHOT", () => {
  it("is store.ts's initial state", () => {
    // The anti-drift gate for the one copy this module makes. store.ts does not
    // export DEFAULT_DATE or DEFAULT_HOUR and url.ts must not import it as a
    // value (H integrates url.ts into store.ts, so that would be a cycle), so
    // the literals are duplicated on purpose and pinned here.
    const s = useStore.getState();
    expect(DEFAULT_SNAPSHOT.date).toBe(s.date);
    expect(DEFAULT_SNAPSHOT.hour).toBe(s.hour);
    expect(DEFAULT_SNAPSHOT.stage).toBe(s.stage);
    expect(DEFAULT_SNAPSHOT.t).toBe(s.t);
    expect(DEFAULT_SNAPSHOT.cutaway).toBe(s.cutaway);
    expect(DEFAULT_SNAPSHOT.orbit).toBe(s.orbit);
    expect(DEFAULT_SNAPSHOT.params).toEqual(s.params);
  });

  it("carries the shipped fit-out and is a fixed point of encode/decode", () => {
    expect(DEFAULT_SNAPSHOT.pieces.length).toBeGreaterThan(20);
    expect(DEFAULT_SNAPSHOT.pieces).toEqual(onLattice(layout(defaultSuite)));
    expect(decode(encode(DEFAULT_SNAPSHOT))).toEqual(DEFAULT_SNAPSHOT);

    // The app's default state has to be shareable, so it lives on the lattice,
    // and the snap costs an ulp on at most one coordinate. Measured when this was
    // written: exactly one piece, bedA-bed-1, by 3.6e-15 ft. Bounded rather than
    // pinned to that id because the recipes in furniture.ts are another owner's
    // and do move; the bound is the claim, the id is the example.
    const raw = layout(defaultSuite);
    const drift = raw.map((p, i) =>
      Math.max(
        Math.abs(DEFAULT_SNAPSHOT.pieces[i]!.u - p.u),
        Math.abs(DEFAULT_SNAPSHOT.pieces[i]!.v - p.v),
      ),
    );
    expect(Math.max(...drift)).toBeLessThan(1e-14);
    expect(drift.filter((d) => d > 0).length).toBeLessThanOrEqual(1);
  });

  it("names the query parameter so the reader and the writer cannot disagree", () => {
    expect(SNAPSHOT_PARAM).toBe("s");
    const url = new URL(`https://example.com/?${SNAPSHOT_PARAM}=${encode(realistic)}`);
    expect(decode(url.searchParams.get(SNAPSHOT_PARAM) ?? "")).toEqual(realistic);
  });
});

describe("round trip", () => {
  it("is exact over randomised snapshots, every field varied", () => {
    const rnd = makeRnd(20260730);
    const seen = {
      kinds: new Set<FurnitureKind>(),
      facades: new Set<string>(),
      wingStep: new Set<boolean>(),
      orbit: new Set<boolean>(),
      stages: new Set<number>(),
      cutaway: new Set<boolean>(),
    };
    let minSection = Infinity;
    let maxSection = -Infinity;
    let shareable = 0;
    let pieces = 0;

    for (let i = 0; i < 300; i++) {
      const s = randomSnapshot(rnd);
      const q = encode(s);
      if (q === "") continue;
      shareable++;
      expect(decode(q), `seed step ${i}`).toEqual(s);

      for (const p of s.pieces) seen.kinds.add(p.kind);
      seen.facades.add(s.params.facade);
      seen.wingStep.add(s.params.wingStep);
      seen.orbit.add(s.orbit !== null);
      seen.stages.add(s.stage);
      seen.cutaway.add(s.cutaway);
      minSection = Math.min(minSection, s.params.sectionLength);
      maxSection = Math.max(maxSection, s.params.sectionLength);
      pieces += s.pieces.length;
    }

    // Non-vacuity. The generator is meant to produce legal suites by
    // construction, so a low yield means it has stopped exercising the format
    // and started exercising the filter.
    expect(shareable).toBeGreaterThan(290);
    expect(pieces).toBeGreaterThan(2000);
    expect(seen.kinds.size, "every furniture kind").toBe(7);
    expect(seen.facades, "both facades").toEqual(new Set(["east", "west"]));
    expect(seen.wingStep).toEqual(new Set([true, false]));
    expect(seen.orbit, "orbit both null and set").toEqual(new Set([true, false]));
    expect(seen.cutaway).toEqual(new Set([true, false]));
    expect(seen.stages.size, "every stage").toBe(6);
    // Section lengths across the legal range, up to Weld's waist.
    expect(minSection).toBeLessThan(45);
    expect(maxSection).toBeGreaterThan(MAX_SECTION_LENGTH - 1 / 12);
    expect(maxSection).toBeLessThanOrEqual(MAX_SECTION_LENGTH);
  });

  it("rebuilds piece extents from SIZES rather than carrying them", () => {
    // Which is why a URL cannot smuggle a 40 ft bed: no field in the format can
    // say so, and a snapshot whose extents disagree with its kind is refused
    // rather than re-encoded into a different piece.
    const bed = layout(defaultSuite).find((p) => p.kind === "bed")!;
    const fat: Snapshot = {
      ...realistic,
      pieces: [{ ...bed, du: 40, dv: 40 }],
    };
    expect(encode(fat)).toBe("");
    const ok = decode(encode(realistic));
    expect(ok!.pieces.every((p) => p.du === SIZES[p.kind].du && p.h === SIZES[p.kind].h)).toBe(true);
  });

  it("keeps the ids furniture.ts numbered, gaps included", () => {
    // fitOut() numbers slots rather than successes, so a dropped piece leaves a
    // hole -- a shelf 0 with no shelf 1 and a shelf 3 after it. The ordinal
    // therefore has to travel; recomputing it from the array index on the way back
    // would silently renumber the room, and the renderer keys off these.
    const shelf = (n: number, v: number): Piece => ({
      id: `common1-shelf-${n}`,
      kind: "shelf",
      room: "common1",
      u: 0,
      v,
      du: SIZES.shelf.du,
      dv: SIZES.shelf.dv,
      h: SIZES.shelf.h,
      yaw: 0,
    });
    const gapped: Snapshot = { ...realistic, pieces: [shelf(0, 0), shelf(3, 2), shelf(41, 4)] };
    const back = decode(encode(gapped));
    expect(back!.pieces.map((p) => p.id)).toEqual([
      "common1-shelf-0",
      "common1-shelf-3",
      "common1-shelf-41",
    ]);
    expect(back).toEqual(gapped);
  });

  it("refuses an id that is not the scheme it would rebuild", () => {
    const p = layout(defaultSuite)[0]!;
    for (const id of ["bed-0", "bedA-bed-07", "bedA-bed-", "bedA-desk-0", "bedA-bed-x"]) {
      expect(encode({ ...realistic, pieces: [{ ...p, id }] }), id).toBe("");
    }
    expect(encode({ ...realistic, pieces: [{ ...p, id: "bedA-bed-0" }] })).not.toBe("");
  });
});

describe("the lattice", () => {
  it("holds every length in DEFAULT_PARAMS and every size in SIZES", () => {
    // The reason the quantum is one inch. Each of these is a whole number of
    // inches, so the defaults and the furniture are represented exactly.
    for (const [k, v] of Object.entries(DEFAULT_PARAMS)) {
      if (typeof v !== "number") continue;
      expect(Math.round(v * 12) / 12, k).toBe(v);
    }
    for (const [kind, size] of Object.entries(SIZES)) {
      for (const [axis, v] of Object.entries(size)) {
        expect(Math.round(v * 12) / 12, `${kind}.${axis}`).toBe(v);
      }
    }
  });

  it("is why the 0.5 ft grid was not used: it moves the dressers two inches", () => {
    // collide.ts's GRID is right for drag and cannot carry the furniture. The
    // claim is about SIZES rather than about any one arrangement: the bed frame is
    // 82 in long, so anything bedroomSlots() stands off the end of a bed lands two
    // inches from the nearest half foot, whatever the recipe does next.
    const half = (x: number) => Math.round(x / GRID) * GRID;
    expect(SIZES.bed.du).toBe(82 / 12);
    expect(Math.abs(half(SIZES.bed.du) - SIZES.bed.du)).toBeCloseTo(1 / 6, 12);
    expect(half(SIZES.bed.du)).not.toBe(SIZES.bed.du);
    // And the shipped fit-out really does place pieces there. Measured when this
    // was written: 12 of the 29 pieces off the half-foot grid, the worst by a
    // quarter of a foot; against one piece off the inch lattice, by an ulp.
    const pieces = layout(defaultSuite);
    const off = pieces.filter((p) => half(p.u) !== p.u || half(p.v) !== p.v);
    expect(off.length).toBeGreaterThan(5);
    expect(Math.max(...pieces.map((p) => Math.abs(half(p.u) - p.u)))).toBeGreaterThan(0.1);
    expect(pieces.filter((p) => Math.round(p.u * 12) / 12 !== p.u).length).toBeLessThanOrEqual(1);
  });

  it("costs the shipped fit-out one ulp, and that is the whole known loss", () => {
    // The arithmetic itself, which is not furniture.ts's to change: a bed placed
    // against the far wall of a 10 ft room sits at 10 - 40/12, and the nearest
    // double to that is not the nearest double to 266/12. No fixed-point encoding
    // can hold it, so it is recorded rather than fixed.
    const stranded = 10 - 40 / 12;
    expect(Math.round(stranded * 12) / 12).not.toBe(stranded);
    expect(Math.abs(Math.round(stranded * 12) / 12 - stranded)).toBeLessThan(1e-14);

    const before = layout(defaultSuite);
    const after = decode(encode({ ...realistic, pieces: before }))!.pieces;
    const drift = before.map((p, i) => Math.abs(after[i]!.u - p.u) + Math.abs(after[i]!.v - p.v));
    // At most one piece of the fit-out moves, and by less than an ulp of a foot.
    // Measured when this was written: exactly one, by 3.6e-15 ft.
    expect(drift.filter((d) => d > 0).length).toBeLessThanOrEqual(1);
    expect(Math.max(...drift)).toBeLessThan(1e-14);
    expect(drift.filter((d) => d === 0).length).toBeGreaterThan(20);
  });

  it("lands an off-lattice length within half an inch", () => {
    // What a slider that does not snap, or a wall snap onto an off-grid wall,
    // costs. Half an inch is the quantisation bound; nothing in the model is
    // measured to better than a tenth of a foot. The piece position matters as
    // much as the params here: snapToWalls() pulls a piece flush against a wall
    // that a slider has taken off the grid, so 3.3 ft is an ordinary drop
    // position and not a contrived one.
    const shelf: Piece = {
      id: "common1-shelf-0",
      kind: "shelf",
      room: "common1",
      u: 3.3,
      v: 1.1,
      du: SIZES.shelf.du,
      dv: SIZES.shelf.dv,
      h: SIZES.shelf.h,
      yaw: 0,
    };
    const s: Snapshot = {
      ...realistic,
      pieces: [shelf],
      params: { ...DEFAULT_PARAMS, ceiling: 10.7913, bathDeep: 7.9591 },
      hour: 9.311,
      t: 0.31415926,
    };
    // Rounded, not refused: a position that is not on the lattice is still a
    // position, and a link that dropped it would be worse than one that moves it
    // half an inch.
    expect(encode(s), "an off-lattice snapshot is still shareable").not.toBe("");
    const back = decode(encode(s))!;
    expect(Math.abs(back.pieces[0]!.u - shelf.u)).toBeLessThanOrEqual(1 / 24);
    expect(Math.abs(back.pieces[0]!.v - shelf.v)).toBeLessThanOrEqual(1 / 24);
    expect(back.pieces[0]!.u).toBe(40 / 12);
    expect(Math.abs(back.params.ceiling - s.params.ceiling)).toBeLessThanOrEqual(1 / 24);
    expect(Math.abs(back.params.bathDeep - s.params.bathDeep)).toBeLessThanOrEqual(1 / 24);
    expect(Math.abs(back.hour - s.hour)).toBeLessThanOrEqual(1 / 120);
    expect(Math.abs(back.t - s.t)).toBeLessThanOrEqual(1 / 2000);
    // And it is still a legal, renderable snapshot rather than a rounded lie.
    expect(decode(encode(back))).toEqual(back);
  });

  it("divides on the way back, never multiplies by the reciprocal", () => {
    // The trap furniture.ts's inches() records: 40 * (1/12) and 40/12 are
    // different doubles, and the mattress the suite is laid out around is 40 in
    // wide. A decoder that multiplied would shift furniture by an ulp on every
    // share -- invisible on screen, fatal to deep equality.
    expect(40 * (1 / 12)).not.toBe(40 / 12);
    expect(80 * (1 / 12)).not.toBe(80 / 12);
    const shelf: Piece = {
      id: "common1-shelf-0",
      kind: "shelf",
      room: "common1",
      u: 40 / 12,
      v: 80 / 12,
      du: SIZES.shelf.du,
      dv: SIZES.shelf.dv,
      h: SIZES.shelf.h,
      yaw: 0,
    };
    const back = decode(encode({ ...realistic, pieces: [shelf] }))!;
    expect(back.pieces[0]!.u).toBe(40 / 12);
    expect(back.pieces[0]!.v).toBe(80 / 12);
    expect(back.pieces[0]!.u).not.toBe(40 * (1 / 12));
  });
});

describe("-0", () => {
  // frames.ts has negate() because -0 comes out of the coordinate transforms,
  // serialises into shared state, and breaks value equality while printing as
  // "0" in every log you would think to check.
  const common = defaultSuite.rooms.find((r) => r.id === "common1")!;
  const shelf: Piece = {
    id: "common1-shelf-0",
    kind: "shelf",
    room: "common1",
    u: 0,
    v: 0,
    du: SIZES.shelf.du,
    dv: SIZES.shelf.dv,
    h: SIZES.shelf.h,
    yaw: 0,
  };
  const plus: Snapshot = {
    ...realistic,
    t: 0,
    hour: 0,
    pieces: [shelf],
    orbit: { azimuthDeg: 0, polarDeg: 0, radius: 121.75 },
  };
  const minus: Snapshot = {
    ...plus,
    t: -0,
    hour: -0,
    pieces: [{ ...shelf, u: -0, v: -0 }],
    orbit: { azimuthDeg: -0, polarDeg: -0, radius: 121.75 },
  };

  it("is a real difference, which is why it needs guarding at all", () => {
    expect(common.u).toBe(0);
    expect(minus).not.toEqual(plus);
    expect(Object.is(minus.pieces[0]!.u, -0)).toBe(true);
  });

  it("normalises to +0 rather than carrying the sign into the link", () => {
    expect(encode(minus)).toBe(encode(plus));
    const back = decode(encode(minus))!;
    expect(back).toEqual(plus);
    expect(back).not.toEqual(minus);
    for (const n of [back.t, back.hour, back.pieces[0]!.u, back.pieces[0]!.v, back.orbit!.azimuthDeg, back.orbit!.polarDeg]) {
      expect(Object.is(n, 0)).toBe(true);
    }
  });
});

// --- byte surgery ---------------------------------------------------------
//
// Deliberately a second copy of the framing. The point is to build a payload
// that is well formed EXCEPT for the one field under test, so that null is
// attributable to that field rather than to a broken trailer; a change to the
// framing breaks these three helpers loudly, which is the intent. Nothing else
// in the file knows the format.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesOf(s: string): number[] {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of s) {
    acc = acc * 64 + ALPHABET.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push(Math.floor(acc / 2 ** bits));
      acc %= 2 ** bits;
    }
  }
  return out;
}

/** Body bytes to a string decode() will accept the framing of. */
function sign(body: readonly number[]): string {
  let h = 0x811c9dc5;
  for (const b of body) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  const bytes = [...body, (h >>> 8) & 0xff, h & 0xff];
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = acc * 256 + b;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[Math.floor(acc / 2 ** bits) % 64];
    }
    acc %= 2 ** bits;
  }
  if (bits > 0) out += ALPHABET[(acc * 2 ** (6 - bits)) % 64];
  return out;
}

const varint = (n: number): number[] => {
  const out: number[] = [];
  let v = n < 0 ? -2 * n - 1 : 2 * n;
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
};

/** Body of a valid encoding, ready to be mutated. */
const bodyOf = (s: Snapshot) => bytesOf(encode(s)).slice(0, -2);

/**
 * Where the piece block starts, derived from the encoder rather than from a
 * hardcoded offset: two snapshots differing only in their pieces share every
 * byte before the piece count.
 */
const onePiece: Snapshot = { ...realistic, pieces: [layout(defaultSuite)[0]!] };
const noPieces: Snapshot = { ...realistic, pieces: [] };
const COUNT_AT = bodyOf(noPieces).length - 1;

describe("decode is total", () => {
  it("agrees with the encoder about where the piece block starts", () => {
    // If this drifts the surgery below stops being attributable, so it is
    // asserted rather than assumed.
    const bare = bodyOf(noPieces);
    const one = bodyOf(onePiece);
    expect(one.slice(0, COUNT_AT)).toEqual(bare.slice(0, COUNT_AT));
    expect(bare[COUNT_AT]).toBe(0);
    expect(one[COUNT_AT]).toBe(1);
  });

  it("returns null for the empty string and for garbage", () => {
    for (const q of [
      "",
      " ",
      "!!!!",
      "....",
      "a",
      "ab",
      "abc",
      "abcd",
      "hello world",
      "AAAAAAAAAAAAAAAA",
      "%%%%%%%%",
      "s=AAAA",
      "?s=AAAA",
      "AAAA=",
      "    ",
      "🙂🙂🙂🙂",
      JSON.stringify(realistic),
      encodeURIComponent(JSON.stringify(realistic)),
    ]) {
      expect(decode(q), JSON.stringify(q).slice(0, 40)).toBe(null);
    }
  });

  it("returns null for every truncation of a valid string", () => {
    // The case the feature exists for. A chat client that wraps or clips a link
    // must not produce a suite; it must produce the default one.
    const q = encode(realistic);
    for (let n = 0; n < q.length; n++) {
      expect(decode(q.slice(0, n)), `truncated to ${n}`).toBe(null);
    }
    expect(decode(q)).toEqual(realistic);
  });

  it("returns null for a valid prefix followed by garbage", () => {
    const q = encode(realistic);
    for (const tail of ["A", "AA", "AAAA", "zzzz", q, "!!!!"]) {
      expect(decode(q + tail), tail.slice(0, 8)).toBe(null);
    }
  });

  it("returns null when the string is reordered", () => {
    const q = encode(realistic);
    const rnd = makeRnd(4711);
    let rejected = 0;
    for (let i = 0; i < 200; i++) {
      const a = intIn(rnd, 0, q.length - 1);
      const b = intIn(rnd, 0, q.length - 1);
      if (q[a] === q[b]) continue;
      const chars = [...q];
      chars[a] = q[b]!;
      chars[b] = q[a]!;
      expect(decode(chars.join(""))).toBe(null);
      rejected++;
    }
    expect(rejected).toBeGreaterThan(150);
  });

  it("returns null for a deliberately enormous input, without reading it", () => {
    const huge = "A".repeat(5_000_000);
    const prefixed = encode(realistic) + huge;
    const started = performance.now();
    expect(decode(huge)).toBe(null);
    expect(decode(prefixed)).toBe(null);
    const ms = performance.now() - started;
    // Not decoration: the cap is checked before anything touches the string, so
    // both calls are one length comparison each. Measured at 0.01 ms with the cap
    // and 101 ms without it -- base64 over five million characters, then a hash
    // over the 3.75 MB that comes out. The bound is 20 ms, four orders of
    // magnitude above the work being asserted and five times below the work being
    // refused.
    expect(ms).toBeLessThan(20);
  });

  it("returns null for an out-of-range enum", () => {
    const body = bodyOf(onePiece);
    // stage: byte 1, immediately after the version.
    for (const stage of [6, 7, 99, 127]) {
      const bad = [...body];
      bad[1] = stage;
      expect(decode(sign(bad)), `stage ${stage}`).toBe(null);
    }
    // kind and yaw, at known offsets in the piece block. KINDS has seven
    // entries and YAWS four.
    for (const kind of [7, 8, 64, 127]) {
      const bad = [...body];
      bad[COUNT_AT + 2] = kind;
      expect(decode(sign(bad)), `kind ${kind}`).toBe(null);
    }
    const badVersion = [...body];
    badVersion[0] = 2;
    expect(decode(sign(badVersion))).toBe(null);
    // Unused flag bits. A hand-edit that sets one is not a string this version
    // wrote, and quietly ignoring it would make the format silently extensible.
    const badFlags = [...body];
    badFlags[3] = badFlags[3]! | 0b10000;
    expect(decode(sign(badFlags))).toBe(null);
  });

  it("returns null for a piece in a room that does not exist", () => {
    expect(defaultSuite.rooms.length).toBe(7);
    for (const idx of [7, 8, 100]) {
      const bad = bodyOf(onePiece);
      bad[COUNT_AT + 1] = idx;
      expect(decode(sign(bad)), `room ${idx}`).toBe(null);
    }
    // And from the other side: a snapshot naming a room the suite has not got
    // cannot be shared at all, so the recipient gets the defaults.
    const p = layout(defaultSuite)[0]!;
    expect(encode({ ...realistic, pieces: [{ ...p, room: "nowhere", id: "nowhere-bed-0" }] })).toBe("");
    expect(decode("")).toBe(null);
  });

  it("returns null when the piece count outruns the bytes", () => {
    const bad = bodyOf(onePiece);
    bad[COUNT_AT] = 40;
    expect(decode(sign(bad))).toBe(null);
    const enormous = [...bodyOf(noPieces)];
    enormous[COUNT_AT] = 0xff;
    enormous.push(0x7f);
    expect(decode(sign(enormous))).toBe(null);
  });

  it("never throws, and anything it accepts is canonical", () => {
    // The general statement the individual cases above are examples of. The
    // canonical half is the load-bearing one: if every accepted string
    // re-encodes to itself, then no hostile string can name a snapshot the
    // encoder would have refused -- which is how "a URL cannot carry an illegal
    // suite" is proved for inputs nobody thought of.
    const body = bodyOf(onePiece);
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < body.length; i++) {
      for (const v of [0, 1, 2, 7, 0x3f, 0x7f, 0x80, 0xfe, 0xff]) {
        const bad = [...body];
        bad[i] = v;
        const q = sign(bad);
        const got = decode(q);
        if (got === null) {
          refused++;
          continue;
        }
        accepted++;
        expect(encode(got), `byte ${i} = ${v}`).toBe(q);
        expect(decode(encode(got))).toEqual(got);
      }
    }
    expect(refused).toBeGreaterThan(100);
    // Non-vacuity the other way: the sweep really does produce readable
    // variants, so the canonical assertion is being exercised.
    expect(accepted).toBeGreaterThan(20);
  });

  it("survives random strings over its own alphabet", () => {
    const rnd = makeRnd(90210);
    for (let i = 0; i < 2000; i++) {
      const n = intIn(rnd, 0, 80);
      let q = "";
      for (let j = 0; j < n; j++) q += ALPHABET[intIn(rnd, 0, 63)];
      const got = decode(q);
      if (got !== null) expect(encode(got)).toBe(q);
    }
  });
});

describe("what cannot be shared", () => {
  it("refuses NaN and Infinity in any numeric field", () => {
    const p = layout(defaultSuite)[0]!;
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(encode({ ...realistic, t: bad }), `t ${bad}`).toBe("");
      expect(encode({ ...realistic, hour: bad }), `hour ${bad}`).toBe("");
      expect(encode({ ...realistic, params: { ...DEFAULT_PARAMS, ceiling: bad } })).toBe("");
      expect(encode({ ...realistic, pieces: [{ ...p, u: bad }] })).toBe("");
      expect(encode({ ...realistic, orbit: { azimuthDeg: bad, polarDeg: 40, radius: 120 } })).toBe("");
    }
    // No byte sequence can carry them either: every number on the wire is an
    // integer count of lattice steps.
    expect(decode(encode({ ...realistic, t: NaN }))).toBe(null);
  });

  it("refuses a suite longer than Weld's waist", () => {
    const over = { ...DEFAULT_PARAMS, sectionLength: MAX_SECTION_LENGTH + 1 / 12 };
    expect(encode({ ...realistic, pieces: [], params: over })).toBe("");
    // At the limit it is still shareable, so the gate is the limit and not a
    // blanket refusal.
    const at = { ...DEFAULT_PARAMS, sectionLength: Math.floor(MAX_SECTION_LENGTH * 12) / 12 };
    expect(encode({ ...realistic, pieces: [], params: at })).not.toBe("");

    // And from the wire, which is the case that matters: a hand-edited section
    // length is refused rather than rendered as masonry outside the shell.
    const short = bodyOf({ ...realistic, pieces: [], params: { ...DEFAULT_PARAMS, sectionLength: 44 } });
    const longer = bodyOf({ ...realistic, pieces: [], params: { ...DEFAULT_PARAMS, sectionLength: 45 } });
    const at0 = short.findIndex((b, i) => b !== longer[i]);
    const want = varint(528);
    expect(short.slice(at0, at0 + want.length)).toEqual(want);
    const bad = [...short];
    bad.splice(at0, want.length, ...varint(Math.ceil(MAX_SECTION_LENGTH * 12) + 12));
    expect(decode(sign(bad))).toBe(null);
  });

  it("refuses a suite whose rooms overlap or cannot be entered", () => {
    // A bathroom deeper than the bedroom in front of it drives buildSuite's
    // unknownDeep negative, which findOverlaps cannot see -- the separation test
    // passes trivially for an empty rect -- so the room-extent gate is what
    // catches it.
    const deepBath = { ...DEFAULT_PARAMS, bathDeep: DEFAULT_PARAMS.bedDepth };
    expect(encode({ ...realistic, pieces: [], params: deepBath })).toBe("");

    // A leg deeper than the rooms in it: the hall's inner wall pulls away to
    // u = 25.5 while every room still ends at 16, so nothing touches the hall and
    // the whole suite is unreachable. This is what unreachableRooms() exists for,
    // and the rooms themselves are perfectly well formed -- findOverlaps returns
    // nothing, which is exactly why the second gate is not redundant.
    const deepLeg = { ...DEFAULT_PARAMS, legDepth: 30 };
    expect(buildSuite(deepLeg).rooms.length).toBe(7);
    expect(encode({ ...realistic, pieces: [], params: deepLeg })).toBe("");

    // Overlapping rooms proper: a hall wide enough to eat the bedrooms.
    const fatHall = { ...DEFAULT_PARAMS, hallWidth: 12 };
    expect(encode({ ...realistic, pieces: [], params: fatHall })).toBe("");
  });

  it("refuses furniture that is not on the floor it claims", () => {
    // Built here rather than taken from layout(), so that the assertion is about
    // this module and not about another owner's recipes.
    const bedA = defaultSuite.rooms.find((r) => r.id === "bedA")!;
    const bed: Piece = {
      id: "bedA-bed-0",
      kind: "bed",
      room: "bedA",
      u: bedA.u,
      v: bedA.v,
      du: SIZES.bed.du,
      dv: SIZES.bed.dv,
      h: SIZES.bed.h,
      yaw: 0,
    };
    expect(encode({ ...realistic, pieces: [bed] })).not.toBe("");
    // Out through the wall: bedA is 16 ft deep and the bed is 82 in long.
    expect(encode({ ...realistic, pieces: [{ ...bed, u: bedA.u + bedA.du - 1 }] })).toBe("");
    // Two pieces fighting over the same floor. Flush is legal; overlapping is
    // not, which is collide.ts's rule and not a second one.
    const twin: Piece = { ...bed, id: "bedA-bed-1", v: bed.v + 1 };
    expect(encode({ ...realistic, pieces: [bed, twin] })).toBe("");
    expect(encode({ ...realistic, pieces: [bed, { ...twin, v: bed.v + bed.dv }] })).not.toBe("");
    // Two pieces with the same id: the renderer keys instanced meshes off it.
    expect(encode({ ...realistic, pieces: [bed, { ...bed, v: bed.v + bed.dv }] })).toBe("");
  });

  it("refuses an impossible date, and round-trips a real one", () => {
    for (const date of ["2026-02-30", "2026-13-01", "2026-00-10", "26-09-15", "2026-9-15", "2026-09-15T00:00", "", "not a date"]) {
      expect(encode({ ...realistic, date }), date).toBe("");
    }
    for (const date of ["2026-09-15", "2026-02-28", "2028-02-29", "1900-01-01", "2100-12-31"]) {
      expect(decode(encode({ ...realistic, date }))!.date, date).toBe(date);
    }
  });

  it("refuses out-of-range scalars", () => {
    expect(encode({ ...realistic, t: 1.5 })).toBe("");
    expect(encode({ ...realistic, t: -0.5 })).toBe("");
    expect(encode({ ...realistic, hour: 25 })).toBe("");
    expect(encode({ ...realistic, hour: -1 })).toBe("");
    expect(encode({ ...realistic, stage: 6 as Snapshot["stage"] })).toBe("");
    expect(encode({ ...realistic, params: { ...DEFAULT_PARAMS, partition: 0 } })).toBe("");
    expect(encode({ ...realistic, params: { ...DEFAULT_PARAMS, ceiling: -10 } })).toBe("");
    expect(encode({ ...realistic, orbit: { azimuthDeg: 200, polarDeg: 40, radius: 120 } })).toBe("");
    expect(encode({ ...realistic, orbit: { azimuthDeg: 0, polarDeg: 200, radius: 120 } })).toBe("");
    // Hour 24 is midnight at the end of the day, which store.ts's setHour
    // deliberately allows, so the format has to carry it.
    expect(decode(encode({ ...realistic, hour: 24 }))!.hour).toBe(24);
  });

  it("does not clamp the orbit, because CameraRig does", () => {
    // store.ts says why the store does not clamp either. A link that came back
    // with the camera somewhere else than it went out would be a worse bug than
    // an out-of-clamp orbit, which clampOrbit fixes on the next frame.
    const wide: Snapshot = { ...realistic, orbit: { azimuthDeg: 179.99, polarDeg: 3, radius: 500 } };
    expect(decode(encode(wide))).toEqual(wide);
  });
});

describe("length", () => {
  it("keeps a full snapshot inside a bound a message client will carry", () => {
    const q = encode(realistic);
    const empty = encode({ ...realistic, pieces: [] });
    // MEASURED: 355 characters for the 29-piece fit-out with the camera parked,
    // the clock set and the roof off; 358 with "?s=" on the front. 63 of those are
    // the suite itself -- stage, clock, camera and all fifteen parameters -- and
    // the other 292 are the furniture, at 10.07 characters a piece.
    //
    // THE BOUND IS 512, chosen from that measurement rather than from a standard.
    // A piece costs ten characters, so 512 buys fifteen more of them before the
    // format has to be revisited, and it stays inside the shortest limit that
    // actually bites on this path: a 160-character SMS splits a longer link across
    // segments, and the ~2,000 characters at which old link handlers begin
    // truncating is four times away.
    //
    // The total is asserted as a window rather than as 355 exactly because it
    // counts furniture.ts's inventory, which is another owner's file; the two
    // numbers that are this module's own -- the fixed cost and the cost per piece
    // -- are pinned exactly.
    expect(q.length).toBeGreaterThan(300);
    expect(q.length).toBeLessThan(400);
    expect(q.length).toBeLessThan(512);
    expect(`?${SNAPSHOT_PARAM}=${q}`.length).toBeLessThan(512);
    expect(encode(DEFAULT_SNAPSHOT).length).toBeLessThan(512);

    // What it is measured against, and the reason the phase spec says not to put
    // JSON in the query: the same snapshot is 18x longer once escaped.
    const json = encodeURIComponent(JSON.stringify(realistic));
    expect(json.length).toBeGreaterThan(15 * q.length);

    // A coordinate costs a small integer, not a float.
    expect(empty.length).toBe(63);
    const perPiece = (q.length - empty.length) / realistic.pieces.length;
    expect(perPiece).toBeGreaterThan(9);
    expect(perPiece).toBeLessThan(11);
  });

  it("stays inside the bound at the largest suite the model allows", () => {
    const rnd = makeRnd(31337);
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const s = randomSnapshot(rnd);
      const q = encode(s);
      if (q !== "") worst = Math.max(worst, q.length);
    }
    expect(worst).toBeGreaterThan(200);
    expect(worst).toBeLessThan(512);
  });

  it("is url-safe, so nothing downstream has to escape it", () => {
    const rnd = makeRnd(1234567);
    for (let i = 0; i < 60; i++) {
      const q = encode(randomSnapshot(rnd));
      if (q === "") continue;
      expect(q).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(encodeURIComponent(q)).toBe(q);
    }
  });
});
