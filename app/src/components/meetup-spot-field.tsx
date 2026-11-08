"use client";

import { Button, Input, SearchField } from "@heroui/react";
import { MapPin, MapPinPlus } from "lucide-react";
import { useState } from "react";

import { PlaceSearchList } from "@/components/place-search-list";
import { usePinDrop } from "@/components/pin-drop";
import { getPlace, type Coordinate } from "@/data/campus";
import { pinName } from "@/lib/amenity-search";
import type { MeetupDestination } from "@/lib/social-api";

export type MeetupSpot = { kind: "place"; placeId: string } | { kind: "pin"; at: Coordinate };

export function spotDestination(spot: MeetupSpot): MeetupDestination {
  return spot.kind === "pin"
    ? { kind: "pin", lat: spot.at.latitude, lng: spot.at.longitude }
    : { kind: "place", placeId: spot.placeId };
}

function spotName(spot: MeetupSpot) {
  return spot.kind === "pin" ? pinName(spot.at.latitude, spot.at.longitude) : (getPlace(spot.placeId)?.name ?? "A campus building");
}

/** Where a meetup happens: a building from search, or a pin dropped on the main map. */
export function MeetupSpotField({ value, onChange }: { value?: MeetupSpot; onChange: (spot?: MeetupSpot) => void }) {
  const [query, setQuery] = useState("");
  const dropPin = usePinDrop();

  async function pickPin(start?: Coordinate) {
    if (!dropPin) return;
    const at = await dropPin(start);
    if (at) onChange({ kind: "pin", at });
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-surface-secondary py-2 pl-4 pr-2">
        <MapPin className="size-4 shrink-0 text-muted" aria-hidden />
        <p className="min-w-0 flex-1 truncate text-sm">{spotName(value)}</p>
        {value.kind === "pin" && dropPin ? (
          <Button size="sm" variant="ghost" onPress={() => void pickPin(value.at)}>
            Move
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onPress={() => onChange(undefined)}>
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <SearchField value={query} onChange={setQuery} aria-label="Find a place">
        <Input variant="secondary" placeholder="Search buildings" />
      </SearchField>
      {dropPin && !query.trim() ? (
        <Button variant="secondary" size="sm" onPress={() => void pickPin()} className="self-start rounded-full">
          <MapPinPlus className="size-4" aria-hidden />
          Drop a pin on the map
        </Button>
      ) : null}
      <PlaceSearchList
        query={query}
        browse={false}
        limit={8}
        onSelect={(place) => {
          onChange({ kind: "place", placeId: place.id });
          setQuery("");
        }}
      />
    </div>
  );
}
