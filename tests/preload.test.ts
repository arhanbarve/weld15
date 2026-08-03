import { describe, it, expect } from "vitest";
import { getPreloadProbe, UNLOCK_AFTER_BATCH } from "@/scene/Preload";
import { HAS_TILES_KEY } from "@/scene/Tiles";
import { TOTAL_BATCHES } from "@/scene/preloadPlan";

/**
 * Preload.tsx's frame loop (`useFrame`, module-scope singletons off Tiles.tsx's own
 * `getTiles()`/`getProbe()`) is the same shape FallbackGround.tsx already is
 * (tests/fallbackGround.test.ts's own header): this repo has no jsdom / @testing-library
 * and no @react-three/test-renderer, so a render-level test of Preload's actual batch loop
 * is not idiomatic here -- that loop (registering cameras, polling idle frames, deciding
 * `j.batch > UNLOCK_AFTER_BATCH` frame by frame) is exercised for real only by
 * tests/e2e/preload.spec.ts, which drives a live WebGL context against Google's own tiles
 * and asserts `unlockable` observably flips true strictly before `done` does.
 *
 * What IS pure and importable outside a Canvas is covered here: the initial probe shape
 * (`getPreloadProbe()`, before any `Preload` component ever mounts) and the one invariant
 * that determines whether progressive unlock can possibly do anything at all --
 * `UNLOCK_AFTER_BATCH`'s position relative to `TOTAL_BATCHES`.
 */
describe("Preload's progressive-unlock probe (unit-level, pre-mount)", () => {
  it("unlockable starts in lockstep with done -- both false (BOOT_PROBE, keyed) or both true (DISABLED_PROBE, keyless)", () => {
    // HAS_TILES_KEY is a build-time constant (NEXT_PUBLIC_GOOGLE_MAPS_KEY): this test adapts
    // to whichever branch the process running vitest actually took, rather than assuming
    // one, since re-deriving a key-bearing env for this file alone would be a second place
    // for that decision to drift out of step with Tiles.tsx's own.
    const probe = getPreloadProbe();
    expect(probe.unlockable).toBe(probe.done);
    if (HAS_TILES_KEY) {
      // BOOT_PROBE: nothing has loaded yet, so neither flag can be true.
      expect(probe.done).toBe(false);
      expect(probe.unlockable).toBe(false);
      expect(probe.batch).toBe(0);
    } else {
      // DISABLED_PROBE: `!HAS_TILES_KEY` short-circuits straight to fully settled.
      expect(probe.done).toBe(true);
      expect(probe.unlockable).toBe(true);
      expect(probe.batch).toBe(TOTAL_BATCHES);
      expect(probe.progress).toBe(1);
    }
  });

  it("UNLOCK_AFTER_BATCH leaves at least one real batch to publish unlockable:true before done ever fires", () => {
    // Preload.tsx's `useFrame` loop only ever publishes a "loading" probe (the one that
    // computes `unlockable: j.batch > UNLOCK_AFTER_BATCH`) for `j.batch` values 0 through
    // TOTAL_BATCHES - 1 -- once `j.batch` reaches TOTAL_BATCHES, the phase has already
    // flipped to "finalizing" and no further "loading" publish happens for that value. So
    // the only way `unlockable` can ever be observed true DURING loading (as opposed to
    // simultaneously with `done`, at the very end) is if some batch strictly between
    // UNLOCK_AFTER_BATCH and TOTAL_BATCHES - 1 (inclusive) still gets to publish.
    //
    // UNLOCK_AFTER_BATCH >= TOTAL_BATCHES - 1 would mean `j.batch > UNLOCK_AFTER_BATCH` is
    // false for every batch value the "loading" phase ever actually publishes -- i.e.
    // `unlockable` would only ever flip true in the final "done" publish, at the exact same
    // moment as `done` itself. That is precisely the dead-code failure mode this invariant
    // exists to catch: batch UNLOCK_AFTER_BATCH (5) never settling meaningfully before the
    // whole descent (batch TOTAL_BATCHES - 1 = 6, plus finalizing) does, silently turning
    // progressive unlock into a no-op even though the code path still runs.
    expect(UNLOCK_AFTER_BATCH).toBeGreaterThanOrEqual(0);
    expect(
      UNLOCK_AFTER_BATCH,
      `UNLOCK_AFTER_BATCH (${UNLOCK_AFTER_BATCH}) must leave at least one batch strictly ` +
        `before the last (TOTAL_BATCHES - 1 = ${TOTAL_BATCHES - 1}) to publish unlockable:true ` +
        `during "loading", or progressive unlock can never fire before done`,
    ).toBeLessThan(TOTAL_BATCHES - 1);
  });
});
