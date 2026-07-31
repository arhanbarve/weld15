"use client";

import type { ReactElement } from "react";
import { EffectComposer, Bloom, N8AO } from "@react-three/postprocessing";
import { useStore } from "@/state/store";

/**
 * Bloom, plus ambient occlusion at stage 5.
 *
 * BLOOM. The threshold is deliberately high: a cyanotype is mostly thin bright
 * lines, and a low threshold blooms the whole campus into mush. At 0.75 only
 * Weld's white highlighted edges bloom, which is the point -- it is one of the
 * three signals marking Weld, alongside line width and the label chip.
 *
 * AO. geo/pieces.ts's per-part furniture geometry and geo/trim.ts's baseboard
 * and cornice (P10) are exactly the fine, close-set surfaces contact shadow
 * makes read as real -- a drawer front, a baseboard against the floor -- and
 * a single directional sun with no bounce leaves them looking pasted on.
 * N8AO is this package's screen-space GTAO-family implementation; `quality`
 * stays at its default rather than tuned, because this project has no
 * frame-time-tiered quality mechanism to key it off yet (Lighting.tsx's
 * shadow measurement is the only precedent, and it is a fixed cost, not a
 * dial). Confined to stage 5 because that is where this phase's fine
 * geometry lives -- campus.spec.ts's exterior draw-call gates were measured
 * without it, and AO over WeldExterior's flat cyanotype panels buys nothing
 * a viewer would notice.
 *
 * EffectComposer's children type wants real elements, not `false`, so the
 * pass list is built as an array and filtered rather than written as an
 * inline `stage === 5 && <N8AO />` -- the obvious version does not compile.
 * `key` on EffectComposer forces a clean remount when AO's presence changes,
 * rather than trusting the library to notice its own children arrangement
 * changed shape between renders.
 *
 * Both disabled entirely under reduced motion. Neither is motion, but both
 * are additional visual intensity, and the cheapest respectful default is to
 * drop them.
 */
export function Effects() {
  const reduced = useStore((s) => s.reducedMotion);
  const stage = useStore((s) => s.stage);
  if (reduced) return null;
  const ao = stage === 5;
  const passes = [
    <Bloom key="bloom" luminanceThreshold={0.75} luminanceSmoothing={0.25} intensity={0.7} mipmapBlur />,
    ao ? <N8AO key="ao" aoRadius={1.2} intensity={2.5} distanceFalloff={1} halfRes /> : null,
  ].filter((p): p is ReactElement => p !== null);
  return <EffectComposer key={ao ? "ao" : "no-ao"}>{passes}</EffectComposer>;
}
