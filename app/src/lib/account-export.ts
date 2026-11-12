import { CAMPUS, getPlace } from "@/data/campus";
import { formatClock, formatDays, loadSchedule, type ClassEntry } from "@/lib/schedule";

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
  notifications?: { service: string; createdAt: string }[];
  notStored: string[];
  classes?: { name: string; place: string; room: string; days: string; start: string; end: string }[];
};

export type ExportFormat = "json" | "html" | "pdf";

function fileStamp(iso: string) {
  return iso.slice(0, 10);
}

function fileBase(exportedAt: string) {
  const name = CAMPUS.app.shortName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "campus-map";
  return `${name}-data-${fileStamp(exportedAt)}`;
}

type Fields = Record<string, unknown>;

// The export is read field by field, so a missing or renamed field shows as a dash instead of "undefined".
const text = (value: unknown) => (typeof value === "string" ? value : "");
const shown = (value: string | undefined) => value || "—";
const fields = (value: unknown): Fields => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : {});
const rows = (value: unknown): Fields[] => (Array.isArray(value) ? value.map(fields) : []);
const who = (p: Fields) => ({ username: text(p.username), displayName: text(p.displayName) });

export function withLocalClasses(raw: AccountExport): AccountExport {
  const data = fields(raw);
  const account = fields(data.account);
  const friends = fields(data.friends);
  return {
    ...raw,
    exportedAt: text(data.exportedAt) || new Date().toISOString(),
    account: {
      email: text(account.email),
      username: text(account.username),
      displayName: text(account.displayName),
      createdAt: text(account.createdAt) || undefined,
      lastLoginAt: text(account.lastLoginAt) || undefined,
    },
    sessions: rows(data.sessions).map((s) => ({ createdAt: text(s.createdAt), lastSeenAt: text(s.lastSeenAt), expiresAt: text(s.expiresAt) })),
    friends: {
      friends: rows(friends.friends).map((f) => ({ ...who(f), since: text(f.since) })),
      incoming: rows(friends.incoming).map((f) => ({ ...who(f), sentAt: text(f.sentAt) })),
      outgoing: rows(friends.outgoing).map((f) => ({ ...who(f), sentAt: text(f.sentAt) })),
      blocked: rows(friends.blocked).map(who),
    },
    meetups: rows(data.meetups),
    notifications: rows(data.notifications).map((n) => ({ service: text(n.service), createdAt: text(n.createdAt) })),
    notStored: Array.isArray(data.notStored) ? data.notStored.filter((line): line is string => typeof line === "string") : [],
    classes: loadSchedule().map((entry) => classLine(entry)),
  };
}

function classLine(entry: ClassEntry) {
  return {
    name: entry.name,
    place: getPlace(entry.placeId)?.name ?? entry.placeId,
    room: entry.room,
    days: formatDays(entry.days),
    start: formatClock(entry.start),
    end: formatClock(entry.end),
  };
}

function downloadBlob(filename: string, mime: string, contents: string) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function person(p: { username: string; displayName: string }) {
  return p.username ? `${shown(p.displayName)} (@${p.username})` : shown(p.displayName);
}

function list(items: string[]) {
  if (items.length === 0) return "<p>None</p>";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

export function exportHtml(data: AccountExport) {
  const title = `${CAMPUS.app.name} data export`;
  const friends = data.friends?.friends ?? [];
  const incoming = data.friends?.incoming ?? [];
  const outgoing = data.friends?.outgoing ?? [];
  const blocked = data.friends?.blocked ?? [];
  const classes = data.classes ?? [];
  const sessions = data.sessions ?? [];
  const meetups = rows(data.meetups);
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
  <p class="meta">Exported ${escapeHtml(shown(data.exportedAt))}</p>
  <h2>Account</h2>
  <ul>
    <li>Email: ${escapeHtml(shown(data.account.email))}</li>
    <li>Name: ${escapeHtml(data.account.displayName || "—")}</li>
    <li>Username: ${escapeHtml(data.account.username ? `@${data.account.username}` : "—")}</li>
    ${data.account.createdAt ? `<li>Created: ${escapeHtml(data.account.createdAt)}</li>` : ""}
    ${data.account.lastLoginAt ? `<li>Last sign in: ${escapeHtml(data.account.lastLoginAt)}</li>` : ""}
  </ul>
  <h2>Sessions on your devices</h2>
  ${list(sessions.map((s) => `Signed in ${shown(s.createdAt)}, last seen ${shown(s.lastSeenAt)}, expires ${shown(s.expiresAt)}`))}
  <h2>Friends</h2>
  ${list(friends.map((f) => `${person(f)}, friends since ${shown(f.since)}`))}
  <h2>Friend requests you received</h2>
  ${list(incoming.map((f) => `${person(f)}, ${shown(f.sentAt)}`))}
  <h2>Friend requests you sent</h2>
  ${list(outgoing.map((f) => `${person(f)}, ${shown(f.sentAt)}`))}
  <h2>People you blocked</h2>
  ${list(blocked.map(person))}
  <h2>Meetups</h2>
  ${list(meetups.map((m) => {
    const label = text(m.title) || text(m.note) || "Meetup";
    const role = text(m.yourRole);
    const status = text(m.yourStatus);
    return `${label}${role ? ` · ${role}` : ""}${status ? ` · ${status}` : ""}`;
  }))}
  <h2>Notification devices</h2>
  ${list(notifications.map((n) => `${shown(n.service)} · added ${shown(n.createdAt)}`))}
  <h2>Classes on this device</h2>
  ${list(classes.map((c) => `${shown(c.name)} · ${shown(c.place)} ${c.room} · ${c.days} ${c.start}–${c.end}`))}
  <h2>What we never store</h2>
  ${list(data.notStored ?? [])}
</body>
</html>`;
}

export function saveExport(data: AccountExport, format: ExportFormat) {
  const packed = withLocalClasses(data);
  const base = fileBase(packed.exportedAt);
  if (format === "json") {
    downloadBlob(`${base}.json`, "application/json", JSON.stringify(packed, null, 2));
    return;
  }
  const html = exportHtml(packed);
  if (format === "html") {
    downloadBlob(`${base}.html`, "text/html;charset=utf-8", html);
    return;
  }
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) throw new Error("Allow popups to save a PDF, or download HTML and print it.");
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
}
