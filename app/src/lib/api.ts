import { CAMPUS } from "@/data/campus";

export const MAX_EMAIL_LENGTH = 254;
export const MAX_NAME_LENGTH = 40;
export const CODE_LENGTH = 8;
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 20;

const isDevelopment = process.env.NODE_ENV !== "production";

// Addresses on a home or campus network (10.x, 172.16-31.x, 192.168.x), used to open the dev server on a phone.
export function isPrivateNetworkHost(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^[0-9]{1,3}$/.test(part) && Number(part) <= 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || (isDevelopment && isPrivateNetworkHost(hostname));
}

// Accounts are optional: a college can run the map without the Go backend by leaving this unset.
// When it is set, a malformed value stops the build instead of silently disabling sign in.
function readOrigin(name: string, raw: string | undefined) {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL: ${raw}`);
  }
  const allowedScheme = url.protocol === "https:" || (url.protocol === "http:" && isLocalHostname(url.hostname));
  if (!allowedScheme || url.pathname !== "/" || url.search || url.hash || url.username) {
    throw new Error(`${name} must be an origin like https://api.example.com (http only for local development)`);
  }
  return url.origin;
}

export const API_ORIGIN = readOrigin("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL);
// The realtime server (backend/rtapp) that streams friends' positions during a meetup.
export const REALTIME_ORIGIN = readOrigin("NEXT_PUBLIC_REALTIME_URL", process.env.NEXT_PUBLIC_REALTIME_URL);

// A phone on the same Wi-Fi opens the dev server by the computer's address, where "localhost" would
// mean the phone itself, so in development the API follows the page's hostname.
export function apiOriginFor(pageHostname: string, origin: string | null = API_ORIGIN) {
  if (!origin || !isDevelopment || !isPrivateNetworkHost(pageHostname)) return origin;
  const url = new URL(origin);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return origin;
  url.hostname = pageHostname;
  return url.origin;
}

// email is private to the signed in user. Anything shown to friends uses username and displayName.
export type AccountUser = { email: string; username: string; displayName: string; needsProfile: boolean };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string; retryAfter?: number };

const OFFLINE_MESSAGE = "You're offline or the server is unreachable. Try again in a moment.";

export async function apiCall<T>(path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown): Promise<ApiResult<T>> {
  if (!API_ORIGIN) return { ok: false, status: 0, message: "Accounts are not set up for this map." };

  let response: Response;
  try {
    response = await fetch(`${apiOriginFor(window.location.hostname)}${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: OFFLINE_MESSAGE };
  }

  if (response.status === 204) return { ok: true, data: undefined as T };

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: payload as T };

  const message =
    payload && typeof payload === "object" && typeof (payload as { error?: unknown }).error === "string"
      ? (payload as { error: string }).error.slice(0, 200)
      : "Something went wrong. Try again.";
  const retry = Number(response.headers.get("Retry-After"));
  return {
    ok: false,
    status: response.status,
    message,
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
  };
}

function readUser(value: unknown): AccountUser | null {
  const user = (value as { user?: unknown } | null)?.user as Record<string, unknown> | undefined;
  if (!user || typeof user.email !== "string" || typeof user.displayName !== "string" || typeof user.username !== "string") {
    return null;
  }
  return {
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    needsProfile: user.needsProfile === true,
  };
}

async function withUser(result: Promise<ApiResult<unknown>>): Promise<ApiResult<AccountUser>> {
  const res = await result;
  if (!res.ok) return res;
  const user = readUser(res.data);
  return user ? { ok: true, data: user } : { ok: false, status: 0, message: "Unexpected response from the server." };
}

export function normalizeUsername(raw: string) {
  return raw
    .trim()
    .replace(/^@/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, MAX_USERNAME_LENGTH);
}

export function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);
}

export function schoolEmailProblem(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1 || email.includes(" ")) return "Enter a valid email address.";
  const domain = email.slice(at + 1);
  if (!CAMPUS.college.emailDomains.includes(domain)) {
    return `Use your school email ending in @${CAMPUS.college.emailDomains.join(" or @")}.`;
  }
  return null;
}

export const accountApi = {
  me: () => withUser(apiCall("/v1/me", "GET")),
  requestCode: (email: string) => apiCall<{ sent: boolean }>("/v1/auth/code", "POST", { email }),
  verifyCode: (email: string, code: string) => withUser(apiCall("/v1/auth/verify", "POST", { email, code })),
  updateProfile: (profile: { displayName?: string; username?: string }) => withUser(apiCall("/v1/me", "PATCH", profile)),
  signOut: () => apiCall<void>("/v1/auth/signout", "POST"),
  signOutEverywhere: () => apiCall<void>("/v1/auth/signout-all", "POST"),
  deleteAccount: () => apiCall<void>("/v1/me", "DELETE"),
  exportData: () => apiCall<Record<string, unknown>>("/v1/me/export", "GET"),
};

export const pushApi = {
  config: () => apiCall<{ available: boolean; publicKey?: string }>("/v1/push/config", "GET"),
  save: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    apiCall<void>("/v1/push/subscriptions", "POST", subscription),
  remove: (body: { endpoint?: string; all?: boolean }) => apiCall<void>("/v1/push/subscriptions", "DELETE", body),
};
