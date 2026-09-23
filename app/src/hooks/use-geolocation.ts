"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Coordinate } from "@/data/campus";

export type GeoStatus = "idle" | "locating" | "active" | "denied" | "unavailable" | "error";

export type GeoFix = {
  position: Coordinate;
  accuracy: number;
  /** Direction of travel from the device itself, when it knows one. */
  heading?: number;
  /** Metres per second, used to tell walking from standing still. */
  speed?: number;
};

type GeoOptions = {
  onPosition?: (fix: GeoFix) => void;
  onError?: (status: "denied" | "unavailable" | "error") => void;
};

// A first precise fix can take a while indoors, so a rough one is asked for at the same time to get moving.
const QUICK_FIX = { enableHighAccuracy: false, maximumAge: 120_000, timeout: 10_000 };
const WATCH = { enableHighAccuracy: true, maximumAge: 2_000, timeout: 30_000 };
const RETRY_MS = 5_000;

export function useGeolocation({ onPosition, onError }: GeoOptions = {}) {
  const watchIdRef = useRef<number | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hasFixRef = useRef(false);
  const callbacksRef = useRef({ onPosition, onError });
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [fix, setFix] = useState<GeoFix>();

  useEffect(() => {
    callbacksRef.current = { onPosition, onError };
  }, [onPosition, onError]);

  const stop = useCallback(() => {
    clearTimeout(retryRef.current);
    retryRef.current = undefined;
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
  }, []);

  const handleFix = useCallback(({ coords }: GeolocationPosition) => {
    if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return;
    const next: GeoFix = {
      position: { latitude: coords.latitude, longitude: coords.longitude },
      accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : 0,
      heading: typeof coords.heading === "number" && Number.isFinite(coords.heading) ? coords.heading : undefined,
      speed: typeof coords.speed === "number" && Number.isFinite(coords.speed) ? coords.speed : undefined,
    };
    hasFixRef.current = true;
    setFix(next);
    setStatus("active");
    callbacksRef.current.onPosition?.(next);
  }, []);

  const start = useCallback(() => {
    if (watchIdRef.current !== null) return;
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      callbacksRef.current.onError?.("unavailable");
      return;
    }

    setStatus((prev) => (prev === "active" ? prev : "locating"));
    // A rough position now beats a precise one later: it puts the dot on the map and lets navigation start.
    if (!hasFixRef.current) navigator.geolocation.getCurrentPosition(handleFix, () => undefined, QUICK_FIX);

    const watch = () => {
      watchIdRef.current = navigator.geolocation.watchPosition(
        handleFix,
        (error) => {
          // Only a refusal is final. A timeout or a lost signal is normal indoors, so the watch is rebuilt
          // instead of giving up, which used to leave the app unable to navigate until it was reopened.
          if (error.code === error.PERMISSION_DENIED) {
            stop();
            setStatus("denied");
            callbacksRef.current.onError?.("denied");
            return;
          }
          if (!hasFixRef.current) callbacksRef.current.onError?.("error");
          stop();
          retryRef.current = setTimeout(watch, RETRY_MS);
        },
        WATCH,
      );
    };
    watch();
  }, [handleFix, stop]);

  useEffect(() => stop, [stop]);

  return {
    status,
    position: fix?.position,
    accuracy: fix?.accuracy,
    /** True once any fix has arrived, even if the signal was lost afterwards. */
    located: fix !== undefined,
    start,
    stop,
  };
}
