import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev indicator badge renders bottom-left, on top of the HUD, and its
  // portal swallows pointer events aimed at the stage buttons. It cost a
  // debugging round before the overlap was spotted.
  devIndicators: false,
  // The 3D scene is client-only; nothing here is server rendered beyond the shell.
  // three ships modern ESM and needs no transpilation under Next 16.
};

export default nextConfig;
