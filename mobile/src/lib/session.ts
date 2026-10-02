import * as SecureStore from 'expo-secure-store';

// In the iOS keychain, readable only by this app once the phone has been unlocked since it started.
const TOKEN_KEY = 'csimap.session';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let token: string | null | undefined;

export async function readToken() {
  if (token !== undefined) return token;
  try {
    const saved = await SecureStore.getItemAsync(TOKEN_KEY, OPTIONS);
    token = saved && TOKEN_PATTERN.test(saved) ? saved : null;
  } catch {
    token = null;
  }
  return token;
}

export async function saveToken(next: string) {
  if (!TOKEN_PATTERN.test(next)) throw new Error('Unexpected session token');
  token = next;
  await SecureStore.setItemAsync(TOKEN_KEY, next, OPTIONS);
}

export async function clearToken() {
  token = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY, OPTIONS).catch(() => undefined);
}
