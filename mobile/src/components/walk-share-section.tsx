import * as Haptics from 'expo-haptics';
import { useThemeColor } from 'heroui-native';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { MapButton } from '@/components/map-button';
import { Press } from '@/components/navigation-hud';
import type { Friend, Meetup } from '@/lib/social-api';
import { MAX_WATCHERS, watchLine } from '@/lib/walk-share';

type WalkShareSectionProps = {
  friends: Friend[];
  walk: Meetup | null;
  isBusy: boolean;
  onStart: (friends: string[]) => Promise<boolean>;
  onStop: () => void;
  /** Adds the nearest SOS phone as the next stop, when one is close. */
  onSos?: () => void;
};

/** Walk me there, in the trip panel: pick up to three friends who see you live until you arrive. */
export function WalkShareSection({ friends, walk, isBusy, onStart, onStop, onSos }: WalkShareSectionProps) {
  const [foreground, muted, accentForeground] = useThemeColor(['foreground', 'muted', 'accent-foreground']);
  const [isPicking, setIsPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  const heading = <Text className="text-xs font-semibold uppercase tracking-wide text-muted">Walk me there</Text>;

  if (walk) {
    return (
      <View className="gap-2 pb-1 pt-2">
        {heading}
        <View className="flex-row items-center gap-3 rounded-2xl bg-default py-2.5 pl-3 pr-2">
          <View className="size-9 items-center justify-center rounded-full bg-accent">
            <Icon name="figure.walk" size={16} tintColor={accentForeground} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-medium text-foreground">Sharing your walk</Text>
            <Text className="text-sm text-muted" numberOfLines={1}>
              {watchLine(walk)} · Stops when you arrive
            </Text>
          </View>
          <Press
            accessibilityRole="button"
            accessibilityLabel="Stop sharing your walk"
            onPress={() => {
              void Haptics.selectionAsync();
              onStop();
            }}
            dim={0.7}
            className="rounded-full bg-background px-3.5 py-2">
            <Text className="text-sm font-semibold text-foreground">Stop</Text>
          </Press>
        </View>
        {onSos ? (
          <Press
            accessibilityRole="button"
            onPress={() => {
              void Haptics.selectionAsync();
              onSos();
            }}
            dim={0.7}
            className="flex-row items-center gap-1.5 self-start rounded-full bg-default px-3 py-2">
            <Icon name="phone.fill" size={13} tintColor={foreground} />
            <Text className="text-sm font-semibold text-foreground">Go to the nearest SOS phone</Text>
          </Press>
        ) : null}
      </View>
    );
  }

  if (friends.length === 0) {
    return (
      <View className="gap-2 pb-1 pt-2">
        {heading}
        <Text className="text-sm text-muted">Add a friend, and they can watch you walk until you get there.</Text>
      </View>
    );
  }

  if (!isPicking) {
    return (
      <View className="gap-2 pb-1 pt-2">
        {heading}
        <Press
          accessibilityRole="button"
          onPress={() => {
            void Haptics.selectionAsync();
            setIsPicking(true);
          }}
          dim={0.7}
          className="flex-row items-center gap-3 rounded-2xl bg-default py-2.5 pl-3 pr-4">
          <View className="size-9 items-center justify-center rounded-full bg-background">
            <Icon name="figure.walk" size={16} tintColor={muted} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-medium text-foreground">Share my walk</Text>
            <Text className="text-sm text-muted">Friends see you live until you arrive</Text>
          </View>
        </Press>
      </View>
    );
  }

  return (
    <View className="gap-2.5 pb-1 pt-2">
      {heading}
      <Text className="text-sm text-muted">Up to {MAX_WATCHERS} friends see you live until you arrive. Nothing is saved.</Text>
      <View className="flex-row flex-wrap gap-2">
        {friends.map((friend) => {
          const on = picked.includes(friend.username);
          const full = !on && picked.length >= MAX_WATCHERS;
          return (
            <Press
              key={friend.username}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: full }}
              disabled={full}
              onPress={() => {
                void Haptics.selectionAsync();
                setPicked((current) => (on ? current.filter((u) => u !== friend.username) : [...current, friend.username]));
              }}
              dim={0.7}
              className={on ? 'rounded-full bg-accent px-3.5 py-2' : full ? 'rounded-full bg-default px-3.5 py-2 opacity-50' : 'rounded-full bg-default px-3.5 py-2'}>
              <Text className={on ? 'text-sm font-semibold text-accent-foreground' : 'text-sm font-semibold text-foreground'}>
                {friend.displayName || friend.username}
              </Text>
            </Press>
          );
        })}
      </View>
      <View className="flex-row gap-2">
        <MapButton style={{ flex: 1 }} variant="secondary" label="Cancel" onPress={() => setIsPicking(false)} />
        <MapButton
          style={{ flex: 1 }}
          label={isBusy ? 'Starting' : 'Share my walk'}
          isDisabled={picked.length === 0 || isBusy}
          onPress={() => {
            void onStart(picked).then((started) => {
              if (!started) return;
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setIsPicking(false);
              setPicked([]);
            });
          }}
        />
      </View>
    </View>
  );
}
