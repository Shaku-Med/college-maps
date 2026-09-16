import type { NextConfig } from "next";

import campus from "./campus/campus.json";
import { PUSH_CONNECT_ORIGINS } from "./src/lib/push-origins";

// The app validates campus.json fully; here we only need the tile server origins for the worker's CSP.
const mapOrigins = [
  campus.map.styles.light,
  campus.map.styles.dark,
  ...((campus.map as { extraOrigins?: string[] }).extraOrigins ?? []),
]
  .map((url) => new URL(url))
  .filter((url) => url.protocol === "https:")
  .map((url) => url.origin);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), notifications=(self), camera=(), microphone=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

function httpsOrigin(raw: string | undefined) {
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function apiUpstream(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username) return null;
  // Netlify/Vercel set these to the site itself. Rewriting /v1 back there loops until timeout.
  const siteOrigins = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL, process.env.VERCEL_URL].map(httpsOrigin);
  if (siteOrigins.includes(url.origin)) return null;
  return url.origin;
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Lets a phone on the same Wi-Fi load the dev server by this computer's local address.
  allowedDevOrigins: ["10.*.*.*", "192.168.*.*", ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`)],
  async rewrites() {
    const upstream = apiUpstream();
    if (!upstream) return [];
    return [{ source: "/v1/:path*", destination: `${upstream}/v1/:path*` }];
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          {
            key: "Content-Security-Policy",
            value: `default-src 'self'; connect-src 'self' ${[...new Set([...mapOrigins, ...PUSH_CONNECT_ORIGINS])].join(" ")}`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
