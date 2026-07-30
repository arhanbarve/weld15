import { create } from "zustand";
import { DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";
import type { Orbit } from "@/scene/orbit";

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

  /** Roof and ceiling off, so the suite can be read from above. */
  cutaway: boolean;

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
  setCutaway: (v: boolean) => void;
};

export const useStore = create<Store>((set) => ({
  stage: 0,
  t: 0,
  params: DEFAULT_PARAMS,
  reducedMotion: false,
  date: DEFAULT_DATE,
  hour: DEFAULT_HOUR,
  orbit: null,
  cutaway: false,

  setStage: (stage) => set({ stage, t: 0 }),
  setT: (t) => set({ t: Math.min(1, Math.max(0, t)) }),
  next: () => set((s) => ({ stage: Math.min(LAST_STAGE, s.stage + 1) as StageId, t: 0 })),
  prev: () => set((s) => ({ stage: Math.max(0, s.stage - 1) as StageId, t: 0 })),
  skipToSuite: () => set({ stage: LAST_STAGE, t: 1 }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
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
  setCutaway: (cutaway) => set({ cutaway }),
}));
