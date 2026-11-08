"use client";

import { createContext, useContext } from "react";

import type { Coordinate } from "@/data/campus";

/** Hides the sheet, lets the person move the map under a fixed pin, and gives back where it landed, or null. */
export type DropPin = (start?: Coordinate) => Promise<Coordinate | null>;

export const PinDropContext = createContext<DropPin | null>(null);

export const usePinDrop = () => useContext(PinDropContext);
