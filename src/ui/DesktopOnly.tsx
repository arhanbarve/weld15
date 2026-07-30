"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * The desktop gate: either the app, or the reason it is not here.
 *
 * Mobile support is cut on purpose. The app is a six-stage camera journey with
 * drag-to-orbit and furniture you drag around, and a touch variant of all of that
 * is a second interaction model rather than a media query. So a phone gets a
 * message instead of a canvas that half works.
 */

/**
 * The threshold, measured on the SHORTER viewport side, px.
 *
 * Short side rather than width, because width alone cannot separate the two cases:
 * an iPhone 16 Pro Max in landscape is 956 px wide and an iPad mini in portrait is
 * 744, so any width that catches the phone also catches the tablet. Turned on their
 * sides the two are nowhere near each other -- no phone's short side clears 440
 * (that same 16 Pro Max), and no tablet's falls below 744 (that same iPad mini).
 * 600 sits in the middle of that gap with roughly 160 px of room on either hand,
 * and it is between two rungs of MASTER.md's 375/768/1024/1440 ladder rather than
 * on one, so it cannot be mistaken for a layout breakpoint. Nothing about the
 * layout changes here; only whether the app runs at all.
 */
const SHORT_SIDE_PX = 600;

/**
 * A coarse primary pointer. This is the half of the test that carries the meaning:
 * `pointer` reports the PRIMARY pointing device, so a touchscreen laptop still says
 * `fine` and is let through, which is right -- it has a trackpad.
 */
const COARSE = "(pointer: coarse)";

/**
 * Small on either axis. A comma-separated media query LIST, which is an or, rather
 * than the level 4 `or` keyword: matchMedia reports a query it cannot parse as
 * simply not matching, and a gate that fails open on older Safari is worse than one
 * written in syntax every browser has had for twenty years.
 *
 * The px values only mean anything because the document carries
 * `width=device-width` -- Next injects that viewport meta tag itself. Without it
 * Chromium lays a phone out at its 980 px fallback width and both of these read
 * false on a device that is plainly a phone. Confirmed by probing a real page and
 * `about:blank` side by side: 390 against 980 in the same context.
 */
const SMALL = `(max-width: ${SHORT_SIDE_PX - 1}px), (max-height: ${SHORT_SIDE_PX - 1}px)`;

export default function DesktopOnly({ children }: { children: ReactNode }) {
  /**
   * Three states, and the third one is the point.
   *
   * The page is statically prerendered, so at build time there is no viewport to
   * ask and the server cannot answer this. Both answers are wrong to guess: render
   * the app and a phone shows the 3D canvas before swapping it for the message,
   * render the message and every desktop reads "open this on a laptop" for a frame.
   * Null is neither, and it renders nothing at all -- the void ground the body
   * already paints. Server and hydration agree on it, so there is no mismatch and
   * no flash; the only visible cost is a frame of empty blue, which on a desktop is
   * hidden inside the far longer wait for the WebGL chunk anyway.
   *
   * No-JS therefore gets a blank page. That is not a regression: Experience is
   * loaded with `ssr: false`, so no-JS was already blank before this file existed.
   */
  const [blocked, setBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    const queries = [window.matchMedia(COARSE), window.matchMedia(SMALL)];
    // Both, never either. A narrow desktop window is still a desktop, and a large
    // tablet with a mouse is usable.
    const read = () => setBlocked(queries.every((q) => q.matches));
    read();
    // Listened for rather than read once: rotating a phone and dragging a desktop
    // window narrow both cross this line, and a gate decided at mount would then be
    // showing the wrong one of the two things until a reload.
    for (const q of queries) q.addEventListener("change", read);
    return () => {
      for (const q of queries) q.removeEventListener("change", read);
    };
  }, []);

  if (blocked === null) return null;
  return blocked ? <DesktopMessage /> : <>{children}</>;
}

/**
 * Not an error state, and styled as though it were the cover of the thing.
 *
 * For some people this is the entire project, so it says what is on the other side
 * of it in the same voice the rest of the app uses: the room is named, dated and
 * measured, and the reason for the gate is the interaction, not the device. It does
 * not apologise and it does not tell anyone their browser is unsupported.
 *
 * `<main>` here and `<main>` around the canvas in page.tsx, so the document has
 * exactly one landmark either way, and a screen reader gets a heading and two
 * sentences of prose rather than a wall of divs. The locator reuses `.weld-chip`,
 * the same crimson-bordered mono chip that labels Weld in the scan.
 */
function DesktopMessage() {
  return (
    <main className="gate" data-testid="desktop-only">
      <div className="gate-card">
        {/* Written with a comma rather than the middle dot the scan chip would use,
            because a screen reader may well read the dot out. */}
        <p className="weld-chip gate-locator">Weld 15, Harvard Yard</p>
        <h1 className="gate-title">Open Weld 15 on a laptop</h1>
        <p className="gate-prose">
          Weld 15 is a 3D model you fly down into: a globe, then Harvard Yard, then straight through
          the brick wall of Weld Hall into one room. Inside it, you drag the furniture around. That
          wants a mouse and a screen with some room on it, so it runs on a desktop or a laptop.
        </p>
        <p className="gate-prose">
          Open it on one and you land in a four-person suite on the first floor of Weld Hall: brick
          and slate from 1872, two bedrooms and two common rooms, drawn from Harvard&rsquo;s published
          dimensions and lit by the sun that actually falls on that facade.
        </p>
      </div>
    </main>
  );
}
