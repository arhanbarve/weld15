"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { latLonToSite } from "@/geo/frames";

/**
 * Place names that arrive and leave with altitude: North America down to Weld Hall.
 *
 * WHAT THIS IS FOR. Without it the descent is three decades of photograph with nothing to say
 * where you are, and the whole point of the sequence is that it goes somewhere specific. A Google
 * Earth fly-to names what you are passing; so does this.
 *
 * REUSES Campus.tsx's PATTERN AND ITS CSS -- drei's <Html> plus `.weld-chip` -- rather than
 * inventing a second one. That file already solved the three things that are easy to get wrong
 * here: the chip sits on a solid ground so it stays legible over a bright photograph,
 * `zIndexRange` keeps it under the HUD instead of over it, and the type is already sized and
 * tracked to read at a glance. Two chip mechanisms would drift. The one thing NOT copied is
 * `distanceFactor`, and the reason is at its call site.
 *
 * WELD HALL IS DELIBERATELY NOT IN THE TABLE. Campus.tsx already mounts a "Weld Hall" chip, tied
 * to `highlightWeld` and therefore to the same condition that brightens Weld's edges -- one signal,
 * three expressions, which is what MASTER.md asks for. Adding a second Weld chip here would
 * double-label it at stages 2 and 3.
 *
 * ACCESSIBILITY: EVERY CHIP IS aria-hidden AND NONE IS FOCUSABLE.
 *
 * These are decorative duplicates of information the canvas already carries -- Experience.tsx's
 * canvas label names the place, and A11yAlt writes the full prose description -- so putting six
 * more nodes into the accessibility tree would make a screen reader read the same place name
 * twice, and putting them in the tab order would insert six dead stops between the skip control
 * and the HUD. tests/e2e/a11y.spec.ts runs axe over this and asserts a four-stop tab order, so a
 * focusable chip here fails a gate rather than merely being rude.
 */

/**
 * The places, and the altitudes they belong to.
 *
 * `in` and `out` are read the way altitude.ts's bands are read -- as the camera DESCENDS -- so
 * `in` is the altitude at which the chip starts appearing and `out` the altitude by which it has
 * gone. Each band overlaps its neighbours, so the sequence never has a frame with no label at all
 * between the globe and the Yard.
 *
 * THE LATITUDES AND LONGITUDES ARE REAL, and they matter more than they look. Every position goes
 * through latLonToSite(), the same function campus.json's footprints and the imagery resampling
 * went through, so a chip lands on the thing it names rather than near it. "Boston" at
 * 42.3555/-71.0565 is Downtown Crossing; "Cambridge" at 42.3736/-71.1097 is Central Square, not
 * the Yard, which is the point -- a Cambridge label sitting on Harvard would be wrong about the
 * city it is naming.
 *
 * The two continental labels are placed at the centre of what they name rather than at Weld, so
 * they drift off frame as the camera descends toward Massachusetts, which is the correct
 * behaviour: North America's label has no business hovering over the Yard.
 */
type Place = {
  label: string;
  lat: number;
  lon: number;
  /** Altitude at which it begins to appear, ft. */
  in: number;
  /** Altitude by which it has gone, ft. */
  out: number;
  /** Feet above grade to float the chip, so it clears the massing at the low end. */
  height?: number;
};

const PLACES: Place[] = [
  // Geographic centre of the continent, roughly: it only ever shows while the globe is up.
  { label: "North America", lat: 45.0, lon: -100.0, in: 8_000_000, out: 900_000 },
  { label: "New England", lat: 43.8, lon: -71.5, in: 1_400_000, out: 190_000 },
  { label: "Boston", lat: 42.3555, lon: -71.0565, in: 260_000, out: 26_000 },
  { label: "Cambridge", lat: 42.3736, lon: -71.1097, in: 40_000, out: 3_400 },
  // IN THE OLD YARD, NOT ON WELD, and that is a fix rather than a nicety. Placed at Weld's own
  // coordinates the chip landed directly on top of the "Weld Hall" chip Campus.tsx mounts from
  // stage 2 -- two overlapping labels on one building, which is worse than having neither. This is
  // about 450 ft west and 320 ft north of Weld: the grass of the Old Yard, which is what "Harvard
  // Yard" actually names, and far enough that the two chips never touch.
  { label: "Harvard Yard", lat: 42.3748, lon: -71.1188, in: 5_200, out: 260, height: 40 },
];

/** Ramp from 0 at `hi` to 1 at `lo` as altitude falls, logarithmically. Mirrors altitude.ts. */
function descending(alt: number, hi: number, lo: number): number {
  if (alt >= hi) return 0;
  if (alt <= lo) return 1;
  return (Math.log(hi) - Math.log(alt)) / (Math.log(hi) - Math.log(lo));
}

/**
 * A chip's opacity at an altitude: up over the first third of its band, down over the last third.
 *
 * One function rather than two bands per row, because a place label wants a symmetrical arrival and
 * departure and expressing that as four numbers per row invites three of them to be right.
 */
function chipOpacity(alt: number, p: Place): number {
  const up = descending(alt, p.in, Math.exp(Math.log(p.in) - (Math.log(p.in) - Math.log(p.out)) / 3));
  const down = descending(alt, Math.exp(Math.log(p.out) + (Math.log(p.in) - Math.log(p.out)) / 3), p.out);
  return Math.max(0, Math.min(1, up) - Math.min(1, down));
}

function Chip({ place }: { place: Place }) {
  const group = useRef<THREE.Group>(null);
  const el = useRef<HTMLSpanElement>(null);

  const position = useMemo(() => {
    const s = latLonToSite(place.lat, place.lon);
    // Site x east, y north; three.js is x east, y UP, z SOUTH -- so north goes to -z. frames.ts's
    // header calls this out as the trap that mirrors things invisibly, and toThree() is the
    // sanctioned conversion; it is spelled out here because a chip is a position and not a mesh.
    return new THREE.Vector3(s.x, place.height ?? 0, -s.y);
  }, [place]);

  useFrame(({ camera }) => {
    const g = group.current;
    if (!g) return;
    const a = chipOpacity(camera.position.y, place);
    const up = a > 0.01;
    g.visible = up;

    /**
     * `display` AND opacity, and the display half is not belt-and-braces.
     *
     * SETTING THE GROUP INVISIBLE IS NOT ENOUGH, which is the opposite of what an earlier version of
     * this comment claimed. drei's <Html> portals a real DOM node out of the canvas and keeps it
     * mounted; making the three.js group invisible stops the group being rendered but leaves the
     * element in the document. Measured: with only `g.visible` and an opacity of 0, all five chips
     * were still returned by a `.place-chip` query at every altitude in the descent.
     *
     * That matters for two reasons beyond tidiness. Five absolutely-positioned nodes still cost
     * their layout on every frame drei repositions them. And, worse, Playwright's toBeVisible()
     * treats opacity 0 as visible -- so the e2e assertion that a place label appears at its own
     * altitude passed at EVERY altitude, which is a test that cannot fail. `display: none` makes the
     * DOM agree with what the viewer sees, and the gate becomes real.
     */
    if (el.current) {
      el.current.style.opacity = String(a);
      el.current.style.display = up ? "" : "none";
    }
  });

  return (
    <group ref={group} position={position} visible={false}>
      {/* NO distanceFactor, unlike Campus.tsx's Weld chip, and that is the one deliberate
          difference from the pattern this file otherwise copies. distanceFactor scales the chip
          with scene distance, which is right for a label pinned to a building you are approaching
          and wrong for one pinned to a continent: across the altitudes these span -- eight million
          feet to two hundred -- a scaled chip is either a smear across the screen or a single
          pixel. Fixed CSS size keeps every place name the same size, which is what a map does. */}
      <Html center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
        {/* `.place-chip` ONLY, and NOT `.weld-chip` as well, which is how this shipped for an hour
            and it broke two existing tests. campus.spec.ts asserts `locator(".weld-chip")` has count
            0 when Weld is not highlighted and resolves to exactly one element when it is; borrowing
            the class for five scenery labels made those selectors match six nodes. The class name is
            an interface, not a stylesheet detail, so the CSS is duplicated in globals.css instead --
            which is the cheaper of the two, since the alternative is making every existing selector
            in the suite defensive about a class it does not care about. */}
        <span ref={el} className="place-chip" aria-hidden="true">
          {place.label}
        </span>
      </Html>
    </group>
  );
}

export function Labels() {
  return (
    <group>
      {PLACES.map((p) => (
        <Chip key={p.label} place={p} />
      ))}
    </group>
  );
}

/** Exported for the unit test, which asserts the bands overlap and the positions are real. */
export const PLACE_TABLE: readonly Place[] = PLACES;
export { chipOpacity };
