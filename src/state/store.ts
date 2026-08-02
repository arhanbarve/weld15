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
import { HUB, places, standingPose } from "@/scene/route";
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
 * The free orbit's pose at stage 3 or 4, as heading/pitch/range -- GeoPose's own field
 * names (docs/phases/P11-PHOTOREAL.md section 2.3, src/scene/geo/rig.ts), because the
 * camera rig this store feeds is being rebuilt on lat/lon/heading/pitch/range rather
 * than the old azimuth/polar/radius spherical coordinates. `pitchDeg` is `90 -
 * polarDeg` and `headingDeg` is the same compass-bearing-off-north convention
 * `azimuthDeg` already used, so nothing about WHAT the three numbers mean changes,
 * only their names and the sign convention of the vertical one.
 *
 * Declared locally rather than imported from scene/orbit.ts's `Orbit`: that module's
 * type is still the OLD shape, read by CameraRig.tsx and Hud.tsx until a later task
 * moves them onto the geodetic rig.
 */
export type Orbit = { headingDeg: number; pitchDeg: number; rangeFt: number };

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
   * Whether the browser has granted pointer lock on the canvas.
   *
   * A FACT ABOUT THE BROWSER'S OWN INPUT STATE, on the same footing as `reducedMotion`:
   * neither has a "share this" reading, so both are ABSENT from url.ts's wire format,
   * from hydrate()'s parameter list, and from resetAll() -- a recipient of a link is not
   * sent mid-drag into somebody else's mouse capture, any more than they are handed
   * somebody else's OS preference.
   *
   * FirstPerson.tsx is this field's only writer, from `pointerlockchange`; Experience.tsx
   * is its only reader, deciding whether the pointer belongs to furniture or to the
   * walker's look.
   */
  pointerLocked: boolean;

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
   * The free orbit at stage 3 OR stage 4, or null while the camera still sits
   * where stages.ts put it.
   *
   * Null rather than a seeded Orbit because the seed is `orbitOf(keyframes[3])`
   * (or the stage-4 equivalent) and this module cannot compute it: stages.ts
   * imports StageId from here, so importing stages.ts back would be a real
   * cycle. Writing the seed out as three literals instead would be a second copy of a
   * derived number, and the first drag would jerk the camera the moment the
   * two disagreed. CameraRig resolves the null.
   */
  orbit: Orbit | null;
  /**
   * Which of stage 3 or stage 4 `orbit` was set at, or null when `orbit` is.
   *
   * THE REASON THIS FIELD EXISTS AT ALL. `orbit`'s three numbers mean something
   * different depending on which stage set them: stage 3's orbit is about
   * kf[3].target = [0, 42, 0], stage 4's is about MASSING_CENTER (see
   * orbit.ts's stage4OrbitKeyframe). The same numeric orbit applied at the
   * OTHER stage is not a stale pose, it is a WRONG one -- a valid-looking
   * camera position about the wrong pivot. `orbitStage` is what lets a stage
   * change tell "returning to the stage this orbit belongs to" (keep it) from
   * "arriving somewhere else that would misread it" (clear it), in either
   * direction, including a jump that skips the stage the orbit was set at
   * entirely -- see clearWrongOrbit() below, which every stage-changing
   * action routes through.
   */
  orbitStage: StageId | null;

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

  /**
   * How many CUTS have happened. A counter, not a boolean, and not the stage.
   *
   * CameraRig un-settles on this rather than on `stage`, and that one change is what deletes
   * every boundary jump in the descent. The poses either side of a stage boundary are already
   * identical -- descentPath() pins each leg's last stop to the next stage's keyframe OBJECT
   * -- so the jump was never geometry. It was `settled.current = false` firing on a stage
   * change and making the next frame COPY the new pose instead of easing into it.
   *
   * Bumped by the five actions that are genuinely a jump: setStage, next, prev, skipToSuite,
   * and entering or leaving first person. NOT bumped by setT, setJourney or flyStep -- those
   * three are continuous motion, and flyStep's exclusion is precisely what turns the
   * fly-down from three moves with two pops into one nine-second descent.
   */
  cuts: number;

  /**
   * Whether a pointer is currently down on the master scrubber.
   *
   * CameraRig copies rather than eases while this is true, on the same argument it copies for
   * the walker: a dragged control must track the hand. The exponential approach at k = 3.2/s
   * lags by about 0.3 s, which on a scrubber reads as the camera fighting the slider.
   *
   * A separate flag rather than inferring it from rapid setJourney calls, because "rapid" is
   * a guess about event rates and pointerdown/pointerup are facts.
   */
  scrubbing: boolean;

  setStage: (s: StageId) => void;
  setT: (t: number) => void;
  /** Stage and t together, with no cut and no reset. The master scrubber's only writer. */
  setJourney: (stage: StageId, t: number) => void;
  setScrubbing: (v: boolean) => void;
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
  /** Set from `pointerlockchange`. See `pointerLocked` above for why it lives nowhere else. */
  setPointerLocked: (v: boolean) => void;
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
  /** One frame of walking, from FirstPerson.tsx. */
  setWalk: (s: FirstPerson) => void;

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

/**
 * `orbit`/`orbitStage`, carried over unchanged unless the stage being
 * arrived at is 3 or 4 and disagrees with the stage the orbit was set at --
 * see `orbitStage`'s own comment for why that specific mismatch is a wrong
 * pose rather than a stale one. Every stage-changing action spreads this in.
 *
 * Arriving at a stage OTHER than 3 or 4 never clears anything, which is what
 * keeps today's behaviour for every other transition: leaving stage 3 for
 * stage 2 and returning still finds the same orbit there, because at no
 * point did a stage 3-anchored orbit get read as a stage 4 one, or the
 * reverse.
 */
function orbitAfterStage(
  s: { orbit: Orbit | null; orbitStage: StageId | null },
  newStage: StageId,
): { orbit: Orbit | null; orbitStage: StageId | null } {
  if ((newStage === 3 || newStage === 4) && s.orbitStage !== null && s.orbitStage !== newStage) {
    return { orbit: null, orbitStage: null };
  }
  return { orbit: s.orbit, orbitStage: s.orbitStage };
}

/**
 * The verified seed for standing at a given stage, or null.
 *
 * ONE IMPLEMENTATION FOR TWO CALLERS THAT MUST NOT DISAGREE: `enterFirstPerson()` below is
 * a thin wrapper over this, and so is every place a stage transition used to write
 * `firstPerson: null`. Writing the seed loop twice -- once for the button, once for the
 * seven transitions -- is exactly the kind of drift this file's own DragResult comment
 * warns about elsewhere: two computations of one answer, and no guarantee they agree.
 *
 * Null for every stage but LAST_STAGE, because standing is a property of being at stage 5
 * and not a thing any other stage has. Where it IS stage 5, this is `enterFirstPerson()`'s
 * own seed loop: `places()`, hall first, checked with `isClear()` against the first
 * unwedged spot, with `standingPose()`'s heading and pitch in the hub so arrival matches
 * the stage-5 shot exactly (D3) and `arrivalHeading(room)` with the same pitch for the
 * fall-through rooms. Null again if nothing in the suite is standable.
 */
function walkerFor(stage: StageId, params: SuiteParams): FirstPerson | null {
  if (stage !== LAST_STAGE) return null;
  const suite = buildSuite(params);
  const ctx = walkContext(suite);
  const pose = standingPose(suite);
  for (const spot of places(suite)) {
    if (!isClear(spot.p, ctx)) continue;
    const room = suite.rooms.find((r) => r.id === spot.id)!;
    return {
      p: spot.p,
      heading: spot.id === HUB ? pose.heading : arrivalHeading(room),
      pitch: pose.pitch,
      room: spot.id,
    };
  }
  return null;
}

export const useStore = create<Store>((set, get) => ({
  stage: 0,
  t: 0,
  params: DEFAULT_PARAMS,
  reducedMotion: false,
  highContrast: false,
  pointerLocked: false,
  flying: false,
  date: DEFAULT_DATE,
  hour: DEFAULT_HOUR,
  orbit: null,
  orbitStage: null,
  cutaway: "none",
  pieces: DEFAULT_SNAPSHOT.pieces,
  occupancy: DEFAULT_OCCUPANCY,
  firstPerson: null,
  selected: null,
  notice: null,
  cuts: 0,
  scrubbing: false,

  // A STAGE CHANGE NO LONGER DESTROYS THE WALKER, IT DECIDES WHETHER THERE IS ONE.
  // First person replaces the stage's camera, so a walker surviving a jump to stage 2 would
  // be a viewer standing in a bedroom while the HUD said "Harvard Yard" -- walkerFor() nulls
  // it off stage 5 for exactly that reason. What is new is arrival: landing ON stage 5, by
  // any of the seven paths below, now seeds a walker instead of leaving the field null until
  // a control was pressed, because standing is a property of being at stage 5 and not a mode
  // entered separately.
  // EVERY ONE OF THESE CANCELS THE FLY-DOWN, and that is the whole cancellation story rather
  // than a listener somewhere. The flight is a thing the app is doing to the camera; any
  // deliberate act by the viewer that also moves the camera has to win, or the two fight and
  // the fly-down appears to drag the viewer back. Picking a stage, stepping, skipping to the
  // suite and entering first person all qualify. setT does NOT -- see its own note.
  setStage: (stage) =>
    set((s) => ({
      stage,
      t: 0,
      firstPerson: walkerFor(stage, s.params),
      flying: false,
      cuts: s.cuts + 1,
      ...orbitAfterStage(s, stage),
    })),
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
  setJourney: (stage, t) =>
    // NOT setStage-then-setT: setStage resets t to 0 and cancels the flight, and a scrubber
    // that reset the very number it is writing would snap to the start of each leg as it
    // crossed into it. One set(), so no render ever sees the half-applied pair.
    set((s) => ({
      stage,
      t: Math.min(1, Math.max(0, t)),
      // walkerFor(), NOT null. MERGE NOTE: setJourney is p10-ux's and predates p10-walk-in's
      // rule that standing is a property of being at stage 5, so it still wrote `null` here.
      // Scrubbing the master bar to the far end lands ON stage 5 and is one of the seven
      // arrivals that rule covers; leaving it null is the one path that would put a viewer in
      // the hall with no walker and nothing to move.
      firstPerson: walkerFor(stage, s.params),
      flying: false,
      ...orbitAfterStage(s, stage),
    })),
  setScrubbing: (scrubbing) => set({ scrubbing }),
  next: () =>
    set((s) => {
      const stage = Math.min(LAST_STAGE, s.stage + 1) as StageId;
      return {
        stage,
        t: 0,
        firstPerson: walkerFor(stage, s.params),
        flying: false,
        cuts: s.cuts + 1,
        ...orbitAfterStage(s, stage),
      };
    }),
  prev: () =>
    set((s) => {
      const stage = Math.max(0, s.stage - 1) as StageId;
      return {
        stage,
        t: 0,
        firstPerson: walkerFor(stage, s.params),
        flying: false,
        cuts: s.cuts + 1,
        ...orbitAfterStage(s, stage),
      };
    }),
  skipToSuite: () =>
    set((s) => ({
      stage: LAST_STAGE,
      t: 1,
      firstPerson: walkerFor(LAST_STAGE, s.params),
      flying: false,
      cuts: s.cuts + 1,
      ...orbitAfterStage(s, LAST_STAGE),
    })),
  setFlying: (flying) => set({ flying }),
  flyStep: () =>
    set((s) => {
      const next = Math.min(FLY_DOWN_END, s.stage + 1) as StageId;
      return { stage: next, t: 0, firstPerson: walkerFor(next, s.params), flying: next < FLY_DOWN_END };
    }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  // No validation and no notice: it is a boolean with one writer, and unlike setCutaway
  // it is not reachable from a URL -- see the field above for why a link cannot carry it.
  setHighContrast: (highContrast) => set({ highContrast }),
  // Same footing as setHighContrast just above: one writer, no validation, no notice, and
  // not reachable from a URL -- see `pointerLocked`'s own docblock for why.
  setPointerLocked: (pointerLocked) => set({ pointerLocked }),
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
     * new suite exactly as the pieces are, and RE-SEEDED with a sentence rather than left
     * wedged -- walkerFor() is the same verified-seed loop enterFirstPerson() uses, so a
     * slider that closes one room does not strand the viewer as long as another room in
     * the suite is still standable. Only when nothing is does this fall back to the
     * existing refusal wording and a null walker -- the same choice, and for the same
     * reason, as the pieces above: refusing the slider itself would mean a dimension the
     * audit tags INFERRED could not be corrected while somebody happened to be standing in
     * the way.
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
    const reseed = wedged ? walkerFor(LAST_STAGE, params) : null;
    const dropped =
      lost.length === 0
        ? null
        : `${lost.map((q) => pieceLabel(suite, q.id)).join(", ")} no longer ` +
          `${lost.length === 1 ? "fits" : "fit"} and ${lost.length === 1 ? "was" : "were"} removed.`;
    const stood = !wedged
      ? null
      : reseed
        ? `A wall closed onto where you were standing, so you were moved to ` +
          `${suite.rooms.find((r) => r.id === reseed.room)?.label ?? "another room"}.`
        : `Refused: ${noRoomToStand("Every room in this suite")}`;
    set({
      params,
      pieces: kept,
      firstPerson: wedged ? reseed : s.firstPerson,
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
  setOrbit: (orbit) => set((s) => ({ orbit, orbitStage: orbit ? s.stage : null })),
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
   * A THIN WRAPPER OVER walkerFor(), which is the seeded-and-verified loop this shares
   * with every stage transition below -- there is no spawn() in walk.ts and step()'s
   * guarantee is conditional on starting from a clear position, so a seed has to be
   * verified rather than assumed, and a dimension slider can leave the hall narrower than
   * the walker is wide. What this adds over walkerFor() is the two things only a caller
   * asking on purpose needs: a refusal written in words when nothing in the suite is
   * standable, and dropping the selection, because the arrow keys change hands -- Hud.tsx
   * gives them to the walker while first person is on, so a piece left selected would be a
   * piece whose keyboard controls have silently stopped working.
   *
   * NO NOTICE ON SUCCESS (D7). The keys are written down in the HUD row already; a toast
   * on every arrival at stage 5 -- every stage change, every `]`, every link opened there
   * -- would be noise, not news.
   */
  enterFirstPerson: () => {
    const s = get();
    const seed = walkerFor(LAST_STAGE, s.params);
    if (!seed) {
      set({ notice: `Refused: ${noRoomToStand("Every room in this suite")}` });
      return;
    }
    set({
      firstPerson: seed,
      selected: null,
      // Walking and flying both own the camera. FirstPerson.tsx writes the walker and
      // CameraRig copies it, so two things must not own the camera at once.
      flying: false,
      // The cut counter, kept from p10-ux. Whoever owns the camera changing IS a cut, and
      // CameraRig's un-settle effect watches `cuts` since the master scrubber arrived. It also
      // watches `walking`, so this is belt and braces rather than the only signal -- but the
      // invariant journey-continuity.spec.ts asserts is "every camera jump bumps `cuts`", and
      // an action that hands the camera to the walker is one.
      cuts: s.cuts + 1,
    });
  },

  // No clamping, no validation, and no recomputation of the room: this is the frame path,
  // and FirstPerson.tsx has the WalkCtx that walk() and roomAt() were both answered
  // against. A second opinion here would be a second WalkCtx per frame, which walk.ts's
  // header exists to forbid.
  setWalk: (firstPerson) => set({ firstPerson }),

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
      orbitStage: null,
      // params are being reset too, so the seed has to use the NEW ones -- get().stage
      // rather than a captured value, since resetAll is a plain object literal and there
      // is no function-form set() argument to read it off.
      firstPerson: walkerFor(get().stage, DEFAULT_PARAMS),
      selected: null,
      notice: "Back to the sourced dimensions and the shipped fit-out.",
      cuts: 0,
      scrubbing: false,
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
      // Derived from the incoming stage, not carried in the URL: whichever stage the
      // link's own `stage` field names is, by construction, the stage this orbit was
      // captured at -- there is nowhere else it could have come from.
      orbitStage: s.orbit ? s.stage : null,
      // Set, NOT re-fitted. `pieces` above is the sender's actual arrangement and it
      // arrives whole; running layout() at this occupancy instead would throw away
      // every piece they moved. So the two arrive independently, exactly as they sat
      // in the sender's own store -- which is also why setOccupancy does not re-fit.
      occupancy: s.occupancy,
      // NOT cleared for the reason `selected` is -- a link that opens at stage 5 opens
      // standing, exactly as any other arrival there does. walkerFor() takes the
      // INCOMING params, s.params, not the store's current ones: the suite the walker is
      // checked against is the one the link describes, which is the whole point of `s`
      // being a parameter here rather than get()'s own state.
      firstPerson: walkerFor(s.stage, s.params),
      selected: null,
      flying: false,
      notice: null,
    }),
}));
