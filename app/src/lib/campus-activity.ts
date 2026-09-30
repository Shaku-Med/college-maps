import { getPlace } from "@/data/campus";
import type { Meetup } from "@/lib/social-api";

export type CampusPlaceActivity = {
  placeId: string;
  count: number;
  events: Meetup[];
};

/** Group live public campus events by building/place for the map heat layer. */
export function campusActivityByPlace(campus: readonly Meetup[]): CampusPlaceActivity[] {
  const byPlace = new Map<string, Meetup[]>();
  for (const meetup of campus) {
    if (!meetup.active) continue;
    const placeId = meetup.destination?.kind === "place" ? meetup.destination.placeId : undefined;
    if (!placeId || !getPlace(placeId)) continue;
    const list = byPlace.get(placeId) ?? [];
    list.push(meetup);
    byPlace.set(placeId, list);
  }
  return [...byPlace.entries()]
    .map(([placeId, events]) => ({
      placeId,
      count: events.length,
      events: [...events].sort((a, b) => {
        const aStart = a.startsAt ? new Date(a.startsAt).getTime() : 0;
        const bStart = b.startsAt ? new Date(b.startsAt).getTime() : 0;
        return aStart - bStart;
      }),
    }))
    .sort((a, b) => b.count - a.count);
}

export function eventsAtPlace(campus: readonly Meetup[], placeId: string): Meetup[] {
  return campusActivityByPlace(campus).find((row) => row.placeId === placeId)?.events ?? [];
}
