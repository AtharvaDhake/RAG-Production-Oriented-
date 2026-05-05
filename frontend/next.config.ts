import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the minimal standalone Docker image
  output: "standalone",
};

export default nextConfig;
