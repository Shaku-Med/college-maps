"use client";

import { Button, CloseButton, Dropdown, Label, Separator, Surface, toast } from "@heroui/react";
import { Ban, Flag, LogOut, MapPin, MoreHorizontal, Navigation, Radio, Square, UserPlus } from "lucide-react";
import { useState } from "react";

import { Avatar, meetupWhere } from "@/components/people-panel";
import { useConfirmDialog } from "@/components/confirm-dialog";
import { useReportFlow } from "@/components/report-flow";
import { CollapseButton, SheetGrabber, SheetPeek } from "@/components/sheet-chrome";
import { getPlace, type Coordinate, type Place } from "@/data/campus";
import type { LiveState } from "@/hooks/use-meetup-live";
import { distanceMeters, formatDistance } from "@/lib/geo";
import type { LivePosition } from "@/lib/realtime";
import { socialApi, type Meetup } from "@/lib/social-api";

type MeetupSheetProps = {
  meetup: Meetup;
  myUsername: string;
  positions: LivePosition[];
  state: LiveState;
  /** This account is sharing from another phone or browser, not this one. */
  elsewhere?: boolean;
  onTakeOver?: () => void;
  youAt?: Coordinate;
  onMeetupChange: (meetup: Meetup) => void;
  onDirections: (place: Place) => void;
  onShowOnMap: (coordinate: Coordinate, liveId?: string) => void;
  onCollapse: () => void;
  onClose: () => void;
};

const stateLabel: Record<LiveState, string> = {
  connecting: "Connecting",
  live: "Sharing your location",
  offline: "Not sharing",
};

export function MeetupSheet({
  meetup,
  myUsername,
  positions,
  state,
  elsewhere = false,
  onTakeOver,
  youAt,
  onMeetupChange,
  onDirections,
  onShowOnMap,
  onCollapse,
  onClose,
}: MeetupSheetProps) {
  const [isBusy, setIsBusy] = useState(false);
  const report = useReportFlow();
  const confirm = useConfirmDialog();
  const destination = meetup.destination;
  const place = destination?.kind === "place" ? getPlace(destination.placeId) : undefined;
  const headingToYou = destination?.kind === "member" && destination.username === myUsername;
  const target =
    headingToYou
      ? undefined
      : destination?.kind === "member"
        ? positions.find((p) => p.member === destination.liveId)?.coordinate
        : destination?.kind === "pin" && destination.lat !== undefined && destination.lng !== undefined
          ? { latitude: destination.lat, longitude: destination.lng }
          : place?.coordinate;
  const away = youAt && target ? formatDistance(distanceMeters(youAt, target)) : undefined;

  async function run(action: () => Promise<{ ok: boolean; message?: string; data?: Meetup }>, done: string) {
    setIsBusy(true);
    const res = await action();
    setIsBusy(false);
    if (!res.ok || !res.data) {
      toast.danger(res.message ?? "That didn't work.");
      return;
    }
    toast.success(done);
    onMeetupChange(res.data);
    onClose();
  }

  async function inviteBack(username: string, name: string) {
    setIsBusy(true);
    const res = await socialApi.inviteToMeetup(meetup.id, [username]);
    setIsBusy(false);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    toast.success(`${name} is invited again`);
    onMeetupChange(res.data);
  }

  const canInvite = meetup.yourRole === "host" && meetup.visibility === "private" && meetup.active;
  const canModerate = meetup.yourRole !== "host" && meetup.host.username !== myUsername;

  async function blockHost() {
    setIsBusy(true);
    const res = await socialApi.block(meetup.host.username);
    setIsBusy(false);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    toast.success(`Blocked @${meetup.host.username}`);
    onClose();
  }

  return (
    <Surface
      role="region"
      aria-label="Meetup"
      className="animate-sheet-in flex max-h-[70dvh] flex-col rounded-t-[28px] shadow-2xl md:max-h-[calc(100dvh-2rem)] md:rounded-3xl">
      {report.dialog}
      {confirm.dialog}
      <SheetGrabber />

      <div className="flex items-center gap-3 px-5 pb-2 pt-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
          <MapPin className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight">{meetup.note || meetupWhere(meetup, myUsername)}</h2>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted">
            <Radio className={state === "live" && !elsewhere ? "size-3 text-accent" : "size-3"} aria-hidden />
            {elsewhere ? "Sharing from your other device" : stateLabel[state]}
          </p>
        </div>
        {canModerate ? (
          <Dropdown>
            <Button size="sm" variant="ghost" isIconOnly aria-label="Report or block" isDisabled={isBusy}>
              <MoreHorizontal aria-hidden />
            </Button>
            <Dropdown.Popover>
              <Dropdown.Menu
                onAction={(key) => {
                  if (key === "report") {
                    report.openMeetup(meetup);
                    return;
                  }
                  if (key === "block") {
                    confirm.ask({
                      title: `Block @${meetup.host.username}?`,
                      body: "Their events disappear for you, and they cannot add you or invite you.",
                      action: "Block",
                      onConfirm: () => blockHost(),
                    });
                  }
                }}>
                <Dropdown.Item id="report" textValue="Report this event">
                  <Flag className="size-4 shrink-0 text-muted" aria-hidden />
                  <Label>Report this event</Label>
                </Dropdown.Item>
                <Dropdown.Item id="block" textValue={`Block @${meetup.host.username}`} variant="danger">
                  <Ban className="size-4 shrink-0" aria-hidden />
                  <Label>Block @{meetup.host.username}</Label>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        ) : null}
        <CollapseButton onCollapse={onCollapse} />
        <CloseButton aria-label="Stop sharing" onPress={onClose} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,var(--map-safe-bottom))] pt-1">
        {elsewhere ? (
          <div className="mb-3 flex items-center gap-3 rounded-2xl bg-surface-secondary px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-muted">
              You&apos;re signed in on another device that is sharing your location for this meetup.
            </p>
            <Button size="sm" onPress={onTakeOver}>
              Share from here
            </Button>
          </div>
        ) : null}
        <div className="flex items-center gap-3 rounded-2xl bg-surface-secondary px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">Heading to</p>
            <p className="truncate text-sm font-medium">{meetupWhere(meetup, myUsername)}</p>
          </div>
          {place ? (
            <Button size="sm" onPress={() => onDirections(place)}>
              <Navigation aria-hidden />
              Directions
            </Button>
          ) : target ? (
            <Button size="sm" variant="secondary" onPress={() => onShowOnMap(target, destination?.kind === "member" ? destination.liveId : undefined)}>
              Show
            </Button>
          ) : null}
        </div>
        {away ? <p className="px-1 pt-2 text-xs text-muted">{away} away</p> : null}

        <h3 className="pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">Who&apos;s here</h3>
        {meetup.members.map((member) => {
          const isYou = member.username === myUsername;
          const live = isYou ? undefined : positions.find((p) => p.member === member.liveId);
          const distance = live && youAt ? formatDistance(distanceMeters(youAt, live.coordinate)) : undefined;
          const status = isYou
            ? state === "live"
              ? "sharing your location"
              : stateLabel[state].toLowerCase()
            : member.status === "joined"
              ? live
                ? (distance ? `${distance} away` : "sharing location")
                : "joined, not sharing yet"
              : member.status === "invited"
                ? "invited"
                : member.staysOut
                  ? "left and asked not to be invited back"
                  : member.status === "declined"
                    ? "can't make it"
                    : "left";
          const invitable =
            canInvite && member.role === "guest" && (member.status === "left" || member.status === "declined") && !member.staysOut;
          return (
            <div key={member.username} className="flex items-center gap-3 py-2">
              <Avatar name={member.displayName} username={member.username} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {isYou ? "You" : member.displayName}
                  {member.role === "host" ? <span className="ml-1.5 text-xs font-normal text-muted">host</span> : null}
                </p>
                <p className="truncate text-xs text-muted">{status}</p>
              </div>
              {live ? (
                <Button size="sm" variant="ghost" onPress={() => onShowOnMap(live.coordinate, live.member)}>
                  Find
                </Button>
              ) : invitable ? (
                <Button size="sm" variant="secondary" isDisabled={isBusy} onPress={() => void inviteBack(member.username, member.displayName)}>
                  <UserPlus aria-hidden />
                  Invite back
                </Button>
              ) : null}
            </div>
          );
        })}

        <Separator className="my-3" />
        <p className="pb-3 text-xs text-muted">
          Your location is shared with this group while you&apos;re in the meetup, and never saved. Close to stop sharing.
        </p>

        {meetup.yourRole === "host" ? (
          <Button
            variant="secondary"
            isPending={isBusy}
            onPress={() =>
              confirm.ask({
                title: "End this meetup?",
                body: "Everyone stops sharing their location.",
                action: "End meetup",
                onConfirm: () => run(() => socialApi.endMeetup(meetup.id), "Meetup ended"),
              })
            }
            fullWidth>
            <Square aria-hidden />
            End for everyone
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              isPending={isBusy}
              onPress={() => void run(() => socialApi.leaveMeetup(meetup.id), "You left the meetup")}
              fullWidth>
              <LogOut aria-hidden />
              Leave
            </Button>
            {meetup.visibility === "private" ? (
              <Button
                variant="ghost"
                isDisabled={isBusy}
                onPress={() =>
                  confirm.ask({
                    title: "Leave for good?",
                    body: "The host will not be able to invite you back to this meetup.",
                    action: "Leave for good",
                    onConfirm: () => run(() => socialApi.leaveMeetup(meetup.id, true), "You left for good"),
                  })
                }
                fullWidth>
                Leave and don&apos;t invite me back
              </Button>
            ) : null}
            {meetup.visibility === "private" ? (
              <p className="px-1 text-xs text-muted">If you leave by mistake, the host can invite you back.</p>
            ) : null}
          </div>
        )}
      </div>
    </Surface>
  );
}

export function MeetupPeek({
  meetup,
  myUsername,
  state,
  onExpand,
}: {
  meetup: Meetup;
  myUsername: string;
  state: LiveState;
  onExpand: () => void;
}) {
  return (
    <SheetPeek
      icon={<Radio className={state === "live" ? "size-4 text-accent" : "size-4"} aria-hidden />}
      title={meetup.note || meetupWhere(meetup, myUsername)}
      subtitle={`${stateLabel[state]} · tap to open`}
      label="Open meetup"
      onExpand={onExpand}
    />
  );
}
