/**
 * The sampled poses P13's preloader registers as synthetic cameras (docs/phases/P13-PRELOAD.md
 * section 4), and nothing else -- no THREE, no TilesRenderer, no DOM. Pure so it can be
 * unit-tested without a browser and so `Preload.tsx` has one place to ask "what to load" that
 * is not itself entangled with "how to load it".
 *
 * SAMPLED IN u, NOT IN (stage, t) DIRECTLY. journey.ts's toJourney/fromJourney already weight
 * the three descent legs by DECADES OF ALTITUDE (its own header explains why), so uniform
 * spacing in u is uniform spacing in the axis tile LOD actually moves on -- the same reason
 * FlyDown.tsx's SECONDS_PER_DECADE and journey.ts's own leg weights exist. Sampling stage/t
 * directly would waste density on the transit and threshold legs (TRANSIT_SPAN 0.6,
 * THRESHOLD_SPAN 0.9 are already generous shares of the bar for how little altitude they
 * cross) and starve stage 0's 3.28 decades.
 *
 * ORBIT IS ALWAYS NULL. Every sampled pose is journeyPose(kf, stage, t, false, null, null) --
 * the stage's own default framing, never a live drag. A heading drag to an orbit the
 * preloader never sampled still streams; docs/phases/P13-PRELOAD.md section 1 accepts this
 * ("descent path only", decision 1) rather than trying to cover every possible orbit at every
 * stage, which is unbounded.
 *
 * STAGE 5 IS NEVER SAMPLED. visibility(stage).tiles is false there (stages.ts) -- the walker
 * stands behind Weld's exterior walls for the whole stage, and Google's own Weld is never in
 * frame. There is nothing for a stage-5 pose to preload.
 */
import type { SuiteParams } from "@/geo/rooms";
import type { StageId } from "@/state/store";
import { keyframes, type Keyframe } from "./stages";
import { journeyPose } from "./pose";
import { fromJourney } from "./journey";
import { altitudeOf } from "./geo/frame";

/** One sampled pose along the descent, plus which batch it belongs to. */
export type PreloadPose = {
  /** Journey parameter this pose was sampled at, 0 (orbit) to 1 (crossing the threshold). */
  u: number;
  stage: StageId;
  t: number;
  pose: Keyframe;
  /** Height above the WGS-84 ellipsoid, ft -- geo/frame.ts's altitudeOf, the same definition CameraRig's own probe uses. */
  altFt: number;
  /**
   * 0-indexed, HIGH ALTITUDE FIRST. docs/phases/P13-PRELOAD.md section 4: coarse tiles land
   * before fine ones, so the frame behind the overlay is never empty, and (if tier 3 ever
   * fires) errorTarget can step down monotonically batch by batch.
   */
  batch: number;
};

/**
 * Total sampled poses across the whole descent.
 *
 * WAS 28 (~0.256 decades of altitude per sample), MEASURED WRONG -- caught by
 * scripts/verify-retention.mjs's own step 4 run, not assumed correct. A full u = 0 -> 1 -> 0
 * scrub along the exact preloaded path re-fetched 430 of 2,906 tiles (~15%): tile selection is
 * continuous with altitude, and 28 samples across the measured 7.16-decade journey (3.28 + 1.32
 * + 1.06 descent legs, plus TRANSIT_SPAN 0.6 and THRESHOLD_SPAN 0.9 of journey.ts's own
 * "decades" unit) left real gaps between consecutive samples -- e.g. u=0.111 to u=0.148 alone
 * spans a 1.77x altitude ratio, and Google's own SSE-driven selection is sensitive enough at
 * that scale to want tiles neither neighbour's camera asked for.
 *
 * 56, doubling the density (~0.128 decades/sample), is the first correction -- re-measure
 * scripts/measure-preload.mjs and scripts/verify-retention.mjs after any further change to
 * this constant; a bounded residual can be disclosed (LoadingBar.tsx covers ordinary
 * in-app streaming for exactly this case) but should not be assumed away.
 */
export const N_POSES = 56;

/** Poses per batch. 56 / 8 = 7 batches, matching the 7 named legs in the overlay copy table. */
export const POSES_PER_BATCH = 8;

export const TOTAL_BATCHES = Math.ceil(N_POSES / POSES_PER_BATCH);

/**
 * The sampled poses, high altitude (u=0) to low (u=1), batched in groups of
 * POSES_PER_BATCH -- batch 0 is the four highest-altitude samples, not the four earliest
 * in u; since u and altitude both decrease monotonically along the descent (stages.ts's own
 * "descends monotonically" regression fence), sampling in ascending u already IS descending
 * altitude, so no separate sort is needed.
 */
/**
 * Kept strictly below 1 when resolving (stage, t): journey.ts's fromJourney maps u = 1 to
 * {stage: 5, t: 0} exactly (its own header explains why -- that is the same POSE as stage
 * 4's t = 1, not a different one, so the mapping is a label choice, not a geometry one), and
 * "stage 5" is exactly the label this file's own header says never gets sampled. Clamping the
 * u fed to fromJourney -- while still RECORDING the true, evenly-spaced u on the returned
 * pose -- means the last sample lands on that same crossing pose under the stage-4 label
 * instead of being skipped, so nothing between orbit and the threshold goes unsampled.
 */
const STAGE5_EPS = 1e-6;

export function preloadPoses(params: SuiteParams): PreloadPose[] {
  const kf = keyframes(params);
  const out: PreloadPose[] = [];
  for (let i = 0; i < N_POSES; i++) {
    const u = i / (N_POSES - 1);
    const { stage, t } = fromJourney(Math.min(u, 1 - STAGE5_EPS), params);
    const pose = journeyPose(kf, stage, t, false, null, null);
    out.push({
      u,
      stage,
      t,
      pose,
      altFt: altitudeOf(pose.position),
      batch: Math.floor(i / POSES_PER_BATCH),
    });
  }
  return out;
}
