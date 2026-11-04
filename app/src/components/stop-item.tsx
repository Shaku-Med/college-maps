"use client";

import { CloseButton } from "@heroui/react";

import { isAmenity } from "@/data/amenities";
import type { Place } from "@/data/campus";
import { amenityWhere } from "@/lib/amenity-search";

type StopItemProps = {
  stop: Place;
  number: number;
  /** Shown under the name, like "After CSI Library". A bench or trash can says where it is otherwise. */
  note?: string;
  /** Left out for a stop that can't be removed, like a starting building the walker is not at yet. */
  onRemove?: () => void;
};

/** One stop on a trip, the same while planning and mid walk. */
export function StopItem({ stop, number, note, onRemove }: StopItemProps) {
  const detail = note ?? (isAmenity(stop) ? amenityWhere(stop) : undefined);
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-surface-secondary px-3 py-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
        {number}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{stop.name}</span>
        {detail ? <span className="block text-xs text-muted">{detail}</span> : null}
      </span>
      {onRemove ? <CloseButton aria-label={`Remove the stop at ${stop.name}`} onPress={onRemove} /> : null}
    </li>
  );
}
