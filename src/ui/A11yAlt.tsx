"use client";

/**
 * The text alternative to the model: everything the canvas is currently showing,
 * as a document.
 *
 * WHY THIS IS NOT AN sr-only PARAGRAPH
 * The whole content of this project is inside a WebGL canvas, and a canvas is
 * opaque -- not degraded, opaque. Experience.tsx's CanvasLabel puts a role="img"
 * and a one-sentence aria-label on the canvas element, which is the short form and
 * is all an accessible NAME can be. It says "a descent from orbit into Weld 15,
 * with the ceiling removed". It cannot say that bedroom B is 16 ft deep by 10.5 ft
 * along the section, that the 10 ft figure came from a blueprint read off by
 * someone who said it could be a foot out, or that four beds and four desks stand
 * in the two bedrooms. This component is the long form of that, and it is the
 * only route to the model's actual content for someone who cannot see it.
 *
 * It is therefore NOT visually hidden. Three reasons, in order of weight:
 *
 *   - A sighted keyboard user, a low-vision user at 400% zoom, and anyone who
 *     would rather read 44 ft than judge it from a perspective view all want this
 *     and none of them are using a screen reader. design-system/MASTER.md asks for
 *     "a text alternative", not for a screen-reader-only one.
 *   - A visible disclosure is verifiable. An sr-only block is the class of thing
 *     this project has already shipped broken three times -- an aria-label that
 *     landed on the wrong element, a live region inside a `hidden` container --
 *     because nothing about it is visible when it stops working.
 *   - It is the honest fallback for a client with no WebGL. The canvas may not
 *     come up at all; the description does not depend on it.
 *
 * A DISCLOSURE, NOT A DIALOG. A button with aria-expanded / aria-controls and a
 * region that follows it in the DOM, which is exactly the shape Panel.tsx's
 * toggle already uses. No backdrop, no focus trap, no aria-modal: nothing here
 * takes an action, so trapping focus in a page whose other controls stay live
 * would be a lie about the state of the app.
 *
 * PURELY PRESENTATIONAL, AND IT DOES NOT IMPORT THE STORE. Every fact arrives as
 * a prop. Panel.tsx states the reason and it holds here twice over: `@/state/store`
 * is being edited in this window by another owner, and a value import of it
 * instantiates the zustand store as a side effect of loading this module. The one
 * exception is `import type { StageId }`, which is type-only and erases at
 * runtime -- src/scene/stages.ts imports the same type the same way.
 *
 * WHERE IT IS MOUNTED
 * In Hud.tsx, AFTER the skip button and BEFORE the HUD. Both halves of that are
 * load-bearing. After skip, because journey.spec.ts asserts that the first Tab
 * reaches the skip control and a focusable element ahead of it breaks that gate.
 * Before the HUD, because tab order has to follow visual order and this dock sits
 * in the top-left corner while the HUD is centred -- so the order a keyboard walks
 * is skip, this toggle, the HUD, the sources, the panel, which is top-left, top-left,
 * centre, bottom-left, right. tests/e2e/a11y.spec.ts asserts both.
 *
 * WHERE THE CSS IS
 * app/globals.css, under a `P8 the written description` heading at the end of the
 * file. It began life in a <style> element in this file, because when it was written
 * docs/phases/P7-P8.md gave owner N1 `A11yAlt.tsx` and `a11y.spec.ts` and nothing
 * else, and inline style objects cannot express :hover or :focus-visible. One owner
 * now holds both files, so the block moved -- which is what the note it carried said
 * should happen. Every selector is still prefixed `a11y-alt-` so nothing in it can
 * reach another owner's markup.
 */

import { useEffect, useMemo, useState, type JSX } from "react";
import { footprintArea } from "@/geo/walls";
import { floorLevel } from "@/geo/place";
import type { Rect, Suite } from "@/geo/rooms";
import type { FurnitureKind, Piece } from "@/geo/furniture";
import { cameraInSuite, CUTAWAY_WORDS, type CutawayMode } from "@/scene/cutaway";
import { cameraKeyframe, keyframes, thresholdOpacity } from "@/scene/stages";
import { orbitOf, type Orbit } from "@/scene/orbit";
import { EYE } from "@/scene/walk";
import type { StageId } from "@/state/store";

export type A11yAltProps = {
  /** 0..5, the same StageId the store holds. */
  stage: StageId;
  /**
   * The stage's name, as the HUD shows it: "Orbit", "Weld 15".
   *
   * A prop rather than a lookup, because STAGES lives in `@/state/store` and a
   * value import of that module creates the store. Hud.tsx already has
   * `STAGES[stage].name` in hand at the point it renders this.
   */
  stageName: string;
  /** Progress through stage 4's crossing, 0..1. Ignored at every other stage. */
  t: number;
  /**
   * The suite as currently configured. `suite.params` carries the dimensions, so
   * this one prop is both the rooms and the numbers behind them.
   */
  suite: Suite;
  /** The fit-out, as it stands after any drags. */
  pieces: Piece[];
  /** How many students the suite is fitted out for, 1..4. */
  occupancy: number;
  cutaway: CutawayMode;
  /** Stage 3's free orbit, or null while the camera sits on the keyframe. */
  orbit: Orbit | null;
  /** The recipient's own media query, as the store read it. */
  reducedMotion: boolean;
  /**
   * The room the walker is standing in, when somebody is in first person, else null.
   *
   * A PROP BECAUSE THE STAGE IS NO LONGER ENOUGH. Everything else here is derived from
   * the stage and `t` through cameraKeyframe(), and for five and a half stages that is
   * the camera. First person breaks it: the walker moves the camera without changing the
   * stage, so a description built from the keyframe said "Standing in Hall" while the
   * viewer walked into bedroom A. Not a stale sentence but a wrong one, and wrong is
   * worse than absent for the reader who has no picture to correct it against.
   *
   * THE ROOM AND NOT THE POSITION, WHICH IS A DELIBERATE TRADE AND NOT AN OVERSIGHT.
   * FirstPerson.tsx writes the walker sixty times a second while a key is held, and
   * Hud.tsx -- which renders this -- already carries a comment refusing to subscribe to
   * the walker object for exactly that reason: it renders the whole HUD, so a per-frame
   * subscription re-renders all of it per frame. `room` changes when a doorway is
   * crossed, which is a handful of times per visit.
   *
   * So the description names the room and describes the room, rather than reporting a
   * position to the inch. That is also the more useful sentence: "you are in bedroom A,
   * which is 10 by 16 feet" tells a non-visual reader where they are, where "8 feet 3
   * inches inward from the window wall" needs the plan in your head to mean anything,
   * and would be stale by the time it was announced through the 500 ms throttle anyway.
   */
  firstPerson: { room: string | null } | null;
};

/* ---------------------------------------------------------------- formatting */

/**
 * A length as feet and inches.
 *
 * The same lattice Slider.tsx speaks on, and for the same reason: "10.75" read
 * aloud is not a ceiling height, and "10 ft 9 in" is the number a builder would
 * say. Used for the visible text as well as the spoken text here, because there
 * is no second audience -- this whole component is the reading.
 */
function ftIn(v: number): string {
  const inches = Math.round(v * 12);
  const ft = Math.floor(inches / 12);
  const rem = inches - ft * 12;
  if (ft === 0) return `${rem} in`;
  if (rem === 0) return `${ft} ft`;
  return `${ft} ft ${rem} in`;
}

/** Square feet, whole. Nothing here is measured to a tenth of a square foot. */
function sqft(v: number): string {
  return `${Math.round(v).toLocaleString("en-US")} sq ft`;
}

/** Feet, whole, with a thousands separator. For distances the camera stands off at. */
function ft(v: number): string {
  return `${Math.round(v).toLocaleString("en-US")} ft`;
}

/* ------------------------------------------------------------------- content */

/*
 * THE THIRD COPY OF THE CUTAWAY WORDING IS GONE, which is what the note that stood
 * here asked for. It read: Experience.tsx has CUTAWAY_ALT for the canvas label,
 * Panel.tsx has MODES for the radio faces, this is a third phrasing for a reader who
 * gets no picture at all, none of the three is exported, and they should be one
 * exported table in src/scene/cutaway.ts. They now are -- CUTAWAY_WORDS, one row per
 * mode with a register per call site -- and this component reads `.prose`, the long
 * form, which is the register that exists for exactly this audience. The strings are
 * the ones this file used to hold, moved rather than reworded.
 */

/**
 * Plural forms, declared rather than derived.
 *
 * "shelf" is why. Dropping or adding an `s` is not English, and a text
 * alternative that reads "2 shelfs" undermines the one thing it exists to do.
 */
const KIND_WORDS: Record<FurnitureKind, [one: string, many: string]> = {
  bed: ["bed", "beds"],
  desk: ["desk", "desks"],
  chair: ["chair", "chairs"],
  dresser: ["dresser", "dressers"],
  sofa: ["sofa", "sofas"],
  table: ["table", "tables"],
  shelf: ["shelf", "shelves"],
};

const KIND_ORDER = Object.keys(KIND_WORDS) as FurnitureKind[];

/**
 * The `stated` strings buildSuite() uses for a room nobody described.
 *
 * Matched rather than guessed at: rooms.ts writes exactly these two phrases, for
 * the bathroom ("not given") and the unnamed facade strip ("not mentioned").
 */
const NO_SOURCE = new Set(["not given", "not mentioned"]);

/**
 * GIVEN or INFERRED, for a ROOM.
 *
 * Deliberately only two of the three words Provenance.tsx uses, and deliberately
 * coarser than Panel.tsx's CONTROLS table, which tags each of the fifteen
 * PARAMETERS as GIVEN, DERIVED or INFERRED. What a Rect carries is `stated` --
 * the phrase a source used about that room, or one of the two phrases rooms.ts
 * writes when there was no source -- and a room's dimensions can come from a
 * mixture of parameters, so promoting that to a three-way tag here would be this
 * component inventing provenance. docs/DIMENSION-AUDIT.md section 1 is a list of
 * what that costs. So: a source said something about this room, or nothing did,
 * and the exact phrase is rendered beside the tag either way.
 */
function roomProvenance(r: Rect): "GIVEN" | "INFERRED" {
  return r.stated !== undefined && !NO_SOURCE.has(r.stated) ? "GIVEN" : "INFERRED";
}

/** Which walls a room has windows in, in words. */
function windowsOf(r: Rect): string {
  if (r.windows.length === 0) return "none";
  return r.windows.map((w) => (w === "facade" ? "the facade" : "the north gable")).join(" and ");
}

/** "2 beds, 2 desks, 2 chairs, 2 dressers", or null for an empty room. */
function fitOutOf(pieces: Piece[], roomId: string): string | null {
  const mine = pieces.filter((p) => p.room === roomId);
  if (mine.length === 0) return null;
  const parts: string[] = [];
  for (const kind of KIND_ORDER) {
    const n = mine.filter((p) => p.kind === kind).length;
    if (n === 0) continue;
    parts.push(`${n} ${KIND_WORDS[kind][n === 1 ? 0 : 1]}`);
  }
  return parts.join(", ");
}

/** The room a suite-frame point falls in, or null for a point outside every room. */
function roomAt(suite: Suite, u: number, v: number): Rect | null {
  return (
    suite.rooms.find(
      (r) => u >= r.u && u <= r.u + r.du && v >= r.v && v <= r.v + r.dv,
    ) ?? null
  );
}

/** An orbit in words. Hud.tsx's sayOrbit says the same thing; see the note below. */
function sayOrbit(o: Orbit): string {
  return (
    `heading ${o.headingDeg.toFixed(0)} degrees east of north, ` +
    `pitch ${o.pitchDeg.toFixed(0)} degrees below level, ` +
    `${ft(o.rangeFt)} out`
  );
}

/**
 * Which way the camera is looking, in the suite's own terms.
 *
 * Derived from the keyframe's target rather than described in prose, because the
 * keyframes move: stages.ts positions stages 4 and 5 relative to bedroom B, so a
 * dimension slider moves both. u runs inward from the window wall and v runs
 * north along the section (rooms.ts), and the dominant component is the one
 * named -- a shot that is 11.5 ft inward and 6.5 ft north is described as looking
 * inward, with north second.
 */
function lookDirection(du: number, dv: number): string {
  if (Math.abs(du) < 0.5 && Math.abs(dv) < 0.5) return "level, at nothing in particular";
  const inward = du > 0 ? "inward, away from the windows" : "outward, toward the windows";
  const along = dv > 0 ? "north, toward the gable" : "south, toward the stair hall";
  const inwardWord = du > 0 ? "inward" : "outward";
  const alongWord = dv > 0 ? "north" : "south";
  if (Math.abs(du) >= Math.abs(dv)) return `${inward}, and a little ${alongWord}`;
  return `${along}, and a little ${inwardWord}`;
}

type Where = {
  /** One sentence for the live region: coarse, and it does not mention numbers. */
  short: string;
  /** The paragraph: where the camera stands, how high, and what it is aimed at. */
  full: string;
};

/**
 * Where the camera is, per stage.
 *
 * Stages 0 to 2 are fixed shots and their numbers come straight out of
 * keyframes(); stage 3 is a free orbit and reads the live one; stages 4 and 5 are
 * positioned relative to bedroom B, so both are resolved through
 * cameraKeyframe() -- which is also what makes reduced motion visible here, since
 * under it stage 4 has only two camera positions rather than a path.
 *
 * cameraInSuite() is what turns a three.js world position back into "you are
 * standing in bedroom B". It is the same inverse Suite.tsx and cutaway.ts use, so
 * the answer cannot disagree with the walls that are being hidden.
 */
function whereIs(
  stage: StageId,
  t: number,
  suite: Suite,
  orbit: Orbit | null,
  reducedMotion: boolean,
  firstPerson: { room: string | null } | null,
): Where {
  const kf = keyframes(suite.params);

  if (stage === 0) {
    const r = kf[0].position[2];
    return {
      short: "Looking at the whole Earth from orbit.",
      full:
        `In orbit, ${r} Earth radii out from a globe drawn at unit scale, looking at the ` +
        `whole planet. Cambridge is a marked point on it and nothing of Weld Hall is ` +
        `resolvable yet. The globe is the only stage drawn at a scale other than feet.`,
    };
  }

  if (stage === 1 || stage === 2) {
    const p = kf[stage].position;
    const out = Math.hypot(p[0], p[2]);
    const place = stage === 1 ? "Cambridge" : "Harvard Yard";
    return {
      short: `Looking down at ${place} from the air.`,
      full:
        `About ${ft(out)} out horizontally and ${ft(p[1])} up, looking down and north at ` +
        `${place}. Building footprints are drawn as thin extruded outlines; Weld Hall is ` +
        `one of them and is ${stage === 1 ? "not yet" : "now"} picked out from the rest.`,
    };
  }

  if (stage === 3) {
    // The seed is orbitOf(kf[3]), the same expression Hud.tsx uses for the same
    // reason: null means the camera is still on the keyframe, and reading null as
    // a zero orbit would describe a camera due north of the building.
    const o = orbit ?? orbitOf(kf[3]);
    return {
      short: "Circling Weld Hall from outside.",
      full:
        `Outside Weld Hall, circling it: ${sayOrbit(o)}, aimed at a point 42 ft up the ` +
        `building. The interior is already mounted behind the brick at this stage, which ` +
        `is why the cutaway controls come alive here rather than at stage 5. ` +
        `${orbit === null ? "The camera is still on the stage's own keyframe." : "The camera has been moved from the stage's keyframe."}`,
    };
  }

  /*
   * THE WALKER OVERRIDES THE KEYFRAME, and it is answered before the keyframe is
   * computed rather than after, because while somebody is walking the keyframe is not
   * where the camera is. Asking it anyway produced a confident sentence about a room the
   * viewer had left, which for a reader with no picture is the failure mode worse than
   * saying nothing.
   *
   * The room's own rect comes from the suite, so the dimensions quoted here are the same
   * GIVEN and INFERRED numbers the table below lists and the panel's sliders drive --
   * there is no second source for them, which is the property that keeps this sentence
   * from drifting away from the model it describes.
   */
  if (firstPerson) {
    const room = firstPerson.room ? suite.rooms.find((r) => r.id === firstPerson.room) : undefined;
    if (!room) {
      return {
        short: "Walking, in a doorway between two rooms.",
        full:
          `Walking in first person at eye height, ${ftIn(EYE)} above the floor, currently in ` +
          `a doorway rather than in either of the rooms it joins. The camera is under your ` +
          `control rather than on the stage's keyframe.`,
      };
    }
    return {
      short: `Walking in ${room.label}.`,
      full:
        `Walking in first person in ${room.label}, ${ftIn(EYE)} above the floor at eye ` +
        `height. The room is ${ft(room.du)} inward from the window wall by ${ft(room.dv)} ` +
        `along the building, ${sqft(room.du * room.dv)}. The camera is under your control ` +
        `rather than on the stage's keyframe, so this follows you rather than the stage; ` +
        `it names the room you are in and is announced when you cross a doorway.`,
    };
  }

  const frame = cameraKeyframe(kf, stage, t, reducedMotion);
  const here = cameraInSuite(frame.position, suite.params);
  const aim = cameraInSuite(frame.target, suite.params);
  const room = roomAt(suite, here.u, here.v);
  const above = frame.position[1] - floorLevel(1);
  const inRoom = room
    ? `inside ${room.label}`
    : "still outside the building, in front of the north gable";

  if (stage === 4) {
    const { shell, interior } = thresholdOpacity(4, t, reducedMotion);
    return {
      short: `Crossing the gable wall, ${Math.round(t * 100)} per cent through.`,
      full:
        `Crossing Weld's north gable wall, ${Math.round(t * 100)} per cent of the way ` +
        `through, and ${inRoom}. The brick shell is drawn at ${Math.round(shell * 100)} ` +
        `per cent opacity and the interior at ${Math.round(interior * 100)} per cent, so ` +
        `the two overlap and no frame of the crossing is empty. ` +
        `${reducedMotion ? "Reduced motion is on, so this is a cut at the halfway mark rather than a dissolve: the only two camera positions that occur are the two ends." : "The camera travels the whole way as one move."}`,
    };
  }

  return {
    short: room ? `Standing in ${room.label}.` : "Standing inside the suite.",
    full:
      `Standing ${inRoom}, ${ftIn(above)} above the floor, ${ftIn(here.u)} inward from ` +
      `the window wall and ${ftIn(here.v)} north of the suite's south wall. Looking ` +
      `${lookDirection(aim.u - here.u, aim.v - here.v)}, which puts two walls, the floor ` +
      `and the room's depth in the frame rather than one wall filling it.`,
  };
}

/* -------------------------------------------------------------------- render */

/**
 * How long the position must hold before it is announced, ms.
 *
 * The same throttle Hud.tsx puts on its orbit readout, and docs/phases/P8.md is
 * explicit that a live region firing on every frame is worse than none. What
 * actually changes here is coarse -- the stage, and which room the camera stands
 * in -- so a burst is only possible by dragging stage 4's threshold slider, which
 * moves the camera 30 ft through a wall and changes the sentence on every input
 * event. 500 ms is long enough that a drag speaks once, where it stopped.
 */
const ANNOUNCE_MS = 500;

export function A11yAlt(props: A11yAltProps): JSX.Element {
  const { stage, stageName, t, suite, pieces, occupancy, cutaway, orbit, reducedMotion, firstPerson } =
    props;
  const [open, setOpen] = useState(false);

  /*
   * Memoised on the six things the sentence actually depends on, not on `props`.
   * A props object is a fresh identity every render, so [props] would recompute
   * keyframes() -- which calls buildSuite() -- on every unrelated re-render.
   *
   * `firstPerson` is safe as a dep because Hud.tsx builds it from the room id alone, so
   * it changes when a doorway is crossed rather than per frame -- see its own docblock for
   * why that is the shape rather than the position.
   */
  const where = useMemo(
    () => whereIs(stage, t, suite, orbit, reducedMotion, firstPerson),
    [stage, t, suite, orbit, reducedMotion, firstPerson],
  );
  const gross = useMemo(() => footprintArea(suite), [suite]);

  /**
   * The live region's text.
   *
   * It carries the stage and the room and NOT the cutaway mode, which is not an
   * oversight: Panel.tsx already announces the cutaway from its own polite
   * region, and two regions speaking the same change means a reader hears it
   * twice. The cutaway is in the panel's prose below, where it is read rather
   * than announced.
   */
  const announce = `Stage ${stage} of 5, ${stageName}. ${where.short}`;
  const [said, setSaid] = useState(announce);

  useEffect(() => {
    const id = window.setTimeout(() => setSaid(announce), ANNOUNCE_MS);
    // The cleanup IS the throttle: every further change cancels the pending
    // announcement, so a dragged threshold slider speaks once, at the end.
    return () => window.clearTimeout(id);
  }, [announce]);

  const p = suite.params;

  return (
    <>
      {/* Always in the DOM, and outside the collapsible region. A live region has
          to be in the accessibility tree BEFORE its text arrives or the
          announcement is a new node rather than a change -- and a region inside a
          closed disclosure is not in the tree at all. Panel.module.css's .notice
          records the same trap. */}
      <span
        className="a11y-alt-sr"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="a11y-alt-live"
      >
        {said}
      </span>

      <div className="a11y-alt-dock">
        <button
          type="button"
          className="a11y-alt-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="weld-a11y-alt"
          data-testid="a11y-alt-toggle"
        >
          {open ? "Hide the written description" : "Describe this view in writing"}
        </button>

        {/* Conditionally rendered rather than `hidden`, unlike Panel.tsx's form.
            The difference is what is inside: that form holds sixteen controls
            whose identity has to survive an open, and this holds no controls at
            all bar its own close button. Nothing here has state to lose, and a
            table of seven rooms plus a fit-out list is real DOM to keep parsed
            for a region most visitors never open. */}
        {open ? (
          <section
            id="weld-a11y-alt"
            className="a11y-alt-panel"
            aria-labelledby="weld-a11y-alt-title"
            data-testid="a11y-alt"
          >
            <h2 id="weld-a11y-alt-title">Weld 15, in writing</h2>
            <p>
              Everything below describes the 3D view as it is configured right now. It is
              generated from the same numbers the model is drawn from, not written to match
              it, so it cannot drift out of step with the picture.
            </p>

            <h3>Where the camera is</h3>
            <p data-testid="a11y-alt-where">
              Stage {stage} of 5, {stageName}. {where.full}
            </p>

            <h3>What has been cut away</h3>
            <p data-testid="a11y-alt-cutaway">
              {CUTAWAY_WORDS[cutaway].prose}{" "}
              {stage < 3
                ? "It changes nothing at this stage in any case: the interior is not mounted until stage 3, so there is nothing yet to cut away from."
                : "The interior is mounted, so this is what the frame actually shows."}
            </p>

            <h3>The suite</h3>
            <p>
              A four-person suite on the first floor of Weld Hall, Harvard Yard, built 1872.
              Five named rooms and a private hall, {sqft(suite.roomArea)} across the five
              named rooms, {sqft(suite.netArea)} including the hall and the unnamed strip,
              inside a gross footprint of {sqft(gross)}. It runs {ftIn(p.sectionLength)}{" "}
              north along the section and reaches {ftIn(suite.maxDepth)} inward at its
              widest. Ceiling {ftIn(p.ceiling)}. The rooms face{" "}
              {p.facade === "east" ? "east" : "west"}, with {ftIn(p.masonry)} of exterior
              masonry and {ftIn(p.partition)} interior partitions, and the facade is drawn{" "}
              {p.wingStep ? "stepped onto Weld's wing" : "straight rather than stepped onto Weld's wing"}.
            </p>
            <p className="a11y-alt-foot">
              {Math.abs(suite.residuals.along) < 0.01 && Math.abs(suite.residuals.across) < 0.01
                ? "The room chain closes exactly, both along the section and across the leg: nothing is left over and nothing overlaps."
                : `The room chain does not close: ${ftIn(Math.abs(suite.residuals.along))} left over along the section and ${ftIn(Math.abs(suite.residuals.across))} across the leg.`}
            </p>

            <h3>The rooms</h3>
            {/* role="region" plus tabindex on the SCROLLER, named by the table's
                own caption. A scroll container a keyboard cannot reach is
                axe-core's scrollable-region-focusable, a serious failure, and
                there is nothing focusable inside a table of numbers. */}
            <div
              className="a11y-alt-scroll"
              role="region"
              aria-labelledby="weld-a11y-alt-rooms"
              tabIndex={0}
              data-testid="a11y-alt-scroll"
            >
              <table className="a11y-alt-table" data-testid="a11y-alt-rooms">
                <caption id="weld-a11y-alt-rooms">
                  Seven rooms, south to north as the hall runs. Depth is measured inward
                  from the window wall; width runs north along the section.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Room</th>
                    <th scope="col">Depth</th>
                    <th scope="col">Width</th>
                    <th scope="col">Floor</th>
                    <th scope="col">Windows</th>
                    <th scope="col">Furniture</th>
                    <th scope="col">Provenance</th>
                    <th scope="col">What a source said</th>
                  </tr>
                </thead>
                <tbody>
                  {suite.rooms.map((r) => {
                    const prov = roomProvenance(r);
                    const fit = fitOutOf(pieces, r.id);
                    return (
                      <tr key={r.id}>
                        <th scope="row">{r.label}</th>
                        <td>{ftIn(r.du)}</td>
                        <td>{ftIn(r.dv)}</td>
                        <td>{sqft(r.du * r.dv)}</td>
                        <td>{windowsOf(r)}</td>
                        <td>{fit ?? "empty"}</td>
                        <td>
                          <span
                            className={`a11y-alt-prov ${
                              prov === "GIVEN" ? "a11y-alt-given" : "a11y-alt-inferred"
                            }`}
                          >
                            {prov}
                          </span>
                        </td>
                        <td className="a11y-alt-src">
                          {r.stated ?? "nothing; this room is this project's own inference"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="a11y-alt-foot">
              GIVEN means a source stated something about that room -- Harvard&rsquo;s housing
              office, or dimensions read off a blueprint by someone who said they could be a
              foot out. INFERRED means nothing did, and the figure is this project&rsquo;s own.
              The corrections panel tags each of the fifteen underlying dimensions
              separately, and more finely: GIVEN, DERIVED or INFERRED.
            </p>

            <h3>The fit-out</h3>
            <p>
              {pieces.length} pieces of furniture, fitted out for {occupancy}{" "}
              {occupancy === 1 ? "student" : "students"}. Every piece stands on a half-foot
              grid, inside its room, clear of the doors.
            </p>
            <ul data-testid="a11y-alt-fitout">
              {suite.rooms.map((r) => {
                const fit = fitOutOf(pieces, r.id);
                return fit === null ? null : (
                  <li key={r.id}>
                    {r.label}: {fit}.
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              className="a11y-alt-toggle"
              onClick={() => setOpen(false)}
              data-testid="a11y-alt-close"
            >
              Close the written description
            </button>
          </section>
        ) : null}
      </div>
    </>
  );
}
