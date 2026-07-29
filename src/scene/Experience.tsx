"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

/**
 * P0 placeholder. One cube in the scan palette, orbitable, to prove the
 * renderer, the client boundary, the fonts and the tokens are all wired.
 * Replaced in P2 by the stage machine.
 */
export default function Experience() {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas
        camera={{ position: [6, 4.5, 8], fov: 45 }}
        dpr={[1, 2]}
        gl={{
          antialias: true,
          // Lets Playwright read the drawing buffer, so tests can assert that
          // something was actually rendered rather than only that a WebGL
          // context exists. Costs a little memory bandwidth; worth it as a
          // permanent visual-regression gate. Revisit in P8 if perf demands.
          preserveDrawingBuffer: true,
        }}
        // R3F does NOT orient the default camera toward the origin, and drei's
        // OrbitControls only reorients on first interaction. Without this the
        // scene renders correctly but points at empty space, which looks
        // exactly like a broken renderer.
        onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
        aria-label="Placeholder 3D scene: a single cube in the cyanotype palette"
      >
        <color attach="background" args={["#06203f"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 4]} intensity={1.1} />

        <mesh>
          <boxGeometry args={[2, 2, 2]} />
          <meshStandardMaterial color="#8fc4f2" roughness={0.55} metalness={0} />
        </mesh>

        <gridHelper args={[40, 40, "#0c3260", "#0c3260"]} position={[0, -1.001, 0]} />
        <OrbitControls enableDamping dampingFactor={0.08} target={[0, 0, 0]} />
      </Canvas>
    </div>
  );
}
