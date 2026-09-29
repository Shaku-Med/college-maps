import * as Haptics from 'expo-haptics';
import { cn } from 'heroui-native';
import { Pressable, ScrollView, Text } from 'react-native';

type Choice<T extends string> = { id: T; label: string };

/** A row of options where one is picked, shown with a filled background like the rest of the app. */
export function ChoiceChips<T extends string>({
  choices,
  value,
  onChange,
}: {
  choices: readonly Choice<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" accessibilityRole="radiogroup">
      {choices.map((choice) => {
        const selected = choice.id === value;
        return (
          <Pressable
            key={choice.id}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(choice.id);
            }}
            className={cn('rounded-full px-4 py-2', selected ? 'bg-accent' : 'bg-default')}>
            <Text className={cn('text-sm font-semibold', selected ? 'text-accent-foreground' : 'text-foreground')}>
              {choice.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
