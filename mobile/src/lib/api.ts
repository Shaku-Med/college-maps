import { API_ORIGIN, APP_CLIENT_HEADERS } from '@/lib/config';
import { readToken } from '@/lib/session';

import type { AccountUser, ApiResult } from '../../../app/src/lib/api';

// The limits and helpers are the web app's, so both check input the same way.
export {
  CODE_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  normalizeEmail,
  normalizeUsername,
  schoolEmailProblem,
  type AccountUser,
  type ApiResult,
} from '../../../app/src/lib/api';

const OFFLINE_MESSAGE = "You're offline or the server is unreachable. Try again in a moment.";
const TIMEOUT_MS = 20_000;

// The phone's version of the web app's apiCall: the same results, but the session travels as a bearer token
// from the keychain instead of a cookie. The shared social API calls this one on the phone.
export async function apiCall<T>(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<ApiResult<T>> {
  const token = await readToken();
  const headers: Record<string, string> = { ...APP_CLIENT_HEADERS, Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit',
    });
  } catch {
    return { ok: false, status: 0, message: OFFLINE_MESSAGE };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return { ok: true, data: undefined as T };

  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, data: payload as T };

  const error = (payload as { error?: unknown } | null)?.error;
  const retry = Number(response.headers.get('Retry-After'));
  return {
    ok: false,
    status: response.status,
    message: typeof error === 'string' ? error.slice(0, 200) : 'Something went wrong. Try again.',
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
  };
}

function readUser(value: unknown): AccountUser | null {
  const user = value as Record<string, unknown> | null | undefined;
  if (!user || typeof user.email !== 'string' || typeof user.username !== 'string' || typeof user.displayName !== 'string') {
    return null;
  }
  return { email: user.email, username: user.username, displayName: user.displayName, needsProfile: user.needsProfile === true };
}

async function withUser(result: Promise<ApiResult<unknown>>): Promise<ApiResult<AccountUser>> {
  const res = await result;
  if (!res.ok) return res;
  const user = readUser((res.data as { user?: unknown } | null)?.user);
  return user ? { ok: true, data: user } : { ok: false, status: 0, message: 'Unexpected response from the server.' };
}

export const accountApi = {
  me: () => withUser(apiCall('/v1/me', 'GET')),
  requestCode: (email: string) => apiCall<{ sent: boolean }>('/v1/auth/code', 'POST', { email }),
  // The app's own verify route answers with the session token instead of setting a cookie.
  verifyCode: async (email: string, code: string): Promise<ApiResult<{ user: AccountUser; token: string }>> => {
    const res = await apiCall<{ user?: unknown; token?: unknown }>('/v1/app/auth/verify', 'POST', { email, code });
    if (!res.ok) return res;
    const user = readUser(res.data.user);
    const token = res.data.token;
    return user && typeof token === 'string'
      ? { ok: true, data: { user, token } }
      : { ok: false, status: 0, message: 'Unexpected response from the server.' };
  },
  updateProfile: (profile: { displayName?: string; username?: string }) => withUser(apiCall('/v1/me', 'PATCH', profile)),
  signOut: () => apiCall<void>('/v1/auth/signout', 'POST'),
  signOutEverywhere: () => apiCall<void>('/v1/auth/signout-all', 'POST'),
  deleteAccount: () => apiCall<void>('/v1/me', 'DELETE'),
};
