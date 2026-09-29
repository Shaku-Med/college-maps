// Home screen widgets are iOS only for now: expo-widgets has no Android side for JS yet.
import type { ClassEntry } from '@/lib/schedule';
import type { Meetup } from '@/lib/social-api';

export function updateUpNextWidget(_classes: ClassEntry[], _meetups: Meetup[]) {}
