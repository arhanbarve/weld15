# P10 — Implementation plan

Companion to `docs/phases/P10.md`, which is the spec. That document says what and why. This one
says which lines, in what order, and how each step is proved before the next begins.

Branch `p10-fidelity`, worktree `../weld15-p10`, off `8e6ef50`. One commit per step. Nothing
reaches `main` without a merge decision at the end.

**Scope cut, 2026-07-31, before any code was written.** Workstreams B (Weld's procedural exterior:
belt courses, cornice, entrance, brick texture, palette-seam extension) and T (Google Photorealistic
3D Tiles) are struck. A concurrent session, `weld15-imagery` on branch `p10-imagery`, is
independently retexturing the ground imagery and extracting Harvard's own I3S building mesh into
`campus.glb` — the same "make the building/ground real" goal, a different and incompatible way.
Confirmed with the user: exterior and ground realism belong to `p10-imagery`; this phase is
interior (A) and stage 4's camera (D) only, and touches nothing in `weldGeometry.ts`,
`WeldExterior.tsx`, `Ground.tsx`, `Campus.tsx`, or the tile dependency. A2 is revised below from its
original two-step form (which split wall openings and therefore changed the exterior's bay count)
to a single interior-only step that leaves `walls.ts`'s opening emission untouched.

**Standing rules for every step.**

- `git status` in *both* worktrees before every commit. Three other sessions are live on this repo.
- Before touching any file, confirm it is not one of `p10-imagery`'s: `weldGeometry.ts`,
  `WeldExterior.tsx`, `Ground.tsx`, `Campus.tsx`.
- No step is complete until its verify column has been *run* and its output seen. Inspection is not
  verification.
- Any constant with no source gets a comment saying ASSUMED, in the voice
  `docs/DIMENSION-AUDIT.md` requires. Never present an inference as a measurement.
- Any budget raised gets its new measurement written into the comment that carries the old one.

---

## Step index

| # | step | files | risk |
|---|---|---|---|
| H1 | NUL bytes out of `walls.ts` | 1 | none |
| H2 | Correct the stale window comment | 1 | none |
| A1a | `geo/pieces.ts` — the part tables | 2 new | low |
| A1b | `Furniture.tsx` — rigid instances | 1 | **high** |
| A2 | `geo/sash.ts` — real windows, interior only | 3 new/edit | medium |
| A3 | `geo/trim.ts` — base, casing, leaves, cornice | 3 | low |
| A4 | env map, GTAO, brick/plaster | 3 | medium |
| D1 | `STAGE4_CLAMP` | 2 | low |
| D2 | the funnel | 2 | **high** |
| D3 | stage-4 pointer control | 2 | medium |
| D4 | HUD out of the optical centre | 2 | low |
| Z | renders, budgets, final measurement | many | low |

---

# Housekeeping

## H1 — NUL bytes out of `src/geo/walls.ts`

Two literal NUL bytes at offsets 11340 and 11872 (lines 326 and 341), used as a key separator:

```js
pairs.add([lo, hi].sort().join("\0"));            // ← literal NUL in the source
...
separates: [...pairs].map((k) => k.split("\0") as [string, string]),
```

They are deliberate as a *value* and accidental as a *byte*. `file` reports the source as `data`
and **`grep -r` skips the entire file** — which is how I initially failed to find `buildOpenings`
at all. Replace the literal byte with the escape `" "`. Identical at runtime, and the file
becomes text.

**Verify** — `file src/geo/walls.ts` → `ASCII text`; `grep -c "buildOpenings" src/geo/walls.ts` →
non-zero; `npm test -- walls` green.

**Commit** — `Write the NUL separator as an escape, so grep can see walls.ts at all`

## H2 — Correct the stale header in `Suite.tsx:56-65`

It documents *"buildOpenings() centres each face window on its WALL BAND rather than on the room it
lights… all four facade windows come back at offset 18 with width 8"*. That was fixed in
`walls.ts:520-556` and is guarded by `tests/walls.test.ts:115-142`. The comment now describes
behaviour the code does not have, and it names the merge in `cutsFor()` as load-bearing when at the
default params it is inert.

Rewrite to say what is true: windows are per room; `cutsFor()`'s merge is retained because a
slider can still bring two windows into contact, even though this phase's A2 does not change the
opening count.

**Verify** — read-only; no test change.

**Commit** — `Say what buildOpenings actually does now, which is the fixed thing`

---

# Workstream A — the interior

## A1a — `src/geo/pieces.ts`

New module. Three-free, like `rooms.ts`, `collide.ts` and `walk.ts`, so it is unit-tested in Node.
`tests/place.test.ts` walks the import graph and asserts these modules reach no renderer package —
this one joins that list.

```ts
export type PartMaterial = "oak" | "textile" | "hardware";

/** A box in the piece's own frame: origin at its low corner, before any yaw. */
export type Part = {
  u: number; v: number;        // low corner, ft from the piece's own origin
  du: number; dv: number;      // extents
  y0: number; y1: number;      // ft above the floor the piece stands on
  material: PartMaterial;
};

export function partsOf(kind: FurnitureKind): Part[];

/**
 * The tallest point the kind actually draws, which is NOT SIZES[kind].h for the bed.
 * See the note below.
 */
export function drawnHeight(kind: FurnitureKind): number;
```

**The one place the parts may leave `SIZES`, stated up front.** `SIZES[kind].h` is the piece's
declared height and `collide.ts` never uses it — collision is a footprint test in plan. A bed with a
headboard is taller than its 2.0 ft frame, and pretending otherwise would mean drawing a bed with no
headboard purely to satisfy a number nothing enforces. So:

- **The footprint is inviolable.** Every part satisfies `0 <= u`, `u + du <= SIZES[kind].du`, and
  the same in `v`. This is what `collide.ts`, `drag.ts` and `placeIsLegal()` depend on, and A1
  must not touch it. Asserted for every part of every kind.
- **The height may exceed `SIZES[kind].h`,** for the bed alone. `drawnHeight("bed")` is 3.4 ft
  against a declared 2.0. `furniture.ts`'s "well under the 10.75 ft ceiling" assertion moves from
  `SIZES[k].h` to `drawnHeight(k)`, which makes it a stronger test than it was.

Part tables. Every dimension ASSUMED except the mattress, which comes through `MATTRESS`.

**bed** — `SIZES.bed` 6.833 × 3.333 ft, declared h 2.0, drawn 3.4.
Four legs 0.25 × 0.25, floor → 1.0. Two side rails and two end rails 0.15 thick, 1.0 → 1.45. Slat
deck, full inner footprint, 1.45 → 1.5. Headboard: two posts 0.25 × 0.25 rising to 3.4, panel
between them 2.2 → 3.3. Footboard panel to 1.9. Mattress, `MATTRESS.du × MATTRESS.dv`, 1.5 → 2.0,
textile. Pillow 1.7 × 1.1 × 0.35 at the head end, textile. Blanket folded across the foot, full
width × 1.6 × 0.12, textile.
`BEDDING_H` and `BEDDING_INSET` in `Furniture.tsx` are **deleted** — the mattress is a part now, and
its inset is `withFrame`'s allowance expressed as geometry rather than re-derived.

**desk** — 4.0 × 2.0 × 2.5. Top 0.12 thick with a 0.08 overhang on three sides. Two end panels 0.1
thick, floor → top. Modesty panel at the back, 0.08 thick, 0.9 → 2.3. Three drawer fronts down the
right-hand end, 0.06 proud of the carcase, with 0.03 reveals between them. Three pulls, hardware,
0.5 × 0.06 × 0.1.

**chair** — 1.5 × 1.5 × 2.83. Seat 0.12 thick at 1.5. Four legs 0.12 × 0.12; the two rear legs
continue as back stiles to 2.83. Two back slats 0.06 thick between them.

**dresser** — 2.5 × 1.5 × 2.5. Carcase with 0.1 sides, plinth 0.25 tall set back 0.08, top 0.12
thick with a 0.06 overhang. Three drawer fronts 0.06 proud. Six pulls, hardware.

**sofa** — 6.0 × 2.75 × 2.67. Base rail 0.6 tall. Seat cushion 0.45 thick at 0.95, textile. Back
cushion 0.4 thick rising to 2.67, textile. Two arms 0.5 wide to 1.9, textile. Four legs 0.15 ×
0.15 × 0.35, oak.

**table** — 4.0 × 2.5 × 2.5. Top 0.14 thick with a 0.15 overhang all round. Four legs 0.2 × 0.2.
Two stretchers 0.1 × 0.1 at 0.5.

**shelf** — 3.0 × 1.0 × 4.0. Two sides 0.1 thick. Four shelves 0.08 thick at 0.35, 1.3, 2.25, 3.2.
Back panel 0.05 thick. Plinth 0.3 tall set back 0.06.

**`tests/pieces.test.ts`** — for every kind: at least one part; every part has positive extents;
every part inside `SIZES[kind]` in plan; `drawnHeight(kind) < DEFAULT_PARAMS.ceiling`; parts of a
kind occupy between 8% and 65% of the bounding volume (a solid block fails the upper bound, an empty
table the lower — this is the test that would have caught today's state).

**Verify** — `npm test -- pieces` green. No scene change; nothing imports it yet.

**Commit** — `Furniture gets parts, in a module that knows nothing about three`

## A1b — `Furniture.tsx` consumes the parts

**The highest-risk edit in workstream A.** Today's header, lines 27-34, warns: a `Piece`'s `du`/`dv`
are unrotated, `pieceBox()` applies the quarter turn, and therefore the mesh applies **only** the
suite yaw. Applying both the piece yaw *and* `pieceBox()`'s extents would rotate twice, and a bed
6.833 ft along `u` would come out 6.833 ft along `v` — an error that reads as a layout bug rather
than a rendering one.

The new code inverts that contract, so the header is rewritten rather than kept:

- geometry is built once per (kind, material) from `partsOf(kind)`, in the piece's **unrotated**
  local frame, at true size;
- the instance matrix is **rigid** — translation and `yaw_suite + yaw_piece`, scale exactly 1;
- `pieceBox()` is **no longer used for rendering at all**. It stays the authority for collision and
  for `DragLayer`'s arithmetic pick, which are untouched.

```ts
function pieceMatrix(p: Piece, suiteYaw: number, params: SuiteParams): THREE.Matrix4 {
  // The anchor is the piece's own low corner in its UNROTATED frame, so the local
  // geometry and the rotation agree. Do NOT read pieceBox() here: that is the rotated
  // footprint and combining the two turns the piece twice.
  const c = suiteToThree(p.u + p.du / 2, p.v + p.dv / 2, floorLevel(1), params);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(c[0], c[1], c[2]),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0, suiteYaw - (p.yaw * Math.PI) / 180, 0),
    ),
    new THREE.Vector3(1, 1, 1),
  );
}
```

The sign of the yaw term is the thing to get wrong. `Piece.yaw` is documented as a **clockwise**
rotation in plan where 0 faces `+v`; three's Y rotation is counter-clockwise looking down. Hence the
negation, and hence a test rather than a screenshot.

Geometry is built in the piece's local frame with the box centred so UVs come out at world scale —
each part gets `scaleFloorUv(g, du, dv)`-equivalent treatment on its top face so the oak grain
applies. This is now possible only because the instance carries no scale. `materials.ts:348`'s note
withholding the grain from `oakDeep` is deleted, and `oakDeep` gains the normal map.

A third material joins the palette: `hardware`, a dark satin metal, derived from `DAY.edge` by one
documented operation in the manner of `BRICK` and `SLATE`.

Batches: 11, listed in `P10.md` §5.1. `computeBoundingSphere()` on every batch after writing
matrices, for the reason the current `Batch` records — an `InstancedMesh` inherits its geometry's
bounding sphere, which for a unit cube at the origin is 900 ft from the suite, and frustum culling
then drops the whole batch.

**`tests/furniture-transform.test.ts`** — the trap, caught arithmetically. For each kind, each of
the four yaws, and six parameter sets: assemble the parts, apply `pieceMatrix`, project to the
suite frame, take the AABB, and compare against `pieceBox(p)`. Equality to 1e-9. **Write this test
before the component change and watch it fail on a deliberately doubled rotation** — a test that has
never failed is not yet a test.

**Verify** — `npm test -- furniture` green; `npm run test:e2e -- journey` green; capture stage 5 and
stage 4 at t = 0.6 and compare against the before shots; read `window.__perf` at stage 5 and record
calls and triangles in the commit message.

**Commit** — `Furniture is built rather than boxed, and the instance stops carrying scale`

## A2 — `src/geo/sash.ts`, real windows, interior only

**Scope note.** The original two-step form of A2 split `walls.ts`'s window opening into several
narrower ones, which — through `bayRects()` — changed `WeldExterior.tsx`'s bay count. That is an
exterior visual change in `p10-imagery`'s territory even though the edited file was nominally mine.
Dropped. `walls.ts:520-556`'s opening emission is **untouched**: still one opening rectangle per
room face at `width = min(run * 0.55, 8)`. What changes is only what fills that rectangle, and only
as seen from inside.

New three-free module. One opening rectangle in, the parts of a real window out — internally
subdividing the opening into lights rather than changing the opening itself:

```ts
export type SashPart = Part & { material: "joinery" | "glass" };

export function sashParts(width: number, sill: number, head: number): SashPart[];
```

Constants, all ASSUMED, each with its note:

```
LIGHT_SPACING 3.5   width a single double-hung light reads as, before another is added
LIGHT_MAX     3     an 8 ft opening degrades to 3 lights rather than growing a 4th
STILE         0.17   sash stile and rail width
MEETING       0.25   the meeting rail, thicker than the others
MUNTIN        0.06   glazing bar; one vertical per sash gives 2-over-2
SASH_T        0.09   sash thickness
PANE_T        0.02   glass
CASING_W      0.35   architrave round the opening, room side
CASING_PR     0.05   how far it stands proud of the plaster
SILL_PR       0.12   sill board projection into the room
SILL_NOSE     0.04   its nosing
```

`n = clamp(round(width / LIGHT_SPACING), 1, LIGHT_MAX)` lights, evenly divided across the existing
opening width — this is what turns an implausibly wide single sash into a window bank without
touching `walls.ts` or `bayRects()`. Parts: casing on all four sides of the room face, running the
full opening width; sill board with nosing; jamb linings on the four reveal faces; per light —
lower sash (2 stiles, top rail, bottom rail, 1 muntin) and upper sash the same, offset up, its
bottom rail being the meeting rail; one pane per light, inset `SASH_T/2 - PANE_T/2`.

**`Suite.tsx`** — `paneSlabs()` is replaced by `sashSlabs()`, feeding the existing `mergeSlabs()`
path. Two new merged geometries and so two new draw calls: `joinery` (oak) and `glass`. `PANE_T` and
`PANE_INSET` move into `sash.ts`; `paneLow()` stays exactly as it is — it decides which face of the
band the sash sits toward, derived from the rooms the band touches, and that reasoning is unchanged
and still correct. `weldGeometry.ts` is **not touched**; the exterior face of the same opening
remains today's solid box, `p10-imagery`'s scope to change.

**A defect found while reading `weldGeometry.ts`, flagged and left alone.** `bays()` sets
`h: params.ceiling`, so the exterior window box runs floor-to-ceiling while the interior opening
(`SILL_H` 2.5 → `HEAD_H` 9) does not, and the two have never agreed. Not fixed here — fixing it
means editing `weldGeometry.ts`, out of scope by the cut above. Left as a comment in the commit
message for whoever next touches that file.

**Glass stays `transmission: 0`.** `materials.ts:399` records that transmission forces a second full
scene render and doubles every draw call. What carries the glass is the real frame around it and
A4's env map.

**`tests/sash.test.ts`** — parts stay inside the (unchanged) opening; frame and glass do not
overlap; glass area equals the opening minus the frame to 1e-9; a 1 ft opening degrades to a single
light rather than emitting a negative muntin; a wider opening produces more lights without changing
`width`.

**Verify** — `npm test -- sash walls` green (walls unchanged, run to confirm); stage 5 capture shows
sashes from inside.

**Commit** — `Every interior window gets a sash, without moving the hole it sits in`

## A3 — `src/geo/trim.ts`

New three-free module returning `Slab[]` in the suite frame, from the rooms and walls `Suite.tsx`
already builds.

```ts
export function trimSlabs(suite: Suite, walls: Wall[], openings: Opening[], floor: number,
                          ceiling: number): { joinery: Slab[]; plaster: Slab[] };
```

- **baseboard** — every room-facing wall run, `BASE_H` 0.62 tall, `BASE_PROUD` 0.06 proud, broken
  where a door crosses it. Corners overlap rather than mitre: they are opaque boxes and a mitre is
  invisible and costs vertices.
- **door casing** — architrave round every `kind: "door"` opening on both faces, matching the window
  casing so the room has one language.
- **door leaf** — `DOOR_LEAF_T` 0.14 thick, hung **open** against its jamb at 100°. Open, because
  `walk.ts` and `route.ts` both treat a doorway as passable; a closed leaf would be geometry telling
  a lie about a route the code will still walk through.
- **picture rail** at `RAIL_H` 7.0 and a plain cornice at the ceiling. Both period-correct for 1872
  and both one box per wall run.

Two extra draw calls total — one joinery mesh, one plaster cornice mesh — regardless of room count,
because everything goes through `mergeSlabs()`.

**`tests/trim.test.ts`** — baseboard covers every room-facing run minus the doorways; no trim
intersects a door or window opening; no trim leaves the room's footprint; leaf swing stays inside
the room it opens into.

**Verify** — `npm test -- trim` green; stage 5 capture; the floor/wall junction now reads.

**Commit** — `The rooms get a base, a casing and a door you can see`

## A4 — light and material

- **`materials.ts`** — a plaster tooth, on the existing `drawGrain()` canvas machinery, which is
  already headless-guarded and needs no new asset file. New `hardware` material (drawer/dresser
  pulls, A1a), derived from a palette token by one documented operation. `oakDeep` gains the grain
  map, now that A1b makes its UVs meaningful. No brick or sandstone — those are exterior materials,
  out of scope by §0.
- **`Lighting.tsx`** — a `PMREMGenerator` environment built once from a procedural gradient scene,
  no file, attached as `scene.environment`. This is the step `materials.ts:399` names and never
  took. Raise `SHADOW_PX` and add a normal bias for the new fine geometry.
- **`Effects.tsx`** — GTAO in the existing composer, off under reduced motion alongside bloom, and
  off below a measured frame-time budget.

**Verify** — `npm test -- materials lighting` green; `contrast.spec.ts` and `a11y.spec.ts` still
green (AO darkens corners and must not move a measured contrast pair); frame time on real hardware
before and after, recorded.

**Commit** — `Brick, plaster, an environment to reflect and corners that occlude`

---

# Workstream B — dropped

Weld's procedural exterior detail (belt courses, water table, cornice, entrance, brick texture, and
the palette-seam work to carry the crossing across them) is struck per the scope cut above. It is
`p10-imagery`'s territory. `weldGeometry.ts` is not opened by this phase.

---

# Workstream D — stage 4

## D1 — `STAGE4_CLAMP`

`orbit.ts`. Derived exactly as `STAGE3_CLAMP` is, with the same arguments, and with the same
honesty about which figures are derived and which are chosen — the header already warns that an
earlier draft claimed all four were derived and that treating a choice as a source is the most
repeated error in `docs/DIMENSION-AUDIT.md`.

```
minRadius  = MASS_RADIUS                     114.92 ft — derived. Same "outside the massing
                                             at every azimuth and polar" guarantee.
maxRadius  = 2 * gableBack                   247.24 ft — CHOSEN. gableBack is stages.ts's own
                                             stand-off, 123.62 ft; twice it lets the viewer pull
                                             back to see Weld whole without reaching stage 3's
                                             344.7 ft, where Weld stops being the subject.
minPolarDeg = 15, maxPolarDeg = 88           CHOSEN, unchanged, same argument as stage 3.
```

`gableBack` is currently a local inside `buildKeyframes()`. Lift it to a module-level exported
constant so `orbit.ts` derives from the same number rather than a copy — the mistake
`stages.ts:41-47` records is exactly a hard-coded distance surviving a change of fov.

**`tests/orbit.test.ts`** — `clampOrbit` idempotent under the new clamp; brute-force that
`|position - target| >= MASS_RADIUS` over a sweep of azimuth × polar, as the stage-3 verification
already does.

**Commit** — `Stage 4 gets a clamp of its own, derived from the stand-off it already had`

## D2 — the funnel

`stages.ts`. One new exported pure function and one change to `cameraKeyframe()`.

```ts
/**
 * How much of the pose is the PATH's rather than the viewer's, at progress t.
 *
 * 1 at and after SHELL_GONE, which is the whole guarantee: from the frame the brick
 * reaches zero opacity the pose is the path's exactly, so the camera crosses the gable
 * perpendicular and every downstream promise -- the routed walk, route.ts's 1 ft
 * standoff, the 0.5 ft near plane -- is untouched.
 *
 * 0 at and below FUNNEL_START, so a drag at the top of the stage is fully the viewer's
 * and the control feels direct rather than rubber-banded.
 *
 * 0.15 is CHOSEN. It has to sit below thresholdOpacity()'s shell ramp, which starts at
 * 0.2: the funnel should have begun before the building starts dissolving, or the viewer
 * watches the camera swing while the brick is already going.
 */
export const FUNNEL_START = 0.15;

export function funnel(t: number): number {
  if (t <= FUNNEL_START) return 0;
  if (t >= SHELL_GONE) return 1;
  const u = (t - FUNNEL_START) / (SHELL_GONE - FUNNEL_START);
  return u * u * (3 - 2 * u);          // smoothstep: zero derivative at both ends,
}                                      // so neither the drag nor the path starts with a jerk
```

`cameraKeyframe()` gains an optional orbit argument. When stage is 4 and orbit is non-null:

```ts
const pathPose = alongPath(path, t);
if (stage === 4 && orbit) {
  const f = funnel(t);
  if (f >= 1) return pathPose;                                    // exact, not a lerp to 1
  const held = orbitKeyframe(kf[4], orbit, STAGE4_CLAMP);
  return f <= 0 ? held : blend(held, pathPose, f);
}
return pathPose;
```

`f >= 1` returns `pathPose` **by identity, not by blending to 1**. `blend(a, b, 1)` computes
`p + (q - p)`, which is `q` to within an ulp rather than `q` by construction, and the stage boundary
is the one place a camera position is compared for equality — by `tests/stages.test.ts` and by
`CameraRig`'s `MOVE_EPS`. `alongPath()` already makes this argument about its own endpoints.

**Import direction.** `stages.ts` would now import `orbitKeyframe` from `orbit.ts`, and `orbit.ts`
already imports `type Keyframe` from `stages.ts`. That type import is erased, so there is no runtime
cycle — the same reasoning `furniture.ts`'s header uses about `walls.ts`. Confirmed by the fact that
`tests/place.test.ts` walks the real graph; if it complains, the blend moves into `CameraRig`
instead, which is where the orbit already lives.

**`tests/stages.test.ts`** — three properties, in this order of importance:

1. **The regression fence.** With `orbit === null`, every stage-4 pose at 200 values of `t` across
   14 parameter sets is **bit-identical** to the current implementation. This is what lets the whole
   rework land without touching a single existing stage-4 expectation.
2. `funnel(t) === 1` for all `t >= SHELL_GONE`, and `cameraKeyframe(..., orbit)` at those `t` is
   `===`-identical in every component to the no-orbit pose.
3. `funnel(t) === 0` for all `t <= FUNNEL_START`, and the pose there is exactly `orbitKeyframe`.

Plus: over a sweep of 12 orbits × 200 `t`, the camera's distance to the nearest wall band never
drops below `route.ts`'s standoff on the interior portion — the P7 defect
(`stages.ts:371-387`) generalised to the new freedom.

**Commit** — `Stage 4 funnels: your angle at the top, the gable's at the wall`

## D3 — stage-4 pointer control

`CameraRig.tsx:195` reads `if (stage !== 3) return;`. Generalise:

```ts
const clamp = stage === 3 ? STAGE3_CLAMP : stage === 4 ? STAGE4_CLAMP : null;
if (!clamp) return;
```

`current()` seeds from `orbitOf(keyframes(params)[stage])`, and the frame loop's `stage === 3`
branch becomes `stage === 3 || stage === 4`, routing stage 4 through `cameraKeyframe` with the orbit
rather than through `orbitKeyframe` directly — the funnel is the thing that has to run.
`keepOutsideMassing()` applies while `funnel(t) < 1`.

**And `orbit` must be cleared when the anchor changes.** `setStage` currently does not touch it
(`store.ts:530`), so a stage-3 orbit would silently become a stage-4 pose about a *different*
target — stage 3 orbits `[0, 42, 0]`, stage 4 orbits `insideBedB`. Same spherical numbers, different
anchor, and the result is a valid-looking pose that is not where the viewer left the camera.

Rule: `setStage`, `next` and `prev` clear `orbit` iff the stage's orbit anchor changes. Stages other
than 3 and 4 have no anchor, so leaving stage 3 for stage 2 and returning still keeps your orbit —
today's behaviour, preserved. One test.

No URL change: `orbit` is already in the snapshot (`store.ts:321`, `url.ts:440-443`) and encodes
radius in hundredths of a foot, which covers stage 4's 114.92–247.24 ft range without a format bump.

**`tests/e2e/stage4-orbit.spec.ts`** — dragging at stage 4 changes `window.__cam` azimuth; scrubbing
to t = 1 from a dragged pose still lands within 1e-6 of the undragged stage-5 keyframe; a copied
link restores the angle; the 12 × 20 sweep produces no frame with zero lit pixels.

**Commit** — `Stage 4 takes the drag, and the orbit stops surviving a change of anchor`

## D4 — HUD out of the optical centre

Visible in every capture: the panel occupies centre-bottom, and at stage 4 t = 0 it sits over the
base of the gable — the subject. Move the stage-3 and stage-4 control groups to the treatment stage
5 already uses (`hud-room`). `app/globals.css` is another owner's file; the change is a class swap
in `Hud.tsx` plus one rule, and the existing note in that file says reuse is the intent.

**Verify** — captures at all six stages; `row.spec.ts` and `row2.spec.ts` (the button-row geometry
gates) still green at 375 / 768 / 1024 / 1440.

**Commit** — `Get the panel off the building`

---

# Workstream T — dropped

Google Photorealistic 3D Tiles is struck per the scope cut above — real building geometry from a
second source (`p10-imagery`'s I3S extraction) makes it redundant, and the two would have fought
over the same `Ground.tsx` tint constants. No dependency is added, no key is created,
`Campus.tsx`/`Ground.tsx` are not opened by this phase.

---

## Z — renders, budgets, and the final measurement

- Regenerate every render in `design/renders/` via `scripts/capture.mjs`.
- Re-measure `window.__perf` on **real hardware** at every stage — not headless SwiftShader, which
  `FlyDown.tsx:44-56` records as 25× slower — and rewrite each budget comment with its new number:
  `IMPLEMENTATION-PLAN.md` §9, `stages.ts`'s stage-5 figures, `edit.spec.ts`'s ceiling.
- Full `npm test` and `npm run test:e2e`, both green, output pasted into the final commit.
- `npm run typecheck` clean.
- Confirm, by diff, that no commit in this phase touched `weldGeometry.ts`, `WeldExterior.tsx`,
  `Ground.tsx`, or `Campus.tsx`.

**Commit** — `Re-measure everything P10 moved, and say what it now costs`

---

## What "done" means

- [ ] `npm test` green — full suite, not the changed files
- [ ] `npm run test:e2e` green
- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean
- [ ] Every budget comment carries a fresh measured number
- [ ] Before/after captures for all six stages attached
- [ ] Both worktrees clean; `main` untouched; merge decision presented, not taken
- [ ] `git diff main --stat` shows no touch of `weldGeometry.ts`, `WeldExterior.tsx`, `Ground.tsx`,
  `Campus.tsx`

## If it goes wrong

Every step is one commit on `p10-fidelity`; the phase is one merge that can be dropped whole. The
two high-risk steps — A1b and D2 — each land behind a test written to fail first, so the failure
mode is a red test rather than a wrong picture.
