import * as Haptics from 'expo-haptics';
import { ListGroup, SearchField, Separator, useThemeColor } from 'heroui-native';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { Icon } from '@/components/icon';
import { PLACES, type Place } from '@/data/campus';
import { CATEGORY_SYMBOLS, categoryLabel } from '@/lib/categories';
import { MAX_QUERY_LENGTH, searchPlaces } from '@/lib/search';

type PlacePickerProps = {
  onPick: (place: Place) => void;
  selectedId?: string;
  /** Only buildings, for classes. */
  buildingsOnly?: boolean;
  /** Rows shown above the places, like "My location". */
  header?: ReactNode;
};

const SORTED = [...PLACES].sort((a, b) => a.name.localeCompare(b.name));

/** A searchable list of campus places, the same search the rest of the app uses. */
export function PlacePicker({ onPick, selectedId, buildingsOnly = false, header }: PlacePickerProps) {
  const [query, setQuery] = useState('');
  const [muted, accent] = useThemeColor(['muted', 'accent']);
  const places = useMemo(() => {
    const found = query.trim() ? searchPlaces(query, 40) : SORTED;
    return buildingsOnly ? found.filter((place) => place.isBuilding) : found;
  }, [query, buildingsOnly]);

  return (
    <View className="flex-1 gap-3">
      <SearchField value={query} onChange={(value) => setQuery(value.slice(0, MAX_QUERY_LENGTH))}>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="Search places" autoCorrect={false} />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerClassName="gap-4 pb-8">
        {header}
        <ListGroup>
          {places.map((place, index) => (
            <Fragment key={place.id}>
              {index > 0 ? <Separator className="ml-14 mr-4" /> : null}
              <ListGroup.Item
                onPress={() => {
                  void Haptics.selectionAsync();
                  onPick(place);
                }}>
                <ListGroup.ItemPrefix>
                  <Icon name={CATEGORY_SYMBOLS[place.category]} size={18} tintColor={muted} />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle numberOfLines={1}>{place.name}</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription numberOfLines={1}>
                    {[place.label ?? place.id, categoryLabel(place.category)].join(' · ')}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                {place.id === selectedId ? (
                  <ListGroup.ItemSuffix>
                    <Icon name="checkmark" size={15} weight="semibold" tintColor={accent} />
                  </ListGroup.ItemSuffix>
                ) : null}
              </ListGroup.Item>
            </Fragment>
          ))}
        </ListGroup>
      </ScrollView>
    </View>
  );
}
