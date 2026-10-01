import * as Haptics from 'expo-haptics';
import type { SFSymbol } from 'expo-symbols';
import { CloseButton, Spinner, Switch, cn, useThemeColor } from 'heroui-native';
import { useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Glass } from '@/components/glass';
import { MapButton } from '@/components/map-button';
import { StepIcon } from '@/components/step-icon';
import { STOPS_SHOWN, StopRow } from '@/components/stop-row';
import { getPlace } from '@/data/campus';
import { PANEL_WIDTH } from '@/hooks/use-layout';
import { useNow } from '@/hooks/use-now';
import { ISSUE_TEXT, type RouteIssue } from '@/hooks/use-route-preview';
import { formatRouteTime } from '@/lib/directions';
import { formatDistance, formatSeconds } from '@/lib/geo';
import { stepText } from '@/lib/instructions';
import type { Route, TravelMode } from '@/lib/routing';
import type { Meetup } from '@/lib/social-api';
import { MAX_STOPS, tripTotals, type TripPlan } from '@/lib/stops';
import { MY_LOCATION, setAvoidStairs, setTravelMode, type Trip } from '@/lib/trip';

const MODES: { id: TravelMode; label: string; symbol: SFSymbol }[] = [
  { id: 'drive', label: 'Drive', symbol: 'car.fill' },
  { id: 'walk', label: 'Walk', symbol: 'figure.walk' },
  { id: 'bike', label: 'Bike', symbol: 'bicycle' },
];

const clockAt = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function arrivalTime(route: Route, now: number) {
  const seconds = route.duration ?? route.distance / 1.3;
  return new Date(now + seconds * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

type DirectionsPanelProps = {
  trip: Trip;
  route: Route | null;
  issue?: RouteIssue;
  isOffCampus: boolean;
  /** The legs after the first stop. Empty without stops. */
  later: Route[];
  plan: TripPlan | null;
  live: boolean;
  events?: Meetup[];
  onOpenEvent?: (meetup: Meetup) => void;
  onStart: () => void;
  onClose: () => void;
  onPickOrigin: () => void;
  onAddStop: () => void;
  onRemoveStop: (id: string) => void;
  onSeeAllStops: () => void;
};

export function DirectionsPanel({
  trip,
  route,
  issue,
  isOffCampus,
  later,
  plan,
  live,
  events = [],
  onOpenEvent,
  onStart,
  onClose,
  onPickOrigin,
  onAddStop,
  onRemoveStop,
  onSeeAllStops,
}: DirectionsPanelProps) {
  const [showSteps, setShowSteps] = useState(false);
  const now = useNow();
  const { height } = useWindowDimensions();
  const [foreground, muted, accent, accentForeground] = useThemeColor(['foreground', 'muted', 'accent', 'accent-foreground']);
  const destination = trip.destination;
  if (!destination) return null;
  const originName = trip.origin === MY_LOCATION ? 'My location' : (getPlace(trip.origin)?.name ?? 'My location');
  const waiting = issue === 'locating' || issue === 'finding';
  const stops = plan ? plan.targets.slice(0, -1) : [];
  const totals = route ? tripTotals([route, ...later]) : null;
  // Landscape / short windows: scroll instead of crushing Drive/Walk/Bike and the Start row.
  const maxHeight = Math.min(height * 0.72, Math.max(220, height - 96));

  return (
    <Glass className="w-full overflow-hidden rounded-[28px]" style={{ width: '100%', minWidth: 280, maxWidth: PANEL_WIDTH }}>
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        style={{ maxHeight }}
        contentContainerClassName="gap-4 p-4">
        <View className="flex-row items-start gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-semibold uppercase tracking-wide text-muted">Directions</Text>
            <Text className="text-xl font-bold text-foreground" numberOfLines={1}>
              {trip.room ? `Room ${trip.room}` : destination.name}
            </Text>
          </View>
          <CloseButton onPress={onClose} />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Starting from ${originName}. Change`}
          onPress={onPickOrigin}
          className="flex-row items-center gap-3 rounded-2xl bg-default px-3.5 py-3 active:opacity-70">
          <Icon name={trip.origin === MY_LOCATION ? 'location.fill' : 'building.2'} size={15} tintColor={accent} />
          <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
            <Text className="text-muted">From </Text>
            {originName}
          </Text>
          <Icon name="chevron.up.chevron.down" size={12} tintColor={muted} />
        </Pressable>

        {stops.length > 0 ? (
          <View className="gap-2">
            {stops.slice(0, STOPS_SHOWN).map((stop, index) => (
              <StopRow
                key={stop.id}
                stop={stop}
                number={index + 1}
                isStart={stop.id === trip.origin && !trip.stops.includes(stop.id)}
                onRemove={onRemoveStop}
              />
            ))}
            {stops.length > STOPS_SHOWN ? (
              <Pressable
                accessibilityRole="button"
                onPress={onSeeAllStops}
                className="flex-row items-center gap-3 rounded-2xl bg-default px-3.5 py-2.5 active:opacity-70">
                <View className="size-6 items-center justify-center rounded-full bg-accent-soft">
                  <Text className="text-xs font-bold text-accent-soft-foreground">+{stops.length - STOPS_SHOWN}</Text>
                </View>
                <Text className="min-w-0 flex-1 text-sm text-foreground">See all {stops.length} stops</Text>
                <Icon name="chevron.right" size={12} weight="semibold" tintColor={muted} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {trip.stops.length < MAX_STOPS ? (
          <Pressable
            accessibilityRole="button"
            onPress={onAddStop}
            className="flex-row items-center gap-2 self-start rounded-full px-1 py-1 active:opacity-60">
            <Icon name="plus.circle.fill" size={16} tintColor={accent} />
            <Text className="text-sm font-semibold text-accent">Add a stop</Text>
          </Pressable>
        ) : null}

        {isOffCampus ? (
          <View className="flex-row gap-2" accessibilityRole="radiogroup">
            {MODES.map((mode) => {
              const selected = trip.travelMode === mode.id;
              return (
                <Pressable
                  key={mode.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setTravelMode(mode.id);
                  }}
                  className={cn(
                    'min-w-[88px] flex-1 flex-row items-center justify-center gap-1.5 rounded-2xl py-2.5',
                    selected ? 'bg-accent' : 'bg-default',
                  )}>
                  <Icon name={mode.symbol} size={14} tintColor={selected ? accentForeground : foreground} />
                  <Text className={cn('text-sm font-semibold', selected ? 'text-accent-foreground' : 'text-foreground')}>
                    {mode.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {!isOffCampus || trip.travelMode === 'walk' ? (
          <View className="flex-row items-center justify-between px-1">
            <Text className="text-sm text-foreground">Avoid stairs</Text>
            <Switch isSelected={trip.avoidStairs} onSelectedChange={setAvoidStairs} />
          </View>
        ) : null}

        {events.length > 0 ? (
          <View className="gap-2">
            <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
              Events at {destination.name}
            </Text>
            {events.slice(0, 3).map((meetup) => (
              <Pressable
                key={meetup.id}
                onPress={() => onOpenEvent?.(meetup)}
                className="flex-row items-center gap-2.5 rounded-2xl bg-default px-3 py-2.5 active:opacity-70">
                <Icon name="calendar" size={14} tintColor={accent} />
                <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
                  {meetup.title ?? 'Campus event'}
                </Text>
                {meetup.going > 0 ? <Text className="text-xs text-muted">{meetup.going}</Text> : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {route ? (
          <View className="flex-row items-end justify-between px-1">
            <View className="min-w-0 flex-1">
              <Text className="text-3xl font-bold text-foreground">
                {later.length > 0 && totals ? formatSeconds(totals.seconds) : formatRouteTime(route)}
              </Text>
              <Text className="text-sm text-muted">
                {formatDistance(totals?.meters ?? route.distance)} · Arrive{' '}
                {later.length > 0 && totals ? clockAt(now + totals.seconds * 1000) : arrivalTime(route, now)}
                {stops.length > 0 ? ` · ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}` : ''}
                {trip.avoidStairs && (!isOffCampus || trip.travelMode === 'walk') ? ' · step-free' : ''}
                {route.hasStairs ? ' · Stairs' : ''}
              </Text>
            </View>
            <Pressable onPress={() => setShowSteps((value) => !value)} hitSlop={8} className="active:opacity-60">
              <Text className="text-sm font-semibold text-accent">{showSteps ? 'Hide steps' : 'Steps'}</Text>
            </Pressable>
          </View>
        ) : waiting ? (
          <View className="flex-row items-center gap-2.5 px-1 py-2">
            <Spinner size="sm" />
            <Text className="text-sm text-muted">{issue === 'locating' ? 'Finding your location' : 'Finding a route'}</Text>
          </View>
        ) : issue ? (
          <Text className="px-1 text-sm leading-5 text-muted">{ISSUE_TEXT[issue as keyof typeof ISSUE_TEXT]}</Text>
        ) : null}

        {route && showSteps ? (
          <View className="gap-3 py-1">
            {route.steps.map((step, index) => (
              <View key={index} className="flex-row items-center gap-3">
                <View className="size-8 items-center justify-center rounded-full bg-default">
                  <StepIcon step={step} size={14} color={foreground} />
                </View>
                <Text className="flex-1 text-sm text-foreground">{stepText(step, destination.name)}</Text>
                {step.kind !== 'arrive' && step.length > 0 ? (
                  <Text className="text-xs text-muted">{formatDistance(step.length)}</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <MapButton
          size="lg"
          isDisabled={!route}
          symbol={live ? 'location.north.fill' : 'list.number'}
          label={live ? 'Start' : 'Follow steps'}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            onStart();
          }}
        />
      </ScrollView>
    </Glass>
  );
}
