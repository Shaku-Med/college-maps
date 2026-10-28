"use client";

import { Accessibility, ArrowUpDown, DoorOpen, DoorStairwell, HeartPulse, UsersRound, type LucideIcon } from "lucide-react";
import { useState } from "react";

import type { SafetyKind, SafetySpot } from "@/lib/building-safety";
import { cn } from "@/lib/cn";

const ICONS: Record<SafetyKind, LucideIcon> = {
  exit: DoorOpen,
  aed: HeartPulse,
  stairs: DoorStairwell,
  elevator: ArrowUpDown,
  chair: Accessibility,
  assembly: UsersRound,
};

// Exits and AEDs keep the colors of the signs on the walls; the rest stay quiet.
const TILES: Record<SafetyKind, string> = {
  exit: "bg-success text-success-foreground",
  aed: "bg-danger text-danger-foreground",
  stairs: "bg-default text-default-foreground",
  elevator: "bg-default text-default-foreground",
  chair: "bg-default text-default-foreground",
  assembly: "bg-success-soft text-success-soft-foreground",
};

/** Exits, stairs, and the like at one spot in a building: one icon zoomed out, all of them and a name close up. */
export function SafetyChip({ spot }: { spot: SafetySpot }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      data-safety-marker={spot.id}
      aria-label={spot.description}
      aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        setOpen((value) => !value);
      }}
      className="group/safety flex h-6 animate-safety-in cursor-pointer items-center gap-0.5 rounded-full border border-border bg-overlay p-0.5 text-[11px] font-semibold tracking-tight text-overlay-foreground shadow-sm outline-none transition-[translate,box-shadow] duration-200 ease-out hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:animate-none motion-reduce:transition-none group-data-[zoom=far]/map:hidden group-data-[zoom=near]/map:h-7 group-data-[zoom=near]/map:text-xs">
      {spot.kinds.map((kind, i) => {
        const Icon = ICONS[kind];
        return (
          <span
            key={kind}
            className={cn(
              "size-[18px] shrink-0 items-center justify-center rounded-full group-data-[zoom=near]/map:size-5",
              TILES[kind],
              i === 0 || open ? "flex" : "hidden group-hover/safety:flex group-focus-visible/safety:flex group-data-[zoom=near]/map:flex",
            )}>
            <Icon className="size-3" strokeWidth={2.5} aria-hidden />
          </span>
        );
      })}
      <span
        className={cn(
          "grid transition-[grid-template-columns,opacity] duration-200 ease-out motion-reduce:transition-none",
          open
            ? "grid-cols-[1fr] opacity-100"
            : "grid-cols-[0fr] opacity-0 group-hover/safety:grid-cols-[1fr] group-hover/safety:opacity-100 group-focus-visible/safety:grid-cols-[1fr] group-focus-visible/safety:opacity-100 group-data-[zoom=near]/map:grid-cols-[1fr] group-data-[zoom=near]/map:opacity-100",
        )}>
        <span className="min-w-0 overflow-hidden">
          <span className="block whitespace-nowrap pl-1 pr-1.5">{spot.label}</span>
        </span>
      </span>
    </button>
  );
}
