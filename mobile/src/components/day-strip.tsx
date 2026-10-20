import * as Haptics from 'expo-haptics';
import { cn } from 'heroui-native';
import { Pressable, Text, View } from 'react-native';

import { DAY_SHORT, DAYS, type Day } from '@/lib/schedule';

/** The week as seven equal buttons: the chosen day is filled, today is bold, and a dot marks days with classes. */
export function DayStrip({
  selected,
  today,
  busy,
  names,
  onSelect,
}: {
  selected: Day;
  today: Day;
  busy: ReadonlySet<Day>;
  names: Record<Day, string>;
  onSelect: (day: Day) => void;
}) {
  return (
    <View className="flex-row gap-1" accessibilityRole="tablist">
      {DAYS.map((day) => {
        const on = day === selected;
        return (
          <Pressable
            key={day}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${names[day]}${day === today ? ', today' : ''}${busy.has(day) ? ', has classes' : ''}`}
            onPress={() => {
              if (on) return;
              void Haptics.selectionAsync();
              onSelect(day);
            }}
            className={cn('flex-1 items-center gap-1.5 rounded-2xl py-2.5', on && 'bg-accent-soft')}>
            <Text
              className={cn(
                'text-[13px]',
                on ? 'font-bold text-accent-soft-foreground' : day === today ? 'font-bold text-foreground' : 'font-medium text-muted',
              )}>
              {DAY_SHORT[day]}
            </Text>
            <View
              className={cn(
                'size-1.5 rounded-full',
                busy.has(day) ? (on ? 'bg-accent-soft-foreground' : 'bg-muted') : 'bg-transparent',
              )}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
