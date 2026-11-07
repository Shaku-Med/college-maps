"use client";

import { Button, Surface, Switch } from "@heroui/react";
import {
  Bus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Flag,
  LocateFixed,
  CirclePlus,
  Navigation2,
  RefreshCw,
  SquareParking,
  Undo2,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";

import { useState, type KeyboardEvent } from "react";

import { Presence } from "@/components/presence";
import { StepIcon } from "@/components/step-icon";
import { StopItem } from "@/components/stop-item";
import { isAmenity, type AmenityKind } from "@/data/amenities";
import type { Place } from "@/data/campus";
import { QUICK_STOPS } from "@/lib/amenity-search";
import type { BreakOffer } from "@/lib/breaks";
import { AMENITY_ICONS } from "@/lib/categories";
import { useDragPanel } from "@/hooks/use-drag-panel";
import { useNow } from "@/hooks/use-now";
import { arrivalClock, formatRouteTime } from "@/lib/directions";
import { formatDistance } from "@/lib/geo";
import { stepText } from "@/lib/instructions";
import { parkingChoices, parkingDetail, parkingTitle, type ParkingPrompt } from "@/lib/parking";
import type { Route, RouteProgress } from "@/lib/routing";

export type RouteNotice = "rerouted" | "faster" | "switched";

type NavigationHudProps = {
  destination: Place;
  route: Route;
  progress?: RouteProgress;
  isFollowing: boolean;
  notice?: RouteNotice;
  isWrongWay: boolean;
  hasAlternate: boolean;
  hasArrived: boolean;
  weakSignal: boolean;
  /** Moving faster than this way of travel allows, like walking directions on a bus. Guidance holds still. */
  isRiding: boolean;
  voiceOn: boolean;
  onToggleVoice: () => void;
  onRecenter: () => void;
  isRotated: boolean;
  onPointNorth: () => void;
  /** The map turns to face the way the walker is going. Off means north stays up. */
  facingUp: boolean;
  onToggleFacing: () => void;
  /** Set when there is no live location and the walker moves through the steps themselves. */
  manualStep: number | null;
  onStepBack: () => void;
  onStepNext: () => void;
  avoidStairs: boolean;
  /** Stairs only matter on foot. */
  canAvoidStairs: boolean;
  onAvoidStairsChange: (avoid: boolean) => void;
  /** The place after this one, when this one is a stop on the way. Arriving then offers to go on. */
  nextStopName?: string;
  /** Which stop is being walked to, like "Stop 1 of 2", while there are stops ahead. */
  stopLabel?: string;
  /** Shown once arrived, such as which floor the room is on. */
  arrivalNote?: string;
  onContinue?: () => void;
  onEnd: () => void;
  /** A parking choice offered while driving, answered with a tap. */
  parking?: ParkingPrompt | null;
  onParkingPrimary?: () => void;
  onParkingSecondary?: () => void;
  /** A rest offered on a walk with time to spare. Not answering is a no. */
  breakOffer?: BreakOffer | null;
  onTakeBreak?: () => void;
  onSkipBreak?: () => void;
  /** The stops still ahead, each with its place in the trip, so any can be dropped. */
  stopsAhead?: StopAhead[];
  onRemoveStop?: (index: number) => void;
  /** Kinds with one close by, offered in a tap; far from campus there are none and only the search is offered. */
  quickStops?: AmenityKind[];
  onAddStopKind?: (kind: AmenityKind) => void;
  /** Opens the search to pick any place as the next stop. */
  onAddStopSearch?: () => void;
};

export type StopAhead = { index: number; place: Place; number: number };

// Within this of the coming turn, the one after it shows too, the way Apple Maps says "Then".
const THEN_WITHIN_METERS = 60;

/** The little bar that says a panel can be pulled, a bit livelier under the finger. */
function PanelHandle({ dragging, className }: { dragging: boolean; className: string }) {
  return (
    <div aria-hidden className={`flex cursor-grab touch-none justify-center active:cursor-grabbing ${className}`}>
      <span className={`h-1 rounded-full bg-current transition-all duration-200 ${dragging ? "w-12 opacity-60" : "w-9 opacity-30"}`} />
    </div>
  );
}

/** A friendly offer to rest at a seat just ahead, above the trip panel like a parking choice. */
function BreakCard({ offer, onTake, onSkip }: { offer: BreakOffer; onTake?: () => void; onSkip?: () => void }) {
  const Seat = AMENITY_ICONS[offer.spot.amenity];
  return (
    <div role="status" aria-live="polite" className="animate-sheet-in mx-3 mb-3 md:mx-0">
      <Surface className="glass-chrome rounded-3xl p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Seat className="size-5" aria-hidden />
          </span>
          <p className="min-w-0 flex-1 pt-0.5 text-sm font-medium leading-snug">{offer.line}</p>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" className="flex-1" onPress={onTake}>
            Take a break
          </Button>
          <Button variant="secondary" className="flex-1" onPress={onSkip}>
            Keep going
          </Button>
        </div>
      </Surface>
    </div>
  );
}

/** Stops at any point in a trip: the ones ahead, each removable, then the nearest trash can, bench, and the like, or any place. */
function TripStops({
  ahead,
  onRemove,
  kinds,
  onKind,
  onAnother,
}: {
  ahead: StopAhead[];
  onRemove?: (index: number) => void;
  kinds: AmenityKind[];
  onKind?: (kind: AmenityKind) => void;
  onAnother?: () => void;
}) {
  const quick = QUICK_STOPS.filter(({ kind }) => kinds.includes(kind));
  return (
    <div className="pt-2">
      <p className="pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{ahead.length > 0 ? "Stops" : "Add a stop"}</p>
      {ahead.length > 0 ? (
        <ol aria-label="Stops ahead" className="mb-2 flex flex-col gap-1.5">
          {ahead.map(({ index, place, number }) => (
            <StopItem key={`${place.id}-${index}`} stop={place} number={number} onRemove={onRemove && (() => onRemove(index))} />
          ))}
        </ol>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {quick.map(({ kind, label }) => {
          const Icon = AMENITY_ICONS[kind];
          return (
            <Button key={kind} size="sm" variant="secondary" className="gap-1.5 rounded-full" onPress={() => onKind?.(kind)}>
              <Icon className="size-3.5" aria-hidden />
              {label}
            </Button>
          );
        })}
        <Button size="sm" variant="secondary" className="gap-1.5 rounded-full text-accent" onPress={onAnother}>
          <CirclePlus className="size-3.5" aria-hidden />
          {quick.length > 0 ? "Another place" : ahead.length > 0 ? "Add another stop" : "Search places"}
        </Button>
      </div>
    </div>
  );
}

/** A parking choice above the trip panel, the way Apple Maps offers one. */
function ParkingCard({ prompt, onPrimary, onSecondary }: { prompt: ParkingPrompt; onPrimary?: () => void; onSecondary?: () => void }) {
  const { primary, secondary } = parkingChoices(prompt);
  return (
    <div role="status" aria-live="polite" className="animate-sheet-in mx-3 mb-3 md:mx-0">
      <Surface className="glass-chrome rounded-3xl p-4 shadow-xl">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <SquareParking className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold leading-tight">{parkingTitle(prompt)}</p>
            <p className="truncate text-sm text-muted">{parkingDetail(prompt)}</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" className="flex-1" onPress={onPrimary}>
            {primary}
          </Button>
          <Button variant="secondary" className="flex-1" onPress={onSecondary}>
            {secondary}
          </Button>
        </div>
      </Surface>
    </div>
  );
}

/** One of the trip settings, with the same switch the directions panel uses. */
function TripSetting({ label, isSelected, onChange }: { label: string; isSelected: boolean; onChange: (next: boolean) => void }) {
  return (
    <Switch isSelected={isSelected} onChange={onChange} className="w-full">
      <Switch.Content className="w-full justify-between py-2">
        <span className="text-base">{label}</span>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}

export function NavigationHud({
  destination,
  route,
  progress,
  isFollowing,
  notice,
  isWrongWay,
  hasAlternate,
  hasArrived,
  weakSignal,
  isRiding,
  voiceOn,
  onToggleVoice,
  onRecenter,
  isRotated,
  onPointNorth,
  facingUp,
  onToggleFacing,
  manualStep,
  onStepBack,
  onStepNext,
  avoidStairs,
  canAvoidStairs,
  onAvoidStairsChange,
  nextStopName,
  stopLabel,
  arrivalNote,
  onContinue,
  onEnd,
  parking,
  onParkingPrimary,
  onParkingSecondary,
  breakOffer,
  onTakeBreak,
  onSkipBreak,
  stopsAhead = [],
  onRemoveStop,
  quickStops = [],
  onAddStopKind,
  onAddStopSearch,
}: NavigationHudProps) {
  // The turns ahead at the top and the trip settings at the bottom: one open at a time, so the map stays in view.
  const [panel, setPanel] = useState<"steps" | "trip" | null>(null);
  const now = useNow();
  const current = progress?.stepIndex ?? 0;
  const next = route.steps[Math.min(current + 1, route.steps.length - 1)];
  const toNext = Math.max(0, next.startDistance - (progress?.distanceAlong ?? 0));
  const remaining = progress?.remaining ?? route.distance;
  // Stepping through by hand shows the step being walked; following live shows the one coming up.
  const stepping = manualStep !== null;
  const shownStep = stepping ? route.steps[manualStep] : next;
  const shownDistance = stepping ? shownStep.length : toNext;
  const shownIndex = stepping ? manualStep : Math.min(current + 1, route.steps.length - 1);
  const ahead = route.steps.slice(shownIndex + 1);
  const canOpenSteps = !hasArrived && !isWrongWay && ahead.length > 0;
  const stepsOpen = panel === "steps" && canOpenSteps;
  // At a stop with more to go, the trip panel still opens so stops can be added or dropped.
  const canOpenTrip = !hasArrived || Boolean(nextStopName);
  const tripOpen = panel === "trip" && canOpenTrip;
  const along = progress?.distanceAlong ?? 0;
  const arrive = arrivalClock(route, remaining, now);
  const then = ahead[0];
  const showThen = !stepping && !stepsOpen && then !== undefined && shownDistance <= THEN_WITHIN_METERS;
  const showPill = !hasArrived && (isRiding || Boolean(notice) || (hasAlternate && !isWrongWay) || weakSignal);
  const { clip: stepsClip, content: stepsContent, mounted: stepsMounted, dragging: stepsDragging, zone: stepsZone } = useDragPanel({
    edge: "top",
    open: stepsOpen,
    canOpen: canOpenSteps,
    onOpenChange: (open) => setPanel(open ? "steps" : null),
  });
  const { clip: tripClip, content: tripContent, mounted: tripMounted, dragging: tripDragging, zone: tripZone } = useDragPanel({
    edge: "bottom",
    open: tripOpen,
    canOpen: canOpenTrip,
    onOpenChange: (open) => setPanel(open ? "trip" : null),
  });
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && panel) setPanel(null);
  };

  return (
    <>
      <div
        data-leave="up"
        className="pointer-events-none absolute inset-x-0 top-0 z-30 pl-[var(--map-safe-left)] pr-[var(--map-safe-right)] pt-[var(--map-safe-top)] md:left-4 md:right-auto md:w-[420px] md:px-0 md:pt-4">
        <div
          {...stepsZone}
          onKeyDown={closeOnEscape}
          className={
            isWrongWay && !hasArrived
              ? "glass-chrome animate-sheet-in pointer-events-auto touch-none select-none overflow-hidden rounded-3xl bg-danger/90 text-danger-foreground shadow-xl backdrop-blur-xl transition-colors duration-300 [--glass-strength:80%] [--glass-tint:var(--danger)]"
              : "glass-chrome animate-sheet-in pointer-events-auto touch-none select-none overflow-hidden rounded-3xl bg-accent/90 text-accent-foreground shadow-xl backdrop-blur-xl transition-colors duration-300 [--glass-strength:80%] [--glass-tint:var(--accent)]"
          }>
          <p role="status" aria-live="polite" className="sr-only">
            {hasArrived
              ? nextStopName
                ? `Stop reached: ${destination.name}. Next, ${nextStopName}`
                : [`You have arrived at ${destination.name}.`, arrivalNote].filter(Boolean).join(" ")
              : isWrongWay
                ? "Wrong way"
                : `${formatDistance(shownDistance)}, ${stepText(shownStep, destination.name)}`}
          </p>
          <button
            type="button"
            data-panel-toggle
            aria-expanded={canOpenSteps ? stepsOpen : undefined}
            aria-label={canOpenSteps ? (stepsOpen ? "Hide the turns ahead" : "Show every turn ahead") : undefined}
            disabled={!canOpenSteps}
            onClick={() => setPanel(stepsOpen ? null : "steps")}
            className={`flex w-full touch-none items-center gap-4 px-5 pt-4 text-left transition-opacity duration-150 enabled:cursor-pointer enabled:active:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-current ${canOpenSteps ? "pb-1" : "pb-4"}`}>
            {hasArrived ? (
              <span key="arrived" className="animate-step-in flex min-w-0 flex-1 items-center gap-4">
                <Flag className="size-10 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-2xl font-bold leading-tight tracking-tight">{nextStopName ? "Stop reached" : "You have arrived"}</span>
                  <span className="block truncate text-base opacity-90">
                    {nextStopName ? `${destination.name} · Next: ${nextStopName}` : destination.name}
                  </span>
                  {arrivalNote ? <span className="mt-1.5 block text-base font-semibold leading-snug">{arrivalNote}</span> : null}
                </span>
              </span>
            ) : isWrongWay ? (
              <span key="wrong" className="animate-step-in flex min-w-0 flex-1 items-center gap-4">
                <Undo2 className="size-10 shrink-0" strokeWidth={2.25} aria-hidden />
                <span className="min-w-0">
                  <span className="block text-3xl font-bold leading-tight tracking-tight">Wrong way</span>
                  <span className="block text-base leading-snug opacity-90">Turn around, or keep going and we will re-route</span>
                </span>
              </span>
            ) : (
              <>
                <span key={shownIndex} className="animate-step-in flex min-w-0 flex-1 items-center gap-4">
                  <StepIcon step={shownStep} className="size-10 shrink-0" strokeWidth={2.25} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-3xl font-bold leading-tight tracking-tight tabular-nums">{formatDistance(shownDistance)}</span>
                    <span className="line-clamp-2 text-lg font-medium leading-snug">{stepText(shownStep, destination.name)}</span>
                  </span>
                </span>
                {canOpenSteps ? (
                  <ChevronDown
                    className={`hidden size-5 shrink-0 opacity-80 transition-transform duration-300 md:block ${stepsOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                ) : null}
              </>
            )}
          </button>
          {showThen && !hasArrived && !isWrongWay ? (
            <div key={shownIndex} className="animate-fade-in mx-5 mt-2 flex items-center gap-2 border-t border-current/20 pt-2 text-sm">
              <span className="font-semibold opacity-85">Then</span>
              <StepIcon step={then} className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{stepText(then, destination.name)}</span>
            </div>
          ) : null}
          <div ref={stepsClip} inert={!stepsOpen} className="h-0 overflow-hidden">
            {stepsMounted ? (
              <div ref={stepsContent} className="px-5 pt-3">
                <div className="border-t border-current/20">
                  <ol
                    data-panel-scroll
                    aria-label="Turns ahead"
                    className="panel-scroll max-h-[45dvh] touch-pan-y overflow-y-auto overscroll-contain">
                    {ahead.map((step, offset) => (
                      <li key={shownIndex + 1 + offset} className="flex items-center gap-3 py-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-current/15">
                          <StepIcon step={step} className="size-5" />
                        </span>
                        <span className="min-w-0 flex-1 text-base leading-snug">{stepText(step, destination.name)}</span>
                        <span className="text-sm font-medium tabular-nums opacity-85">
                          {formatDistance(Math.max(0, step.startDistance - along))}
                        </span>
                      </li>
                    ))}
                  </ol>
                  <p className="pt-2 text-center text-sm opacity-85">
                    {ahead.length} more {ahead.length === 1 ? "turn" : "turns"} · {formatDistance(remaining)} to go
                  </p>
                </div>
              </div>
            ) : null}
          </div>
          {canOpenSteps ? <PanelHandle dragging={stepsDragging} className="pb-2 pt-2.5" /> : null}
        </div>
        <Presence show={showPill}>
          {isRiding ? (
            <p
              role="status"
              className="animate-pill-in pointer-events-auto mx-auto mt-2 flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full bg-overlay px-3.5 py-2 text-sm font-medium text-overlay-foreground shadow-md">
              <Bus className="size-4 shrink-0 text-accent" aria-hidden />
              {route.travel === "bike"
                ? "Looks like you're in a vehicle. Directions pick up when you're back on your bike"
                : "Looks like you're riding. Directions pick up when you're back on foot"}
            </p>
          ) : notice ? (
            <p
              role="status"
              className="animate-pill-in pointer-events-auto mx-auto mt-2 flex w-fit items-center gap-1.5 rounded-full bg-overlay px-3.5 py-2 text-sm font-medium text-overlay-foreground shadow-md">
              {notice === "faster" ? (
                <Zap className="size-4 text-accent" aria-hidden />
              ) : notice === "switched" ? (
                <Undo2 className="size-4 text-accent" aria-hidden />
              ) : (
                <RefreshCw className="size-4 text-accent" aria-hidden />
              )}
              {notice === "faster"
                ? "Found a faster way"
                : notice === "switched"
                  ? "Back on your earlier route"
                  : "Route updated. Your old route is faded"}
            </p>
          ) : hasAlternate && !isWrongWay ? (
            <p className="animate-pill-in pointer-events-none mx-auto mt-2 w-fit rounded-full bg-overlay px-3.5 py-1.5 text-sm text-muted shadow-sm">
              Faded line is your earlier route. Walk or tap it to switch
            </p>
          ) : weakSignal ? (
            <p className="animate-pill-in pointer-events-auto mx-auto mt-2 w-fit rounded-full bg-overlay px-3.5 py-1.5 text-sm text-muted shadow-sm">
              Weak GPS signal, position may jump
            </p>
          ) : null}
        </Presence>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-30 md:bottom-4 md:left-4 md:right-auto md:w-[420px]">
        {!hasArrived && !stepping ? (
          <div className="mb-3 flex justify-end gap-2 px-3 md:px-0">
            {!facingUp && isRotated ? (
              <Button
                isIconOnly
                variant="secondary"
                aria-label="Point north"
                onPress={onPointNorth}
                className="animate-pill-in rounded-full bg-overlay shadow-lg">
                <Compass aria-hidden />
              </Button>
            ) : null}
            <Button
              isIconOnly
              variant="secondary"
              aria-label={facingUp ? "Keep north up" : "Turn the map the way I am going"}
              aria-pressed={facingUp}
              onPress={onToggleFacing}
              className={`rounded-full shadow-lg transition-colors duration-200 ${facingUp ? "bg-accent-soft text-accent-soft-foreground" : "bg-overlay"}`}>
              {facingUp ? <Navigation2 aria-hidden /> : <Compass aria-hidden />}
            </Button>
            {!isFollowing ? (
              <Button variant="secondary" onPress={onRecenter} className="animate-pill-in rounded-full bg-overlay shadow-lg">
                <LocateFixed aria-hidden />
                Recenter
              </Button>
            ) : null}
          </div>
        ) : null}
        <Presence show={Boolean(parking || breakOffer)}>
          {parking ? (
            <ParkingCard prompt={parking} onPrimary={onParkingPrimary} onSecondary={onParkingSecondary} />
          ) : breakOffer ? (
            <BreakCard offer={breakOffer} onTake={onTakeBreak} onSkip={onSkipBreak} />
          ) : null}
        </Presence>
        <div {...tripZone} onKeyDown={closeOnEscape} className="touch-none select-none">
          <Surface className="glass-chrome overflow-hidden rounded-t-[28px] pb-[max(1rem,var(--map-safe-bottom))] shadow-2xl md:rounded-3xl md:pb-4">
            {canOpenTrip ? <PanelHandle dragging={tripDragging} className="pb-2 pt-2.5" /> : <div className="h-4" />}
            <div className="flex items-center gap-3 px-5">
              <button
                type="button"
                data-panel-toggle
                aria-expanded={canOpenTrip ? tripOpen : undefined}
                aria-label={canOpenTrip ? (tripOpen ? "Hide trip settings" : "Show trip settings") : undefined}
                disabled={!canOpenTrip}
                onClick={() => setPanel(tripOpen ? null : "trip")}
                className="flex min-w-0 flex-1 touch-none items-center gap-2 rounded-2xl text-left transition-opacity duration-150 enabled:cursor-pointer enabled:active:opacity-70 focus-visible:outline-2 focus-visible:outline-focus">
                <span className="min-w-0 flex-1">
                  {hasArrived ? (
                    <span className="block text-lg font-semibold leading-tight">{nextStopName ? `Next: ${nextStopName}` : "Enjoy your class"}</span>
                  ) : stepping ? (
                    <>
                      <span className="block text-xl font-bold leading-tight tabular-nums">
                        Step {manualStep + 1} of {route.steps.length}
                      </span>
                      <span className="block truncate text-sm text-muted">Location is off, so tap through the steps</span>
                    </>
                  ) : (
                    <>
                      <span className="block text-2xl font-bold leading-tight tracking-tight tabular-nums">{formatRouteTime(route, remaining)}</span>
                      <span className="block truncate text-sm text-muted tabular-nums">
                        {[formatDistance(remaining), arrive, stopLabel].filter(Boolean).join(" · ")}
                      </span>
                    </>
                  )}
                </span>
                {canOpenTrip ? (
                  <ChevronUp
                    className={`hidden size-5 shrink-0 text-muted transition-transform duration-300 md:block ${tripOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                ) : null}
              </button>
              {stepping && !hasArrived ? (
                <>
                  <Button
                    isIconOnly
                    variant="secondary"
                    size="lg"
                    aria-label="Previous step"
                    isDisabled={manualStep === 0}
                    onPress={onStepBack}>
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button isIconOnly variant="primary" size="lg" aria-label="Next step" onPress={onStepNext}>
                    <ChevronRight aria-hidden />
                  </Button>
                </>
              ) : null}
              <Button
                isIconOnly
                variant="ghost"
                size="lg"
                aria-label={voiceOn ? "Mute voice directions" : "Turn on voice directions"}
                aria-pressed={voiceOn}
                onPress={onToggleVoice}
                className={`transition-colors duration-200 ${voiceOn ? "bg-default" : ""}`}>
                {voiceOn ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
              </Button>
              {hasArrived && nextStopName && onContinue ? (
                <Button variant="primary" size="lg" onPress={onContinue}>
                  Continue
                </Button>
              ) : null}
              <Button variant={hasArrived && !nextStopName ? "primary" : "danger-soft"} size="lg" onPress={onEnd}>
                {hasArrived && !nextStopName ? "Done" : "End"}
              </Button>
            </div>
            <div ref={tripClip} inert={!tripOpen} className="h-0 overflow-hidden">
              {tripMounted ? (
                <div ref={tripContent} className="px-5 pt-3">
                  <div
                    data-panel-scroll
                    className="panel-scroll max-h-[45dvh] touch-pan-y overflow-y-auto overscroll-contain border-t border-separator pb-1 pt-3">
                    {hasArrived ? null : (
                      <p className="pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                        Arriving at {isAmenity(destination) ? destination.name : (destination.label ?? destination.id)} at {arrive} · Step {shownIndex + 1} of{" "}
                        {route.steps.length}
                      </p>
                    )}
                    {canAvoidStairs ? (
                      <TripSetting label="Avoid stairs" isSelected={avoidStairs} onChange={onAvoidStairsChange} />
                    ) : null}
                    <TripSetting label="Spoken directions" isSelected={voiceOn} onChange={() => onToggleVoice()} />
                    <TripSetting label="Turn the map with me" isSelected={facingUp} onChange={() => onToggleFacing()} />
                    <TripStops
                      ahead={stopsAhead}
                      onRemove={onRemoveStop}
                      kinds={quickStops}
                      onKind={onAddStopKind}
                      onAnother={onAddStopSearch}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </Surface>
        </div>
      </div>
    </>
  );
}
