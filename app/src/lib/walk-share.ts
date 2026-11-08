// Walk me there: a few friends watch someone's walk live until they arrive. Shared by the web and the phone app.
import { CAMPUS, PLACES, contains, type Place } from "@/data/campus";
import { MAX_WATCHERS, type Meetup, type MeetupDestination } from "@/lib/social-api";

export { MAX_WATCHERS };

const MIN_MINUTES = 15;
const MAX_MINUTES = 240;
const SITE_PLACES = new Set(PLACES.map((place) => place.id));

/** How long sharing may run: the time left with room for a slow walk, so it ends by itself if never stopped. */
export function walkMinutes(remainingSeconds: number): number {
  const minutes = Math.ceil((Math.max(0, remainingSeconds) / 60) * 1.5) + 10;
  if (!Number.isFinite(minutes)) return MIN_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes));
}

/** Where the walk goes as the server takes it: a campus place by id, any other spot on campus as a pin. */
export function walkDestination(place: Place): MeetupDestination | null {
  if (SITE_PLACES.has(place.id)) return { kind: "place", placeId: place.id };
  if (!contains(CAMPUS.map.walkingArea, place.coordinate)) return null;
  return { kind: "pin", lat: place.coordinate.latitude, lng: place.coordinate.longitude };
}

function names(list: string[]) {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function guestsWith(meetup: Meetup, status: Meetup["yourStatus"]) {
  return meetup.members.filter((m) => m.role === "guest" && m.status === status).map((m) => m.displayName || m.username);
}

/** For the walker: who is following along, or who has yet to open it. */
export function watchLine(meetup: Meetup): string {
  const watching = guestsWith(meetup, "joined");
  if (watching.length > 0) return `${names(watching)} ${watching.length === 1 ? "is" : "are"} watching`;
  const waiting = guestsWith(meetup, "invited");
  return waiting.length > 0 ? `Sent to ${names(waiting)}` : "Nobody is watching";
}

/** How a walk reads in a list. Where it goes stays hidden until the friend opens it. */
export function walkTitle(meetup: Meetup, where?: string): string {
  if (meetup.yourRole === "host") return "Sharing your walk";
  const name = meetup.host.displayName || meetup.host.username;
  if (meetup.yourStatus !== "joined" || !where) return `${name} is sharing their walk`;
  return meetup.active ? `${name} is walking to ${where}` : `${name}'s walk`;
}
