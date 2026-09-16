"use client";

import { useEffect, useRef, useState } from "react";

import type { Coordinate } from "@/data/campus";
import { distanceMeters } from "@/lib/geo";
import { joinMeetupLive, type LivePosition } from "@/lib/realtime";

const SEND_EVERY_MS = 20_000;
const SEND_AFTER_METERS = 8;

export type LiveState = "connecting" | "live" | "offline";

type Live = { meetupId: string; positions: LivePosition[]; state: LiveState };

const nothing: Live = { meetupId: "", positions: [], state: "offline" };

/**
 * Streams the meetup's positions while it is open and shares yours. Passing a null id stops both,
 * which is what leaving, ending, or closing the meetup does.
 */
export function useMeetupLive(meetupId: string | null, fix?: { position: Coordinate; accuracy: number }) {
  const [live, setLive] = useState<Live>(nothing);
  const connectionRef = useRef<ReturnType<typeof joinMeetupLive> | null>(null);
  const lastSentRef = useRef<{ at: number; position: Coordinate } | null>(null);

  useEffect(() => {
    if (!meetupId) return;
    lastSentRef.current = null;
    let active = true;
    const connection = joinMeetupLive(meetupId, {
      onPositions: (positions) => {
        if (active) setLive((current) => ({ meetupId, positions, state: current.state }));
      },
      onState: (state) => {
        if (active) setLive((current) => ({ meetupId, positions: current.positions, state }));
      },
    });
    connectionRef.current = connection;
    return () => {
      active = false;
      connection.close();
      connectionRef.current = null;
    };
  }, [meetupId]);

  useEffect(() => {
    const connection = connectionRef.current;
    if (!connection || !fix) return;
    const last = lastSentRef.current;
    const moved = !last || distanceMeters(last.position, fix.position) >= SEND_AFTER_METERS;
    const due = !last || Date.now() - last.at >= SEND_EVERY_MS;
    if (!moved && !due) return;
    lastSentRef.current = { at: Date.now(), position: fix.position };
    void connection.send(fix);
  }, [fix]);

  // Anything left from a previous meetup is ignored rather than cleared, so no extra render happens.
  const current = meetupId && live.meetupId === meetupId ? live : nothing;
  const state: LiveState = !meetupId ? "offline" : current.state === "offline" ? "connecting" : current.state;
  return { positions: current.positions, state };
}
