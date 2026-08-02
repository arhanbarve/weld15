/**
 * Altitude is the parameter, and this module is the only thing that knows what it means.
 *
 * P9 replaces the hard cut at stage 0 -> 1 with a continuous descent, and the way it stays
 * testable is that EVERY altitude-dependent behaviour is a pure function of one scalar:
 *
 *   alt = camera.position.y        // three.js Y is up, and Weld's grade is y = 0
 *
 * Which ground quad is drawn, how opaque the globe is, how far the photograph has been
 * tinted toward the scan palette, which place labels are mounted, and the near and far
 * planes -- all of them come out of the functions below and out of nothing else. A gate can
 * therefore set an altitude and assert what should be on screen without driving an
 * animation, which is the property the whole phase is built on.
 *
 * THREE-FREE, deliberately, in the manner of walk.ts and route.ts. tests/place.test.ts
 * walks the real import graph and asserts this file reaches no renderer package, so it can
 * be unit-tested in plain node and so scripts can import it. Do not import three here, not
 * even for a Vector3.
 *
 * Everything is interpolated in LOG of altitude rather than in altitude. The descent covers
 * five and a half decades -- 3.3e7 ft down to 110 ft -- so a linear ramp between two of
 * these stops would spend essentially all of its travel in the top decade and snap through
 * the rest. "One octave wide" is a statement about a ratio, and the only interpolation in
 * which it means anything is the logarithmic one.
 *
 * P11 CORRECTION (task 4): `nearFar()` used to read its argument as altitude directly,
 * which is only true for a camera on Weld's local vertical -- see geo/frame.ts's header and
 * docs/phases/P11-PHOTOREAL.md section 0.1 for the measured failure once a camera leaves
 * it (globeRig.ts's spinPose). `nearFar()` keeps its existing signature, `nearFar(y:
 * number)`, because CameraRig.tsx's call site (`nearFar(camera.position.y)`) is owned by a
 * concurrent workstream and is not touched here -- but internally it now builds a site-frame
 * point `[0, y, 0]` and asks geo/frame.ts's `altitudeOf` for the true height above the
 * WGS-84 ellipsoid, rather than trusting `y` as-is. For a camera actually on the vertical
 * (x = z = 0, the only case the current call site ever produces), `altitudeOf([0, y, 0]) ===
 * y` to within a foot (frame.ts's own guarantee), so this is a no-op today and only changes
 * behaviour once a future call site passes an off-vertical position.
 */
import { altitudeOf } from "./geo/frame";

/**
 * Earth's radius in feet.
 *
 * 6,371,000 m mean radius x 3.280839895 ft/m = 20,902,231 ft. This is the number
 * stages.ts:8 quotes as 2.1e7 when it explains why the globe cannot be drawn at foot
 * scale, and it is exported here so the two cannot drift.
 */
export const R_EARTH_FT = 20_902_231;

/**
 * The near/far schedule, as a table rather than a formula.
 *
 * Four constraints fix it, and none of them is taste:
 *
 * 1. `near` MUST stay at 0.5 for stages 4 and 5. stages.ts:161-177 records the measured
 *    defect that made it load-bearing: at hallWidth = 3, the low end of a shipped slider,
 *    the old straight blend passed 0.40 ft from a wall band and every face clipped. The
 *    bottom row of this table is that number and it is not negotiable.
 * 2. `far` at stage 3 stays 25,000 ft, which is what ships today (Experience.tsx before
 *    P9). It already clips well short of the 67,812 ft horizon from 110 ft up, and the
 *    horizon fade in Ground.tsx is what makes that invisible rather than a hard edge.
 * 3. far/near stays under roughly 1e5 so a 24-bit depth buffer stays well conditioned.
 *    The ratios below run 3e4 to 5e4.
 * 4. Monotonic in `alt`, both fields. A non-monotonic schedule means the depth resolution
 *    can improve as you descend and then get worse again, and z-fighting that appears,
 *    disappears and reappears is far harder to diagnose than z-fighting that just sits
 *    there. tests/altitude.test.ts asserts it across the whole range.
 * 5. `far` MUST reach past Earth's own centre at and above orbit altitude. This is the P11
 *    correction: the schedule used to hold its 99,000 ft row's values (far = 4,000,000 ft)
 *    flat all the way up through orbit (33,443,570 ft, stage 0's own altitude), which was
 *    harmless while Globe.tsx drew a small proxy sphere near the camera -- P9's whole design
 *    move (see globeRig.ts) was making `far` irrelevant to the real Earth's scale. P11
 *    mounts Google's photorealistic tileset at REAL ECEF scale instead (Tiles.tsx), and at
 *    orbit the camera sits `R_EARTH_FT + alt` ≈ 54,345,801 ft from Earth's centre -- past a
 *    far plane of 4,000,000 ft, so every tile is behind the far plane and none is ever
 *    requested (3d-tiles-renderer frustum-culls before requesting content). Measured, not
 *    guessed: a live session sat at `stats.inFrustum === 0` and `__tiles.settled === false`
 *    indefinitely at stage 0, which also means FlyDown.tsx's settle gate never released and
 *    the fly-down button did nothing -- this is the "loads forever above t ≈ 0.28" bug.
 *    The new top row's `far` clears `R_EARTH_FT + alt` with 1.84x margin (a live run with
 *    it settled in 4.8 s, 396/396 tiles, orbit through descent). `near` rises to 1,200 to
 *    keep `far/near` under this file's own 1e5 depth-precision budget (constraint 3) --
 *    nothing is 1,200 ft from the camera at orbit to clip.
 *
 * Values between rows are interpolated logarithmically in all three of alt, near and far.
 * Below the first row and above the last, the endpoint is held -- so stages 3, 4 and 5 all
 * sit on the flat bottom of the schedule and near/far do not move at all while the camera
 * orbits or the viewer walks.
 */
export const NEAR_FAR_STOPS: readonly { alt: number; near: number; far: number }[] = [
  { alt: 200, near: 0.5, far: 25_000 },
  { alt: 1_600, near: 2, far: 60_000 },
  { alt: 28_000, near: 30, far: 1_200_000 },
  { alt: 99_000, near: 100, far: 4_000_000 },
  { alt: 33_443_570, near: 1_200, far: 100_000_000 },
];

/**
 * How many globe radii of `far` to keep in hand. See globeRig.ts for what this buys.
 *
 * The globe is drawn at a proxy radius of `far / GLOBE_FAR_RATIO`, so the whole sphere --
 * centre at GLOBE_R * (1 + alt/R_EARTH) and back face one radius beyond that -- sits at
 * roughly far/4 at orbit and closer as you descend. 8 leaves the back of the sphere inside
 * the far plane by a factor of two at every altitude in the schedule, which matters only
 * because a depth-less draw is still frustum-culled.
 */
export const GLOBE_FAR_RATIO = 8;

/**
 * Interpolate y logarithmically between two stops, logarithmically in x.
 *
 * Both axes, which is what makes the schedule read as straight lines on a log-log plot and
 * is why the table above needs only four rows to cover five decades.
 */
function logLerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x <= x0) return y0;
  if (x >= x1) return y1;
  const u = (Math.log(x) - Math.log(x0)) / (Math.log(x1) - Math.log(x0));
  return Math.exp(Math.log(y0) + u * (Math.log(y1) - Math.log(y0)));
}

/**
 * The camera's near and far planes at a given altitude.
 *
 * CameraRig applies this every frame, in the same place it already writes camera.fov and
 * calls updateProjectionMatrix(). Experience.tsx's hard-coded `near: 0.5, far: 25_000`
 * becomes the initial value only.
 *
 * `y` is CameraRig's call site's own value, `camera.position.y` -- one component of a
 * site-frame position, in feet. It is turned into a site-frame POINT, `[0, y, 0]`, and
 * handed to geo/frame.ts's `altitudeOf`, rather than trusted as altitude directly: the two
 * only coincide when x = z = 0, i.e. a camera on Weld's local vertical, which is every
 * camera this function is called with today (see this file's header) but is not, in
 * general, true -- docs/phases/P11-PHOTOREAL.md section 0.1 measures the failure once a
 * camera leaves it. `altitudeOf` correctly ignores x and z here in exactly the case they
 * are meant to be ignored, and correctly stops ignoring them once a caller starts passing
 * a real off-vertical component in their place -- which is not this task, since this
 * function's signature stays a single number so CameraRig.tsx's call site does not change.
 */
export function nearFar(y: number): { near: number; far: number } {
  const alt = altitudeOf([0, y, 0]);
  const a = Math.max(0, alt);
  const stops = NEAR_FAR_STOPS;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  /**
   * Slack absorbing altitudeOf's own round trip through ECEF (Bowring's iteration settles
   * to 1e-9 metres, not to machine epsilon -- see geo/frame.ts). Passing `y` exactly on the
   * flat schedule's own boundary (as tests/altitude.test.ts does) can therefore come back a
   * few billionths of a foot to the wrong side of `first.alt`/`last.alt`, which used to be
   * impossible when this function read `y` directly. 1e-6 ft is three orders of magnitude
   * over that noise floor and nine orders under anything visible.
   */
  const FLAT_EPS = 1e-6;
  if (a <= first.alt + FLAT_EPS) return { near: first.near, far: first.far };
  if (a >= last.alt - FLAT_EPS) return { near: last.near, far: last.far };
  for (let i = 1; i < stops.length; i++) {
    const lo = stops[i - 1]!;
    const hi = stops[i]!;
    if (a <= hi.alt) {
      return {
        near: logLerp(a, lo.alt, hi.alt, lo.near, hi.near),
        far: logLerp(a, lo.alt, hi.alt, lo.far, hi.far),
      };
    }
  }
  return { near: last.near, far: last.far };
}

/**
 * The altitude below which the globe proxy would be clipped by the near plane.
 *
 * DERIVED, and the derivation is the whole reason globeRig.ts is a module rather than three
 * lines inline. The camera sits GLOBE_R * alt / R_EARTH_FT above the proxy's surface, and
 * GLOBE_R is far/8, so the surface is inside the near plane when
 *
 *   (far / 8) * alt / R_EARTH_FT  <  near
 *   alt  <  8 * R_EARTH_FT / (far / near)
 *
 * P9.md section 3.3 puts the answer at 4,180 ft by evaluating the ratio as "~4e4". THAT
 * FIGURE IS WRONG AND THIS IS THE CORRECTION: the ratio is not constant, and at the
 * altitude in question it is 33,622 rather than 40,000. The condition is a FIXED POINT --
 * the altitude at which the rule expires depends on the near and far planes at that same
 * altitude -- so it has to be solved rather than substituted. globeClipFloor() below does,
 * and the answer is 4,973 ft. The globe's own fade finishes at 40,000 ft (BANDS below), so
 * the real margin is 8.0x rather than the 9.6x the spec claims. Still ample, and the sphere
 * is fully transparent long before the rule expires -- but the two are maintained in
 * different tables, so globeRig.ts asserts it rather than trusting the coincidence.
 */
export function globeClipAlt(alt: number): number {
  const { near, far } = nearFar(alt);
  return (GLOBE_FAR_RATIO * R_EARTH_FT * near) / far;
}

/**
 * The altitude below which the globe proxy is clipped, whatever the schedule says.
 *
 * Solved by iteration rather than derived, because globeClipAlt() is a function of the very
 * altitude it is trying to find. The map is a strong contraction here -- near and far both
 * move roughly as alt^0.9 between the stops, so the ratio barely moves and the iteration
 * converges to machine precision in well under twenty steps -- but it is capped anyway,
 * since a future schedule with a steeper segment could in principle oscillate.
 */
export function globeClipFloor(): number {
  let a = 5_000;
  for (let i = 0; i < 100; i++) {
    const next = globeClipAlt(a);
    if (Math.abs(next - a) < 1e-9) return next;
    a = next;
  }
  return a;
}

/**
 * A layer's opacity band, in feet of altitude, read as the camera DESCENDS.
 *
 * `in` is [appears, full]: the layer is invisible at or above `appears` and fully opaque at
 * or below `full`. `out` is [starts, gone] and works the same way one level further down.
 * Both are descending pairs, i.e. appears > full and starts > gone, because the whole
 * sequence is a descent and reading these the other way round is the mistake this comment
 * exists to prevent.
 */
type Band = { in?: [number, number]; out?: [number, number] };

/**
 * Where every layer fades, end to end.
 *
 * NO BAND BOUNDARY COINCIDES WITH A STAGE ALTITUDE, and that is deliberate rather than
 * lucky. A transition that happens exactly when the stage changes is a transition nobody
 * can tell from a cut, and the entire point of P9a is that the cut is gone. The stage
 * altitudes are 3.34e7, 28,000, 1,570 and 110 ft; the boundaries below are 400,000,
 * 99,000, 40,000, 8,000, 4,000 and 400. tests/altitude.test.ts asserts the two sets are
 * disjoint with margin, so re-pitching a stop onto a fade boundary fails a test instead of
 * quietly costing the phase its reason for existing.
 *
 * 99,000 ft is not a round number either. It is where curvature goes sub-pixel: the sagitta
 * of a 25 km chord on a 6,371 km sphere is 12.3 m, under one pixel at 1080 px tall, and at
 * 45 degrees vertical fov a frame covers 0.828 * alt of ground, so 25 km of extent is
 * alt = 30 km = 99,000 ft. Above it the Earth has to be a sphere; below it a flat plane is
 * correct to within a pixel. That is a computation, not a preference.
 */
const BANDS: Record<string, Band> = {
  /** The proxy sphere. Full at orbit, gone by the time Q2 is up. */
  globe: { out: [99_000, 40_000] },
  /** 1,000 km across. Only ever on screen while the globe is still behind it. */
  q1: { in: [400_000, 99_000], out: [8_000, 4_000] },
  /** 50 km across: the Boston basin. Arrives as the globe leaves. */
  q2: { in: [99_000, 40_000] },
  /** 5 km across: Cambridge. */
  q3: { in: [40_000, 4_000] },
  /** 488 m across: the Yard, at the source's native resolution. */
  q4: { in: [4_000, 400] },
  /** The campus.json extrusions, which have to arrive before they can occlude. */
  massing: { in: [40_000, 4_000] },
  /** How far the photograph has been resolved into the scan palette. */
  tint: { in: [40_000, 400] },
};

export type LayerOpacity = {
  globe: number;
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  massing: number;
  tint: number;
};

/** Ramp from 0 at `hi` to 1 at `lo`, logarithmically, as altitude falls. */
function descending(alt: number, hi: number, lo: number): number {
  if (alt >= hi) return 0;
  if (alt <= lo) return 1;
  return (Math.log(hi) - Math.log(alt)) / (Math.log(hi) - Math.log(lo));
}

function bandOpacity(alt: number, band: Band): number {
  const up = band.in ? descending(alt, band.in[0], band.in[1]) : 1;
  const down = band.out ? 1 - descending(alt, band.out[0], band.out[1]) : 1;
  return Math.min(up, down);
}

/**
 * Every layer's opacity at one altitude.
 *
 * Returned as one object rather than seven functions because the caller is a render pass
 * that needs all of them on the same frame, and because a cross-dissolve is only correct if
 * both sides were evaluated at the same altitude.
 */
export function layerOpacity(alt: number): LayerOpacity {
  const a = Math.max(1e-6, alt);
  return {
    globe: bandOpacity(a, BANDS.globe!),
    q1: bandOpacity(a, BANDS.q1!),
    q2: bandOpacity(a, BANDS.q2!),
    q3: bandOpacity(a, BANDS.q3!),
    q4: bandOpacity(a, BANDS.q4!),
    massing: bandOpacity(a, BANDS.massing!),
    tint: bandOpacity(a, BANDS.tint!),
  };
}

/**
 * The altitudes at which some layer's opacity changes, ascending.
 *
 * Exported for the tests rather than for the scene: the "no boundary lands on a stage"
 * assertion needs the list, and deriving it from BANDS rather than restating it is what
 * stops the assertion from going stale when a band moves.
 */
export function bandBoundaries(): number[] {
  const out = new Set<number>();
  for (const b of Object.values(BANDS)) {
    if (b.in) out.add(b.in[0]), out.add(b.in[1]);
    if (b.out) out.add(b.out[0]), out.add(b.out[1]);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Is anything at all being drawn at this altitude?
 *
 * The band table's job is that the answer is always yes -- the globe's fade out and Q1's
 * fade in overlap, Q1's fade out and Q4's fade in overlap, and so on -- and a gate asserts
 * it by sweeping the range. A frame in which every layer is at zero is the "empty descent"
 * failure P8 measured on the code-split experiment, arrived at a different way.
 */
export function coverage(alt: number): number {
  const o = layerOpacity(alt);
  return Math.max(o.globe, o.q1, o.q2, o.q3, o.q4);
}
