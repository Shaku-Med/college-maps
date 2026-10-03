import { getPlace } from '@/data/campus';
import { usesTabRail } from '@/hooks/use-layout';
import { getClasses } from '@/lib/classes';
import { openPlacePanel } from '@/lib/place-panel';
import { findUpcoming } from '@/lib/schedule';
import { isValidRoom } from '@/lib/search';
import { planTrip } from '@/lib/trip';

const MAX_LINK_LENGTH = 200;
const PLACE_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/;

function roomFrom(query: string) {
  for (const pair of query.split('&')) {
    const [key, value = ''] = pair.split('=', 2);
    if (key !== 'room') continue;
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Handles csimap:// links (directions/<place>?room=, next-class, classes), ignoring anything not on campus. */
export function handleAppLink(path: string): string | null {
  if (path.length > MAX_LINK_LENGTH) return null;
  // Hand parsed: React Native's URL leaves most of the standard out.
  const [rest, query = ''] = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('?', 2);
  const parts = rest.split('/').filter(Boolean);

  if (parts[0] === 'directions' && parts.length === 2 && PLACE_ID.test(parts[1])) {
    const place = getPlace(parts[1].toUpperCase());
    if (!place) return null;
    const room = roomFrom(query);
    planTrip(place.id, isValidRoom(room) ? room : undefined);
    return '/';
  }
  if (parts[0] === 'next-class' && parts.length === 1) {
    const next = findUpcoming(getClasses(), new Date());
    const place = next ? getPlace(next.entry.placeId) : undefined;
    if (!next || !place) return '/classes';
    planTrip(place.id, next.entry.room);
    return '/';
  }
  if (parts[0] === 'classes' && parts.length === 1) return '/classes';
  if (parts[0] === 'place' && parts.length === 2 && PLACE_ID.test(parts[1]) && usesTabRail()) {
    const place = getPlace(parts[1].toUpperCase());
    if (!place) return null;
    const room = roomFrom(query);
    openPlacePanel(place.id, isValidRoom(room) ? room : undefined);
    return '/';
  }
  return null;
}
