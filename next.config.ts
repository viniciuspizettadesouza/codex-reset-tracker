import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Metadata is static in this project. Keeping it in the initial document
  // avoids a server/client boundary mismatch seen with streamed metadata.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
