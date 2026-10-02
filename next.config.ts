import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / Node-only libraries that must stay external to the server bundle.
  // `@react-pdf/renderer` brings its own React reconciler, which needs the full React —
  // bundled under the `react-server` condition it gets the server build instead and breaks.
  serverExternalPackages: ["@node-rs/argon2", "pino", "pino-pretty", "postgres", "@react-pdf/renderer"],
  experimental: {
    serverActions: {
      // Resume uploads (≤ 4 MB, validated) travel in a Server Action. The default 1 MB
      // would reject most PDFs; 4.5 MB is Vercel's own request ceiling, plus multipart overhead.
      bodySizeLimit: "4.5mb",
    },
  },
};

export default nextConfig;
