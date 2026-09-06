import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Five 2 MiB emergency photos plus multipart overhead exceed the 10 MiB default.
  // The incident handler independently bounds the full body to 10 MiB + 128 KiB.
  experimental: { proxyClientMaxBodySize: "11mb" },
};

export default nextConfig;
