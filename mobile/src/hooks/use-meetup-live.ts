import { useEffect, useRef, useState } from 'react';

import { distanceMeters } from '@/lib/geo';
import type { Fix } from '@/lib/location';
import { joinMeetupLive, type LivePosition } from '@/lib/realtime';

// The same pace as the web app: a position every 20 seconds, or sooner after moving a few metres.
const SEND_EVERY_MS = 20_000;
const SEND_AFTER_METERS = 8;

export type LiveState = 'connecting' | 'live' | 'offline';

type Live = { meetupId: string; positions: LivePosition[]; state: LiveState };
const nothing: Live = { meetupId: '', positions: [], state: 'offline' };

/** Streams a meetup's positions while it is open and shares yours. A null id stops both. */
export function useMeetupLive(meetupId: string | null, fix: Fix | null) {
  const [live, setLive] = useState<Live>(nothing);
  const connectionRef = useRef<ReturnType<typeof joinMeetupLive> | null>(null);
  const lastSentRef = useRef<{ at: number; fix: Fix } | null>(null);

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
    const moved = !last || distanceMeters(last.fix.position, fix.position) >= SEND_AFTER_METERS;
    const due = !last || Date.now() - last.at >= SEND_EVERY_MS;
    if (!moved && !due) return;
    lastSentRef.current = { at: Date.now(), fix };
    void connection.send({ position: fix.position, accuracy: fix.accuracy, heading: fix.heading });
  }, [fix]);

  const current = meetupId && live.meetupId === meetupId ? live : nothing;
  const state: LiveState = !meetupId ? 'offline' : current.state === 'offline' ? 'connecting' : current.state;
  return { positions: current.positions, state };
}
