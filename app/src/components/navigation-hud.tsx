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
  Navigation2,
  RefreshCw,
  Undo2,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";

import { useState } from "react";

import { StepIcon } from "@/components/step-icon";
import type { Place } from "@/data/campus";
import { formatRouteTime } from "@/lib/directions";
import { formatDistance } from "@/lib/geo";
import { stepText } from "@/lib/instructions";
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
  onContinue?: () => void;
  onEnd: () => void;
};

/** One of the trip settings, with the same switch the directions panel uses. */
function TripSetting({ label, isSelected, onChange }: { label: string; isSelected: boolean; onChange: (next: boolean) => void }) {
  return (
    <Switch isSelected={isSelected} onChange={onChange} className="w-full">
      <Switch.Content className="w-full justify-between py-1.5">
        <span className="text-sm">{label}</span>
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
  onContinue,
  onEnd,
}: NavigationHudProps) {
  // The turns ahead at the top and the trip settings at the bottom: one open at a time, so the map stays in view.
  const [panel, setPanel] = useState<"steps" | "trip" | null>(null);
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
  const tripOpen = panel === "trip" && !hasArrived;
  const along = progress?.distanceAlong ?? 0;

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 pl-[var(--map-safe-left)] pr-[var(--map-safe-right)] pt-[var(--map-safe-top)] md:left-4 md:right-auto md:w-[420px] md:px-0 md:pt-4">
        <div
          className={
            isWrongWay && !hasArrived
              ? "glass-chrome animate-sheet-in pointer-events-auto overflow-hidden rounded-3xl bg-danger/90 text-danger-foreground shadow-xl backdrop-blur-xl transition-colors duration-300 [--glass-strength:80%] [--glass-tint:var(--danger)]"
              : "glass-chrome animate-sheet-in pointer-events-auto overflow-hidden rounded-3xl bg-accent/90 text-accent-foreground shadow-xl backdrop-blur-xl transition-colors duration-300 [--glass-strength:80%] [--glass-tint:var(--accent)]"
          }>
        <p role="status" aria-live="polite" className="sr-only">
          {hasArrived
            ? nextStopName
              ? `Stop reached: ${destination.name}. Next, ${nextStopName}`
              : `You have arrived at ${destination.name}`
            : isWrongWay
              ? "Wrong way"
              : `${formatDistance(shownDistance)}, ${stepText(shownStep, destination.name)}`}
        </p>
        <button
          type="button"
          aria-expanded={canOpenSteps ? stepsOpen : undefined}
          aria-label={canOpenSteps ? (stepsOpen ? "Hide the turns ahead" : "Show every turn ahead") : undefined}
          disabled={!canOpenSteps}
          onClick={() => setPanel(stepsOpen ? null : "steps")}
          className="flex w-full items-center gap-4 px-5 py-4 text-left transition-transform duration-150 enabled:cursor-pointer enabled:active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-current">
          {hasArrived ? (
            <>
              <Flag className="size-8 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-xl font-semibold leading-tight">{nextStopName ? "Stop reached" : "You have arrived"}</p>
                <p className="truncate text-sm opacity-85">
                  {nextStopName ? `${destination.name} · Next: ${nextStopName}` : destination.name}
                </p>
              </div>
            </>
          ) : isWrongWay ? (
            <>
              <Undo2 className="size-9 shrink-0" strokeWidth={2.25} aria-hidden />
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-tight tracking-tight">Wrong way</p>
                <p className="truncate text-base opacity-90">Turn around, or keep going and we will re-route</p>
              </div>
            </>
          ) : (
            <>
              <StepIcon step={shownStep} className="size-9 shrink-0" strokeWidth={2.25} />
              <div className="min-w-0 flex-1">
                <p className="text-2xl font-semibold leading-tight tracking-tight">{formatDistance(shownDistance)}</p>
                <p className="truncate text-base opacity-90">{stepText(shownStep, destination.name)}</p>
              </div>
              {canOpenSteps ? (
                stepsOpen ? (
                  <ChevronUp className="size-5 shrink-0 opacity-80" aria-hidden />
                ) : (
                  <ChevronDown className="size-5 shrink-0 opacity-80" aria-hidden />
                )
              ) : null}
            </>
          )}
        </button>
        {stepsOpen ? (
          <div className="animate-fade-in border-t border-current/20 px-5 pb-3">
            <ol aria-label="Turns ahead" className="max-h-[45dvh] overflow-y-auto overscroll-contain">
              {ahead.map((step, offset) => (
                <li key={shownIndex + 1 + offset} className="flex items-center gap-3 py-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-current/15">
                    <StepIcon step={step} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm leading-snug">{stepText(step, destination.name)}</span>
                  <span className="text-xs font-medium opacity-75">
                    {formatDistance(Math.max(0, step.startDistance - along))}
                  </span>
                </li>
              ))}
            </ol>
            <p className="pt-2 text-center text-xs opacity-80">
              {ahead.length} more {ahead.length === 1 ? "turn" : "turns"} · {formatDistance(remaining)} to go
            </p>
          </div>
        ) : null}
        </div>
        {isRiding && !hasArrived ? (
          <p
            role="status"
            className="animate-fade-in pointer-events-auto mx-auto mt-2 flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-full bg-overlay px-3 py-1.5 text-xs font-medium text-overlay-foreground shadow-md">
            <Bus className="size-3.5 shrink-0 text-accent" aria-hidden />
            {route.travel === "bike"
              ? "Looks like you're in a vehicle. Directions pick up when you're back on your bike"
              : "Looks like you're riding. Directions pick up when you're back on foot"}
          </p>
        ) : notice && !hasArrived ? (
          <p
            role="status"
            className="animate-fade-in pointer-events-auto mx-auto mt-2 flex w-fit items-center gap-1.5 rounded-full bg-overlay px-3 py-1.5 text-xs font-medium text-overlay-foreground shadow-md">
            {notice === "faster" ? (
              <Zap className="size-3.5 text-accent" aria-hidden />
            ) : notice === "switched" ? (
              <Undo2 className="size-3.5 text-accent" aria-hidden />
            ) : (
              <RefreshCw className="size-3.5 text-accent" aria-hidden />
            )}
            {notice === "faster"
              ? "Found a faster way"
              : notice === "switched"
                ? "Back on your earlier route"
                : "Route updated. Your old route is faded"}
          </p>
        ) : hasAlternate && !hasArrived && !isWrongWay ? (
          <p className="pointer-events-none mx-auto mt-2 w-fit rounded-full bg-overlay px-3 py-1 text-xs text-muted shadow-sm">
            Faded line is your earlier route. Walk or tap it to switch
          </p>
        ) : weakSignal && !hasArrived ? (
          <p className="pointer-events-auto mx-auto mt-2 w-fit rounded-full bg-overlay px-3 py-1 text-xs text-muted shadow-sm">
            Weak GPS signal, position may jump
          </p>
        ) : null}
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
                className="rounded-full bg-overlay shadow-lg">
                <Compass aria-hidden />
              </Button>
            ) : null}
            <Button
              isIconOnly
              variant="secondary"
              aria-label={facingUp ? "Keep north up" : "Turn the map the way I am going"}
              aria-pressed={facingUp}
              onPress={onToggleFacing}
              className={facingUp ? "rounded-full bg-accent-soft text-accent-soft-foreground shadow-lg" : "rounded-full bg-overlay shadow-lg"}>
              {facingUp ? <Navigation2 aria-hidden /> : <Compass aria-hidden />}
            </Button>
            {!isFollowing ? (
              <Button variant="secondary" onPress={onRecenter} className="rounded-full bg-overlay shadow-lg">
                <LocateFixed aria-hidden />
                Recenter
              </Button>
            ) : null}
          </div>
        ) : null}
        <Surface className="glass-chrome rounded-t-[28px] px-5 pb-[max(1rem,var(--map-safe-bottom))] pt-4 shadow-2xl md:rounded-3xl md:pb-4">
          {tripOpen ? (
            <div className="animate-fade-in mb-3 border-b border-separator pb-2">
              <p className="pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Step {shownIndex + 1} of {route.steps.length}
              </p>
              {canAvoidStairs ? (
                <TripSetting label="Avoid stairs" isSelected={avoidStairs} onChange={onAvoidStairsChange} />
              ) : null}
              <TripSetting label="Spoken directions" isSelected={voiceOn} onChange={() => onToggleVoice()} />
              <TripSetting label="Turn the map with me" isSelected={facingUp} onChange={() => onToggleFacing()} />
            </div>
          ) : null}
          <div className="flex items-center gap-3">
          <button
            type="button"
            aria-expanded={hasArrived ? undefined : tripOpen}
            aria-label={hasArrived ? undefined : tripOpen ? "Hide trip settings" : "Show trip settings"}
            disabled={hasArrived}
            onClick={() => setPanel(tripOpen ? null : "trip")}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl text-left transition-transform duration-150 enabled:cursor-pointer enabled:active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-focus">
          <div className="min-w-0 flex-1">
            {hasArrived ? (
              <p className="text-base font-semibold">{nextStopName ? `Next: ${nextStopName}` : "Enjoy your class"}</p>
            ) : stepping ? (
              <>
                <p className="text-lg font-semibold leading-tight">
                  Step {manualStep + 1} of {route.steps.length}
                </p>
                <p className="truncate text-sm text-muted">Location is off, so tap through the steps</p>
              </>
            ) : (
              <>
                <p className="text-lg font-semibold leading-tight">{formatRouteTime(route, remaining)}</p>
                <p className="text-sm text-muted">
                  {formatDistance(remaining)} to {destination.id}
                  {stopLabel ? ` · ${stopLabel}` : ""}
                </p>
              </>
            )}
          </div>
          {hasArrived ? null : tripOpen ? (
            <ChevronDown className="size-5 shrink-0 text-muted" aria-hidden />
          ) : (
            <ChevronUp className="size-5 shrink-0 text-muted" aria-hidden />
          )}
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
            className={voiceOn ? "bg-default" : undefined}>
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
        </Surface>
      </div>
    </>
  );
}
