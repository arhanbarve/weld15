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

    (window as unknown as { __perf?: unknown }).__perf = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      lines: gl.info.render.lines,
      geometries: gl.info.memory.geometries,
      frames: f.length,
      medianMs: sorted.length ? +sorted[Math.floor(sorted.length / 2)]!.toFixed(2) : null,
    };

    gl.info.reset();
  });

  return null;
}
