# In-world signage: entrance plaque + room plaques

## Goal

Label the suite in-world, the way the user asked for after finding the closed
front door had nothing marking it as the entrance:

- A sign near the front door reading "Entrance."
- A matching sign near every other room's doorway, reading that room's name.

Non-goal: replacing or changing the HUD's existing room-name readout (`walk
Hall`, `walk Common room`) — this is a diegetic addition, not a UI change.

## Decisions (from brainstorming)

1. **Location**: entrance sign is inside, next to the closed front door — not
   on the exterior facade. It tells a viewer standing there "this is the
   building's real entrance," even though the door is shut and unwalkable.
2. **Room labels**: yes, in-world signs at every room's doorway, matching the
   entrance sign's style — not just relying on the HUD corner text.
3. **Visual style**: engraved brass plaque (dark mounting plate, brass
   gradient fill, dark serif lettering) — matches real 1920s dorm
   room-number plaques. Chosen over a carved-oak sign and a painted/stencil
   sign in a 3-option visual mockup review.
4. **Text rendering**: a CanvasTexture drawn at build time (2D canvas
   `fillText`), the same procedural-asset pattern `materials.ts` already
   uses for the oak-grain and plaster-tooth normal maps. Rejected
   `troika-three-text` (real dependency, mismatches this codebase's
   zero-external-asset ethos) and extruded 3D letterforms (overkill for a
   small reading-height plaque).

## Design

### Which doors get a sign, and what they say

One plaque per door opening (`kind: "door"` in `geo/walls.ts`'s `Opening[]`),
labelled by convention already built into `door()`'s own argument order:
`connects[0]` is always the approach room, `connects[1]` the room being
entered (`door("hall", "bedA")` reads "from the hall, into bedroom A"). The
entrance door's `connects` is `["hall", "outside"]` — `"outside"` never
matches a real room id, so it falls through to the literal label "Entrance"
automatically, with no separate branch needed.

This produces exactly six plaques at the shipped params: Entrance, Bedroom A,
Bathroom, Bedroom B, K, Common room. The Hall itself never gets a plaque of
its own — it is never any door's `connects[1]`, since it's the hub every
other room opens off of, not a room entered through a labelled doorway.

`K`'s room label in `geo/rooms.ts` is the descriptive `"K — second common
room"`; the plaque reads plainly as `"K"` instead — a hallway plate names the
room, not its footnote.

### Where a sign mounts

On the wall of the door's own opening, on `connects[0]`'s (the approach
room's) face — the same side a real corridor's room-number plate faces, so
you read it before entering. Position along the wall: beside the door jamb
(low side of the opening first, high side if that would run the plaque off
the band's start), never centred over the opening itself. Height: centred at
5.3 ft off the floor (ordinary reading height). Proud of the wall by 0.04 ft.

### Rendering

- `materials.ts`'s new `signMaterial(text)`: builds a 512x200 CanvasTexture
  (dark plate, brass gradient, bold serif text), returns a
  `MeshStandardMaterial` with that texture as `map`. Cached per label text —
  built once, reused for the process's life, same lifecycle as every other
  material in this module. Headless-safe (Node/vitest): falls back to a flat
  brass-coloured material with no texture, the same contract
  `oakNormalMap()`/`plasterNormalMap()` already keep.
- `Suite.tsx`'s new `signSlabs()` (exported for testing, same pattern as
  `doorLeafSlabs()`/`bathWainscotSlab()`): pure geometry function, one
  `{slab, label}` per door opening.
- `Suite.tsx`'s new `signGeometry()`: positions/rotates a plaque's box via
  the same `suiteToThree()`/yaw transform every other piece of geometry in
  this file uses, but skips `applyAoColor()`/`scaleFloorUv()` — a plaque's
  colour comes entirely from its own texture, and a baked vertex colour
  would multiply against it and dull the brass.
- Each sign is its own uncombined `<mesh>` (can't merge into the suite's
  batched geometry — each carries different text), added to
  `SuiteGeometry.signs` and disposed explicitly alongside every other
  geometry this component owns.

## Testing

`tests/suite-transform.test.ts`: 8 new tests on `signSlabs()` — exactly one
plaque per door, entrance labelled correctly, no plaque ever reads "Hall,"
K labelled plainly, every other room labelled by its own name, every plaque
mounted on the approach side and standing proud (not embedded) of its wall,
every plaque's along-axis span stays inside its own wall band, every plaque
sits at reading height under the ceiling.

Live verification: navigated to the front door and to the bathroom doorway
in a running browser; both plaques render with correctly-oriented (non-
mirrored) legible text in the approved brass style.
