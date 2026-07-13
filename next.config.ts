import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: { "/api/mcp": ["./public/fonts/NotoSansSC-CN.ttf"] },
};

export default nextConfig;
