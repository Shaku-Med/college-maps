import { Stack } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView } from 'react-native';

import { PlaceResults } from '@/components/place-results';
import { CAMPUS, type Place } from '@/data/campus';
import { useReadableStyle } from '@/hooks/use-layout';
import { MAX_QUERY_LENGTH } from '@/lib/search';

type PlacePickerProps = {
  onPick: (place: Place) => void;
  selectedId?: string;
  /** Rows shown first, like "My location". */
  header?: ReactNode;
};

/**
 * Picks a campus place with the same search and results as the Search tab. The search box is the screen's native
 * header search bar, so this has to be the screen's outermost view.
 */
export function PlacePicker({ onPick, selectedId, header }: PlacePickerProps) {
  const readable = useReadableStyle();
  const [query, setQuery] = useState('');

  return (
    <>
      {/* Stacked under the title so it is always in reach; on iOS 26 an automatic bar can move to the bottom. */}
      <Stack.SearchBar
        placement="stacked"
        hideWhenScrolling={false}
        placeholder={`Room or building, like ${CAMPUS.rooms.example}`}
        autoCapitalize="none"
        onChangeText={(event) => setQuery(event.nativeEvent.text.slice(0, MAX_QUERY_LENGTH))}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerClassName="gap-6 px-4 pb-8 pt-2"
        contentContainerStyle={readable}>
        <PlaceResults query={query} onPick={onPick} picking selectedId={selectedId} header={header} />
      </ScrollView>
    </>
  );
}
