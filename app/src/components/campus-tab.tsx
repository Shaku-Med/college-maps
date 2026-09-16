"use client";

import { Button, Input, Label, ListBox, SearchField, TextField, ToggleButton, ToggleButtonGroup, toast } from "@heroui/react";
import { CalendarPlus, Clock, MapPin } from "lucide-react";
import { useMemo, useState } from "react";

import { PlaceItem } from "@/components/place-row";
import { getPlace } from "@/data/campus";
import { searchPlaces } from "@/lib/search";
import { socialApi, type Meetup, type MeetupDestination } from "@/lib/social-api";

const START_OPTIONS = [
  { id: "0", label: "Now" },
  { id: "30", label: "In 30 min" },
  { id: "60", label: "In 1 hour" },
  { id: "180", label: "In 3 hours" },
  { id: "1440", label: "Tomorrow" },
];

const DURATIONS = [
  { id: "30", label: "30 min" },
  { id: "60", label: "1 hour" },
  { id: "120", label: "2 hours" },
  { id: "240", label: "4 hours" },
];

function startsWhen(meetup: Meetup) {
  if (!meetup.startsAt) return "";
  const start = new Date(meetup.startsAt);
  const minutes = Math.round((start.getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "happening now";
  if (minutes < 60) return `starts in ${minutes} min`;
  const clock = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return minutes < 60 * 12 ? `starts ${clock}` : `starts ${start.toLocaleDateString([], { weekday: "short" })} ${clock}`;
}

export function CampusTab({
  campus,
  onMeetupChange,
  onRefresh,
}: {
  campus: Meetup[];
  onMeetupChange: (meetup: Meetup) => void;
  onRefresh: () => void;
}) {
  const [isCreating, setIsCreating] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  async function toggleGoing(meetup: Meetup) {
    if (meetup.yourRole === "host") return;
    setIsBusy(true);
    const res =
      meetup.yourStatus === "joined" ? await socialApi.leaveMeetup(meetup.id) : await socialApi.joinPublicMeetup(meetup.id);
    setIsBusy(false);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    onMeetupChange(res.data);
    onRefresh();
  }

  async function takeDown(meetup: Meetup) {
    setIsBusy(true);
    const res = await socialApi.endMeetup(meetup.id);
    setIsBusy(false);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    toast.success("Taken down");
    onMeetupChange(res.data);
    onRefresh();
  }

  if (isCreating) {
    return (
      <NewPublicMeetupForm
        onCancel={() => setIsCreating(false)}
        onCreated={(meetup) => {
          setIsCreating(false);
          onMeetupChange(meetup);
          onRefresh();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <Button onPress={() => setIsCreating(true)} fullWidth>
        <CalendarPlus aria-hidden />
        Post a campus meetup
      </Button>
      <p className="text-xs text-muted">
        Open to every student. The spot shows up when it starts, and nobody shares a live location.
      </p>

      {campus.length === 0 ? (
        <p className="rounded-2xl bg-surface-secondary px-4 py-5 text-sm text-muted">
          Nothing posted yet. Be the first to put something on the campus board.
        </p>
      ) : (
        campus.map((meetup) => {
          const going = meetup.yourStatus === "joined";
          const place = meetup.destination?.kind === "place" ? getPlace(meetup.destination.placeId) : undefined;
          return (
            <div key={meetup.id} className="rounded-2xl border border-separator px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground">
                  <Clock className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{meetup.title}</p>
                  <p className="truncate text-xs text-muted">
                    {startsWhen(meetup)} · {meetup.going} going · by {meetup.host.displayName}
                  </p>
                  {meetup.note ? <p className="truncate pt-1 text-xs text-muted">{meetup.note}</p> : null}
                  <p className="truncate pt-1 text-xs text-muted">
                    {place
                      ? place.name
                      : meetup.destination
                        ? "A dropped pin"
                        : going
                          ? "Spot shows when it starts"
                          : "Say you are going to see the spot"}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                {meetup.yourRole === "host" ? (
                  <>
                    <Button size="sm" variant="secondary" isDisabled className="flex-1">
                      You are going
                    </Button>
                    <Button size="sm" variant="secondary" isDisabled={isBusy} onPress={() => void takeDown(meetup)}>
                      Take down
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant={going ? "secondary" : "primary"}
                    isDisabled={isBusy}
                    onPress={() => void toggleGoing(meetup)}
                    fullWidth>
                    {going ? "Can't go" : "I am going"}
                  </Button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function NewPublicMeetupForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (meetup: Meetup) => void }) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [placeId, setPlaceId] = useState<string>();
  const [placeQuery, setPlaceQuery] = useState("");
  const [startsIn, setStartsIn] = useState("60");
  const [minutes, setMinutes] = useState("120");
  const [isBusy, setIsBusy] = useState(false);

  const places = useMemo(() => searchPlaces(placeQuery, 8), [placeQuery]);
  const place = getPlace(placeId);

  async function create() {
    const destination: MeetupDestination = { kind: "place", placeId: placeId ?? "" };
    setIsBusy(true);
    const res = await socialApi.createPublicMeetup({
      title,
      note,
      destination,
      startsIn: Number(startsIn),
      minutes: Number(minutes),
    });
    setIsBusy(false);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    toast.success("Posted to the campus board");
    onCreated(res.data);
  }

  return (
    <form
      className="flex flex-col gap-4 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}>
      <TextField value={title} onChange={(value) => setTitle(value.slice(0, 60))} isRequired fullWidth>
        <Label>What is it</Label>
        <Input variant="secondary" placeholder="Chess club meetup" maxLength={60} autoComplete="off" />
      </TextField>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Where</span>
        {place ? (
          <div className="flex items-center gap-2 rounded-2xl bg-surface-secondary px-4 py-3">
            <MapPin className="size-4 shrink-0 text-muted" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-sm">{place.name}</p>
            <Button size="sm" variant="ghost" onPress={() => setPlaceId(undefined)}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <SearchField value={placeQuery} onChange={setPlaceQuery} aria-label="Find a place">
              <Input variant="secondary" placeholder="Search buildings" />
            </SearchField>
            <ListBox
              aria-label="Places"
              selectionMode="none"
              onAction={(key) => {
                setPlaceId(String(key));
                setPlaceQuery("");
              }}>
              {places.map((item) => (
                <PlaceItem key={item.id} place={item} />
              ))}
            </ListBox>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Starts</span>
        <ToggleButtonGroup
          aria-label="When it starts"
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={[startsIn]}
          onSelectionChange={(keys) => {
            const [next] = keys;
            if (next) setStartsIn(String(next));
          }}
          className="flex-wrap gap-1.5">
          {START_OPTIONS.map((option) => (
            <ToggleButton
              key={option.id}
              id={option.id}
              className="rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Runs for</span>
        <ToggleButtonGroup
          aria-label="How long"
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={[minutes]}
          onSelectionChange={(keys) => {
            const [next] = keys;
            if (next) setMinutes(String(next));
          }}
          className="flex-wrap gap-1.5">
          {DURATIONS.map((option) => (
            <ToggleButton
              key={option.id}
              id={option.id}
              className="rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      <TextField value={note} onChange={(value) => setNote(value.slice(0, 80))} fullWidth>
        <Label>Details</Label>
        <Input variant="secondary" placeholder="bring your own board" maxLength={80} autoComplete="off" />
      </TextField>

      <p className="text-xs text-muted">Every student can see this and your name. The spot is revealed when it starts.</p>

      <div className="flex gap-2">
        <Button variant="secondary" onPress={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" isPending={isBusy} isDisabled={title.trim().length < 3 || !placeId} className="flex-1">
          Post
        </Button>
      </div>
    </form>
  );
}
