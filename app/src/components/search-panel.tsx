"use client";

import { Button, Header, ListBox, SearchField, Surface } from "@heroui/react";
import { ArrowLeft, DoorOpen } from "lucide-react";
import { useMemo, useRef, type KeyboardEvent } from "react";

import { PlaceItem } from "@/components/place-row";
import { CAMPUS, CATEGORY_LABELS, PLACES, getPlace, type Place } from "@/data/campus";
import { BROWSE_ORDER } from "@/lib/categories";
import { MAX_QUERY_LENGTH, floorLabel, parseRoomCode, searchPlaces } from "@/lib/search";

const SAMPLE_BUILDING = PLACES.find((place) => place.isBuilding)?.id;

const BROWSE_SECTIONS = BROWSE_ORDER.map((category) => ({
  category,
  places: PLACES.filter((place) => place.category === category).sort((a, b) => a.id.localeCompare(b.id)),
})).filter((section) => section.places.length > 0);

type SearchPanelProps = {
  query: string;
  isOpen: boolean;
  onQueryChange: (query: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (place: Place, room?: string) => void;
};

export function SearchPanel({ query, isOpen, onQueryChange, onOpenChange, onSelect }: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const roomMatch = useMemo(() => parseRoomCode(query), [query]);
  const results = useMemo(() => (roomMatch ? [] : searchPlaces(query)), [query, roomMatch]);
  const hasQuery = query.trim().length > 0;

  function close() {
    onOpenChange(false);
    inputRef.current?.blur();
  }

  function select(place: Place, room?: string) {
    close();
    onSelect(place, room);
  }

  function handleAction(key: string | number) {
    const place = getPlace(String(key));
    if (place) select(place);
  }

  function handleSubmit() {
    if (roomMatch) select(roomMatch.place, roomMatch.room);
    else if (results[0]) select(results[0]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && !hasQuery) close();
  }

  return (
    <Surface
      className={
        isOpen
          ? "flex max-h-[calc(100dvh-var(--map-safe-top)-var(--map-safe-bottom))] flex-col overflow-hidden rounded-3xl shadow-xl"
          : "rounded-3xl shadow-lg"
      }>
      <div className="flex items-center gap-1 p-1.5">
        {isOpen ? (
          <Button isIconOnly variant="ghost" aria-label="Close search" onPress={close} className="rounded-full">
            <ArrowLeft className="size-5" aria-hidden />
          </Button>
        ) : null}

        <SearchField
          aria-label="Search rooms and buildings"
          value={query}
          onChange={(value) => onQueryChange(value.slice(0, MAX_QUERY_LENGTH))}
          onSubmit={handleSubmit}
          fullWidth
          className="flex-1">
          <SearchField.Group className="rounded-full">
            {isOpen ? null : <SearchField.SearchIcon />}
            <SearchField.Input
              ref={inputRef}
              maxLength={MAX_QUERY_LENGTH}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              placeholder={`Search a room like ${CAMPUS.rooms.example}`}
              onFocus={() => onOpenChange(true)}
              onKeyDown={handleKeyDown}
              className="text-base sm:text-sm"
            />
            <SearchField.ClearButton aria-label="Clear search" />
          </SearchField.Group>
        </SearchField>
      </div>

      {isOpen ? (
        <div className="animate-fade-in overflow-y-auto overscroll-contain px-1.5 pb-2">
          {roomMatch ? (
            <Button
              variant="secondary"
              fullWidth
              onPress={() => select(roomMatch.place, roomMatch.room)}
              className="mb-1 h-auto justify-start gap-3 rounded-2xl px-3 py-3 text-left">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <DoorOpen className="size-5" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">
                  Room {roomMatch.room} in {roomMatch.place.id}
                </span>
                <span className="truncate text-xs font-normal opacity-80">
                  {[floorLabel(roomMatch.floor), roomMatch.place.name].filter(Boolean).join(", ")}
                </span>
              </span>
            </Button>
          ) : null}

          {hasQuery && results.length > 0 ? (
            <ListBox aria-label="Search results" selectionMode="none" onAction={handleAction}>
              {results.map((place) => (
                <PlaceItem key={place.id} place={place} />
              ))}
            </ListBox>
          ) : null}

          {hasQuery && !roomMatch && results.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium">No matches</p>
              <p className="mt-1 text-xs text-muted">
                {SAMPLE_BUILDING ? `Try a building code like ${SAMPLE_BUILDING} or ` : "Try "}a room like{" "}
                {CAMPUS.rooms.example}.
              </p>
            </div>
          ) : null}

          {!hasQuery ? (
            <>
              {CAMPUS.rooms.help ? (
                <p className="mx-1.5 mb-2 rounded-2xl bg-surface-secondary px-3.5 py-3 text-xs leading-relaxed text-muted">
                  <span className="font-medium text-foreground">Reading a room code:</span> {CAMPUS.rooms.help}
                </p>
              ) : null}
              <ListBox aria-label="All campus places" selectionMode="none" onAction={handleAction}>
                {BROWSE_SECTIONS.map(({ category, places }) => (
                  <ListBox.Section key={category}>
                    <Header className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
                      {CATEGORY_LABELS[category]}
                    </Header>
                    {places.map((place) => (
                      <PlaceItem key={place.id} place={place} />
                    ))}
                  </ListBox.Section>
                ))}
              </ListBox>
              {CAMPUS.app.disclaimer ? (
                <p className="px-3 pb-1 pt-4 text-center text-[11px] leading-relaxed text-muted">
                  {CAMPUS.app.disclaimer}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </Surface>
  );
}
