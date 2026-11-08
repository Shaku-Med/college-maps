import type { SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useThemeColor } from 'heroui-native';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, Switch, Text, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { GestureDetector, Pressable, type PressableProps } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useReducedMotion,
  type AnimatedStyle,
} from 'react-native-reanimated';
import { useResolveClassNames } from 'uniwind';

import { Icon } from '@/components/icon';
import { StopRow } from '@/components/stop-row';
import { Glass, HAS_LIQUID_GLASS } from '@/components/glass';
import { MapButton } from '@/components/map-button';
import { StepIcon } from '@/components/step-icon';
import { useDragPanel } from '@/hooks/use-drag-panel';
import { useNow } from '@/hooks/use-now';
import type { RouteNotice } from '@/hooks/use-voice-guidance';
import { arrivalClock, formatRouteTime } from '@/lib/directions';
import { formatDistance } from '@/lib/geo';
import { stepText } from '@/lib/instructions';
import { parkingChoices, parkingDetail, parkingTitle, type ParkingPrompt } from '@/lib/parking';
import type { Route, RouteProgress } from '@/lib/routing';
import type { AmenityKind } from '@/data/amenities';
import type { Place } from '@/data/campus';
import { QUICK_STOPS } from '@/lib/amenity-search';
import type { BreakOffer } from '@/lib/breaks';
import { AMENITY_SYMBOLS } from '@/lib/categories';

const NOTICE_TEXT: Record<RouteNotice, string> = {
  rerouted: 'Route updated',
  faster: 'Found a faster route',
  switched: 'Back on your earlier route',
};

// No exit animations on this screen: its views all mount on one root view, where Reanimated holding a leaving one can scramble the order and blank the app.
function Pill({ symbol, text, tone = 'default' }: { symbol: SFSymbol; text: string; tone?: 'default' | 'danger' }) {
  const [foreground, danger] = useThemeColor(['foreground', 'danger']);
  return (
    <Animated.View entering={FadeInUp.duration(200)} className="items-center">
      <Glass className="flex-row items-center gap-2 rounded-full px-3.5 py-2">
        <Icon name={symbol} size={13} weight="semibold" tintColor={tone === 'danger' ? danger : foreground} />
        <Text className={tone === 'danger' ? 'text-sm font-semibold text-danger' : 'text-sm font-medium text-foreground'}>
          {text}
        </Text>
      </Glass>
    </Animated.View>
  );
}

type TopProps = {
  route: Route;
  progress?: RouteProgress;
  destinationName: string;
  isWrongWay: boolean;
  hasArrived: boolean;
  isRiding: boolean;
  notice?: RouteNotice;
  hasAlternate: boolean;
  weakSignal?: boolean;
  /** The place after this one, when this one is a stop on the way. */
  nextStopName?: string;
  /** Shown once arrived, such as which floor the room is on. */
  arrivalNote?: string;
  /** The list of turns ahead is open. Only one of this and the trip panel is open at a time. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onUseAlternate: () => void;
};

// Within this of the coming turn, the one after it shows too, the way Apple Maps says "Then".
const THEN_WITHIN_METERS = 60;
// The open list stops short of the footer, so the map and End stay in view.
const STEPS_MAX_SHARE = 0.45;
// The next turn rises into place when the one before it is done.
const STEP_IN = FadeInDown.duration(260).withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] });
// The trip panel scrolls past this, so a long list of stops never pushes End off the screen.
const TRIP_MAX_SHARE = 0.45;

/** The little bar that says a panel can be pulled, a bit livelier under the finger. */
function PanelHandle({ color, style, className }: { color: string; style: AnimatedStyle<ViewStyle>; className: string }) {
  return (
    <View className={`items-center ${className}`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Animated.View style={[{ height: 4, borderRadius: 2, backgroundColor: color }, style]} />
    </View>
  );
}

const DIMS_ON_PRESS = Platform.OS === 'ios' && !HAS_LIQUID_GLASS;

/** Gesture handler's Pressable with its classes resolved, since Uniwind does not style it, and a native press. */
export function Press({ className = '', dim, ...props }: Omit<PressableProps, 'style'> & { className?: string; dim?: number }) {
  const base = useResolveClassNames(className);
  const pressedOpacity = dim ?? (DIMS_ON_PRESS ? 0.6 : undefined);
  return (
    <Pressable
      android_ripple={dim === undefined && Platform.OS === 'android' ? { foreground: true } : undefined}
      {...props}
      style={({ pressed }) => [base, pressed && pressedOpacity !== undefined ? { opacity: pressedOpacity } : null]}
    />
  );
}

/** A soft line in the banner's own text color, so it reads on any tint. */
function Rule({ color }: { color: string }) {
  return <View style={{ height: StyleSheet.hairlineWidth * 2, backgroundColor: color, opacity: 0.25 }} />;
}

function StepRow({
  step,
  away,
  destinationName,
  ink,
}: {
  step: Route['steps'][number];
  away: number;
  destinationName: string;
  ink: string;
}) {
  return (
    <View className="flex-row items-center gap-3 py-3">
      <View className="size-10 items-center justify-center rounded-full">
        <View style={[StyleSheet.absoluteFill, { borderRadius: 20, backgroundColor: ink, opacity: 0.16 }]} />
        <StepIcon step={step} size={18} color={ink} />
      </View>
      <Text className="min-w-0 flex-1 text-base leading-6" style={{ color: ink }} numberOfLines={2}>
        {stepText(step, destinationName)}
      </Text>
      <Text className="text-sm font-medium" style={{ color: ink, opacity: 0.75 }}>
        {formatDistance(away)}
      </Text>
    </View>
  );
}

/** The next turn, big and at the top, on blue glass like Apple Maps. */
export function NavigationBanner({
  route,
  progress,
  destinationName,
  isWrongWay,
  hasArrived,
  isRiding,
  notice,
  hasAlternate,
  weakSignal = false,
  nextStopName,
  arrivalNote,
  expanded,
  onExpandedChange,
  onUseAlternate,
}: TopProps) {
  const [accent, accentForeground, danger, dangerForeground] = useThemeColor([
    'accent',
    'accent-foreground',
    'danger',
    'danger-foreground',
  ]);
  const { height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const along = progress?.distanceAlong ?? 0;
  const index = Math.min((progress?.stepIndex ?? 0) + 1, route.steps.length - 1);
  const step = route.steps[index];
  const toStep = Math.max(0, step.startDistance - along);
  const then = route.steps[index + 1];
  const wrong = isWrongWay && !hasArrived;
  const canExpand = !hasArrived && !wrong && index < route.steps.length - 1;
  const open = expanded && canExpand;
  const ahead = route.steps.slice(index + 1);
  const ink = wrong ? dangerForeground : accentForeground;
  const panel = useDragPanel({ edge: 'top', open, canOpen: canExpand, onOpenChange: onExpandedChange });

  function toggle() {
    if (!canExpand || panel.pressIsDrag()) return;
    void Haptics.selectionAsync();
    onExpandedChange(!open);
  }

  return (
    <View pointerEvents="box-none" className="gap-2.5 px-3">
      <Glass radius={28} tint={wrong ? danger : accent} interactive>
        <GestureDetector gesture={panel.dragZone()}>
          <View collapsable={false}>
            <Press
              accessibilityRole="button"
              accessibilityState={{ expanded: open, disabled: !canExpand }}
              accessibilityLabel={
                hasArrived
                  ? [`You have arrived at ${destinationName}`, arrivalNote].filter(Boolean).join('. ')
                  : wrong
                    ? 'Wrong way. Turn around when it is safe'
                    : `In ${formatDistance(toStep)}, ${stepText(step, destinationName)}`
              }
              accessibilityHint={canExpand ? (open ? 'Hides the turns ahead' : 'Shows every turn still ahead') : undefined}
              onPress={toggle}
              className={canExpand ? 'px-4 pb-1 pt-4' : 'p-4'}>
              {hasArrived ? (
                <View className="flex-row items-center gap-3.5">
                  <Icon name="flag.checkered" size={30} weight="semibold" tintColor={ink} />
                  <View className="min-w-0 flex-1">
                    <Text className="text-2xl font-bold" style={{ color: ink }}>
                      {nextStopName ? 'Stop reached' : 'You have arrived'}
                    </Text>
                    <Text className="text-base opacity-80" style={{ color: ink }} numberOfLines={1}>
                      {nextStopName ? `${destinationName} · Next: ${nextStopName}` : destinationName}
                    </Text>
                    {arrivalNote ? (
                      <Text className="mt-1.5 text-base font-semibold" style={{ color: ink }}>
                        {arrivalNote}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : wrong ? (
                <View className="flex-row items-center gap-3.5">
                  <Icon name="arrow.uturn.down" size={30} weight="semibold" tintColor={ink} />
                  <View className="min-w-0 flex-1">
                    <Text className="text-2xl font-bold" style={{ color: ink }}>
                      Wrong way
                    </Text>
                    <Text className="text-base opacity-80" style={{ color: ink }}>
                      Turn around when it is safe
                    </Text>
                  </View>
                </View>
              ) : (
                <>
                  <Animated.View key={index} entering={reduceMotion ? undefined : STEP_IN} className="flex-row items-center gap-3.5">
                    <StepIcon step={step} size={38} color={ink} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-4xl font-bold" style={{ color: ink, fontVariant: ['tabular-nums'] }}>
                        {formatDistance(toStep)}
                      </Text>
                      <Text className="text-xl font-semibold leading-7" style={{ color: ink }} numberOfLines={2}>
                        {stepText(step, destinationName)}
                      </Text>
                    </View>
                  </Animated.View>

                  {then && !open && toStep <= THEN_WITHIN_METERS ? (
                    <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)} className="mt-3 gap-3">
                      <Rule color={ink} />
                      <View className="flex-row items-center gap-2">
                        <Text className="text-base font-semibold opacity-80" style={{ color: ink }}>
                          Then
                        </Text>
                        <StepIcon step={then} size={16} color={ink} />
                        <Text className="min-w-0 flex-1 text-base" style={{ color: ink }} numberOfLines={1}>
                          {stepText(then, destinationName)}
                        </Text>
                      </View>
                    </Animated.View>
                  ) : null}
                </>
              )}
            </Press>
          </View>
        </GestureDetector>

        {/* Outside the pressable, so dragging the list scrolls it instead of counting as a tap. */}
        <Animated.View style={panel.clipStyle}>
          {panel.mounted ? (
            <Animated.View
              onLayout={panel.onContentLayout}
              accessibilityElementsHidden={!open}
              importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
              pointerEvents={open ? 'auto' : 'none'}
              style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, panel.contentStyle]}
              className="px-4 pt-3">
              <Rule color={ink} />
              <GestureDetector gesture={panel.listGesture}>
                <Animated.ScrollView
                  {...panel.listProps}
                  style={{ maxHeight: height * STEPS_MAX_SHARE }}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}>
                  {ahead.map((next, offset) => (
                    <StepRow
                      key={index + 1 + offset}
                      step={next}
                      away={Math.max(0, next.startDistance - along)}
                      destinationName={destinationName}
                      ink={ink}
                    />
                  ))}
                </Animated.ScrollView>
              </GestureDetector>
              <Text className="pt-2 text-center text-sm opacity-80" style={{ color: ink }}>
                {ahead.length} more {ahead.length === 1 ? 'turn' : 'turns'} ·{' '}
                {formatDistance(progress?.remaining ?? route.distance)} to go
              </Text>
            </Animated.View>
          ) : null}
        </Animated.View>
        {canExpand ? (
          <GestureDetector gesture={panel.dragZone()}>
            <View collapsable={false}>
              <PanelHandle color={ink} style={panel.handleStyle} className="pb-2.5 pt-2" />
            </View>
          </GestureDetector>
        ) : null}
      </Glass>

      {isRiding && !hasArrived ? (
        <Pill symbol="bus.fill" text="Riding. Directions pick up when you get off" />
      ) : notice && !hasArrived ? (
        <Pill symbol={notice === 'faster' ? 'bolt.fill' : 'arrow.triangle.branch'} text={NOTICE_TEXT[notice]} />
      ) : hasAlternate && !hasArrived && !wrong ? (
        <Press onPress={onUseAlternate} dim={0.7} className="items-center">
          <Pill symbol="arrow.uturn.backward" text="Tap to take your earlier route" />
        </Press>
      ) : weakSignal && !hasArrived ? (
        <Pill symbol="location" text="Weak GPS signal, position may jump" />
      ) : null}
    </View>
  );
}

type BottomProps = {
  route: Route;
  progress?: RouteProgress;
  hasArrived: boolean;
  voiceOn: boolean;
  manualStep: number | null;
  /** The panel of trip settings is open. Only one of this and the turn list is open at a time. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  avoidStairs: boolean;
  /** Stairs only matter on foot. */
  canAvoidStairs: boolean;
  facingUp: boolean;
  onToggleVoice: () => void;
  onAvoidStairs: (avoid: boolean) => void;
  onFacingUp: (facingUp: boolean) => void;
  /** The place after this stop. With it, arriving offers to go on instead of finishing. */
  nextStopName?: string;
  /** Which stop is being walked to, like "Stop 1 of 2", while there are stops ahead. */
  stopLabel?: string;
  onContinue?: () => void;
  onStep: (index: number) => void;
  onEnd: () => void;
  /** The stops still ahead, each with its place in the trip, so any can be dropped. */
  stopsAhead?: StopAhead[];
  onRemoveStop?: (index: number) => void;
  /** Kinds with one close by, offered in a tap; far from campus there are none and only the search is offered. */
  quickStops?: AmenityKind[];
  onAddStopKind?: (kind: AmenityKind) => void;
  onAnotherStop?: () => void;
  /** Walk me there, shown in the trip panel when signed in and on foot. */
  walkShare?: ReactNode;
  /** Set while friends can see this walk, so it shows without opening the panel. */
  isSharing?: boolean;
};

export type StopAhead = { index: number; place: Place; number: number };

/** A setting in the trip panel, with the platform's own switch. */
function Setting({
  symbol,
  title,
  value,
  onChange,
}: {
  symbol: SFSymbol;
  title: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const [foreground, accent, border] = useThemeColor(['foreground', 'accent', 'border']);
  return (
    <View className="flex-row items-center gap-3 py-2">
      <View className="size-9 items-center justify-center rounded-full bg-default">
        <Icon name={symbol} size={16} tintColor={foreground} />
      </View>
      <Text className="min-w-0 flex-1 text-base text-foreground">{title}</Text>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={(next) => {
          void Haptics.selectionAsync();
          onChange(next);
        }}
        trackColor={{ true: accent, false: border }}
        ios_backgroundColor={border}
      />
    </View>
  );
}

/** Time and distance left, the voice switch, and End. */
export function NavigationFooter({
  route,
  progress,
  hasArrived,
  voiceOn,
  manualStep,
  expanded,
  onExpandedChange,
  avoidStairs,
  canAvoidStairs,
  facingUp,
  onToggleVoice,
  onAvoidStairs,
  onFacingUp,
  nextStopName,
  stopLabel,
  onContinue,
  onStep,
  onEnd,
  stopsAhead = [],
  onRemoveStop,
  quickStops = [],
  onAddStopKind,
  onAnotherStop,
  walkShare,
  isSharing = false,
}: BottomProps) {
  const [foreground, accent] = useThemeColor(['foreground', 'accent']);
  const { height } = useWindowDimensions();
  const now = useNow();
  const remaining = progress?.remaining ?? route.distance;
  const arrive = arrivalClock(route, remaining, now);
  // At a stop with more to go, the trip panel still opens so stops can be added or dropped.
  const canOpen = !hasArrived || !!nextStopName;
  const open = expanded && canOpen;
  const panel = useDragPanel({ edge: 'bottom', open, canOpen, onOpenChange: onExpandedChange });
  const quick = QUICK_STOPS.filter(({ kind }) => quickStops.includes(kind));
  const stepNumber = Math.min((progress?.stepIndex ?? 0) + 1, route.steps.length);

  return (
    <View style={{ marginHorizontal: 12 }}>
      <Glass radius={28} interactive>
        {canOpen ? (
          <GestureDetector gesture={panel.dragZone()}>
            <View collapsable={false}>
              <PanelHandle color={foreground} style={panel.handleStyle} className="pb-2 pt-2.5" />
            </View>
          </GestureDetector>
        ) : null}
        <View className={canOpen ? 'gap-3 px-4 pb-4' : 'gap-3 p-4'}>
          {manualStep !== null && !hasArrived ? (
            <View className="flex-row gap-2">
              <MapButton
                style={{ flex: 1 }}
                variant="secondary"
                label="Back"
                isDisabled={manualStep === 0}
                onPress={() => onStep(manualStep - 1)}
              />
              <MapButton style={{ flex: 1 }} label="Next step" onPress={() => onStep(manualStep + 1)} />
            </View>
          ) : null}
          <View className="flex-row items-center gap-3">
            <View className="min-w-0 flex-1">
              <GestureDetector gesture={panel.dragZone()}>
                <View collapsable={false}>
                  <Press
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open, disabled: !canOpen }}
                    accessibilityHint={canOpen ? (open ? 'Hides trip settings' : 'Shows trip settings') : undefined}
                    disabled={!canOpen}
                    onPress={() => {
                      if (panel.pressIsDrag()) return;
                      void Haptics.selectionAsync();
                      onExpandedChange(!open);
                    }}>
                    <Text className="text-3xl font-bold text-foreground" style={{ fontVariant: ['tabular-nums'] }}>
                      {hasArrived ? 'Arrived' : formatRouteTime(route, remaining)}
                    </Text>
                    {/* One line beside the buttons: with a stop label it shrinks a little instead of wrapping. */}
                    <Text className="text-base text-muted" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                      {hasArrived ? "You're here" : [formatDistance(remaining), arrive, stopLabel, isSharing ? 'Shared live' : undefined].filter(Boolean).join(' · ')}
                    </Text>
                  </Press>
                </View>
              </GestureDetector>
            </View>
            <Press
              accessibilityRole="switch"
              accessibilityLabel="Spoken directions"
              accessibilityState={{ checked: voiceOn }}
              onPress={onToggleVoice}
              dim={0.7}
              className="size-12 items-center justify-center rounded-full bg-default">
              <Icon name={voiceOn ? 'speaker.wave.2.fill' : 'speaker.slash.fill'} size={18} tintColor={foreground} />
            </Press>
            {hasArrived && nextStopName && onContinue ? (
              <MapButton symbol="arrow.right" label="Continue" onPress={onContinue} />
            ) : null}
            <MapButton
              variant="danger"
              symbol="xmark"
              label={hasArrived && !nextStopName ? 'Done' : 'End'}
              iconOnly={hasArrived && !!nextStopName}
              onPress={onEnd}
            />
          </View>
        </View>

        <Animated.View style={panel.clipStyle}>
          {panel.mounted ? (
            <Animated.View
              onLayout={panel.onContentLayout}
              accessibilityElementsHidden={!open}
              importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
              pointerEvents={open ? 'auto' : 'none'}
              style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, panel.contentStyle]}
              className="px-4 pb-3">
              <View className="border-t border-border pt-1">
                <GestureDetector gesture={panel.listGesture}>
                  <Animated.ScrollView
                    {...panel.listProps}
                    style={{ maxHeight: height * TRIP_MAX_SHARE }}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator={false}>
                      {hasArrived ? null : (
                        <Text className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                          Arrive {arrive} · Step {stepNumber} of {route.steps.length}
                        </Text>
                      )}
                      {canAvoidStairs ? (
                        <Setting symbol="figure.stairs" title="Avoid stairs" value={avoidStairs} onChange={onAvoidStairs} />
                      ) : null}
                      <Setting symbol="speaker.wave.2.fill" title="Spoken directions" value={voiceOn} onChange={() => onToggleVoice()} />
                      <Setting symbol="location.north.line.fill" title="Turn the map with me" value={facingUp} onChange={onFacingUp} />
                      {hasArrived ? null : walkShare}
                      <View className="gap-2 pb-1 pt-2">
                        <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
                          {stopsAhead.length > 0 ? 'Stops' : 'Add a stop'}
                        </Text>
                        {stopsAhead.map(({ index, place, number }) => (
                          <StopRow key={`${place.id}-${index}`} stop={place} number={number} onRemove={() => onRemoveStop?.(index)} />
                        ))}
                        <View className="flex-row flex-wrap gap-2">
                          {quick.map(({ kind, label }) => (
                            <Press
                              key={kind}
                              accessibilityRole="button"
                              accessibilityLabel={`Add the nearest ${/^[A-Z]{2}/.test(label) ? label : label.toLowerCase()} as a stop`}
                              onPress={() => {
                                void Haptics.selectionAsync();
                                onAddStopKind?.(kind);
                              }}
                              dim={0.7}
                              className="flex-row items-center gap-1.5 rounded-full bg-default px-3 py-2">
                              <Icon name={AMENITY_SYMBOLS[kind]} size={13} tintColor={foreground} />
                              <Text className="text-sm font-semibold text-foreground">{label}</Text>
                            </Press>
                          ))}
                          <Press
                            accessibilityRole="button"
                            onPress={onAnotherStop}
                            dim={0.7}
                            className="flex-row items-center gap-1.5 rounded-full bg-default px-3 py-2">
                            <Icon name="plus.circle.fill" size={13} tintColor={accent} />
                            <Text className="text-sm font-semibold text-accent">
                              {quick.length > 0 ? 'Another place' : stopsAhead.length > 0 ? 'Add another stop' : 'Search places'}
                            </Text>
                          </Press>
                        </View>
                      </View>
                  </Animated.ScrollView>
                </GestureDetector>
              </View>
            </Animated.View>
          ) : null}
        </Animated.View>
      </Glass>
    </View>
  );
}

/** A friendly offer to rest at a seat just ahead, above the trip panel like a parking choice. */
export function BreakCard({ offer, onTake, onSkip }: { offer: BreakOffer; onTake: () => void; onSkip: () => void }) {
  const accentForeground = useThemeColor('accent-foreground');
  const reduceMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(220)}
      accessibilityLiveRegion="polite"
      style={{ marginHorizontal: 12 }}>
      <Glass radius={24} interactive>
        <View className="gap-3 p-4">
          <View className="flex-row items-start gap-3">
            <View className="size-10 items-center justify-center rounded-full bg-accent">
              <Icon name={AMENITY_SYMBOLS[offer.spot.amenity]} size={18} weight="semibold" tintColor={accentForeground} />
            </View>
            <Text className="min-w-0 flex-1 pt-0.5 text-base font-medium leading-6 text-foreground">{offer.line}</Text>
          </View>
          <View className="flex-row gap-2">
            <MapButton style={{ flex: 1 }} label="Take a break" onPress={onTake} />
            <MapButton style={{ flex: 1 }} variant="secondary" label="Keep going" onPress={onSkip} />
          </View>
        </View>
      </Glass>
    </Animated.View>
  );
}

/** A parking choice at the bottom of the map, the way Apple Maps offers one, answered with a tap. */
export function ParkingCard({
  prompt,
  onPrimary,
  onSecondary,
}: {
  prompt: ParkingPrompt;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  const accentForeground = useThemeColor('accent-foreground');
  const reduceMotion = useReducedMotion();
  const { primary, secondary } = parkingChoices(prompt);
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(220)}
      accessibilityLiveRegion="polite"
      style={{ marginHorizontal: 12 }}>
      <Glass radius={24} interactive>
        <View className="gap-3 p-4">
          <View className="flex-row items-center gap-3">
            <View className="size-10 items-center justify-center rounded-full bg-accent">
              <Icon name="parkingsign" size={18} weight="semibold" tintColor={accentForeground} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold text-foreground" numberOfLines={2}>
                {parkingTitle(prompt)}
              </Text>
              <Text className="text-sm text-muted" numberOfLines={1}>
                {parkingDetail(prompt)}
              </Text>
            </View>
          </View>
          <View className="flex-row gap-2">
            <MapButton style={{ flex: 1 }} label={primary} onPress={onPrimary} />
            <MapButton style={{ flex: 1 }} variant="secondary" label={secondary} onPress={onSecondary} />
          </View>
        </View>
      </Glass>
    </Animated.View>
  );
}
