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
};

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

  // Bathroom takes the facade side so it is not a windowless interior box; the
  // strip behind it becomes closets, which the 1875 text says every room had.
  rooms.push({
    id: "bath",
    label: "Bathroom",
    u: 0,
    v,
    du: p.bathDeep,
    dv: p.bathAlong,
    kind: "bath",
    stated: "not given",
    windows: ["facade"],
  });
  rooms.push({
    id: "closets",
    label: "Closets",
    u: p.bathDeep + t,
    v,
    du: p.bedDepth - p.bathDeep - t,
    dv: p.bathAlong,
    kind: "service",
    stated: "not mentioned",
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
  return suite.rooms.filter((r) => !seen.has(r.id)).map((r) => r.id);
}
