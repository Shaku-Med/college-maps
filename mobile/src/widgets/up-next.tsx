import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, frame, lineLimit, padding, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export type UpNextItem = {
  title: string;
  /** Where, like "Room 1N-204" or "Wherever Sam is". */
  detail: string;
  /** When it starts, in milliseconds since 1970. */
  startsAt: number;
  /** When it ends, in milliseconds since 1970. */
  endsAt: number;
};

/** The class and the meetup that matter at one moment; the widget's setting picks which to show. */
export type UpNextProps = { meetup: UpNextItem | null; lesson: UpNextItem | null };

/** Chosen when adding the widget: everything, or only classes, or only meetups. */
export type UpNextConfiguration = { show: string };

// Runs in the widget extension, not the app, so everything it uses is declared inside it.
const UpNext = (props: UpNextProps, environment: WidgetEnvironment<UpNextConfiguration>) => {
  'widget';
  // Props can be missing the first time the system draws the widget, before the app writes a timeline.
  const meetup = props?.meetup ?? null;
  const lesson = props?.lesson ?? null;
  const dark = environment.colorScheme !== 'light';
  const accent = dark ? '#83C8EF' : '#1268D2';
  const primary = dark ? '#FFFFFF' : '#0B1A33';
  const secondary = dark ? '#C9D6EA' : '#5B6472';
  const background = dark ? '#0B1A33' : '#FFFFFF';
  const medium = environment.widgetFamily === 'systemMedium';
  const now = (environment.date ?? new Date()).getTime();
  const show = environment.configuration?.show ?? 'all';

  const live = (item: UpNextItem | null) => item !== null && item.startsAt <= now && item.endsAt > now;
  let kind: 'meetup' | 'class' | 'none' = 'none';
  if (show === 'classes') kind = lesson ? 'class' : 'none';
  else if (show === 'meetups') kind = meetup ? 'meetup' : 'none';
  else if (live(meetup)) kind = 'meetup';
  else if (live(lesson)) kind = 'class';
  else if (meetup && (!lesson || meetup.startsAt <= lesson.startsAt)) kind = 'meetup';
  else if (lesson) kind = 'class';
  const item = kind === 'meetup' ? meetup : kind === 'class' ? lesson : null;

  const happening = live(item);
  const label =
    kind === 'meetup' ? (happening ? 'Meetup now' : 'Meetup') : kind === 'class' ? (happening ? 'In class' : 'Next class') : 'Up next';
  const symbol = kind === 'meetup' ? 'person.2.fill' : kind === 'class' ? 'book.closed.fill' : 'calendar';
  const empty =
    show === 'classes' ? 'No more classes today' : show === 'meetups' ? 'No meetups right now' : 'Nothing coming up';

  return (
    <VStack
      alignment="leading"
      spacing={4}
      modifiers={[
        frame({ maxWidth: 1000, maxHeight: 1000, alignment: 'topLeading' }),
        padding({ all: 14 }),
        containerBackground(background, 'widget'),
        widgetURL(kind === 'meetup' ? 'csimap://friends' : kind === 'class' ? 'csimap://classes' : 'csimap://'),
      ]}>
      <HStack spacing={6}>
        <Image systemName={symbol} size={13} color={accent} />
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accent)]}>{label.toUpperCase()}</Text>
      </HStack>
      <Spacer />
      {item === null ? (
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 16, weight: 'semibold' }), foregroundStyle(primary)]}>{empty}</Text>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(secondary), lineLimit(2)]}>
            Add your classes or start a meetup in CSI Map.
          </Text>
        </VStack>
      ) : (
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: medium ? 20 : 17, weight: 'bold' }), foregroundStyle(primary), lineLimit(2)]}>
            {item.title}
          </Text>
          <Text modifiers={[font({ size: 13 }), foregroundStyle(secondary), lineLimit(1)]}>{item.detail}</Text>
          <HStack spacing={4}>
            <Text modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(secondary)]}>{happening ? 'Until' : 'At'}</Text>
            <Text
              date={new Date(happening ? item.endsAt : item.startsAt)}
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
