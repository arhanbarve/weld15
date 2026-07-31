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
 *
 * AND IT IS ALSO THE BOUNDARY THAT CATCHES ANY SUSPENDING CHILD OF <Canvas>, which is a
 * host-level fact and so it is recorded here rather than in a scene file.
 *
 * R3F wraps <Canvas>'s children in a Suspense of its own, and its fallback is <Block>,
 * which sets a promise that never resolves and which CanvasImpl then throws --
 * `if (block) throw block` in @react-three/fiber. So a scene child that suspends does not
 * suspend inside the canvas; it suspends the canvas, up to the nearest boundary OUTSIDE it,
 * which in this app is this file's `loading`. Measured on a served production build while
 * testing P8's globe split (Globe.tsx has the byte counts): with the globe behind
 * lazy(() => import("./Globe")) and no boundary of its own, and its chunk delayed 2,500 ms,
 * the page showed the real UI at +461 ms, reverted to "LOADING WELD 15" at +763 ms -- HUD,
 * canvas and all -- and came back at +3,189 ms. With an inner <Suspense fallback={null}>
 * the canvas survives, and stage 0 is an empty void for the same 2.4 s instead.
 *
 * The consequence for anything added later: a scene child that can suspend -- useLoader, a
 * lazy component, drei's useGLTF -- needs its own Suspense inside <Canvas>, or the whole
 * page blinks back to this loading screen.
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
