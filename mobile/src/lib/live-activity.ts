import { Platform } from 'react-native';

import type { RouteStep } from '@/lib/routing';
import NavigationActivity, { type NavigationActivityProps } from '@/widgets/navigation-activity';

// The trip on the Lock Screen and in the Dynamic Island, like Apple Maps. It starts from the tap on Start,
// since iOS only allows that while the app is open, and the background location task keeps it current.

export type TripSnapshot = {
  instruction: string;
  distance: string;
  destination: string;
  remaining: string;
  remainingSeconds: number;
  /** How much of the route is behind, from 0 to 1. */
  progress: number;
  step?: RouteStep;
  wrongWay?: boolean;
  arrived?: boolean;
};

function symbolFor({ step, wrongWay, arrived }: TripSnapshot) {
  if (arrived || step?.kind === 'arrive') return 'flag.checkered';
  if (wrongWay) return 'arrow.uturn.down';
  if (step?.kind === 'stairs') return 'figure.stairs';
  switch (step?.direction) {
    case 'slight-left':
      return 'arrow.up.left';
    case 'left':
    case 'sharp-left':
      return 'arrow.turn.up.left';
    case 'slight-right':
      return 'arrow.up.right';
    case 'right':
    case 'sharp-right':
      return 'arrow.turn.up.right';
    default:
      return 'arrow.up';
  }
}

function propsFor(trip: TripSnapshot): NavigationActivityProps {
  const instruction = trip.arrived
    ? 'You have arrived'
    : trip.wrongWay
      ? 'Wrong way. Turn around when it is safe'
      : trip.instruction;
  return {
    symbol: symbolFor(trip),
    distance: trip.arrived || trip.wrongWay ? '' : trip.distance,
    instruction: instruction.slice(0, 90),
    destination: trip.destination.slice(0, 60),
    remaining: trip.arrived ? 'Here' : trip.remaining,
    // Rounded to the minute so the arrival time does not wobble between updates.
    arriveAt: Math.round((Date.now() + trip.remainingSeconds * 1000) / 60_000) * 60_000,
    // Rounded so small moves along the route do not spend iOS's update budget.
    progress: Math.round(Math.min(1, Math.max(0, trip.progress)) * 20) / 20,
    alert: trip.wrongWay === true && !trip.arrived,
  };
}

type Instance = ReturnType<typeof NavigationActivity.start>;
let activity: Instance | null = null;
let lastShown = '';

/** Starts the Live Activity for a trip, or updates it when what it shows has changed. */
export function showTrip(trip: TripSnapshot) {
  if (Platform.OS !== 'ios') return;
  const props = propsFor(trip);
  const key = JSON.stringify(props);
  if (key === lastShown) return;
  lastShown = key;
  try {
    if (activity) void activity.update(props).catch(() => undefined);
    else activity = NavigationActivity.start(props, 'csimap://');
  } catch {
    // Live Activities turned off in Settings, or an older iOS: directions carry on in the app.
    activity = null;
  }
}

/** Ends the trip's Live Activity, and any left over from a trip the app was closed during. */
export function endTrip() {
  if (Platform.OS !== 'ios') return;
  lastShown = '';
  activity = null;
  try {
    for (const instance of NavigationActivity.getInstances()) void instance.end('immediate').catch(() => undefined);
  } catch {
    // Nothing running.
  }
}
