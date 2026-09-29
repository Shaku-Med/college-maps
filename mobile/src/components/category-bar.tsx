import * as Haptics from 'expo-haptics';
import { Chip, useThemeColor } from 'heroui-native';
import { ScrollView } from 'react-native';

import { Icon } from '@/components/icon';
import { Glass } from '@/components/glass';
import type { PlaceCategory } from '@/data/campus';
import { CATEGORY_SYMBOLS, USED_CATEGORIES, categoryLabel } from '@/lib/categories';

export type MapFilter = 'all' | PlaceCategory;

type CategoryBarProps = {
  value: MapFilter;
  onChange: (filter: MapFilter) => void;
};

const FILTERS: MapFilter[] = ['all', ...USED_CATEGORIES];

export function CategoryBar({ value, onChange }: CategoryBarProps) {
  const [foreground, accentForeground] = useThemeColor(['foreground', 'accent-foreground']);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-4 py-1"
      accessibilityRole="radiogroup">
      {FILTERS.map((filter) => {
        const selected = filter === value;
        return (
          <Chip
            key={filter}
            size="lg"
            variant={selected ? 'primary' : 'tertiary'}
            color={selected ? 'accent' : 'default'}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              void Haptics.selectionAsync();
              onChange(filter);
            }}>
            {selected ? null : (
              <Chip.Background>
                <Glass interactive radius={20} style={{ flex: 1 }} />
              </Chip.Background>
            )}
            {filter === 'all' ? null : (
              <Icon
                name={CATEGORY_SYMBOLS[filter]}
                size={14}
                weight="semibold"
                tintColor={selected ? accentForeground : foreground}
              />
            )}
            <Chip.Label className={selected ? 'font-semibold text-accent-foreground' : 'font-medium text-foreground'}>
              {filter === 'all' ? 'All' : categoryLabel(filter)}
            </Chip.Label>
          </Chip>
        );
      })}
    </ScrollView>
  );
}
