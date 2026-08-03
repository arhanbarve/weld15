"use client";

import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useStore } from "@/state/store";

/**
 * One bloom pass. Nothing else post.
 *
 * The threshold is deliberately high: a cyanotype is mostly thin bright lines, and
 * a low threshold blooms the whole campus into mush. At 0.75 only Weld's white
 * highlighted edges bloom, which is the point -- it is one of the three signals
 * marking Weld, alongside line width and the label chip.
 *
 * Disabled entirely under reduced motion. Bloom is not motion, but it is
 * additional visual intensity, and the cheapest respectful default is to drop it.
 *
 * P10 TRIED N8AO (screen-space ambient occlusion) HERE, AT STAGE 5, AND DROPPED
 * IT. geo/pieces.ts's per-part furniture and geo/trim.ts's baseboard and cornice
 * are exactly the fine, close-set surfaces contact shadow makes read as real, so
 * the idea was sound -- but N8AO is a real per-frame screen-space pass, and
 * Perf.tsx's own header already warns why that is dangerous here: "headless
 * Chromium runs SwiftShader in software, where the bloom pass costs about 70 ms
 * against roughly 1-3 ms on a real GPU... frame time must not be used as a gate."
 * N8AO's cost under SwiftShader turned out to be severe enough to break tests
 * that have nothing to do with rendering quality: tests/e2e/walk.spec.ts's
 * "walks the hall end to end" holds a key for a fixed WALL-CLOCK duration
 * (holdUntil's `maxMs`) and reads distance off however many frames actually
 * rendered in that window, and perf.spec.ts's composer test timed out at 90 s
 * outright. Gating N8AO on a measured frame time -- the fix that would otherwise
 * suggest itself -- is exactly what Perf.tsx's header says not to do, since the
 * effect's own cost is what would make the measurement high in the first place.
 * With no frame-time-tiered quality mechanism in this project to key it off some
 * other way, and the furniture/trim/window fidelity work this phase actually
 * asked for already shipped and already tested, N8AO was cut rather than risking
 * the load-bearing walk and perf suites for a subtle contact-shadow improvement.
 * The environment map and the plaster tooth (both one-time costs, not a
 * per-frame pass) stayed.
 *
 * `active` IS FALSE AT THE LAST STAGE, ON PURPOSE. The threshold is tuned for Weld's
 * white highlighted edges seen from outside (stages 0-4, where `visibility()`'s own
 * `weld` window lives) -- indoors, the same 0.75 cutoff catches the bathroom's bright
 * porcelain and its mirror (materials.ts's own `mirror`, which reflects a bright
 * environment map by design) and blooms the sink, a fixture this effect was never
 * meant to touch. Suite.tsx's interior only ever reaches full opacity at the last
 * stage, so that is exactly where this effect needs to stand down.
 */
export function Effects({ active = true }: { active?: boolean }) {
  const reduced = useStore((s) => s.reducedMotion);
  if (reduced || !active) return null;
  return (
    <EffectComposer>
      <Bloom luminanceThreshold={0.75} luminanceSmoothing={0.25} intensity={0.7} mipmapBlur />
    </EffectComposer>
  );
}
