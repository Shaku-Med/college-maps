// A friendly, optional rest on a walk with time to spare, shared by the web app and the phone app.
import { AMENITY_KINDS, AMENITY_PLACES, type AmenityKind, type AmenityPlace } from "@/data/amenities";
import { distanceMeters, WALK_SPEED_MPS } from "@/lib/geo";
import { firstName } from "@/lib/greeting";
import { progressAtDistance, type Route, type RouteProgress } from "@/lib/routing";
import { classesOn, dayKey, formatClock, minutesOfDay, type ClassEntry } from "@/lib/schedule";

const MINUTE = 60_000;
// Asked only once someone has been walking a little while, never right after they set off or just before they arrive.
const MIN_WALKED_SECONDS = 120;
const MIN_LEFT_METERS = 150;
// Somewhere to sit within this of the way, a short way ahead, so the break costs a few steps, not a detour.
const SEAT_OFF_ROUTE_METERS = 35;
const SEAT_AHEAD = { from: 15, to: 120, every: 8 };
const SEAT_LOOK_METERS = 180;
// What is still left over after the break, so a slow last stretch does not make them late.
const SPARE_CUSHION_SECONDS = 180;
const MAX_BREAK_MINUTES = 5;
const SEAT_KINDS: AmenityKind[] = ["bench", "picnic"];
const ARRIVE_IN_MINUTES = [10, 15, 20, 30, 45, 60];
// A class this soon at the place being walked to is what "be there by" means, unless picked otherwise.
const CLASS_SOON_MINUTES = 180;

const clockAt = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** When the next class at this place starts today, as a time, or undefined when there is none soon. */
export function classStartAt(placeId: string, classes: ClassEntry[], now: number) {
  const date = new Date(now);
  const minutes = minutesOfDay(date);
  const entry = classesOn(classes, dayKey(date)).find(
    (c) => c.placeId === placeId && c.start > minutes && c.start - minutes <= CLASS_SOON_MINUTES,
  );
  if (!entry) return undefined;
  const start = new Date(date);
  start.setHours(Math.floor(entry.start / 60), entry.start % 60, 0, 0);
  return { at: start.getTime(), label: `${entry.name} at ${formatClock(entry.start)}` };
}

export type ArriveChoice = { id: string; label: string; at: number | null };

/** What "be there by" can be set to before a walk: the class there when there is one, a few times from now, or no rush. */
export function arriveChoices(now: number, classStart?: { at: number; label: string }): ArriveChoice[] {
  return [
    ...(classStart ? [{ id: "class", label: classStart.label, at: classStart.at }] : []),
    { id: "none", label: "No rush", at: null },
    ...ARRIVE_IN_MINUTES.map((n) => ({ id: `in${n}`, label: n < 60 ? `In ${n} min` : "In 1 hour", at: now + n * MINUTE })),
  ];
}

/** How a chosen time reads once picked, like "By 10:10 AM". */
export const arriveLabel = (at: number | null) => (at === null ? "No rush" : `By ${clockAt(at)}`);

export type BreakOffer = {
  spot: AmenityPlace;
  /** Where along the route the seat is nearest, so the offer can lapse once it is behind. */
  along: number;
  minutes: number;
  /** Seconds to walk to the seat from here. */
  toSeat: number;
  /** The question, said and shown. */
  line: string;
};

const breakLength = (minutes: number) => (minutes === 1 ? "a minute" : `${minutes} minutes`);
const spareWords = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes <= 1) return "a minute";
  return minutes < 5 ? "a few minutes" : `about ${minutes} minutes`;
};

type Wording = { hey: string; seat: string; length: string; spare: string };
// Said a different way from trip to trip, so it sounds like a person and not a recording.
const QUESTIONS: ((w: Wording) => string)[] = [
  (w) => `${w.hey}want to sit for ${w.length}? There's a ${w.seat} just ahead, and you'd still have ${w.spare} to spare.`,
  (w) => `${w.hey}you're making good time. Feel like resting at the ${w.seat} up ahead for ${w.length}? You'd still be ${w.spare} early.`,
  (w) => `${w.hey}there's a ${w.seat} close by if you want a breather. Take ${w.length} and you'll still get there with ${w.spare} to spare.`,
  (w) => `${w.hey}no rush today. How about ${w.length} at the ${w.seat} ahead? You'd still arrive ${w.spare} early.`,
  (w) => `${w.hey}you've got a little time. Want to take ${w.length} at the ${w.seat} up ahead? You'd still have ${w.spare} left.`,
];

/** A seat just ahead worth offering, or null when there is no time to spare or nowhere to sit. Ask at most once a walk. */
export function findBreak({
  route,
  progress,
  arriveBy,
  now,
  walkedSeconds,
  displayName,
}: {
  route: Route;
  progress: RouteProgress;
  arriveBy: number;
  now: number;
  walkedSeconds: number;
  displayName?: string;
}): BreakOffer | null {
  if ((route.travel && route.travel !== "walk") || walkedSeconds < MIN_WALKED_SECONDS || progress.remaining < MIN_LEFT_METERS) {
    return null;
  }
  const spare = (arriveBy - now) / 1000 - progress.remaining / WALK_SPEED_MPS;
  if (spare < SPARE_CUSHION_SECONDS + MINUTE / 1000) return null;

  const ahead: { at: RouteProgress["point"]; along: number }[] = [];
  const end = Math.min(progress.distanceAlong + SEAT_AHEAD.to, route.distance - MIN_LEFT_METERS / 2);
  for (let along = progress.distanceAlong + SEAT_AHEAD.from; along <= end; along += SEAT_AHEAD.every) {
    ahead.push({ at: progressAtDistance(route, along).point, along });
  }
  if (ahead.length === 0) return null;

  let best: { spot: AmenityPlace; along: number; off: number; cost: number } | null = null;
  for (const spot of AMENITY_PLACES) {
    if (!SEAT_KINDS.includes(spot.amenity) || distanceMeters(progress.point, spot.coordinate) > SEAT_LOOK_METERS) continue;
    for (const sample of ahead) {
      const off = distanceMeters(sample.at, spot.coordinate);
      if (off > SEAT_OFF_ROUTE_METERS) continue;
      const cost = sample.along - progress.distanceAlong + off * 2;
      if (!best || cost < best.cost) best = { spot, along: sample.along, off, cost };
    }
  }
  if (!best) return null;

  const detour = (best.off * 2) / WALK_SPEED_MPS;
  const minutes = Math.min(MAX_BREAK_MINUTES, Math.floor((spare - detour - SPARE_CUSHION_SECONDS) / 60));
  if (minutes < 1) return null;
  const name = firstName(displayName);
  const wording: Wording = {
    hey: name ? `Hey ${name}, ` : "Hey, ",
    seat: AMENITY_KINDS[best.spot.amenity].name.toLowerCase(),
    length: breakLength(minutes),
    spare: spareWords(spare - detour - minutes * 60),
  };
  // Which wording changes from minute to minute, so two walks rarely ask the same way.
  const ask = QUESTIONS[Math.floor(now / MINUTE) % QUESTIONS.length];
  return {
    spot: best.spot,
    along: best.along,
    minutes,
    toSeat: (best.along - progress.distanceAlong + best.off) / WALK_SPEED_MPS,
    line: ask(wording),
  };
}

/** Shown and said on reaching the seat: when to head on to still be early. */
export const breakArrivalNote = (leaveBy: number) => `Take your time. Head on by ${clockAt(leaveBy)} and you'll still be early.`;
