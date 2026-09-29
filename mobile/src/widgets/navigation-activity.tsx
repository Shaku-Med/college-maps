import { HStack, Image, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, padding, tint } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type NavigationActivityProps = {
  /** An SF Symbol for the next maneuver, like arrow.turn.up.right. */
  symbol: string;
  /** "150 ft", or empty on arrival. */
  distance: string;
  instruction: string;
  destination: string;
  remaining: string;
  /** When the trip should end, in milliseconds since 1970. */
  arriveAt: number;
  /** How much of the route is behind, from 0 to 1. */
  progress: number;
  alert: boolean;
};

// Runs in the widget extension, not the app, so everything it uses is declared inside it.
const NavigationActivity = (props: NavigationActivityProps, environment: LiveActivityEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark' || environment.isLuminanceReduced === true;
  const accent = props.alert ? '#FF453A' : dark ? '#83C8EF' : '#1268D2';
  const secondary = dark ? '#C9D6EA' : '#5B6472';
  const arriveAt = new Date(props.arriveAt);
  const symbol = props.symbol as never;

  return {
    banner: (
      <HStack spacing={14} modifiers={[padding({ all: 16 })]}>
        <Image systemName={symbol} size={34} color={accent} modifiers={[frame({ width: 44 })]} />
        <VStack alignment="leading" spacing={4}>
          <HStack spacing={6}>
            {props.distance ? <Text modifiers={[font({ size: 22, weight: 'bold' })]}>{props.distance}</Text> : null}
            <Spacer />
            <Text
              date={arriveAt}
              dateStyle="time"
              modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(secondary)]}
            />
          </HStack>
          <Text modifiers={[font({ size: 16, weight: 'semibold' })]}>{props.instruction}</Text>
          <Text modifiers={[font({ size: 13 }), foregroundStyle(secondary)]}>
            {props.destination} · {props.remaining}
          </Text>
          <ProgressView value={props.progress} modifiers={[tint(accent), padding({ top: 4 })]} />
        </VStack>
      </HStack>
    ),
    compactLeading: <Image systemName={symbol} color={accent} />,
    compactTrailing: <Text modifiers={[font({ size: 14, weight: 'semibold' })]}>{props.distance || 'Here'}</Text>,
    minimal: <Image systemName={symbol} color={accent} />,
    expandedLeading: <Image systemName={symbol} size={30} color={accent} modifiers={[padding({ leading: 8, top: 6 })]} />,
    expandedTrailing: (
      <VStack alignment="trailing" spacing={2} modifiers={[padding({ trailing: 8, top: 6 })]}>
        <Text modifiers={[font({ size: 17, weight: 'bold' })]}>{props.remaining}</Text>
        <Text date={arriveAt} dateStyle="time" modifiers={[font({ size: 12 }), foregroundStyle(secondary)]} />
      </VStack>
    ),
    expandedCenter: (
      <Text modifiers={[font({ size: 20, weight: 'bold' }), padding({ top: 6 })]}>{props.distance || 'Arrived'}</Text>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ horizontal: 8, bottom: 8 })]}>
        <Text modifiers={[font({ size: 16, weight: 'semibold' })]}>{props.instruction}</Text>
        <ProgressView value={props.progress} modifiers={[tint(accent)]} />
      </VStack>
    ),
  };
};

export default createLiveActivity('NavigationActivity', NavigationActivity);
