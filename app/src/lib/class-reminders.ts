import { getPlace } from "@/data/campus";
import { WALK_SPEED_MPS } from "@/lib/geo";
import { DAYS, classesOn, formatClock, type ClassEntry } from "@/lib/schedule";

export const REMINDER_LEADS = [10, 15, 30] as const;
export type ReminderLead = (typeof REMINDER_LEADS)[number];

const BUFFER_MINUTES = 3;
const MINUTES_IN_DAY = 24 * 60;
export const MINUTES_IN_WEEK = 7 * MINUTES_IN_DAY;

export type ClassReminder = {
  id: string;
  /** Minutes from Monday at midnight, when the reminder goes off every week. */
  minuteOfWeek: number;
  title: string;
  body: string;
  placeId: string;
  room: string;
};

export function isReminderLead(value: unknown): value is ReminderLead {
  return (REMINDER_LEADS as readonly unknown[]).includes(value);
}

/** Minutes from Monday at midnight, matching `minuteOfWeek`. */
export function minuteOfWeek(date: Date) {
  return ((date.getDay() + 6) % 7) * MINUTES_IN_DAY + date.getHours() * 60 + date.getMinutes();
}

// Straight after a class, the walk from it decides the time; never during it, and never later than `lead` before the start.
export function classReminders(
  classes: ClassEntry[],
  lead: ReminderLead,
  walkMeters: (fromPlaceId: string, toPlaceId: string) => number | null,
): ClassReminder[] {
  const reminders: ClassReminder[] = [];
  DAYS.forEach((day, dayIndex) => {
    const list = classesOn(classes, day);
    list.forEach((entry, index) => {
      const before = index > 0 ? list[index - 1] : undefined;
      const previous = before && before.end <= entry.start ? before : undefined;
      const meters = previous && previous.placeId !== entry.placeId ? walkMeters(previous.placeId, entry.placeId) : null;
      const walk = meters === null ? null : Math.max(1, Math.round(meters / WALK_SPEED_MPS / 60));
      const at = Math.max(entry.start - Math.max(lead, (walk ?? 0) + BUFFER_MINUTES), previous?.end ?? -Infinity);
      if (at >= entry.start) return;

      const place = getPlace(entry.placeId);
      const where = `${entry.placeId}-${entry.room}`;
      const starts = formatClock(entry.start);
      reminders.push({
        id: `${entry.id}-${day}`,
        minuteOfWeek: (((dayIndex * MINUTES_IN_DAY + at) % MINUTES_IN_WEEK) + MINUTES_IN_WEEK) % MINUTES_IN_WEEK,
        title: walk !== null && previous ? `Time to head to ${entry.name}` : `${entry.name} at ${starts}`,
        body:
          walk !== null && previous
            ? `${where} at ${starts} · ${walk} min walk from ${previous.placeId}`
            : `${where}${place ? ` in ${place.name}` : ""} · Tap for directions`,
        placeId: entry.placeId,
        room: entry.room,
      });
    });
  });
  return reminders;
}
