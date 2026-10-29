"use client";

import { Button, Header, ListBox } from "@heroui/react";
import { DoorOpen } from "lucide-react";
import { useMemo } from "react";

import { PlaceItem } from "@/components/place-row";
import { CAMPUS, CATEGORY_LABELS, PLACES, getPlace, type Coordinate, type Place } from "@/data/campus";
import { searchAmenities } from "@/lib/amenity-search";
import { formatDistance } from "@/lib/geo";
import { PLACE_SECTIONS, floorLabel, parseRoomCode, searchPlaces } from "@/lib/search";

const SAMPLE_BUILDING = PLACES.find((place) => place.isBuilding)?.id;
const SECTION_HEADER = "px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted";

type PlaceSearchListProps = {
  query: string;
  onSelect: (place: Place, room?: string) => void;
  /** With nothing typed, list every place by kind. Off in forms, where that list would bury the rest. */
  browse?: boolean;
  limit?: number;
  /** Also finds the SOS phones, benches, and the like closest to here or to the place open; the main search only. */
  nearby?: Nearby;
};

export type Nearby = { here?: Coordinate; around?: Place };

/** What a query finds: a room code wins outright; otherwise the places that match, and nearby outdoor things when asked. */
export function useCampusSearch(query: string, limit?: number, nearby?: Nearby) {
  const room = useMemo(() => parseRoomCode(query), [query]);
  const results = useMemo(() => (room ? [] : searchPlaces(query, limit)), [query, room, limit]);
  const wantsNearby = nearby !== undefined;
  const here = nearby?.here;
  const around = nearby?.around;
  const amenities = useMemo(
    () => (wantsNearby && !room ? searchAmenities(query, { here, around }) : null),
    [query, room, wantsNearby, here, around],
  );
  return { room, results, amenities: amenities?.matches.length ? amenities : null };
}

/** The campus search results used everywhere a place is picked: a room code first, then matching places. */
export function PlaceSearchList({ query, onSelect, browse = true, limit, nearby }: PlaceSearchListProps) {
  const { room, results, amenities } = useCampusSearch(query, limit, nearby);
  const hasQuery = query.trim().length > 0;

  function handleAction(key: string | number) {
    const place = getPlace(String(key));
    if (place) onSelect(place);
  }

  return (
    <>
      {room ? (
        <Button
          variant="secondary"
          fullWidth
          onPress={() => onSelect(room.place, room.room)}
          className="mb-1 h-auto justify-start gap-3 rounded-2xl px-3 py-3 text-left">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <DoorOpen className="size-5" aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">
              Room {room.room} in {room.place.id}
            </span>
            <span className="truncate text-xs font-normal opacity-80">
              {[floorLabel(room.floor), room.place.name].filter(Boolean).join(", ")}
            </span>
          </span>
        </Button>
      ) : null}

      {amenities ? (
        <ListBox aria-label={amenities.title} selectionMode="none" onAction={handleAction}>
          <ListBox.Section>
            <Header className={SECTION_HEADER}>{amenities.title}</Header>
            {amenities.matches.map(({ place, meters, by }) => (
              <PlaceItem
                key={place.id}
                place={place}
                note={[by ? `Outside ${by.label ?? by.id}` : "Outdoors", amenities.measured && formatDistance(meters)]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </ListBox.Section>
        </ListBox>
      ) : null}

      {hasQuery && results.length > 0 ? (
        <ListBox aria-label="Search results" selectionMode="none" onAction={handleAction}>
          <ListBox.Section>
            {amenities ? <Header className={SECTION_HEADER}>Places</Header> : null}
            {results.map((place) => (
              <PlaceItem key={place.id} place={place} />
            ))}
          </ListBox.Section>
        </ListBox>
      ) : null}

      {hasQuery && !room && !amenities && results.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <p className="text-sm font-medium">No matches</p>
          <p className="mt-1 text-xs text-muted">
            {SAMPLE_BUILDING ? `Try a building code like ${SAMPLE_BUILDING} or ` : "Try "}a room like{" "}
            {CAMPUS.rooms.example}.
          </p>
        </div>
      ) : null}

      {!hasQuery && browse ? (
        <ListBox aria-label="All campus places" selectionMode="none" onAction={handleAction}>
          {PLACE_SECTIONS.map(({ category, places }) => (
            <ListBox.Section key={category}>
              <Header className={SECTION_HEADER}>
                {CATEGORY_LABELS[category]}
              </Header>
              {places.map((place) => (
                <PlaceItem key={place.id} place={place} />
              ))}
            </ListBox.Section>
          ))}
        </ListBox>
      ) : null}
    </>
  );
}
