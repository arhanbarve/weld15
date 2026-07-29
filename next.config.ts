import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The 3D scene is client-only; nothing here is server rendered beyond the shell.
  // three ships modern ESM and needs no transpilation under Next 16.
};

export default nextConfig;
