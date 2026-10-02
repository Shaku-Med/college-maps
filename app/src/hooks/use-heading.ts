"use client";

import { useCallback, useEffect, useRef } from "react";

type OrientationWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number };
type OrientationPermission = { requestPermission?: () => Promise<"granted" | "denied"> };

// Sensor events pass straight through; the map animates between them every frame, so there is no smoothing delay here.
const MIN_CHANGE_DEGREES = 0.5;
const COMPASS_FRESH_MS = 3000;

function normalize(degrees: number) {
  return ((degrees % 360) + 360) % 360;
}

function screenAngle() {
  return typeof screen !== "undefined" && screen.orientation ? screen.orientation.angle : 0;
}

/** Compass heading in degrees clockwise from north. */
export function useHeading(onHeading: (heading: number) => void) {
  const headingRef = useRef<number | undefined>(undefined);
  const emittedRef = useRef<number | undefined>(undefined);
  const listeningRef = useRef(false);
  const compassSeenAtRef = useRef(0);
  const compassRef = useRef<number | undefined>(undefined);
  // Moving fast, the direction of travel wins over a compass pointing anywhere from a pocket or seat.
  const courseWinsUntilRef = useRef(0);
  const callbackRef = useRef(onHeading);

  useEffect(() => {
    callbackRef.current = onHeading;
  }, [onHeading]);

  const handleOrientation = useCallback((event: Event) => {
    const e = event as OrientationWithCompass;
    let raw: number | undefined;
    if (typeof e.webkitCompassHeading === "number" && Number.isFinite(e.webkitCompassHeading)) {
      raw = e.webkitCompassHeading;
    } else if (e.absolute && typeof e.alpha === "number" && Number.isFinite(e.alpha)) {
      raw = 360 - e.alpha;
    }
    if (raw === undefined) return;
    compassSeenAtRef.current = Date.now();

    const heading = normalize(raw + screenAngle());
    compassRef.current = heading;
    if (Date.now() < courseWinsUntilRef.current) return;
    headingRef.current = heading;

    const last = emittedRef.current;
    const change = last === undefined ? 360 : Math.abs(((heading - last + 540) % 360) - 180);
    if (change >= MIN_CHANGE_DEGREES) {
      emittedRef.current = heading;
      callbackRef.current(heading);
    }
  }, []);

  const request = useCallback(async () => {
    if (listeningRef.current || typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return;
    listeningRef.current = true;
    // Attach first: where sensors are blocked no events arrive, and a denied prompt should not stop other browsers.
    const eventName = "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(eventName, handleOrientation);

    const permission = (DeviceOrientationEvent as unknown as OrientationPermission).requestPermission;
    await permission?.().catch(() => undefined);
  }, [handleOrientation]);

  // GPS course is a fallback for devices without a compass, and the only thing to trust when moving fast.
  const setCourse = useCallback((course: number, preferCourse = false) => {
    if (preferCourse) courseWinsUntilRef.current = Date.now() + COMPASS_FRESH_MS;
    else if (Date.now() - compassSeenAtRef.current < COMPASS_FRESH_MS) return;
    headingRef.current = normalize(course);
    emittedRef.current = headingRef.current;
    callbackRef.current(headingRef.current);
  }, []);

  useEffect(
    () => () => {
      window.removeEventListener("deviceorientationabsolute", handleOrientation);
      window.removeEventListener("deviceorientation", handleOrientation);
    },
    [handleOrientation],
  );

  // Where the phone points right now, if the compass has spoken recently.
  const compass = useCallback(
    () => (Date.now() - compassSeenAtRef.current < COMPASS_FRESH_MS ? compassRef.current : undefined),
    [],
  );

  return { headingRef, request, setCourse, compass };
}
