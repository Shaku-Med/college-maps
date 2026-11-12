// Cloudflare Turnstile: proof that a person, not a script, asked for a sign in code.
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const SIGN_IN_ACTION = "signin";

type RenderOptions = {
  sitekey: string;
  action: string;
  theme: "light" | "dark" | "auto";
  appearance: "always" | "execute" | "interaction-only";
  size: "normal" | "flexible" | "compact";
  "response-field": boolean;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => boolean | void;
  "timeout-callback": () => void;
  "before-interactive-callback": () => void;
  "after-interactive-callback": () => void;
};

export type TurnstileApi = {
  render: (element: HTMLElement, options: RenderOptions) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once. Our own script adds it, which the page's strict-dynamic policy allows. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    script.onerror = () => reject(new Error("turnstile failed to load"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** The site follows the system theme unless a class on the page says otherwise; the check does the same. */
export function turnstileTheme(): "light" | "dark" | "auto" {
  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light") || root.dataset.theme === "light") return "light";
  return "auto";
}
