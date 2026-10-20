"use client";

import {
  Button,
  Chip,
  CloseButton,
  Input,
  Label,
  Surface,
  TextArea,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  toast,
} from "@heroui/react";
import { AlertTriangle, CalendarClock, ChevronRight, ClipboardPaste, Navigation, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CAMPUS, getPlace, type Coordinate } from "@/data/campus";
import { CollapseButton, SheetGrabber } from "@/components/sheet-chrome";
import { distanceMeters, formatDuration, WALK_SPEED_MPS } from "@/lib/geo";
import {
  DAY_SHORT,
  DAYS,
  MAX_CLASS_NAME,
  MAX_CLASSES,
  classesOn,
  dayKey,
  findUpcoming,
  formatClock,
  formatDays,
  minutesOfDay,
  newClassId,
  parseScheduleText,
  parseTimeInput,
  validateClass,
  type ClassEntry,
  type Day,
  type NewClass,
} from "@/lib/schedule";
import { parseRoomCode } from "@/lib/search";

const BUFFER_MINUTES = 3;
const NEARBY_METERS = 2500;
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_NAMES: Record<Day, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function timeInput(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

type SchedulePanelProps = {
  classes: ClassEntry[];
  userPosition?: Coordinate;
  walkMeters: (from: Coordinate, to: Coordinate) => number | null;
  onChange: (classes: ClassEntry[]) => void;
  onDirections: (entry: ClassEntry, fromPlaceId?: string) => void;
  onCollapse: () => void;
  onClose: () => void;
};

type View = "overview" | "add" | "paste" | "edit";

function walkMinutes(meters: number) {
  return Math.max(1, Math.round(meters / WALK_SPEED_MPS / 60));
}

export function SchedulePanel({
  classes,
  userPosition,
  walkMeters,
  onChange,
  onDirections,
  onCollapse,
  onClose,
}: SchedulePanelProps) {
  const [view, setView] = useState<View>("overview");
  const [editingId, setEditingId] = useState<string>();
  const [picked, setPicked] = useState<Day>();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const upcoming = useMemo(() => findUpcoming(classes, now), [classes, now]);
  const busy = useMemo(() => new Set(DAYS.filter((day) => classesOn(classes, day).length > 0)), [classes]);
  const todayKey = dayKey(now);
  // Opens on today, or on the day of the next class when today has none.
  const firstDay = busy.has(todayKey) || !upcoming ? todayKey : DAYS[(DAYS.indexOf(todayKey) + upcoming.daysAhead) % 7];
  const day = picked ?? firstDay;
  const dayEntries = classesOn(classes, day);
  const editing = classes.find((entry) => entry.id === editingId);

  function addClasses(entries: NewClass[]) {
    const room = MAX_CLASSES - classes.length;
    if (room <= 0) {
      toast.danger(`You can save up to ${MAX_CLASSES} classes`);
      return false;
    }
    const added = entries.slice(0, room).map((entry) => ({ ...entry, id: newClassId() }));
    onChange([...classes, ...added].sort((a, b) => a.start - b.start));
    toast.success(added.length === 1 ? `Added ${added[0].name}` : `Added ${added.length} classes`);
    return true;
  }

  function removeClass(id: string) {
    const removed = classes.find((c) => c.id === id);
    onChange(classes.filter((c) => c.id !== id));
    if (removed) toast.success(`Removed ${removed.name}`);
  }

  function saveClass(id: string, entry: NewClass) {
    onChange(classes.map((c) => (c.id === id ? { ...entry, id } : c)).sort((a, b) => a.start - b.start));
    toast.success(`Saved ${entry.name}`);
  }

  function closeForm() {
    setView("overview");
    setEditingId(undefined);
  }

  return (
    <Surface
      role="region"
      aria-label="My classes"
      className="animate-sheet-in flex max-h-[82dvh] flex-col rounded-t-[28px] shadow-2xl md:max-h-[calc(100dvh-2rem)] md:rounded-3xl">
      <SheetGrabber />

      <div className="flex items-center gap-3 px-5 pb-2 pt-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
          <CalendarClock className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight">My classes</h2>
          <p className="text-xs text-muted">Saved only on this device</p>
        </div>
        <CollapseButton onCollapse={onCollapse} />
        <CloseButton aria-label="Close my classes" onPress={onClose} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,var(--map-safe-bottom))] pt-2">
        {view === "add" ? (
          <ClassForm title="Add a class" onCancel={closeForm} onSave={(entry) => addClasses([entry]) && closeForm()} />
        ) : view === "edit" && editing ? (
          <ClassForm
            title="Edit class"
            initial={editing}
            onCancel={closeForm}
            onSave={(entry) => {
              saveClass(editing.id, entry);
              closeForm();
            }}
            onDelete={() => {
              removeClass(editing.id);
              closeForm();
            }}
          />
        ) : view === "paste" ? (
          <PasteSchedule onCancel={closeForm} onImport={(entries) => addClasses(entries) && closeForm()} />
        ) : (
          <div className="flex flex-col gap-5">
            {upcoming ? (
              <NextClassCard
                upcoming={upcoming}
                now={now}
                userPosition={userPosition}
                walkMeters={walkMeters}
                onDirections={onDirections}
              />
            ) : (
              <div className="rounded-2xl bg-surface-secondary px-4 py-5">
                <p className="text-sm font-medium">Add your classes once</p>
                <p className="mt-1 text-sm text-muted">
                  {CAMPUS.app.name} will tell you when to leave, how long the walk is, and warn you when two classes are
                  too far apart.
                </p>
              </div>
            )}

            {classes.length > 0 ? (
              <section aria-labelledby="day-heading" className="flex flex-col gap-3">
                <DayPicker selected={day} today={todayKey} busy={busy} onSelect={setPicked} />
                <div>
                  <h3 id="day-heading" className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {day === todayKey ? "Today" : DAY_NAMES[day]}
                    {dayEntries.length > 0
                      ? ` · ${dayEntries.length} ${dayEntries.length === 1 ? "class" : "classes"}`
                      : ""}
                  </h3>
                  {dayEntries.length === 0 ? (
                    <p className="rounded-2xl bg-surface-secondary px-4 py-4 text-sm text-muted">
                      No classes on {DAY_NAMES[day]}.
                    </p>
                  ) : (
                    <ol className="flex flex-col">
                      {dayEntries.map((entry, index) => (
                        <li key={entry.id}>
                          {index > 0 ? <WalkGap from={dayEntries[index - 1]} to={entry} walkMeters={walkMeters} /> : null}
                          <ClassRow
                            entry={entry}
                            isPast={day === todayKey && entry.end <= minutesOfDay(now)}
                            onEdit={() => {
                              setEditingId(entry.id);
                              setView("edit");
                            }}
                          />
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </section>
            ) : null}

            <div className="flex gap-2">
              <Button variant={classes.length === 0 ? "primary" : "secondary"} className="flex-1" onPress={() => setView("add")}>
                <Plus aria-hidden />
                Add class
              </Button>
              <Button variant="secondary" className="flex-1" onPress={() => setView("paste")}>
                <ClipboardPaste aria-hidden />
                Paste schedule
              </Button>
            </div>
          </div>
        )}
      </div>
    </Surface>
  );
}

type NextClassCardProps = {
  upcoming: NonNullable<ReturnType<typeof findUpcoming>>;
  now: Date;
  userPosition?: Coordinate;
  walkMeters: SchedulePanelProps["walkMeters"];
  onDirections: SchedulePanelProps["onDirections"];
};

function NextClassCard({ upcoming, now, userPosition, walkMeters, onDirections }: NextClassCardProps) {
  const { entry, daysAhead, previous } = upcoming;
  const place = getPlace(entry.placeId);
  const current = minutesOfDay(now);
  const inProgress = daysAhead === 0 && entry.start <= current;

  let walk: { meters: number; from: string } | undefined;
  if (place && daysAhead === 0 && !inProgress) {
    const isNearby = userPosition && distanceMeters(userPosition, place.coordinate) <= NEARBY_METERS;
    const fromYou = isNearby ? walkMeters(userPosition, place.coordinate) : null;
    const previousPlace = previous ? getPlace(previous.placeId) : undefined;
    const fromPrevious =
      previousPlace && previous && previous.end <= entry.start
        ? walkMeters(previousPlace.coordinate, place.coordinate)
        : null;
    if (fromYou !== null) walk = { meters: fromYou, from: "you" };
    else if (fromPrevious !== null && previous) walk = { meters: fromPrevious, from: previous.placeId };
  }

  const leaveBy = walk ? entry.start - walkMinutes(walk.meters) - BUFFER_MINUTES : undefined;
  const late = leaveBy !== undefined && leaveBy < current;
  const when = daysAhead === 0 ? "Today" : daysAhead === 1 ? "Tomorrow" : WEEKDAY_NAMES[(now.getDay() + daysAhead) % 7];

  return (
    <div className="rounded-2xl bg-accent px-4 py-4 text-accent-foreground">
      <p className="text-xs font-medium uppercase tracking-wider opacity-80">
        {inProgress ? "Happening now" : "Next class"}
      </p>
      <p className="mt-1 text-xl font-semibold leading-tight">{entry.name}</p>
      <p className="mt-0.5 text-sm opacity-90">
        Room {entry.room} in {entry.placeId}
        {place ? ` · ${place.name}` : ""}
      </p>
      <p className="mt-3 text-sm font-medium">
        {inProgress ? `Until ${formatClock(entry.end)}` : `${when} at ${formatClock(entry.start)}`}
      </p>
      {leaveBy !== undefined && walk ? (
        <p className="mt-0.5 text-sm opacity-90">
          {late ? "Leave now" : `Leave by ${formatClock(leaveBy)}`} · {formatDuration(walk.meters)} walk from{" "}
          {walk.from === "you" ? "you" : walk.from}
        </p>
      ) : null}
      {place ? (
        <Button
          variant="secondary"
          size="md"
          className="mt-4 w-full bg-accent-foreground text-accent"
          onPress={() => onDirections(entry, previous && previous.end <= entry.start ? previous.placeId : undefined)}>
          <Navigation aria-hidden />
          Directions to {entry.placeId}
        </Button>
      ) : null}
    </div>
  );
}

function DayPicker({
  selected,
  today,
  busy,
  onSelect,
}: {
  selected: Day;
  today: Day;
  busy: ReadonlySet<Day>;
  onSelect: (day: Day) => void;
}) {
  return (
    <div role="tablist" aria-label="Day of the week" className="grid grid-cols-7 gap-1">
      {DAYS.map((day) => {
        const on = day === selected;
        return (
          <button
            key={day}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={`${DAY_NAMES[day]}${day === today ? ", today" : ""}${busy.has(day) ? ", has classes" : ""}`}
            onClick={() => onSelect(day)}
            className={`flex flex-col items-center gap-1 rounded-xl py-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
              on
                ? "bg-accent-soft font-semibold text-accent-soft-foreground"
                : day === today
                  ? "font-semibold text-foreground hover:bg-surface-secondary"
                  : "text-muted hover:bg-surface-secondary"
            }`}>
            {DAY_SHORT[day]}
            <span
              aria-hidden
              className={`size-1 rounded-full ${busy.has(day) ? (on ? "bg-accent-soft-foreground" : "bg-muted") : "bg-transparent"}`}
            />
          </button>
        );
      })}
    </div>
  );
}

function ClassRow({ entry, isPast, onEdit }: { entry: ClassEntry; isPast?: boolean; onEdit: () => void }) {
  const place = getPlace(entry.placeId);
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Edit ${entry.name}`}
      className={`group -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent ${isPast ? "opacity-50" : ""}`}>
      <div className="w-[4.5rem] shrink-0 text-xs tabular-nums text-muted">
        <div className="font-medium text-foreground">{formatClock(entry.start)}</div>
        <div>{formatClock(entry.end)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{entry.name}</p>
        <p className="truncate text-xs text-muted">
          {entry.placeId}-{entry.room}
          {place ? ` · ${place.name}` : ""}
        </p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
    </button>
  );
}

function WalkGap({
  from,
  to,
  walkMeters,
}: {
  from: ClassEntry;
  to: ClassEntry;
  walkMeters: SchedulePanelProps["walkMeters"];
}) {
  const a = getPlace(from.placeId);
  const b = getPlace(to.placeId);
  if (!a || !b || a.id === b.id) return <div className="ml-[4.5rem] h-px bg-separator" />;

  const meters = walkMeters(a.coordinate, b.coordinate);
  const gap = to.start - from.end;
  const needed = meters === null ? null : walkMinutes(meters);
  const tight = needed !== null && gap >= 0 && needed > gap;

  return (
    <div className="ml-[4.5rem] flex items-center gap-2 py-1 pl-3 text-xs text-muted">
      <span className="h-4 w-px bg-separator" aria-hidden />
      {needed === null ? (
        `${gap} min break`
      ) : tight ? (
        <span className="flex items-center gap-1 font-medium text-warning">
          <AlertTriangle className="size-3.5" aria-hidden />
          {needed} min walk, only {gap} min between
        </span>
      ) : (
        `${needed} min walk · ${gap} min break`
      )}
    </div>
  );
}

function ClassForm({
  title,
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  title: string;
  initial?: ClassEntry;
  onSave: (entry: NewClass) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [roomCode, setRoomCode] = useState(initial ? `${initial.placeId}-${initial.room}` : "");
  const [days, setDays] = useState<Day[]>(initial?.days ?? []);
  const [start, setStart] = useState(initial ? timeInput(initial.start) : "");
  const [end, setEnd] = useState(initial ? timeInput(initial.end) : "");
  const [error, setError] = useState<string>();

  function submit() {
    const room = parseRoomCode(roomCode);
    const startMinutes = parseTimeInput(start);
    const endMinutes = parseTimeInput(end);

    if (!name.trim()) return setError("Give the class a name, like BIO 170.");
    if (!room) return setError(`Room code not recognized. Use a code like ${CAMPUS.rooms.example}.`);
    if (days.length === 0) return setError("Pick at least one day.");
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
      return setError("Check the start and end times.");
    }

    const entry = validateClass({
      name,
      placeId: room.place.id,
      room: room.room,
      days,
      start: startMinutes,
      end: endMinutes,
    });
    if (!entry) return setError("Something in this class looks off. Check each field.");
    onSave(entry);
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}>
      <h3 className="text-base font-semibold">{title}</h3>
      <TextField value={name} onChange={(value) => setName(value.slice(0, MAX_CLASS_NAME))} isRequired fullWidth>
        <Label>Class</Label>
        <Input placeholder="BIO 170" maxLength={MAX_CLASS_NAME} autoComplete="off" />
      </TextField>

      <TextField value={roomCode} onChange={(value) => setRoomCode(value.slice(0, 24))} isRequired fullWidth>
        <Label>Room</Label>
        <Input placeholder={CAMPUS.rooms.example} maxLength={24} autoComplete="off" autoCapitalize="characters" />
      </TextField>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Days</span>
        <ToggleButtonGroup
          aria-label="Days"
          selectionMode="multiple"
          isDetached
          size="sm"
          selectedKeys={days}
          onSelectionChange={(keys) => setDays(DAYS.filter((day) => keys.has(day)))}
          className="flex-wrap gap-1.5">
          {DAYS.map((day) => (
            <ToggleButton
              key={day}
              id={day}
              className="min-w-10 rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
              {DAY_SHORT[day]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField value={start} onChange={setStart} isRequired>
          <Label>Starts</Label>
          <Input type="time" />
        </TextField>
        <TextField value={end} onChange={setEnd} isRequired>
          <Label>Ends</Label>
          <Input type="time" />
        </TextField>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" className="flex-1">
          Save class
        </Button>
        <Button variant="secondary" onPress={onCancel}>
          Cancel
        </Button>
      </div>
      {onDelete ? (
        <Button variant="ghost" className="text-danger" onPress={onDelete}>
          <Trash2 aria-hidden />
          Delete class
        </Button>
      ) : null}
    </form>
  );
}

function PasteSchedule({ onImport, onCancel }: { onImport: (entries: NewClass[]) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseScheduleText(text), [text]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Open your class schedule in {CAMPUS.schedule.portalName ?? "your student portal"}, select all of it, copy, and
        paste it below. Nothing is uploaded.
      </p>
      <TextArea
        aria-label="Pasted schedule"
        value={text}
        onChange={(event) => setText(event.target.value.slice(0, 20_000))}
        rows={6}
        placeholder={`BIO 170 General Biology\nMoWe 9:05AM - 10:20AM\n${CAMPUS.rooms.example}`}
        className="font-mono text-xs"
      />

      {text.trim() ? (
        parsed.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted">Found {parsed.length}</p>
            {parsed.map((entry, index) => (
              <div key={index} className="flex items-center gap-2 rounded-xl bg-surface-secondary px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</span>
                <Chip size="sm" variant="soft">
                  {entry.placeId}-{entry.room}
                </Chip>
                <span className="text-xs tabular-nums text-muted">
                  {formatDays(entry.days)} {formatClock(entry.start)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">
            No classes found yet. Each class needs a course code, days like MoWe, a time range, and a room like{" "}
            {CAMPUS.rooms.example}.
          </p>
        )
      ) : null}

      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" isDisabled={parsed.length === 0} onPress={() => onImport(parsed)}>
          {parsed.length > 0 ? `Add ${parsed.length} ${parsed.length === 1 ? "class" : "classes"}` : "Add classes"}
        </Button>
        <Button variant="secondary" onPress={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
