"use client";

import { Button, CloseButton, Surface, toast } from "@heroui/react";
import { CalendarClock, Navigation, Share2 } from "lucide-react";

import { CollapseButton, SheetGrabber } from "@/components/sheet-chrome";
import { CATEGORY_LABELS, type Place } from "@/data/campus";
import { CATEGORY_ICONS } from "@/lib/categories";
import type { Meetup } from "@/lib/social-api";
import { placeUrl } from "@/lib/share-url";
import { floorForRoom, floorLabel } from "@/lib/search";

type PlaceSheetProps = {
  place: Place;
  room?: string;
  events?: Meetup[];
  onOpenEvent?: (meetup: Meetup) => void;
  onDirections: () => void;
  onCollapse: () => void;
  onClose: () => void;
};

function whenLabel(meetup: Meetup) {
  if (!meetup.startsAt) return "Happening now";
  const at = new Date(meetup.startsAt);
  if (at.getTime() <= Date.now()) return "Happening now";
  return at.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function PlaceSheet({
  place,
  room,
  events = [],
  onOpenEvent,
  onDirections,
  onCollapse,
  onClose,
}: PlaceSheetProps) {
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
      <SheetGrabber />

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

      {events.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Campus events here</p>
          <ul className="flex flex-col gap-1.5">
            {events.slice(0, 4).map((meetup) => (
              <li key={meetup.id}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2.5 rounded-2xl bg-surface-secondary px-3.5 py-2.5 text-left transition-colors hover:bg-accent-soft"
                  onClick={() => onOpenEvent?.(meetup)}>
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{meetup.title ?? "Campus event"}</span>
                    <span className="block text-xs text-muted">
                      {whenLabel(meetup)}
                      {meetup.going > 0 ? ` · ${meetup.going} going` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
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
