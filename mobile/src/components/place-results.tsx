import * as Haptics from 'expo-haptics';
import { ListGroup, Separator, useThemeColor } from 'heroui-native';
import { Fragment, useMemo, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { SectionTitle } from '@/components/section';
import { StackLinkedItem } from '@/components/stack-linked-item';
import { CAMPUS, type Place } from '@/data/campus';
import { CATEGORY_SYMBOLS, categoryLabel } from '@/lib/categories';
import { PLACE_SECTIONS, floorLabel, parseRoomCode, searchPlaces } from '@/lib/search';

type PlaceResultsProps = {
  query: string;
  onPick: (place: Place, room?: string) => void;
  /** Picking a place for a form: a check marks the current choice instead of rows leading somewhere. */
  picking?: boolean;
  /** The current choice, when picking. */
  selectedId?: string;
  /** The place whose page is open beside this list, highlighted while it is. */
  linkedId?: string | null;
  /** Rows shown first, like "My location". */
  header?: ReactNode;
};

type RowProps = Pick<PlaceResultsProps, 'onPick' | 'picking' | 'selectedId' | 'linkedId'> & { place: Place };

function PlaceRow({ place, onPick, picking, selectedId, linkedId }: RowProps) {
  const [muted, accent] = useThemeColor(['muted', 'accent']);
  return (
    <StackLinkedItem
      linked={linkedId === place.id}
      gestureSync={false}
      onPress={() => {
        void Haptics.selectionAsync();
        onPick(place);
      }}>
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
      {picking ? (
        place.id === selectedId ? (
          <ListGroup.ItemSuffix>
            <Icon name="checkmark" size={15} weight="semibold" tintColor={accent} />
          </ListGroup.ItemSuffix>
        ) : null
      ) : (
        <ListGroup.ItemSuffix />
      )}
    </StackLinkedItem>
  );
}

function PlaceList({ places, ...row }: Omit<RowProps, 'place'> & { places: readonly Place[] }) {
  return (
    <ListGroup>
      {places.map((place, index) => (
        <Fragment key={place.id}>
          {index > 0 ? <Separator className="ml-16 mr-4" /> : null}
          <PlaceRow place={place} {...row} />
        </Fragment>
      ))}
    </ListGroup>
  );
}

/** Campus search results: a room match first, then matching places, or every place by kind when empty. */
export function PlaceResults({ query, header, ...row }: PlaceResultsProps) {
  const accentForeground = useThemeColor('accent-foreground');
  const trimmed = query.trim();
  const room = useMemo(() => parseRoomCode(trimmed), [trimmed]);
  const results = useMemo(() => searchPlaces(trimmed), [trimmed]);

  return (
    <>
      {header && !trimmed ? <ListGroup>{header}</ListGroup> : null}

      {room ? (
        <View>
          <SectionTitle>Room</SectionTitle>
          <ListGroup>
            <StackLinkedItem
              linked={!row.picking && row.linkedId === room.place.id}
              gestureSync={false}
              onPress={() => {
                void Haptics.selectionAsync();
                row.onPick(room.place, room.room);
              }}>
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
              {row.picking ? null : <ListGroup.ItemSuffix />}
            </StackLinkedItem>
          </ListGroup>
        </View>
      ) : null}

      {trimmed ? (
        results.length > 0 ? (
          <View>
            <SectionTitle>{room ? 'Places' : 'Results'}</SectionTitle>
            <PlaceList places={results} {...row} />
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
        PLACE_SECTIONS.map(({ category, places }) => (
          <View key={category}>
            <SectionTitle>{categoryLabel(category)}</SectionTitle>
            <PlaceList places={places} {...row} />
          </View>
        ))
      )}
    </>
  );
}
