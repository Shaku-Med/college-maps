import { CloseButton, cn, useThemeColor } from 'heroui-native';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Glass } from '@/components/glass';
import { Icon } from '@/components/icon';
import type { Coordinate } from '@/data/campus';
import { distanceMeters, formatDistance } from '@/lib/geo';

type PersonPinProps = {
  label: string;
  name: string;
  /** Everyone is meeting at this person. */
  isMeetingPoint: boolean;
  /** Tapped, so the name shows beside the initials. */
  isActive: boolean;
  onPress: () => void;
};

/** A friend on the map, the same as the web: a round badge with a small point under it. */
export function PersonPin({ label, name, isMeetingPoint, isActive, onPress }: PersonPinProps) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={name} hitSlop={8} onPress={onPress} className="items-center">
      <View
        className={cn(
          'flex-row items-center rounded-full border-2 bg-overlay shadow-md',
          isMeetingPoint ? 'border-accent' : 'border-overlay',
          isActive ? 'gap-1.5 py-0.5 pl-0.5 pr-3' : 'p-0.5',
        )}>
        <View
          className={cn(
            'size-7 items-center justify-center rounded-full',
            isMeetingPoint ? 'bg-accent' : 'bg-accent-soft',
          )}>
          <Text className={cn('text-[11px] font-bold', isMeetingPoint ? 'text-accent-foreground' : 'text-accent-soft-foreground')}>
            {label}
          </Text>
        </View>
        {isActive ? (
          <Text className="max-w-32 text-xs font-semibold text-foreground" numberOfLines={1}>
            {name}
          </Text>
        ) : null}
      </View>
      <View
        className={cn(
          '-mt-1.5 size-3 rotate-45 rounded-[3px] bg-overlay',
          isMeetingPoint ? 'border-b-2 border-r-2 border-accent' : '',
        )}
      />
    </Pressable>
  );
}

function ago(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : 'over an hour ago';
}

type PersonCardProps = {
  name: string;
  username?: string;
  isHost: boolean;
  isMeetingPoint: boolean;
  coordinate: Coordinate;
  accuracy: number;
  at: number;
  youAt?: Coordinate;
  onCenter: () => void;
  onClose: () => void;
};

/** Who a pin is: their name, how far away they are, and how fresh the location is. */
export function PersonCard({ name, username, isHost, isMeetingPoint, coordinate, accuracy, at, youAt, onCenter, onClose }: PersonCardProps) {
  const muted = useThemeColor('muted');
  // Keeps "updated 2 min ago" honest while the card stays open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const away = youAt ? formatDistance(distanceMeters(youAt, coordinate)) : undefined;
  const details = [
    isMeetingPoint ? 'Everyone meets here' : isHost ? 'Host' : undefined,
    away ? `${away} away` : undefined,
    `updated ${ago(at, now)}`,
    accuracy > 50 ? `within ${formatDistance(accuracy)}` : undefined,
  ].filter(Boolean);
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || '?';

  return (
    <Glass className="mx-4 overflow-hidden rounded-3xl">
      <View className="flex-row items-center gap-3 py-2.5 pl-3 pr-2">
        <View className="size-10 items-center justify-center rounded-full bg-accent-soft">
          <Text className="text-sm font-bold text-accent-soft-foreground">{initials}</Text>
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
            {name}
          </Text>
          <Text className="text-xs text-muted" numberOfLines={2}>
            {username ? `@${username} · ` : ''}
            {details.join(' · ')}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Center on ${name}`}
          hitSlop={6}
          onPress={onCenter}
          className="size-9 items-center justify-center rounded-full bg-default active:opacity-70">
          <Icon name="scope" size={15} tintColor={muted} />
        </Pressable>
        <CloseButton accessibilityLabel="Close" onPress={onClose} />
      </View>
    </Glass>
  );
}
