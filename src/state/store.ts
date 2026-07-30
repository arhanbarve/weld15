import { create } from "zustand";
import { placeIsLegal } from "@/geo/collide";
// tryMove() is deliberately absent: the pointer path calls it in DragLayer, where the
// candidate position lives, and hands the result here through commit(). Calling it a
// second time in the store would let the ghost and the stored piece disagree about a
// snap, which is the one discrepancy a drag cannot show you.
import { nudge as nudgePiece, tryRotate, type DragCtx, type DragResult } from "@/geo/drag";
import { layout, pieceBox, type Piece } from "@/geo/furniture";
import {
  buildSuite,
  DEFAULT_PARAMS,
  findOverlaps,
  unreachableRooms,
  type Suite,
  type SuiteParams,
} from "@/geo/rooms";
import { buildWalls } from "@/geo/walls";
import { MAX_SECTION_LENGTH } from "@/geo/place";
import { CUTAWAY_MODES, type CutawayMode } from "@/scene/cutaway";
import type { Orbit } from "@/scene/orbit";
import type { NudgeDir } from "@/geo/drag";
// A value import of url.ts, and it does NOT close a cycle: url.ts imports this module
// type-only, on purpose and with a comment saying so, and a type-only import erases
// at runtime. What is bought is that the store's opening state and the format's
// DEFAULT_SNAPSHOT are the same object rather than two copies of one arrangement --
// tests/url.test.ts asserts the store against it field by field, which is what makes
// the app's own default state shareable.
import { DEFAULT_SNAPSHOT } from "@/state/url";

/** The six stages of the descent. See docs/phases/P2.md. */
export const STAGES = [
  { id: 0, name: "Orbit" },
  { id: 1, name: "Cambridge" },
  { id: 2, name: "Harvard Yard" },
  { id: 3, name: "Weld Hall" },
  { id: 4, name: "Threshold" },
  { id: 5, name: "Weld 15" },
] as const;

export type StageId = 0 | 1 | 2 | 3 | 4 | 5;

export const LAST_STAGE: StageId = 5;

/**
 * The sun's default instant: 15 September 2026, 9 a.m. Cambridge time.
 *
 * A CHOICE, with reasons, not a measurement. Term time; the east facade is in sun
 * (solar.ts puts the sun at azimuth 113 and altitude 27) so the suite is lit
 * through its own windows rather than by fill alone; 27 degrees is low enough that
 * the oak's normal-map grain reads across the boards, which it does not under a
 * near-overhead sun; and it is one of the two dates docs/phases/P4-P5.md already
 * names for the daylight gates, so the default is not a third figure to keep in
 * step with them.
 */
const DEFAULT_DATE = "2026-09-15";
const DEFAULT_HOUR = 9;

type Store = {
  stage: StageId;
  /** Progress within the current stage, 0..1. Only stage 4 uses it. */
  t: number;
  params: SuiteParams;
  /** Set once from the media query; a branch, not a duration. */
  reducedMotion: boolean;

  /**
   * The civil date the sun is computed for, "YYYY-MM-DD", Cambridge local.
   *
   * A date and an hour rather than one `Date` because that is what the two
   * controls move independently: the picker moves the season and the slider moves
   * the hour. Holding an instant instead would make the slider rebuild a Date on
   * every input event, and would lose the hour whenever the date changed.
   *
   * Neither field is an instant. solar.ts reads every Date as UTC on purpose, and
   * Cambridge is five hours behind UTC in winter and four on daylight time, so the
   * conversion is explicit in Lighting.tsx rather than implied here.
   */
  date: string;
  /** Decimal hours of Cambridge wall clock, 0..24. */
  hour: number;

  /**
   * Stage 3's free orbit, or null while the camera still sits where stages.ts put
   * it.
   *
   * Null rather than a seeded Orbit because the seed is `orbitOf(keyframes[3])`
   * and this module cannot compute it: stages.ts imports StageId from here, so
   * importing stages.ts back would be a real cycle rather than the type-only one
   * `import type { Orbit }` above erases. Writing the seed out as three literals
   * instead would be a second copy of a derived number, and the first drag would
   * jerk the camera the moment the two disagreed. CameraRig resolves the null.
   */
  orbit: Orbit | null;

  /**
   * How much of the shell is taken away so the plan can be read. Four modes, from
   * "none" to one vertical section; cutaway.ts defines them and decides which walls
   * each one drops.
   *
   * This was a boolean until P6's UI landed, and the widening is the reason the
   * URL's flags field grew from one bit to two.
   */
  cutaway: CutawayMode;

  /**
   * The fit-out, as state rather than as a function of the params.
   *
   * This is THE change that makes the model changeable. Furniture.tsx used to call
   * layout(buildSuite(params)) inside its own render, which meant the arrangement
   * was a pure function of the sliders and a drag had nowhere to be recorded. Now
   * layout() seeds this once and every later move is a write here.
   *
   * Seeded from DEFAULT_SNAPSHOT rather than from layout() directly, because that is
   * the lattice-snapped copy: the app's own opening state has to be a fixed point of
   * encode/decode or the one arrangement that cannot be shared is the default one.
   * tests/url.test.ts pins both halves of that.
   */
  pieces: Piece[];

  /**
   * How many students the suite is fitted out for, 1..4.
   *
   * The SUITE's occupancy and not a per-bedroom count, which is what layout()'s
   * `beds` option means: it splits the number across the two bedrooms itself and
   * drives the desks and dressers from the same figure, because a student is a bed
   * plus a desk plus a dresser. Four is the housing assignment, from
   * docs/DIMENSION-AUDIT.md.
   *
   * WHY THE TOP OF THE RANGE IS 4 AND NOT 6, WHICH IS THE MORE INTERESTING QUESTION
   * Weld is documented as having housed quints and sextuplets, so five and six are
   * real questions about this building. The model cannot answer them: measured,
   * layout() places 4 beds for any occupancy of 4 or more, because bedroomSlots()
   * holds a two-to-a-bedroom limit and layout() deliberately keeps that limit in one
   * place. A control offering 6 would therefore return 4 and say nothing, which is
   * the class of quiet wrongness this project's audit exists to catch. So the range
   * stops where the recipes stop, and the panel's note says whose limit it is.
   *
   * Held here rather than derived because it is an occupancy question, not a geometry
   * one, and it takes effect only on refit(): a slider that rearranged both bedrooms
   * on input would throw away every drag the moment somebody asked what three
   * students would look like.
   */
  occupancy: number;

  /** The piece the panel and the keyboard act on, or null. */
  selected: string | null;

  /**
   * The last thing that was refused or dropped, in words, or null.
   *
   * A string and not a code, because there is exactly one consumer -- a live region
   * -- and the wording depends on which ids came back from drag.ts. Cleared on the
   * next successful action, so it reads as the state of the last attempt rather than
   * as a log.
   */
  notice: string | null;

  setStage: (s: StageId) => void;
  setT: (t: number) => void;
  next: () => void;
  prev: () => void;
  skipToSuite: () => void;
  setReducedMotion: (v: boolean) => void;
  setParams: (p: Partial<SuiteParams>) => void;
  setDate: (d: string) => void;
  setHour: (h: number) => void;
  setOrbit: (o: Orbit | null) => void;
  setCutaway: (v: CutawayMode) => void;

  setOccupancy: (n: number) => void;
  select: (id: string | null) => void;
  setNotice: (m: string | null) => void;

  /**
   * Commit a move the pointer path has already had accepted by drag.ts.
   *
   * The DragResult arrives rather than being recomputed, so the piece that is stored
   * is the one the ghost showed: recomputing here would run tryMove() a second time
   * against a context assembled a second way, and the two could disagree about a
   * snap. A refusal is worded and dropped, which is what makes a rejection visible
   * instead of swallowed.
   */
  commit: (id: string, r: DragResult) => void;
  /** Rotate the selected piece a quarter turn, or say why not. */
  rotate: (id: string) => void;
  /** One grid step, the keyboard's path and the panel buttons' path both. */
  nudge: (id: string, dir: NudgeDir) => void;
  /** Throw the arrangement away and re-run layout() at the current occupancy. */
  refit: () => void;
  /** Everything back to the shipped defaults, arrangement included. */
  resetAll: () => void;
  /** Replace the whole editable state at once. The URL's boot path. */
  hydrate: (s: {
    stage: StageId;
    t: number;
    params: SuiteParams;
    pieces: Piece[];
    cutaway: CutawayMode;
    hour: number;
    date: string;
    orbit: Orbit | null;
  }) => void;
};

/**
 * The occupancies the panel offers. 4 is the top because that is where the recipes
 * saturate, not because the building does -- see `occupancy` above.
 */
export const OCCUPANCY_RANGE = { min: 1, max: 4 } as const;

/**
 * What layout() fits out for when nobody asks: the four assigned students.
 *
 * furniture.ts holds this as DEFAULT_BEDS and does not export it, and importing it is
 * not worth widening that module's surface for one slider's starting position. So it
 * is a copy -- and tests/store.test.ts pins the copy the only way that cannot drift,
 * by asserting that layout() with this number produces exactly what layout() with no
 * options produces, and that one FEWER produces something different. One fewer and
 * not one more: the recipes cap at four, so `beds: 5` would agree with the default
 * and the non-vacuity check would pass while proving nothing.
 */
export const DEFAULT_OCCUPANCY = 4;

/**
 * drag.ts's context for a params/pieces pair.
 *
 * buildWalls() is called for the openings and not for the walls: drag.ts needs to
 * know where the doorways are so that blocks-door can be checked, and there is no
 * cheaper way to ask. It is pure arithmetic over seven rooms, so calling it per
 * action rather than caching it is not the expensive part of a drag; a stale cache
 * behind a slider would be.
 */
function ctxOf(params: SuiteParams, pieces: Piece[]): DragCtx {
  const suite = buildSuite(params);
  return { suite, pieces, openings: buildWalls(suite).openings };
}

/** "bedroom A bed 0" out of "bedA-bed-0", for anything a person has to read. */
export function pieceLabel(suite: Suite, id: string): string {
  const p = /^(.+)-([a-z]+)-(\d+)$/.exec(id);
  if (!p) return id;
  const room = suite.rooms.find((r) => r.id === p[1]);
  return `${room ? room.label : p[1]} ${p[2]} ${p[3]}`;
}

/**
 * A refusal in words, naming what it hit.
 *
 * drag.ts guarantees `against` is non-empty and is always ids, and documents the
 * shape per reason: the overlapped pieces for a collision, the room left for
 * outside-room, and for blocks-door the door followed by the two rooms it joins --
 * which is why that branch reads as a sentence about circulation rather than as a
 * list. Wording it here, once, rather than in the panel, is what keeps the pointer
 * path and the keyboard path saying the same thing about the same refusal.
 */
function wordRefusal(suite: Suite, what: string, r: Extract<DragResult, { ok: false }>): string {
  const name = (id: string) => suite.rooms.find((x) => x.id === id)?.label ?? id;
  if (r.reason === "collision") {
    return `${what} would overlap ${r.against.map((id) => pieceLabel(suite, id)).join(", ")}.`;
  }
  if (r.reason === "outside-room") {
    return `${what} would leave ${name(r.against[0]!)}.`;
  }
  const [door, ...rooms] = r.against;
  const between = rooms.length === 2 ? ` between ${name(rooms[0]!)} and ${name(rooms[1]!)}` : "";
  return `${what} would block the door${between} (${door}).`;
}

/**
 * Whether a params patch describes a suite at all, and what is wrong if not.
 *
 * The four gates are the ones the project already relies on, in the order that puts
 * the cheapest first: a non-positive length, a section past Weld's waist, a room
 * whose extent has gone negative, rooms inside each other, and a room nothing can
 * reach. url.ts's suiteOf() runs the same set on the way in from a link, and the
 * reason it runs in two places is that the two doors are genuinely different: a link
 * is untrusted input and a slider is a person asking a question. What they share is
 * that neither may produce a suite a viewer cannot tell is broken.
 *
 * Returns the message rather than throwing, because the caller's job is to word it
 * and refuse -- not to fail.
 */
function whyIllegal(params: SuiteParams): string | null {
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number" && !(Number.isFinite(v) && v > 0)) {
      return `${k} has to be a positive length.`;
    }
  }
  if (params.sectionLength > MAX_SECTION_LENGTH) {
    return (
      `A ${params.sectionLength.toFixed(1)} ft section is wider than Weld's waist ` +
      `(${MAX_SECTION_LENGTH.toFixed(1)} ft), so the facade would be drawn outside the building.`
    );
  }

  let suite: Suite;
  try {
    suite = buildSuite(params);
  } catch (e) {
    return e instanceof Error ? e.message : "That suite cannot be built.";
  }

  const collapsed = suite.rooms.find((r) => !(r.du > 0) || !(r.dv > 0));
  if (collapsed) return `${collapsed.label} would have no floor left.`;
  const overlap = findOverlaps(suite.rooms)[0];
  if (overlap) {
    const label = (id: string) => suite.rooms.find((r) => r.id === id)?.label ?? id;
    return `${label(overlap[0])} and ${label(overlap[1])} would overlap.`;
  }
  const stranded = unreachableRooms(suite);
  if (stranded.length > 0) {
    const label = (id: string) => suite.rooms.find((r) => r.id === id)?.label ?? id;
    return `${stranded.map(label).join(", ")} could not be reached.`;
  }
  return null;
}

/**
 * The pieces that still stand up in a new suite, and the ones that do not.
 *
 * A slider that shrinks a bedroom under its beds has to either refuse or drop, and
 * say which -- docs/phases/P6.md names silently overlapping furniture as the failure.
 * Dropping is the right half of that choice for a legal suite: refusing would mean a
 * dimension the audit tags INFERRED could not be corrected at all while a bed
 * happened to be standing in the way, which is the opposite of what the sliders are
 * for. The names come back so the notice can say what went.
 *
 * Checked in the same order and by the same function as a drag, placeIsLegal(), so a
 * piece cannot survive a slider into a position the pointer would refuse.
 */
function survivors(params: SuiteParams, pieces: Piece[]): { kept: Piece[]; lost: Piece[] } {
  const suite = buildSuite(params);
  const kept: Piece[] = [];
  const lost: Piece[] = [];
  for (const p of pieces) {
    const room = suite.rooms.find((r) => r.id === p.room);
    if (room && placeIsLegal(pieceBox(p), room, kept.filter((q) => q.room === p.room).map(pieceBox)).ok) {
      kept.push(p);
    } else {
      lost.push(p);
    }
  }
  return { kept, lost };
}

export const useStore = create<Store>((set, get) => ({
  stage: 0,
  t: 0,
  params: DEFAULT_PARAMS,
  reducedMotion: false,
  date: DEFAULT_DATE,
  hour: DEFAULT_HOUR,
  orbit: null,
  cutaway: "none",
  pieces: DEFAULT_SNAPSHOT.pieces,
  occupancy: DEFAULT_OCCUPANCY,
  selected: null,
  notice: null,

  setStage: (stage) => set({ stage, t: 0 }),
  setT: (t) => set({ t: Math.min(1, Math.max(0, t)) }),
  next: () => set((s) => ({ stage: Math.min(LAST_STAGE, s.stage + 1) as StageId, t: 0 })),
  prev: () => set((s) => ({ stage: Math.max(0, s.stage - 1) as StageId, t: 0 })),
  skipToSuite: () => set({ stage: LAST_STAGE, t: 1 }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  /**
   * Move a dimension, and answer for the furniture standing on it.
   *
   * Three outcomes, and the middle one is the whole point of the phase:
   *   refused  the patch does not describe a suite. Nothing changes and the notice
   *            says what would have been wrong. A viewer cannot tell a broken model
   *            from a correct one by looking, so it must not be rendered at all.
   *   dropped  the suite is legal but some piece no longer fits in it. The params
   *            move, the piece goes, and the notice names it.
   *   clean    the params move.
   *
   * The selection is cleared when what it pointed at has gone, because a panel
   * offering to rotate a piece that is no longer in the room is worse than no panel.
   */
  setParams: (p) => {
    const s = get();
    const params = { ...s.params, ...p };
    const bad = whyIllegal(params);
    if (bad) {
      set({ notice: `Refused: ${bad}` });
      return;
    }
    const { kept, lost } = survivors(params, s.pieces);
    const suite = buildSuite(params);
    set({
      params,
      pieces: kept,
      selected: s.selected && kept.some((q) => q.id === s.selected) ? s.selected : null,
      notice:
        lost.length === 0
          ? null
          : `${lost.map((q) => pieceLabel(suite, q.id)).join(", ")} no longer ` +
            `${lost.length === 1 ? "fits" : "fit"} and ${lost.length === 1 ? "was" : "were"} removed.`,
    });
  },
  setDate: (date) => set({ date }),
  // Clamped like setT, and to 24 rather than 23: the top of the range is midnight
  // at the end of the day, which is a real reading of the clock and the one hour a
  // 0..23 range cannot express.
  setHour: (hour) => set({ hour: Math.min(24, Math.max(0, hour)) }),
  // Deliberately NOT clamped here. clampOrbit lives in orbit.ts, which this module
  // cannot import at runtime for the reason given on `orbit` above, and a second
  // implementation of the clamp is exactly the drift the clamp exists to stop.
  // CameraRig passes every value through clampOrbit before it arrives.
  setOrbit: (orbit) => set({ orbit }),
  // Validated rather than trusted: this is reached from a URL as well as from a
  // button, and pick() in url.ts guards the wire format but not a later caller.
  setCutaway: (cutaway) =>
    set(CUTAWAY_MODES.includes(cutaway) ? { cutaway } : { notice: `No cutaway mode ${cutaway}.` }),

  // Clamped, and NOT applied to the arrangement here. An occupancy that took effect
  // immediately would silently undo every drag in both bedrooms the moment somebody
  // asked what three students would look like; refit() is the explicit act.
  setOccupancy: (n) =>
    set({
      occupancy: Math.min(OCCUPANCY_RANGE.max, Math.max(OCCUPANCY_RANGE.min, Math.round(n))),
    }),
  select: (selected) => set({ selected }),
  setNotice: (notice) => set({ notice }),

  commit: (id, r) => {
    const s = get();
    if (r.ok) {
      set({
        pieces: s.pieces.map((p) => (p.id === id ? r.piece : p)),
        selected: id,
        notice: null,
      });
      return;
    }
    const suite = buildSuite(s.params);
    set({ notice: wordRefusal(suite, pieceLabel(suite, id), r) });
  },

  rotate: (id) => {
    const s = get();
    const piece = s.pieces.find((p) => p.id === id);
    if (!piece) return;
    get().commit(id, tryRotate(piece, ctxOf(s.params, s.pieces)));
  },

  nudge: (id, dir) => {
    const s = get();
    const piece = s.pieces.find((p) => p.id === id);
    if (!piece) return;
    get().commit(id, nudgePiece(piece, dir, ctxOf(s.params, s.pieces)));
  },

  /**
   * Re-run layout() at the current params and bed count.
   *
   * Not snapped onto url.ts's one-inch lattice, deliberately: layout()'s own output
   * is what the recipes produce, and ten of the 29 anchors are legitimately off any
   * coarse lattice because they come from an 82 in bed frame and a chair centred on a
   * 4 ft desk. url.ts rounds on the way out and documents what that costs -- at most
   * half an inch, and 3.6e-15 ft on the shipped fit-out -- which is the right place
   * for it. Snapping here would move real furniture to make a serialiser tidier.
   */
  refit: () => {
    const s = get();
    set({
      pieces: layout(buildSuite(s.params), { beds: s.occupancy }),
      selected: null,
      notice: `Re-fitted for ${s.occupancy} student${s.occupancy === 1 ? "" : "s"}.`,
    });
  },

  resetAll: () =>
    set({
      params: DEFAULT_PARAMS,
      pieces: DEFAULT_SNAPSHOT.pieces,
      occupancy: DEFAULT_OCCUPANCY,
      cutaway: "none",
      date: DEFAULT_DATE,
      hour: DEFAULT_HOUR,
      orbit: null,
      selected: null,
      notice: "Back to the sourced dimensions and the shipped fit-out.",
    }),

  /**
   * The URL's boot path: eight fields at once, no validation.
   *
   * No validation because decode() has already run all of it -- the same suite gates
   * whyIllegal() runs, plus placeIsLegal() per piece -- and re-checking here would be
   * a second implementation of a contract that is already property-tested. What this
   * must NOT touch is reducedMotion: it comes from the recipient's own media query,
   * and url.ts refuses to carry it for the same reason.
   */
  hydrate: (s) =>
    set({
      stage: s.stage,
      t: s.t,
      params: s.params,
      pieces: s.pieces,
      cutaway: s.cutaway,
      hour: s.hour,
      date: s.date,
      orbit: s.orbit,
      selected: null,
      notice: null,
    }),
}));
