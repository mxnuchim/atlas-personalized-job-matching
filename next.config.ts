import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / Node-only libraries that must stay external to the server bundle.
  serverExternalPackages: ["@node-rs/argon2", "pino", "pino-pretty", "postgres"],
};

export default nextConfig;
