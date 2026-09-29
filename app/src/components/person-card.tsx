"use client";

import { Button, CloseButton, Surface } from "@heroui/react";
import { Crosshair } from "lucide-react";
import { useEffect, useState } from "react";

import { Avatar } from "@/components/people-panel";
import type { Coordinate } from "@/data/campus";
import { distanceMeters, formatDistance } from "@/lib/geo";

export type PersonDetails = {
  name: string;
  username?: string;
  isHost: boolean;
  isMeetingPoint: boolean;
  coordinate: Coordinate;
  accuracy: number;
  /** When their last position arrived, in milliseconds since 1970. */
  at: number;
};

function ago(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : "over an hour ago";
}

/** Who a pin on the map is: tapping a friend in a meetup shows their name, how far they are, and how fresh it is. */
export function PersonCard({
  person,
  youAt,
  onCenter,
  onClose,
}: {
  person: PersonDetails;
  youAt?: Coordinate;
  onCenter: () => void;
  onClose: () => void;
}) {
  // Keeps "updated 2 min ago" honest while the card stays open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const away = youAt ? formatDistance(distanceMeters(youAt, person.coordinate)) : undefined;
  const details = [
    person.isMeetingPoint ? "Everyone meets here" : person.isHost ? "Host" : undefined,
    away ? `${away} away` : undefined,
    `updated ${ago(person.at, now)}`,
    person.accuracy > 50 ? `within ${formatDistance(person.accuracy)}` : undefined,
  ].filter(Boolean);

  return (
    <Surface
      role="dialog"
      aria-label={person.name}
      className="animate-sheet-in pointer-events-auto flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 rounded-3xl px-3 py-2.5 shadow-xl">
      <Avatar name={person.name} username={person.username ?? "?"} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{person.name}</p>
        <p className="truncate text-xs text-muted">
          {person.username ? `@${person.username} · ` : ""}
          {details.join(" · ")}
        </p>
      </div>
      <Button isIconOnly size="sm" variant="secondary" aria-label={`Center on ${person.name}`} onPress={onCenter}>
        <Crosshair aria-hidden />
      </Button>
      <CloseButton aria-label="Close" onPress={onClose} />
    </Surface>
  );
}
