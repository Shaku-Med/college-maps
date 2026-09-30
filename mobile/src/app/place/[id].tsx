import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, CloseButton, ListGroup, Separator, useThemeColor } from 'heroui-native';
import { useEffect, Fragment } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { getPlace } from '@/data/campus';
import { useProfile } from '@/lib/account';
import { eventsAtPlace } from '@/lib/campus-activity';
import { CATEGORY_SYMBOLS, categoryLabel } from '@/lib/categories';
import { focusPlace } from '@/lib/focus';
import { rememberPlace } from '@/lib/recent-places';
import { openWeb, sharePlace } from '@/lib/links';
import { floorForRoom, floorLabel, isValidRoom } from '@/lib/search';
import { useSocial } from '@/lib/social';
import { planTrip } from '@/lib/trip';

function whenLabel(startsAt?: string) {
  if (!startsAt) return 'Happening now';
  const at = new Date(startsAt);
  if (at.getTime() <= Date.now()) return 'Happening now';
  return at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function PlaceSheet() {
  const params = useLocalSearchParams<{ id: string; room?: string }>();
  const place = getPlace(params.id);
  const room = isValidRoom(params.room) ? params.room : undefined;
  const [muted, accent, accentForeground] = useThemeColor(['muted', 'accent', 'accent-foreground']);
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const events = place ? eventsAtPlace(social.campus, place.id) : [];

  useEffect(() => {
    if (!place) return;
    focusPlace(place.id);
    rememberPlace(place.id);
    return () => focusPlace(null);
  }, [place]);

  if (!place) {
    return (
      <View className="flex-1 items-center justify-center gap-3 p-8">
        <Text className="text-lg font-semibold text-foreground">That place isn’t on the map</Text>
        <Button variant="secondary" onPress={() => router.back()}>
          Close
        </Button>
      </View>
    );
  }

  const floor = room ? floorLabel(floorForRoom(room)) : undefined;

  return (
    <ScrollView contentContainerClassName="gap-5 px-5 pb-10 pt-6" contentContainerStyle={{ width: '100%' }}>
      <View className="flex-row items-start gap-3.5">
        <View className="size-12 items-center justify-center rounded-2xl bg-accent">
          <Text className="text-base font-bold text-accent-foreground">{place.label ?? place.id}</Text>
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-2xl font-bold text-foreground" numberOfLines={2}>
            {room ? `Room ${room}` : place.name}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Icon name={CATEGORY_SYMBOLS[place.category]} size={13} tintColor={muted} />
            <Text className="text-sm text-muted" numberOfLines={1}>
              {room ? [place.name, floor].filter(Boolean).join(' · ') : categoryLabel(place.category)}
            </Text>
          </View>
        </View>
        <CloseButton onPress={() => router.back()} />
      </View>

      <View className="flex-row gap-3">
        <Button
          className="flex-1"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            planTrip(place.id, room);
            router.back();
          }}>
          <Icon name="figure.walk" size={16} weight="semibold" tintColor={accentForeground} />
          <Button.Label>Directions</Button.Label>
        </Button>
        <Button className="flex-1" variant="secondary" onPress={() => void sharePlace(place, room)}>
          <Icon name="square.and.arrow.up" size={16} weight="semibold" tintColor={muted} />
          <Button.Label>Share</Button.Label>
        </Button>
      </View>

      {events.length > 0 ? (
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-wide text-muted">Campus events here</Text>
          <ListGroup>
            {events.slice(0, 4).map((meetup, index) => (
              <Fragment key={meetup.id}>
                {index > 0 ? <Separator /> : null}
                <ListGroup.Item
                  onPress={() => {
                    router.back();
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

      {place.details ? <Text className="text-base leading-6 text-foreground">{place.details}</Text> : null}


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
        {room ? null : (
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
    </ScrollView>
  );
}
