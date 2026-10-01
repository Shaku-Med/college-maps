import type { SFSymbol } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useThemeColor } from 'heroui-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInUp,
  FadeOut,
  FadeOutUp,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { Glass, HAS_LIQUID_GLASS } from '@/components/glass';
import { MapButton } from '@/components/map-button';
import { StepIcon } from '@/components/step-icon';
import { useNow } from '@/hooks/use-now';
import type { RouteNotice } from '@/hooks/use-voice-guidance';
import { formatRouteTime } from '@/lib/directions';
import { formatDistance } from '@/lib/geo';
import { stepText } from '@/lib/instructions';
import type { Route, RouteProgress } from '@/lib/routing';

const NOTICE_TEXT: Record<RouteNotice, string> = {
  rerouted: 'Route updated',
  faster: 'Found a faster route',
  switched: 'Back on your earlier route',
};

function Pill({ symbol, text, tone = 'default' }: { symbol: SFSymbol; text: string; tone?: 'default' | 'danger' }) {
  const [foreground, danger] = useThemeColor(['foreground', 'danger']);
  return (
    <Animated.View entering={FadeInUp.duration(200)} exiting={FadeOutUp.duration(160)} className="items-center">
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
  onUseAlternate: () => void;
};

// Within this of the coming turn, the one after it shows too, the way Apple Maps says "Then".
const THEN_WITHIN_METERS = 60;
// The open list stops short of the footer, so the map and End stay in view.
const STEPS_MAX_SHARE = 0.45;
const PRESSED_SCALE = 0.97;
const BOUNCE = { damping: 11, stiffness: 260, mass: 0.6 };

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
    <View className="flex-row items-center gap-3 py-2.5">
      <View className="size-9 items-center justify-center rounded-full">
        <View style={[StyleSheet.absoluteFill, { borderRadius: 18, backgroundColor: ink, opacity: 0.16 }]} />
        <StepIcon step={step} size={16} color={ink} />
      </View>
      <Text className="min-w-0 flex-1 text-base leading-5" style={{ color: ink }} numberOfLines={2}>
        {stepText(step, destinationName)}
      </Text>
      <Text className="text-sm font-medium" style={{ color: ink, opacity: 0.75 }}>
        {formatDistance(away)}
      </Text>
    </View>
  );
}

/**
 * The next turn, big and at the top, on blue glass like Apple Maps. Tapping it opens every turn still ahead with
 * how far each one is, in a list that scrolls on its own; tapping the turn again folds it back. Going the wrong way
 * turns the glass red. The press springs back on every platform: iOS 26 glass does it natively, and elsewhere a
 * matching spring stands in.
 */
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
  const [expanded, setExpanded] = useState(false);
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

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
  const springs = !HAS_LIQUID_GLASS && !reduceMotion;
  const layout = reduceMotion ? undefined : LinearTransition.springify().damping(18).stiffness(180);

  function toggle() {
    if (!canExpand) return;
    void Haptics.selectionAsync();
    setExpanded((value) => !value);
  }

  return (
    <View pointerEvents="box-none" className="gap-2.5 px-3">
      <Animated.View layout={layout} style={pressStyle}>
        <Glass radius={28} tint={wrong ? danger : accent} interactive>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open, disabled: !canExpand }}
            accessibilityLabel={
              hasArrived
                ? `You have arrived at ${destinationName}`
                : wrong
                  ? 'Wrong way. Turn around when it is safe'
                  : `In ${formatDistance(toStep)}, ${stepText(step, destinationName)}`
            }
            accessibilityHint={canExpand ? (open ? 'Hides the turns ahead' : 'Shows every turn still ahead') : undefined}
            onPressIn={() => {
              if (springs && canExpand) scale.set(withSpring(PRESSED_SCALE, BOUNCE));
            }}
            onPressOut={() => {
              if (springs) scale.set(withSpring(1, BOUNCE));
            }}
            onPress={toggle}
            className="p-4">
            {hasArrived ? (
              <View className="flex-row items-center gap-3.5">
                <Icon name="flag.checkered" size={30} weight="semibold" tintColor={ink} />
                <View className="min-w-0 flex-1">
                  <Text className="text-2xl font-bold" style={{ color: ink }}>
                    You have arrived
                  </Text>
                  <Text className="text-base opacity-80" style={{ color: ink }} numberOfLines={1}>
                    {destinationName}
                  </Text>
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
                <View className="flex-row items-center gap-3.5">
                  <StepIcon step={step} size={34} color={ink} />
                  <View className="min-w-0 flex-1">
                    <Text className="text-3xl font-bold" style={{ color: ink }}>
                      {formatDistance(toStep)}
                    </Text>
                    <Text className="text-lg font-medium leading-6" style={{ color: ink }} numberOfLines={2}>
                      {stepText(step, destinationName)}
                    </Text>
                  </View>
                  {canExpand ? (
                    <Icon name={open ? 'chevron.up' : 'chevron.down'} size={14} weight="semibold" tintColor={ink} />
                  ) : null}
                </View>

                {then && !open && toStep <= THEN_WITHIN_METERS ? (
                  <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)} className="mt-3 gap-3">
                    <Rule color={ink} />
                    <View className="flex-row items-center gap-2">
                      <Text className="text-sm font-semibold opacity-80" style={{ color: ink }}>
                        Then
                      </Text>
                      <StepIcon step={then} size={15} color={ink} />
                      <Text className="min-w-0 flex-1 text-sm" style={{ color: ink }} numberOfLines={1}>
                        {stepText(then, destinationName)}
                      </Text>
                    </View>
                  </Animated.View>
                ) : null}
              </>
            )}
          </Pressable>

          {/* Outside the pressable, so dragging the list scrolls it instead of counting as a tap. */}
          {open ? (
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.duration(220).delay(60)}
              exiting={reduceMotion ? undefined : FadeOut.duration(120)}
              className="px-4 pb-3">
              <Rule color={ink} />
              <ScrollView
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
              </ScrollView>
              <Text className="pt-2 text-center text-xs opacity-80" style={{ color: ink }}>
                {ahead.length} more {ahead.length === 1 ? 'turn' : 'turns'} ·{' '}
                {formatDistance(progress?.remaining ?? route.distance)} to go
              </Text>
            </Animated.View>
          ) : null}
        </Glass>
      </Animated.View>

      {isRiding && !hasArrived ? (
        <Pill symbol="bus.fill" text="Riding. Directions pick up when you get off" />
      ) : notice && !hasArrived ? (
        <Pill symbol={notice === 'faster' ? 'bolt.fill' : 'arrow.triangle.branch'} text={NOTICE_TEXT[notice]} />
      ) : hasAlternate && !hasArrived && !wrong ? (
        <Pressable onPress={onUseAlternate} className="items-center active:opacity-70">
          <Pill symbol="arrow.uturn.backward" text="Tap to take your earlier route" />
        </Pressable>
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
  onToggleVoice: () => void;
  onStep: (index: number) => void;
  onEnd: () => void;
};

/** Time and distance left, the voice switch, and End. */
export function NavigationFooter({ route, progress, hasArrived, voiceOn, manualStep, onToggleVoice, onStep, onEnd }: BottomProps) {
  const foreground = useThemeColor('foreground');
  const now = useNow();
  const remaining = progress?.remaining ?? route.distance;
  const seconds = route.duration !== undefined && route.distance > 0 ? route.duration * (remaining / route.distance) : remaining / 1.3;
  const arrive = new Date(now + seconds * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <Glass className="mx-3 overflow-hidden rounded-[28px]">
      <View className="gap-3 p-4">
        {manualStep !== null && !hasArrived ? (
          <View className="flex-row gap-2">
            <MapButton style={{ flex: 1 }} variant="secondary" label="Back" isDisabled={manualStep === 0} onPress={() => onStep(manualStep - 1)} />
            <MapButton style={{ flex: 1 }} label="Next step" onPress={() => onStep(manualStep + 1)} />
          </View>
        ) : null}
        <View className="flex-row items-center gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-2xl font-bold text-foreground">{hasArrived ? 'Arrived' : formatRouteTime(route, remaining)}</Text>
            <Text className="text-sm text-muted">
              {hasArrived ? "You're here" : `${formatDistance(remaining)} · ${arrive}`}
            </Text>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Spoken directions"
            accessibilityState={{ checked: voiceOn }}
            onPress={onToggleVoice}
            className="size-12 items-center justify-center rounded-full bg-default active:opacity-70">
            <Icon name={voiceOn ? 'speaker.wave.2.fill' : 'speaker.slash.fill'} size={18} tintColor={foreground} />
          </Pressable>
          <MapButton variant="danger" symbol="xmark" label={hasArrived ? 'Done' : 'End'} onPress={onEnd} />
        </View>
      </View>
    </Glass>
  );
}
