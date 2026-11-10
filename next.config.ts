import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only packages used by route handlers and the worker; keep them out of the server bundle.
  serverExternalPackages: ["pg", "pg-boss", "pg-query-stream", "nodemailer", "yauzl"],
  experimental: {
    // Enables forbidden() / unauthorized() and app/forbidden.tsx (403 pages for role checks).
    authInterrupts: true,
    serverActions: {
      // Category icons (≤ 512 KB) are uploaded through a Server Action.
      bodySizeLimit: "2mb",
    },
  },
  // The map page runs imperative CesiumJS code that mounts once; avoid double-mounting in dev.
  reactStrictMode: false,
};

export default nextConfig;
