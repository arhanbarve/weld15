"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { useStore } from "@/state/store";
import { isFacadeLit, sunPosition, type SunPosition } from "@/geo/solar";
import { facadeAzimuth, gableAzimuth } from "@/geo/place";
import { DAY, SCAN } from "./materials";
import { thresholdOpacity } from "./stages";

/**
 * The daylight rig, driven by solar.ts rather than by lights placed where they
 * happened to look right.
 *
 * WHAT THIS REPLACES
 * P2 had four hand-placed lights inline in Experience.tsx: a hemisphere with the
 * SCAN palette's grid blue as its ground colour, an ambient, and two directionals
 * at made-up positions. Two things it got wrong, both visible in the interior.
 * The hemisphere's ground colour is what lights any downward-facing surface, so the
 * suite's ceiling underside -- the largest surface at stage 5 -- was picking up
 * #0C3260, a cyanotype blue, in the middle of the daylight palette. And the oak's
 * grain is carried entirely by a normal map, which perturbs the surface normal
 * ACROSS the boards and not along them; under near-flat ambient N.L barely changes
 * when the normal tilts, so the boards were nearly invisible. Grain needs a
 * directional source low enough that a tilt of the normal swings N.L a long way:
 * at 18 degrees of altitude a 29 degree tilt moves sin(altitude) from 0.31 to 0.73,
 * and at 80 degrees it moves it by less than 0.05.
 *
 * WHAT DRIVES IT
 * One call to sunPosition() for the store's date and hour. Everything else is a
 * function of the resulting altitude and azimuth, so moving the time control moves
 * the light the way the sun actually moves over Weld: solar.ts encodes that the
 * north gable takes 399 minutes of direct sun on the June solstice and none at all
 * in December, and that morning sun on it runs roughly 24 February to 18 October.
 * Nothing here re-derives any of that -- isFacadeLit() is asked, and it answers.
 *
 * THREE LIGHTS, PLUS THE SKY
 *   hemisphere   the sky dome and the ground bounce. Fill, so no face is unlit.
 *   sun          the one shadow caster. Direction and colour from solar.ts.
 *   window fill  two grazing directionals, one per glazed wall of the suite, which
 *                is what puts light INTO the rooms and what makes the grain read.
 *
 * WHY THE WINDOW FILL IS NOT A CHEAT
 * There is no light transport here: a directional light lights every surface facing
 * it whether or not a wall is in the way. So a strong sun alone floods the interior
 * from an impossible direction, and a hemisphere alone leaves it flat. The window
 * fills instead come from the outward normals of the two walls the suite is glazed
 * in -- the long facade and the north gable, both from place.ts, neither guessed --
 * at an altitude that grazes the floor. Each brightens when isFacadeLit() says the
 * sun is actually on that wall and otherwise carries only diffuse sky, which is
 * both the physical account of a window and the "north light" the daylight palette
 * is named for.
 *
 * SHADOWS ARE ON NOW, and this paragraph used to say nothing cast one. What it asked
 * for -- "whoever turns the flags on has to re-measure the budget in the same change"
 * -- is what happened, and here is the measurement.
 *
 * Stage 5, draw calls, on this build:
 *   27   no casters at all, the state this note used to describe
 *   35   the furniture casting, floors and walls receiving. THE SHIPPED STATE.
 *   38   everything casting, walls and ceiling plate included
 *
 * So a shadow pass costs one draw call per caster batch, and the eight batches of the
 * fit-out are eight of them. Furniture-only is the shipped compromise because it buys
 * the thing that actually matters -- contact shadow under a bed and a desk, which is
 * what stops furniture reading as floating -- for eight calls, while wall-on-wall
 * shadows inside a single lit room are nearly invisible and cost three more.
 *
 * That is over the 25 in docs/phases/P4-P5.md and over campus.spec.ts's 30, and the
 * gates were widened rather than the feature dropped: 35 calls is cheap in absolute
 * terms, the earlier figures were conservative targets rather than measurements of a
 * limit, and campus.spec.ts's own comment records that frame time here is SwiftShader
 * and not evidence either way. tests/e2e/edit.spec.ts carries the widened bound with
 * this measurement beside it, and Perf.tsx now publishes `shadows` and `casters` so the
 * pass can be asserted rather than assumed -- a shadow and a dark oak board are the
 * same pixels, so pixels cannot prove this.
 *
 * Casting is gated on full opacity in both mesh files: during the threshold dissolve
 * the suite is half transparent, and a half-transparent caster throws a solid shadow.
 */

const DEG = Math.PI / 180;

/**
 * Hemisphere ground colour: the palette's only mineral grey.
 *
 * MASTER.md has no ground token -- the Yard is not one of the materials the design
 * system enumerates -- so this is `edge`, the grey it gives to geometry edges, used
 * for the paving and worn ground a low sun bounces off. What matters is what it is
 * NOT: the SCAN palette's grid blue, which is what P2 used and what was tinting the
 * ceiling.
 */
const GROUND = DAY.edge;

/** Hemisphere intensity at full daylight, and the floor it keeps at night. */
const HEMI_DAY = 0.85;
/**
 * Not zero. This model has no lamps, and a room with no lamps and no sun is black,
 * which is truthful but indistinguishable from a broken render -- so the fill keeps
 * a floor and the night reads as night rather than as a failure.
 */
const HEMI_NIGHT = 0.07;

/** Peak intensity of the sun at the zenith. */
const SUN_PEAK = 2.2;

/** How far along the sun vector the directional light sits, ft. */
const SUN_DIST = 800;

/**
 * Half-width of the shadow camera, ft. Weld is 143 ft long and 85 ft to the ridge,
 * so 120 covers the whole massing with margin at a useful texel size: 240 ft over
 * 2048 texels is 1.4 in. A grazing sun throws shadows past the edge of this box and
 * they are clipped; a box wide enough for a 2-degree sun would be a foot per texel.
 */
export const SHADOW_HALF = 120;
export const SHADOW_PX = 2048;
/**
 * Normal-offset bias in feet, not the usual fraction: this scene's unit is a foot,
 * so the default 0 leaves shadow acne at 1.4 in per texel. Offsetting by an inch
 * along the normal costs nothing visible at room scale.
 */
const SHADOW_NORMAL_BIAS = 0.08;

/**
 * Altitude the window fill arrives at, degrees.
 *
 * Chosen for the grain, not for the sun: low enough that a normal tilted across a
 * board swings N.L hard (see the header), high enough to still reach the floor
 * through a window whose sill is 2.5 ft and head 9 ft up in a 10.75 ft room.
 */
const WINDOW_ALT_DEG = 18;
const WINDOW_DIST = 400;
/** Window fill when the sun is on that wall, and when only the sky is. */
const WINDOW_SUN = 1.5;
const WINDOW_SKY = 0.45;

/** Civil twilight, and the altitude by which it is fully day. */
const TWILIGHT_DEG = 6;
const FULL_DAY_DEG = 10;

/** How far a sun at the horizon is pulled toward oak, and where that stops. */
const LOW_SUN_WARMTH = 0.45;
const WARM_UNTIL_DEG = 25;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Day of the month of the nth Sunday. Month is 1-based; UTC accessors only. */
function nthSundayOfMonth(year: number, month: number, n: number): number {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((7 - firstWeekday) % 7) + (n - 1) * 7;
}

/**
 * Hours to ADD to a Cambridge wall clock to reach UTC: 5 in winter, 4 on daylight
 * time.
 *
 * Note the sign. This is the addend, not the ISO-8601 offset, which for Cambridge is
 * the negation of it -- "UTC-05:00". Stated because the previous wording here said
 * "offset from UTC", and the first test written against it asserted -5 and failed.
 * The name means "hours west", and cambridgeInstant adds it.
 *
 * US daylight time since 2007: second Sunday in March to first Sunday in November.
 * Resolved at day granularity, so the two ambiguous hours at each changeover are an
 * hour out and every other hour of the year is exact -- which is the right trade for
 * a sun position, where an hour of hour angle is 15 degrees and a changeover
 * happens at 2 a.m. in the dark.
 */
export function easternOffsetHours(year: number, month: number, day: number): number {
  if (month < 3 || month > 11) return 5;
  if (month > 3 && month < 11) return 4;
  if (month === 3) return day >= nthSundayOfMonth(year, 3, 2) ? 4 : 5;
  return day < nthSundayOfMonth(year, 11, 1) ? 4 : 5;
}

/**
 * A Cambridge wall clock as the instant solar.ts wants.
 *
 * solar.ts reads every Date as the instant it is, using UTC accessors only, so a
 * wall clock has to be converted here or every result is off by the machine's own
 * time zone -- which would make the sun's position depend on where the browser is
 * rather than on where Weld is. The module header of solar.ts pins the convention
 * with the two worked examples this reproduces.
 *
 * `hour` is decimal, so 9.25 is 09:15, and 24 is midnight at the end of the day
 * rather than an error.
 */
export function cambridgeInstant(date: string, hour: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  const offset = easternOffsetHours(year!, month!, day!);
  return new Date(Date.UTC(year!, month! - 1, day!) + (hour + offset) * 3_600_000);
}

/**
 * An altitude and azimuth as a unit vector in three.js world space.
 *
 * NORTH IS -Z, per frames.ts toThree, and the same construction orbit.ts uses for
 * its own spherical-to-cartesian step. Getting that sign wrong mirrors the sun
 * about the building's long axis, which puts morning light on the west facade and
 * leaves nothing on screen to say so -- the exact failure frames.ts warns is
 * invisible in this project.
 */
export function skyDirection(alt: SunPosition): THREE.Vector3 {
  const a = alt.altitudeDeg * DEG;
  const z = alt.azimuthDeg * DEG;
  const flat = Math.cos(a);
  return new THREE.Vector3(flat * Math.sin(z), Math.sin(a), -flat * Math.cos(z));
}

/**
 * A one-off scene for PMREMGenerator to bake: a large sphere, vertex-coloured
 * sky-to-ground, seen from inside with BackSide. This is materials.ts:399's
 * cheap next step, finally taken -- what glazing and the hardware pull's
 * metalness had nothing to reflect. No texture file, consistent with this
 * project's rule: the gradient is per-vertex colour, computed once.
 */
function buildEnvScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const radius = 50;
  const geometry = new THREE.SphereGeometry(radius, 24, 16);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const sky = new THREE.Color(DAY.sky);
  const ground = new THREE.Color(DAY.edge);
  for (let i = 0; i < position.count; i++) {
    const t = clamp01((position.getY(i) / radius + 1) / 2);
    const c = ground.clone().lerp(sky, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  scene.add(new THREE.Mesh(geometry, material));
  return scene;
}

/**
 * The environment map, built once per renderer and shared as scene.environment.
 *
 * PMREMGenerator.fromScene() is a real render pass, so this runs once (empty
 * deps beyond `gl`, which does not change) rather than per frame -- the same
 * once-per-mount discipline useSuitePalette() and useFurniturePalette() use
 * for their clones. Disposed on unmount: the prefiltered cube map and the
 * one-off scene's geometry and material all hold GPU memory.
 */
function useEnvironment(): THREE.Texture | null {
  const { gl } = useThree();
  const [envMap] = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = buildEnvScene();
    const rt = pmrem.fromScene(envScene, 0.04);
    const mesh = envScene.children[0] as THREE.Mesh;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    pmrem.dispose();
    return [rt.texture];
  }, [gl]);

  useEffect(() => {
    return () => envMap.dispose();
  }, [envMap]);

  return envMap;
}

export function Lighting() {
  const date = useStore((s) => s.date);
  const hour = useStore((s) => s.hour);
  const params = useStore((s) => s.params);
  const stage = useStore((s) => s.stage);
  const t = useStore((s) => s.t);
  const reduced = useStore((s) => s.reducedMotion);

  const { scene } = useThree();
  const environment = useEnvironment();
  // STAGE 5 ONLY. scene.environment is a scene-WIDE property: an unconditional
  // assignment gives it to every PBR material in the tree, including
  // WeldExterior's brick and slate, which have never had an ambient specular
  // response before and are not supposed to now -- the cyanotype's whole
  // aesthetic is controlled lighting with no bounce and no reflection. Caught
  // by tests/e2e/threshold.spec.ts's "roofOff mid-sweep should light nothing"
  // gate, which the env map broke by giving the dissolving shell something to
  // reflect during the crossing.
  useEffect(() => {
    if (stage !== 5) return;
    scene.environment = environment;
    return () => {
      if (scene.environment === environment) scene.environment = null;
    };
  }, [scene, environment, stage]);

  // Nothing here is per-frame. The store's date and hour move on a HUD event, so
  // this body runs on user input, not on render -- which is why the Colors and
  // Vector3s below are allocated plainly rather than memoised.
  const sun = sunPosition(cambridgeInstant(date, hour));

  // Lambert on a horizontal plane, floored at zero. Below the horizon the sun is
  // off, not negative.
  const overhead = Math.max(0, Math.sin(sun.altitudeDeg * DEG));
  // How much of the day it is: 0 at civil twilight, 1 by 10 degrees up. This is
  // what makes dusk a dimming rather than a switch.
  const day = clamp01((sun.altitudeDeg + TWILIGHT_DEG) / (TWILIGHT_DEG + FULL_DAY_DEG));

  const sunPos = skyDirection(sun).multiplyScalar(SUN_DIST);

  // A low sun is warm. One documented operation on two tokens, the pattern
  // materials.ts uses for brick and slate, rather than a fifth invented hex:
  // plaster pulled toward oak, by less the higher the sun gets.
  const sunColour = new THREE.Color(DAY.plaster).lerp(
    new THREE.Color(DAY.oak),
    LOW_SUN_WARMTH * (1 - clamp01(sun.altitudeDeg / WARM_UNTIL_DEG)),
  );

  // The two walls the suite is glazed in. Both come from place.ts, so they follow
  // params.facade and weld.json's 13.2 degree axis instead of restating either.
  const walls = [facadeAzimuth(params), gableAzimuth()];

  /**
   * The view beyond the glass.
   *
   * Every window was reading as a dark blue panel from inside, because the pane is
   * 28% opaque over whatever is behind it and behind it was the SCAN palette's
   * Prussian void -- WeldExterior is unmounted by stage 5, so there is literally
   * nothing else out there. MASTER.md already assigns a token to this exact job:
   * `--sky`, "ambient / window beyond". So the background crosses from void to sky
   * on the threshold's own interior ramp, which costs one Color lerp per HUD event
   * and no draw calls at all.
   *
   * Not transmission, and not this component's OWN environment map -- two
   * different jobs. materials.ts records transmission was removed because it
   * forces a second full scene render; `scene.environment` below (P10) is a
   * reflection source for specular response, not a backdrop, and painting it
   * through the glass would show the render's own gradient sphere rather
   * than sky. A background colour is still the cheap, correct answer here.
   */
  const { interior } = thresholdOpacity(stage, t, reduced);
  const background = new THREE.Color(SCAN.void).lerp(new THREE.Color(DAY.sky), interior);

  return (
    <>
      <color attach="background" args={[background]} />

      {/* Fill. Sky above, ground bounce below -- and it is the below half that had
          to change: it lights every downward-facing surface in the suite. */}
      <hemisphereLight
        color={DAY.sky}
        groundColor={GROUND}
        intensity={HEMI_NIGHT + (HEMI_DAY - HEMI_NIGHT) * day}
      />

      {/* The sun. Position is a direction: a directional light's target defaults to
          the origin, which is Weld's centroid. */}
      <directionalLight
        position={[sunPos.x, sunPos.y, sunPos.z]}
        intensity={SUN_PEAK * overhead}
        color={sunColour}
        castShadow
        shadow-mapSize={[SHADOW_PX, SHADOW_PX]}
        shadow-camera-left={-SHADOW_HALF}
        shadow-camera-right={SHADOW_HALF}
        shadow-camera-top={SHADOW_HALF}
        shadow-camera-bottom={-SHADOW_HALF}
        shadow-camera-near={1}
        shadow-camera-far={SUN_DIST * 2}
        shadow-normalBias={SHADOW_NORMAL_BIAS}
      />

      {walls.map((azimuthDeg) => {
        const p = skyDirection({ altitudeDeg: WINDOW_ALT_DEG, azimuthDeg }).multiplyScalar(
          WINDOW_DIST,
        );
        // Lit by the sun, or only by the sky. isFacadeLit answers with the real
        // self-shading test on the wall's outward normal, so this is the one place
        // the seasonal finding reaches the render.
        const intensity = isFacadeLit(azimuthDeg, sun)
          ? WINDOW_SUN * overhead
          : WINDOW_SKY * day;
        return (
          <directionalLight
            key={azimuthDeg}
            position={[p.x, p.y, p.z]}
            intensity={intensity}
            color={DAY.sky}
          />
        );
      })}
    </>
  );
}
