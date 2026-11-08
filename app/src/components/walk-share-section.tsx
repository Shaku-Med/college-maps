"use client";

import { Button, ToggleButton, ToggleButtonGroup, toast } from "@heroui/react";
import { Phone, Radio } from "lucide-react";
import { useState } from "react";

import type { Friend, Meetup } from "@/lib/social-api";
import { MAX_WATCHERS, watchLine } from "@/lib/walk-share";

type WalkShareSectionProps = {
  friends: Friend[];
  walk: Meetup | null;
  isBusy: boolean;
  onStart: (friends: string[]) => Promise<boolean>;
  onStop: () => void;
  /** Adds the nearest SOS phone as the next stop, when one is close. */
  onSos?: () => void;
};

/** Walk me there, in the trip panel: pick up to three friends who see you live until you arrive. */
export function WalkShareSection({ friends, walk, isBusy, onStart, onStop, onSos }: WalkShareSectionProps) {
  const [isPicking, setIsPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  if (walk) {
    return (
      <div className="pt-2">
        <p className="pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Walk me there</p>
        <div className="flex items-center gap-3 rounded-2xl bg-surface-secondary py-2.5 pl-3 pr-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Radio className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Sharing your walk</span>
            <span className="block truncate text-xs text-muted">{watchLine(walk)} · Stops when you arrive</span>
          </span>
          <Button size="sm" variant="secondary" onPress={onStop}>
            Stop
          </Button>
        </div>
        {onSos ? (
          <Button size="sm" variant="secondary" className="mt-2 gap-1.5 rounded-full" onPress={onSos}>
            <Phone className="size-3.5" aria-hidden />
            Go to the nearest SOS phone
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="pt-2">
      <p className="pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Walk me there</p>
      {friends.length === 0 ? (
        <p className="text-sm text-muted">Add a friend, and they can watch you walk until you get there.</p>
      ) : isPicking ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-sm text-muted">Up to {MAX_WATCHERS} friends see you live until you arrive. Nothing is saved.</p>
          <ToggleButtonGroup
            aria-label="Friends who can watch"
            selectionMode="multiple"
            isDetached
            size="sm"
            selectedKeys={picked}
            onSelectionChange={(keys) => {
              const next = friends.map((f) => f.username).filter((username) => keys.has(username));
              if (next.length > MAX_WATCHERS) {
                toast.info(`Pick up to ${MAX_WATCHERS} friends.`);
                return;
              }
              setPicked(next);
            }}
            className="flex-wrap gap-1.5">
            {friends.map((friend) => (
              <ToggleButton
                key={friend.username}
                id={friend.username}
                className="rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
                {friend.displayName || friend.username}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1" onPress={() => setIsPicking(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1"
              isPending={isBusy}
              isDisabled={picked.length === 0}
              onPress={async () => {
                if (await onStart(picked)) {
                  setIsPicking(false);
                  setPicked([]);
                }
              }}>
              Share my walk
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsPicking(true)}
          className="flex w-full items-center gap-3 rounded-2xl bg-surface-secondary py-2.5 pl-3 pr-4 text-left transition-colors hover:bg-default focus-visible:outline-2 focus-visible:outline-focus">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-default text-muted">
            <Radio className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Share my walk</span>
            <span className="block text-xs text-muted">Friends see you live until you arrive</span>
          </span>
        </button>
      )}
    </div>
  );
}
