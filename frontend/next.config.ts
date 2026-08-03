import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin workspace root to frontend/ — avoids wrong root from ~/package-lock.json
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=5, stale-while-revalidate=30" },
        ],
      },
    ];
  },
};

export default nextConfig;
