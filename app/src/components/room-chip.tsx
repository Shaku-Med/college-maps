"use client";

import { DoorClosed } from "lucide-react";

import type { RoomSpot } from "@/lib/building-safety";
import { floorLabel } from "@/lib/search";

/** The room being looked for, inside its building: its number and floor, in the accent like the picked building. */
export function RoomChip({ spot }: { spot: RoomSpot }) {
  const floor = floorLabel(spot.floor);
  return (
    <div
      data-room-marker={spot.name}
      role="img"
      aria-label={`Room ${spot.name}${floor ? `, ${floor}` : ""}${spot.landmark ? `, ${spot.landmark}` : ""}`}
      className="flex h-7 animate-safety-in items-center gap-1 rounded-full border border-accent bg-accent py-0.5 pl-0.5 pr-2.5 text-xs font-semibold tracking-tight text-accent-foreground shadow-md motion-reduce:animate-none group-data-[zoom=far]/map:hidden">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-foreground/20">
        <DoorClosed className="size-3" strokeWidth={2.5} aria-hidden />
      </span>
      <span className="tabular-nums">{spot.name}</span>
      {floor ? <span className="border-l border-current/25 pl-1.5 font-medium opacity-90">{floor}</span> : null}
    </div>
  );
}
