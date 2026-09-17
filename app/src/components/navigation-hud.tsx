"use client";

import { Button, Surface } from "@heroui/react";
import { Flag, LocateFixed, RefreshCw, Undo2, Volume2, VolumeX, Zap } from "lucide-react";

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
  onEnd,
}: NavigationHudProps) {
  const current = progress?.stepIndex ?? 0;
  const next = route.steps[Math.min(current + 1, route.steps.length - 1)];
  const toNext = Math.max(0, next.startDistance - (progress?.distanceAlong ?? 0));
  const remaining = progress?.remaining ?? route.distance;

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
              <StepIcon step={next} className="size-9 shrink-0" strokeWidth={2.25} />
              <div className="min-w-0">
                <p className="text-2xl font-semibold leading-tight tracking-tight">{formatDistance(toNext)}</p>
                <p className="truncate text-base opacity-90">{stepText(next, destination.name)}</p>
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
        {!isFollowing && !hasArrived ? (
          <div className="mb-3 flex justify-end px-3 md:px-0">
            <Button variant="secondary" onPress={onRecenter} className="rounded-full bg-overlay shadow-lg">
              <LocateFixed aria-hidden />
              Recenter
            </Button>
          </div>
        ) : null}
        <Surface className="flex items-center gap-3 rounded-t-[28px] px-5 pb-[max(1rem,var(--map-safe-bottom))] pt-4 shadow-2xl md:rounded-3xl md:pb-4">
          <div className="min-w-0 flex-1">
            {hasArrived ? (
              <p className="text-base font-semibold">Enjoy your class</p>
            ) : (
              <>
                <p className="text-lg font-semibold leading-tight">{formatRouteTime(route, remaining)}</p>
                <p className="text-sm text-muted">
                  {formatDistance(remaining)} to {destination.id}
                </p>
              </>
            )}
          </div>
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
