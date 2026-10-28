"use client";

import { Bus, DoorOpen } from "lucide-react";
import type { PointerEvent } from "react";

import type { Place } from "@/data/campus";
import { CATEGORY_ICONS } from "@/lib/categories";
import { cn } from "@/lib/cn";
import { lotNumber, markerKind, markerLabel } from "@/lib/place-marker";

export type ChipState = "selected" | "origin" | "stop" | "idle";

type PlaceChipProps = {
  place: Place;
  state: ChipState;
  /** Its number when it is a stop on the way. */
  stop?: number;
  /** Public events here; a soft accent glow grows with it. */
  activity: number;
  /** The pin sits on an exit, shown while the building's safety points are. */
  exit?: boolean;
  onPress: (place: Place) => void;
  onHover: (id: string | null) => void;
};

// Sizes follow the map's zoom through data-zoom on the map container (the group/map below).
const SHELL =
  "group/chip relative flex h-7 cursor-pointer items-center border text-xs font-semibold tracking-tight shadow-sm outline-none transition-[translate,scale,background-color,border-color,box-shadow] duration-200 ease-out hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none group-data-[zoom=far]/map:h-6 group-data-[zoom=far]/map:text-[11px]";

const SHAPE = {
  building: "rounded-full px-2.5 group-data-[zoom=far]/map:px-2",
  lot: "rounded-lg py-0.5 pl-0.5 pr-2 group-data-[zoom=far]/map:p-0.5",
  stop: "rounded-full py-0.5 pl-0.5 pr-2.5 group-data-[zoom=far]/map:p-0.5",
} as const;

const COLORS: Record<ChipState, string> = {
  idle: "border-border bg-overlay text-overlay-foreground",
  selected: "scale-105 border-accent bg-accent text-accent-foreground shadow-md animate-marker-ring motion-reduce:animate-none",
  origin: "scale-105 border-foreground bg-foreground text-background",
  stop: "scale-105 border-accent bg-accent-soft text-accent-soft-foreground",
};

// The little square or circle that says what a lot or a bus stop is, before its number.
const TILE: Record<ChipState, string> = {
  idle: "bg-default text-default-foreground",
  selected: "bg-accent-foreground/20 text-accent-foreground",
  origin: "bg-background/20 text-background",
  stop: "bg-accent/15 text-accent-soft-foreground",
};

/** A place on the map: a building's code, a parking lot's P, or a bus stop, and its name when picked or pointed at. */
export function PlaceChip({ place, state, stop, activity, exit = false, onPress, onHover }: PlaceChipProps) {
  const kind = markerKind(place);
  const picked = state === "selected";
  const Glyph = CATEGORY_ICONS[place.category];
  // Campus events here: the heat on the map shows where, the badge says how many.
  const busy = activity > 0 && state === "idle";
  const hover = (id: string | null) => (event: PointerEvent) => {
    if (event.pointerType === "mouse") onHover(id);
  };
  const label =
    (stop !== undefined
      ? `Stop ${stop}, ${place.name}`
      : busy
        ? `${place.name}, ${activity} campus ${activity === 1 ? "event" : "events"}`
        : place.name) + (exit ? ", main entrance exit" : "");

  return (
    <div className="relative flex items-center justify-center">
      <button
        type="button"
        data-place-marker={place.id}
        aria-label={label}
        aria-pressed={picked}
        onClick={(event) => {
          event.stopPropagation();
          onPress(place);
        }}
        onPointerEnter={hover(place.id)}
        onPointerLeave={hover(null)}
        className={cn(SHELL, SHAPE[kind], COLORS[state], busy && "border-accent animate-marker-live motion-reduce:animate-none")}>
        {kind === "lot" ? (
          <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold", TILE[state])}>P</span>
        ) : kind === "stop" ? (
          <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", TILE[state])}>
            <Bus className="size-3" strokeWidth={2.5} aria-hidden />
          </span>
        ) : (
          <Glyph
            className={cn(
              "mr-1 hidden size-3.5 shrink-0 group-data-[zoom=near]/map:block",
              state === "idle" ? "text-muted" : "opacity-80",
            )}
            aria-hidden
          />
        )}
        {kind === "building" ? (
          <span className="tabular-nums">{markerLabel(place)}</span>
        ) : (
          <span className="pl-1 tabular-nums group-data-[zoom=far]/map:hidden">
            {kind === "lot" ? lotNumber(place) : markerLabel(place)}
          </span>
        )}
        <span
          className={cn(
            "grid transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none",
            picked
              ? "grid-cols-[1fr] opacity-100"
              : "grid-cols-[0fr] opacity-0 group-hover/chip:grid-cols-[1fr] group-hover/chip:opacity-100 group-focus-visible/chip:grid-cols-[1fr] group-focus-visible/chip:opacity-100",
          )}>
          <span className="min-w-0 overflow-hidden">
            <span className="ml-1.5 block max-w-44 truncate border-l border-current/25 pl-1.5 font-medium">{place.name}</span>
          </span>
        </span>
        {state === "stop" && stop !== undefined ? (
          <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold leading-none text-accent-foreground">
            {stop}
          </span>
        ) : busy ? (
          <span
            aria-hidden
            className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none tabular-nums text-accent-foreground ring-2 ring-overlay">
            {activity > 9 ? "9+" : activity}
          </span>
        ) : null}
        {exit ? (
          <span
            aria-hidden
            className="absolute -left-2 -top-2 flex size-4 animate-safety-in items-center justify-center rounded-full bg-success text-success-foreground ring-2 ring-overlay motion-reduce:animate-none group-data-[zoom=far]/map:hidden">
            <DoorOpen className="size-2.5" strokeWidth={3} />
          </span>
        ) : null}
      </button>
    </div>
  );
}
