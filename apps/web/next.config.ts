import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  distDir: process.env.NEXT_E2E === "1" ? ".next-e2e" : ".next",
};

export default nextConfig;
