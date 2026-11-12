"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { SIGN_IN_ACTION, TURNSTILE_SITE_KEY, loadTurnstile, turnstileTheme } from "@/lib/turnstile";

export type HumanCheckState = "checking" | "ready" | "failed";

/**
 * Cloudflare's check runs out of sight and only shows a box when it is unsure. Each token works once, so a new
 * `round` asks for a fresh one after every code request.
 */
export function HumanCheck({
  round,
  onToken,
  onState,
  onInteractive,
  theme,
}: {
  round: number;
  onToken: (token: string | null) => void;
  onState?: (state: HumanCheckState) => void;
  onInteractive?: (shown: boolean) => void;
  theme?: "light" | "dark";
}) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const handlers = useRef({ onToken, onState, onInteractive });
  useLayoutEffect(() => {
    handlers.current = { onToken, onState, onInteractive };
  });

  useEffect(() => {
    const element = box.current;
    if (!element || !TURNSTILE_SITE_KEY) return;
    let widgetId: string | undefined;
    let gone = false;
    const report = (token: string | null, state: HumanCheckState) => {
      if (gone) return;
      setFailed(state === "failed");
      handlers.current.onToken(token);
      handlers.current.onState?.(state);
    };
    report(null, "checking");

    loadTurnstile()
      .then((turnstile) => {
        if (gone) return;
        widgetId = turnstile.render(element, {
          sitekey: TURNSTILE_SITE_KEY,
          action: SIGN_IN_ACTION,
          theme: theme ?? turnstileTheme(),
          appearance: "interaction-only",
          size: "flexible",
          "response-field": false,
          callback: (token) => report(token, "ready"),
          "expired-callback": () => report(null, "checking"),
          "timeout-callback": () => report(null, "checking"),
          "before-interactive-callback": () => handlers.current.onInteractive?.(true),
          "after-interactive-callback": () => handlers.current.onInteractive?.(false),
          // Returning true tells Cloudflare we handled it, so it retries quietly instead of throwing.
          "error-callback": () => {
            report(null, "failed");
            return true;
          },
        });
      })
      .catch(() => report(null, "failed"));

    return () => {
      gone = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [round, theme]);

  if (!TURNSTILE_SITE_KEY) return null;
  return (
    <div>
      <div ref={box} className="empty:hidden" />
      {failed ? (
        <p role="alert" className="text-sm text-danger">
          We couldn&apos;t check that you&apos;re a person. Check your connection or turn off blockers for this site,
          then reload.
        </p>
      ) : null}
    </div>
  );
}
