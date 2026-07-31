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
// Value imports of two more scene modules, on the same footing as cutaway.ts above:
// walk.ts and route.ts are deliberately three-free and say so in their headers, so this
// does not drag the renderer into the state layer -- tests/place.test.ts walks the real
// import graph and would fail if it did.
import { insideSuite, isClear, walkContext, RADIUS, type WalkState } from "@/scene/walk";
import { places, standIn } from "@/scene/route";
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
 * Where the fly-down stops.
 *
 * STAGE 3 AND NOT STAGE 5, which is P9.md section 8's third open question answered as it
 * proposed. The threshold is the payoff of the whole piece and walking through a wall should be
 * something the viewer does, not something that happens to them while they watch. Stopping at
 * Weld Hall also leaves the camera somewhere with a control -- stage 3 is the free orbit -- so
 * the flight ends by handing over rather than by stopping dead.
 *
 * Lives here rather than in stages.ts because stages.ts imports StageId from this module and
 * the reverse import would be a real cycle. It is a policy about stages, which is this file's
 * subject anyway.
 */
export const FLY_DOWN_END: StageId = 3;

/**
 * Where the viewer is standing, in the suite's own frame, while first person is on.
 *
 * walk.ts's WalkState -- a position and a bearing -- plus the room the position falls in.
 * The room is carried rather than recomputed by every reader because roomAt() needs a
 * WalkCtx and building one walks a grid: FirstPerson.tsx holds the only context in the
 * app and writes the answer here, so the HUD and its live region get "which room am I
 * in" for a field read. Null in a doorway, which is roomAt()'s own answer there and not
 * a missing value.
 */
export type FirstPerson = WalkState & { room: string | null };

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
  /**
   * Progress within the current stage, 0..1.
   *
   * USED BY FOUR STAGES SINCE P9, not one. It read "only stage 4 uses it" when stage 4's
   * threshold was the only stage that travelled rather than sat; the descent from orbit is now
   * a flight too, so stages 0, 1 and 2 carry paths and scrub on this same number. Stages 3 and
   * 5 are still places and ignore it. stages.ts cameraKeyframe() is where that is decided, and
   * it decides it by asking whether the stage has a path rather than by naming stages.
   *
   * Already in the wire format for every stage: url.ts:184-185 encodes it in thousandths
   * unconditionally and :560 range-checks it 0..1, so giving three more stages a path cost no
   * format change and no VERSION bump.
   */
  t: number;
  params: SuiteParams;
  /** Set once from the media query; a branch, not a duration. */
  reducedMotion: boolean;

  /**
   * The high-contrast rendering flag: thicker campus strokes, denser building masses.
   *
   * ON THE SAME FOOTING AS `reducedMotion`, and that is the whole design of the field.
   * It is seeded from `prefers-contrast: more` -- the platform signal, so a viewer who has
   * already told their OS does not have to find a button -- and it is NOT carried by a
   * link and NOT reset by resetAll(), for the reason url.ts gives about reducedMotion: it
   * is the recipient's own accessibility preference, not part of the model somebody
   * shared. hydrate() therefore leaves it alone, exactly as it leaves reducedMotion alone.
   *
   * WHERE IT DIFFERS: reducedMotion has no control, so nothing can disagree with the
   * media query. This one has a button in the HUD, which is what MASTER.md asks for, so
   * the seed is a default rather than a mirror -- Hud.tsx owns that distinction and
   * records how it keeps the two from fighting.
   *
   * The two values it changes are MASTER.md's, not this file's: strokes to 2.5 CSS px and
   * the mass fill to 0.22. Campus.tsx honours them and publishes what it used.
   */
  highContrast: boolean;

  /**
   * Whether the automatic descent is running.
   *
   * NOT CARRIED BY A LINK, on the same argument `selected` and `firstPerson` are not: a link is
   * a place, and "currently moving" is not a place. A recipient of a shared URL should arrive at
   * the stop, not two seconds into a flight toward it.
   */
  flying: boolean;

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

  /**
   * The viewer's own position and bearing while first person is on, or null when it is
   * off. Null is the whole switch: there is no separate boolean to disagree with it.
   *
   * WRITTEN PER FRAME, by FirstPerson.tsx, and only while a key is actually down -- see
   * setWalk(). The alternative was a ref shared between FirstPerson and CameraRig, and it
   * was refused for the reason `pieces` is state rather than a function of the params: a
   * position nothing can observe is a position no gate can assert on and no live region
   * can announce. The publish cost is UrlSync's, measured there at under 2 ns, and
   * `firstPerson` is deliberately absent from url.ts's key() so no walk rewrites the
   * address bar sixty times a second.
   *
   * NOT CARRIED BY A LINK, for the reason `selected` is not: it is where the recipient is
   * standing, not what the model is.
   */
  firstPerson: FirstPerson | null;

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
  /**
   * Start or stop the fly-down: the automatic descent from wherever the camera is to
   * FLY_DOWN_END.
   *
   * A single boolean rather than a duration or a target, because the animation itself lives in
   * FlyDown.tsx where there is a frame loop to run it on. This is the switch, and every control
   * that could contradict it turns it off -- see the actions below.
   */
  setFlying: (v: boolean) => void;
  /**
   * The flight's own stage advance: on to the next stop, and stop flying at FLY_DOWN_END.
   *
   * Separate from setStage() because setStage() CANCELS the flight -- it is what a viewer
   * pressing a stage button calls, and that has to win. The flight needs the same stage
   * transition without the cancellation, and expressing that as "setStage then setFlying(true)"
   * would mean the flag was briefly false, which is exactly the sort of one-frame inconsistency
   * that turns into a flight that stutters at every stage boundary.
   */
  flyStep: () => void;
  setReducedMotion: (v: boolean) => void;
  setHighContrast: (v: boolean) => void;
  setParams: (p: Partial<SuiteParams>) => void;
  setDate: (d: string) => void;
  setHour: (h: number) => void;
  setOrbit: (o: Orbit | null) => void;
  setCutaway: (v: CutawayMode) => void;

  setOccupancy: (n: number) => void;
  select: (id: string | null) => void;
  setNotice: (m: string | null) => void;

  /** Stand up in the suite: seed the walker at the hall, or say why nobody can. */
  enterFirstPerson: () => void;
  /** Put the camera back on the stage's own keyframe. Escape's handler, and a button's. */
  leaveFirstPerson: () => void;
  /** One frame of walking, from FirstPerson.tsx. */
  setWalk: (s: FirstPerson) => void;
  /** Jump-cut to a named room. The reduced-motion form of walking there. */
  goToPlace: (roomId: string) => void;

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
    occupancy: number;
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

/**
 * Which way to face on arriving in a room, as a suite-frame bearing.
 *
 * ONE RULE RATHER THAN A TABLE: along the room's longer axis, toward its low end. A
 * rectangle's long axis is the direction that has something to show, and the low end is
 * where the rest of the suite is -- u = 0 is the window wall and v = 0 is the stair-hall
 * end. Measured against the seven rooms as shipped, that lands: bedroom A, bedroom B and
 * the common room facing their own facade windows; the hall facing south down its 28.5 ft
 * toward the suite entry, which is the same direction stages.ts aims the stage-5 shot; K
 * and the bathroom, neither of which has a window, facing their own long walls.
 *
 * A table of seven headings would read better in two of those cases and would be seven
 * more numbers to keep in step with the sliders, since a slider can turn a room's long
 * axis through 90 degrees -- bedDepth 8 makes bedroom A wider along the hall than deep.
 *
 * heading 0 faces +v and positive turns toward +u (walk.ts), so -pi/2 faces -u and pi
 * faces -v.
 */
function arrivalHeading(room: { du: number; dv: number }): number {
  return room.du >= room.dv ? -Math.PI / 2 : Math.PI;
}

/**
 * A refusal in words for a suite nobody can stand up in.
 *
 * A slider can shrink a room below the walker's own diameter, and walk.ts is explicit
 * about what happens then: step() returns the same position forever rather than escaping,
 * because there is no clear position to escape to. That has to be SAID rather than
 * presented as a camera that will not move -- which is indistinguishable from a bug.
 */
function noRoomToStand(what: string): string {
  return (
    `${what} is narrower than the ${(2 * RADIUS).toFixed(1)} ft a standing viewer takes up, ` +
    `so there is nowhere in it to stand. Widen a dimension and try again.`
  );
}

export const useStore = create<Store>((set, get) => ({
  stage: 0,
  t: 0,
  params: DEFAULT_PARAMS,
  reducedMotion: false,
  highContrast: false,
  flying: false,
  date: DEFAULT_DATE,
  hour: DEFAULT_HOUR,
  orbit: null,
  cutaway: "none",
  pieces: DEFAULT_SNAPSHOT.pieces,
  occupancy: DEFAULT_OCCUPANCY,
  firstPerson: null,
  selected: null,
  notice: null,

  // Every stage change drops the walker, and that is not tidiness. First person replaces
  // the stage's camera, so a walker surviving a jump to stage 2 would be a viewer standing
  // in a bedroom while the HUD said "Harvard Yard" -- and the control that leaves it is
  // only mounted at the last stage, so it would be unreachable as well as wrong.
  // EVERY ONE OF THESE CANCELS THE FLY-DOWN, and that is the whole cancellation story rather
  // than a listener somewhere. The flight is a thing the app is doing to the camera; any
  // deliberate act by the viewer that also moves the camera has to win, or the two fight and
  // the fly-down appears to drag the viewer back. Picking a stage, stepping, skipping to the
  // suite and entering first person all qualify. setT does NOT -- see its own note.
  setStage: (stage) => set({ stage, t: 0, firstPerson: null, flying: false }),
  /**
   * Scrub within a stage.
   *
   * Does NOT cancel the flight, because the flight's own animation is written through this
   * action -- cancelling here would stop it on its first frame. The scrubber in the HUD calls
   * cancelFlight() itself before scrubbing, which is the honest place for it: the slider is the
   * viewer's hand on the same control the animation is using, and only the caller can tell the
   * two apart.
   */
  setT: (t) => set({ t: Math.min(1, Math.max(0, t)) }),
  next: () =>
    set((s) => ({
      stage: Math.min(LAST_STAGE, s.stage + 1) as StageId,
      t: 0,
      firstPerson: null,
      flying: false,
    })),
  prev: () =>
    set((s) => ({
      stage: Math.max(0, s.stage - 1) as StageId,
      t: 0,
      firstPerson: null,
      flying: false,
    })),
  skipToSuite: () => set({ stage: LAST_STAGE, t: 1, firstPerson: null, flying: false }),
  setFlying: (flying) => set({ flying }),
  flyStep: () =>
    set((s) => {
      const next = Math.min(FLY_DOWN_END, s.stage + 1) as StageId;
      return { stage: next, t: 0, firstPerson: null, flying: next < FLY_DOWN_END };
    }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  // No validation and no notice: it is a boolean with one writer, and unlike setCutaway
  // it is not reachable from a URL -- see the field above for why a link cannot carry it.
  setHighContrast: (highContrast) => set({ highContrast }),
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
    /**
     * The VIEWER is furniture too, for this one purpose.
     *
     * A dimension slider can close a wall onto the position somebody is standing at, and
     * walk.ts is explicit about the consequence: from a position that is not clear, step()
     * returns where it started, every frame, forever. So the walker is checked against the
     * new suite exactly as the pieces are, and dropped with a sentence rather than left
     * wedged -- the same choice, and for the same reason, as the pieces above: refusing
     * the slider would mean a dimension the audit tags INFERRED could not be corrected
     * while somebody happened to be standing in the way.
     *
     * The context is built only when there is a walker to check, because this runs on
     * every pointer move of every one of the fifteen sliders.
     */
    const wedged =
      s.firstPerson !== null &&
      !(() => {
        const ctx = walkContext(suite);
        return insideSuite(s.firstPerson!.p, ctx) && isClear(s.firstPerson!.p, ctx);
      })();
    const dropped =
      lost.length === 0
        ? null
        : `${lost.map((q) => pieceLabel(suite, q.id)).join(", ")} no longer ` +
          `${lost.length === 1 ? "fits" : "fit"} and ${lost.length === 1 ? "was" : "were"} removed.`;
    const stood = wedged
      ? "A wall closed onto where you were standing, so first person is off."
      : null;
    set({
      params,
      pieces: kept,
      firstPerson: wedged ? null : s.firstPerson,
      selected: s.selected && kept.some((q) => q.id === s.selected) ? s.selected : null,
      notice: [dropped, stood].filter((x) => x !== null).join(" ") || null,
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

  /**
   * Stand up in the suite.
   *
   * SEEDED FROM places(), HUB FIRST, AND CHECKED BEFORE THE FIRST FRAME. There is no
   * spawn() in walk.ts and step()'s guarantee is conditional on starting from a clear
   * position, so a seed has to be verified rather than assumed -- and a dimension slider
   * can leave the hall narrower than the walker is wide. places() already returns the
   * reachable rooms with the hall first, which is exactly the order to try: the hall is
   * what every room here is entered from, and any other reachable room is a worse but
   * usable place to begin.
   *
   * If none of them has room, this REFUSES and says so, rather than seeding somewhere
   * wedged and leaving the viewer with a camera that will not move.
   *
   * The selection is dropped because the arrow keys change hands: Hud.tsx gives them to
   * the walker while first person is on, so a piece left selected would be a piece whose
   * keyboard controls have silently stopped working.
   */
  enterFirstPerson: () => {
    const s = get();
    const suite = buildSuite(s.params);
    const ctx = walkContext(suite);
    for (const spot of places(suite)) {
      if (!isClear(spot.p, ctx)) continue;
      const room = suite.rooms.find((r) => r.id === spot.id)!;
      set({
        firstPerson: { p: spot.p, heading: arrivalHeading(room), room: spot.id },
        selected: null,
        // Walking and flying both own the camera. FirstPerson.tsx writes the walker and
        // CameraRig copies it, so a fly-down still advancing t underneath would be invisible
        // until the viewer pressed Escape and was then somewhere else entirely.
        flying: false,
        notice: `Standing in ${room.label}. W, A, S and D to walk; Escape to stop.`,
      });
      return;
    }
    set({ notice: `Refused: ${noRoomToStand("Every room in this suite")}` });
  },

  leaveFirstPerson: () => set({ firstPerson: null, notice: null }),

  // No clamping, no validation, and no recomputation of the room: this is the frame path,
  // and FirstPerson.tsx has the WalkCtx that walk() and roomAt() were both answered
  // against. A second opinion here would be a second WalkCtx per frame, which walk.ts's
  // header exists to forbid.
  setWalk: (firstPerson) => set({ firstPerson }),

  /**
   * Jump-cut to a named room.
   *
   * THIS IS THE REDUCED-MOTION ALTERNATIVE, and route.ts says so: places() returns named
   * destinations, hall first, for exactly this. MASTER.md asks for a real alternative
   * rather than nothing wherever an animation is switched off, and the alternative to
   * walking somewhere is arriving there -- one instantaneous change of position, which is
   * the same shape CameraRig's reduced branch and stages.ts's REDUCED_CUT already take.
   *
   * It is not gated on the media query. A jump to a named room is faster and more precise
   * than walking for everybody, it is the only way to cross the suite without a pointer,
   * and a control that appears only for readers who set a preference is a control nobody
   * tests. What reduced motion changes is which of the two the HUD offers first.
   */
  goToPlace: (roomId) => {
    const s = get();
    const suite = buildSuite(s.params);
    const room = suite.rooms.find((r) => r.id === roomId);
    if (!room) {
      set({ notice: `Refused: this suite has no room called ${roomId}.` });
      return;
    }
    const p = standIn(room);
    if (!isClear(p, walkContext(suite))) {
      set({ notice: `Refused: ${noRoomToStand(room.label)}` });
      return;
    }
    set({
      firstPerson: { p, heading: arrivalHeading(room), room: roomId },
      selected: null,
      notice: `Standing in ${room.label}.`,
    });
  },

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

  // reducedMotion and highContrast are absent for the reason hydrate() gives below: they
  // are the reader's own accessibility preferences, and a button labelled "start over"
  // that switched somebody's high contrast back off would be the app overruling them.
  resetAll: () =>
    set({
      params: DEFAULT_PARAMS,
      pieces: DEFAULT_SNAPSHOT.pieces,
      occupancy: DEFAULT_OCCUPANCY,
      cutaway: "none",
      date: DEFAULT_DATE,
      hour: DEFAULT_HOUR,
      orbit: null,
      firstPerson: null,
      selected: null,
      notice: "Back to the sourced dimensions and the shipped fit-out.",
    }),

  /**
   * The URL's boot path: eight fields at once, no validation.
   *
   * No validation because decode() has already run all of it -- the same suite gates
   * whyIllegal() runs, plus placeIsLegal() per piece -- and re-checking here would be
   * a second implementation of a contract that is already property-tested. What this
   * must NOT touch is reducedMotion -- or highContrast, which arrived later on exactly
   * the same footing: both come from the recipient's own media query, and url.ts refuses
   * to carry either for the same reason. Neither is in the parameter list, so this is a
   * property of the signature and not of a line below.
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
      // Set, NOT re-fitted. `pieces` above is the sender's actual arrangement and it
      // arrives whole; running layout() at this occupancy instead would throw away
      // every piece they moved. So the two arrive independently, exactly as they sat
      // in the sender's own store -- which is also why setOccupancy does not re-fit.
      occupancy: s.occupancy,
      // Cleared for the reason `selected` is: a link carries the model, not where the
      // recipient is standing in it. url.ts does not encode either field. `flying` joins them:
      // a link is a place, and "currently moving" is not one.
      firstPerson: null,
      selected: null,
      flying: false,
      notice: null,
    }),
}));
