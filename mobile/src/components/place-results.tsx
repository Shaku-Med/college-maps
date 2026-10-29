import * as Haptics from 'expo-haptics';
import { ListGroup, Separator, useThemeColor } from 'heroui-native';
import { Fragment, useMemo, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { SectionTitle } from '@/components/section';
import { StackLinkedItem } from '@/components/stack-linked-item';
import { CAMPUS, type Coordinate, type Place } from '@/data/campus';
import { closestOfEach, searchAmenities, type AmenityMatch } from '@/lib/amenity-search';
import { categoryLabel, placeSymbol } from '@/lib/categories';
import { formatDistance } from '@/lib/geo';
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
  /** Also finds the SOS phones, benches, and the like closest to here or to the place open; the main search only. */
  nearby?: { here?: Coordinate; around?: Place };
};

type RowProps = Pick<PlaceResultsProps, 'onPick' | 'picking' | 'selectedId' | 'linkedId'> & { place: Place; note?: string };

const amenityNote = ({ meters, by }: AmenityMatch, measured = true) =>
  [by ? `Outside ${by.label ?? by.id}` : 'Outdoors', measured && formatDistance(meters)].filter(Boolean).join(' · ');

function PlaceRow({ place, note, onPick, picking, selectedId, linkedId }: RowProps) {
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
          <Icon name={placeSymbol(place)} size={16} tintColor={muted} />
        </View>
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={1}>{place.name}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription numberOfLines={1}>
          {note ?? [place.label ?? place.id, categoryLabel(place.category)].join(' · ')}
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

/** Campus search results: a room match first, then nearby outdoor things and matching places, or every place by kind when empty. */
export function PlaceResults({ query, header, nearby, ...row }: PlaceResultsProps) {
  const accentForeground = useThemeColor('accent-foreground');
  const trimmed = query.trim();
  const room = useMemo(() => parseRoomCode(trimmed), [trimmed]);
  const results = useMemo(() => searchPlaces(trimmed), [trimmed]);
  const wantsNearby = nearby !== undefined;
  const here = nearby?.here;
  const around = nearby?.around;
  const amenities = useMemo(() => {
    const found = wantsNearby && trimmed && !room ? searchAmenities(trimmed, { here, around }) : null;
    return found?.matches.length ? found : null;
  }, [trimmed, room, wantsNearby, here, around]);
  // With nothing typed, the closest one of each kind, one tap from directions; only once we know where you are.
  const closest = useMemo(() => (wantsNearby && here ? closestOfEach(here) : []), [wantsNearby, here]);

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

      {amenities ? (
        <View>
          <SectionTitle>{amenities.title}</SectionTitle>
          <ListGroup>
            {amenities.matches.map((match, index) => (
              <Fragment key={match.place.id}>
                {index > 0 ? <Separator className="ml-16 mr-4" /> : null}
                <PlaceRow place={match.place} note={amenityNote(match, amenities.measured)} {...row} />
              </Fragment>
            ))}
          </ListGroup>
        </View>
      ) : null}

      {!trimmed && closest.length > 0 ? (
        <View>
          <SectionTitle>Closest to you</SectionTitle>
          <ListGroup>
            {closest.map((match, index) => (
              <Fragment key={match.place.id}>
                {index > 0 ? <Separator className="ml-16 mr-4" /> : null}
                <PlaceRow place={match.place} note={amenityNote(match)} {...row} />
              </Fragment>
            ))}
          </ListGroup>
        </View>
      ) : null}

      {trimmed ? (
        results.length > 0 ? (
          <View>
            <SectionTitle>{room || amenities ? 'Places' : 'Results'}</SectionTitle>
            <PlaceList places={results} {...row} />
          </View>
        ) : room || amenities ? null : (
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
