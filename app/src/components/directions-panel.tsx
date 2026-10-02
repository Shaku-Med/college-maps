"use client";

import {
  Button,
  Chip,
  CloseButton,
  Header,
  Label,
  ListBox,
  Select,
  Spinner,
  Surface,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { ArrowLeft, Bike, CalendarClock, Car, ChevronRight, Flag, Footprints, LocateFixed, Navigation, Plus } from "lucide-react";
import { useState } from "react";

import { CollapseButton, SheetGrabber } from "@/components/sheet-chrome";
import { StepIcon } from "@/components/step-icon";
import { CATEGORY_LABELS, type Place } from "@/data/campus";
import { formatRouteTime } from "@/lib/directions";
import { formatDistance, formatSeconds } from "@/lib/geo";
import { stepText } from "@/lib/instructions";
import { PLACE_SECTIONS } from "@/lib/search";
import { MAX_STOPS, MY_LOCATION, tripTotals, type TripPlan } from "@/lib/stops";
import type { Meetup } from "@/lib/social-api";
import type { Route, TravelMode } from "@/lib/routing";

export { MY_LOCATION };

export type RouteIssue =
  | "loading"
  | "locating"
  | "finding"
  | "denied"
  | "unavailable"
  | "no-route"
  | "no-step-free"
  | "no-street-route"
  | "street-failed";

const TRAVEL_MODES: Array<{ id: TravelMode; label: string; verb: string; noun: string; Icon: typeof Car }> = [
  { id: "drive", label: "Drive", verb: "Drive", noun: "drive", Icon: Car },
  { id: "walk", label: "Walk", verb: "Walk", noun: "walk", Icon: Footprints },
  { id: "bike", label: "Bike", verb: "Bike", noun: "ride", Icon: Bike },
];

type DirectionsPanelProps = {
  destination: Place;
  origin: string;
  avoidStairs: boolean;
  route: Route | null;
  issue?: RouteIssue;
  /** True once any position has arrived, even a rough one. */
  located: boolean;
  /** How someone off campus is getting there. On campus there is no choice to make: it is a walk. */
  travel: TravelMode | null;
  events?: Meetup[];
  onOpenEvent?: (meetup: Meetup) => void;
  onTravelChange: (travel: TravelMode) => void;
  onOriginChange: (origin: string) => void;
  onAvoidStairsChange: (value: boolean) => void;
  /** Every place the walk visits in order; the last is the destination. */
  plan: TripPlan | null;
  /** The stops the walker added, as opposed to a starting building they are not at yet. */
  stopIds: readonly string[];
  /** The legs after the first stop. */
  laterLegs: Route[];
  onAddStop: (id: string) => void;
  onRemoveStop: (id: string) => void;
  onStart: () => void;
  onBack: () => void;
  onCollapse: () => void;
  onClose: () => void;
};

const ISSUE_TEXT: Record<Exclude<RouteIssue, "loading" | "locating" | "finding">, string> = {
  denied: "Location is off for this site. Allow it in your browser settings, or pick a starting building and follow the steps.",
  unavailable: "This browser cannot share your location. Pick a starting building and follow the steps instead.",
  "no-route": "We could not find a walking route between these places.",
  "no-step-free": "There is no step-free route here yet. Turn off Avoid stairs to see the fastest walk.",
  "no-street-route": "We could not find a route from where you are. Try another way to travel.",
  "street-failed": "Directions are not loading right now. Check your connection and try again.",
};

// How many stops the panel lists before sending the rest to their own page, the same as the app.
const STOPS_SHOWN = 2;

function StopItem({
  stop,
  number,
  isStart,
  onRemove,
}: {
  stop: Place;
  number: number;
  /** A starting building the walker is not at yet comes first, as a stop of its own, and changes with From. */
  isStart: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-surface-secondary px-3 py-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">
        {number}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{stop.name}</span>
        {isStart ? <span className="block text-xs text-muted">On the way, since you are not there yet</span> : null}
      </span>
      {isStart ? null : <CloseButton aria-label={`Remove the stop at ${stop.name}`} onPress={() => onRemove(stop.id)} />}
    </li>
  );
}

export function DirectionsPanel({
  destination,
  origin,
  avoidStairs,
  route,
  issue,
  located,
  travel,
  events = [],
  onOpenEvent,
  onTravelChange,
  onOriginChange,
  onAvoidStairsChange,
  plan,
  stopIds,
  laterLegs,
  onAddStop,
  onRemoveStop,
  onStart,
  onBack,
  onCollapse,
  onClose,
}: DirectionsPanelProps) {
  const [showSteps, setShowSteps] = useState(false);
  const [allStops, setAllStops] = useState(false);
  // A rough fix is enough to set off; the route tightens as better ones arrive.
  const live = (plan?.live ?? false) && located;
  const canStart = route !== null && (live || origin !== MY_LOCATION);
  const mode = TRAVEL_MODES.find((option) => option.id === (travel ?? "walk")) ?? TRAVEL_MODES[1];
  const stops = plan ? plan.targets.slice(0, -1) : [];
  const totals = route && laterLegs.length > 0 ? tripTotals([route, ...laterLegs]) : null;

  // Every stop gets its own page in the sheet once there are more than the panel lists.
  if (allStops && stops.length > 0) {
    return (
      <Surface
        role="region"
        aria-label="Stops on the way"
        className="animate-sheet-in flex max-h-[78dvh] flex-col rounded-t-[28px] shadow-2xl md:max-h-[calc(100dvh-8rem)] md:rounded-3xl">
        <SheetGrabber onCollapse={onCollapse} />
        <div className="flex items-center gap-1 px-3 pt-2 md:pt-3">
          <Button isIconOnly variant="ghost" aria-label="Back to directions" onPress={() => setAllStops(false)} className="rounded-full">
            <ArrowLeft aria-hidden />
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">Stops</h2>
          <CollapseButton onCollapse={onCollapse} />
        </div>
        <ol
          aria-label="Stops on the way"
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overscroll-contain px-5 pb-[max(1rem,var(--map-safe-bottom))] pt-2 md:pb-4">
          {stops.map((stop, index) => (
            <StopItem
              key={stop.id}
              stop={stop}
              number={index + 1}
              isStart={stop.id === origin && !stopIds.includes(stop.id)}
              onRemove={onRemoveStop}
            />
          ))}
          <li className="flex items-center gap-3 px-3 py-2 text-sm text-muted">
            <Flag className="size-4 shrink-0 text-accent" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              Then on to <span className="font-semibold text-foreground">{destination.name}</span>
            </span>
          </li>
        </ol>
      </Surface>
    );
  }

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
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {mode.verb} to {destination.name}
        </h2>
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
              {PLACE_SECTIONS.map(({ category, places }) => (
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

        {stops.length > 0 ? (
          <ol aria-label="Stops on the way" className="flex flex-col gap-1.5">
            {stops.slice(0, STOPS_SHOWN).map((stop, index) => (
              <StopItem
                key={stop.id}
                stop={stop}
                number={index + 1}
                isStart={stop.id === origin && !stopIds.includes(stop.id)}
                onRemove={onRemoveStop}
              />
            ))}
            {stops.length > STOPS_SHOWN ? (
              <li>
                <button
                  type="button"
                  onClick={() => setAllStops(true)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-surface-secondary px-3 py-2.5 text-left outline-none transition-colors hover:bg-surface-tertiary focus-visible:ring-2 focus-visible:ring-focus">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent-soft-foreground">
                    +{stops.length - STOPS_SHOWN}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">See all {stops.length} stops</span>
                  <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                </button>
              </li>
            ) : null}
          </ol>
        ) : null}

        {stopIds.length < MAX_STOPS ? (
          <Select
            value={null}
            onChange={(key) => key !== null && onAddStop(String(key))}
            fullWidth
            aria-label="Add a stop"
            placeholder="Add a stop">
            <Select.Trigger>
              <Plus className="size-4 shrink-0 text-accent" aria-hidden />
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover containerPadding={48}>
              <ListBox>
                {PLACE_SECTIONS.map(({ category, places }) => (
                  <ListBox.Section key={category}>
                    <Header>{CATEGORY_LABELS[category]}</Header>
                    {places
                      .filter((place) => place.id !== destination.id && !stopIds.includes(place.id))
                      .map((place) => (
                        <ListBox.Item key={place.id} id={place.id} textValue={place.name}>
                          {place.name}
                        </ListBox.Item>
                      ))}
                  </ListBox.Section>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        ) : null}

        {travel ? (
          <ToggleButtonGroup
            aria-label="How are you getting there"
            selectionMode="single"
            disallowEmptySelection
            isDetached
            size="sm"
            selectedKeys={[travel]}
            onSelectionChange={(keys) => {
              const [next] = keys;
              if (next) onTravelChange(next as TravelMode);
            }}
            className="gap-2">
            {TRAVEL_MODES.map(({ id, label, Icon }) => (
              <ToggleButton
                key={id}
                id={id}
                className="flex-1 rounded-full px-3.5 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
                <Icon className="size-4" aria-hidden />
                {label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        ) : null}

        {travel === null || travel === "walk" ? (
          <Switch isSelected={avoidStairs} onChange={onAvoidStairsChange}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <span className="text-sm">Avoid stairs</span>
            </Switch.Content>
          </Switch>
        ) : null}
      </div>

      {events.length > 0 ? (
        <div className="border-t border-separator px-5 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Events at {destination.name}</p>
          <ul className="flex flex-col gap-1.5">
            {events.slice(0, 3).map((meetup) => (
              <li key={meetup.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-2xl bg-surface-secondary px-3 py-2 text-left hover:bg-accent-soft"
                  onClick={() => onOpenEvent?.(meetup)}>
                  <CalendarClock className="size-4 shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{meetup.title ?? "Campus event"}</span>
                  {meetup.going > 0 ? <span className="text-xs text-muted">{meetup.going}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div
        className={
          showSteps
            ? "border-t border-separator px-5 py-4"
            : "border-t border-separator px-5 py-4 pb-[max(1rem,var(--map-safe-bottom))] md:pb-4"
        }>
        {issue === "loading" || issue === "locating" || issue === "finding" ? (
          <div className="flex items-center gap-3 text-sm text-muted">
            <Spinner size="sm" />
            {issue === "locating" ? "Finding your location" : issue === "finding" ? "Finding a route" : "Loading campus paths"}
          </div>
        ) : issue ? (
          <p className="text-sm text-muted">{ISSUE_TEXT[issue]}</p>
        ) : route ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold tracking-tight">
                  {totals ? formatSeconds(totals.seconds) : formatRouteTime(route)}
                </p>
                <p className="text-sm text-muted">
                  {formatDistance(totals?.meters ?? route.distance)} {mode.noun}
                  {stops.length > 0 ? ` · ${stops.length} ${stops.length === 1 ? "stop" : "stops"}` : ""}
                  {avoidStairs && mode.id === "walk" ? " · step-free" : ""}
                </p>
              </div>
              {route.hasStairs ? (
                <Chip size="sm" variant="soft" color="warning">
                  Includes stairs
                </Chip>
              ) : null}
            </div>

            <div className="mt-4 flex gap-2">
              <Button variant="primary" size="lg" className="flex-1" isDisabled={!canStart} onPress={onStart}>
                <Navigation aria-hidden />
                {live ? "Start" : "Follow steps"}
              </Button>
              <Button
                variant="secondary"
                size="lg"
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
