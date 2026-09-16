import { CAMPUS, getPlace } from "@/data/campus";
import { isValidRoom, roomFromMatch, type RoomMatch } from "@/lib/search";

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];

export const DAY_SHORT: Record<Day, string> = {
  mon: "Mo",
  tue: "Tu",
  wed: "We",
  thu: "Th",
  fri: "Fr",
  sat: "Sa",
  sun: "Su",
};

export type ClassEntry = {
  id: string;
  name: string;
  placeId: string;
  room: string;
  days: Day[];
  start: number;
  end: number;
};

export type NewClass = Omit<ClassEntry, "id">;

export const MAX_CLASSES = 25;
export const MAX_CLASS_NAME = 40;
const STORAGE_KEY = "csi-map:schedule:v1";
const MINUTES_IN_DAY = 24 * 60;
const JS_DAY_TO_KEY: Day[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function isDay(value: unknown): value is Day {
  return typeof value === "string" && (DAYS as readonly string[]).includes(value);
}

function isMinute(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < MINUTES_IN_DAY;
}

export function validateClass(input: unknown): NewClass | null {
  if (typeof input !== "object" || input === null) return null;
  const c = input as Record<string, unknown>;

  const name =
    typeof c.name === "string"
      ? c.name
          .replace(/[\u0000-\u001f]/g, "")
          .trim()
          .slice(0, MAX_CLASS_NAME)
      : "";
  const place = getPlace(c.placeId);
  const room = typeof c.room === "string" ? c.room.toUpperCase() : "";
  const days = Array.isArray(c.days) ? [...new Set(c.days.filter(isDay))] : [];

  if (!name || !place?.isBuilding || !isValidRoom(room)) return null;
  if (days.length === 0 || !isMinute(c.start) || !isMinute(c.end) || c.end <= c.start) return null;

  return { name, placeId: place.id, room, days: DAYS.filter((d) => days.includes(d)), start: c.start, end: c.end };
}

export function loadSchedule(): ClassEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > 50_000) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, MAX_CLASSES)
      .flatMap((item) => {
        const valid = validateClass(item);
        const id = (item as { id?: unknown })?.id;
        return valid && typeof id === "string" && /^[a-z0-9-]{1,40}$/.test(id) ? [{ ...valid, id }] : [];
      })
      .sort((a, b) => a.start - b.start);
  } catch {
    return [];
  }
}

export function saveSchedule(classes: ClassEntry[]): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(classes.slice(0, MAX_CLASSES)));
    return true;
  } catch {
    return false;
  }
}

export function clearSchedule() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode can throw; the in-memory list is still cleared by the caller.
  }
}

export function newClassId(): string {
  return crypto.randomUUID();
}

export function parseTimeInput(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return isMinute(minutes) ? minutes : null;
}

export function toTimeInput(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function formatClock(minutes: number): string {
  const normalized = ((minutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function formatDays(days: Day[]): string {
  return days.map((day) => DAY_SHORT[day]).join(" ");
}

export function dayKey(date: Date): Day {
  return JS_DAY_TO_KEY[date.getDay()];
}

export function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function classesOn(classes: ClassEntry[], day: Day): ClassEntry[] {
  return classes.filter((c) => c.days.includes(day)).sort((a, b) => a.start - b.start);
}

export type UpcomingClass = { entry: ClassEntry; daysAhead: number; previous?: ClassEntry };

export function findUpcoming(classes: ClassEntry[], now: Date): UpcomingClass | undefined {
  const minutes = minutesOfDay(now);
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    const list = classesOn(classes, dayKey(date));
    const index = list.findIndex((c) => offset > 0 || c.end > minutes);
    if (index !== -1)
      return { entry: list[index], daysAhead: offset, previous: index > 0 ? list[index - 1] : undefined };
  }
  return undefined;
}

const DAY_TOKENS: Record<string, Day> = { mo: "mon", tu: "tue", we: "wed", th: "thu", fr: "fri", sa: "sat", su: "sun" };
const COURSE = /\b([A-Z]{2,4})\s?(\d{3}[A-Z]?)\b/;
const DAYS_PATTERN = /\b((?:Mo|Tu|We|Th|Fr|Sa|Su){1,7})\b/;
const TIME_RANGE = /(\d{1,2}):(\d{2})\s*([AP]M)\s*-\s*(\d{1,2}):(\d{2})\s*([AP]M)/i;

function to24h(hour: string, minute: string, meridiem: string): number {
  const h = Number(hour) % 12;
  return (meridiem.toUpperCase() === "PM" ? h + 12 : h) * 60 + Number(minute);
}

function findRoom(block: string): RoomMatch | undefined {
  const scan = new RegExp(CAMPUS.rooms.scanPattern.source, "gi");
  for (let match = scan.exec(block); match; match = scan.exec(block)) {
    const room = roomFromMatch(match.groups);
    if (room) return room;
  }
  return undefined;
}

// Best effort for text copied from a student portal's class schedule. Each class is found by its course code,
// then the nearest days, time range, and room code (using rooms.pattern from campus.json) that follow it.
export function parseScheduleText(text: string): NewClass[] {
  const clean = text.slice(0, 20_000).replace(/\r/g, "");
  const starts: number[] = [];
  const global = new RegExp(COURSE.source, "g");
  for (let match = global.exec(clean); match; match = global.exec(clean)) starts.push(match.index);

  const found: NewClass[] = [];
  const seen = new Set<string>();
  starts.forEach((start, i) => {
    const block = clean.slice(start, starts[i + 1] ?? clean.length);
    const course = COURSE.exec(block);
    const days = DAYS_PATTERN.exec(block);
    const time = TIME_RANGE.exec(block);
    const room = findRoom(block.replace(COURSE, ""));
    if (!course || !days || !time || !room) return;

    const candidate = validateClass({
      name: `${course[1]} ${course[2]}`,
      placeId: room.place.id,
      room: room.room,
      days: (days[1].match(/Mo|Tu|We|Th|Fr|Sa|Su/g) ?? []).map((token) => DAY_TOKENS[token.toLowerCase()]),
      start: to24h(time[1], time[2], time[3]),
      end: to24h(time[4], time[5], time[6]),
    });
    const key = candidate ? `${candidate.name}|${candidate.days.join()}|${candidate.start}` : "";
    if (candidate && !seen.has(key) && found.length < MAX_CLASSES) {
      seen.add(key);
      found.push(candidate);
    }
  });
  return found;
}
