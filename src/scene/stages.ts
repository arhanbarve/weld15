/**
 * Camera keyframes for the six stages, in feet, three.js world space.
 *
 * Origin is Weld's centroid and one unit is one foot, matching frames.ts. The
 * whole run is 4,000 ft out down to 2 ft inside a bedroom -- about 2,000:1, well
 * within float32, which only loses depth precision past roughly 1e5:1.
 *
 * Stage 0 is the exception. Earth at foot scale would be 2.1e7 ft in radius, so
 * the globe lives in its own scene at unit scale and stage 0 -> 1 is a hard cut.
 * Stages 1 -> 5 are one continuous move.
 */

import { buildSuite } from "@/geo/rooms";
import { suiteToThree, floorLevel, WELD } from "@/geo/place";
import type { Rect, Suite, SuiteParams } from "@/geo/rooms";
import type { Vec3 } from "@/geo/frames";
import type { StageId } from "@/state/store";
import { HUB, route, standIn } from "./route";
import { EYE } from "./walk";

/**
 * One camera pose, plus -- for the one stage that has a path rather than a place -- the
 * polyline it travels.
 *
 * `path` hangs off stage 4's keyframe and nowhere else, which is where it belongs: the
 * comment on cameraKeyframe() below has said "stage 4 is the only stage with a path
 * rather than a place" since P2, and this is that sentence as a type. Optional because
 * every other stage has none and because orbit.ts's orbitKeyframe() and blend() both
 * construct Keyframes without one.
 */
export type Keyframe = { position: Vec3; target: Vec3; fov: number; path?: PathStop[] };

/** A waypoint on stage 4's path: the pose, and the t at which the camera is there. */
export type PathStop = {
  /** 0..1, ascending, 0 on the first stop and 1 on the last. */
  at: number;
  frame: Keyframe;
};

/**
 * Vertical field of view for the approach to the gable, degrees.
 *
 * Named because the stand-off distance is derived from it. The two were independent
 * numbers once and the distance quietly stopped framing the building.
 */
const GABLE_FOV = 50;

/**
 * How much taller than the ridge the frame must be, as a multiple.
 *
 * 1.35 leaves the roof clear of the top edge and some ground at the bottom, so the
 * gable reads as a building end rather than as a crop of one.
 */
const GABLE_FRAMING = 1.35;

/**
 * Vertical field of view for the shot that ends the descent, degrees.
 *
 * 62, unchanged from when it framed a bedroom corner, and it is if anything more
 * necessary now that the shot stands in a 4.5 ft hall: a narrow lens in a corridor
 * shows a rectangle of wall at the end of it and nothing of the corridor.
 */
const ROOM_FOV = 62;

/**
 * The t at which the brick has finished dissolving.
 *
 * The top of thresholdOpacity()'s shell ramp, named because two things now depend on it
 * and a second copy of 0.7 would let them drift: the ramp itself, and the waypoint on
 * stage 4's path that sits at the plane of the gable. The camera passes through the
 * masonry on the frame the masonry reaches zero opacity, which is the same argument
 * REDUCED_CUT makes about the cut -- a camera on one side of a wall that is still being
 * drawn reads as a glitch rather than as a crossing.
 */
export const SHELL_GONE = 0.7;

/**
 * Where the camera sits and looks for each stage.
 *
 * Stages 4 and 5 depend on the suite params, because both are positioned relative to
 * rooms that move when a dimension slider moves -- stage 4 to bedroom B, whose gable
 * window it approaches, and stage 5 to the hall.
 *
 * MEMOISED ON THE PARAMS OBJECT'S IDENTITY, and that is not a micro-optimisation.
 * CameraRig calls this from inside useFrame, i.e. sixty times a second, and since P7
 * the body below also calls route() -- which builds a WalkCtx, which walks a grid and
 * merges rectangles. walk.ts's own header says to memoise one per params and never per
 * frame. MEASURED on this machine, 2,000 calls at the default params: 0.1902 ms per call
 * uncached against 0.000054 ms cached, so the uncached path is 11.4 ms of work per second
 * of animation -- 3,500 times the cached one, and spent rebuilding six identical
 * keyframes. Not a stall on its own, and recorded at its real size rather than dressed
 * up: what makes it worth a cache is that it is per-frame work whose cost grows with the
 * geometry, and P6's gates already found hiddenWalls() in a useFrame for the same reason.
 *
 * ONE ENTRY, keyed by identity rather than by value. Identity is the right test for the
 * reason UrlSync's key() gives: every writer of `params` replaces the object rather
 * than mutating it -- setParams spreads, url.ts assembles a fresh one, and every test
 * writes `{ ...DEFAULT_PARAMS, x }` -- so a hit means the same suite and a miss costs
 * one recompute. One entry is enough because the four callers (CameraRig, Hud, A11yAlt,
 * DragLayer) all read the same object out of the same store on the same frame; two
 * params objects alternating per frame is not a state this app can reach.
 */
const CACHE: { params: SuiteParams | null; kf: Record<StageId, Keyframe> | null } = {
  params: null,
  kf: null,
};

export function keyframes(params: SuiteParams): Record<StageId, Keyframe> {
  if (CACHE.params === params && CACHE.kf) return CACHE.kf;
  const kf = buildKeyframes(params);
  CACHE.params = params;
  CACHE.kf = kf;
  return kf;
}

function buildKeyframes(params: SuiteParams): Record<StageId, Keyframe> {
  const suite = buildSuite(params);
  const bedB = suite.rooms.find((r) => r.id === "bedB")!;
  const hall = suite.rooms.find((r) => r.id === HUB);
  const floor = floorLevel(1);

  // Outside the gable, far enough back that Weld reads as a building.
  //
  // This used to sit 40 ft out at eye height, and that was a wall rather than a
  // shot. At the 50 degree vertical fov below, 40 ft frames 0.93 * 40 = 37 ft of a
  // building 85.4 ft to the ridge, centred on a 17.8 ft eye -- so the frame held a
  // slice of brick from the ground to about 36 ft, no roof, no sky, no silhouette.
  // The journey gate caught it as "stage 4 is a flat wash", 3 distinct tones, and
  // the gate was right: a featureless wall lit by a sun with shadows off IS a
  // smooth gradient. The bug was the framing, not the render.
  //
  // So the distance is derived from what has to fit rather than chosen: the ridge
  // height plus headroom, divided by the tangent of the half fov. Written as a
  // function of GABLE_FOV so the two cannot drift apart, which is how the 40
  // survived a change of fov in the first place.
  const gableBack =
    (WELD.ridge * GABLE_FRAMING) / (2 * Math.tan(((GABLE_FOV / 2) * Math.PI) / 180));
  const gableOutside = suiteToThree(
    bedB.u + bedB.du / 2,
    params.sectionLength + gableBack,
    floor + WELD.ridge / 2,
    params,
  );
  // Into bedroom B, but aimed high enough that the approach looks at the building
  // and not at the ground in front of it. The blend to stage 5 brings the eye down.
  const insideBedB = suiteToThree(
    bedB.u + bedB.du / 2,
    bedB.v + bedB.dv - 4,
    floor + WELD.ridge / 4,
    params,
  );
  // STAGE 5 STANDS IN THE HALL, WHICH IS THE DEBT P7 PAYS BACK.
  //
  // What stood here was a diagonal shot inside bedroom B, with a comment saying the hall
  // was the better shot and could not be had: "a straight camera path from bedroom B to
  // the hall passes through the partition between them, and at t = 0.7 the camera ended
  // up half a foot from that wall -- exactly the near plane -- so every face clipped and
  // the frame went completely empty. Routing a path through the doorway needs a spline
  // and collision, which is P7's first-person work." It exists now, so this is the hall.
  //
  // THE DEFECT IS STILL THERE, MEASURED, WHICH IS WHY THE ROUTE IS NOT DECORATION.
  // Sampled every 0.00025 of each segment, in the suite frame, against walk.ts's
  // clearance() -- the distance from a 0.75 ft disc's edge to the nearest wall band --
  // over the part of the path more than a foot south of the gable's interior face, so
  // that the gable the camera is deliberately coming through is not what is being
  // measured:
  //
  //   the straight blend, at the shipped params   +0.264 ft at (17.72, 42.99)
  //   the straight blend, at hallWidth = 3        -0.354 ft at (18.40, 42.99)
  //   the routed path, worst over 14 params sets  +0.330 ft, also at hallWidth = 3
  //
  // So at the defaults the straight line happens to clear the bedroom B / hall partition
  // by a quarter of a foot -- the camera centre passes 1.01 ft from it -- and at
  // hallWidth = 3, which is the LOW END OF THE PANEL'S OWN SLIDER, it passes 0.40 ft
  // from that band, inside Experience.tsx's near plane of 0.5. That is the recorded
  // defect, reachable through a shipped control, and the reason the shot could not
  // simply be moved without route(). See thresholdPath().
  //
  // WHERE IN THE HALL, AND WHERE IT LOOKS. standIn(hall) is the hall's centre, which is
  // the point route() itself ends at -- so kf[5] IS the last waypoint of the crossing
  // and the two cannot disagree at the stage boundary. The aim is the far end of the
  // hall, a QUARTER of the way across it rather than down its centreline: every door off
  // the hall is in its low-u wall (bedroom A, the bathroom, bedroom B, and since d5 the
  // common room), so an off-centre aim puts that wall and its openings in the frame,
  // where a symmetric shot down a 4.5 ft corridor shows two slivers of plaster and the
  // end of it. Dropped 2 ft over the length, for the reason the bedroom shot was dropped
  // 2 ft: without it the floor is not in the frame and journey.spec.ts's stage-5 gate
  // wants oak as well as plaster.
  //
  // WHAT THE MOVE COSTS IN DRAW CALLS, MEASURED ON THIS BUILD RATHER THAN ASSUMED.
  // window.__perf at stage 5, 1280 x 720, camera settled, nothing else changed:
  //
  //   the bedroom B corner shot   35 calls   1,385 triangles
  //   the hall shot               38 calls   1,469 triangles
  //
  // Three calls and 84 triangles, and it is entirely the frustum: `geometries` reads 11
  // and `casters` 9 in both, so nothing was added to the scene -- from the middle of the
  // hall the camera simply sees more of the suite than it does from a bedroom corner.
  // Against docs/IMPLEMENTATION-PLAN.md section 9's "Suite: <= 25 draw calls" both figures
  // are already over, for the composer and the shadow pass that arrived after that table
  // was written; against the 40 tests/e2e/edit.spec.ts allows at this stage, 38 idle leaves
  // 2 rather than 5 for a live drag gesture, which costs 3. So that gate now reads 41 and
  // fails, and it is a consequence of this shot rather than a flake. It is another owner's
  // file in this phase, so the ceiling is not raised here.
  const stand = hall ? standIn(hall) : { u: bedB.u + 2.5, v: bedB.v + 2.5 };
  const inHall = suiteToThree(stand.u, stand.v, floor + EYE, params);
  const hallTarget = hall
    ? suiteToThree(hall.u + hall.du / 4, hall.v, floor + EYE - 2, params)
    : suiteToThree(bedB.u + bedB.du - 2, bedB.v + bedB.dv - 1, floor + EYE - 2, params);

  const four: Keyframe = { position: gableOutside, target: insideBedB, fov: GABLE_FOV };
  const five: Keyframe = { position: inHall, target: hallTarget, fov: ROOM_FOV };
  const path = thresholdPath(params, suite, bedB, four, five);

  return {
    0: { position: [0, 0, 2.6], target: [0, 0, 0], fov: 45 },
    1: { position: [1500, 2600, 2600], target: [0, 40, 0], fov: 45 },
    2: { position: [420, 620, 620], target: [0, 30, 0], fov: 45 },
    3: { position: [150, 110, 190], target: [0, 42, 0], fov: 45 },
    4: path ? { ...four, path } : four,
    5: five,
  };
}

/**
 * Stage 4's path: outside the gable, through it into bedroom B, out through bedroom B's
 * own door, and into the hall.
 *
 * FIVE OR MORE WAYPOINTS, NOT TWO, and every one of them is derived rather than placed.
 * route() supplies the interior ones -- the centre of bedroom B, a standing position
 * either side of the doorway between it and the hall, and the centre of the hall -- and
 * its guarantee is the one that matters here: each of its segments lies inside a single
 * convex room, or crosses one doorway perpendicular to the band it is cut in and no
 * wider than the opening. So no segment can be nearer a wall than the standoff
 * route.ts's STANDOFF_MARGIN puts on it, which is RADIUS + 0.25 = 1 ft, i.e. twice the
 * near plane. That is what makes the empty frame impossible by construction rather than
 * by luck; the numbers on kf[5] above are the luck it replaces.
 *
 * THE ONE WAYPOINT THIS ADDS is the crossing itself: the gable's interior face, on the
 * approach's own centreline, at eye height. It is there so that the flight through the
 * masonry is perpendicular to it and lands where the walk begins, rather than entering
 * at whatever angle a line from 124 ft out happens to make -- which, measured, is what
 * put the straight blend into the hall at u 17.64 instead of into the room the shot is
 * framed on.
 *
 * WHEN EACH WAYPOINT IS REACHED. The crossing is pinned at SHELL_GONE, so the camera
 * passes the plane of the gable on exactly the frame the brick finishes dissolving --
 * one number for two things that have to agree, in the manner of REDUCED_CUT below. The
 * interior waypoints then share what is left of t by ARC LENGTH, so the walk from the
 * gable to the hall is at a constant speed. Measured at the shipped params: 23.83 ft of
 * interior over 0.3 of t, against 123.62 ft of approach over 0.7.
 *
 * NULL WHEN THERE IS NO ROUTE, and cameraKeyframe() then falls back to the straight
 * blend. A slider can put bedroom B and the hall in the same place -- legDepth 19 with
 * bedDepth 16 overlaps them, and buildOpenings() then hangs no door between the two --
 * so route() returns null for four of the eighteen params sets swept above. Those suites
 * are illegal and the store refuses them; keyframes() is called on the way to finding
 * that out, so it must answer rather than throw.
 */
function thresholdPath(
  params: SuiteParams,
  suite: Suite,
  bedB: Rect,
  four: Keyframe,
  five: Keyframe,
): PathStop[] | null {
  const waypoints = route(bedB.id, HUB, suite);
  if (!waypoints || waypoints.length < 2) return null;

  const eye = floorLevel(1) + EYE;
  const crossing = { u: bedB.u + bedB.du / 2, v: params.sectionLength };
  const plan = [crossing, ...waypoints];

  const legs = plan.slice(1).map((p, i) => Math.hypot(p.u - plan[i]!.u, p.v - plan[i]!.v));
  const total = legs.reduce((a, b) => a + b, 0);
  // A zero-length interior leg means the hall's centre coincides with the gable, which is
  // not a suite. Refuse rather than divide by it.
  if (!(total > 0)) return null;

  const at = [SHELL_GONE];
  let run = 0;
  for (const leg of legs) {
    run += leg;
    at.push(SHELL_GONE + (1 - SHELL_GONE) * (run / total));
  }

  const world = plan.map((p) => suiteToThree(p.u, p.v, eye, params));
  const stops: PathStop[] = [{ at: 0, frame: four }];
  for (let i = 0; i < plan.length; i++) {
    // The last stop IS kf[5], the object rather than a copy of its numbers, so that
    // cameraKeyframe(kf, 4, 1) and kf[5] are the same pose exactly and the stage
    // boundary cannot show a jump of a thousandth of a foot.
    if (i === plan.length - 1) {
      stops.push({ at: 1, frame: five });
      break;
    }
    stops.push({
      at: at[i]!,
      // Each waypoint looks at the NEXT one, so the camera looks where it is going and
      // the aim rotates smoothly as the position lerps. The last one keeps kf[5]'s own
      // target, which is the shot rather than a direction of travel.
      frame: {
        position: world[i]!,
        target: world[i + 1]!,
        fov: four.fov + (five.fov - four.fov) * at[i]!,
      },
    });
  }
  return stops;
}

/**
 * The pose at t, walking the polyline segment by segment.
 *
 * blend() does each segment, so the fov comes out exactly linear in t across the whole
 * path: every stop's fov is already the lerp at its own `at`, and blend is linear inside
 * a segment where `at` is linear in t. The alternative -- lerping fov per segment by arc
 * length -- would zoom in bursts.
 */
function alongPath(stops: PathStop[], t: number): Keyframe {
  const k = Math.min(1, Math.max(0, t));
  // The ends are returned rather than blended to, so that t = 0 and t = 1 are kf[4] and
  // kf[5] EXACTLY. blend(a, b, 1) computes p + (q - p), which is q to within an ulp
  // rather than q by construction, and the stage boundary is the one place a camera
  // position is compared for equality -- by tests/stages.test.ts and by CameraRig's
  // MOVE_EPS. RECORDED RATHER THAN CLAIMED: at these coordinates the blend is already
  // bit-identical, and removing these two lines fails no test in the file. So this is
  // one line of margin on a float, on the same footing walk.ts's per-axis retry is
  // recorded on, and not a load-bearing part of the argument.
  if (k <= 0) return stops[0]!.frame;
  if (k >= 1) return stops[stops.length - 1]!.frame;
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (k > b.at && i < stops.length - 1) continue;
    const span = b.at - a.at;
    return blend(a.frame, b.frame, span > 0 ? (k - a.at) / span : 1);
  }
  return stops[stops.length - 1]!.frame;
}

/** Straight-line blend between two keyframes, used across the threshold. */
export function blend(a: Keyframe, b: Keyframe, t: number): Keyframe {
  const k = Math.min(1, Math.max(0, t));
  const mix = (p: Vec3, q: Vec3): Vec3 => [
    p[0] + (q[0] - p[0]) * k,
    p[1] + (q[1] - p[1]) * k,
    p[2] + (q[2] - p[2]) * k,
  ];
  return {
    position: mix(a.position, b.position),
    target: mix(a.target, b.target),
    fov: a.fov + (b.fov - a.fov) * k,
  };
}

/**
 * Where the crossing cuts under reduced motion.
 *
 * Halfway, so the camera and the shell change on the SAME frame: any other value
 * gives a frame with the camera already inside and the wall still there, or the
 * wall gone and the camera still outside, and both read as a glitch rather than as
 * a cut.
 *
 * Exported because Threshold.tsx cuts its scanline sweep at the same instant and
 * currently declares its own HARD_CUT = 0.5 to do it. Two constants at one value is
 * one too many: the sweep and the camera have to cut together or the wall's
 * dissolve and the step through it disagree by a frame. Threshold.tsx should import
 * this, and until it does the two have to be moved together.
 */
export const REDUCED_CUT = 0.5;

/**
 * Opacity of Weld's exterior shell and of the interior, across the threshold.
 *
 * The windows overlap on purpose: the exterior is gone by t = 0.7 and the
 * interior is fully up by 0.9, but the interior starts at 0.4, so no frame shows
 * neither. A gap there is what a viewer reads as a flicker.
 *
 * `reduced` replaces both ramps with one hard cut. It is a third argument with a
 * default rather than a rewrite of the signature because every existing caller and
 * every assertion in tests/stages.test.ts is about the full-motion ramps, and those
 * are the ones that must not move.
 */
export function thresholdOpacity(
  stage: StageId,
  t: number,
  reduced = false,
): { shell: number; interior: number } {
  if (stage < 4) return { shell: 1, interior: 0 };
  if (stage > 4) return { shell: 0, interior: 1 };
  // No crossfade at all, not a fast one. MASTER.md allows a 120 ms crossfade at a
  // stage change, but a dissolve is what the threshold IS -- fading it quickly is
  // still the effect the guideline exists to switch off.
  if (reduced) {
    return t < REDUCED_CUT ? { shell: 1, interior: 0 } : { shell: 0, interior: 1 };
  }
  const ramp = (x: number, lo: number, hi: number) =>
    Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return {
    shell: 1 - ramp(t, 0.2, SHELL_GONE),
    interior: ramp(t, 0.4, 0.9),
  };
}

/**
 * The keyframe the camera should hold, for a stage and its progress.
 *
 * Stage 4 is the only stage with a path rather than a place -- it runs from outside the
 * gable, through it, and out of bedroom B's door into the hall -- so it is the only
 * stage this does anything to. The path is on kf[4].path, built by thresholdPath(), and
 * the fallback when there is none is the straight blend this replaced: a suite whose
 * bedroom B and hall are not joined by a door has no route to follow, and a camera that
 * refused to move at all would be a worse answer than a line.
 *
 * REDUCED MOTION IS A JUMP CUT, and this is where that is true. The crossing is not
 * walked more quickly; it is not walked. The return value is kf[4] before the cut
 * and kf[5] after it, so the only camera positions that occur anywhere in the
 * stage-4 sequence are two of the six keyframes and nothing between them ever
 * exists to be rendered. Snapping in CameraRig would not be enough on its own: the
 * camera would still visit every interpolated position, one per slider event, and
 * an interpolated position arrived at instantly is still an interpolated position.
 *
 * Observable from outside via window.__cam.path -- see CameraRig.
 */
export function cameraKeyframe(
  kf: Record<StageId, Keyframe>,
  stage: StageId,
  t: number,
  reduced = false,
): Keyframe {
  if (stage !== 4) return kf[stage];
  if (reduced) return t < REDUCED_CUT ? kf[4] : kf[5];
  const path = kf[4].path;
  return path ? alongPath(path, t) : blend(kf[4], kf[5], t);
}

/** Which stages need the campus, Weld's shell, and the interior mounted. */
export function visibility(stage: StageId): {
  globe: boolean;
  campus: boolean;
  weld: boolean;
  interior: boolean;
} {
  return {
    globe: stage === 0,
    campus: stage >= 1 && stage <= 3,
    weld: stage >= 2 && stage <= 4,
    // Mounted a stage early so its geometry is warm before the threshold needs it.
    interior: stage >= 3,
  };
}
