import * as Haptics from 'expo-haptics';
import { CloseButton, useThemeColor } from 'heroui-native';
import { Pressable, Text, View } from 'react-native';

import { Glass } from '@/components/glass';
import { Icon } from '@/components/icon';
import type { LiveState } from '@/hooks/use-meetup-live';
import type { Meetup } from '@/lib/social-api';

type MeetupBarProps = {
  meetup: Meetup;
  where: string;
  /** Other people currently sharing, not counting you. */
  sharing: number;
  state: LiveState;
  onOpen: () => void;
  onDirections?: () => void;
  onStop: () => void;
};

/** What the map is showing while a meetup is on it: who is live, where you meet, and a way to stop sharing. */
export function MeetupBar({ meetup, where, sharing, state, onOpen, onDirections, onStop }: MeetupBarProps) {
  const [accent, muted] = useThemeColor(['accent', 'muted']);
  const others = meetup.members.filter((m) => m.status === 'joined').length - 1;
  const title = meetup.title ?? (meetup.yourRole === 'host' ? 'Your meetup' : `${meetup.host.displayName}'s meetup`);
  const status =
    state === 'live'
      ? others <= 0
        ? 'Waiting for others to join'
        : `${sharing} of ${others} sharing now`
      : state === 'connecting'
        ? 'Connecting'
        : 'Offline, trying again';

  return (
    <Glass className="mx-4 overflow-hidden rounded-3xl">
      <View className="flex-row items-center gap-3 py-2.5 pl-3.5 pr-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}, meeting at ${where}. ${status}. Open`}
          onPress={onOpen}
          className="min-w-0 flex-1 flex-row items-center gap-3 active:opacity-70">
          <View className="size-9 items-center justify-center rounded-full bg-accent-soft">
            <Icon name="person.2.fill" size={15} tintColor={accent} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
              {title}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <View className={state === 'live' ? 'size-1.5 rounded-full bg-success' : 'size-1.5 rounded-full bg-muted'} />
              <Text className="text-xs text-muted" numberOfLines={1}>
                {status} · {where}
              </Text>
            </View>
          </View>
        </Pressable>
        {onDirections ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Directions to ${where}`}
            hitSlop={6}
            onPress={() => {
              void Haptics.selectionAsync();
              onDirections();
            }}
            className="size-9 items-center justify-center rounded-full bg-default active:opacity-70">
            <Icon name="figure.walk" size={15} tintColor={muted} />
          </Pressable>
        ) : null}
        <CloseButton accessibilityLabel="Stop showing this meetup" onPress={onStop} />
      </View>
    </Glass>
  );
}
