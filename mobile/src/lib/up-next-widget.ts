import { getPlace } from '@/data/campus';
import { classesOn, dayKey, type ClassEntry } from '@/lib/schedule';
import type { Meetup } from '@/lib/social-api';
import UpNext, { type UpNextProps } from '@/widgets/up-next';

type Item = Omit<UpNextProps, 'kind'> & { kind: 'meetup' | 'class' };

const HORIZON_MS = 36 * 60 * 60 * 1000;
const MAX_ENTRIES = 24;
const NOTHING: UpNextProps = { kind: 'none', title: '', detail: '', startsAt: 0, endsAt: 0 };

function meetupItem(meetup: Meetup): Item {
  const place = meetup.destination?.kind === 'place' ? getPlace(meetup.destination.placeId) : undefined;
  const host = meetup.destination?.kind === 'member' ? meetup.members.find((m) => m.username === meetup.destination?.username) : undefined;
  return {
    kind: 'meetup',
    title: meetup.title ?? (meetup.yourRole === 'host' ? 'Your meetup' : `${meetup.host.displayName}'s meetup`),
    detail: place?.name ?? (host ? `Wherever ${host.displayName} is` : 'A pin on the map'),
    startsAt: new Date(meetup.startsAt ?? meetup.createdAt).getTime(),
    endsAt: new Date(meetup.expiresAt).getTime(),
  };
}

function classItems(classes: ClassEntry[], now: Date): Item[] {
  const out: Item[] = [];
  for (let offset = 0; offset < 2; offset++) {
    const day = new Date(now);
    day.setDate(now.getDate() + offset);
    day.setHours(0, 0, 0, 0);
    for (const entry of classesOn(classes, dayKey(day))) {
      out.push({
        kind: 'class',
        title: entry.name,
        detail: `Room ${entry.placeId}-${entry.room}`,
        startsAt: day.getTime() + entry.start * 60_000,
        endsAt: day.getTime() + entry.end * 60_000,
      });
    }
  }
  return out;
}

// What the widget shows at a moment: a meetup going on, then a class going on, then whatever starts next.
function pick(items: Item[], at: number): UpNextProps {
  const live = items.filter((item) => item.startsAt <= at && item.endsAt > at);
  const now = live.find((item) => item.kind === 'meetup') ?? live[0];
  if (now) return now;
  const next = items.filter((item) => item.startsAt > at).sort((a, b) => a.startsAt - b.startsAt)[0];
  return next ?? NOTHING;
}

/**
 * Hands the home screen widget a timeline for the next day and a half, so it moves on to the next class or
 * meetup by itself, without the app running. Only meetups you are in count, never ones you were invited to.
 */
export function updateUpNextWidget(classes: ClassEntry[], meetups: Meetup[]) {
  const now = Date.now();
  const items = [
    ...meetups.filter((m) => m.active && m.yourStatus === 'joined').map(meetupItem),
    ...classItems(classes, new Date(now)),
  ].filter((item) => item.endsAt > now && item.startsAt < now + HORIZON_MS);

  const moments = new Set([now]);
  for (const item of items) {
    if (item.startsAt > now) moments.add(item.startsAt);
    if (item.endsAt > now) moments.add(item.endsAt);
  }
  const entries = [...moments]
    .sort((a, b) => a - b)
    .slice(0, MAX_ENTRIES)
    .map((at) => ({ date: new Date(at), props: pick(items, at) }));
  try {
    UpNext.updateTimeline(entries);
  } catch {
    // Widgets are an extra; an older build without the extension just has none.
  }
}
