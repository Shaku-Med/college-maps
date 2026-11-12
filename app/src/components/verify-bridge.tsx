"use client";

import { useEffect, useSyncExternalStore } from "react";

import { HumanCheck } from "@/components/human-check";

type Theme = "light" | "dark" | "auto";

const send = (message: object) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));
const noSubscribe = () => () => {};

function readTheme(): Theme {
  const wanted = new URLSearchParams(window.location.search).get("theme");
  return wanted === "light" || wanted === "dark" ? wanted : "auto";
}

/** The phone app shows this page in a small web view and takes the Turnstile token it posts back. */
export function VerifyBridge() {
  // Null on the server, so the check only starts once the app's theme is known.
  const theme = useSyncExternalStore<Theme | null>(noSubscribe, readTheme, () => null);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  if (!theme) return null;
  return (
    <main className="p-1">
      <HumanCheck
        round={0}
        theme={theme === "auto" ? undefined : theme}
        onToken={(token) => send(token ? { type: "token", token } : { type: "cleared" })}
        onState={(state) => state === "failed" && send({ type: "failed" })}
        onInteractive={(shown) => send({ type: "interactive", shown })}
      />
    </main>
  );
}
