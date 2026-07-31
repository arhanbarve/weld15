"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";

/**
 * Publishes renderer stats to window.__perf so Playwright can read them.
 *
 * Two traps, both hit while writing this.
 *
 * 1. renderer.info resets on every render() call, and the post-processing composer
 *    renders several times per frame, so a naive read reports only the final
 *    fullscreen quad: 1 call, 1 triangle. autoReset is disabled so the whole frame
 *    accumulates, and this hook resets it once per frame instead.
 *
 * 2. useFrame with a priority above 0 makes R3F hand rendering over to the caller.
 *    An earlier version used priority 1 to read stats "after" the render and thereby
 *    disabled the render loop. The scene still appeared, because the composer does
 *    its own rendering -- but with the composer switched off the canvas was blank
 *    while cheerfully reporting a healthy 8.3 ms and zero draw calls. So this runs
 *    at the default priority and reads the PREVIOUS frame's accumulated totals,
 *    which is one frame stale and entirely adequate.
 *
 * Frame time is recorded but must not be used as a gate: headless Chromium runs
 * SwiftShader in software, where the bloom pass costs about 70 ms against roughly
 * 1-3 ms on a real GPU. Draw calls and triangle counts are hardware-independent,
 * and those are what the tests assert.
 */
export function Perf() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const frames = useRef<number[]>([]);

  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);

  useFrame((_, delta) => {
    const f = frames.current;
    f.push(delta * 1000);
    if (f.length > 120) f.shift();
    const sorted = [...f].sort((a, b) => a - b);

    /**
     * `shadows` and `casters` are here so that the shadow pass is GATEABLE rather than
     * assumed.
     *
     * Draw calls alone cannot tell you shadows are working: turning every caster off
     * lowers the count, which a budget assertion reads as an improvement. And the cost
     * is real and was measured when the flags went on -- stage 5 went from 27 draw calls
     * to 35, the eight being the furniture's shadow pass, one per instanced batch. So a
     * test needs to be able to say "the second pass is present and it is drawing these
     * casters", and pixels alone cannot say that either: a shadow and a dark oak board
     * are the same pixels.
     *
     * Counted by traversal rather than tracked, because the flags are set per mesh in
     * three files and a count kept anywhere else would be a fourth place to forget.
     */
    let casters = 0;
    scene.traverse((o) => {
      if ((o as { castShadow?: boolean }).castShadow) casters++;
    });

    (window as unknown as { __perf?: unknown }).__perf = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      lines: gl.info.render.lines,
      geometries: gl.info.memory.geometries,
      /**
       * Live texture count, added in P9b on the same argument this file already makes for
       * `casters`: a budget that cannot be asserted is a budget that will be exceeded quietly.
       *
       * P9 ships five plates (2.20 MB of AVIF) and decodes them into GPU memory, where they are
       * far larger than on disk -- L4 alone is 3072 x 3072 RGBA plus mipmaps, about 50 MB
       * resident. The failure mode is not a crash but a slow leak: a component that reloads a
       * level on every params change and never disposes climbs until the driver starts evicting,
       * and the symptom is a frame-time cliff a long way from the cause. imagery.ts's loader
       * returns a disposer for exactly that reason, and this is how a gate can tell whether it is
       * being called.
       */
      textures: gl.info.memory.textures,
      shadows: gl.shadowMap.enabled,
      casters,
      frames: f.length,
      medianMs: sorted.length ? +sorted[Math.floor(sorted.length / 2)]!.toFixed(2) : null,
    };

    gl.info.reset();
  });

  return null;
}
