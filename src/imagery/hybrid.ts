/**
 * Luma from one photograph, colour from another.
 *
 * WHY THIS EXISTS. L4 is the plate that fills the frame at stages 2 and 3, at 0.52 ft/texel. The
 * only source with that detail over Cambridge is MassGIS's 2025 orthoimagery, and it is flown
 * LEAF-OFF: bare canopy, dormant turf, and measured mean saturation of 0.095 in the plate that
 * shipped. The only leaf-on sources this project may redistribute are NAIP (public domain) and
 * nothing else -- and NAIP is about 2 ft, which at L4's grid would be a 3.8x upsample.
 *
 * So the detail comes from the source that has detail and the colour from the source that has
 * colour. In aerial imagery chroma is low-frequency anyway -- a roof is one colour across its whole
 * span -- so borrowing it costs nothing that is visible.
 *
 * THE VEGETATION MASK IS NOT AN OPTIMISATION, IT IS THE WHOLE IDEA. Where there is canopy the two
 * photographs disagree about what is on the ground, not merely about its colour: the leaf-off plate
 * is a picture of pavement seen through bare branches. Painting NAIP's green onto that gives green
 * footpaths. So canopy takes BOTH its luma and its colour from the leaf-on plate, going soft in the
 * one place softness is invisible -- a tree crown has no hard edge to lose -- and everywhere else
 * keeps the 15 cm detail.
 *
 * THREE-FREE AND ALIAS-FREE. scripts/fetch-imagery.mjs imports this module directly, and Node's
 * TypeScript stripping resolves neither "three" nor the "@/" alias. tests/i3s.test.ts asserts the
 * same property for the other build-script module.
 */

/**
 * Green-excess thresholds for the vegetation mask, in 8-bit units of G - (R+B)/2.
 * Below T0 nothing is treated as canopy; above T1 everything is.
 *
 * RETUNED AFTER THE FIRST PASS FAILED ON REAL CANOPY. T0=6/T1=24 was the first guess, tried on the
 * Harvard Yard trial tile in P10-EXTERIOR-PLAN Task 4 Step 6. It failed: shaded and partially-lit
 * pixels inside real tree crowns often don't clear a green-excess of 24, so the mask never
 * saturated to 1 across the whole canopy interior -- it dipped in patches, and through those dips
 * MassGIS's leaf-off luma showed through. Visibly, that meant ghosted diagonal paths and bare
 * branch structure appearing inside tree crowns that should have read as solid canopy.
 *
 * T0=0, T1=15 (with an 8 ft blur sigma on the vegetation mask, applied by the caller -- see below)
 * fixed it: a wider, lower threshold band means more of the canopy interior confidently reaches
 * mask=1, and the wider blur smooths over what dips remain rather than tracking every shadow.
 * Compared against a T0=-5/T1=10/12ft variant that was visually equivalent: T0=0 was chosen because
 * it keeps "green excess" physically meaningful -- excess >= 0 means G is at least the average of
 * R and B, which is the least a pixel can do and still plausibly be vegetation. T0 < 0 would count
 * slightly-below-neutral pixels as vegetation with no clean physical reading, and 8ft blur was kept
 * over 15ft because it was already sufficient -- no reason to smear mask edges further than the
 * artifact required. All three were compared side by side in
 * design/renders/p10-hybrid-trial/{c-hybrid-masked,a-naip-only,b-massgis-only}.png.
 *
 * THE BLUR SIGMA IS NOT A CONSTANT HERE because blur() takes it in texels, not feet, and this
 * module doesn't know a level's ftPerTexel. It is the caller's job (fetch-imagery.mjs's L4 hybrid
 * branch, P10-EXTERIOR-PLAN Task 5) to call blur(vegetationMask(...), W, H, 8 / ftPerTexel) --
 * 8 ft, chosen here, converted to texels there.
 */
export const VEG_T0 = 0;
export const VEG_T1 = 15;

/** Rec. 709 luma, the same weights Ground.tsx's shader desaturates with. */
export function luma(p: ArrayLike<number>, o = 0): number {
  return 0.2126 * p[o]! + 0.7152 * p[o + 1]! + 0.0722 * p[o + 2]!;
}

/**
 * Per-pixel vegetation mask over a raw RGBA buffer, as a 0..1 field.
 *
 * Returns Float32Array of width*height so it can be blurred before use -- a hard mask edge would
 * cut a visible line across the middle of a tree.
 */
export function vegetationMask(rgba: ArrayLike<number>, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const k = i * 4;
    const excess = rgba[k + 1]! - (rgba[k]! + rgba[k + 2]!) / 2;
    out[i] = Math.min(1, Math.max(0, (excess - VEG_T0) / (VEG_T1 - VEG_T0)));
  }
  return out;
}

/**
 * Separable Gaussian blur over a scalar field, edges clamped.
 *
 * Separable because a 2D Gaussian is the product of two 1D ones, so an r-radius blur costs 2r
 * samples per pixel rather than r^2. At the sigmas here that is the difference between a second
 * and a minute over a 3072 x 3072 plate.
 */
export function blur(field: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma <= 0) return field.slice();
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp((-i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i]! /= sum;

  const clamp = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r]! * field[y * width + clamp(x + i, width - 1)]!;
      tmp[y * width + x] = a;
    }
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r]! * tmp[clamp(y + i, height - 1) * width + x]!;
      out[y * width + x] = a;
    }
  }
  return out;
}

/**
 * One pixel: luma chosen by the mask, chroma always from the colour source.
 *
 * Works in YCbCr rather than by scaling RGB, because scaling RGB toward a target luma shifts the
 * hue of anything saturated -- a red roof rescaled to a darker luma goes brown. YCbCr moves
 * brightness without touching the colour difference channels, which is exactly the operation
 * wanted here and is why broadcast has used it for sixty years.
 */
export function recombine(
  detail: ArrayLike<number>,
  colour: ArrayLike<number>,
  mask: number,
  detailOffset = 0,
  colourOffset = 0,
): [number, number, number] {
  const yDetail = luma(detail, detailOffset);
  const yColour = luma(colour, colourOffset);
  const y = yDetail + (yColour - yDetail) * mask;

  const cr = colour[colourOffset]! - yColour;
  const cb = colour[colourOffset + 2]! - yColour;

  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const r = y + cr;
  const b = y + cb;
  // G falls out of the luma identity: y = 0.2126r + 0.7152g + 0.0722b.
  const g = (y - 0.2126 * r - 0.0722 * b) / 0.7152;
  return [clamp(r), clamp(g), clamp(b)];
}
