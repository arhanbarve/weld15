"use client";

import { useEffect, useMemo, useState } from "react";
import { FLY_DOWN_END, LAST_STAGE, STAGES, pieceLabel, useStore, type StageId } from "@/state/store";
import { buildSuite } from "@/geo/rooms";
import { footprintArea } from "@/geo/walls";
import { Panel } from "./Panel";
import { STAGE3_CLAMP, clampOrbit, orbitOf, type Orbit } from "@/scene/orbit";
import { keyframes, visibility } from "@/scene/stages";
import { places } from "@/scene/route";
import { fromJourney } from "@/scene/journey";
import type { NudgeDir } from "@/geo/drag";
import { UrlSync } from "./UrlSync";
import { Sources } from "./Sources";
import { ImageryChip } from "./ImageryChip";
import { A11yAlt } from "./A11yAlt";
import { JourneyBar } from "./JourneyBar";

/**
 * Stage scrubber, stage name, the daylight controls, the stage-3 orbit keys, and
 * the skip control.
 *
 * The skip button is FIRST in tab order and first in the DOM. The immersive
 * pattern the design system adopted requires an escape from the intro sequence,
 * and a skip you have to tab past six stage buttons to reach is not one.
 *
 * The orbit keys live HERE rather than on the canvas, and that placement is the
 * whole reason this file gained them. MASTER.md wants a keyboard equivalent for
 * every canvas interaction, and the obvious reading of that -- tabIndex on the
 * canvas plus an onKeyDown -- breaks a different gate in the same checklist: the
 * canvas is mounted before the HUD, so a focusable canvas takes the first Tab and
 * the skip control stops being reachable first. The HUD comes after skip in the
 * DOM, so a control group here needs nothing said about tab order at all.
 */

/**
 * MASTER.md's 44 x 44 px minimum, applied on the element.
 *
 * It is needed: `.hud-t input` sets a width and no height, so a native date field
 * and a range track both come out around 20 px tall, and the height of the box IS
 * the hit area for a range thumb.
 *
 * Inline for a reason that has since expired -- globals.css belonged to another
 * phase when this was written -- so it would sit better as a rule beside
 * `.hud-t input`. Left where it is because moving it edits the two sun controls,
 * which is not what the orbit keys below are for.
 */
const TAP = { minHeight: 44 } as const;

/** ISO civil date, exactly. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Decimal hours as a wall clock. 9.25 is 09:15; 24 is midnight ending the day. */
function clock(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Degrees of azimuth or polar per press, and the arithmetic behind the 5.
 *
 * STAGE3_CLAMP allows 15 to 88 degrees of polar, a span of 73, which 5 crosses in
 * 15 presses -- end to end in under a second of key repeat, and no press large
 * enough to lose track of where the building went. Azimuth wraps, so its span is
 * 360: 72 presses for a full turn, 18 from one facade to the next.
 *
 * It is also the same size as a small drag. CameraRig turns the orbit one full
 * turn per viewport height, which at 1000 px is 0.36 deg/px, so 5 deg is 14 px of
 * mouse -- a nudge either way does the same thing.
 */
const STEP_DEG = 5;

/**
 * Radius multiplier per press: STAGE3_CLAMP's whole 3x span in 15 presses.
 *
 * Derived from the clamp rather than written out as 1.076, so the press count is
 * what stays fixed if the radii move -- and they can, both are computed from
 * Weld's ring and ridge. It lands within a hair of CameraRig's 1.08 per wheel
 * notch, so a press and a notch zoom by the same amount without either number
 * being a copy of the other.
 */
const ZOOM_PRESSES = 15;
const ZOOM_PER_PRESS = (STAGE3_CLAMP.maxRadius / STAGE3_CLAMP.minRadius) ** (1 / ZOOM_PRESSES);

/**
 * How long the orbit must sit still before it is announced, ms.
 *
 * A live region tied straight to the orbit would speak on every pointermove and
 * every key repeat, which is louder than no announcement and less informative.
 * 400 ms is longer than any key repeat interval at default settings (macOS
 * repeats every 30-90 ms once it starts), so holding a key announces once, at the
 * value you actually stopped on.
 */
const ANNOUNCE_MS = 400;

/**
 * A place's button face: the label up to its em dash.
 *
 * Only K has one -- "K — second common room" -- and six buttons in a row that is already
 * competing with the stage scrubber for the width of the HUD cannot each carry a clause.
 * The FULL label goes on the aria-label, so nothing is lost to a reader: what is shortened
 * is the face, which sits beside five others that name themselves.
 */
function placeFace(label: string): string {
  return label.split(" — ")[0]!;
}

/**
 * How wide the first-person row is allowed to get before it wraps, rem.
 *
 * MEASURED, AND IT IS A FIX FOR A DEFECT THIS ROW SHIPPED ONCE. Seven buttons on one line
 * come to 610 px at 1280 x 720, which widened the whole HUD from x 481..799 to x 320..960
 * -- and app/globals.css's `.a11y-alt-dock` rule records that the written description's
 * dock runs from x 14 to x 430 and is sized to clear the HUD by 51 px at that viewport.
 * A 640 px HUD crosses it by 110 px, so the disclosure covered the stage buttons: the exact
 * defect that rule and tests/e2e/a11y.spec.ts's box check exist to prevent, and it failed
 * that gate.
 *
 * 18 rem is 288 px, which with the HUD's 0.85 rem of horizontal padding makes this row 315
 * px of box against the 318 px the date row already needs -- so the HUD's width is
 * unchanged and the 51 px stays. What the cap costs is height: the row wraps to three lines
 * instead of one, downward, where nothing is in the way.
 *
 * Inline rather than in globals.css for the reason TAP above is: that file belongs to
 * another owner in this phase. It would sit better as a `max-width` beside `.hud-orbit`.
 */
const FP_ROW_MAX = "18rem";

/** One press worth of orbit. Defaults are the identity nudge. */
type Nudge = { az?: number; polar?: number; zoom?: number };

/**
 * Arrow keys to a piece move, in the SUITE frame.
 *
 * u is inward from the facade and v is north along the section, so the mapping to
 * screen arrows is a choice and it is made here once. Up and down are v, because the
 * section is the long axis and the camera at stage 5 looks along it; left and right are
 * u. The pointer path lands in the same coordinates through cameraInSuite(), so the two
 * inputs move a piece the same way.
 *
 * `r` rotates. A quarter turn is drag.ts's tryRotate() and it is on a letter rather
 * than on a modified arrow because a modifier plus an arrow is a screen-reader
 * shortcut on more than one platform.
 */
const PIECE_KEYS: Record<string, NudgeDir | "rotate"> = {
  ArrowUp: "v+",
  ArrowDown: "v-",
  ArrowRight: "u+",
  ArrowLeft: "u-",
  r: "rotate",
  R: "rotate",
};

/**
 * Apply one press to the orbit.
 *
 * The orbit is read from the store HERE rather than taken from a render, for the
 * reason CameraRig's drag reads it here: key repeat delivers events faster than
 * React re-renders, and a closure over the rendered orbit would apply every press
 * in the burst to the same starting angle -- a held arrow key that moves 5 degrees
 * and then sticks. `seed` may be closed over, because it depends only on params.
 *
 * The null is the store's "camera is still on the stage keyframe", so the first
 * press has to seed from that keyframe. Reading null as zero would swing the
 * camera from azimuth 141.7 to 0 before it moved its 5 degrees.
 *
 * clampOrbit does the limiting, and nothing here knows what the limits are. They
 * are derived from the ring and the ridge in orbit.ts and brute-force verified
 * there; a second opinion about them in the HUD is a second thing to keep in step.
 */
function nudgeOrbit(n: Nudge, seed: Orbit, setOrbit: (o: Orbit) => void): void {
  const o = useStore.getState().orbit ?? seed;
  setOrbit(
    clampOrbit({
      azimuthDeg: o.azimuthDeg + (n.az ?? 0),
      polarDeg: o.polarDeg + (n.polar ?? 0),
      radius: o.radius * (n.zoom ?? 1),
    }),
  );
}

/** Where the camera is, compactly, for the row itself. */
function readOrbit(o: Orbit): string {
  return `az ${o.azimuthDeg.toFixed(0)}° pol ${o.polarDeg.toFixed(0)}° ${o.radius.toFixed(0)} ft`;
}

/**
 * The same reading in words, for a reader that cannot see the frame.
 *
 * Spelled out rather than reusing readOrbit because "az" and "°" are read as
 * letters and a symbol, and this is the only description of the camera a screen
 * reader gets -- the canvas is opaque to it.
 *
 * Azimuth is the stored bearing, degrees east of north wrapped to (-180, 180], so
 * it can come out negative. Left that way on purpose: rewriting it as 0 to 360
 * here would put a second convention on the same number, and frames.ts, solar.ts
 * and orbit.ts all use this one.
 */
function sayOrbit(o: Orbit): string {
  return (
    `Azimuth ${o.azimuthDeg.toFixed(0)} degrees, ` +
    `polar ${o.polarDeg.toFixed(0)} degrees, ` +
    `${o.radius.toFixed(0)} feet out.`
  );
}

export function Hud() {
  const stage = useStore((s) => s.stage);
  const t = useStore((s) => s.t);
  const setStage = useStore((s) => s.setStage);
  const setJourney = useStore((s) => s.setJourney);
  const setScrubbing = useStore((s) => s.setScrubbing);
  const skip = useStore((s) => s.skipToSuite);
  const reduced = useStore((s) => s.reducedMotion);
  const flying = useStore((s) => s.flying);
  const setFlying = useStore((s) => s.setFlying);

  const date = useStore((s) => s.date);
  const hour = useStore((s) => s.hour);
  const setDate = useStore((s) => s.setDate);
  const setHour = useStore((s) => s.setHour);
  const selected = useStore((s) => s.selected);
  const params = useStore((s) => s.params);
  const orbit = useStore((s) => s.orbit);
  const setOrbit = useStore((s) => s.setOrbit);
  const cutaway = useStore((s) => s.cutaway);
  const setCutaway = useStore((s) => s.setCutaway);
  const occupancy = useStore((s) => s.occupancy);
  const setOccupancy = useStore((s) => s.setOccupancy);
  // The fit-out itself, not just its length: A11yAlt lists what stands in each room, and
  // the panel's own controls take counts. Read here rather than inside A11yAlt because
  // that component takes every fact as a prop and imports no store -- its header says why.
  const pieces = useStore((s) => s.pieces);
  const setParams = useStore((s) => s.setParams);
  const notice = useStore((s) => s.notice);
  const select = useStore((s) => s.select);
  const setNotice = useStore((s) => s.setNotice);
  const rotate = useStore((s) => s.rotate);
  const nudgePiece = useStore((s) => s.nudge);
  const refit = useStore((s) => s.refit);
  const resetAll = useStore((s) => s.resetAll);
  /**
   * First person, as two PRIMITIVES rather than as the walker object.
   *
   * FirstPerson.tsx writes the walker sixty times a second while a key is down, and this
   * component renders the whole HUD. A selector returning `s.firstPerson` would re-render
   * all of it on every one of those writes; `!== null` changes twice per visit and the room
   * id changes when a doorway is crossed. Neither is a per-frame value.
   */
  const walking = useStore((s) => s.firstPerson !== null);
  const walkRoom = useStore((s) => s.firstPerson?.room ?? null);
  const enterFirstPerson = useStore((s) => s.enterFirstPerson);
  const leaveFirstPerson = useStore((s) => s.leaveFirstPerson);
  const goToPlace = useStore((s) => s.goToPlace);

  const [panelOpen, setPanelOpen] = useState(false);

  /**
   * The suite and its floor area, for the panel's header and for gate 5.
   *
   * buildSuite() and footprintArea() are pure and cheap -- seven rects and a sum -- and
   * this is the one place the HUD needs them: the area is the readout that makes a
   * dimension slider legible as a change to the ROOM rather than to a number, which is
   * what docs/phases/P6.md's fifth gate asks for. Memoised on params so it is not
   * recomputed per keystroke of an unrelated control.
   */
  const suite = useMemo(() => buildSuite(params), [params]);
  const area = useMemo(() => footprintArea(suite), [suite]);

  /**
   * The selected piece's name, in words.
   *
   * Panel takes a label rather than an id because "bedA-bed-0" is a key, not a name, and
   * the panel is the one place a person reads it. pieceLabel() lives in the store beside
   * the refusal wording for the same reason: one spelling, so the button and the notice
   * that follows it agree.
   */
  const selectedLabel = selected ? pieceLabel(suite, selected) : null;

  /**
   * Put the current link on the clipboard, and say what happened either way.
   *
   * The address bar already holds it -- UrlSync rewrites it on every change -- so this
   * button is a convenience over selecting the URL by hand, not the mechanism. Which is
   * why the failure path matters more than the success one: the Clipboard API is
   * permission-gated and refuses outright in some browsers and over plain http, and a
   * button that silently does nothing reads as a broken app. On refusal it says so and
   * points at the address bar, which is still correct.
   */
  const copyLink = () => {
    const url = window.location.href;
    const ok = () => setNotice("Link copied. It reopens exactly this suite.");
    const no = () => setNotice("Could not reach the clipboard. The address bar holds the link.");
    if (!navigator.clipboard?.writeText) {
      no();
      return;
    }
    navigator.clipboard.writeText(url).then(ok, no);
  };

  /** The orbit stage 3 opens on: the keyframe stages.ts chose, read back as angles. */
  const seed = useMemo(() => orbitOf(keyframes(params)[3]), [params]);

  /**
   * What the live region currently holds.
   *
   * Initialised to the opening reading rather than to "" so a reader browsing the
   * group has the camera's position before touching anything. Some readers speak a
   * live region that arrives with content already in it and some do not; either is
   * fine here, because the sentence is the value of the control that just appeared.
   */
  const [said, setSaid] = useState(() => sayOrbit(seed));

  /**
   * The named places a viewer can be sent to, hall first.
   *
   * route.ts's places(), which is the REACHABLE rooms over doorways rather than every
   * room: the 7.5 ft strip beside the bathroom has no door on purpose, and offering to
   * send somebody somewhere they cannot walk out of would be a control that lies. Memoised
   * on the suite because places() builds a WalkCtx, which walks a grid.
   */
  const spots = useMemo(() => places(suite), [suite]);

  /** The room the walker is in, in words, or what is true instead. */
  const walkReading = !walking
    ? "not walking"
    : (spots.find((p) => p.id === walkRoom)?.label ??
      suite.rooms.find((r) => r.id === walkRoom)?.label ??
      "in a doorway");

  /**
   * The same reading for a reader who gets nothing from the canvas, throttled.
   *
   * A11yAlt's live region says which room the camera is in at stage 5 and is the longer
   * form of this -- but it derives the camera from cameraKeyframe(), i.e. from the STAGE,
   * and it cannot see the walker at all. That is a real gap and it is recorded here rather
   * than papered over: while first person is on, this row is the only thing that announces
   * which room the viewer has walked into. See the note in the JSX below.
   *
   * 400 ms is the same throttle the orbit readout above uses. What changes here is coarse
   * -- a room id, so at most once per doorway -- so the throttle is protection against a
   * viewer standing in a doorway with a key held rather than against a per-frame flood.
   */
  const [saidWalk, setSaidWalk] = useState("First person is off.");
  useEffect(() => {
    const sentence = walking
      ? walkRoom === null
        ? "In a doorway between two rooms."
        : `Standing in ${walkReading}.`
      : "First person is off. The camera is back on the stage's own view.";
    const id = window.setTimeout(() => setSaidWalk(sentence), ANNOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [walking, walkRoom, walkReading]);

  // The contrast toggle, its ref and its `prefers-contrast` effect lived here through P9.
  // P10 step 6 moved the seed into CameraRig, beside prefers-reduced-motion, and retired
  // the button outright. `highContrast`/`setHighContrast` stay on the store; nothing in
  // this file writes them.

  useEffect(() => {
    // Null means the camera is still on the keyframe, so there is nothing to
    // report yet: announcing on arrival at stage 3 would be an interruption
    // nobody asked for.
    if (stage !== 3 || orbit === null) return;
    const id = window.setTimeout(() => setSaid(sayOrbit(orbit)), ANNOUNCE_MS);
    // The cleanup is the throttle. Every further change cancels the pending
    // announcement, so a held key or a pointer drag speaks once, at the end,
    // rather than sixty times a second on the way there.
    return () => window.clearTimeout(id);
  }, [stage, orbit]);

  /**
   * Arrow keys move the SELECTED PIECE, once there is one and once the room is on
   * screen.
   *
   * On the window rather than on a container, because the piece being moved is in the
   * canvas and the canvas cannot hold focus meaningfully -- there is nothing inside it
   * to focus. That makes the two guards below load-bearing rather than defensive:
   *
   *   the stage gate  arrow keys belong to the orbit group at stage 3, which handles
   *                   them on its own element. Two handlers claiming ArrowLeft would
   *                   orbit the camera AND move a bed on one press.
   *   the target gate a range input uses arrows to change its own value, and every
   *                   dimension in the panel is a range input. Claiming the key while
   *                   one has focus would make the sliders unusable by keyboard, which
   *                   is the exact accessibility failure this project keeps finding.
   *
   * It calls the same nudge() the panel's buttons call, which is the same nudge()
   * drag.ts exports -- one code path, three inputs. docs/phases/P6.md's risk table
   * names "keyboard path is an afterthought" and this is the mitigation it asks for.
   */
  useEffect(() => {
    // The third guard is P7's, and it is the same kind as the other two: FirstPerson.tsx
    // claims the arrow keys to turn the walker while first person is on, so two handlers
    // on ArrowLeft would turn the viewer AND slide a bed on one press. The walker's
    // handler cannot be the one that yields, because turning is how a keyboard-only
    // viewer leaves the room they are standing in; enterFirstPerson() drops the selection
    // as well, so in practice this is belt and brace.
    if (stage !== LAST_STAGE || !selected || walking) return;
    const onKey = (e: KeyboardEvent) => {
      const dir = PIECE_KEYS[e.key];
      if (!dir) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      if (dir === "rotate") useStore.getState().rotate(selected);
      else useStore.getState().nudge(selected, dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, selected, walking]);

  /**
   * `[` and `]` step the stage, which MASTER.md asks for by name.
   *
   * On the window for the reason the piece keys above are: the thing being moved is the
   * camera and the canvas has nothing inside it to focus. The guard set is therefore
   * load-bearing in the same way, and it is deliberately NOT the same set:
   *
   *   NO stage gate    and this is the difference worth stating. The piece handler is
   *                    mounted only at the last stage because arrow keys belong to the
   *                    orbit group at stage 3 and to the walker at stage 5. Stage
   *                    navigation is meaningful at every one of the six, and no other
   *                    handler in the app claims a bracket -- ORBIT_CONTROLS' keys and
   *                    PIECE_KEYS above are the whole set, and neither contains one.
   *   the target gate  same gate, same reason, and here it is the one that matters most:
   *                    `[` typed into a field must never move the camera. The stage-4
   *                    threshold slider and the two sun controls are all <input>, and a
   *                    date field genuinely takes typed characters.
   *   first person     P7's guard, and it applies harder here than to a nudge: setStage
   *                    drops the walker, so an unguarded bracket would eject somebody
   *                    mid-stride from a stage they never asked to leave. Mounted by the
   *                    flag rather than branched inside, like the piece handler.
   *   no modifiers     Cmd+[ and Ctrl+[ are the browser's own Back on more than one
   *                    platform. Claiming the unmodified key only means a viewer going
   *                    back through history does not also lose their stage on the way.
   *
   * `e.key`, not `e.code`: MASTER names the characters, and PIECE_KEYS and NUDGE_BY_KEY
   * are both keyed the same way, so a layout that puts `[` elsewhere still works. `{` and
   * `}` are absent on purpose -- they are a different keystroke, unlike `=`/`+`, where
   * ORBIT_CONTROLS carries both because the UNSHIFTED press is the one people make.
   */
  useEffect(() => {
    if (walking) return;
    const onKey = (e: KeyboardEvent) => {
      const step = e.key === "[" ? -1 : e.key === "]" ? 1 : 0;
      if (step === 0 || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      // prev() and next() rather than setStage(stage +/- 1): they already clamp at 0 and
      // LAST_STAGE, reset `t` and drop the walker, and they are the same two actions the
      // store exposes to everything else. A second opinion about the ends of the range in
      // this file is a second thing to keep in step.
      if (step < 0) useStore.getState().prev();
      else useStore.getState().next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [walking]);

  /**
   * The master scrubber's only writer.
   *
   * u is JourneyBar's own coordinate -- the whole descent, orbit to hall -- and
   * fromJourney() is journey.ts's one implementation of turning that back into a
   * (stage, t) pair. setJourney() (store.ts) is the action that writes both without
   * resetting t or cancelling a flight the way setStage() would.
   */
  const onScrub = (u: number) => {
    const { stage: s, t: k } = fromJourney(u, params);
    setJourney(s, k);
  };

  return (
    <>
      <UrlSync />
      <ImageryChip />
      <button className="skip" onClick={skip} data-testid="skip">
        Skip to the room
      </button>

      {/* The written description of the frame, which is the only route into this app's
          content for anyone who cannot see a canvas -- and the only one at all if WebGL
          never comes up. Mounted HERE, between skip and the dock, and both neighbours are
          the reason: after skip so the first Tab still reaches the escape hatch, and
          before the dock so tab order follows visual order -- A11yAlt is top-left and the
          dock is top-right. A11yAlt.tsx's header carries the full account.

          Every prop is a value this component already holds for its own controls, which
          is what keeps the description and the picture from drifting: there is no second
          source for the stage, the suite or the fit-out. */}
      <A11yAlt
        stage={stage}
        stageName={STAGES[stage].name}
        t={t}
        suite={suite}
        pieces={pieces}
        occupancy={occupancy}
        cutaway={cutaway}
        orbit={orbit}
        reducedMotion={reduced}
        /* The room and not the walker, built from `walkRoom` -- the primitive selector
           above -- so this prop changes when a doorway is crossed rather than sixty times
           a second. A11yAlt's own prop docblock records why the description names the
           room instead of reporting a position, and the memo it feeds depends on it. */
        firstPerson={walking ? { room: walkRoom } : null}
      />

      {/* ONE DOCK, TOP RIGHT, AT EVERY STAGE. Replaces a HUD that sat bottom-centre and
          moved to the top at stage 5, plus a fly-down that sat top-centre on its own --
          three positions across six stages. app/globals.css's `.dock` comment carries the
          measurement that killed that layout. */}
      <div className="dock" data-testid="dock">
        <section className="dock-card" data-testid="hud">
          <div className="hud-stage" data-testid="stage-name">
            <span className="hud-num">{stage}</span>
            {STAGES[stage].name}
            {reduced ? <span className="hud-flag">reduced motion</span> : null}
          </div>

          {/* The master scrubber: one control for the whole descent, orbit to hall, plus
              the six stage ticks. JourneyBar.tsx carries the mapping and the rationale;
              this component only owns the fields it is handed. */}
          <JourneyBar
            stage={stage}
            t={t}
            params={params}
            onScrub={onScrub}
            onScrubbing={setScrubbing}
            onPickStage={setStage}
          />

          {/* THE FLY-DOWN, still hidden under reduced motion and past FLY_DOWN_END for the
              reasons it always was -- MASTER.md:93 asks for jump cuts under reduced motion,
              and a nine-second automatic descent through three decades of altitude is the
              most motion-heavy thing in this app; past FLY_DOWN_END there is nothing left
              to fly to. What moved is only where the button sits: inside the dock instead
              of pinned to the top of the viewport on its own. */}
          <div className="dock-row">
            {!reduced && stage < FLY_DOWN_END ? (
              <button
                className="fly"
                onClick={() => setFlying(!flying)}
                data-testid="fly-down"
                aria-pressed={flying}
              >
                {flying ? "Stop" : "Fly down to Weld"}
              </button>
            ) : null}
          </div>

          {/* FIRST PERSON, at the last stage only -- and stage-5-only by MOUNT, for the
              reason a stage-3 orbit row would be: a control that is present but declines to
              work is a control a keyboard user has to press to discover is dead. store.ts
              drops the walker on every stage change to match.

              THE ROW REUSES .hud-orbit AND .hud-scrub, so the 44 x 44 targets, the borders,
              the hover and the wrapping all come from those rules rather than from a new
              block in app/globals.css.

              THE PLACES ARE NOT A NICE-TO-HAVE. docs/phases/P7-P8.md requires a real
              alternative wherever an animation is switched off, and route.ts's places()
              exists for exactly this: a jump cut to a named room is the reduced-motion form
              of walking there. So the buttons come FIRST under reduced motion and second
              otherwise, and both orders are real controls rather than one being a fallback.

              WHAT THIS ROW OWES THE LIVE REGION, AND WHY. A11yAlt.tsx announces which room
              the camera is in at stage 5, which is the natural home for this sentence -- but
              it computes the camera from cameraKeyframe(stage, t), so it describes the STAGE
              and cannot see a walker at all. It takes every fact as a prop and has no prop
              for one. That file is another owner's in this phase, so the announcement lives
              here, and the request is written down rather than worked around: A11yAlt should
              take an optional first-person position and prefer it over the keyframe. Until it
              does, the long written description says "standing in the Hall" while the viewer
              is in bedroom A, and this row is the only thing that says otherwise. */}
          {stage === LAST_STAGE ? (
            <div
              className="hud-orbit"
              role="group"
              aria-label="Walk through the suite"
              data-testid="fp-controls"
              style={{ maxWidth: FP_ROW_MAX }}
            >
              <span aria-hidden="true">{reduced ? "go to" : "walk"}</span>
              <div className="hud-scrub">
                {(reduced ? ["places", "toggle"] : ["toggle", "places"]).map((part) =>
                  part === "toggle" ? (
                    walking ? (
                      <button
                        key="toggle"
                        type="button"
                        onClick={leaveFirstPerson}
                        aria-label="Leave first person"
                        // Discoverable rather than folklore: the shortcut is on the control
                        // and in the notice enterFirstPerson() writes. FirstPerson.tsx
                        // handles the key itself, including while pointer lock is engaged.
                        aria-keyshortcuts="Escape"
                        data-testid="fp-leave"
                        className="on"
                      >
                        leave
                      </button>
                    ) : (
                      <button
                        key="toggle"
                        type="button"
                        onClick={enterFirstPerson}
                        aria-label="Stand in the suite at eye height and walk it"
                        data-testid="fp-enter"
                      >
                        stand up
                      </button>
                    )
                  ) : (
                    spots.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => goToPlace(p.id)}
                        aria-label={`Go to ${p.label}`}
                        // Structural, not a tint: which room you are standing in survives a
                        // stylesheet that renders every button identically. cutaway.ts's
                        // header asks for exactly this of any mode control.
                        aria-pressed={walking && walkRoom === p.id}
                        data-testid={`fp-go-${p.id}`}
                        className={walking && walkRoom === p.id ? "on" : ""}
                      >
                        {placeFace(p.label)}
                      </button>
                    ))
                  ),
                )}
              </div>
              {/* Visible and NOT aria-hidden, unlike the orbit readout: it changes at most
                  once per doorway rather than on every frame of a drag, and the keys are
                  the only place the controls are written down for somebody who can see. */}
              <span className="tabular hud-orbit-read" data-testid="fp-readout">
                {walkReading}
              </span>
              {walking ? (
                <span data-testid="fp-keys">W A S D walk and turn · Q E sidestep · Esc leaves</span>
              ) : null}
              <span className="hud-sr" aria-live="polite" aria-atomic="true" data-testid="fp-live">
                {saidWalk}
              </span>
            </div>
          ) : null}
        </section>

        {/* The sun and the floor area, folded shut by default: a viewer arrives to look at
            the building, not to tune the light, and the dock's own scroll is what a
            disclosure this size would otherwise cost every stage. */}
        <details className="dock-fold" data-testid="view-fold">
          <summary>View and light</summary>

          {/* The sun. Two fields because a season and an hour are two things: the
              north gable takes 399 minutes of sun in June and none in December, and
              neither the date nor the hour alone can show that. */}
          <label className="hud-t">
            date
            <input
              type="date"
              value={date}
              // Guarded, because a date field reports "" and partial values while it
              // is being typed into, and an empty date makes the sun NaN.
              onChange={(e) => ISO_DATE.test(e.target.value) && setDate(e.target.value)}
              data-testid="sun-date"
              aria-label="Date the sun is computed for"
              style={TAP}
            />
          </label>

          <label className="hud-t">
            hour
            <input
              type="range"
              min={0}
              max={24}
              step={0.25}
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              data-testid="sun-hour"
              aria-label="Hour of the day in Cambridge"
              // Without this a screen reader announces "9.25" rather than a time.
              aria-valuetext={clock(hour)}
              style={TAP}
            />
            <span className="tabular" data-testid="sun-time">
              {clock(hour)}
            </span>
          </label>

          {/* The floor area, which is gate 5's readout and the answer to "did that slider
              do anything to the ROOM". It lives here rather than in Panel because Panel is
              presentational and takes no suite: buildSuite() is the one import it
              deliberately does not have. */}
          <div className="hud-t" data-testid="area-readout">
            <span>floor area</span>
            <span className="tabular">{area.toFixed(0)} sq ft</span>
          </div>
        </details>

        <Panel
          open={panelOpen}
          onToggle={() => setPanelOpen((v) => !v)}
          params={params}
          onParam={setParams}
          occupancy={occupancy}
          onOccupancy={setOccupancy}
          cutaway={cutaway}
          onCutaway={setCutaway}
          // visibility() mounts the interior at stage 3, and that is the first stage from
          // which a cutaway can change anything. Read from the same predicate the scene
          // uses rather than written out as `stage >= 3`, so the two cannot drift.
          cutawayEnabled={visibility(stage).interior}
          selected={selected}
          selectedLabel={selectedLabel}
          onRotate={() => selected && rotate(selected)}
          onNudge={(dir) => selected && nudgePiece(selected, dir)}
          onDeselect={() => select(null)}
          notice={notice}
          onRefit={refit}
          onCopyLink={copyLink}
          onReset={resetAll}
        />
        <Sources />
      </div>
    </>
  );
}
