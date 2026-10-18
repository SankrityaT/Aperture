//created by kinjal
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // An agent that asks for markdown gets the markdown version of the page at the same URL.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", has: [{ type: "header", key: "accept", value: "(?:.*)text/markdown(?:.*)" }], destination: "/index.md" },
        { source: "/docs", has: [{ type: "header", key: "accept", value: "(?:.*)text/markdown(?:.*)" }], destination: "/docs.md" },
        { source: "/.well-known/mcp.json", destination: "/api/mcp-card" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Link", value: '</llms.txt>; rel="describedby"; type="text/plain", </index.md>; rel="alternate"; type="text/markdown"' },
          { key: "Vary", value: "Accept" },
        ],
      },
      {
        source: "/docs",
        headers: [
          { key: "Link", value: '</docs.md>; rel="alternate"; type="text/markdown"' },
          { key: "Vary", value: "Accept" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
