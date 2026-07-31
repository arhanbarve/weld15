import { it } from "vitest";
import { keyframes } from "@/scene/stages";
import { DEFAULT_PARAMS } from "@/geo/rooms";
import { nearFar, layerOpacity } from "@/scene/altitude";
it("print", () => {
  const kf = keyframes(DEFAULT_PARAMS);
  for (const s of [0,1,2,3,4,5] as const) {
    const k = kf[s]; const p = k.position, t = k.target;
    const d = Math.hypot(p[0]-t[0], p[1]-t[1], p[2]-t[2]);
    const tilt = Math.acos((p[1]-t[1])/d)*180/Math.PI;
    const az = Math.atan2(p[0], p[2])*180/Math.PI;
    const nf = nearFar(p[1]); const o = layerOpacity(p[1]);
    console.log(`kf${s} alt=${p[1].toFixed(1).padStart(12)} dist=${d.toFixed(1).padStart(11)} tilt=${tilt.toFixed(2).padStart(6)} az=${az.toFixed(1).padStart(6)} near=${nf.near.toFixed(2).padStart(7)} far=${nf.far.toFixed(0).padStart(9)}`);
    console.log(`      pos=[${p.map(v=>v.toFixed(1)).join(", ")}] tgt=[${t.map(v=>v.toFixed(1)).join(", ")}]`);
    console.log(`      globe=${o.globe.toFixed(2)} q1=${o.q1.toFixed(2)} q2=${o.q2.toFixed(2)} q3=${o.q3.toFixed(2)} q4=${o.q4.toFixed(2)} mass=${o.massing.toFixed(2)} tint=${o.tint.toFixed(2)}`);
  }
});
