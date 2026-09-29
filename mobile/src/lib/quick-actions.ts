import * as QuickActions from 'expo-quick-actions';
import { Platform } from 'react-native';

import { getPlace } from '@/data/campus';
import { findUpcoming, formatClock, type ClassEntry } from '@/lib/schedule';

// iOS draws SF Symbols; Android shortcuts show the app icon, so they go without.
const icon = (symbol: string) => (Platform.OS === 'ios' ? `symbol:${symbol}` : null);

/**
 * The menu from holding the app icon: directions to the next class, places opened lately, and the two screens
 * people jump to most. Kept to four, the most iOS shows.
 */
export function updateQuickActions(classes: ClassEntry[], recent: string[]) {
  const items: QuickActions.Action[] = [];
  const next = findUpcoming(classes, new Date());
  const nextPlace = next ? getPlace(next.entry.placeId) : undefined;
  if (next && nextPlace) {
    items.push({
      id: 'next-class',
      title: `Directions to ${nextPlace.name}`,
      subtitle: `${next.entry.name} · ${formatClock(next.entry.start)}`,
      icon: icon('figure.walk'),
      params: { href: '/', placeId: nextPlace.id, room: next.entry.room },
    });
  }
  for (const id of recent) {
    const place = getPlace(id);
    if (!place || place.id === nextPlace?.id || items.length >= 2) continue;
    items.push({ id: `place-${place.id}`, title: place.name, subtitle: 'Recent', icon: icon('mappin.and.ellipse'), params: { href: `/place/${place.id}` } });
  }
  items.push({ id: 'search', title: 'Search', icon: icon('magnifyingglass'), params: { href: '/search' } });
  items.push({ id: 'classes', title: 'My classes', icon: icon('calendar'), params: { href: '/classes' } });
  void QuickActions.setItems(items.slice(0, 4)).catch(() => undefined);
}
