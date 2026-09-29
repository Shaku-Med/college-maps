import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { Chip, useThemeColor } from 'heroui-native';
import { ScrollView } from 'react-native';

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
                <Glass interactive className="flex-1" />
              </Chip.Background>
            )}
            {filter === 'all' ? null : (
              <SymbolView
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
