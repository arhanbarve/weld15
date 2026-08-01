import { MATTRESS, SIZES, type FurnitureKind } from "./furniture";

/**
 * What a piece of furniture is actually built from, in the piece's own frame.
 *
 * WHY THIS EXISTS SEPARATELY FROM furniture.ts
 * furniture.ts's SIZES is a footprint and a height for layout and collision --
 * a box collide.ts can test against, nothing more. This module answers a
 * different question: what does the box contain? The two must never be
 * conflated, which is why the footprint rule below is a property every part
 * satisfies rather than a convention.
 *
 * COORDINATES
 * Local to the piece, origin at its own low corner, BEFORE yaw -- the same
 * frame SIZES[kind].du/dv describe. u runs across the face you approach the
 * piece from, v from the wall behind it forward, y upward from the floor the
 * piece stands on. Furniture.tsx applies suite yaw and piece yaw to the whole
 * assembly; nothing in this module rotates anything.
 *
 * THE FOOTPRINT IS INVIOLABLE, THE HEIGHT IS NOT
 * Every part satisfies 0 <= u, u + du <= SIZES[kind].du, and the same in v --
 * collide.ts, drag.ts and placeIsLegal() all depend on SIZES[kind] being the
 * true plan extent, and a part that spilled past it would be a piece that
 * collides with a wall it looks clear of. Height has no such guarantee:
 * SIZES[kind].h is a declared figure nothing enforces, and a bed's headboard
 * is taller than its 2.0 ft frame. drawnHeight() reports what is actually
 * drawn, which the bed alone uses to exceed SIZES.bed.h.
 *
 * Every dimension below is ASSUMED except the mattress, which comes through
 * MATTRESS -- the one figure in furniture.ts with a source.
 */

export type PartMaterial = "oak" | "textile" | "hardware";

/** A box in the piece's own frame: origin at its low corner, before any yaw. */
export type Part = {
  u: number;
  v: number;
  du: number;
  dv: number;
  y0: number;
  y1: number;
  material: PartMaterial;
};

function bed(): Part[] {
  const { du, dv } = SIZES.bed;
  const LEG_W = 0.25;
  const RAIL_T = 0.15;
  const HEAD_T = 0.1;
  const FOOT_T = 0.1;
  // The mattress sits centred in the frame, inset by exactly the allowance
  // withFrame() gives it on each side -- derived, not re-guessed, for the
  // same reason Furniture.tsx's old BEDDING_INSET was.
  const insetU = (du - MATTRESS.du) / 2;
  const insetV = (dv - MATTRESS.dv) / 2;
  const mattU0 = insetU;
  const mattU1 = insetU + MATTRESS.du;
  const mattV0 = insetV;
  const mattV1 = insetV + MATTRESS.dv;

  const parts: Part[] = [];
  // Four corner legs.
  for (const u of [0, du - LEG_W]) {
    for (const v of [0, dv - LEG_W]) {
      parts.push({ u, v, du: LEG_W, dv: LEG_W, y0: 0, y1: 1.0, material: "oak" });
    }
  }
  // Two side rails, running the length, at the outer v edges.
  for (const v of [0, dv - RAIL_T]) {
    parts.push({ u: LEG_W, v, du: du - 2 * LEG_W, dv: RAIL_T, y0: 1.0, y1: 1.45, material: "oak" });
  }
  // Two end rails, at head (u=0) and foot (u=du), running the width.
  for (const u of [0, du - RAIL_T]) {
    parts.push({ u, v: LEG_W, du: RAIL_T, dv: dv - 2 * LEG_W, y0: 1.0, y1: 1.45, material: "oak" });
  }
  // Slat deck, the inner footprint the rails enclose.
  parts.push({
    u: LEG_W, v: LEG_W, du: du - 2 * LEG_W, dv: dv - 2 * LEG_W,
    y0: 1.45, y1: 1.5, material: "oak",
  });
  // Headboard: two posts rising past the frame, a panel between them.
  for (const v of [0, dv - LEG_W]) {
    parts.push({ u: 0, v, du: LEG_W, dv: LEG_W, y0: 0, y1: 3.4, material: "oak" });
  }
  parts.push({
    u: 0, v: LEG_W, du: HEAD_T, dv: dv - 2 * LEG_W, y0: 2.2, y1: 3.3, material: "oak",
  });
  // Footboard, at the foot end.
  parts.push({
    u: du - FOOT_T, v: LEG_W, du: FOOT_T, dv: dv - 2 * LEG_W, y0: 1.0, y1: 1.9, material: "oak",
  });
  // Mattress, pillow at the head, blanket folded across the foot.
  parts.push({
    u: mattU0, v: mattV0, du: MATTRESS.du, dv: MATTRESS.dv, y0: 1.5, y1: 2.0, material: "textile",
  });
  const pillowDu = 1.1;
  const pillowDv = 1.7;
  parts.push({
    u: mattU0, v: mattV0 + (MATTRESS.dv - pillowDv) / 2,
    du: pillowDu, dv: pillowDv, y0: 2.0, y1: 2.35, material: "textile",
  });
  const blanketDu = 1.6;
  parts.push({
    u: mattU1 - blanketDu, v: mattV0, du: blanketDu, dv: MATTRESS.dv,
    y0: 2.0, y1: 2.12, material: "textile",
  });
  return parts;
}

function desk(): Part[] {
  const { du, dv } = SIZES.desk;
  const TOP_T = 0.12;
  const OVERHANG = 0.15;
  const END_T = 0.1;
  const MODESTY_T = 0.08;
  const carcaseTop = SIZES.desk.h - TOP_T;
  const frontFace = dv - OVERHANG;

  const parts: Part[] = [
    // Top, overhanging the carcase on the left, right and front (v = dv).
    { u: 0, v: 0, du, dv, y0: carcaseTop, y1: SIZES.desk.h, material: "oak" },
    // Two end panels, flush at the back (v = 0), inset elsewhere under the overhang.
    { u: OVERHANG, v: 0, du: END_T, dv: frontFace, y0: 0, y1: carcaseTop, material: "oak" },
    { u: du - OVERHANG - END_T, v: 0, du: END_T, dv: frontFace, y0: 0, y1: carcaseTop, material: "oak" },
    // Modesty panel at the back, between the end panels.
    {
      u: OVERHANG + END_T, v: 0, du: du - 2 * (OVERHANG + END_T), dv: MODESTY_T,
      y0: 0.9, y1: 2.3, material: "oak",
    },
  ];

  // Three drawer fronts down the right-hand end, proud of the carcase.
  const drawerU = du - OVERHANG - END_T;
  const reveal = 0.03;
  const bandH = (carcaseTop - 2 * reveal) / 3;
  const proud = 0.06;
  for (let i = 0; i < 3; i++) {
    const y0 = i * (bandH + reveal);
    parts.push({ u: drawerU, v: frontFace, du: END_T, dv: proud, y0, y1: y0 + bandH, material: "oak" });
    // One pull each, proud again of the drawer front.
    const pullT = 0.02;
    const pullW = 0.3;
    parts.push({
      u: drawerU + (END_T - pullW) / 2, v: frontFace + proud,
      du: pullW, dv: pullT, y0: y0 + bandH / 2 - 0.02, y1: y0 + bandH / 2 + 0.02,
      material: "hardware",
    });
  }
  return parts;
}

function chair(): Part[] {
  const { du, dv, h } = SIZES.chair;
  const LEG_W = 0.15;
  const SEAT_T = 0.15;
  // An ordinary chair-seat height, fixed rather than derived from h, so that
  // raising the back stiles never silently raises the seat with them.
  const SEAT_H = 1.5;

  const parts: Part[] = [
    { u: 0, v: 0, du, dv, y0: SEAT_H - SEAT_T, y1: SEAT_H, material: "oak" },
  ];
  // Front two legs, stopping under the seat.
  for (const u of [0, du - LEG_W]) {
    parts.push({ u, v: 0, du: LEG_W, dv: LEG_W, y0: 0, y1: SEAT_H - SEAT_T, material: "oak" });
  }
  // Rear two legs, continuing past the seat as back stiles.
  for (const u of [0, du - LEG_W]) {
    parts.push({ u, v: dv - LEG_W, du: LEG_W, dv: LEG_W, y0: 0, y1: h, material: "oak" });
  }
  // Two back slats between the stiles.
  const slatT = 0.08;
  parts.push({ u: LEG_W, v: dv - LEG_W, du: du - 2 * LEG_W, dv: slatT, y0: 1.55, y1: 2.05, material: "oak" });
  parts.push({ u: LEG_W, v: dv - LEG_W, du: du - 2 * LEG_W, dv: slatT, y0: 2.15, y1: h, material: "oak" });
  return parts;
}

function dresser(): Part[] {
  const { du, dv, h } = SIZES.dresser;
  const TOP_T = 0.12;
  const OVERHANG = 0.14;
  const SIDE_T = 0.1;
  const PLINTH_H = 0.25;
  const PLINTH_SET = 0.08;
  const carcaseTop = h - TOP_T;
  const frontFace = dv - OVERHANG;

  const parts: Part[] = [
    { u: 0, v: 0, du, dv, y0: carcaseTop, y1: h, material: "oak" },
    { u: OVERHANG, v: 0, du: SIDE_T, dv: frontFace, y0: PLINTH_H, y1: carcaseTop, material: "oak" },
    { u: du - OVERHANG - SIDE_T, v: 0, du: SIDE_T, dv: frontFace, y0: PLINTH_H, y1: carcaseTop, material: "oak" },
    {
      u: OVERHANG + PLINTH_SET, v: 0,
      du: du - 2 * (OVERHANG + PLINTH_SET), dv: frontFace - PLINTH_SET,
      y0: 0, y1: PLINTH_H, material: "oak",
    },
  ];

  const drawerU0 = OVERHANG + SIDE_T;
  const drawerDu = du - 2 * (OVERHANG + SIDE_T);
  const reveal = 0.03;
  const bandH = (carcaseTop - PLINTH_H - 2 * reveal) / 3;
  const proud = 0.06;
  for (let i = 0; i < 3; i++) {
    const y0 = PLINTH_H + i * (bandH + reveal);
    parts.push({ u: drawerU0, v: frontFace, du: drawerDu, dv: proud, y0, y1: y0 + bandH, material: "oak" });
    const pullT = 0.02;
    const pullW = 0.25;
    const centreU1 = drawerU0 + drawerDu / 3 - pullW / 2;
    const centreU2 = drawerU0 + (2 * drawerDu) / 3 - pullW / 2;
    for (const u of [centreU1, centreU2]) {
      parts.push({
        u, v: frontFace + proud, du: pullW, dv: pullT,
        y0: y0 + bandH / 2 - 0.02, y1: y0 + bandH / 2 + 0.02, material: "hardware",
      });
    }
  }
  return parts;
}

function sofa(): Part[] {
  const { du, dv, h } = SIZES.sofa;
  const LEG = 0.15;
  const LEG_H = 0.35;
  const ARM_W = 0.5;
  const ARM_H = 1.9;
  const BASE_MARGIN = 0.15;
  const BACK_T = 0.4;
  const SEAT_Y1 = 0.95;
  const SEAT_T = 0.45;

  const parts: Part[] = [];
  for (const u of [0, du - LEG]) {
    for (const v of [0, dv - LEG]) {
      parts.push({ u, v, du: LEG, dv: LEG, y0: 0, y1: LEG_H, material: "oak" });
    }
  }
  parts.push({
    u: BASE_MARGIN, v: BASE_MARGIN, du: du - 2 * BASE_MARGIN, dv: dv - 2 * BASE_MARGIN,
    y0: LEG_H, y1: LEG_H + 0.25, material: "oak",
  });
  // Seat cushion, between the arms, in front of the back cushion.
  parts.push({
    u: ARM_W, v: 0, du: du - 2 * ARM_W, dv: dv - BACK_T,
    y0: SEAT_Y1 - SEAT_T, y1: SEAT_Y1, material: "textile",
  });
  // Back cushion, the full height, at the rear.
  parts.push({
    u: ARM_W, v: dv - BACK_T, du: du - 2 * ARM_W, dv: BACK_T,
    y0: SEAT_Y1 - SEAT_T, y1: h, material: "textile",
  });
  // Two arms, the full depth.
  for (const u of [0, du - ARM_W]) {
    parts.push({ u, v: 0, du: ARM_W, dv, y0: LEG_H, y1: ARM_H, material: "textile" });
  }
  return parts;
}

function table(): Part[] {
  const { du, dv, h } = SIZES.table;
  const TOP_T = 0.2;
  const OVERHANG = 0.15;
  const LEG_W = 0.28;
  const STRETCHER_W = 0.12;
  const carcaseTop = h - TOP_T;

  const parts: Part[] = [
    { u: 0, v: 0, du, dv, y0: carcaseTop, y1: h, material: "oak" },
  ];
  for (const u of [OVERHANG, du - OVERHANG - LEG_W]) {
    for (const v of [OVERHANG, dv - OVERHANG - LEG_W]) {
      parts.push({ u, v, du: LEG_W, dv: LEG_W, y0: 0, y1: carcaseTop, material: "oak" });
    }
  }
  // Two stretchers, one along each row of legs, centred at 0.5 ft.
  for (const v of [OVERHANG + LEG_W / 2 - STRETCHER_W / 2, dv - OVERHANG - LEG_W / 2 - STRETCHER_W / 2]) {
    parts.push({
      u: OVERHANG + LEG_W, v, du: du - 2 * (OVERHANG + LEG_W), dv: STRETCHER_W,
      y0: 0.5 - STRETCHER_W / 2, y1: 0.5 + STRETCHER_W / 2, material: "oak",
    });
  }
  return parts;
}

function shelf(): Part[] {
  const { du, dv, h } = SIZES.shelf;
  const SIDE_T = 0.1;
  const BACK_T = 0.05;
  const PLINTH_H = 0.3;
  const PLINTH_SET = 0.06;
  const SHELF_T = 0.08;

  const parts: Part[] = [
    { u: 0, v: 0, du: SIDE_T, dv: dv - PLINTH_SET, y0: PLINTH_H, y1: h, material: "oak" },
    { u: du - SIDE_T, v: 0, du: SIDE_T, dv: dv - PLINTH_SET, y0: PLINTH_H, y1: h, material: "oak" },
    {
      u: PLINTH_SET, v: PLINTH_SET, du: du - 2 * PLINTH_SET, dv: dv - PLINTH_SET,
      y0: 0, y1: PLINTH_H, material: "oak",
    },
    { u: SIDE_T, v: 0, du: du - 2 * SIDE_T, dv: BACK_T, y0: PLINTH_H, y1: h, material: "oak" },
  ];
  for (const y0 of [0.35, 1.3, 2.25, 3.2]) {
    parts.push({
      u: SIDE_T, v: BACK_T, du: du - 2 * SIDE_T, dv: dv - BACK_T,
      y0, y1: y0 + SHELF_T, material: "oak",
    });
  }
  return parts;
}

const BUILDERS: Record<FurnitureKind, () => Part[]> = {
  bed, desk, chair, dresser, sofa, table, shelf,
};

export function partsOf(kind: FurnitureKind): Part[] {
  return BUILDERS[kind]();
}

/**
 * The tallest point the kind actually draws, which is NOT SIZES[kind].h for
 * the bed -- the headboard rises to 3.4 ft against a declared frame height of
 * 2.0. Derived from the parts rather than tabulated a second time, so the two
 * cannot drift apart the way a copied figure would.
 */
export function drawnHeight(kind: FurnitureKind): number {
  return Math.max(...partsOf(kind).map((p) => p.y1));
}
