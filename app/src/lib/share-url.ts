export function placeUrl(placeId: string, room?: string): string {
  const url = new URL(window.location.origin);
  url.searchParams.set("place", placeId);
  if (room) url.searchParams.set("room", room);
  return url.toString();
}
