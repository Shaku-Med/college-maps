import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { socialApi, type FriendsOverview, type Meetup } from '@/lib/social-api';

const REFRESH_MS = 30_000;
const noFriends: FriendsOverview = { friends: [], incoming: [], outgoing: [], blocked: [] };

type Social = { owner: string; friends: FriendsOverview; meetups: Meetup[]; campus: Meetup[]; loading: boolean };

let data: Social = { owner: '', friends: noFriends, meetups: [], campus: [], loading: false };
const listeners = new Set<() => void>();

function set(next: Social) {
  data = next;
  for (const listener of listeners) listener();
}

/** Friends and meetups for one user. Answers that land after a different user signed in are dropped. */
export async function refreshSocial(owner: string) {
  if (!owner || data.loading) return;
  set({ ...data, loading: true });
  const [friends, meetups, campus] = await Promise.all([
    socialApi.friends(),
    socialApi.meetups(),
    socialApi.publicMeetups(),
  ]);
  const same = data.owner === owner;
  set({
    owner,
    friends: friends.ok ? friends.data : same ? data.friends : noFriends,
    meetups: meetups.ok ? meetups.data : same ? data.meetups : [],
    campus: campus.ok ? campus.data : same ? data.campus : [],
    loading: false,
  });
}

/** Puts a meetup the server just returned in place, the way the web app does. */
export function updateMeetup(meetup: Meetup) {
  const rest = data.meetups.filter((m) => m.id !== meetup.id);
  const keep = meetup.active && meetup.yourStatus !== 'declined' && meetup.yourStatus !== 'left';
  const campus = data.campus.map((m) => (m.id === meetup.id ? meetup : m)).filter((m) => m.active);
  set({ ...data, campus, meetups: meetup.visibility === 'public' ? data.meetups : keep ? [meetup, ...rest] : rest });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Keeps friends and meetups fresh on a slow timer while the app is open, and right away when it comes back
 * to the front. Nothing is fetched while the phone is in a pocket.
 */
export function useSocial(owner: string | null) {
  const current = useSyncExternalStore(subscribe, () => data, () => data);

  useEffect(() => {
    if (!owner) return;
    void refreshSocial(owner);
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refreshSocial(owner);
    }, REFRESH_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshSocial(owner);
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [owner]);

  const mine = !!owner && current.owner === owner;
  const friends = mine ? current.friends : noFriends;
  const meetups = mine ? current.meetups : [];
  const campus = mine ? current.campus : [];
  const waiting = friends.incoming.length + meetups.filter((m) => m.yourStatus === 'invited').length;
  return { friends, meetups, campus, waiting, loading: current.loading, refresh: () => owner && refreshSocial(owner) };
}
