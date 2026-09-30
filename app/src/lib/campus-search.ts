import { getPlace } from "@/data/campus";
import type { Meetup } from "@/lib/social-api";

/** Match a campus event by title, place, host, or note. */
export function matchesCampusEvent(meetup: Meetup, query: string) {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return true;
  const place =
    meetup.destination?.kind === "place" ? (getPlace(meetup.destination.placeId)?.name ?? "") : "";
  return (
    (meetup.title ?? "").toLowerCase().includes(q) ||
    (meetup.note ?? "").toLowerCase().includes(q) ||
    place.toLowerCase().includes(q) ||
    meetup.host.username.toLowerCase().includes(q) ||
    meetup.host.displayName.toLowerCase().includes(q)
  );
}
