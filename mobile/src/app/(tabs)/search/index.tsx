import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { PlaceResults } from '@/components/place-results';
import { CAMPUS, type Place } from '@/data/campus';
import { useLinkedParam } from '@/hooks/use-linked-row-opacity';
import { useReadableStyle } from '@/hooks/use-layout';
import { showPlace } from '@/lib/links';
import { MAX_QUERY_LENGTH } from '@/lib/search';

function open(place: Place, room?: string) {
  void Haptics.selectionAsync();
  showPlace(place, room);
}

export default function SearchScreen() {
  const readable = useReadableStyle();
  const [query, setQuery] = useState('');
  const activePlaceId = useLinkedParam(/\/place\/([^/?]+)/);

  return (
    <>
      <Stack.Title large>Search</Stack.Title>
      <Stack.SearchBar
        placement="automatic"
        placeholder={`Room or building, like ${CAMPUS.rooms.example}`}
        autoCapitalize="none"
        onChangeText={(event) => setQuery(event.nativeEvent.text.slice(0, MAX_QUERY_LENGTH))}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerClassName="gap-6 px-4 pb-12 pt-2"
        contentContainerStyle={readable}>
        <PlaceResults query={query} onPick={open} linkedId={activePlaceId} />
      </ScrollView>
    </>
  );
}
