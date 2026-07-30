import { create } from "zustand";
import { DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";

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

type Store = {
  stage: StageId;
  /** Progress within the current stage, 0..1. Only stage 4 uses it. */
  t: number;
  params: SuiteParams;
  /** Set once from the media query; a branch, not a duration. */
  reducedMotion: boolean;

  setStage: (s: StageId) => void;
  setT: (t: number) => void;
  next: () => void;
  prev: () => void;
  skipToSuite: () => void;
  setReducedMotion: (v: boolean) => void;
  setParams: (p: Partial<SuiteParams>) => void;
};

export const useStore = create<Store>((set) => ({
  stage: 0,
  t: 0,
  params: DEFAULT_PARAMS,
  reducedMotion: false,

  setStage: (stage) => set({ stage, t: 0 }),
  setT: (t) => set({ t: Math.min(1, Math.max(0, t)) }),
  next: () => set((s) => ({ stage: Math.min(LAST_STAGE, s.stage + 1) as StageId, t: 0 })),
  prev: () => set((s) => ({ stage: Math.max(0, s.stage - 1) as StageId, t: 0 })),
  skipToSuite: () => set({ stage: LAST_STAGE, t: 1 }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),
}));
