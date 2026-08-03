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
import { HUB, route, standingPose } from "./route";
import { EYE } from "./walk";
import { R_EARTH_FT } from "./altitude";
import { poseToKeyframe, keyframeToPose, type GeoPose } from "./geo/rig";

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
 * How far outside the gable kf[4] stands, ft. Derived from GABLE_FOV and
 * GABLE_FRAMING rather than a local inside buildKeyframes(), so that
 * orbit.ts's STAGE4_CLAMP derives from the SAME number instead of a copy --
 * the mistake this file's own header on gableBack once made (a hard-coded
 * distance surviving a change of fov) is exactly what a second copy would
 * repeat in a second file.
 */
export const GABLE_BACK =
  (WELD.ridge * GABLE_FRAMING) / (2 * Math.tan(((GABLE_FOV / 2) * Math.PI) / 180));

/**
 * Vertical field of view for the shot that ends the descent, degrees.
 *
 * 62, unchanged from when it framed a bedroom corner, and it is if anything more
 * necessary now that the shot stands in a 4.5 ft hall: a narrow lens in a corridor
 * shows a rectangle of wall at the end of it and nothing of the corridor.
 */
const ROOM_FOV = 62;

const DEG = Math.PI / 180;

/**
 * Vertical field of view for the three descent stops, degrees.
 *
 * Named for the same reason GABLE_FOV is: the altitude of every stop below is DERIVED from
 * it, and the comment on gableBack records what happens when a distance and the fov it was
 * chosen for are allowed to drift -- a hard-coded 40 ft survived a change of fov and quietly
 * stopped framing the building. Nothing below is a literal altitude.
 */
const DESCENT_FOV = 45;

/**
 * How far each stop looks down from straight down, degrees.
 *
 * Stage 0 is nearly overhead; 1 and 2 are obliques. THE TWO OBLIQUE VALUES ARE A FRAMING
 * JUDGEMENT and P9.md section 8 flags them as such -- 40 and 45 are its proposal, taken as
 * offered. What is not a judgement is that the horizon must be out of frame, and it is: the
 * top edge of the frame sits at tilt + DESCENT_FOV/2 from nadir, which is 62.5 degrees at
 * stage 1 and 67.5 at stage 2, so both frames are entirely ground with 27.5 and 22.5 degrees
 * to spare. That matters because a flat ground quad has an edge (Ground.tsx fades it), and
 * the cheapest way not to see the edge is not to point at it.
 *
 * STAGE 0's 2 DEGREES IS NOT FREE, and the budget is tight enough to record. The globe's
 * disc is centred on the direction to Earth's CENTRE, but the camera aims at WELD, and those
 * two directions differ. Tilting the camera by tau moves the disc off the frame's centre by
 * tau - atan(alt*tan(tau)/(alt+R)), so a tilted camera pushes the disc up and opens a band
 * of empty background along the bottom of the very first frame the viewer ever sees.
 * Measured against the disc's own angular radius:
 *
 *   alt = 1.6 R   disc 22.6199 deg, overfills a 22.5 deg half-frame by 0.12
 *                 tilt 0.3 -> offset 0.115, just holds.  tilt 1 -> 0.385, VOID BAND.
 *   alt = 1.5 R   disc 23.5782 deg, overfills by 1.08
 *                 tilt 2 -> offset 0.800, holds with 0.28 deg to spare. tilt 3 -> VOID.
 *
 * So the altitude came DOWN from the 1.6 Earth radii the old unit-scale kf0 used, to buy the
 * tilt. 0.3 degrees of tilt would have kept 1.6 R, and it was rejected: at 0.3 degrees the
 * cross product in three's lookAt is 0.005 long, which is close enough to the straight-down
 * singularity to be relying on a library's degeneracy guard for the camera's roll -- and the
 * roll is what puts north at the top of the screen.
 */
const STAGE0_TILT_DEG = 2;
const STAGE1_TILT_DEG = 40;
const STAGE2_TILT_DEG = 45;
/** Stage 3's own tilt. Continues stage 2's 45 rather than steepening further -- see kf[3]. */
const STAGE3_TILT_DEG = 45;

/**
 * Camera altitude at stage 0, ft.
 *
 * 1.5 Earth radii above grade, for the reason the tilt comment above gives. The image is
 * very close to the unit-scale shot this replaces -- that one sat 2.6 radii from the centre
 * and subtended 22.62 degrees, this one sits 2.5 and subtends 23.58 -- but it is not
 * identical, and it is not meant to be: the globe now fills the frame with a degree of margin
 * instead of a tenth of one.
 */
const STAGE0_ALT = 1.5 * R_EARTH_FT;

/**
 * Which way round Weld each stop stands, degrees from due south toward the east.
 *
 * Read off the poses these replace so the shots stay recognisable: 30, 34.1 and (at stage 3,
 * which does not move) 38.3. The gentle swing eastward as the camera descends is the existing
 * character of the sequence and there was no reason to flatten it. Stage 0 shares stage 1's
 * azimuth so that the top of the descent is a straight drop rather than a drop and a turn.
 */
const STAGE0_AZIMUTH_DEG = 30;
const STAGE1_AZIMUTH_DEG = 30;
const STAGE2_AZIMUTH_DEG = 34.1;
const STAGE3_AZIMUTH_DEG = 38.3;

/**
 * What each stop has to frame, ft of ground measured UP THE SCREEN.
 *
 * Up the screen and not across it, because DESCENT_FOV is the vertical field of view; at 16:9
 * the horizontal extent is wider, so framing the vertical is the conservative reading of "it
 * fits".
 *
 * Cambridge is about 23,000 ft across. THE YARD FIGURE IS MEASURED RATHER THAN CHOSEN:
 * campus.json's 36 buildings span 1,149 x 1,269 ft, and 1,300 is that long axis plus a
 * little air. The stop it replaces framed 790 ft, i.e. 62% of the thing it was named after,
 * which is half of the complaint P9 answers.
 */
const CAMBRIDGE_EXTENT = 23_000;
const YARD_EXTENT = 1_300;
/**
 * What stage 3 has to frame, ft. Weld's own 143.3 ft length plus air either side.
 *
 * 1.88x rather than GABLE_FRAMING's 1.35, and the difference is measured in the browser
 * against live tiles rather than argued: at 193 ft the facade runs off both edges of the
 * frame, because this stop looks down the building's DIAGONAL (38.3 degrees off the long
 * axis) and the diagonal of a 63 x 143.3 ft plan is 157 ft, not 143.3. 270 leaves the whole
 * building inside the frame with the yard reading around it.
 */
const WELD_EXTENT = 270;

/**
 * The vertical drop from a target that frames `extent` feet of level ground at `tilt`.
 *
 * A ground line through the target, running up the screen, is foreshortened onto the image
 * plane by cos(tilt) -- the view axis makes 90 - tilt with the ground -- and the extent the
 * frame subtends at the target's slant range is 2 * slant * tan(fov/2). With
 * slant = drop / cos(tilt) the two combine to
 *
 *   extent = 2 * drop * tan(fov/2) / cos^2(tilt)
 *
 * which is the formula below, solved for the drop. Note that the cos^2 makes an oblique
 * camera see MORE ground than a nadir one at the same height, which is why P9.md section
 * 5.1's figures (27,763 and 1,569 ft) are larger than these: that section applies the nadir
 * formula and then asks for a 40 degree tilt, and the two do not compose. Framing Cambridge
 * from 28,000 ft at 40 degrees would put 39,528 ft in the frame, not 23,000.
 *
 * First order about the target, and deliberately so: the near and far halves of an oblique
 * frame are not the same size on the ground, so "the extent" is only well defined at the
 * centre. What it guarantees is that the named thing fits, which is all the stop needs.
 */
function obliqueDrop(extent: number, tiltDeg: number, fovDeg: number): number {
  const c = Math.cos(tiltDeg * DEG);
  return (extent * c * c) / (2 * Math.tan((fovDeg / 2) * DEG));
}

/** A pose at `azimuth` round the target, looking down at `tilt`, framing what it must. */
function descentStop(
  drop: number,
  tiltDeg: number,
  azimuthDeg: number,
  targetY: number,
  fov = DESCENT_FOV,
): Keyframe {
  const horizontal = drop * Math.tan(tiltDeg * DEG);
  return {
    position: [
      horizontal * Math.sin(azimuthDeg * DEG),
      targetY + drop,
      horizontal * Math.cos(azimuthDeg * DEG),
    ],
    target: [0, targetY, 0],
    fov,
  };
}

/** The tilt, azimuth, drop and aim height a descent keyframe was built from. */
function stopGeometry(k: Keyframe): {
  drop: number;
  tiltDeg: number;
  azimuthDeg: number;
  targetY: number;
  fov: number;
} {
  const [px, py, pz] = k.position;
  const [tx, ty, tz] = k.target;
  const drop = py - ty;
  const horizontal = Math.hypot(px - tx, pz - tz);
  return {
    drop,
    tiltDeg: Math.atan2(horizontal, drop) / DEG,
    azimuthDeg: Math.atan2(px - tx, pz - tz) / DEG,
    targetY: ty,
    fov: k.fov,
  };
}

/**
 * A keyframe, rebuilt through its own GeoPose -- geo/rig.ts's keyframeToPose then
 * poseToKeyframe -- so that the stage's shot is, per P11-PHOTOREAL.md section 2.3,
 * actually constructed via lat/lon/targetFt/heading/pitch/range rather than merely
 * describable that way.
 *
 * A ROUND TRIP, DELIBERATELY, RATHER THAN A DIRECT BUILD FROM THIS FILE'S OWN
 * CONSTANTS (STAGE1_AZIMUTH_DEG and friends), because those constants and
 * GeoPose.headingDeg do not share a sign convention. descentStop()'s azimuthDeg
 * places the camera at position.z = +horizontal * cos(azimuthDeg), while
 * poseToKeyframe/orbitKeyframe place it at target.z - horizontal * cos(headingDeg)
 * -- i.e. z with the OPPOSITE sign for the same angle. Measured directly: stage 3's
 * fixed pose ([150,110,190] looking at [0,42,0]) has a true GeoPose headingDeg of
 * atan2(150,-190) =~ 141.8 deg, not the "38.3" this file's own azimuth comments use
 * for the same shot -- the two are related by headingDeg = 180 - azimuthDeg, and
 * conflating them would put the camera on the wrong side of the building. Building
 * every base keyframe from its own already-correct Cartesian pose and reading the
 * GeoPose back off THAT (rather than hand-deriving headingDeg from the old azimuth
 * constants) sidesteps the sign question entirely and cannot mirror a shot by
 * mistake.
 *
 * SAFE TO WITHIN 0.01 FT, not exact, which is what every stage-0..4 keyframe below
 * inherits: tests/geoRig.test.ts proves keyframeToPose/poseToKeyframe round-trip
 * every one of today's six stage keyframes to within 0.01 ft, and every assertion
 * in tests/stages.test.ts about stages 0-4 is a self-referential or tolerant check
 * (pointInPolygon, monotonic-distance, toBeCloseTo, dist() < some feet), not a
 * bit-exact recomputation -- so this bridge cannot regress any of them. Stage 5 is
 * the one exception and is NOT run through this: kf[5] is asserted bit-for-bit
 * (`toBe`, not `toBeCloseTo`) equal to standingPose()'s own suiteToThree() output,
 * so it keeps its direct Cartesian construction untouched.
 */
function viaGeoPose(k: Keyframe): Keyframe {
  const pose: GeoPose = keyframeToPose(k);
  return poseToKeyframe(pose);
}

/**
 * The flight between two descent stops.
 *
 * LOGARITHMIC IN ALTITUDE, AND THAT IS THE WHOLE POINT OF THIS FUNCTION. Stage 0 falls from
 * 31,353,347 ft to 16,332 ft, a ratio of 1,920. A straight line between those two positions
 * -- which is what blend() alone would give -- is still at 15,684,839 ft at t = 0.5 and does
 * not reach 47,700 ft until t = 0.999. Every band in altitude.ts's table, the globe's whole
 * fade, and the arrival of the ground would all happen inside the last thousandth of the
 * slider. Descending at a constant RELATIVE rate instead -- d(log alt)/dt constant, which is
 * what uniformly spaced `at` over log-spaced altitudes gives -- is both the only usable
 * mapping and what a Google Earth fly-to actually does.
 *
 * The tilt, the azimuth and the aim height interpolate linearly across the same t, so the
 * camera swings from nearly overhead at orbit to the 40 degree oblique at Cambridge while it
 * falls. That is decision 11's "the camera rotates so Weld comes to frame centre while still
 * high, then descends", and it comes out of the interpolation rather than needing waypoints
 * placed by hand.
 *
 * HOW MANY STOPS, and why it is not a round number. alongPath() blends LINEARLY between
 * adjacent stops, so the polyline is a piecewise-linear approximation to an exponential and
 * the error is set by the altitude RATIO across one segment, not by the number of segments as
 * such. Eight stops per decade puts every segment at a ratio of 1.33, where the chord's
 * maximum deviation from the true curve is under 1% of the drop -- invisible, and it means a
 * stage that covers three decades gets three times the stops of one that covers a single
 * decade rather than the same number stretched thinner.
 *
 * The last stop IS the `to` keyframe object, not a copy of its numbers, for the reason
 * thresholdPath() gives: cameraKeyframe(kf, n, 1) and kf[n+1] then hold the same pose exactly
 * and the stage boundary cannot show a jump of a thousandth of a foot.
 */
function descentPath(from: Keyframe, to: Keyframe): PathStop[] {
  const a = stopGeometry(from);
  const b = stopGeometry(to);
  // Both drops are positive at every descent stop -- the camera is always above what it looks
  // at -- but a params set that put them equal would make the log undefined, so refuse rather
  // than emit NaN. keyframes() is called on the way to discovering an illegal suite.
  if (!(a.drop > 0) || !(b.drop > 0) || a.drop <= b.drop) return [{ at: 0, frame: from }, { at: 1, frame: to }];

  const decades = Math.log10(a.drop / b.drop);
  const segments = Math.max(6, Math.ceil(decades * 8));

  const stops: PathStop[] = [{ at: 0, frame: from }];
  for (let i = 1; i < segments; i++) {
    const u = i / segments;
    const drop = Math.exp(Math.log(a.drop) + u * (Math.log(b.drop) - Math.log(a.drop)));
    stops.push({
      at: u,
      frame: descentStop(
        drop,
        a.tiltDeg + u * (b.tiltDeg - a.tiltDeg),
        a.azimuthDeg + u * (b.azimuthDeg - a.azimuthDeg),
        a.targetY + u * (b.targetY - a.targetY),
        a.fov + u * (b.fov - a.fov),
      ),
    });
  }
  stops.push({ at: 1, frame: to });
  return stops;
}

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
 * than mutating it -- resetAll() hands back a fresh DEFAULT_PARAMS, url.ts assembles a
 * fresh one, and every test writes `{ ...DEFAULT_PARAMS, x }` -- so a hit means the
 * same suite and a miss costs one recompute. One entry is enough because the callers
 * (CameraRig, Hud, A11yAlt) all
 * read the same object out of the same store on the same frame; two params objects
 * alternating per frame is not a state this app can reach.
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
  //
  // ABOVE THE TREES SINCE P12, WHICH IS A FACT ABOUT CAMBRIDGE AND NOT A FRAMING TASTE.
  // The height was ridge/2, i.e. 55 ft above grade, chosen when the only things in the
  // scene were this project's own massing and a ground plane. Google's photogrammetry has
  // the Yard's elms in it, and geo/frame.ts's datum put them at their real height:
  // measured along this exact approach corridor (scripts/_probe-approach, +/-25 ft either
  // side of the line from the stand-off to Weld's centre, 1,628 tiles settled), canopy tops
  // run 50.8 to 59.9 ft over the first 39% of the run in. A camera at 55 ft starts the
  // threshold INSIDE a tree -- screenshotted, half the frame is leaves.
  //
  // 0.8 * ridge is 68.3 ft above the first floor, 80.6 ft above grade: clear of the 59.9 ft
  // worst canopy by 20 ft, and still under the 85.4 ft ridge so the approach looks slightly
  // UP at the roofline rather than down onto it. Weld's own mesh tops out at 81.2 ft in the
  // same measurement, which is the same number from the other direction.
  const gableOutside = suiteToThree(
    bedB.u + bedB.du / 2,
    params.sectionLength + GABLE_BACK,
    floor + WELD.ridge * 0.8,
    params,
  );
  // Into bedroom B, but aimed high enough that the approach looks at the building
  // and not at the ground in front of it. The blend to stage 5 brings the eye down.
  //
  // RAISED WITH THE STAND-OFF, ridge/4 to ridge/2, and it has to move with it: the aim sets
  // where the frame is centred, and lifting only the camera would have pitched the shot 21
  // degrees down and pushed the ridge off the top edge. At these two heights the view runs
  // 11.7 degrees below horizontal, so the 50 degree fov holds the gable from +2 degrees at
  // the ridge to -33 at the ground line, inside a frame spanning +13.3 to -36.7.
  const insideBedB = suiteToThree(
    bedB.u + bedB.du / 2,
    bedB.v + bedB.dv - 4,
    floor + WELD.ridge / 2,
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
  const pose = standingPose(suite);
  const inHall = suiteToThree(pose.p.u, pose.p.v, floor + EYE, params);
  const hallTarget = suiteToThree(pose.aim.u, pose.aim.v, floor + EYE - pose.drop, params);

  // Also rebuilt through its own GeoPose, for the same reason the descent stops are --
  // it is a plain two-point shot with no orbit constants to conflict with, so the round
  // trip is pure margin here rather than a sign-convention dodge.
  const four: Keyframe = viaGeoPose({ position: gableOutside, target: insideBedB, fov: GABLE_FOV });
  // kf[5] is NOT run through viaGeoPose. tests/stages.test.ts asserts it bit-for-bit
  // (`toBe`, not `toBeCloseTo`) equal to standingPose()'s own suiteToThree() output --
  // see viaGeoPose()'s comment -- so it keeps its exact Cartesian construction. Its
  // GeoPose, per P11-PHOTOREAL.md 2.3's table, is the hall/eye/standingPose().heading/
  // 8 deg/0 range shot this already is; it is simply not re-derived through the type.
  const five: Keyframe = { position: inHall, target: hallTarget, fov: ROOM_FOV };
  const path = thresholdPath(params, suite, bedB, four, five);

  // STAGES 0, 1 AND 2 ARE NOW DERIVED, AND STAGE 0 CHANGES UNITS.
  //
  // kf[0] was `{ position: [0, 0, 2.6] }` -- 2.6 UNITS, in the globe's own scale, because the
  // globe used to live in a scene of its own and stage 0 -> 1 was a hard cut. P9 removes the
  // cut: there is one frame, in feet, and altitude is the parameter (altitude.ts). So kf[0] is
  // a foot-scale pose 31,353,347 ft up. The picture is nearly the same; every number in it is
  // different. tests/stages.test.ts and tests/altitude.test.ts both assert on it.
  //
  // Stages 1 and 2 keep their azimuths and their aim heights and get new altitudes, because
  // both were mis-pitched against their own names: stage 1 framed 3,268 ft and is called
  // Cambridge, stage 2 framed 790 ft of a 1,269 ft Yard.
  //
  //   stop   was                   now                      frames
  //   0      2.6 units             alt 31,353,347 ft         the globe, filling the frame
  //   1      alt 2,600 ft          alt 16,332 ft             23,000 ft -- Cambridge
  //   2      alt   620 ft          alt    815 ft             1,300 ft -- the whole Yard
  //
  // STAGE 3 MOVED IN P12, AND THE REAL WORLD IS WHY. It stood at [150, 110, 190] -- hand
  // placed, the one Cartesian stop among five derived ones -- and this paragraph used to say
  // it must not move because orbit.ts derives STAGE3_CLAMP from it. That reading was too
  // strong: STAGE3_CLAMP is derived from MASS_RADIUS alone (orbit.ts:126), and what this
  // keyframe owes it is that its own pose falls INSIDE the clamp -- true of the new stop,
  // range 230 ft against 115-345 and pitch 45 against 2-75, and asserted in orbit.test.ts.
  //
  // What forced the move is geo/frame.ts's datum. Until P12 the site frame hung off the
  // WGS-84 ellipsoid, 64 ft above Cambridge's actual ground, so every camera in this file
  // sat 64 ft further above the real world than its own numbers claimed. Google's tiles ARE
  // the real world, and once the datum put them where they belong this stop -- 110 ft up and
  // 190 ft SOUTH of Weld, which is over Widener -- was level with Widener's roof and framed
  // that instead. Measured in the browser: the stage-3 frame was mostly a skylight.
  //
  // So it is built the way stages 0-2 are: obliqueDrop() framing a stated extent of ground
  // at a stated tilt. 270 ft is Weld's own 143.3 ft length with air either side, and the air
  // is measured rather than taken: at 193 ft (the 1.35x GABLE_FRAMING factor) the stop
  // stands 158 ft up and runs the facade off both edges of the frame. The 45 degree tilt
  // continues stage 2's 40, and 38.3 is the azimuth the old Cartesian pose already had --
  // this file's own azimuth comment records it as that shot's angle -- so the swing eastward
  // down the descent is unchanged.
  // Each base stop is built exactly as before -- descentStop()/obliqueDrop() are
  // unchanged -- and then rebuilt through its own GeoPose via viaGeoPose(), so the
  // stage's shot is actually a GeoPose construction (P11-PHOTOREAL.md 2.3) rather
  // than only describable as one. See viaGeoPose()'s own comment for why this is a
  // round trip through the existing pose rather than a fresh build from
  // STAGE{0,1,2}_AZIMUTH_DEG: those constants and GeoPose.headingDeg disagree on
  // which side of the target is which.
  const zero = viaGeoPose(descentStop(STAGE0_ALT, STAGE0_TILT_DEG, STAGE0_AZIMUTH_DEG, 0));
  const one = viaGeoPose(
    descentStop(
      obliqueDrop(CAMBRIDGE_EXTENT, STAGE1_TILT_DEG, DESCENT_FOV),
      STAGE1_TILT_DEG,
      STAGE1_AZIMUTH_DEG,
      40,
    ),
  );
  const two = viaGeoPose(
    descentStop(
      obliqueDrop(YARD_EXTENT, STAGE2_TILT_DEG, DESCENT_FOV),
      STAGE2_TILT_DEG,
      STAGE2_AZIMUTH_DEG,
      30,
    ),
  );
  const three: Keyframe = viaGeoPose(
    descentStop(
      obliqueDrop(WELD_EXTENT, STAGE3_TILT_DEG, DESCENT_FOV),
      STAGE3_TILT_DEG,
      STAGE3_AZIMUTH_DEG,
      42,
    ),
  );

  return {
    0: { ...zero, path: descentPath(zero, one) },
    1: { ...one, path: descentPath(one, two) },
    2: { ...two, path: descentPath(two, three) },
    3: three,
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
 * GENERIC OVER WHICH STAGES HAVE A PATH, since P9. It used to read `if (stage !== 4) return
 * kf[stage]`, because stage 4 was the only stage that travelled rather than sat. P9a gives
 * stages 0, 1 and 2 paths too -- the descent from orbit is a flight, and a flight is a path
 * -- so the test became "does this stage have a path" rather than "is this stage 4". That is
 * strictly more general and it preserves stage 4 exactly: stage 4 has a path, stages 3 and 5
 * do not.
 *
 * THE STAGE-4 FALLBACK IS STILL SPECIAL AND MUST STAY. A suite whose bedroom B and hall are
 * not joined by a door has no route, thresholdPath() returns null, and the straight blend to
 * kf[5] is the answer -- a camera that refused to move at all would be worse than a line.
 * Stages 0-2 have no such fallback because their paths are geometry rather than routing and
 * cannot fail to exist. Collapsing the two cases into `if (!path) return kf[stage]` would
 * silently freeze the camera outside the gable for the four params sets in eighteen that
 * route() cannot solve, which tests/stages.test.ts exercises directly.
 *
 * The path is on kf[stage].path, built by thresholdPath() for stage 4 and by descentPath()
 * for stages 0-2.
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
  const path = kf[stage].path;
  if (!path) {
    // Stage 4 without a route: the straight blend. See the header -- this is the one case
    // where a missing path means "fall back" rather than "this stage is a place".
    if (stage === 4) {
      if (reduced) return t < REDUCED_CUT ? kf[4] : kf[5];
      return blend(kf[4], kf[5], t);
    }
    return kf[stage];
  }
  // The ENDS OF THE PATH, not kf[stage] and kf[stage + 1]. For stage 4 the two are the same
  // pose by construction -- thresholdPath() pins its last stop to the kf[5] object itself --
  // and for a stage whose path ends where it began, a jump cut to its own endpoints is the
  // right reading of "do not animate this".
  if (reduced) return t < REDUCED_CUT ? path[0]!.frame : path[path.length - 1]!.frame;
  return alongPath(path, t);
}

/**
 * How much of stage 4's pose is the PATH's rather than the viewer's, at
 * progress t.
 *
 * 1 at and after SHELL_GONE, which is the whole guarantee this exists for:
 * from the frame the brick reaches zero opacity, the pose is the path's
 * exactly, so the camera crosses the gable perpendicular and every
 * downstream promise -- the routed walk, route.ts's standoff, the 0.5 ft
 * near plane -- is exactly as untouched as it was before stage 4 could be
 * dragged at all.
 *
 * 0 at and below FUNNEL_START, so a drag at the top of the stage is fully
 * the viewer's and the control feels direct rather than rubber-banded.
 *
 * 0.15 is CHOSEN. It has to sit below thresholdOpacity()'s shell ramp, which
 * starts at 0.2: the funnel should have begun pulling the pose back onto the
 * path before the building starts dissolving, or the viewer watches the
 * camera swing while the brick is already going.
 */
export const FUNNEL_START = 0.15;

export function funnel(t: number): number {
  if (t <= FUNNEL_START) return 0;
  if (t >= SHELL_GONE) return 1;
  const u = (t - FUNNEL_START) / (SHELL_GONE - FUNNEL_START);
  return u * u * (3 - 2 * u); // smoothstep: zero derivative at both ends,
} // so neither the drag nor the path starts with a jerk

// stage4Pose() -- composing funnel(t) with the viewer's held orbit into a full
// pose -- lives in orbit.ts, not here, alongside stage4OrbitKeyframe() and
// transitPose(). It needs transitPose's spherical-about-MASSING_CENTER blend
// (a straight blend() here dipped into the real massing at t ~= 0.36 for an
// orbit near STAGE4_CLAMP's own minRadius -- the same failure mode
// transitPose's own docblock records finding for the stage 3 -> 4 transit),
// and this module must not import orbit.ts: orbit.ts already imports
// GABLE_BACK and `type Keyframe` from here, and importing back would be a
// real cycle rather than the type-only one that direction is.

/**
 * Which stages need the world, Weld's shell, and the interior mounted.
 *
 * MOUNTING, NOT OPACITY, and P9 makes the distinction matter. This is a function of the stage
 * because it is read during React's render; the layers' opacities are functions of ALTITUDE
 * and are applied per frame from inside useFrame, where the camera can be read. altitude.ts's
 * layerOpacity() is the other half and the two must not be confused: this decides what exists,
 * that decides what is seen.
 *
 * RENAMED FROM `campus` TO `tiles`, per docs/phases/P11-PHOTOREAL.md 3.2's own line on this
 * function: "visibility() loses campus/globe, gains tiles." This task keeps `globe` -- Globe.tsx
 * is untouched and still the stage-0 backdrop; retiring it for good is the later swap decision 2
 * describes, not this bug fix -- but `campus` becomes `tiles` because this is the one flag that
 * gates Ground/Campus/FallbackGround today and will gate Tiles.tsx once it is wired to mount
 * conditionally (Tiles.tsx itself has no `visible` prop yet and is unconditionally mounted
 * whenever a key is present -- see Experience.tsx's HAS_TILES_KEY comment -- so this flag is
 * ready for it without a further change here).
 *
 * docs/phases/P11-PHOTOREAL.md 0.7, THE BUG THIS FIXES. `campus` used to read `stage <= 3`, so
 * Experience.tsx unmounted Ground, Campus and FallbackGround at stage 4 -- the fly-through into
 * Weld -- leaving the dissolving shell floating against nothing. Measured at u = 0.93: the frame
 * was Weld's shell against empty background. `tiles` extends through stage 4 to fix exactly
 * this, matching the user's own framing of the fix: "stage 3 and 4 should essentially just be
 * the same thing."
 *
 * STAGE 0 STAYS TRUE, unchanged from `campus`'s own precedent (see the paragraph this replaces
 * below) -- and the reasoning STRENGTHENS rather than weakens under the rename. FallbackGround's
 * quads are gated a second time by their own per-quad altitude opacity (layerOpacity), so
 * mounting them at orbit costs geometry only and never a draw call. The live Tiles path is the
 * stronger case: real photorealistic 3D tiles ARE visible continuously from orbit altitude in an
 * actual Google Earth flyby -- unlike a flat NAIP quad, showing them at stage 0 is not a
 * placeholder cost to bound, it is decision 2's own "Orbit -> Yard, all of it." So `tiles` being
 * true at stage 0 is doing real work for the live path and bounded-cost warm-up for the fallback
 * path, which is a stronger position than `campus` was ever in.
 *
 * STAGE 5 IS NOW TRUE TOO -- P14 row 8 reverses the paragraph this replaces. That
 * reasoning ("the camera is behind Weld's exterior walls for the whole stage, so the world
 * outside them is never in frame") held exactly until sash.ts's window fix: Suite.tsx's
 * glazing sits in a real hole in the wall now, not a solid panel, so a window IS a frame
 * onto whatever `tiles` mounts. Leaving `tiles` false at stage 5 is what made every window
 * read as a flat sky-blue panel (Lighting.tsx's own comment on `scene.background` names
 * this exact defect). `weld` stays the stage window it always was -- the parametric shell
 * is still an editing/model-mode convenience, not stage 5's own exterior -- and `interior`
 * is unchanged; only what a WINDOW can now see is new.
 *
 * WHAT THAT COSTS. FallbackGround is two shader-tinted ground quads plus one merged campus
 * mesh (CampusMesh.tsx/FallbackGround.tsx load `campus.glb` as a single THREE.Mesh, not one
 * per building) -- 3 draw calls, keyless. Outlook.tsx mounts it (or live Tiles, keyed)
 * exactly where Experience.tsx used to stop at stage 4; see its own header for why this
 * needed a component of its own rather than another line in the existing `tiles` ternary.
 *
 * WHAT THAT COSTS AT FIRST PAINT. Stage 0 is first paint (Globe.tsx records the measurement),
 * so mounting 36 extruded buildings there is not free. It is bounded by their own opacity: the
 * massing band is zero above 40,000 ft, and a group whose opacity is zero is set invisible
 * rather than drawn transparent, so the draw calls are not issued while the camera is in
 * orbit. The geometry is built, which is the cost that remains, and it is the cost that buys a
 * warm campus by the time the camera is low enough to see it -- the same argument the interior
 * line below has always made.
 */
export function visibility(stage: StageId): {
  globe: boolean;
  tiles: boolean;
  weld: boolean;
  interior: boolean;
} {
  return {
    globe: stage === 0,
    tiles: stage <= 5,
    weld: stage >= 2 && stage <= 4,
    // Mounted a stage early so its geometry is warm before the threshold needs it.
    interior: stage >= 3,
  };
}
