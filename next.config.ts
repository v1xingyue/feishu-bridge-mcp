import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: { DEPLOYED_AT: process.env.DEPLOYED_AT || new Date().toISOString() },
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: { "/api/mcp": ["./public/fonts/NotoSansSC-CN.ttf"] },
};

export default nextConfig;
