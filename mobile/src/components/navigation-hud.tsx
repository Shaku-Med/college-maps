import type { SFSymbol } from 'expo-symbols';
import { useThemeColor } from 'heroui-native';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { Glass } from '@/components/glass';
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

/** The next turn, big and at the top, the way every navigation app shows it. */
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
  const [accentForeground, dangerForeground] = useThemeColor(['accent-foreground', 'danger-foreground']);
  const index = Math.min((progress?.stepIndex ?? 0) + 1, route.steps.length - 1);
  const step = route.steps[index];
  const toStep = Math.max(0, step.startDistance - (progress?.distanceAlong ?? 0));
  const wrong = isWrongWay && !hasArrived;

  return (
    <View pointerEvents="box-none" className="gap-2.5 px-3">
      <View className={wrong ? 'rounded-[28px] bg-danger p-4' : 'rounded-[28px] bg-accent p-4'}>
        {hasArrived ? (
          <View className="flex-row items-center gap-3.5">
            <Icon name="flag.checkered" size={30} weight="semibold" tintColor={accentForeground} />
            <View className="min-w-0 flex-1">
              <Text className="text-2xl font-bold text-accent-foreground">You have arrived</Text>
              <Text className="text-base text-accent-foreground opacity-80" numberOfLines={1}>
                {destinationName}
              </Text>
            </View>
          </View>
        ) : wrong ? (
          <View className="flex-row items-center gap-3.5">
            <Icon name="arrow.uturn.down" size={30} weight="semibold" tintColor={dangerForeground} />
            <View className="min-w-0 flex-1">
              <Text className="text-2xl font-bold text-danger-foreground">Wrong way</Text>
              <Text className="text-base text-danger-foreground opacity-80">Turn around when it is safe</Text>
            </View>
          </View>
        ) : (
          <View className="flex-row items-center gap-3.5">
            <StepIcon step={step} size={34} color={accentForeground} />
            <View className="min-w-0 flex-1">
              <Text className="text-3xl font-bold text-accent-foreground">{formatDistance(toStep)}</Text>
              <Text className="text-lg font-medium leading-6 text-accent-foreground" numberOfLines={2}>
                {stepText(step, destinationName)}
              </Text>
            </View>
          </View>
        )}
      </View>

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
