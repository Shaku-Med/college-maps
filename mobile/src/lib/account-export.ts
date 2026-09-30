import { Share } from 'react-native';

import { CAMPUS, getPlace } from '@/data/campus';
import { apiCall } from '@/lib/api';
import { getClasses } from '@/lib/classes';
import { formatClock, formatDays } from '@/lib/schedule';

export type AccountExport = {
  exportedAt: string;
  account: {
    email: string;
    username: string;
    displayName: string;
    createdAt?: string;
    lastLoginAt?: string;
  };
  sessions: { createdAt: string; lastSeenAt: string; expiresAt: string }[];
  friends?: {
    friends?: { username: string; displayName: string; since: string }[];
    incoming?: { username: string; displayName: string; sentAt: string }[];
    outgoing?: { username: string; displayName: string; sentAt: string }[];
    blocked?: { username: string; displayName: string }[];
  };
  meetups: unknown[];
  notifications?: { endpoint: string; createdAt: string }[];
  notStored: string[];
  classes?: { name: string; place: string; room: string; days: string; start: string; end: string }[];
};

export type ExportFormat = 'json' | 'html' | 'txt' | 'pdf';

export const EXPORT_OPTIONS: { id: ExportFormat; title: string; description: string; symbol: 'curlybraces' | 'doc.richtext' | 'doc.plaintext' | 'doc' }[] = [
  { id: 'json', title: 'JSON', description: 'Raw data for backups or other tools', symbol: 'curlybraces' },
  { id: 'html', title: 'HTML', description: 'A readable page you can save or open', symbol: 'doc.richtext' },
  { id: 'txt', title: 'Plain text', description: 'Simple text you can paste anywhere', symbol: 'doc.plaintext' },
  { id: 'pdf', title: 'PDF', description: 'Share, then choose Print and Save as PDF', symbol: 'doc' },
];

function withLocalClasses(data: AccountExport): AccountExport {
  return {
    ...data,
    exportedAt: data.exportedAt || new Date().toISOString(),
    friends: {
      friends: data.friends?.friends ?? [],
      incoming: data.friends?.incoming ?? [],
      outgoing: data.friends?.outgoing ?? [],
      blocked: data.friends?.blocked ?? [],
    },
    sessions: data.sessions ?? [],
    meetups: data.meetups ?? [],
    notifications: data.notifications ?? [],
    notStored: data.notStored ?? [],
    classes: getClasses().map((entry) => ({
      name: entry.name,
      place: getPlace(entry.placeId)?.name ?? entry.placeId,
      room: entry.room,
      days: formatDays(entry.days),
      start: formatClock(entry.start),
      end: formatClock(entry.end),
    })),
  };
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function person(p: { username: string; displayName: string }) {
  return `${p.displayName} (@${p.username})`;
}

function listHtml(items: string[]) {
  if (items.length === 0) return '<p>None</p>';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function listText(items: string[]) {
  if (items.length === 0) return 'None';
  return items.map((item) => `- ${item}`).join('\n');
}

function meetupLines(data: AccountExport) {
  const meetups = (data.meetups ?? []) as { id?: string; note?: string; title?: string; yourRole?: string; yourStatus?: string }[];
  return meetups.map((m) => {
    const label = m.title || m.note || m.id || 'Meetup';
    return `${label}${m.yourRole ? ` · ${m.yourRole}` : ''}${m.yourStatus ? ` · ${m.yourStatus}` : ''}`;
  });
}

export function exportHtml(data: AccountExport) {
  const title = `${CAMPUS.app.name} data export`;
  const friends = data.friends?.friends ?? [];
  const incoming = data.friends?.incoming ?? [];
  const outgoing = data.friends?.outgoing ?? [];
  const blocked = data.friends?.blocked ?? [];
  const classes = data.classes ?? [];
  const sessions = data.sessions ?? [];
  const notifications = data.notifications ?? [];
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.1rem; margin-top: 1.75rem; }
    p, li { color: #333; }
    .meta { color: #666; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">Exported ${escapeHtml(data.exportedAt)}</p>
  <h2>Account</h2>
  <ul>
    <li>Email: ${escapeHtml(data.account.email)}</li>
    <li>Name: ${escapeHtml(data.account.displayName || '—')}</li>
    <li>Username: ${escapeHtml(data.account.username ? `@${data.account.username}` : '—')}</li>
    ${data.account.createdAt ? `<li>Created: ${escapeHtml(data.account.createdAt)}</li>` : ''}
    ${data.account.lastLoginAt ? `<li>Last sign in: ${escapeHtml(data.account.lastLoginAt)}</li>` : ''}
  </ul>
  <h2>Sessions on your devices</h2>
  ${listHtml(sessions.map((s) => `Signed in ${s.createdAt}, last seen ${s.lastSeenAt}, expires ${s.expiresAt}`))}
  <h2>Friends</h2>
  ${listHtml(friends.map((f) => `${person(f)}, friends since ${f.since}`))}
  <h2>Friend requests you received</h2>
  ${listHtml(incoming.map((f) => `${person(f)}, ${f.sentAt}`))}
  <h2>Friend requests you sent</h2>
  ${listHtml(outgoing.map((f) => `${person(f)}, ${f.sentAt}`))}
  <h2>People you blocked</h2>
  ${listHtml(blocked.map(person))}
  <h2>Meetups</h2>
  ${listHtml(meetupLines(data))}
  <h2>Notification devices</h2>
  ${listHtml(notifications.map((n) => `${n.endpoint} · added ${n.createdAt}`))}
  <h2>Classes on this device</h2>
  ${listHtml(classes.map((c) => `${c.name} · ${c.place} ${c.room} · ${c.days} ${c.start}–${c.end}`))}
  <h2>What we never store</h2>
  ${listHtml(data.notStored ?? [])}
</body>
</html>`;
}

export function exportText(data: AccountExport) {
  const friends = data.friends?.friends ?? [];
  const incoming = data.friends?.incoming ?? [];
  const outgoing = data.friends?.outgoing ?? [];
  const blocked = data.friends?.blocked ?? [];
  const classes = data.classes ?? [];
  const sessions = data.sessions ?? [];
  const notifications = data.notifications ?? [];
  const lines = [
    `${CAMPUS.app.name} data export`,
    `Exported ${data.exportedAt}`,
    '',
    'Account',
    `Email: ${data.account.email}`,
    `Name: ${data.account.displayName || '—'}`,
    `Username: ${data.account.username ? `@${data.account.username}` : '—'}`,
    data.account.createdAt ? `Created: ${data.account.createdAt}` : '',
    data.account.lastLoginAt ? `Last sign in: ${data.account.lastLoginAt}` : '',
    '',
    'Sessions on your devices',
    listText(sessions.map((s) => `Signed in ${s.createdAt}, last seen ${s.lastSeenAt}, expires ${s.expiresAt}`)),
    '',
    'Friends',
    listText(friends.map((f) => `${person(f)}, friends since ${f.since}`)),
    '',
    'Friend requests you received',
    listText(incoming.map((f) => `${person(f)}, ${f.sentAt}`)),
    '',
    'Friend requests you sent',
    listText(outgoing.map((f) => `${person(f)}, ${f.sentAt}`)),
    '',
    'People you blocked',
    listText(blocked.map(person)),
    '',
    'Meetups',
    listText(meetupLines(data)),
    '',
    'Notification devices',
    listText(notifications.map((n) => `${n.endpoint} · added ${n.createdAt}`)),
    '',
    'Classes on this device',
    listText(classes.map((c) => `${c.name} · ${c.place} ${c.room} · ${c.days} ${c.start}–${c.end}`)),
    '',
    'What we never store',
    listText(data.notStored ?? []),
  ];
  return lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
}

function fileBase(exportedAt: string) {
  const stamp = exportedAt.slice(0, 10);
  const name = CAMPUS.app.shortName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'campus-map';
  return `${name}-data-${stamp}`;
}

/** Fetches the account export and opens the share sheet in the chosen format. */
export async function shareAccountExport(
  format: ExportFormat,
  onProgress?: (step: string) => void,
) {
  onProgress?.('Fetching your account…');
  const res = await apiCall<AccountExport>('/v1/me/export', 'GET');
  if (!res.ok) throw new Error(res.message);

  onProgress?.('Adding classes from this phone…');
  const packed = withLocalClasses(res.data);
  const base = fileBase(packed.exportedAt);
  const extension = format === 'pdf' ? 'html' : format;
  const title = `${base}.${extension}`;

  onProgress?.(
    format === 'json'
      ? 'Building JSON…'
      : format === 'txt'
        ? 'Building text…'
        : format === 'pdf'
          ? 'Building printable page…'
          : 'Building HTML…',
  );
  const message =
    format === 'json'
      ? JSON.stringify(packed, null, 2)
      : format === 'txt'
        ? exportText(packed)
        : exportHtml(packed);

  onProgress?.('Opening share sheet…');
  await Share.share({ title, message });
  return format;
}
