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

function originOf(name: string, raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username) {
    throw new Error(`${name} must be an https origin like https://api.example.com`);
  }
  return url.origin;
}

function siteOrigins() {
  return [
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].map(httpsOrigin);
}

function isThisSite(origin: string) {
  return siteOrigins().includes(origin);
}

// Where the site forwards /v1, so the browser calls its own origin and the session cookie stays first-party.
// API_UPSTREAM is the Go API. NEXT_PUBLIC_API_URL is only a fallback when it is not this website.
export function apiUpstream(): string | null {
  if (process.env.API_UPSTREAM) {
    const upstream = originOf("API_UPSTREAM", process.env.API_UPSTREAM);
    if (isThisSite(upstream)) {
      throw new Error("API_UPSTREAM points at this site, which would forward /v1 to itself forever");
    }
    return upstream;
  }

  // Vercel does not have netlify.toml. Without an explicit upstream, a website-valued
  // NEXT_PUBLIC_API_URL rewrites /v1 back onto this deployment (508 INFINITE_LOOP_DETECTED).
  if (process.env.VERCEL) {
    throw new Error("Set API_UPSTREAM to the Go API origin, like https://college-maps.vercel.app or https://api.example.com");
  }

  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw || !raw.startsWith("https:")) return null;
  const origin = originOf("NEXT_PUBLIC_API_URL", raw);
  if (!isThisSite(origin)) return origin;
  if (process.env.NETLIFY === "true") return null;
  throw new Error("NEXT_PUBLIC_API_URL is this site, so set API_UPSTREAM to the Go API");
}
