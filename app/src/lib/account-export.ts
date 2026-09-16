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
  notifications?: { endpoint: string; createdAt: string }[];
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

export function withLocalClasses(data: AccountExport): AccountExport {
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
  return `${p.displayName} (@${p.username})`;
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
  const meetups = (data.meetups ?? []) as { id?: string; note?: string; title?: string; yourRole?: string; yourStatus?: string }[];
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
    <li>Name: ${escapeHtml(data.account.displayName || "—")}</li>
    <li>Username: ${escapeHtml(data.account.username ? `@${data.account.username}` : "—")}</li>
    ${data.account.createdAt ? `<li>Created: ${escapeHtml(data.account.createdAt)}</li>` : ""}
    ${data.account.lastLoginAt ? `<li>Last sign in: ${escapeHtml(data.account.lastLoginAt)}</li>` : ""}
  </ul>
  <h2>Sessions on your devices</h2>
  ${list(sessions.map((s) => `Signed in ${s.createdAt}, last seen ${s.lastSeenAt}, expires ${s.expiresAt}`))}
  <h2>Friends</h2>
  ${list(friends.map((f) => `${person(f)}, friends since ${f.since}`))}
  <h2>Friend requests you received</h2>
  ${list(incoming.map((f) => `${person(f)}, ${f.sentAt}`))}
  <h2>Friend requests you sent</h2>
  ${list(outgoing.map((f) => `${person(f)}, ${f.sentAt}`))}
  <h2>People you blocked</h2>
  ${list(blocked.map(person))}
  <h2>Meetups</h2>
  ${list(meetups.map((m) => {
    const label = m.title || m.note || m.id || "Meetup";
    return `${label}${m.yourRole ? ` · ${m.yourRole}` : ""}${m.yourStatus ? ` · ${m.yourStatus}` : ""}`;
  }))}
  <h2>Notification devices</h2>
  ${list(notifications.map((n) => `${n.endpoint} · added ${n.createdAt}`))}
  <h2>Classes on this device</h2>
  ${list(classes.map((c) => `${c.name} · ${c.place} ${c.room} · ${c.days} ${c.start}–${c.end}`))}
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
