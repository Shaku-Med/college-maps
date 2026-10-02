import * as Notifications from 'expo-notifications';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { getPhonePrefs } from '@/lib/notifications';
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

function waitingCount(social: Social) {
  return social.friends.incoming.length + social.meetups.filter((m) => m.yourStatus === 'invited').length;
}

// The icon badge is what still needs an answer: friend requests and meetup invites.
function syncBadge(count: number) {
  if (Platform.OS === 'web') return;
  void Notifications.setBadgeCountAsync(getPhonePrefs().badge ? count : 0).catch(() => undefined);
}

// One shared refresher for friends and meetups, run again on foreground and on every notification.
let polling: { owner: string; users: number; stop: () => void } | null = null;

function startPolling(owner: string) {
  if (polling?.owner === owner) {
    polling.users++;
    return;
  }
  polling?.stop();
  void refreshSocial(owner);
  const timer = setInterval(() => {
    if (AppState.currentState === 'active') void refreshSocial(owner);
  }, REFRESH_MS);
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') void refreshSocial(owner);
  });
  const received = Notifications.addNotificationReceivedListener(() => void refreshSocial(owner));
  const stopBadge = (() => {
    const listener = () => {
      if (data.owner === owner && !data.loading) syncBadge(waitingCount(data));
    };
    listeners.add(listener);
    return () => void listeners.delete(listener);
  })();
  polling = {
    owner,
    users: 1,
    stop: () => {
      clearInterval(timer);
      appState.remove();
      received.remove();
      stopBadge();
    },
  };
}

function stopPolling(owner: string) {
  if (polling?.owner !== owner) return;
  polling.users--;
  if (polling.users > 0) return;
  polling.stop();
  polling = null;
}

/** Friends and meetups for the signed in user, kept fresh quietly in the background. */
export function useSocial(owner: string | null) {
  const current = useSyncExternalStore(subscribe, () => data, () => data);

  useEffect(() => {
    if (!owner) return;
    startPolling(owner);
    return () => stopPolling(owner);
  }, [owner]);

  const mine = !!owner && current.owner === owner;
  const friends = mine ? current.friends : noFriends;
  const meetups = mine ? current.meetups : [];
  const campus = mine ? current.campus : [];
  const waiting = friends.incoming.length + meetups.filter((m) => m.yourStatus === 'invited').length;
  return { friends, meetups, campus, waiting, loading: current.loading, refresh: () => owner && refreshSocial(owner) };
}
