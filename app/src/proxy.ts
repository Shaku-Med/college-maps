import { NextResponse, type NextRequest } from "next/server";

import { MAP_ORIGINS } from "@/data/campus";
import { API_ORIGIN, REALTIME_ORIGIN, apiOriginFor } from "@/lib/api";
import { PUSH_CONNECT_ORIGINS } from "@/lib/push-origins";

// The Host header is only used to pick a private network API address in development; apiOriginFor ignores anything else.
function requestHostname(request: NextRequest) {
  try {
    return new URL(`http://${request.headers.get("host") ?? ""}`).hostname;
  } catch {
    return "";
  }
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${[...MAP_ORIGINS, ...PUSH_CONNECT_ORIGINS, ...new Set([API_ORIGIN, apiOriginFor(requestHostname(request)), REALTIME_ORIGIN, apiOriginFor(requestHostname(request), REALTIME_ORIGIN)])].filter(Boolean).join(" ")}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|maplibre|favicon.ico|manifest.webmanifest|icons|opengraph-image|twitter-image|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
