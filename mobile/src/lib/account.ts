import { useSyncExternalStore } from 'react';

import { accountApi, apiCall, type AccountUser } from '@/lib/api';
import { disableNotifications, syncNotifications } from '@/lib/notifications';
import { clearToken, readToken, saveToken } from '@/lib/session';

export type AccountState =
  | { status: 'loading' }
  | { status: 'unreachable' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: AccountUser };

let state: AccountState = { status: 'loading' };
const listeners = new Set<() => void>();

function set(next: AccountState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Checks the saved session with the server. A session the server no longer knows is forgotten. */
export async function refreshAccount() {
  if (!(await readToken())) {
    set({ status: 'signed-out' });
    return;
  }
  const res = await accountApi.me();
  if (res.ok) {
    set({ status: 'signed-in', user: res.data });
    void syncNotifications();
  } else if (res.status === 401) {
    await clearToken();
    set({ status: 'signed-out' });
  } else if (state.status !== 'signed-in') {
    // Offline keeps the session: it is checked again next time.
    set({ status: 'unreachable' });
  }
}

export async function completeSignIn(token: string, user: AccountUser) {
  await saveToken(token);
  set({ status: 'signed-in', user });
  void syncNotifications();
}

export function setAccountUser(user: AccountUser) {
  set({ status: 'signed-in', user });
}

/** Signs out on the server when it can, and always on this phone. */
export async function signOut({ everywhere = false } = {}) {
  // Notifications stop before the session does: this phone's, or on every phone when signing out everywhere.
  if (everywhere) await apiCall<void>('/v1/push/app-tokens', 'DELETE', { all: true });
  else await disableNotifications().catch(() => undefined);
  const res = everywhere ? await accountApi.signOutEverywhere() : await accountApi.signOut();
  if (everywhere && !res.ok && res.status !== 401) return res;
  await clearToken();
  set({ status: 'signed-out' });
  return res;
}

export async function deleteAccount() {
  const res = await accountApi.deleteAccount();
  if (!res.ok) return res;
  await clearToken();
  set({ status: 'signed-out' });
  return res;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useAccount() {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** The signed in user once their profile is set up, which is when friends and meetups open up. */
export function useProfile() {
  const account = useAccount();
  return account.status === 'signed-in' && !account.user.needsProfile ? account.user : null;
}
