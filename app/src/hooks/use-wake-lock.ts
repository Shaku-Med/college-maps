"use client";

import { useEffect } from "react";

export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
        if (released) await sentinel.release();
      } catch {
        // Browsers refuse wake locks on low battery or background tabs; navigation still works.
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !released) request();
    };

    request();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      sentinel?.release().catch(() => undefined);
    };
  }, [enabled]);
}
