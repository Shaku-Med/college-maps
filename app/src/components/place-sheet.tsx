"use client";

import { Button, CloseButton, Surface, toast } from "@heroui/react";
import { Navigation, Share2 } from "lucide-react";

import { CollapseButton, SheetGrabber } from "@/components/sheet-chrome";
import { CATEGORY_LABELS, type Place } from "@/data/campus";
import { CATEGORY_ICONS } from "@/lib/categories";
import { placeUrl } from "@/lib/share-url";
import { floorForRoom, floorLabel } from "@/lib/search";

type PlaceSheetProps = {
  place: Place;
  room?: string;
  onDirections: () => void;
  onCollapse: () => void;
  onClose: () => void;
};

export function PlaceSheet({ place, room, onDirections, onCollapse, onClose }: PlaceSheetProps) {
  const Icon = CATEGORY_ICONS[place.category];
  const floor = room ? floorLabel(floorForRoom(room)) : undefined;

  async function handleShare() {
    const url = placeUrl(place.id, room);
    const title = room ? `Room ${room}, ${place.name}` : place.name;
    if (navigator.share) {
      // Rejects when the user dismisses the share sheet, which is not an error.
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.danger("Could not copy the link");
    }
  }

  return (
    <Surface
      role="region"
      aria-label={place.name}
      className="animate-sheet-in rounded-t-[28px] px-5 pb-[max(1.25rem,var(--map-safe-bottom))] pt-0 shadow-2xl md:rounded-3xl md:pb-5 md:pt-5">
      <SheetGrabber onCollapse={onCollapse} />

      <div className="flex items-start gap-3 pt-3 md:pt-0">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-soft-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="text-lg font-semibold leading-snug tracking-tight">{place.name}</h2>
          <p className="text-sm text-muted">
            {place.isBuilding ? `Building ${place.id} · ` : ""}
            {CATEGORY_LABELS[place.category]}
          </p>
        </div>
        <CollapseButton onCollapse={onCollapse} />
        <CloseButton aria-label="Close" onPress={onClose} />
      </div>

      {place.details ? <p className="mt-3 text-sm text-muted">{place.details}</p> : null}

      {room ? (
        <div className="mt-4 rounded-2xl bg-surface-secondary px-4 py-3">
          <p className="text-sm font-semibold">
            Room {room}
            {floor ? ` · ${floor}` : ""}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {floor
              ? `Enter ${place.name}, then head to the ${floor.toLowerCase()}.`
              : `Enter ${place.name} and follow the room signs.`}
          </p>
        </div>
      ) : null}

      <div className="mt-5 flex gap-2">
        <Button variant="primary" size="lg" className="flex-1" onPress={onDirections}>
          <Navigation aria-hidden />
          Directions
        </Button>
        <Button variant="secondary" size="lg" onPress={handleShare} aria-label="Share this place">
          <Share2 aria-hidden />
          <span className="max-sm:hidden">Share</span>
        </Button>
      </div>
    </Surface>
  );
}
