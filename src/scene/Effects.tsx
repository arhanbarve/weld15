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
 */
export function Effects() {
  const reduced = useStore((s) => s.reducedMotion);
  if (reduced) return null;
  return (
    <EffectComposer>
      <Bloom luminanceThreshold={0.75} luminanceSmoothing={0.25} intensity={0.7} mipmapBlur />
    </EffectComposer>
  );
}
