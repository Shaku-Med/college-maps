import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, frame, lineLimit, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export type UpNextProps = {
  kind: 'meetup' | 'class' | 'none';
  title: string;
  /** Where, like "1N-204" or "Wherever Sam is". */
  detail: string;
  /** When it starts, in milliseconds since 1970. */
  startsAt: number;
  /** When it ends, in milliseconds since 1970. */
  endsAt: number;
};

// Runs in the widget extension, not the app, so everything it uses is declared inside it.
const UpNext = (props: UpNextProps, environment: WidgetEnvironment) => {
  'widget';
  const dark = environment.colorScheme === 'dark';
  const accent = dark ? '#83C8EF' : '#1268D2';
  const secondary = dark ? '#C9D6EA' : '#5B6472';
  const background = dark ? '#0B1A33' : '#FFFFFF';
  const medium = environment.widgetFamily === 'systemMedium';
  const now = environment.date.getTime();
  const happening = props.kind !== 'none' && props.startsAt <= now;
  const label =
    props.kind === 'meetup' ? (happening ? 'Meetup now' : 'Meetup') : props.kind === 'class' ? (happening ? 'In class' : 'Next class') : 'Up next';
  const symbol = props.kind === 'meetup' ? 'person.2.fill' : props.kind === 'class' ? 'book.closed.fill' : 'calendar';

  return (
    <VStack
      alignment="leading"
      spacing={4}
      modifiers={[
        frame({ maxWidth: 1000, maxHeight: 1000, alignment: 'topLeading' }),
        containerBackground(background, 'widget'),
        widgetURL(props.kind === 'meetup' ? 'csimap://friends' : props.kind === 'class' ? 'csimap://classes' : 'csimap://'),
      ]}>
      <HStack spacing={6}>
        <Image systemName={symbol} size={13} color={accent} />
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accent)]}>{label.toUpperCase()}</Text>
      </HStack>
      <Spacer />
      {props.kind === 'none' ? (
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 16, weight: 'semibold' })]}>Nothing coming up</Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(secondary), lineLimit(2)]}>
            Add your classes or start a meetup in CSI Map.
          </Text>
        </VStack>
      ) : (
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: medium ? 20 : 17, weight: 'bold' }), lineLimit(2)]}>{props.title}</Text>
          <Text modifiers={[font({ size: 13 }), foregroundStyle(secondary), lineLimit(1)]}>{props.detail}</Text>
          <HStack spacing={4}>
            <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(secondary)]}>
              {happening ? 'Until' : 'At'}
            </Text>
            <Text
              date={new Date(happening ? props.endsAt : props.startsAt)}
              dateStyle="time"
              modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(secondary)]}
            />
          </HStack>
        </VStack>
      )}
    </VStack>
  );
};

export default createWidget('UpNext', UpNext);
