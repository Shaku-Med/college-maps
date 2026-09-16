"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

import { MAP_ORIGINS } from "@/data/campus";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

let registered = false;

function registerServiceWorker() {
  if (registered || !("serviceWorker" in navigator)) return;
  registered = true;
  navigator.serviceWorker
    .register(`/sw.js?origins=${encodeURIComponent(MAP_ORIGINS.join(","))}`, { scope: "/", updateViaCache: "none" })
    .then((registration) => registration.update())
    .catch(() => {
      registered = false;
    });
}

export function OfflineSupport() {
  const isOnline = useSyncExternalStore(
    (callback) => {
      registerServiceWorker();
      return subscribe(callback);
    },
    () => navigator.onLine,
    () => true,
  );

  if (isOnline) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(6.5rem+var(--map-safe-bottom))] z-50 flex justify-center px-[var(--map-safe-left)] pr-[var(--map-safe-right)]">
      <p
        role="status"
        className="animate-fade-in flex items-center gap-2 rounded-full bg-overlay px-3.5 py-2 text-xs font-medium text-overlay-foreground shadow-lg">
        <WifiOff className="size-3.5 text-muted" aria-hidden />
        Offline. Showing the parts of campus you have already viewed.
      </p>
    </div>
  );
}
