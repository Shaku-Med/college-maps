// A short hello for someone signed in, with the class coming up, shared by the web app and the phone app.
import { getPlace, type Place } from "@/data/campus";
import { findUpcoming, formatClock, minutesOfDay, type ClassEntry } from "@/lib/schedule";

// Letters with the odd apostrophe or hyphen, like "Mohamed", "O'Neil", or "Anne-Marie"; anything else is a handle, not a name.
const NAME = /^\p{L}[\p{L}'’-]{0,29}$/u;

/** The first name to greet someone by, or undefined when their display name does not look like a name. */
export function firstName(displayName?: string) {
  const first = displayName?.trim().split(/\s+/)[0];
  return first && NAME.test(first) ? first : undefined;
}

/** "Good morning", "Good afternoon", or "Good evening" by the clock on this device, and a plain "Hi" late at night. */
export function timeOfDay(now: Date) {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Hi";
}

/** "Good morning, Mohamed", or just "Good morning" when there is no name to use. */
export function greeting(now: Date, displayName?: string) {
  const name = firstName(displayName);
  return name ? `${timeOfDay(now)}, ${name}` : timeOfDay(now);
}

export type GreetingClass = { entry: ClassEntry; place: Place; detail: string };

/** The class worth mentioning under the hello: on now, later today, or tomorrow. Anything further off can wait. */
export function classComingUp(classes: ClassEntry[], now: Date): GreetingClass | undefined {
  const upcoming = findUpcoming(classes, now);
  if (!upcoming || upcoming.daysAhead > 1) return undefined;
  const { entry, daysAhead } = upcoming;
  const place = getPlace(entry.placeId);
  if (!place) return undefined;
  const room = `Room ${entry.room} in ${entry.placeId}`;
  const onNow = daysAhead === 0 && entry.start <= minutesOfDay(now);
  const when = onNow
    ? `Happening now until ${formatClock(entry.end)}`
    : `${daysAhead === 0 ? "Today" : "Tomorrow"} at ${formatClock(entry.start)}`;
  return { entry, place, detail: `${when} · ${room}` };
}
