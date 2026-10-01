import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { ListGroup, Separator, useThemeColor } from 'heroui-native';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { useReadableStyle } from '@/hooks/use-layout';
import { PLACES, type Place } from '@/data/campus';
import { CATEGORY_SYMBOLS, categoryLabel } from '@/lib/categories';
import { MAX_QUERY_LENGTH, searchPlaces } from '@/lib/search';

type PlacePickerProps = {
  onPick: (place: Place) => void;
  selectedId?: string;
  /** Only buildings, for classes. */
  buildingsOnly?: boolean;
  /** Rows shown inside the same list as places, like "My location". */
  header?: ReactNode;
};

const SORTED = [...PLACES].sort((a, b) => a.name.localeCompare(b.name));

/**
 * A searchable list of campus places, the same search the rest of the app uses. The search box is the screen's
 * native header search bar, so this has to be the screen's outermost view.
 */
export function PlacePicker({ onPick, selectedId, buildingsOnly = false, header }: PlacePickerProps) {
  const readable = useReadableStyle();
  const [query, setQuery] = useState('');
  const [muted, accent] = useThemeColor(['muted', 'accent']);
  const places = useMemo(() => {
    const found = query.trim() ? searchPlaces(query, 40) : SORTED;
    return buildingsOnly ? found.filter((place) => place.isBuilding) : found;
  }, [query, buildingsOnly]);

  return (
    <>
      <Stack.SearchBar
        placeholder="Search places"
        autoCapitalize="none"
        hideWhenScrolling={false}
        onChangeText={(event) => setQuery(event.nativeEvent.text.slice(0, MAX_QUERY_LENGTH))}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerClassName="px-4 pb-8 pt-2"
        contentContainerStyle={readable}>
        {places.length === 0 && query.trim() ? (
          <View className="rounded-3xl bg-default px-5 py-6">
            <Text className="text-center text-sm leading-5 text-muted">No places match “{query.trim()}”.</Text>
          </View>
        ) : null}
        <ListGroup>
          {header ? (
            <>
              {header}
              {places.length > 0 ? <Separator className="ml-14 mr-4" /> : null}
            </>
          ) : null}
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
    </>
  );
}
