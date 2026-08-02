import { describe, it, expect } from "vitest";
import { DEFAULT_PARAMS, type SuiteParams } from "@/geo/rooms";
import { keyframes, cameraKeyframe } from "@/scene/stages";
import { legs, boundaries, toJourney, fromJourney } from "@/scene/journey";

// journey.ts's MIN_SPAN is not exported, by design -- callers see spans, not the floor
// under them. 0.05 here is that same literal, kept honest by the assertion that uses it.
const MIN_SPAN = 0.05;

describe("legs", () => {
  it("weights the three descent legs by decades of altitude, at DEFAULT_PARAMS", () => {
    const l = legs(DEFAULT_PARAMS);
    // Leg 2 fell from 0.8698 to 0.5993 decades in P12, and that is kf[3] moving rather than
    // this weighting changing: the stage-3 stop rose from 110 ft to 204.96 ft (stages.ts
    // records why -- at 110 the real world's own Widener stands in the shot), so the drop
    // from stage 2's 814.6 ft is log10(814.6 / 204.96) = 0.5993 instead of log10(814.6 / 110).
    const want = [3.2832, 1.3021, 0.5993, 0.6, 0.9];
    l.forEach((leg, i) => expect(leg.span, `leg ${i}`).toBeCloseTo(want[i]!, 3));
    const total = l.reduce((a, b) => a + b.span, 0);
    expect(total).toBeCloseTo(6.6846, 3);
  });
});

describe("boundaries", () => {
  it("places the six stage ticks, ascending, at DEFAULT_PARAMS", () => {
    const b = boundaries(DEFAULT_PARAMS);
    // These are the spans above, divided by their total. They moved in P12 because leg 2
    // did (see that test): a shorter third descent leg is a smaller share of a smaller bar,
    // so every interior tick shifts right. The plan's original worked table (0.4720, 0.6592,
    // 0.7843, 0.8706) belongs to the pre-P12 stage-3 altitude and to a span table rounded to
    // 3-4 significant figures before dividing; this is the division the actual keyframes()
    // geometry produces.
    const want = [0, 0.4912, 0.686, 0.7756, 0.8654, 1];
    b.forEach((x, i) => expect(x, `tick ${i}`).toBeCloseTo(want[i]!, 4));
    for (let i = 1; i < b.length; i++) {
      expect(b[i]!, `tick ${i} follows tick ${i - 1}`).toBeGreaterThan(b[i - 1]!);
    }
  });
});

describe("toJourney / fromJourney round trip", () => {
  it("recovers u to within 1e-12 across 10,000 samples", () => {
    for (let i = 0; i <= 10_000; i++) {
      const u = i / 10_000;
      const { stage, t } = fromJourney(u, DEFAULT_PARAMS);
      const back = toJourney(stage, t, DEFAULT_PARAMS);
      expect(back, `u=${u}`).toBeCloseTo(u, 12);
    }
  });

  it("lands exactly on each tick", () => {
    const b = boundaries(DEFAULT_PARAMS);
    for (let k = 0; k <= 4; k++) {
      expect(fromJourney(b[k]!, DEFAULT_PARAMS)).toEqual({ stage: k, t: 0 });
    }
    expect(fromJourney(1, DEFAULT_PARAMS)).toEqual({ stage: 5, t: 0 });
  });
});

describe("monotone in altitude", () => {
  it("never climbs while descending through stages 0-2", () => {
    const params = DEFAULT_PARAMS;
    const kf = keyframes(params);
    const b = boundaries(params);
    let prevAlt = Infinity;
    for (let i = 0; i <= 500; i++) {
      const u = (i / 500) * b[3]!; // stay within the descent, stages 0-2
      const { stage, t } = fromJourney(u, params);
      const alt = cameraKeyframe(kf, stage, t).position[1];
      expect(alt, `u=${u.toFixed(4)} stage=${stage} t=${t.toFixed(4)}`).toBeLessThanOrEqual(
        prevAlt + 1e-6,
      );
      prevAlt = alt;
    }
  });
});

/**
 * 18 params sets, swept the same way rooms.test.ts and route.test.ts already do
 * (jittered() there, the 500-iteration sweep in rooms.test.ts): a deterministic LCG
 * perturbing every free dimension plus the facade flip. stages.test.ts itself has no
 * committed params-sweep fixture to reuse, so this reuses that same generator at 18
 * samples rather than inventing an unrelated one.
 */
export function paramsSweep(): SuiteParams[] {
  let seed = 20260731;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const jitter = (base: number, spread: number) => base + (rnd() * 2 - 1) * spread;
  const out: SuiteParams[] = [];
  for (let i = 0; i < 18; i++) {
    const p: SuiteParams = {
      ...DEFAULT_PARAMS,
      facade: rnd() < 0.5 ? "east" : "west",
      sectionLength: jitter(44, 4),
      hallWidth: jitter(4.5, 1),
      bedDepth: jitter(16, 1),
      commonAlong: jitter(15, 1),
      commonDeep: jitter(20, 2),
      bedAAlong: jitter(10, 1),
      bathAlong: jitter(8, 2),
      bathDeep: jitter(8, 1.5),
      kDeep: jitter(10, 1),
      kAlong: jitter(12, 1),
    };
    p.legDepth = p.hallWidth + p.partition + p.bedDepth;
    out.push(p);
  }
  return out;
}

describe("params robustness", () => {
  it("keeps every leg span floored, boundaries increasing, and the round trip exact", () => {
    for (const [i, params] of paramsSweep().entries()) {
      const l = legs(params);
      for (const leg of l) {
        expect(leg.span, `set ${i}, stage ${leg.stage}`).toBeGreaterThanOrEqual(MIN_SPAN);
      }
      const b = boundaries(params);
      for (let k = 1; k < b.length; k++) {
        expect(b[k]!, `set ${i}, tick ${k}`).toBeGreaterThan(b[k - 1]!);
      }
      for (let j = 0; j <= 20; j++) {
        const u = j / 20;
        const { stage, t } = fromJourney(u, params);
        expect(toJourney(stage, t, params), `set ${i}, u=${u}`).toBeCloseTo(u, 9);
      }
    }
  });
});
