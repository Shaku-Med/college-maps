import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Button, CloseButton, Description, FieldError, Label, ListGroup, Separator, TextField, useThemeColor, useToast } from 'heroui-native';
import { Fragment, useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { GlassInput } from '@/components/glass-field';
import { Icon } from '@/components/icon';
import { isAmenity } from '@/data/amenities';
import { getPlace, type Place } from '@/data/campus';
import { useProfile } from '@/lib/account';
import { CAR_ID, forgetCar, parkInLot, useCarSpot } from '@/lib/car-spot';
import { currentFix } from '@/lib/location';
import { eventsAtPlace } from '@/lib/campus-activity';
import { amenityWhere, reportPlaceId } from '@/lib/amenity-search';
import { categoryLabel, placeSymbol } from '@/lib/categories';
import { focusPlace } from '@/lib/focus';
import { openWeb, sharePlace } from '@/lib/links';
import { rememberPlace } from '@/lib/recent-places';
import { roomSpot } from '@/lib/building-safety';
import { EXAMPLE_ROOM, MAX_ROOM_INPUT, floorForRoom, floorLabel, roomInBuilding } from '@/lib/search';
import { useSocial } from '@/lib/social';
import { planTrip } from '@/lib/trip';

function parkedLabel(at: number, lotId?: string) {
  const time = new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const lot = lotId ? getPlace(lotId)?.name : undefined;
  return lot ? `${lot} · parked at ${time}` : `Parked at ${time}`;
}

function whenLabel(startsAt?: string) {
  if (!startsAt) return 'Happening now';
  const at = new Date(startsAt);
  if (at.getTime() <= Date.now()) return 'Happening now';
  return at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** A place's card: the phone shows it in a sheet, tablets in the map's left column. */
export function PlaceDetails({ place, room, onDone }: { place: Place; room?: string; onDone: () => void }) {
  const [muted, accent, accentForeground] = useThemeColor(['muted', 'accent', 'accent-foreground']);
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const events = eventsAtPlace(social.campus, place.id);
  const floor = room ? floorLabel(floorForRoom(room)) : undefined;
  const askRoom = place.isBuilding && !room;
  const [roomText, setRoomText] = useState('');
  const [roomError, setRoomError] = useState<string | null>(null);
  const typedRoom = askRoom ? roomInBuilding(roomText, place) : undefined;
  const typedFloor = typedRoom ? floorLabel(floorForRoom(typedRoom)) : undefined;
  const typedLandmark = roomSpot(place.id, typedRoom)?.landmark;
  const car = useCarSpot();
  const isCar = place.id === CAR_ID;
  const isLot = place.category === 'parking' && !isCar;
  const parkedHere = isLot && car?.lotId === place.id;
  const { toast } = useToast();

  function parkHere() {
    if (!parkInLot(place, currentFix()?.position)) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast.show({ label: 'Saved where you parked', description: 'Your car is on the map until tomorrow.' });
  }

  function startDirections() {
    if (askRoom && roomText.trim() && !typedRoom) {
      setRoomError(`That isn't a room in ${place.id}. Try a number like ${EXAMPLE_ROOM}, or leave it empty.`);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    planTrip(place.id, room ?? typedRoom);
    onDone();
  }

  useEffect(() => {
    focusPlace(place.id);
    if (place.id !== CAR_ID) rememberPlace(place.id);
    return () => focusPlace(null);
  }, [place]);

  return (
    <View className="gap-5">
      <View className="flex-row items-start gap-3.5">
        <View className="size-12 items-center justify-center rounded-2xl bg-accent">
          {isCar ? (
            <Icon name="car.fill" size={22} tintColor={accentForeground} />
          ) : isAmenity(place) ? (
            <Icon name={placeSymbol(place)} size={22} tintColor={accentForeground} />
          ) : (
            <Text className="text-base font-bold text-accent-foreground">{place.label ?? place.id}</Text>
          )}
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-2xl font-bold text-foreground" numberOfLines={2}>
            {room ? `Room ${room}` : place.name}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Icon name={placeSymbol(place)} size={13} tintColor={muted} />
            <Text className="text-sm text-muted" numberOfLines={1}>
              {room
                ? [place.name, floor].filter(Boolean).join(' · ')
                : isCar && car
                  ? parkedLabel(car.at, car.lotId)
                  : isAmenity(place)
                    ? amenityWhere(place)
                    : categoryLabel(place.category)}
            </Text>
          </View>
        </View>
        <CloseButton onPress={onDone} />
      </View>

      {askRoom ? (
        <TextField isInvalid={roomError !== null}>
          <Label>Which room?</Label>
          <GlassInput
            value={roomText}
            onChangeText={(text) => {
              setRoomText(text.slice(0, MAX_ROOM_INPUT));
              setRoomError(null);
            }}
            placeholder={`Like ${EXAMPLE_ROOM}`}
            maxLength={MAX_ROOM_INPUT}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="go"
            onSubmitEditing={startDirections}
          />
          {roomError ? null : (
            <Description>
              {typedRoom
                ? typedFloor
                  ? `Room ${typedRoom} is on the ${typedFloor.toLowerCase()}${typedLandmark ? `, ${typedLandmark}` : ''}.`
                  : `Room ${typedRoom} in ${place.name}.`
                : 'Optional. Leave it empty to go to the building.'}
            </Description>
          )}
          <FieldError>{roomError ?? ''}</FieldError>
        </TextField>
      ) : null}

      <View className="flex-row gap-3">
        <Button className="flex-1" onPress={startDirections}>
          <Icon name="figure.walk" size={16} weight="semibold" tintColor={accentForeground} />
          <Button.Label>Directions</Button.Label>
        </Button>
        {isCar ? (
          <Button
            className="flex-1"
            variant="secondary"
            onPress={() => {
              forgetCar();
              onDone();
            }}>
            <Icon name="xmark" size={16} weight="semibold" tintColor={muted} />
            <Button.Label>Forget</Button.Label>
          </Button>
        ) : (
          <Button className="flex-1" variant="secondary" onPress={() => void sharePlace(place, room)}>
            <Icon name="square.and.arrow.up" size={16} weight="semibold" tintColor={muted} />
            <Button.Label>Share</Button.Label>
          </Button>
        )}
      </View>

      {isLot ? (
        <ListGroup>
          <ListGroup.Item onPress={parkedHere ? undefined : parkHere} disabled={parkedHere}>
            <ListGroup.ItemPrefix>
              <Icon name={parkedHere ? 'checkmark' : 'car.fill'} size={20} tintColor={muted} />
            </ListGroup.ItemPrefix>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{parkedHere ? 'Your car is here' : 'I parked here'}</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                {parkedHere ? 'Find it again from the car on the map' : 'Puts your car on the map, on this phone only'}
              </ListGroup.ItemDescription>
            </ListGroup.ItemContent>
          </ListGroup.Item>
        </ListGroup>
      ) : null}

      {events.length > 0 ? (
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wide text-muted">Campus events here</Text>
          <ListGroup>
            {events.slice(0, 4).map((meetup, index) => (
              <Fragment key={meetup.id}>
                {index > 0 ? <Separator /> : null}
                <ListGroup.Item
                  onPress={() => {
                    onDone();
                    router.push(`/meetup/${meetup.id}`);
                  }}>
                  <View className="size-9 items-center justify-center rounded-full bg-accent-soft">
                    <Icon name="calendar" size={15} tintColor={accent} />
                  </View>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle numberOfLines={1}>{meetup.title ?? 'Campus event'}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>
                      {whenLabel(meetup.startsAt)}
                      {meetup.going > 0 ? ` · ${meetup.going} going` : ''}
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <Icon name="chevron.right" size={14} tintColor={muted} />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              </Fragment>
            ))}
          </ListGroup>
        </View>
      ) : null}

      {place.details && !isCar ? <Text className="text-base leading-6 text-foreground">{place.details}</Text> : null}

      {isCar ? null : (
      <ListGroup>
        <ListGroup.Item onPress={() => void openWeb(`/?place=${encodeURIComponent(place.id)}`)}>
          <ListGroup.ItemPrefix>
            <Icon name="safari" size={20} tintColor={muted} />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>Open on the web</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>Classes, friends, and meetups</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix />
        </ListGroup.Item>
        <Separator className="mx-4" />
        <ListGroup.Item
          onPress={() => {
            const about = reportPlaceId(place);
            router.push({ pathname: '/report-problem', params: about ? { place: about, kind: 'map' } : { kind: 'map' } });
          }}>
          <ListGroup.ItemPrefix>
            <Icon name="exclamationmark.bubble" size={20} tintColor={muted} />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>Report a problem</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>Wrong spot, name, or entrance</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix />
        </ListGroup.Item>
        {room || isAmenity(place) ? null : (
          <>
            <Separator className="mx-4" />
            <ListGroup.Item disabled>
              <ListGroup.ItemPrefix>
                <Icon name="number" size={20} tintColor={muted} />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Building code</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>{place.id}</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
            </ListGroup.Item>
          </>
        )}
      </ListGroup>
      )}
    </View>
  );
}
