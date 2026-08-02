"use client";

import { HAS_TILES_KEY, Tiles } from "./Tiles";
import { FallbackGround } from "./FallbackGround";

/**
 * What a window looks out onto -- P14 row 8.
 *
 * NO NEW GEOMETRY, AND NO REPOSITIONING. Both worlds this mounts -- live Google
 * Photorealistic 3D Tiles and the keyless FallbackGround -- already resolve into the same
 * site-frame three.js space Suite.tsx's own windows sit in (frames.ts's toThree(), the one
 * conversion every part of this project shares). Stage 5 used to be the one stage
 * visibility() kept them unmounted for, on the reasoning that the camera stood behind
 * Weld's opaque exterior walls the whole stage -- true until sash.ts's window fix made a
 * window a real hole in the wall rather than a solid casing panel. So the only thing new
 * here is TIME: `tiles` extending through stage 5 (stages.ts) means this component now
 * stays mounted long enough for a window to have something on the other side of it.
 *
 * ITS OWN COMPONENT, NOT ANOTHER LINE IN EXPERIENCE.TSX'S TERNARY, because the reason it
 * mounts at stage 5 (a window's own sightline) is a different concern from the reason it
 * mounts at stages 0-4 (the descent's own backdrop), and stacking a second justification
 * onto Experience.tsx's already-dense render tree would read as one decision when it is
 * two. Experience.tsx keeps its own HAS_TILES_KEY (Globe/Ground/Campus still read it
 * directly, per its own comment on why); this file re-derives nothing and imports Tiles.tsx's
 * copy instead, since a THIRD independent `Boolean(process.env...)` site would be one too
 * many for a single build-time constant.
 *
 * COST: keyless, three draw calls (two FallbackGround quads plus one merged campus.glb
 * mesh -- CampusMesh.tsx/FallbackGround.tsx load it as a single THREE.Mesh, not one per
 * building). Keyed, whatever Tiles.tsx's own tileset costs at the LOD the camera's distance
 * already selects -- unmeasured here, since this worktree has no
 * NEXT_PUBLIC_GOOGLE_MAPS_KEY (no .env.local), the same gap tilesCarve.ts's HEIGHT_MIN fix
 * flags for the same reason.
 */
export function Outlook({ visible }: { visible: boolean }) {
  return HAS_TILES_KEY ? <Tiles /> : <FallbackGround visible={visible} />;
}
