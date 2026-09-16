"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Coordinate } from "@/data/campus";

export type GeoStatus = "idle" | "locating" | "active" | "denied" | "unavailable" | "error";

export type GeoFix = { position: Coordinate; accuracy: number };

type GeoOptions = {
  onPosition?: (fix: GeoFix) => void;
  onError?: (status: "denied" | "unavailable" | "error") => void;
};

export function useGeolocation({ onPosition, onError }: GeoOptions = {}) {
  const watchIdRef = useRef<number | null>(null);
  const callbacksRef = useRef({ onPosition, onError });
  const [status, setStatus] = useState<GeoStatus>("idle");
  const [fix, setFix] = useState<GeoFix>();

  useEffect(() => {
    callbacksRef.current = { onPosition, onError };
  }, [onPosition, onError]);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (watchIdRef.current !== null) return;
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      callbacksRef.current.onError?.("unavailable");
      return;
    }

    setStatus((prev) => (prev === "active" ? prev : "locating"));
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return;
        const next = {
          position: { latitude: coords.latitude, longitude: coords.longitude },
          accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : 0,
        };
        setFix(next);
        setStatus("active");
        callbacksRef.current.onPosition?.(next);
      },
      (error) => {
        stop();
        const next = error.code === error.PERMISSION_DENIED ? "denied" : "error";
        setStatus(next);
        callbacksRef.current.onError?.(next);
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { status, position: fix?.position, accuracy: fix?.accuracy, start, stop };
}
