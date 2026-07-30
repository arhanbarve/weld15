/**
 * The parametric room graph for Weld 15.
 *
 * This is the centre of the project. Everything downstream -- walls, openings,
 * furniture snapping, the first-person collision hull, the area readout -- comes
 * out of buildSuite(). Nothing else knows how the suite is shaped.
 *
 * SUITE FRAME
 *   u = feet inward from the outer facade   (0 = facade, increasing away from it)
 *   v = feet north along the end section     (0 = south wall at the stair hall,
 *                                            44 = north gable)
 *
 * With params.wingStep on, u = 0 is the END ZONE's facade line and a room out in
 * Weld's projecting wing zone takes NEGATIVE u. See stepOntoTheWing().
 *
 * Why L-shaped, which is forced rather than chosen:
 *   - the resident gives bedrooms 16 ft deep. A 4 ft private hall plus a 0.5 ft
 *     partition plus 16 ft is 20.5 ft, so the suite's main leg is ~21 ft deep
 *     and a 10 x 12 room cannot share that cross-section.
 *   - Putting K in the along-hall sequence instead gives
 *     common 15 + K 12 + bedroom 10 + bath 7.5 + bedroom 10 + four partitions
 *     = 56.5 ft against a 44 ft end section. Over by 12.5.
 *   - the resident fixes the door order as bedroom, bathroom, bedroom with the third
 *     "at the end of the hall", so K cannot sit between them.
 *   Therefore K bumps out of the rectangle, off the common room. That is also
 *   the only arrangement in which "attached to the common room" is literally
 *   true.
 *
 * The 44 ft section length is derived from the 1875 published specification:
 * 143 ft overall, less two 15 ft stair halls and a 25 ft central porch, halved.
 * See docs/FINAL-LAYOUT.md.
 */

// Type-only, and it has to stay type-only. See measuredFacadeStep below: a value
// import of place.ts here breaks both generator scripts and with them the
// anti-drift gate, because node cannot resolve place.ts's extensionless imports.
import type { FacadeStep } from "./place";

export type Rect = {
  id: string;
  label: string;
  /** feet inward from the facade */
  u: number;
  /** feet north from the suite's south wall */
  v: number;
  /** extent in u */
  du: number;
  /** extent in v */
  dv: number;
  kind: RoomKind;
  /** what the resident or Harvard said, for the provenance chip */
  stated?: string;
  /** windows on the facade (u = 0) and/or the north gable (v = max) */
  windows: ("facade" | "gable")[];
};

export type RoomKind = "common" | "bed" | "bath" | "circ" | "service" | "unknown";

export type SuiteParams = {
  /** 1875-derived end-section length, ft */
  sectionLength: number;
  /** depth of the main leg from facade to the hall's inner wall, ft */
  legDepth: number;
  /** private hall width, ft. INFERRED */
  hallWidth: number;
  /** bedroom depth from the facade, ft. GIVEN */
  bedDepth: number;
  /** GIVEN */
  commonAlong: number;
  /** GIVEN, but the resident's range 15-20 is really the leg depth */
  commonDeep: number;
  /** GIVEN */
  bedAAlong: number;
  /** GIVEN */
  bedBAlong: number;
  /** INFERRED, bounded 6-8 by two independent arithmetic checks */
  bathAlong: number;
  /** INFERRED */
  bathDeep: number;
  /** GIVEN */
  kDeep: number;
  /** GIVEN */
  kAlong: number;
  /** interior partition thickness, ft. INFERRED */
  partition: number;
  /** exterior masonry thickness, ft. INFERRED */
  masonry: number;
  /** floor to ceiling, ft. Derived from 12 ft floor-to-floor */
  ceiling: number;
  /** which facade the rooms face */
  facade: "east" | "west";
  /**
   * Follow Weld's wing step on the facade side instead of drawing one straight
   * facade line.
   *
   * OFF, and this one is settled rather than merely defaulted. Weld is a dumbbell,
   * about 62 ft across the middle and 52 ft at the ends, and the suite's 44 ft
   * section is long enough to cover part of both -- so the common room and K sit in
   * the wide middle with roughly 5.2 ft of building on the far side of their facade
   * wall. The question was whether that 5.2 ft is floor or fabric. It is fabric, on
   * three grounds:
   *
   *   - the resident gives the common room as 15 x 15-20 ft. The straight reading already
   *     puts it at the top of that range, at 20 ft deep. Stepping takes it to 25.17
   *     ft and 377 sq ft, which contradicts the one dimension actually given for
   *     that room. Nothing else in this project overrides a given figure on the
   *     strength of an inference, and this is not the place to start.
   *   - MACRIS CAM.184 describes Weld's skyline as broken by staircase towers AND
   *     clustered chimney shafts, and the two roof features measured off
   *     weld.rings[1] and [2] sit at building v +40.2 and -37.8 -- inside the two
   *     wing zones. A 5.2 ft masonry projection and a stack rising directly above it,
   *     in the same two zones, is one mechanism explaining both anomalies and
   *     contradicting no source. The measured asymmetry supports it too: the
   *     projection is 5.165 ft east and 5.298 ft west, which is what a survey of
   *     masonry looks like rather than a room somebody set out.
   *   - The argument that first suggested stepping does not survive testing. It ran:
   *     measured inward from each zone's own wall, a 20 ft common room and a 16 ft
   *     bedroom reach nearly the same line, so the inner wall is straight and the
   *     facade steps. But holding the depth at 20 and shifting the room bodily
   *     outward -- which is what that argument predicts -- detaches it from K, and
   *     unreachableRooms() returns ["k"]. Measured, not assumed.
   *
   * Kept as a parameter rather than deleted because the measurement behind it is
   * real and worth keeping addressable: facadeStep() in place.ts measures the step
   * off the ring, the tests pin both modes, and if a floor plan ever turns up
   * showing a deeper common room this is one flag rather than a rebuild.
   *
   * It IS a control the UI offers, and that sentence used to say the opposite. What
   * changed is not the argument -- straight is still the claim, for the three reasons
   * above -- but what a control is FOR in this project: P6's panel exists to make every
   * number a viewer might disagree with addressable, and this is the largest single
   * disagreement in the model, 5.2 ft of the common room's depth. Offering it is not
   * hedging on the answer, it is refusing to hide the question. Panel.tsx's note says
   * which mode is the claim, and that the stepped mode is deliberately incomplete: it
   * moves the room and does not give it an outer wall or a ceiling.
   *
   * See stepOntoTheWing() for what it does and what it does not do.
   */
  wingStep: boolean;
};

export const DEFAULT_PARAMS: SuiteParams = {
  sectionLength: 44,
  legDepth: 21,
  hallWidth: 4.5,
  bedDepth: 16,
  commonAlong: 15,
  commonDeep: 20,
  bedAAlong: 10,
  bedBAlong: 10,
  bathAlong: 7.5,
  bathDeep: 8,
  kDeep: 10,
  kAlong: 12,
  partition: 0.5,
  masonry: 1.5,
  ceiling: 10.75,
  facade: "east",
  wingStep: false,
};

/**
 * The building's facade step, PUSHED IN by place.ts rather than imported from it.
 *
 * The measurement belongs in place.ts and is there: it is a fact about Weld's ring,
 * and this module deliberately knows nothing about Weld. What is unusual is the
 * direction. The obvious `import { facadeStep } from "./place"` was written, run,
 * and withdrawn, because it breaks the anti-drift gate:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *   '/Users/.../src/geo/place' imported from /Users/.../src/geo/rooms.ts
 *
 * tests/drift.test.ts runs scripts/emit-layout.mjs and scripts/emit-plan.mjs in
 * plain node to prove the committed drawing and the committed layout tables still
 * match the code. Those scripts import THIS file by path, node's ESM resolver does
 * no extension guessing, and place.ts imports "./frames" and "@/data/weld.json" --
 * neither of which node can resolve. So a value import here takes the two
 * generators, and the gate that catches "54 x 151" style drift, down with it.
 * walls.ts survives for the same reason this now does: its import of rooms.ts is
 * type-only, and type-only imports are erased.
 *
 * The alternatives were worse. Typing 5.17 in as a literal is what
 * docs/DIMENSION-AUDIT.md sec 1 is a list of. Measuring the ring here means
 * importing weld.json into the pure layer and reimplementing frames.ts's rotation
 * beside it, or measuring the step off the ring's own gable instead of place.ts's
 * GABLE_INNER_V -- a second anchor 2.05 ft from the first, which is exactly the
 * kind of quiet disagreement this project keeps finding in its own past.
 *
 * store.ts holds `orbit: null` for CameraRig to resolve, for the same class of
 * reason. This is that pattern with the resolution done once at import rather than
 * per frame.
 */
let measuredFacadeStep: ((p: SuiteParams) => FacadeStep) | null = null;

/** Called once by place.ts as it loads. See measuredFacadeStep for why. */
export function provideFacadeStep(measure: (p: SuiteParams) => FacadeStep): void {
  measuredFacadeStep = measure;
}

export type Suite = {
  rooms: Rect[];
  params: SuiteParams;
  /** net floor area of the five named rooms plus the hall, sq ft */
  netArea: number;
  /** area of the resident's five rooms only, excluding hall and closet */
  roomArea: number;
  /** how far the suite reaches inward at its widest, ft */
  maxDepth: number;
  residuals: {
    /** section length minus the along-hall room chain. Zero at defaults. */
    along: number;
    /** leg depth minus hall + partition + bedroom depth */
    across: number;
  };
};

export function buildSuite(p: SuiteParams = DEFAULT_PARAMS): Suite {
  const t = p.partition;
  const hallU0 = p.legDepth - p.hallWidth; // hall sits against the inner wall

  const rooms: Rect[] = [];

  // --- south end: common room, with K bumping inward off it ---
  rooms.push({
    id: "common1",
    label: "Common room",
    u: 0,
    v: 0,
    du: p.commonDeep,
    dv: p.commonAlong,
    kind: "common",
    stated: "15 x 15-20",
    windows: ["facade"],
  });

  rooms.push({
    id: "k",
    label: "K — second common room",
    u: p.commonDeep + t,
    v: 0,
    du: p.kDeep,
    dv: p.kAlong,
    kind: "common",
    stated: "10 x 12",
    windows: [], // inland. Whether K has a window is unknown.
  });

  // --- the hall runs north from the entry, against the inner wall ---
  const hallV0 = p.commonAlong + t;
  rooms.push({
    id: "hall",
    label: "Hall",
    u: hallU0,
    v: hallV0,
    du: p.hallWidth,
    dv: p.sectionLength - hallV0,
    kind: "circ",
    windows: [],
  });

  // --- three doors off the hall, in the resident's order, going north ---
  let v = hallV0;

  rooms.push({
    id: "bedA",
    label: "Bedroom A",
    u: 0,
    v,
    du: p.bedDepth,
    dv: p.bedAAlong,
    kind: "bed",
    stated: "10 x 16",
    windows: ["facade"],
  });
  v += p.bedAAlong + t;

  // The bathroom takes the HALL side of this band, and the strip behind it, on the
  // facade, is left unknown.
  //
  // An earlier version had these the other way round, so that the bathroom could
  // keep the facade window and the strip behind it could be called closets on the
  // strength of the 1875 text. Two things were wrong with that. Geometrically the
  // bathroom then reached only u = 8 while the hall starts at u = 16.5, so it did
  // not touch the hall at all and the door labelled hall-to-bathroom actually
  // opened into the strip -- you would have walked through the closets to reach the
  // bath. And the strip's use is not something this project knows: naming it from
  // the 1875 mention of closets is inference dressed as a source, which is the error
  // docs/DIMENSION-AUDIT.md exists to stop.
  //
  // So: the bathroom is the room you enter from the hall, and it is interior and
  // windowless, which is what a bathroom in a building of this period usually is.
  // The strip keeps the facade window and keeps its own ignorance.
  const unknownDeep = p.bedDepth - p.bathDeep - t;
  rooms.push({
    id: "unknown",
    label: "Unknown",
    u: 0,
    v,
    du: unknownDeep,
    dv: p.bathAlong,
    kind: "unknown",
    stated: "not mentioned",
    windows: ["facade"],
  });
  rooms.push({
    id: "bath",
    label: "Bathroom",
    u: unknownDeep + t,
    v,
    du: p.bathDeep,
    dv: p.bathAlong,
    kind: "bath",
    stated: "not given",
    windows: [],
  });
  v += p.bathAlong + t;

  // Bedroom B ends the hall at the gable: a corner room, windows in two
  // directions, which is what the 1875 specification requires.
  rooms.push({
    id: "bedB",
    label: "Bedroom B",
    u: 0,
    v,
    du: p.bedDepth,
    dv: p.sectionLength - v,
    kind: "bed",
    stated: "10 x 16",
    windows: ["facade", "gable"],
  });

  // Applied to the finished list rather than folded into each push above, so that
  // the seven rooms read exactly as they did before this option existed and the
  // whole of the wing behaviour sits in one function with one argument for it.
  if (p.wingStep) stepOntoTheWing(rooms, p);

  const area = (r: Rect) => r.du * r.dv;
  const named = new Set(["common1", "k", "bedA", "bath", "bedB"]);

  // Four rooms in a chain have THREE partitions between them. Getting this
  // wrong was what stopped the defaults from closing.
  const chain =
    p.commonAlong + p.bedAAlong + p.bathAlong + p.bedBAlong + 3 * t;

  return {
    rooms,
    params: p,
    netArea: rooms.reduce((a, r) => a + area(r), 0),
    roomArea: rooms.filter((r) => named.has(r.id)).reduce((a, r) => a + area(r), 0),
    maxDepth: Math.max(...rooms.map((r) => r.u + r.du)),
    residuals: {
      along: p.sectionLength - chain,
      across: p.legDepth - (p.hallWidth + t + p.bedDepth),
    },
  };
}

/** Float slack for "this room's outer face is the facade line". */
const STEP_EPS = 1e-9;

/**
 * Push the wing-zone rooms' outer wall out onto Weld's real wing wall.
 *
 * WHAT IS WRONG WITHOUT IT
 * Weld is a dumbbell, and the suite's 44 ft section crosses the step. place.ts
 * measures it off the ring: on the east the wall stands at building u 30.61 across
 * the wings and 25.44 in the end zone, a 5.17 ft projection. The suite runs from
 * building v 26.15 to 70.15 and the step is at 48.45, so the common room (26.15 to
 * 41.15) and K (26.15 to 38.15) sit in the wing zone while the unknown strip, the
 * bathroom and bedroom B (52.15 to 70.15) sit in the end zone. Measured from the modelled
 * facade's masonry mid-plane -- place.ts anchors the suite on a 49 ft clear width,
 * so its masonry runs building u 24.5 to 26.0 and its mid-plane is 25.25, which is
 * the plane weldGeometry.ts already hangs the window bays on -- the end-zone rooms
 * miss the real wall by 0.19 ft, which is right, and the wing-zone rooms miss it by
 * 5.36 ft, which is not. So the common room's "facade window" is not on an exterior
 * wall at all, and a 5.36 x 22.3 ft slab of Weld sits outside it with no access and
 * no purpose.
 *
 * WHAT IT DOES, AND WHAT THAT COSTS
 * A room whose whole v range lies in the wing zone has its outer face moved out by
 * the projection and its du grown by the same amount, so the INNER face does not
 * move. That is deliberate: K's door and the hall's inner wall are hung off the
 * common room's inner face, and moving it is not a change to one room.
 *
 * The cost is that the common room becomes commonDeep + projection = 25.17 ft deep,
 * which is past the 15-20 ft the resident gave. The other reading of the same evidence --
 * that the room is 20 ft deep measured from its OWN wall, which is what makes its
 * inner wall land within 1.2 ft of the bedrooms' and is the reason to believe the
 * step is real -- would keep du at 20 and shift the room bodily. That was built and
 * refused: it opens a 5.17 ft gap between the common room and K, touches() stops
 * finding them, and unreachableRooms() reports k. Both readings cannot be had, and a
 * suite with a landlocked common room is not a candidate.
 *
 * BEDROOM A STRADDLES THE STEP, AND IS LEFT STRAIGHT
 * At the defaults bedroom A runs building v 41.65 to 51.65 against a step at 48.45,
 * so 6.8 ft of it is in the wing zone and 3.2 ft in the end zone. A faithful stepped
 * bedroom A therefore has an L-shaped outer wall, which a Rect cannot hold and which
 * would need a second rect, a rule for which of the two carries the window, and a
 * story about what walls.ts should do with the re-entrant corner. It is NOT stepped
 * here, and it is not half-stepped either: moving all of it would put 3.2 ft of
 * bedroom outside the end-zone wall, and moving none of it leaves the straddle
 * visible and stated, which is the honest of the two failures.
 *
 * WHAT THE RENDER STILL GETS WRONG
 * walls.ts's perimeterWalls() lays the facade masonry at u = -masonry for the whole
 * sectionLength, one straight band, and this module cannot change that. So with
 * wingStep on that band runs THROUGH the deepened common room, and the 5.17 ft of
 * floor beyond it has no outer wall and no ceiling -- suiteFootprint() starts at
 * u = 0 as well. The step is real in the rooms, the areas and the plan; it is not
 * yet real in the masonry. design/renders/wing-common-stepped.png shows exactly
 * that, and a stepped perimeter band in walls.ts is what would finish it.
 */
function stepOntoTheWing(rooms: Rect[], p: SuiteParams): void {
  if (!measuredFacadeStep) {
    // Loud rather than silent, in the manner of weldGeometry's roofHeightAt: a suite
    // that quietly ignores wingStep would pass every assertion about the straight
    // layout while claiming to be the stepped one.
    throw new Error(
      "rooms: params.wingStep needs place.ts's ring measurement. Import @/geo/place " +
        "before building a stepped suite; see provideFacadeStep.",
    );
  }
  const { v: stepV, projection } = measuredFacadeStep(p);
  // A ring with no step yields zero, and zero has to mean "leave it alone" rather
  // than "move everything by nothing": the second would still rewrite the rooms.
  if (!(projection > 0)) return;

  for (const r of rooms) {
    // On the facade, i.e. its outer face IS the facade line. K is at u = 20.5 and is
    // inland, which is why it does not move even though it is in the wing zone.
    if (Math.abs(r.u) > STEP_EPS) continue;
    // Wholly south of the step. A room that reaches past it straddles it -- see
    // bedroom A above -- and straddling rooms are left where they are.
    if (r.v + r.dv > stepV + STEP_EPS) continue;
    r.u -= projection;
    r.du += projection;
  }
}

/** Do any two rooms overlap? Returns the offending pairs. */
export function findOverlaps(rooms: Rect[]): [string, string][] {
  const bad: [string, string][] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i]!;
      const b = rooms[j]!;
      const gap = 1e-9;
      const sep =
        a.u + a.du <= b.u + gap ||
        b.u + b.du <= a.u + gap ||
        a.v + a.dv <= b.v + gap ||
        b.v + b.dv <= a.v + gap;
      if (!sep) bad.push([a.id, b.id]);
    }
  }
  return bad;
}

/** Two rects share a wall segment of non-zero length. */
export function touches(a: Rect, b: Rect, t = 0.5): boolean {
  const eps = 1e-6;
  const uOverlap =
    Math.min(a.u + a.du, b.u + b.du) - Math.max(a.u, b.u) > eps;
  const vOverlap =
    Math.min(a.v + a.dv, b.v + b.dv) - Math.max(a.v, b.v) > eps;
  const uAdjacent =
    Math.abs(a.u + a.du + t - b.u) < eps || Math.abs(b.u + b.du + t - a.u) < eps;
  const vAdjacent =
    Math.abs(a.v + a.dv + t - b.v) < eps || Math.abs(b.v + b.dv + t - a.v) < eps;
  return (uAdjacent && vOverlap) || (vAdjacent && uOverlap);
}

/**
 * Every room must be reachable from the hall, directly or through another room.
 * K is reached through the common room, which is what "attached to the common
 * room" means; everything else opens off the hall.
 *
 * Rooms of kind "unknown" are exempt, and the exemption is the point rather than a
 * loophole. The 7.5 ft strip on the facade beside the bathroom is space this
 * project can measure and cannot name; giving it a door would mean choosing whose
 * door it is, and every choice available -- closet off bedroom A, store off the
 * bathroom -- asserts a use no source supports. So it is modelled as enclosed
 * space with no opening, and this gate is told not to read that as a defect. If it
 * ever acquires a use, it stops being kind "unknown" and the gate applies again.
 */
export function unreachableRooms(suite: Suite): string[] {
  const byId = new Map(suite.rooms.map((r) => [r.id, r]));
  const t = suite.params.partition;
  const seen = new Set<string>(["hall"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of suite.rooms) {
      if (seen.has(r.id)) continue;
      for (const s of seen) {
        if (touches(r, byId.get(s)!, t)) {
          seen.add(r.id);
          grew = true;
          break;
        }
      }
    }
  }
  return suite.rooms
    .filter((r) => r.kind !== "unknown" && !seen.has(r.id))
    .map((r) => r.id);
}
