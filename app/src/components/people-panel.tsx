"use client";

import { Button, CloseButton, Input, Label, ListBox, SearchField, Spinner, Surface, TextField, ToggleButton, ToggleButtonGroup, toast } from "@heroui/react";
import { Ban, Check, MapPin, Plus, UserPlus, Users, X } from "lucide-react";
import { useMemo, useState } from "react";

import { CampusTab } from "@/components/campus-tab";
import { PlaceItem } from "@/components/place-row";
import { CollapseButton, SheetGrabber } from "@/components/sheet-chrome";
import { getPlace } from "@/data/campus";
import { MAX_USERNAME_LENGTH, normalizeUsername } from "@/lib/api";
import { searchPlaces } from "@/lib/search";
import { MAX_GUESTS, socialApi, type Friend, type FriendsOverview, type Meetup } from "@/lib/social-api";

type PeoplePanelProps = {
  myUsername: string;
  friends: FriendsOverview;
  meetups: Meetup[];
  campus: Meetup[];
  isLoading: boolean;
  onRefresh: () => void;
  onMeetupChange: (meetup: Meetup) => void;
  onOpenMeetup: (id: string) => void;
  onCollapse: () => void;
  onClose: () => void;
};

type Tab = "meetups" | "campus" | "friends";

export function initialsFor(name: string, fallback: string) {
  const parts = (name || fallback).split(/[ ._]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Avatar({ name, username }: { name: string; username: string }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-soft-foreground">
      {initialsFor(name, username)}
    </span>
  );
}

function Row({ name, username, children }: { name: string; username: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Avatar name={name} username={username} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name || username}</p>
        <p className="truncate text-xs text-muted">@{username}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</h3>;
}

export function PeoplePanel({ myUsername, friends, meetups, campus, isLoading, onRefresh, onMeetupChange, onOpenMeetup, onCollapse, onClose }: PeoplePanelProps) {
  const [tab, setTab] = useState<Tab>(meetups.length > 0 ? "meetups" : "friends");
  const [isCreating, setIsCreating] = useState(false);

  return (
    <Surface
      role="region"
      aria-label="Friends and meetups"
      className="animate-sheet-in flex max-h-[82dvh] flex-col rounded-t-[28px] shadow-2xl md:max-h-[calc(100dvh-2rem)] md:rounded-3xl">
      <SheetGrabber onCollapse={onCollapse} />

      <div className="flex items-center gap-3 px-5 pb-2 pt-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
          <Users className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight">Friends</h2>
          <p className="truncate text-xs text-muted">Meet up on campus</p>
        </div>
        {isLoading ? <Spinner size="sm" /> : null}
        <CollapseButton onCollapse={onCollapse} />
        <CloseButton aria-label="Close friends" onPress={onClose} />
      </div>

      <div className="px-5 pb-1">
        <ToggleButtonGroup
          aria-label="Friends or meetups"
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={[tab]}
          onSelectionChange={(keys) => {
            const [next] = keys;
            if (next) setTab(next as Tab);
          }}
          className="gap-2">
          <ToggleButton id="meetups" className="rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
            Meetups
          </ToggleButton>
          <ToggleButton id="campus" className="rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
            Campus
          </ToggleButton>
          <ToggleButton id="friends" className="rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
            People
          </ToggleButton>
        </ToggleButtonGroup>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,var(--map-safe-bottom))] pt-1">
        {tab === "friends" ? (
          <FriendsTab friends={friends} onRefresh={onRefresh} />
        ) : tab === "campus" ? (
          <CampusTab campus={campus} onMeetupChange={onMeetupChange} onRefresh={onRefresh} />
        ) : isCreating ? (
          <NewMeetupForm
            myUsername={myUsername}
            friends={friends.friends}
            onCancel={() => setIsCreating(false)}
            onCreated={(meetup) => {
              setIsCreating(false);
              onMeetupChange(meetup);
              onOpenMeetup(meetup.id);
            }}
          />
        ) : (
          <MeetupsTab
            myUsername={myUsername}
            meetups={meetups}
            canCreate={friends.friends.length > 0}
            onCreate={() => setIsCreating(true)}
            onOpenMeetup={onOpenMeetup}
            onMeetupChange={onMeetupChange}
            onSeeFriends={() => setTab("friends")}
          />
        )}
      </div>
    </Surface>
  );
}

function FriendsTab({ friends, onRefresh }: { friends: FriendsOverview; onRefresh: () => void }) {
  const [username, setUsername] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function run(action: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    setIsBusy(true);
    const res = await action();
    setIsBusy(false);
    if (!res.ok) {
      toast.danger(res.message ?? "That didn't work.");
      return;
    }
    toast.success(success);
    onRefresh();
  }

  async function add() {
    const handle = normalizeUsername(username);
    if (handle.length < 3) {
      toast.danger("Enter your friend's username.");
      return;
    }
    setIsBusy(true);
    const res = await socialApi.addFriend(handle);
    setIsBusy(false);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    setUsername("");
    toast.success(res.data.status === "friends" ? `You and @${handle} are now friends` : `Request sent to @${handle}`);
    onRefresh();
  }

  return (
    <div className="flex flex-col gap-1">
      <form
        className="flex items-end gap-2 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}>
        <TextField
          value={username}
          onChange={(value) => setUsername(normalizeUsername(value))}
          className="min-w-0 flex-1"
          fullWidth>
          <Label>Add a friend</Label>
          <Input variant="secondary" placeholder="their username" maxLength={MAX_USERNAME_LENGTH} autoComplete="off" />
        </TextField>
        <Button type="submit" isPending={isBusy} isDisabled={username.length < 3}>
          <UserPlus aria-hidden />
          Add
        </Button>
      </form>
      <p className="text-xs text-muted">Friends find each other by username. Emails stay private.</p>

      {friends.incoming.length > 0 ? (
        <>
          <SectionTitle>Wants to be friends</SectionTitle>
          {friends.incoming.map((person) => (
            <Row key={person.username} name={person.displayName} username={person.username}>
              <Button
                size="sm"
                isDisabled={isBusy}
                onPress={() => void run(() => socialApi.acceptFriend(person.username), `You and @${person.username} are friends`)}>
                <Check aria-hidden />
                Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Decline ${person.username}`}
                isIconOnly
                isDisabled={isBusy}
                onPress={() => void run(() => socialApi.removeRequest(person.username), "Request declined")}>
                <X aria-hidden />
              </Button>
            </Row>
          ))}
        </>
      ) : null}

      <SectionTitle>Your friends</SectionTitle>
      {friends.friends.length === 0 ? (
        <p className="rounded-2xl bg-surface-secondary px-4 py-5 text-sm text-muted">
          No friends yet. Add someone by username to plan a meetup.
        </p>
      ) : (
        friends.friends.map((person) => (
          <Row key={person.username} name={person.displayName} username={person.username}>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={isBusy}
              onPress={() => void run(() => socialApi.unfriend(person.username), `Removed @${person.username}`)}>
              Remove
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Block ${person.username}`}
              isIconOnly
              isDisabled={isBusy}
              onPress={() => void run(() => socialApi.block(person.username), `Blocked @${person.username}`)}>
              <Ban aria-hidden />
            </Button>
          </Row>
        ))
      )}

      {friends.outgoing.length > 0 ? (
        <>
          <SectionTitle>Waiting for an answer</SectionTitle>
          {friends.outgoing.map((person) => (
            <Row key={person.username} name={person.displayName} username={person.username}>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={isBusy}
                onPress={() => void run(() => socialApi.removeRequest(person.username), "Request cancelled")}>
                Cancel
              </Button>
            </Row>
          ))}
        </>
      ) : null}

      {friends.blocked.length > 0 ? (
        <>
          <SectionTitle>Blocked</SectionTitle>
          {friends.blocked.map((person) => (
            <Row key={person.username} name={person.displayName} username={person.username}>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={isBusy}
                onPress={() => void run(() => socialApi.unblock(person.username), `Unblocked @${person.username}`)}>
                Unblock
              </Button>
            </Row>
          ))}
        </>
      ) : null}
    </div>
  );
}

export function meetupWhere(meetup: Meetup, myUsername?: string) {
  const destination = meetup.destination;
  if (!destination) return "Somewhere on campus";
  if (destination.kind === "member") {
    if (myUsername && destination.username === myUsername) return "Wherever you are";
    const person = meetup.members.find((m) => m.username === destination.username);
    return `Wherever ${person?.displayName ?? "@" + destination.username} is`;
  }
  if (destination.kind === "place") return getPlace(destination.placeId)?.name ?? "A campus building";
  return "A dropped pin";
}

function timeLeft(expiresAt: string) {
  const minutes = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return "ending";
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.round(minutes / 60)} h left`;
}

function MeetupsTab({
  myUsername,
  meetups,
  canCreate,
  onCreate,
  onOpenMeetup,
  onMeetupChange,
  onSeeFriends,
}: {
  myUsername: string;
  meetups: Meetup[];
  canCreate: boolean;
  onCreate: () => void;
  onOpenMeetup: (id: string) => void;
  onMeetupChange: (meetup: Meetup) => void;
  onSeeFriends: () => void;
}) {
  const [isBusy, setIsBusy] = useState(false);

  async function respond(meetup: Meetup, accept: boolean) {
    setIsBusy(true);
    const res = await socialApi.respond(meetup.id, accept);
    setIsBusy(false);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    onMeetupChange(res.data);
    if (accept) onOpenMeetup(res.data.id);
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      <Button
        onPress={canCreate ? onCreate : onSeeFriends}
        fullWidth
        variant={canCreate ? "primary" : "secondary"}>
        <Plus aria-hidden />
        {canCreate ? "New meetup" : "Add a friend first"}
      </Button>

      {meetups.length === 0 ? (
        <p className="rounded-2xl bg-surface-secondary px-4 py-5 text-sm text-muted">
          No meetups right now. Start one and your friends get an invite.
        </p>
      ) : (
        meetups.map((meetup) => {
          const joined = meetup.members.filter((m) => m.status === "joined").length;
          return (
            <div key={meetup.id} className="rounded-2xl border border-separator px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground">
                  <MapPin className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{meetup.note || meetupWhere(meetup, myUsername)}</p>
                  <p className="truncate text-xs text-muted">
                    {meetup.yourRole === "host" ? "You started this" : `${meetup.host.displayName} invited you`} ·{" "}
                    {joined} in · {timeLeft(meetup.expiresAt)}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex gap-2">
                {meetup.yourStatus === "invited" ? (
                  <>
                    <Button size="sm" isDisabled={isBusy} onPress={() => void respond(meetup, true)} className="flex-1">
                      Join
                    </Button>
                    <Button size="sm" variant="secondary" isDisabled={isBusy} onPress={() => void respond(meetup, false)} className="flex-1">
                      No thanks
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onPress={() => onOpenMeetup(meetup.id)} fullWidth>
                    Open
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

const DURATIONS = [
  { id: "30", label: "30 min" },
  { id: "60", label: "1 hour" },
  { id: "120", label: "2 hours" },
  { id: "240", label: "4 hours" },
];

function NewMeetupForm({
  myUsername,
  friends,
  onCancel,
  onCreated,
}: {
  myUsername: string;
  friends: Friend[];
  onCancel: () => void;
  onCreated: (meetup: Meetup) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [where, setWhere] = useState<"me" | "friend" | "place">("me");
  const [target, setTarget] = useState<string>();
  const [placeId, setPlaceId] = useState<string>();
  const [placeQuery, setPlaceQuery] = useState("");
  const [minutes, setMinutes] = useState("120");
  const [note, setNote] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const places = useMemo(() => searchPlaces(placeQuery, 8), [placeQuery]);
  const place = getPlace(placeId);

  async function create() {
    const destination =
      where === "place"
        ? { kind: "place" as const, placeId: placeId ?? "" }
        : { kind: "member" as const, username: where === "me" ? myUsername : (target ?? "") };

    setIsBusy(true);
    const res = await socialApi.createMeetup({
      friends: picked,
      destination,
      note,
      minutes: Number(minutes),
    });
    setIsBusy(false);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    toast.success("Meetup started");
    onCreated(res.data);
  }

  const ready = picked.length > 0 && (where !== "friend" || target) && (where !== "place" || placeId);

  return (
    <form
      className="flex flex-col gap-4 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Who&apos;s coming</span>
        <ToggleButtonGroup
          aria-label="Friends to invite"
          selectionMode="multiple"
          isDetached
          size="sm"
          selectedKeys={picked}
          onSelectionChange={(keys) => {
            const next = friends.map((f) => f.username).filter((username) => keys.has(username));
            if (next.length > MAX_GUESTS) {
              toast.info(`You can invite up to ${MAX_GUESTS} friends.`);
              return;
            }
            setPicked(next);
            if (target && !next.includes(target)) setTarget(undefined);
          }}
          className="flex-wrap gap-1.5">
          {friends.map((friend) => (
            <ToggleButton
              key={friend.username}
              id={friend.username}
              className="rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
              {friend.displayName || friend.username}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Where</span>
        <ToggleButtonGroup
          aria-label="Where to meet"
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={[where]}
          onSelectionChange={(keys) => {
            const [next] = keys;
            if (next) setWhere(next as "me" | "friend" | "place");
          }}
          className="flex-wrap gap-1.5">
          <ToggleButton id="me" className="rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
            They come to me
          </ToggleButton>
          <ToggleButton id="friend" className="rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
            I go to them
          </ToggleButton>
          <ToggleButton id="place" className="rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
            A place
          </ToggleButton>
        </ToggleButtonGroup>
      </div>

      {where === "friend" ? (
        picked.length === 0 ? (
          <p className="text-sm text-muted">Pick who&apos;s coming first, then choose who to walk to.</p>
        ) : (
          <ToggleButtonGroup
            aria-label="Who to walk to"
            selectionMode="single"
            isDetached
            size="sm"
            selectedKeys={target ? [target] : []}
            onSelectionChange={(keys) => {
              const [next] = keys;
              setTarget(next ? String(next) : undefined);
            }}
            className="flex-wrap gap-1.5">
            {picked.map((username) => (
              <ToggleButton
                key={username}
                id={username}
                className="rounded-full data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
                {friends.find((f) => f.username === username)?.displayName ?? username}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        )
      ) : null}

      {where === "place" ? (
        <div className="flex flex-col gap-2">
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
      ) : null}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Ends in</span>
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
        <Label>Note</Label>
        <Input variant="secondary" placeholder="lunch before class" maxLength={80} autoComplete="off" />
      </TextField>

      <p className="text-xs text-muted">
        Everyone who joins shares their live location with the group until the meetup ends. Nothing is saved.
      </p>

      <div className="flex gap-2">
        <Button variant="secondary" onPress={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" isPending={isBusy} isDisabled={!ready} className="flex-1">
          Start
        </Button>
      </div>
    </form>
  );
}
