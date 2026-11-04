"use client";

import { CloseButton, Modal, SearchField } from "@heroui/react";
import { useRef, useState, type ReactNode } from "react";

import { useCampusSearch, type Nearby } from "@/components/place-search-list";
import { SearchBody } from "@/components/search-body";
import { CAMPUS, type Place } from "@/data/campus";
import { MAX_QUERY_LENGTH } from "@/lib/search";

type PlacePickerModalProps = {
  /** What is being picked, like "Add a stop" or "Start from". Nothing shows while it is null. */
  title: string | null;
  onClose: () => void;
  onPick: (place: Place, room?: string) => void;
  nearby: Nearby;
  greetName?: string;
  /** Rows shown first while nothing is typed, like "My location" when picking where to start. */
  header?: ReactNode;
  /** Places that make no sense to pick, like the destination or a stop already on the way. */
  hide?: readonly string[];
};

/** Picks a place with the very same search as the main search bar, for stops and starting points. */
export function PlacePickerModal({ title, onClose, onPick, nearby, greetName, header, hide }: PlacePickerModalProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { room, results, amenities } = useCampusSearch(query, undefined, nearby, hide);

  function close() {
    setQuery("");
    onClose();
  }

  function pick(place: Place, roomCode?: string) {
    setQuery("");
    onPick(place, roomCode);
  }

  function handleSubmit() {
    if (room) pick(room.place, room.room);
    else if (amenities) pick(amenities.matches[0].place);
    else if (results[0]) pick(results[0]);
  }

  return (
    <Modal.Backdrop
      isOpen={title !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      isDismissable>
      <Modal.Container placement="center" size="md" scroll="inside">
        <Modal.Dialog className="max-h-[85dvh]">
          <Modal.Header className="flex-col items-stretch gap-3">
            <div className="flex items-center gap-3">
              <Modal.Heading className="min-w-0 flex-1 truncate">{title}</Modal.Heading>
              <CloseButton aria-label="Close" onPress={close} />
            </div>
            <SearchField
              aria-label={title ?? "Search places"}
              value={query}
              onChange={(value) => setQuery(value.slice(0, MAX_QUERY_LENGTH))}
              onSubmit={handleSubmit}
              autoFocus
              fullWidth>
              <SearchField.Group className="rounded-full">
                <SearchField.SearchIcon />
                <SearchField.Input
                  ref={inputRef}
                  maxLength={MAX_QUERY_LENGTH}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="search"
                  placeholder={`Search a room like ${CAMPUS.rooms.example}`}
                  className="text-base sm:text-sm"
                />
                <SearchField.ClearButton aria-label="Clear search" />
              </SearchField.Group>
            </SearchField>
          </Modal.Header>
          <Modal.Body className="px-1.5 pb-3">
            <SearchBody
              query={query}
              onQueryChange={setQuery}
              onSelect={pick}
              nearby={nearby}
              greetName={greetName}
              inputRef={inputRef}
              header={header}
              hide={hide}
            />
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
