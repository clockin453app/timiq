import type { NextConfig } from "next";

/** Server-only: where Next proxies /api and /health (Render web service). Not exposed to the browser. */
function apiProxyOrigin(): string {
  const raw =
    process.env.API_PROXY_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "";
  if (raw) {
    return raw.replace(/\/$/, "");
  }
  return "http://127.0.0.1:8000";
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/invite/accept",
        destination: "/accept-invite",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Content-Type", value: "application/manifest+json" }],
      },
    ];
  },
  async rewrites() {
    const base = apiProxyOrigin();
    return [
      {
        source: "/api/:path*",
        destination: `${base}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${base}/health`,
      },
    ];
  },
};

export default nextConfig;
