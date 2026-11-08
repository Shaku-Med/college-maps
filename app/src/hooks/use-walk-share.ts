"use client";

import { toast } from "@heroui/react";
import { useCallback, useRef, useState } from "react";

import type { Coordinate, Place } from "@/data/campus";
import { useMeetupLive } from "@/hooks/use-meetup-live";
import { socialApi, type Meetup } from "@/lib/social-api";
import { walkDestination, walkMinutes } from "@/lib/walk-share";

type Fix = { position: Coordinate; accuracy: number };

/** The walker's side of Walk me there: starts and stops the share and sends their position while it runs. */
export function useWalkShare(meetups: Meetup[], onMeetupChange: (meetup: Meetup) => void, fix?: Fix) {
  const [walkId, setWalkId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const stoppingRef = useRef(false);
  // The list refreshes every half minute, which is how the walker sees friends open it.
  const walk = walkId ? (meetups.find((m) => m.id === walkId && m.active) ?? null) : null;
  useMeetupLive(walk ? walk.id : null, walk ? fix : undefined);

  const start = useCallback(
    async (friends: string[], destination: Place, remainingSeconds: number) => {
      const where = walkDestination(destination);
      if (!where) {
        toast.danger("Walk sharing only works to places on campus.");
        return false;
      }
      setIsBusy(true);
      const res = await socialApi.createMeetup({ kind: "walk", friends, destination: where, minutes: walkMinutes(remainingSeconds) });
      setIsBusy(false);
      if (!res.ok) {
        toast.danger(res.message);
        return false;
      }
      onMeetupChange(res.data);
      setWalkId(res.data.id);
      return true;
    },
    [onMeetupChange],
  );

  const stop = useCallback(
    async (arrived: boolean) => {
      if (!walk || stoppingRef.current) return;
      stoppingRef.current = true;
      setWalkId(null);
      const res = await socialApi.endMeetup(walk.id, arrived);
      stoppingRef.current = false;
      if (res.ok) onMeetupChange(res.data);
      else toast.danger("Sharing could not be stopped. It ends on its own soon.");
    },
    [walk, onMeetupChange],
  );

  return { walk, isBusy, start, stop };
}
