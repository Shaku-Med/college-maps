import { router } from 'expo-router';

import { socialApi, type Meetup } from '@/lib/social-api';

export const REPORT_REASONS = [
  { id: 'spam', label: 'Spam or fake account' },
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'inappropriate', label: 'Inappropriate behavior' },
  { id: 'other', label: 'Something else' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

export function reasonLabel(id: string) {
  return REPORT_REASONS.find((reason) => reason.id === id)?.label ?? 'Something else';
}

export type ReportTarget = {
  kind?: 'user' | 'meetup';
  username: string;
  displayName: string;
  isFriend?: boolean;
  meetupId?: string;
};

/** Opens the report reason page for another student. */
export function reportPerson(person: ReportTarget) {
  router.push({
    pathname: '/report-reason',
    params: {
      kind: 'user',
      username: person.username,
      name: person.displayName,
      friend: person.isFriend ? '1' : '0',
    },
  });
}

/** Opens the report reason page for a campus event. */
export function reportMeetup(meetup: Meetup) {
  router.push({
    pathname: '/report-reason',
    params: {
      kind: 'meetup',
      meetupId: meetup.id,
      username: meetup.host.username,
      name: meetup.host.displayName,
      friend: '0',
    },
  });
}

export async function sendReport(body: {
  kind: 'meetup' | 'user';
  meetupId?: string;
  username?: string;
  reason: ReportReason;
  details?: string;
}) {
  const { apiCall } = await import('@/lib/api');
  const res = await apiCall<void>('/v1/reports', 'POST', body);
  if (!res.ok && res.status === 404) {
    return {
      ...res,
      message: 'Reporting is not available on the server yet. Deploy the latest API, then try again.',
    };
  }
  return res;
}

export async function blockPerson(username: string) {
  return socialApi.block(username);
}

export async function unfriendPerson(username: string) {
  return socialApi.unfriend(username);
}
