import { Linking, Share } from 'react-native';
import { router } from 'expo-router';

import type { Place } from '@/data/campus';

export const WEB_ORIGIN = 'https://csimap.vercel.app';

/** The web link for a place, the same one the web app shares, so it opens anywhere. */
export function placeLink(place: Place, room?: string) {
  const url = new URL(WEB_ORIGIN);
  url.searchParams.set('place', place.id);
  if (room) url.searchParams.set('room', room);
  return url.toString();
}

export function sharePlace(place: Place, room?: string) {
  const where = room ? `Room ${room} in ${place.name}` : place.name;
  return Share.share({ message: `${where} on CSI Map`, url: placeLink(place, room) });
}

export function openWeb(path = '/') {
  return Linking.openURL(new URL(path, WEB_ORIGIN).toString());
}

/** Switches to the map and opens the place there, from anywhere in the app. */
export function showPlace(place: Place, room?: string) {
  router.navigate('/');
  router.push({ pathname: '/place/[id]', params: room ? { id: place.id, room } : { id: place.id } });
}
