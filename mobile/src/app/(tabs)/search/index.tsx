import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { PlaceResults } from '@/components/place-results';
import { CAMPUS, getPlace, type Place } from '@/data/campus';
import { useLinkedParam } from '@/hooks/use-linked-row-opacity';
import { useReadableStyle } from '@/hooks/use-layout';
import { showPlace } from '@/lib/links';
import { MAX_QUERY_LENGTH } from '@/lib/search';
import { useRecentPlaces } from '@/lib/recent-places';
import { HEADER_ICONS } from '@/lib/header-icons';

function open(place: Place, room?: string) {
  void Haptics.selectionAsync();
  showPlace(place, room);
}

export default function SearchScreen() {
  const readable = useReadableStyle();
  const [query, setQuery] = useState('');
  const activePlaceId = useLinkedParam(/\/place\/([^/?]+)/);
  const recentIds = useRecentPlaces();
  const recent = recentIds.map((id) => getPlace(id)).filter((place): place is Place => place !== undefined);

  return (
    <>
      <Stack.Title large>Search</Stack.Title>
      {recent.length > 0 ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon={HEADER_ICONS.recent} accessibilityLabel="Recent places" title="Recent">
            {recent.map((place) => (
              <Stack.Toolbar.MenuAction key={place.id} icon="mappin.and.ellipse" onPress={() => open(place)}>
                {place.name}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
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
