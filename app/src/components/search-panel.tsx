"use client";

import { Button, SearchField, Surface } from "@heroui/react";
import { ArrowLeft } from "lucide-react";
import { useRef, type KeyboardEvent, type RefObject } from "react";

import { PlaceSearchList, useCampusSearch } from "@/components/place-search-list";
import { CAMPUS, type Place } from "@/data/campus";
import { MAX_QUERY_LENGTH } from "@/lib/search";

type SearchPanelProps = {
  query: string;
  isOpen: boolean;
  onQueryChange: (query: string) => void;
  onOpenChange: (open: boolean) => void;
  onSelect: (place: Place, room?: string) => void;
  /** Lets the Search tab put the cursor in the field straight from the tap, so the keyboard opens. */
  inputRef?: RefObject<HTMLInputElement | null>;
};

export function SearchPanel({ query, isOpen, onQueryChange, onOpenChange, onSelect, inputRef: givenRef }: SearchPanelProps) {
  const ownRef = useRef<HTMLInputElement>(null);
  const inputRef = givenRef ?? ownRef;
  const { room: roomMatch, results } = useCampusSearch(query);
  const hasQuery = query.trim().length > 0;

  function close() {
    onOpenChange(false);
    inputRef.current?.blur();
  }

  function select(place: Place, room?: string) {
    close();
    onSelect(place, room);
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
          : "glass-chrome rounded-3xl shadow-lg"
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
          {!hasQuery && CAMPUS.rooms.help ? (
            <p className="mx-1.5 mb-2 rounded-2xl bg-surface-secondary px-3.5 py-3 text-xs leading-relaxed text-muted">
              <span className="font-medium text-foreground">Reading a room code:</span> {CAMPUS.rooms.help}
            </p>
          ) : null}

          <PlaceSearchList query={query} onSelect={select} />

          {!hasQuery && CAMPUS.app.disclaimer ? (
            <p className="px-3 pb-1 pt-4 text-center text-[11px] leading-relaxed text-muted">
              {CAMPUS.app.disclaimer}
            </p>
          ) : null}
        </div>
      ) : null}
    </Surface>
  );
}
