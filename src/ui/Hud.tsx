"use client";

import { useEffect, useMemo, useState } from "react";
import { FLY_DOWN_END, LAST_STAGE, STAGES, pieceLabel, useStore, type StageId } from "@/state/store";
import { buildSuite } from "@/geo/rooms";
import { footprintArea } from "@/geo/walls";
import { Panel } from "./Panel";
import { STAGE3_CLAMP, clampOrbit, orbitOf, type Orbit } from "@/scene/orbit";
import { keyframes, visibility } from "@/scene/stages";
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
 * Degrees of heading or pitch per press, and the arithmetic behind the 5.
 *
 * STAGE3_CLAMP allows 2 to 75 degrees of pitch, a span of 73 (unchanged from the old
 * 15-to-88-degree polar clamp -- pitchDeg = 90 - polarDeg is a relabelling, not a
 * resizing), which 5 crosses in 15 presses -- end to end in under a second of key
 * repeat, and no press large enough to lose track of where the building went. Heading
 * wraps, so its span is 360: 72 presses for a full turn, 18 from one facade to the next.
 *
 * It is also the same size as a small drag. CameraRig turns the orbit one full
 * turn per viewport height, which at 1000 px is 0.36 deg/px, so 5 deg is 14 px of
 * mouse -- a nudge either way does the same thing.
 */
const STEP_DEG = 5;

/**
 * Range multiplier per press: STAGE3_CLAMP's whole 3x span in 15 presses.
 *
 * Derived from the clamp rather than written out as 1.076, so the press count is
 * what stays fixed if the ranges move -- and they can, both are computed from
 * Weld's ring and ridge.
 */
const ZOOM_PRESSES = 15;
const ZOOM_PER_PRESS = (STAGE3_CLAMP.maxRangeFt / STAGE3_CLAMP.minRangeFt) ** (1 / ZOOM_PRESSES);

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
type Nudge = { heading?: number; pitch?: number; zoom?: number };

/**
 * Arrow, page and plus/minus keys to an orbit nudge.
 *
 * ORBIT_CONTROLS and its six buttons are gone (step 5); this is only the mapping that
 * survives them. SIGNS follow CameraRig's drag exactly: right increases heading, and up
 * tilts the view UP toward the horizon -- which, under geo/rig.ts's pitchDeg convention
 * (0 level, 90 straight down, the opposite sense from the old polarDeg-from-straight-up),
 * is a FALLING pitch rather than a rising one. So up now decreases pitchDeg and down
 * increases it -- the on-screen effect of each arrow is unchanged from before this
 * rename; only the field it moves, and which direction counts as "more", flipped along
 * with polarDeg -> pitchDeg = 90 - polarDeg.
 *
 * `=` and `_` stay for the reason they always did: on a US layout `+` and `-` share keys
 * with them, and an unshifted press reports the unshifted character.
 */
const NUDGE_BY_KEY: Record<string, Nudge> = {
  ArrowLeft: { heading: -STEP_DEG },
  ArrowRight: { heading: STEP_DEG },
  ArrowUp: { pitch: -STEP_DEG },
  ArrowDown: { pitch: STEP_DEG },
  PageUp: { zoom: 1 / ZOOM_PER_PRESS },
  "+": { zoom: 1 / ZOOM_PER_PRESS },
  "=": { zoom: 1 / ZOOM_PER_PRESS },
  PageDown: { zoom: ZOOM_PER_PRESS },
  "-": { zoom: ZOOM_PER_PRESS },
  _: { zoom: ZOOM_PER_PRESS },
};

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
      headingDeg: o.headingDeg + (n.heading ?? 0),
      pitchDeg: o.pitchDeg + (n.pitch ?? 0),
      rangeFt: o.rangeFt * (n.zoom ?? 1),
    }),
  );
}

/** Where the camera is, compactly, for the row itself. */
function readOrbit(o: Orbit): string {
  return `heading ${o.headingDeg.toFixed(0)}° pitch ${o.pitchDeg.toFixed(0)}° ${o.rangeFt.toFixed(0)} ft`;
}

/**
 * The same reading in words, for a reader that cannot see the frame.
 *
 * Spelled out rather than reusing readOrbit because "heading" and "°" are read as
 * letters and a symbol, and this is the only description of the camera a screen
 * reader gets -- the canvas is opaque to it.
 *
 * Heading is the stored bearing, degrees east of north wrapped to (-180, 180], so
 * it can come out negative. Left that way on purpose: rewriting it as 0 to 360
 * here would put a second convention on the same number, and frames.ts, solar.ts
 * and orbit.ts all use this one.
 */
function sayOrbit(o: Orbit): string {
  return (
    `Heading ${o.headingDeg.toFixed(0)} degrees, ` +
    `pitch ${o.pitchDeg.toFixed(0)} degrees, ` +
    `${o.rangeFt.toFixed(0)} feet out.`
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
  /** The orbit to read: the store's, once a press or a drag has set one, else the seed. */
  const here = orbit ?? seed;

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
   * The room the walker is in, in words, or what is true instead.
   *
   * `!walking` means the refusal case and nothing else now: this row is mounted only at
   * stage 5 (below), and every arrival there seeds a walker automatically (P10 step 3)
   * except when a slider has left nothing in the suite standable. There is no "first
   * person is off" state left to read here.
   */
  const walkReading = !walking
    ? "nowhere to stand"
    : (suite.rooms.find((r) => r.id === walkRoom)?.label ?? "in a doorway");

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
  const [saidWalk, setSaidWalk] = useState("Nowhere in the suite is wide enough to stand in.");
  useEffect(() => {
    const sentence = !walking
      ? "Nowhere in the suite is wide enough to stand in."
      : walkRoom === null
        ? "In a doorway between two rooms."
        : `Standing in ${walkReading}.`;
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
    // NO walking guard, and this is D6's rule, not an oversight: FirstPerson.tsx also
    // claims the arrow keys at stage 5, but Step 4 made IT yield -- it reads `selected`
    // from the store at frame time and skips the arrows itself when a piece is selected.
    // So `selected` is the single arbiter of which handler owns an arrow press, not a
    // `walking` boolean here; keyboard nudge and walking coexist without conflict because
    // there is exactly one place that decides, and this effect does not need to be it.
    if (stage !== LAST_STAGE || !selected) return;
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
  }, [stage, selected]);

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
   *   NO first-person  removed on purpose (P10 step 5), where a P7-era guard used to sit.
   *   gate             Before step 3 a stage change NULLED the walker, so an unguarded
   *                    bracket mid-stride would eject somebody from a stage they never
   *                    asked to leave. Since step 3, `setStage`/`prev`/`next` DECIDE
   *                    whether stage 5 has a walker on every transition rather than
   *                    destroying one, so there is nothing left here to guard against --
   *                    and keeping the guard anyway would have made `[` and `]`
   *                    permanently dead at stage 5, which was itself a P9-era bug this
   *                    step fixes, not a safety net worth preserving.
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
  }, []);

  /**
   * The orbit keys, on the window, at stage 3 only.
   *
   * ON THE WINDOW because the six buttons that used to carry them are gone -- P10 took every
   * on-screen control off the canvas at this stage -- and the canvas cannot hold focus
   * meaningfully: there is nothing inside it to focus. Which is what makes the guards
   * load-bearing rather than defensive, exactly as they are on the two handlers above:
   *
   *   the stage gate   arrow keys belong to the walker at stage 5 and to a selected piece
   *                    at stage 5; mounting by stage rather than branching inside keeps one
   *                    owner per key per stage.
   *   the target gate  every dimension in the panel is a range input, the master scrubber is
   *                    one, and both sun controls are. Claiming an arrow while one has focus
   *                    would make them unusable by keyboard, which is the exact failure this
   *                    project keeps finding.
   *   no modifiers     Cmd+Arrow and Alt+Arrow are platform navigation.
   *
   * STEP_DEG, ZOOM_PER_PRESS and nudgeOrbit are unchanged from when buttons called them. The
   * derivation in their docblocks -- 15 presses end to end on both the pitch span and the
   * range, matched to 14 px of drag -- is why the keys still feel like the pointer, and
   * none of it moved. P11 moved zooming itself off the wheel (CameraRig.tsx's wheel now
   * always advances the journey; see that file's own header), so PageUp/PageDown/+/-
   * here are the range control's only surviving input.
   */
  useEffect(() => {
    if (stage !== 3) return;
    const onKey = (e: KeyboardEvent) => {
      const n = NUDGE_BY_KEY[e.key];
      if (!n || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      nudgeOrbit(n, seed, setOrbit);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, seed, setOrbit]);

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
          moved to the top at stage 5 -- and, on `p10-fidelity`, at stage 4 as well once that
          stage became draggable -- plus a fly-down that sat top-centre on its own: three
          positions across six stages. Fixing the dock at one corner answers both of those
          per-stage moves at once. app/globals.css's `.dock` comment carries the measurement
          that killed that layout. */}
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
            {/* [Reset the view], at every stage that has a free orbit to reset -- P11 made
                that every stage but the last (CameraRig.tsx's drag/wheel effect is mounted
                at every stage < LAST_STAGE), where it used to be only stage 0's turn
                (globeSpin, now removed) and stage 3's free orbit. `orbit` is session state
                rather than model state -- it is not carried by a link, for the reason
                store.ts gives on the field -- so nothing else puts it back. */}
            {stage !== LAST_STAGE ? (
              <button
                type="button"
                className="fly"
                onClick={() => setOrbit(null)}
                data-testid="reset-view"
              >
                Reset the view
              </button>
            ) : null}
          </div>

          {/* THE ORBIT'S KEYBOARD HALF, stage 3 only -- and stage-3-only by MOUNT, the same
              way the window handler above is: every other stage is a fixed shot, and a group
              that is present but does nothing is a control a keyboard user has to press to
              discover is dead. No buttons here; the six that used to carry the keys are gone
              (step 5), and the window handler above carries the interaction now. What is left
              is the readout, the hint that the keys still work, and the live region.

              `data-testid="orbit-keys"` stays on the group even though it holds no buttons,
              because it is the group the `aria-keyshortcuts` are advertised on. */}
          {stage === 3 ? (
            <div
              className="dock-orbit"
              role="group"
              aria-label="Orbit the camera around Weld"
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown PageUp PageDown"
              data-testid="orbit-keys"
            >
              <span className="tabular" data-testid="orbit-readout" aria-hidden="true">
                {readOrbit(here)}
              </span>
              <span className="dock-hint">drag to orbit · scroll to zoom · arrows and +/− also work</span>
              <span className="hud-sr" aria-live="polite" aria-atomic="true" data-testid="orbit-live">
                {said}
              </span>
            </div>
          ) : null}

          {/* FIRST PERSON, at the last stage only -- and stage-5-only by MOUNT, for the
              reason the orbit row above is stage-3-only by mount: a control that is present
              but declines to work is a control a keyboard user has to press to discover is
              dead. store.ts seeds a walker on every arrival at stage 5 to match (P10 step 3).

              THE ROW REUSES .hud-orbit AND .hud-scrub, so the 44 x 44 targets, the borders,
              the hover and the wrapping all come from the stage-3 row's rules rather than
              from a new block in app/globals.css -- which belongs to another owner in this
              phase, and which already carries a note saying that reuse is the intent.

              NO REDUCED-MOTION BRANCH, unlike the fly-down button above. That control skips
              an animation; standing at stage 5 is not one -- the walker is seeded once, on
              arrival, and the pose sits still until a key moves it. There was a jump-cut
              "places" row here for exactly this reason before P10 step 3 made standing
              automatic; it and its reduced-motion ordering are gone along with `goToPlace()`.

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
              <span aria-hidden="true">walk</span>
              <div className="hud-scrub">
                {/* goToPlace() and leaveFirstPerson() are gone from the store (P10 step 3):
                    standing is a property of being at stage 5, seeded automatically, not a
                    mode entered and left by button. This "stand up" retry is for the one
                    case standing can still fail -- a slider has left nothing in the suite
                    wide enough -- and it is the only button this row has left. */}
                {!walking ? (
                  <button
                    type="button"
                    onClick={enterFirstPerson}
                    aria-label="Stand in the suite at eye height and walk it"
                    data-testid="fp-enter"
                  >
                    stand up
                  </button>
                ) : null}
              </div>
              {/* Visible and NOT aria-hidden, unlike the orbit readout: it changes at most
                  once per doorway rather than on every frame of a drag, and the keys are
                  the only place the controls are written down for somebody who can see. */}
              <span className="tabular hud-orbit-read" data-testid="fp-readout">
                {walkReading}
              </span>
              {/* Unconditional now: there is no "first person is off" state left to hide
                  this behind, since standing at stage 5 is automatic (P10 step 3). A viewer
                  who has been refused a place to stand still benefits from knowing what the
                  keys would do once a dimension is widened back out. */}
              <span data-testid="fp-keys">
                W A S D walk and turn · Q E sidestep · R F look up and down · double-click to look
                with the mouse, Esc to release
              </span>
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
