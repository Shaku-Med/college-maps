"use client";

import {
  Button,
  CloseButton,
  Dropdown,
  Input,
  Label,
  SearchField,
  Spinner,
  Surface,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  toast,
} from "@heroui/react";
import { Ban, CalendarDays, Check, ChevronLeft, ChevronRight, Copy, Flag, MapPin, MoreHorizontal, Plus, Send, UserMinus, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { CampusTab } from "@/components/campus-tab";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { PlaceSearchList } from "@/components/place-search-list";
import { useReportFlow } from "@/components/report-flow";
import { CollapseButton, SheetGrabber } from "@/components/sheet-chrome";
import { getPlace } from "@/data/campus";
import { MAX_USERNAME_LENGTH, normalizeUsername } from "@/lib/api";
import { MAX_GUESTS, socialApi, type Friend, type FriendsOverview, type Meetup, type Person } from "@/lib/social-api";

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
  return <h3 className="pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-muted">{children}</h3>;
}

const FRIENDS_SHOWN = 5;

type Page = "home" | "add" | "friends" | "sent" | "blocked" | "campus" | "new-meetup";
type Run = (action: () => Promise<{ ok: boolean; message?: string }>, success: string) => Promise<void>;

export function PeoplePanel({ myUsername, friends, meetups, campus, isLoading, onRefresh, onMeetupChange, onOpenMeetup, onCollapse, onClose }: PeoplePanelProps) {
  const [page, setPage] = useState<Page>("home");
  const [isBusy, setIsBusy] = useState(false);
  const report = useReportFlow(onRefresh);
  const confirm = useConfirmDialog();
  const home = () => setPage("home");

  const run: Run = async (action, success) => {
    setIsBusy(true);
    const res = await action();
    setIsBusy(false);
    if (!res.ok) {
      toast.danger(res.message ?? "That didn't work.");
      return;
    }
    toast.success(success);
    onRefresh();
  };

  return (
    <Surface
      role="region"
      aria-label="Friends and meetups"
      className="animate-sheet-in flex max-h-[82dvh] flex-col rounded-t-[28px] shadow-2xl md:max-h-[calc(100dvh-2rem)] md:rounded-3xl">
      <SheetGrabber />
      {report.dialog}
      {confirm.dialog}

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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,var(--map-safe-bottom))]">
        {page === "add" ? (
          <AddFriendPage myUsername={myUsername} onBack={home} onAdded={onRefresh} />
        ) : page === "friends" ? (
          <FriendsListPage friends={friends} isBusy={isBusy} report={report} confirm={confirm} onBack={home} run={run} />
        ) : page === "sent" ? (
          <SentPage friends={friends} isBusy={isBusy} onBack={home} run={run} />
        ) : page === "blocked" ? (
          <BlockedPage friends={friends} isBusy={isBusy} onBack={home} run={run} />
        ) : page === "campus" ? (
          <div className="pt-1">
            <PageHeader title="Happening on campus" subtitle="Open to every student" onBack={home} />
            <CampusTab myUsername={myUsername} campus={campus} onMeetupChange={onMeetupChange} onRefresh={onRefresh} />
          </div>
        ) : page === "new-meetup" ? (
          <div className="pt-1">
            <PageHeader title="New meetup" subtitle="Your friends get an invite" onBack={home} />
            <NewMeetupForm
              myUsername={myUsername}
              friends={friends.friends}
              onCancel={home}
              onCreated={(meetup) => {
                home();
                onMeetupChange(meetup);
                onOpenMeetup(meetup.id);
              }}
            />
          </div>
        ) : (
          <PeopleHome
            myUsername={myUsername}
            friends={friends}
            meetups={meetups}
            campusCount={campus.length}
            isBusy={isBusy}
            report={report}
            confirm={confirm}
            run={run}
            onOpen={setPage}
            onOpenMeetup={onOpenMeetup}
            onMeetupChange={onMeetupChange}
          />
        )}
      </div>
    </Surface>
  );
}

function countLabel(count: number, empty: string, one: string, many: (n: number) => string) {
  if (count === 0) return empty;
  if (count === 1) return one;
  return many(count);
}

function matchesPerson(person: Person, query: string) {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return true;
  return person.username.toLowerCase().includes(q) || person.displayName.toLowerCase().includes(q);
}

/** The one place an action lives, at the end of the list it adds to, lined up with the avatars above it. */
function ActionRow({ icon, title, subtitle, onPress }: { icon: React.ReactNode; title: string; subtitle?: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-2xl px-2 py-2 text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-accent">{title}</span>
        {subtitle ? <span className="block truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
    </button>
  );
}

function PeopleHome({
  myUsername,
  friends,
  meetups,
  campusCount,
  isBusy,
  report,
  confirm,
  run,
  onOpen,
  onOpenMeetup,
  onMeetupChange,
}: {
  myUsername: string;
  friends: FriendsOverview;
  meetups: Meetup[];
  campusCount: number;
  isBusy: boolean;
  report: ReturnType<typeof useReportFlow>;
  confirm: ReturnType<typeof useConfirmDialog>;
  run: Run;
  onOpen: (page: Page) => void;
  onOpenMeetup: (id: string) => void;
  onMeetupChange: (meetup: Meetup) => void;
}) {
  const [isResponding, setIsResponding] = useState(false);
  const list = friends.friends;
  const ordered = [...meetups.filter((m) => m.yourStatus === "invited"), ...meetups.filter((m) => m.yourStatus !== "invited")];

  async function respond(meetup: Meetup, accept: boolean, stayOut = false) {
    setIsResponding(true);
    const res = await socialApi.respond(meetup.id, accept, stayOut);
    setIsResponding(false);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    onMeetupChange(res.data);
    if (accept) onOpenMeetup(res.data.id);
  }

  return (
    <div className="flex flex-col">
      {friends.incoming.length > 0 ? (
        <section>
          <SectionTitle>{friends.incoming.length === 1 ? "Wants to be friends" : `${friends.incoming.length} want to be friends`}</SectionTitle>
          {friends.incoming.map((person) => (
            <Row key={person.username} name={person.displayName} username={person.username}>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={isBusy}
                onPress={() => void run(() => socialApi.removeRequest(person.username), "Request declined")}>
                Decline
              </Button>
              <Button
                size="sm"
                isDisabled={isBusy}
                onPress={() => void run(() => socialApi.acceptFriend(person.username), `You and @${person.username} are friends`)}>
                <Check aria-hidden />
                Accept
              </Button>
            </Row>
          ))}
        </section>
      ) : null}

      <section>
        <SectionTitle>Meetups</SectionTitle>
        <div className="flex flex-col gap-1">
          {ordered.map((meetup) => {
            const joined = meetup.members.filter((m) => m.status === "joined").length;
            const invited = meetup.yourStatus === "invited";
            return (
              <div key={meetup.id} className={invited ? "rounded-2xl border border-separator p-2" : "-mx-2"}>
                <button
                  type="button"
                  onClick={() => onOpenMeetup(meetup.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-muted">
                    <MapPin className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{meetup.note || meetupWhere(meetup, myUsername)}</span>
                    <span className="block truncate text-xs text-muted">
                      {meetup.yourRole === "host" ? "You started this" : `${meetup.host.displayName} invited you`} · {joined} in ·{" "}
                      {timeLeft(meetup.expiresAt)}
                    </span>
                  </span>
                  {invited ? null : <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />}
                </button>
                {invited ? (
                  <div className="flex flex-wrap gap-2 px-2 pb-1 pt-1">
                    <Button size="sm" isDisabled={isResponding} onPress={() => void respond(meetup, true)}>
                      Join
                    </Button>
                    <Button size="sm" variant="secondary" isDisabled={isResponding} onPress={() => void respond(meetup, false)}>
                      No thanks
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      isDisabled={isResponding}
                      aria-label="Decline and don't invite me again"
                      onPress={() => void respond(meetup, false, true)}>
                      Don&apos;t ask again
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
          <ActionRow
            icon={<Plus className="size-4" aria-hidden />}
            title="Start a meetup"
            subtitle={
              list.length === 0 ? "Add a friend first" : ordered.length === 0 ? "Share where you are with friends for a few hours" : undefined
            }
            onPress={() => onOpen(list.length === 0 ? "add" : "new-meetup")}
          />
        </div>
      </section>

      <section>
        <div className="flex items-end justify-between">
          <SectionTitle>{list.length > 0 ? `Friends · ${list.length}` : "Friends"}</SectionTitle>
          {list.length > FRIENDS_SHOWN ? (
            <button
              type="button"
              onClick={() => onOpen("friends")}
              className="mb-1 rounded-md text-xs font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent">
              See all
            </button>
          ) : null}
        </div>
        {list.slice(0, FRIENDS_SHOWN).map((person) => (
          <Row key={person.username} name={person.displayName} username={person.username}>
            <FriendMenu person={person} isBusy={isBusy} report={report} confirm={confirm} run={run} />
          </Row>
        ))}
        <ActionRow
          icon={<UserPlus className="size-4" aria-hidden />}
          title="Add a friend"
          subtitle={list.length === 0 ? `Or share your username, @${myUsername}` : undefined}
          onPress={() => onOpen("add")}
        />
      </section>

      <section>
        <SectionTitle>On campus</SectionTitle>
        <NavRow
          icon={<CalendarDays className="size-4" aria-hidden />}
          title="Happening on campus"
          subtitle={countLabel(campusCount, "Nothing posted yet", "1 open event", (n) => `${n} open events`)}
          onPress={() => onOpen("campus")}
        />
      </section>

      <div className="mt-4 flex flex-col border-t border-separator pt-3">
        <NavRow
          icon={<Send className="size-4" aria-hidden />}
          title="Sent requests"
          subtitle={countLabel(friends.outgoing.length, "None waiting", "1 waiting", (n) => `${n} waiting`)}
          onPress={() => onOpen("sent")}
          quiet
        />
        <NavRow
          icon={<Ban className="size-4" aria-hidden />}
          title="Blocked"
          subtitle={countLabel(friends.blocked.length, "Nobody", "1 person", (n) => `${n} people`)}
          onPress={() => onOpen("blocked")}
          quiet
        />
      </div>
    </div>
  );
}

function AddFriendPage({ myUsername, onBack, onAdded }: { myUsername: string; onBack: () => void; onAdded: () => void }) {
  const [username, setUsername] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function add() {
    const handle = normalizeUsername(username);
    if (handle.length < 3) {
      toast.danger("Enter your friend's username.");
      return;
    }
    if (handle === myUsername) {
      toast.danger("That's you.");
      return;
    }
    setIsBusy(true);
    const res = await socialApi.addFriend(handle);
    setIsBusy(false);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    toast.success(res.data.status === "friends" ? `You and @${handle} are now friends` : `Request sent to @${handle}`);
    onAdded();
    onBack();
  }

  async function copyMine() {
    try {
      await navigator.clipboard.writeText(`@${myUsername}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.danger(`Couldn't copy. Your username is @${myUsername}`);
    }
  }

  return (
    <div className="flex flex-col gap-4 pt-1">
      <PageHeader title="Add a friend" subtitle="Friends find each other by username" onBack={onBack} />
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}>
        <TextField value={username} onChange={(value) => setUsername(normalizeUsername(value))} fullWidth>
          <Label>Their username</Label>
          <Input variant="secondary" placeholder="username" maxLength={MAX_USERNAME_LENGTH} autoComplete="off" autoFocus />
        </TextField>
        <Button type="submit" isPending={isBusy} isDisabled={username.length < 3} fullWidth>
          Send request
        </Button>
      </form>
      <div className="flex items-center gap-3 rounded-2xl bg-surface-secondary px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">Your username</p>
          <p className="truncate text-base font-semibold">@{myUsername}</p>
        </div>
        <Button size="sm" variant="secondary" onPress={() => void copyMine()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-xs text-muted">Emails stay private. Only your name and username are shown.</p>
    </div>
  );
}

function FriendMenu({
  person,
  isBusy,
  report,
  confirm,
  run,
}: {
  person: Person;
  isBusy: boolean;
  report: ReturnType<typeof useReportFlow>;
  confirm: ReturnType<typeof useConfirmDialog>;
  run: Run;
}) {
  return (
    <Dropdown>
      <Button size="sm" variant="ghost" isIconOnly aria-label={`${person.displayName} options`} isDisabled={isBusy}>
        <MoreHorizontal aria-hidden />
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          onAction={(key) => {
            if (key === "report") {
              report.openPerson({ username: person.username, displayName: person.displayName, isFriend: true });
              return;
            }
            if (key === "unfriend") {
              confirm.ask({
                title: `Remove @${person.username}?`,
                body: "You will no longer see each other as friends. You can add them again later.",
                action: "Remove",
                onConfirm: () => run(() => socialApi.unfriend(person.username), `Removed @${person.username}`),
              });
              return;
            }
            if (key === "block") {
              confirm.ask({
                title: `Block @${person.username}?`,
                body: "They will not be able to find you, add you, or invite you.",
                action: "Block",
                onConfirm: () => run(() => socialApi.block(person.username), `Blocked @${person.username}`),
              });
            }
          }}>
          <Dropdown.Item id="report" textValue="Report">
            <Flag className="size-4 shrink-0 text-muted" aria-hidden />
            <Label>Report</Label>
          </Dropdown.Item>
          <Dropdown.Item id="unfriend" textValue="Remove friend" variant="danger">
            <UserMinus className="size-4 shrink-0" aria-hidden />
            <Label>Remove friend</Label>
          </Dropdown.Item>
          <Dropdown.Item id="block" textValue="Block" variant="danger">
            <Ban className="size-4 shrink-0" aria-hidden />
            <Label>Block</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

function NavRow({
  icon,
  title,
  subtitle,
  onPress,
  quiet = false,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-2xl px-2 py-2 text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent">
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${quiet ? "bg-surface-secondary text-muted" : "bg-accent-soft text-accent-soft-foreground"}`}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
    </button>
  );
}

function PageHeader({ title, subtitle, onBack }: { title: string; subtitle: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" isIconOnly aria-label="Back" onPress={onBack}>
        <ChevronLeft aria-hidden />
      </Button>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold leading-tight">{title}</h3>
        <p className="text-xs text-muted">{subtitle}</p>
      </div>
    </div>
  );
}

function FriendsListPage({
  friends,
  isBusy,
  report,
  confirm,
  onBack,
  run,
}: {
  friends: FriendsOverview;
  isBusy: boolean;
  report: ReturnType<typeof useReportFlow>;
  confirm: ReturnType<typeof useConfirmDialog>;
  onBack: () => void;
  run: (action: () => Promise<{ ok: boolean; message?: string }>, success: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const list = friends.friends;
  const filtered = useMemo(() => list.filter((person) => matchesPerson(person, query)), [list, query]);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <PageHeader title="Your friends" subtitle="Search friends" onBack={onBack} />
      <SearchField value={query} onChange={setQuery} aria-label="Search friends" fullWidth>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Search friends" autoComplete="off" autoCorrect="off" spellCheck={false} />
          <SearchField.ClearButton aria-label="Clear search" />
        </SearchField.Group>
      </SearchField>
      {list.length === 0 ? (
        <p className="rounded-2xl bg-surface-secondary px-4 py-5 text-sm text-muted">
          No friends yet. Go back and tap Add a friend.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl bg-surface-secondary px-4 py-5 text-sm text-muted">
          No matches for &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        filtered.map((person) => (
          <Row key={person.username} name={person.displayName} username={person.username}>
            <FriendMenu person={person} isBusy={isBusy} report={report} confirm={confirm} run={run} />
          </Row>
        ))
      )}
    </div>
  );
}

function SentPage({
  friends,
  isBusy,
  onBack,
  run,
}: {
  friends: FriendsOverview;
  isBusy: boolean;
  onBack: () => void;
  run: (action: () => Promise<{ ok: boolean; message?: string }>, success: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const list = friends.outgoing;
  const filtered = useMemo(() => list.filter((person) => matchesPerson(person, query)), [list, query]);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <PageHeader title="Sent" subtitle="Search pending requests" onBack={onBack} />
      <SearchField value={query} onChange={setQuery} aria-label="Search sent requests" fullWidth>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Search sent requests" autoComplete="off" autoCorrect="off" spellCheck={false} />
          <SearchField.ClearButton aria-label="Clear search" />
        </SearchField.Group>
      </SearchField>
      {list.length === 0 ? (
        <p className="rounded-2xl bg-surface-secondary px-4 py-5 text-sm text-muted">
          No sent requests. When you add someone and they have not answered yet, they show up here.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl bg-surface-secondary px-4 py-5 text-sm text-muted">
          No matches for &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        filtered.map((person) => (
          <Row key={person.username} name={person.displayName} username={person.username}>
            <Button
              size="sm"
              variant="ghost"
              isDisabled={isBusy}
              onPress={() => void run(() => socialApi.removeRequest(person.username), "Request cancelled")}>
              Cancel
            </Button>
          </Row>
        ))
      )}
    </div>
  );
}

function BlockedPage({
  friends,
  isBusy,
  onBack,
  run,
}: {
  friends: FriendsOverview;
  isBusy: boolean;
  onBack: () => void;
  run: (action: () => Promise<{ ok: boolean; message?: string }>, success: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const blocked = friends.blocked;
  const filtered = useMemo(() => blocked.filter((person) => matchesPerson(person, query)), [blocked, query]);

  return (
    <div className="flex flex-col gap-3 pt-3">
      <PageHeader title="Blocked" subtitle="Search and unblock people" onBack={onBack} />
      <SearchField value={query} onChange={setQuery} aria-label="Search blocked people" fullWidth>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Search blocked people" autoComplete="off" autoCorrect="off" spellCheck={false} />
          <SearchField.ClearButton aria-label="Clear search" />
        </SearchField.Group>
      </SearchField>
      {blocked.length === 0 ? (
        <p className="rounded-2xl bg-surface-secondary px-4 py-5 text-sm text-muted">
          Nobody blocked yet. People you block cannot find you, add you, or invite you.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl bg-surface-secondary px-4 py-5 text-sm text-muted">
          No matches for &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        filtered.map((person) => (
          <Row key={person.username} name={person.displayName || person.username} username={person.username}>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={isBusy}
              onPress={() => void run(() => socialApi.unblock(person.username), `Unblocked @${person.username}`)}>
              Unblock
            </Button>
          </Row>
        ))
      )}
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
              <PlaceSearchList
                query={placeQuery}
                browse={false}
                limit={8}
                onSelect={(picked) => {
                  setPlaceId(picked.id);
                  setPlaceQuery("");
                }}
              />
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
