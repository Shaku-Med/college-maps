"use client";

import { useSyncExternalStore } from "react";

import { getCarSpot, subscribeCarSpot } from "@/lib/car-spot";

/** Where this browser remembers the car is parked, or null. */
export function useCarSpot() {
  return useSyncExternalStore(subscribeCarSpot, getCarSpot, () => null);
}
