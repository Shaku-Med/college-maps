import * as Haptics from 'expo-haptics';
import { ListGroup, useThemeColor } from 'heroui-native';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import type { Place } from '@/data/campus';
import { useNow } from '@/hooks/use-now';
import { useProfile } from '@/lib/account';
import { useClasses } from '@/lib/classes';
import { classComingUp, greeting } from '@/lib/greeting';

/** Hello by first name for someone signed in, with their next class a tap from directions. Nothing when signed out. */
export function Greeting({ onOpenClass }: { onOpenClass: (place: Place, room: string) => void }) {
  const profile = useProfile();
  const classes = useClasses();
  const now = useNow(60_000);
  const accentForeground = useThemeColor('accent-foreground');
  if (!profile) return null;
  const at = new Date(now);
  const next = classComingUp(classes, at);

  return (
    <View className="gap-3">
      <Text className="text-lg font-semibold text-foreground">{greeting(at, profile.displayName)}</Text>
      {next ? (
        <ListGroup>
          <ListGroup.Item
            onPress={() => {
              void Haptics.selectionAsync();
              onOpenClass(next.place, next.entry.room);
            }}>
            <ListGroup.ItemPrefix>
              <View className="size-9 items-center justify-center rounded-xl bg-accent">
                <Icon name="calendar" size={16} tintColor={accentForeground} />
              </View>
            </ListGroup.ItemPrefix>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle numberOfLines={1}>{next.entry.name}</ListGroup.ItemTitle>
              <ListGroup.ItemDescription numberOfLines={1}>{next.detail}</ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix />
          </ListGroup.Item>
        </ListGroup>
      ) : null}
    </View>
  );
}
