"use client";

import { Button, Chip, CloseButton, Header, Label, ListBox, Select, Spinner, Surface, Switch } from "@heroui/react";
import { ArrowLeft, LocateFixed, Navigation } from "lucide-react";
import { useState } from "react";

import { CollapseButton, SheetGrabber } from "@/components/sheet-chrome";
import { StepIcon } from "@/components/step-icon";
import { CATEGORY_LABELS, PLACES, type Place } from "@/data/campus";
import type { GeoStatus } from "@/hooks/use-geolocation";
import { BROWSE_ORDER } from "@/lib/categories";
import { formatDistance, formatDuration } from "@/lib/geo";
import { stepText } from "@/lib/instructions";
import type { Route } from "@/lib/routing";

export const MY_LOCATION = "me";

const ORIGIN_SECTIONS = BROWSE_ORDER.map((category) => ({
  category,
  places: PLACES.filter((place) => place.category === category),
})).filter((section) => section.places.length > 0);

export type RouteIssue = "loading" | "locating" | "denied" | "unavailable" | "off-campus" | "no-route" | "no-step-free";

type DirectionsPanelProps = {
  destination: Place;
  origin: string;
  avoidStairs: boolean;
  route: Route | null;
  issue?: RouteIssue;
  geoStatus: GeoStatus;
  onOriginChange: (origin: string) => void;
  onAvoidStairsChange: (value: boolean) => void;
  onStart: () => void;
  onBack: () => void;
  onCollapse: () => void;
  onClose: () => void;
};

const ISSUE_TEXT: Record<Exclude<RouteIssue, "loading" | "locating">, string> = {
  denied: "Location is off for this site. Allow it in your browser settings, or pick a starting building.",
  unavailable: "This browser cannot share your location. Pick a starting building instead.",
  "off-campus": "You look far from campus. Pick a starting building to preview the walk.",
  "no-route": "We could not find a walking route between these places.",
  "no-step-free": "There is no step-free route here yet. Turn off Avoid stairs to see the fastest walk.",
};

export function DirectionsPanel({
  destination,
  origin,
  avoidStairs,
  route,
  issue,
  geoStatus,
  onOriginChange,
  onAvoidStairsChange,
  onStart,
  onBack,
  onCollapse,
  onClose,
}: DirectionsPanelProps) {
  const [showSteps, setShowSteps] = useState(false);
  const canStart = origin === MY_LOCATION && route !== null && geoStatus === "active";

  return (
    <Surface
      role="region"
      aria-label={`Directions to ${destination.name}`}
      className="animate-sheet-in flex max-h-[78dvh] flex-col rounded-t-[28px] shadow-2xl md:max-h-[calc(100dvh-8rem)] md:rounded-3xl">
      <SheetGrabber onCollapse={onCollapse} />

      <div className="flex items-center gap-1 px-3 pt-2 md:pt-3">
        <Button isIconOnly variant="ghost" aria-label="Back to place" onPress={onBack} className="rounded-full">
          <ArrowLeft aria-hidden />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Walk to {destination.name}</h2>
        <CollapseButton onCollapse={onCollapse} />
        <CloseButton aria-label="Close directions" onPress={onClose} />
      </div>

      <div className="flex flex-col gap-3 px-5 pb-3 pt-2">
        <Select
          value={origin}
          onChange={(key) => key !== null && onOriginChange(String(key))}
          fullWidth
          aria-label="Starting point">
          <Label className="text-xs text-muted">From</Label>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover containerPadding={48}>
            <ListBox>
              <ListBox.Item id={MY_LOCATION} textValue="My location">
                <span className="flex items-center gap-2">
                  <LocateFixed className="size-4 shrink-0 text-accent" aria-hidden />
                  My location
                </span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
              {ORIGIN_SECTIONS.map(({ category, places }) => (
                <ListBox.Section key={category}>
                  <Header>{CATEGORY_LABELS[category]}</Header>
                  {places
                    .filter((place) => place.id !== destination.id)
                    .map((place) => (
                      <ListBox.Item key={place.id} id={place.id} textValue={place.name}>
                        {place.name}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                </ListBox.Section>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>

        <Switch isSelected={avoidStairs} onChange={onAvoidStairsChange}>
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
            <span className="text-sm">Avoid stairs</span>
          </Switch.Content>
        </Switch>
      </div>

      <div
        className={
          showSteps
            ? "border-t border-separator px-5 py-4"
            : "border-t border-separator px-5 py-4 pb-[max(1rem,var(--map-safe-bottom))] md:pb-4"
        }>
        {issue === "loading" || issue === "locating" ? (
          <div className="flex items-center gap-3 text-sm text-muted">
            <Spinner size="sm" />
            {issue === "locating" ? "Finding your location" : "Loading campus paths"}
          </div>
        ) : issue ? (
          <p className="text-sm text-muted">{ISSUE_TEXT[issue]}</p>
        ) : route ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold tracking-tight">{formatDuration(route.distance)}</p>
                <p className="text-sm text-muted">
                  {formatDistance(route.distance)} walk
                  {avoidStairs ? " · step-free" : ""}
                </p>
              </div>
              {route.hasStairs ? (
                <Chip size="sm" variant="soft" color="warning">
                  Includes stairs
                </Chip>
              ) : null}
            </div>

            <div className="mt-4 flex gap-2">
              {origin === MY_LOCATION ? (
                <Button variant="primary" size="lg" className="flex-1" isDisabled={!canStart} onPress={onStart}>
                  <Navigation aria-hidden />
                  Start
                </Button>
              ) : null}
              <Button
                variant="secondary"
                size="lg"
                className={origin === MY_LOCATION ? undefined : "flex-1"}
                onPress={() => setShowSteps((value) => !value)}
                aria-expanded={showSteps}>
                {showSteps ? "Hide steps" : "Steps"}
              </Button>
            </div>
          </>
        ) : null}
      </div>

      {route && !issue && showSteps ? (
        <ol className="animate-fade-in min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-separator px-3 pb-[max(1rem,var(--map-safe-bottom))] pt-2">
          {route.steps.map((step, index) => (
            <li key={index} className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-default text-default-foreground">
                <StepIcon step={step} className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-sm">{stepText(step, destination.name)}</span>
              {step.length > 0 ? (
                <span className="shrink-0 text-xs text-muted">{formatDistance(step.length)}</span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </Surface>
  );
}
