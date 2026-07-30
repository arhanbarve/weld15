/**
 * The whole viewable state of Weld 15, packed into one query parameter.
 *
 * The point is a link. Somebody rearranges the suite, corrects a dimension the
 * project inferred rather than sourced, and sends the result to a friend; the
 * friend opens exactly what the sender was looking at. So this module has two
 * jobs and they are not symmetric. encode() has to produce something a messaging
 * client will carry intact. decode() has to survive whatever comes back, because
 * by then the string has been through a chat window, a shortener, an email client
 * that wraps at 78 columns and possibly somebody's curiosity.
 *
 * WHY NOT JSON
 * JSON.stringify of a full snapshot is 3,673 characters, and 6,465 once escaped
 * into a query -- the 29-piece fit-out alone is 29 objects of nine fields with
 * 17-digit doubles in them. That is past the length at which clients start
 * wrapping and truncating, which is the exact failure this feature exists to
 * avoid. The packing below gets the same snapshot into 355 characters, an 18x
 * saving, and the whole of it comes from two decisions: numbers go on a
 * fixed-point lattice as integers, and anything derivable is derived rather than
 * carried.
 *
 * WHAT IS NOT CARRIED, AND WHY THAT IS MOST OF THE SAVING
 *   - A piece's du, dv and h. They are SIZES[kind], so kind is enough. This is
 *     not only shorter, it is a security property: a URL cannot smuggle a 40 ft
 *     bed into the scene, because no field in the wire format can say so.
 *   - A piece's room, as a string. It is an index into buildSuite(params).rooms,
 *     which the decoder has already had to build in order to validate anything.
 *   - A piece's id. furniture.ts builds it as `${room}-${kind}-${n}` (see
 *     fitOut), so only n travels. The ids do have gaps -- fitOut numbers slots
 *     rather than successes so a dropped piece does not renumber its neighbours
 *     -- which is exactly why n has to travel and cannot be recomputed from the
 *     array index.
 *   - reducedMotion. It is set from the recipient's own media query. A link that
 *     carried it would let a sender override someone else's accessibility
 *     preference, which is not shared state; it is their state.
 *
 * WHY THE LATTICE IS ONE INCH AND NOT collide.ts's 0.5 FT GRID
 * The phase spec says to quantise onto the 0.5 ft grid, and that is right for
 * *drag* -- but it cannot carry the furniture. A bed frame is 82 in long
 * (withFrame(MATTRESS.du)), and bedroomSlots() stands the dresser at exactly
 * that, u = 82/12 = 6.8333 ft. Twelve of the 29 pieces in the default fit-out sat
 * off the half-foot grid when this was written, so quantising to 0.5 ft moves
 * every dresser two inches on the first shared link and the worst piece a quarter
 * of a foot -- tests/url.test.ts measures both, and pins the claim to SIZES
 * rather than to the count, because the recipes that place them are another
 * owner's file and do move.
 *
 * One inch is the coarsest lattice that holds all of DEFAULT_PARAMS (every one of
 * the fifteen lengths is a whole number of inches, 10.75 ft ceiling included), all
 * of SIZES, and every position layout() and snapToWalls() produce at those params.
 * It still costs a small integer: two bytes of varint for any coordinate in the
 * suite, against the eight a double would need.
 *
 * WHY DIVIDE AND NEVER MULTIPLY ON THE WAY BACK
 * A count comes back as n / 12, not n * (1/12). furniture.ts's inches() makes
 * the same point for the same reason: 40 * (1/12) and 40/12 are different
 * doubles in the last bit, and the one every flush placement in the suite is
 * built from is the second. Multiplying here would shift half the fit-out by an
 * ulp on every round trip -- invisible on screen, fatal to the deep-equality
 * contract, and the sort of thing that is only ever found by a property test.
 *
 * WHAT DOES NOT ROUND-TRIP EXACTLY, MEASURED RATHER THAN HOPED
 * One piece of the default fit-out does not, and did not when this was written
 * either. bedroomSlots() puts the second bed at f.B - bed.eb = 10 - 40/12 =
 * 22.166666666666664 ft once the room offset is added, and the nearest double to
 * 266/12 is 22.166666666666668 -- one ulp away.
 * No fixed-point lattice can hold that, because it is not the nearest double to
 * any rational with a small denominator. So the honest statement of the contract
 * is: decode(encode(s)) deep-equals s for every snapshot ON the lattice, and for
 * anything else every length lands within half an inch, with the worst case
 * actually observed on the shipped fit-out being 3.6e-15 ft. With wingStep on
 * the same applies more loudly: the common room's outer wall is measured off
 * Weld's GIS ring at u = -5.16508537 ft, so a bookcase flush against it is not
 * on any lattice at all and comes back up to half an inch out.
 *
 * THE -0 TRAP
 * frames.ts has a negate() helper for one reason: -0 leaks out of a coordinate
 * transform, serialises into shared state, and breaks value equality while
 * printing as "0" in every log you would think to check. count() below guards
 * it, and tests/url.test.ts pins it. Note where the guard has to be: the byte
 * writer would coerce -0 to 0 anyway, so the guard looks redundant -- it is
 * there so that the normalisation is a stated property of the boundary rather
 * than an accident of Uint8Array, and so that it survives the day somebody adds
 * a field that goes out as text.
 *
 * WHERE MAX_SECTION_LENGTH COMES FROM, AND WHY NOT FROM THE MODULE THAT DRAWS WELD
 * This file used to import it from @/scene/weldGeometry, which imports three, so a
 * serialiser pulled in the renderer's dependency and the whole state layer stopped
 * being runnable in plain node. That is not a taste objection: scripts/emit-*.mjs run
 * these modules by path in node and tests/drift.test.ts shells out to both, and three
 * anywhere in the reachable set is an ERR_MODULE_NOT_FOUND at import rather than a
 * type error, so tsc reports nothing. Typing 50.25 in here instead would have been
 * worse again -- docs/DIMENSION-AUDIT.md section 1 is a list of what happens to a
 * measured number copied into a second file. The derivation now lives in @/geo/place,
 * which is three-free and already marches Weld's ring, and that is what this imports.
 *
 * The import carries the same useful side effect the old one did, now on purpose
 * rather than by luck: place.ts's module body calls provideFacadeStep(), so
 * params.wingStep works here instead of throwing, and it is this file's own import
 * that guarantees it. suiteOf() still catches the throw, because buildSuite() has
 * other ways to fail.
 */

import { placeIsLegal, type Box } from "@/geo/collide";
import { SIZES, layout, pieceBox, type FurnitureKind, type Piece } from "@/geo/furniture";
import { MAX_SECTION_LENGTH } from "@/geo/place";
import {
  buildSuite,
  DEFAULT_PARAMS,
  findOverlaps,
  unreachableRooms,
  type Suite,
  type SuiteParams,
} from "@/geo/rooms";
// Type-only, and it has to stay that way. H integrates this module INTO store.ts,
// so a value import here would close a real cycle; rooms.ts's measuredFacadeStep
// and store.ts's `orbit: null` are the same decision made twice already.
import type { Orbit } from "@/scene/orbit";
import type { StageId } from "@/state/store";

/**
 * Everything a link carries.
 *
 * Deviations from the shape in docs/phases/P6.md F1, which was written before
 * the store existed:
 *   - `facade` is params.facade and is not repeated at the top level. Two copies
 *     of one flag is a disagreement waiting to happen.
 *   - `mirrored`, `kUse` and `beds` are not here. Nothing in the store or in
 *     SuiteParams holds them yet, and a field no reducer reads is a field the
 *     round-trip test would be the only consumer of. They belong to G1/H.
 *   - `day: string` is `date: string`, which is what store.ts calls it.
 *   - `cutaway` is a boolean, not a CutawayMode, because that is what the store
 *     holds today. F3 owns the four-mode type; widening this to it is a one-line
 *     change to KINDS-style table plus the flags bit.
 *   - `t` and `orbit` are added. Both are in the store and both are part of what
 *     you are looking at: t is the descent's progress through stage 4, orbit is
 *     where the camera stands in stage 3. A link that dropped them would reopen
 *     at a different shot of the same suite.
 *
 * Numbers are on a lattice: lengths in whole inches, hour in whole minutes,
 * orbit in hundredths, t in thousandths. Off-lattice values are accepted and
 * rounded to the nearest lattice point -- see the header on what that costs.
 */
export type Snapshot = {
  stage: StageId;
  /** Progress within the stage, 0..1. */
  t: number;
  params: SuiteParams;
  pieces: Piece[];
  cutaway: boolean;
  /** Decimal hours of Cambridge wall clock, 0..24. */
  hour: number;
  /** Civil date, "YYYY-MM-DD". */
  date: string;
  orbit: Orbit | null;
};

/**
 * The query parameter to hang encode()'s output on: `?s=...`.
 *
 * Exported rather than assumed so that the reader and the writer of the URL
 * cannot drift. decode() takes the parameter's VALUE, not the query string --
 * `new URLSearchParams(location.search).get(SNAPSHOT_PARAM)` -- because parsing
 * a query string is URLSearchParams's job and doing it again here would be a
 * second, worse implementation of it.
 */
export const SNAPSHOT_PARAM = "s";

// --- the wire format ------------------------------------------------------
//
//   u8    version                      must be 1
//   uint  stage                        0..5
//   uint  t                            thousandths
//   uint  flags                        bit0 cutaway, bit1 facade=west,
//                                      bit2 wingStep, bit3 orbit present
//   uint  hour                         minutes
//   int   date                         days since 1970-01-01, UTC
//   int   x15                          params lengths, inches, in LENGTH_KEYS order
//   int   orbit azimuth                hundredths of a degree   ) only if bit3
//   uint  orbit polar                  hundredths of a degree   )
//   uint  orbit radius                 hundredths of a foot     )
//   uint  piece count
//   per piece:
//     uint  room                       index into buildSuite(params).rooms
//     uint  kind                       index into KINDS
//     uint  ordinal                    the n in `${room}-${kind}-${n}`
//     int   u                          inches
//     int   v                          inches
//     uint  yaw                        index into YAWS
//   u16   trailer                      FNV-1a of every preceding byte, low 16 bits
//
// then base64url, no padding.
//
// The trailer is the difference between "this string is not ours" and "this
// string is ours and says something else". Structural validation alone cannot
// tell them apart: a reordered or hand-edited payload can read as a perfectly
// well-formed snapshot of a different room, and silently opening the wrong room
// is worse than opening the default one. Sixteen bits gives a 1-in-65,536 chance
// of accepting a corrupted string, which for a link somebody pastes by hand is
// the right order; a full 32 would cost two more bytes to defend against an
// adversary who could just encode a valid string instead.

const VERSION = 1;

/** Lattice divisors. Divisors, never multipliers -- see the header. */
const PER_FOOT = 12;
const PER_HOUR = 60;
const PER_CENTI = 100;
const PER_UNIT = 1000;

/**
 * Hard caps, all of them about untrusted input rather than about the model.
 *
 * MAX_ENCODED is checked before anything else touches the string, so a
 * megabyte-long parameter costs one length comparison. 8,192 is about 22x the
 * longest snapshot this format can produce for a plausible suite, so it bounds
 * the work without bounding the feature.
 */
const MAX_ENCODED = 8192;
const MAX_PIECES = 256;
const MAX_ORDINAL = 4095;
/** Days from 1970 either way. About 274 years, so a four-digit year always fits. */
const MAX_DAYS = 100_000;

const YAWS = [0, 90, 180, 270] as const;
const STAGE_IDS = [0, 1, 2, 3, 4, 5] as const satisfies readonly StageId[];

/**
 * Order matters and completeness matters more, so both tables are declared as a
 * Record over the union rather than as an array. Add a FurnitureKind or a
 * numeric SuiteParams field and this file stops compiling, which is the loud
 * version of the alternative: the field quietly drops out of every shared link
 * and the round-trip test starts passing on a snapshot that has lost it.
 */
const KIND_ORDER: Record<FurnitureKind, number> = {
  bed: 0,
  desk: 1,
  chair: 2,
  dresser: 3,
  sofa: 4,
  table: 5,
  shelf: 6,
};

type LengthKey = {
  [K in keyof SuiteParams]: SuiteParams[K] extends number ? K : never;
}[keyof SuiteParams];

const LENGTH_ORDER: Record<LengthKey, number> = {
  sectionLength: 0,
  legDepth: 1,
  hallWidth: 2,
  bedDepth: 3,
  commonAlong: 4,
  commonDeep: 5,
  bedAAlong: 6,
  bedBAlong: 7,
  bathAlong: 8,
  bathDeep: 9,
  kDeep: 10,
  kAlong: 11,
  partition: 12,
  masonry: 13,
  ceiling: 14,
};

function ordered<K extends string>(rec: Record<K, number>): K[] {
  return (Object.keys(rec) as K[]).sort((a, b) => rec[a] - rec[b]);
}

const KINDS = ordered(KIND_ORDER);
const LENGTH_KEYS = ordered(LENGTH_ORDER);

/**
 * What the app opens at with no link, and the fallback whenever decode() says
 * null.
 *
 * stage, t, cutaway, date and hour are store.ts's initial values. DEFAULT_DATE
 * and DEFAULT_HOUR are not exported there and cannot be imported for the cycle
 * reason given at the top, so they are copied -- and tests/url.test.ts asserts
 * the copy against useStore.getState(), which is the only thing that stops the
 * two from drifting.
 *
 * Declared here, below the lattice constants, rather than up beside Snapshot:
 * the initialiser reads PER_FOOT, and a const read before its declaration is a
 * temporal-dead-zone ReferenceError at import, which is the one failure mode a
 * module-level default cannot recover from.
 */
export const DEFAULT_SNAPSHOT: Snapshot = {
  stage: 0,
  t: 0,
  params: DEFAULT_PARAMS,
  // Computed at load rather than written out: layout() is pure and cheap (29
  // pieces of arithmetic), and a literal here would drift from furniture.ts on
  // the first change to a recipe.
  //
  // Snapped onto the lattice, which is what makes this a fixed point of
  // encode/decode. Without the snap the app's own default state is the one
  // snapshot that does not survive being shared: bedroomSlots() puts bedA-bed-1
  // at 10 - 40/12 plus the room offset, which is one ulp off 266/12. The snap
  // moves that single coordinate by 3.6e-15 ft and nothing else at all -- the
  // other 28 pieces are already bit-identical, which tests/url.test.ts asserts
  // in both directions.
  pieces: layout(buildSuite()).map((p) => ({
    ...p,
    u: Math.round(p.u * PER_FOOT) / PER_FOOT,
    v: Math.round(p.v * PER_FOOT) / PER_FOOT,
  })),
  cutaway: false,
  hour: 9,
  date: "2026-09-15",
  orbit: null,
};

// --- the two public functions ---------------------------------------------

/**
 * The value of the one query parameter, or "" for a snapshot this format cannot
 * carry.
 *
 * "" rather than a throw or a best-effort string, because there is a third
 * possible answer and it is the one that must never happen: a string that
 * decodes to a DIFFERENT suite. Everything encode() refuses is something decode()
 * would refuse -- both call validate() -- so "" means "not shareable", and
 * decode("") is null, so the recipient opens at defaults instead of somewhere
 * subtly wrong.
 *
 * A non-Malformed exception is rethrown on purpose. Malformed means bad input;
 * anything else means a bug in this file, and swallowing it here would turn it
 * into a link that silently stops working.
 */
export function encode(s: Snapshot): string {
  try {
    const suite = suiteOf(s.params);
    validate(s, suite);

    const out: number[] = [VERSION];
    putUint(out, s.stage);
    putUint(out, count(s.t, PER_UNIT));
    putUint(out, flagsOf(s));
    putUint(out, count(s.hour, PER_HOUR));
    putInt(out, dateToDays(s.date));
    for (const k of LENGTH_KEYS) putInt(out, count(s.params[k], PER_FOOT));
    if (s.orbit) {
      putInt(out, count(s.orbit.azimuthDeg, PER_CENTI));
      putUint(out, count(s.orbit.polarDeg, PER_CENTI));
      putUint(out, count(s.orbit.radius, PER_CENTI));
    }
    putUint(out, s.pieces.length);
    for (const p of s.pieces) {
      putUint(out, suite.rooms.findIndex((r) => r.id === p.room));
      putUint(out, KINDS.indexOf(p.kind));
      putUint(out, ordinalOf(p));
      putInt(out, count(p.u, PER_FOOT));
      putInt(out, count(p.v, PER_FOOT));
      putUint(out, YAWS.indexOf(p.yaw));
    }

    const t = trailer(out);
    out.push((t >>> 8) & 0xff, t & 0xff);
    return toBase64url(out);
  } catch (e) {
    if (e instanceof Malformed) return "";
    throw e;
  }
}

/**
 * A snapshot, or null. Total: every input, including a truncated one, a
 * reordered one, a hand-edited one and a ten-megabyte one, either yields a
 * snapshot that is legal enough to render or yields null.
 *
 * The catch is deliberately bare. A URL is untrusted input arriving on the boot
 * path, so a bug in this file must degrade the app to its defaults rather than
 * white-screen it -- and the class of thing that would throw is wide: buildSuite
 * throws on wingStep without place.ts, a Date can be Invalid, a varint can
 * overflow. The cost is that a genuine bug here shows up as "the link didn't
 * work" instead of as a stack trace, which is why the property tests carry the
 * weight.
 *
 * Never a partially populated object. The snapshot is assembled and then
 * validated as a whole, and nothing is returned until it has passed.
 */
export function decode(q: string): Snapshot | null {
  try {
    if (!q || q.length > MAX_ENCODED) return null;

    const bytes = fromBase64url(q);
    // version + something + two trailer bytes.
    if (bytes.length < 4) return null;
    const body = bytes.slice(0, bytes.length - 2);
    const want = (bytes[bytes.length - 2]! << 8) | bytes[bytes.length - 1]!;
    if (trailer(body) !== want) return null;

    const r: Cursor = { bytes: body, at: 0 };
    if (getByte(r) !== VERSION) return null;

    const stage = pick(STAGE_IDS, getUint(r));
    const t = getUint(r) / PER_UNIT;
    const flags = getUint(r);
    if (flags > 0b1111) return null;
    const hour = getUint(r) / PER_HOUR;
    const date = daysToDate(getInt(r));

    const lengths = {} as Record<LengthKey, number>;
    for (const k of LENGTH_KEYS) lengths[k] = getInt(r) / PER_FOOT;
    const params: SuiteParams = {
      ...lengths,
      facade: flags & 0b0010 ? "west" : "east",
      wingStep: (flags & 0b0100) !== 0,
    };

    const orbit: Orbit | null =
      flags & 0b1000
        ? {
            azimuthDeg: getInt(r) / PER_CENTI,
            polarDeg: getUint(r) / PER_CENTI,
            radius: getUint(r) / PER_CENTI,
          }
        : null;

    // Built here rather than after the pieces, because resolving a room index is
    // the only way to read a piece at all -- and an index outside this list is
    // precisely "a piece in a room that does not exist".
    const suite = suiteOf(params);

    const n = getUint(r);
    if (n > MAX_PIECES) return null;
    const pieces: Piece[] = [];
    for (let i = 0; i < n; i++) {
      const room = suite.rooms[getUint(r)];
      if (!room) return null;
      const kind = pick(KINDS, getUint(r));
      const ordinal = getUint(r);
      if (ordinal > MAX_ORDINAL) return null;
      const size = SIZES[kind];
      pieces.push({
        id: `${room.id}-${kind}-${ordinal}`,
        kind,
        room: room.id,
        u: getInt(r) / PER_FOOT,
        v: getInt(r) / PER_FOOT,
        du: size.du,
        dv: size.dv,
        h: size.h,
        yaw: pick(YAWS, getUint(r)),
      });
    }

    // Trailing bytes mean this is not a string this version wrote, whatever else
    // it may be. Accepting it would make the format silently extensible, and the
    // trailer already proves nobody appended by accident.
    if (r.at !== body.length) return null;

    const s: Snapshot = { stage, t, params, pieces, cutaway: (flags & 1) !== 0, hour, date, orbit };
    validate(s, suite);
    return s;
  } catch {
    return null;
  }
}

// --- validation, run by both directions -----------------------------------

/**
 * A signal, not an error to be reported. Carries no message because nothing is
 * meant to read it: every caller turns it into "" or null.
 */
class Malformed extends Error {}

function reject(): never {
  throw new Malformed();
}

/**
 * buildSuite() plus the checks that decide whether a suite is a suite.
 *
 * The three gates are the ones the phase spec already relies on elsewhere:
 * findOverlaps and unreachableRooms exist because this geometry can silently
 * produce a suite whose rooms are inside each other or cannot be entered, and
 * MAX_SECTION_LENGTH exists because past it the suite is wider than Weld's waist
 * and the facade masonry -- window bays and all -- is drawn outside the shell.
 * Nothing inside the suite notices any of the three, which is exactly why a link
 * must not be allowed to carry one: a viewer cannot tell a broken model from a
 * correct one.
 */
function suiteOf(params: SuiteParams): Suite {
  for (const k of LENGTH_KEYS) {
    const v = params[k];
    if (!Number.isFinite(v) || v <= 0) reject();
  }
  if (params.facade !== "east" && params.facade !== "west") reject();
  if (typeof params.wingStep !== "boolean") reject();
  if (params.sectionLength > MAX_SECTION_LENGTH) reject();

  let suite: Suite;
  try {
    suite = buildSuite(params);
  } catch {
    // wingStep without place.ts's ring measurement throws by design. Caught
    // rather than prevented: whether the measurement has been provided depends
    // on module load order, which this file should not be asserting about.
    return reject();
  }

  // A room with a non-positive extent is not caught by findOverlaps -- the
  // separation test passes trivially for an empty rect -- and it is what a
  // bathroom deeper than the bedroom in front of it produces (unknownDeep goes
  // negative), which is one slider away from the defaults.
  for (const r of suite.rooms) {
    if (!(r.du > 0) || !(r.dv > 0)) reject();
  }
  if (findOverlaps(suite.rooms).length > 0) reject();
  if (unreachableRooms(suite).length > 0) reject();
  return suite;
}

/** Everything about a snapshot that is not about the shape of the suite. */
function validate(s: Snapshot, suite: Suite): void {
  if (!(STAGE_IDS as readonly number[]).includes(s.stage)) reject();
  if (!inRange(s.t, 0, 1)) reject();
  if (!inRange(s.hour, 0, 24)) reject();
  if (typeof s.cutaway !== "boolean") reject();
  dateToDays(s.date);

  if (s.orbit) {
    if (!inRange(s.orbit.azimuthDeg, -180, 180)) reject();
    if (!inRange(s.orbit.polarDeg, 0, 180)) reject();
    // Not clamped to STAGE3_CLAMP. CameraRig runs clampOrbit on every value that
    // reaches it (store.ts says why the store does not), and clamping here would
    // mean a link whose camera came back somewhere else than it went out.
    if (!inRange(s.orbit.radius, 0, 100_000)) reject();
  }

  if (!Array.isArray(s.pieces) || s.pieces.length > MAX_PIECES) reject();
  const byRoom = new Map<string, Box[]>();
  const ids = new Set<string>();
  for (const p of s.pieces) {
    const room = suite.rooms.find((r) => r.id === p.room);
    if (!room) reject();
    const size = SIZES[p.kind];
    if (!size) reject();
    // A piece whose extents disagree with its kind cannot survive a round trip
    // -- du, dv and h are rebuilt from SIZES rather than carried -- so refusing
    // it here is what keeps "encode then decode" from quietly resizing the
    // furniture instead of failing.
    if (p.du !== size.du || p.dv !== size.dv || p.h !== size.h) reject();
    if (!(YAWS as readonly number[]).includes(p.yaw)) reject();
    ordinalOf(p);
    // The renderer keys instanced meshes off the id, so two pieces sharing one
    // is a rendering bug arriving from a URL.
    if (ids.has(p.id)) reject();
    ids.add(p.id);

    const others = byRoom.get(p.room) ?? [];
    // Rooms do not overlap (suiteOf just proved it) and every piece is contained
    // by its own room, so a piece can only ever collide with one in the same
    // room. Grouping is not an optimisation, it is the reason this is O(n) in
    // rooms rather than O(n^2) in pieces.
    if (!placeIsLegal(pieceBox(p), room, others).ok) reject();
    others.push(pieceBox(p));
    byRoom.set(p.room, others);
  }
}

function inRange(x: number, lo: number, hi: number): boolean {
  return Number.isFinite(x) && x >= lo && x <= hi;
}

/**
 * The n in furniture.ts's `${room}-${kind}-${n}`.
 *
 * Strict about the spelling, including leading zeros: "bedA-bed-07" would encode
 * as 7 and come back as "bedA-bed-7", which is a round trip that changed the
 * data. Refusing is the only answer that is not a lie.
 */
function ordinalOf(p: Piece): number {
  const prefix = `${p.room}-${p.kind}-`;
  if (typeof p.id !== "string" || !p.id.startsWith(prefix)) reject();
  const tail = p.id.slice(prefix.length);
  const n = Number(tail);
  if (!Number.isInteger(n) || n < 0 || n > MAX_ORDINAL || String(n) !== tail) reject();
  return n;
}

function flagsOf(s: Snapshot): number {
  return (
    (s.cutaway ? 0b0001 : 0) |
    (s.params.facade === "west" ? 0b0010 : 0) |
    (s.params.wingStep ? 0b0100 : 0) |
    (s.orbit ? 0b1000 : 0)
  );
}

function pick<T>(table: readonly T[], i: number): T {
  const v = table[i];
  if (v === undefined) reject();
  return v;
}

// --- the lattice ----------------------------------------------------------

/**
 * A real number as an integer count of lattice steps.
 *
 * The `n === 0` line is the -0 guard. See the header: frames.ts's negate() is in
 * that file because -0 comes out of the coordinate transforms, and a -0 that
 * reaches a snapshot breaks deep equality against the +0 it renders identically
 * to. It is guarded here, at the one point every number in the format passes
 * through, rather than at each field.
 */
function count(x: number, per: number): number {
  if (!Number.isFinite(x)) reject();
  const n = Math.round(x * per);
  if (!Number.isSafeInteger(n)) reject();
  return n === 0 ? 0 : n;
}

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "YYYY-MM-DD" to whole days since the epoch.
 *
 * The round trip through daysToDate is the validation, and it has to be: Date.UTC
 * rolls an impossible date forward rather than refusing it, so 2026-02-30 becomes
 * 2026-03-02 and no arithmetic check on the components would catch it. Comparing
 * the formatted result against the input is the only test that does.
 */
function dateToDays(date: string): number {
  const m = typeof date === "string" ? DATE_RE.exec(date) : null;
  if (!m) return reject();
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(ms)) reject();
  const days = ms / DAY_MS;
  if (!Number.isInteger(days) || Math.abs(days) > MAX_DAYS) reject();
  if (daysToDate(days) !== date) reject();
  return days;
}

function daysToDate(days: number): string {
  if (!Number.isInteger(days) || Math.abs(days) > MAX_DAYS) reject();
  const d = new Date(days * DAY_MS);
  const y = d.getUTCFullYear();
  if (!Number.isFinite(y)) reject();
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(y, 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

// --- bytes ----------------------------------------------------------------

type Cursor = { bytes: number[]; at: number };

/**
 * LEB128, arithmetically rather than with shifts.
 *
 * `v % 128` and `Math.floor(v / 128)` where the obvious code says `v & 0x7f` and
 * `v >>>= 7`: the bitwise operators coerce to int32, so a value past 2^31 would
 * wrap silently into a different, valid-looking number. Nothing in a plausible
 * snapshot gets near that, but "nothing plausible" is not a property of
 * untrusted input, and the arithmetic version has no such edge to reason about.
 */
function putUint(out: number[], n: number): void {
  if (!Number.isSafeInteger(n) || n < 0) reject();
  let v = n;
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

/** Zigzag, so that a small negative costs one byte rather than nine. */
function putInt(out: number[], n: number): void {
  putUint(out, n < 0 ? -2 * n - 1 : 2 * n);
}

function getByte(r: Cursor): number {
  if (r.at >= r.bytes.length) reject();
  return r.bytes[r.at++]!;
}

function getUint(r: Cursor): number {
  let v = 0;
  let scale = 1;
  for (let i = 0; ; i++) {
    // Eight continuation bytes is already past Number.MAX_SAFE_INTEGER, so a
    // longer varint is either corruption or an attempt to make this loop run.
    if (i > 7) reject();
    const b = getByte(r);
    // A varint that ends on a zero group is a second spelling of a number this
    // format spells one way -- 104 written as [0xE8, 0x00] rather than [0x68].
    // Refusing it is what makes string-to-snapshot injective, and injectivity is
    // what lets decode() promise that everything it accepts re-encodes to the
    // string it came from. Without it a hand-edit can pad a field and get a
    // snapshot back that no encoder here would ever have written. Found by the
    // fuzz sweep in tests/url.test.ts, not by reading LEB128.
    if (i > 0 && b === 0) reject();
    v += (b & 0x7f) * scale;
    if ((b & 0x80) === 0) break;
    scale *= 128;
  }
  if (!Number.isSafeInteger(v)) reject();
  return v;
}

function getInt(r: Cursor): number {
  const u = getUint(r);
  // u / 2 in the even branch rather than a general -(u+1)/2, so that zero comes
  // back as +0. The odd branch cannot produce -0: u = 1 is the smallest and it
  // gives -1.
  return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
}

/**
 * FNV-1a, low 16 bits. Chosen for being four lines and dependency-free; this is
 * an integrity check against chat clients and fat fingers, not a MAC, and the
 * comment on the format above says what it does and does not buy.
 */
function trailer(bytes: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h = Math.imul(h ^ b, 0x01000193) >>> 0;
  }
  return h & 0xffff;
}

/**
 * base64url without padding: the 64 characters that survive a URL, an HTML
 * attribute and a chat client's autolinker untouched. Written out rather than
 * reached for through Buffer (node only) or btoa (lenient about garbage, and it
 * wants a binary string) -- twenty lines here buys one behaviour in both
 * runtimes and, more to the point, a decoder that REFUSES what it cannot read.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64url(bytes: readonly number[]): string {
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

function fromBase64url(s: string): number[] {
  // A single leftover character carries six bits, which is not a truncated byte
  // this alphabet could ever have written. Refusing it here means the length
  // check happens before the loop rather than as a surprise inside it.
  if (s.length % 4 === 1) reject();
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of s) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) reject();
    acc = acc * 64 + v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push(Math.floor(acc / 2 ** bits));
      acc %= 2 ** bits;
    }
  }
  // The tail bits of a canonical encoding are zero. Insisting on that is what
  // makes the mapping from string to bytes injective, and therefore what lets
  // decode() promise that anything it accepts re-encodes to the same string.
  if (acc !== 0) reject();
  return out;
}
