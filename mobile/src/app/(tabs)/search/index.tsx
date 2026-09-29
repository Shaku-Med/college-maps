import * as Haptics from 'expo-haptics';
import { Stack } from 'expo-router';
import { ListGroup, Separator, useThemeColor } from 'heroui-native';
import { Fragment, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { CAMPUS, PLACES, type Place } from '@/data/campus';
import { CATEGORY_SYMBOLS, USED_CATEGORIES, categoryLabel } from '@/lib/categories';
import { showPlace } from '@/lib/links';
import { MAX_QUERY_LENGTH, floorLabel, parseRoomCode, searchPlaces } from '@/lib/search';

const BROWSE = USED_CATEGORIES.map((category) => ({
  category,
  places: PLACES.filter((place) => place.category === category).sort((a, b) => a.name.localeCompare(b.name)),
}));

function open(place: Place, room?: string) {
  void Haptics.selectionAsync();
  showPlace(place, room);
}

function PlaceRow({ place }: { place: Place }) {
  const muted = useThemeColor('muted');
  return (
    <ListGroup.Item onPress={() => open(place)}>
      <ListGroup.ItemPrefix>
        <View className="size-9 items-center justify-center rounded-xl bg-default">
          <Icon name={CATEGORY_SYMBOLS[place.category]} size={16} tintColor={muted} />
        </View>
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={1}>{place.name}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription numberOfLines={1}>
          {[place.label ?? place.id, categoryLabel(place.category)].join(' · ')}
        </ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix />
    </ListGroup.Item>
  );
}

function PlaceList({ places }: { places: readonly Place[] }) {
  return (
    <ListGroup>
      {places.map((place, index) => (
        <Fragment key={place.id}>
          {index > 0 ? <Separator className="ml-16 mr-4" /> : null}
          <PlaceRow place={place} />
        </Fragment>
      ))}
    </ListGroup>
  );
}

const SectionTitle = ({ children }: { children: string }) => (
  <Text className="px-1 pb-2 text-sm font-semibold text-muted">{children}</Text>
);

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const accentForeground = useThemeColor('accent-foreground');
  const trimmed = query.trim();
  const room = useMemo(() => parseRoomCode(trimmed), [trimmed]);
  const results = useMemo(() => searchPlaces(trimmed), [trimmed]);

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
        contentContainerClassName="gap-6 px-4 pb-12 pt-2">
        {room ? (
          <View>
            <SectionTitle>Room</SectionTitle>
            <ListGroup>
              <ListGroup.Item onPress={() => open(room.place, room.room)}>
                <ListGroup.ItemPrefix>
                  <View className="size-9 items-center justify-center rounded-xl bg-accent">
                    <Icon name="door.left.hand.open" size={16} tintColor={accentForeground} />
                  </View>
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>Room {room.room}</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription numberOfLines={1}>
                    {[room.place.name, floorLabel(room.floor)].filter(Boolean).join(' · ')}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix />
              </ListGroup.Item>
            </ListGroup>
          </View>
        ) : null}

        {trimmed ? (
          results.length > 0 ? (
            <View>
              <SectionTitle>{room ? 'Places' : 'Results'}</SectionTitle>
              <PlaceList places={results} />
            </View>
          ) : room ? null : (
            <View className="items-center gap-2 px-6 pt-10">
              <Text className="text-base font-semibold text-foreground">No matches for “{trimmed}”</Text>
              <Text className="text-center text-sm leading-5 text-muted">
                {CAMPUS.rooms.help ?? `Try a building name or a room like ${CAMPUS.rooms.example}.`}
              </Text>
            </View>
          )
        ) : (
          BROWSE.map(({ category, places }) => (
            <View key={category}>
              <SectionTitle>{categoryLabel(category)}</SectionTitle>
              <PlaceList places={places} />
            </View>
          ))
        )}
      </ScrollView>
    </>
  );
}
