"use client";

import { Button, CloseButton, Separator, Surface, toast } from "@heroui/react";
import { LogOut, MapPin, Navigation, Radio, Square } from "lucide-react";
import { useState } from "react";

import { Avatar, meetupWhere } from "@/components/people-panel";
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
  youAt,
  onMeetupChange,
  onDirections,
  onShowOnMap,
  onCollapse,
  onClose,
}: MeetupSheetProps) {
  const [isBusy, setIsBusy] = useState(false);
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

  return (
    <Surface
      role="region"
      aria-label="Meetup"
      className="animate-sheet-in flex max-h-[70dvh] flex-col rounded-t-[28px] shadow-2xl md:max-h-[calc(100dvh-2rem)] md:rounded-3xl">
      <SheetGrabber onCollapse={onCollapse} />

      <div className="flex items-center gap-3 px-5 pb-2 pt-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
          <MapPin className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold leading-tight">{meetup.note || meetupWhere(meetup, myUsername)}</h2>
          <p className="flex items-center gap-1.5 truncate text-xs text-muted">
            <Radio className={state === "live" ? "size-3 text-accent" : "size-3"} aria-hidden />
            {stateLabel[state]}
          </p>
        </div>
        <CollapseButton onCollapse={onCollapse} />
        <CloseButton aria-label="Stop sharing" onPress={onClose} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,var(--map-safe-bottom))] pt-1">
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
                : member.status === "declined"
                  ? "can't make it"
                  : "left";
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
            onPress={() => void run(() => socialApi.endMeetup(meetup.id), "Meetup ended")}
            fullWidth>
            <Square aria-hidden />
            End for everyone
          </Button>
        ) : (
          <Button
            variant="secondary"
            isPending={isBusy}
            onPress={() => void run(() => socialApi.leaveMeetup(meetup.id), "You left the meetup")}
            fullWidth>
            <LogOut aria-hidden />
            Leave
          </Button>
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
