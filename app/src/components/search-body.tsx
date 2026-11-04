"use client";

import { Button } from "@heroui/react";
import { CalendarClock, ChevronRight } from "lucide-react";
import { useMemo, type ReactNode, type RefObject } from "react";

import { PlaceSearchList, type Nearby } from "@/components/place-search-list";
import { AMENITY_KINDS } from "@/data/amenities";
import { CAMPUS, type Place } from "@/data/campus";
import { useNow } from "@/hooks/use-now";
import { AMENITY_SHORTCUTS } from "@/lib/amenity-search";
import { AMENITY_ICONS } from "@/lib/categories";
import { classComingUp, greeting } from "@/lib/greeting";
import { loadSchedule } from "@/lib/schedule";

type SearchBodyProps = {
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (place: Place, room?: string) => void;
  /** Where "near" means for SOS phones, benches, and the like: you, else the place open. */
  nearby: Nearby;
  /** The signed in person's display name, to say hello with their next class. Left out when signed out. */
  greetName?: string;
  /** Where a shortcut puts the cursor back, so the keyboard stays up. */
  inputRef?: RefObject<HTMLInputElement | null>;
  /** Rows shown first while nothing is typed, like "My location" when picking where to start. */
  header?: ReactNode;
  hide?: readonly string[];
};

/** Everything under a search field, the same wherever a place is searched for: hello and next class, shortcuts, then results. */
export function SearchBody({ query, onQueryChange, onSelect, nearby, greetName, inputRef, header, hide }: SearchBodyProps) {
  const hasQuery = query.trim().length > 0;
  const now = useNow(60_000);
  // Read as it opens, so a class added a moment ago in My classes shows up.
  const hello = useMemo(() => {
    if (greetName === undefined) return null;
    const at = new Date(now);
    return { line: greeting(at, greetName), next: classComingUp(loadSchedule(), at) };
  }, [greetName, now]);

  return (
    <>
      {header && !hasQuery ? <div className="mb-2 flex flex-col gap-1 px-1.5">{header}</div> : null}

      {hello && !hasQuery ? (
        <div className="mb-3 px-1.5">
          <p className="px-1.5 pb-2 pt-1 text-[15px] font-semibold tracking-tight">{hello.line}</p>
          {hello.next ? (
            <Button
              variant="secondary"
              fullWidth
              onPress={() => hello.next && onSelect(hello.next.place, hello.next.entry.room)}
              className="h-auto justify-start gap-3 rounded-2xl px-3 py-2.5 text-left">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
                <CalendarClock className="size-4" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">{hello.next.entry.name}</span>
                <span className="truncate text-xs font-normal text-muted">{hello.next.detail}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}

      {hasQuery ? null : (
        <div className="-mx-1.5 mb-2 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none]">
          {AMENITY_SHORTCUTS.map((kind) => {
            const Icon = AMENITY_ICONS[kind];
            return (
              <Button
                key={kind}
                size="sm"
                variant="secondary"
                onPress={() => {
                  onQueryChange(AMENITY_KINDS[kind].plural);
                  inputRef?.current?.focus();
                }}
                className="shrink-0 gap-1.5 rounded-full">
                <Icon className="size-3.5" aria-hidden />
                {AMENITY_KINDS[kind].plural}
              </Button>
            );
          })}
        </div>
      )}

      {!hasQuery && CAMPUS.rooms.help ? (
        <p className="mx-1.5 mb-2 rounded-2xl bg-surface-secondary px-3.5 py-3 text-xs leading-relaxed text-muted">
          <span className="font-medium text-foreground">Reading a room code:</span> {CAMPUS.rooms.help}
        </p>
      ) : null}

      <PlaceSearchList query={query} onSelect={onSelect} nearby={nearby} hide={hide} />

      {!hasQuery && CAMPUS.app.disclaimer ? (
        <p className="px-3 pb-1 pt-4 text-center text-[11px] leading-relaxed text-muted">{CAMPUS.app.disclaimer}</p>
      ) : null}
    </>
  );
}
