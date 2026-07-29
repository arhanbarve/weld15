"use client";

import dynamic from "next/dynamic";

/**
 * Client boundary for the WebGL scene.
 *
 * `next/dynamic` with `ssr: false` is rejected inside a Server Component under
 * the App Router, so the lazy import has to live in a Client Component. This
 * file exists for that reason and no other.
 *
 * The fallback reserves the full viewport so there is no layout shift when the
 * canvas mounts.
 */
const Experience = dynamic(() => import("./Experience"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--void)",
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--mono)",
        fontSize: "0.75rem",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: "var(--faint)",
      }}
    >
      Loading Weld 15
    </div>
  ),
});

export default function CanvasHost() {
  return <Experience />;
}
