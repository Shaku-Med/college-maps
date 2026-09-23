"use client";

import { Button, Surface } from "@heroui/react";
import {
  ChevronLeft,
  ChevronRight,
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
  onEnd: () => void;
};

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
  onEnd,
}: NavigationHudProps) {
  const current = progress?.stepIndex ?? 0;
  const next = route.steps[Math.min(current + 1, route.steps.length - 1)];
  const toNext = Math.max(0, next.startDistance - (progress?.distanceAlong ?? 0));
  const remaining = progress?.remaining ?? route.distance;
  // Stepping through by hand shows the step being walked; following live shows the one coming up.
  const stepping = manualStep !== null;
  const shownStep = stepping ? route.steps[manualStep] : next;
  const shownDistance = stepping ? shownStep.length : toNext;

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 pl-[var(--map-safe-left)] pr-[var(--map-safe-right)] pt-[var(--map-safe-top)] md:left-4 md:right-auto md:w-[420px] md:px-0 md:pt-4">
        <div
          role="status"
          aria-live="polite"
          className={
            isWrongWay && !hasArrived
              ? "animate-sheet-in pointer-events-auto flex items-center gap-4 rounded-3xl bg-danger px-5 py-4 text-danger-foreground shadow-xl transition-colors duration-300"
              : "animate-sheet-in pointer-events-auto flex items-center gap-4 rounded-3xl bg-accent px-5 py-4 text-accent-foreground shadow-xl transition-colors duration-300"
          }>
          {hasArrived ? (
            <>
              <Flag className="size-8 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-xl font-semibold leading-tight">You have arrived</p>
                <p className="truncate text-sm opacity-85">{destination.name}</p>
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
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-tight tracking-tight">{formatDistance(shownDistance)}</p>
                <p className="truncate text-base opacity-90">{stepText(shownStep, destination.name)}</p>
              </div>
            </>
          )}
        </div>
        {notice && !hasArrived ? (
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
        <Surface className="flex items-center gap-3 rounded-t-[28px] px-5 pb-[max(1rem,var(--map-safe-bottom))] pt-4 shadow-2xl md:rounded-3xl md:pb-4">
          <div className="min-w-0 flex-1">
            {hasArrived ? (
              <p className="text-base font-semibold">Enjoy your class</p>
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
                </p>
              </>
            )}
          </div>
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
          <Button variant={hasArrived ? "primary" : "danger-soft"} size="lg" onPress={onEnd}>
            {hasArrived ? "Done" : "End"}
          </Button>
        </Surface>
      </div>
    </>
  );
}
