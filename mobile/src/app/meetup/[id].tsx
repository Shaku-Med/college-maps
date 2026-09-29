import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Button, Chip, CloseButton, ListGroup, Separator, Spinner, useThemeColor, useToast } from 'heroui-native';
import { Fragment, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { getPlace } from '@/data/campus';
import { useProfile } from '@/lib/account';
import { showMeetupOnMap, useShownMeetup } from '@/lib/meetup-focus';
import { updateMeetup, useSocial } from '@/lib/social';
import { socialApi, type Meetup, type MeetupStatus } from '@/lib/social-api';
import { planTrip } from '@/lib/trip';

const STATUS_TEXT: Record<MeetupStatus, string> = {
  invited: 'Invited',
  joined: 'Going',
  declined: 'Not going',
  left: 'Left',
};

function timeLeft(expiresAt: string) {
  const minutes = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return 'Ending now';
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.round(minutes / 60)} h left`;
}

export default function MeetupSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const shown = useShownMeetup();
  const { toast } = useToast();
  const [accentForeground, muted] = useThemeColor(['accent-foreground', 'muted']);
  const listed = [...social.meetups, ...social.campus].find((m) => m.id === id);
  const [fetched, setFetched] = useState<Meetup | null>(null);
  const [busy, setBusy] = useState(false);
  const meetup = listed ?? fetched;

  // A meetup opened from somewhere that has not loaded it yet, such as a campus event, is fetched directly.
  useEffect(() => {
    if (listed || !id || !profile) return;
    let cancelled = false;
    void socialApi.meetup(id).then((res) => {
      if (!cancelled && res.ok) setFetched(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [id, listed, profile]);

  if (!meetup) {
    return (
      <View className="flex-1 items-center justify-center p-8">
        <Spinner />
      </View>
    );
  }

  const place = meetup.destination?.kind === 'place' ? getPlace(meetup.destination.placeId) : undefined;
  const destinationMember =
    meetup.destination?.kind === 'member' ? meetup.members.find((m) => m.username === meetup.destination?.username) : undefined;
  const where = place?.name ?? (destinationMember ? `Wherever ${destinationMember.displayName} is` : 'A pin on the map');
  const joined = meetup.yourStatus === 'joined';
  const host = meetup.yourRole === 'host';

  async function act(action: Promise<{ ok: true; data: Meetup } | { ok: false; message: string }>, done?: () => void) {
    setBusy(true);
    const res = await action;
    setBusy(false);
    if (!res.ok) return toast.show({ variant: 'danger', label: res.message });
    updateMeetup(res.data);
    setFetched(res.data);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    done?.();
  }

  function showOnMap() {
    showMeetupOnMap(meetup!.id);
    router.dismissAll();
    router.navigate('/');
  }

  function leave() {
    const ending = host;
    Alert.alert(ending ? 'End this meetup?' : 'Leave this meetup?', ending ? 'Everyone stops sharing their location.' : undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: ending ? 'End meetup' : 'Leave',
        style: 'destructive',
        onPress: () =>
          void act(ending ? socialApi.endMeetup(meetup!.id) : socialApi.leaveMeetup(meetup!.id), () => {
            if (shown === meetup!.id) showMeetupOnMap(null);
            router.back();
          }),
      },
    ]);
  }

  return (
    <ScrollView contentContainerClassName="gap-5 px-5 pb-12 pt-5">
      <View className="flex-row items-start gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
            {meetup.visibility === 'public' ? 'Campus event' : 'Meetup'} · {timeLeft(meetup.expiresAt)}
          </Text>
          <Text className="text-2xl font-bold text-foreground" numberOfLines={2}>
            {meetup.title ?? (host ? 'Your meetup' : `${meetup.host.displayName}'s meetup`)}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <SymbolView name="mappin.and.ellipse" size={13} tintColor={muted} />
            <Text className="text-sm text-muted" numberOfLines={1}>
              {where}
            </Text>
          </View>
        </View>
        <CloseButton onPress={() => router.back()} />
      </View>

      {meetup.note ? <Text className="text-base leading-6 text-foreground">{meetup.note}</Text> : null}

      {meetup.yourStatus === 'invited' ? (
        <View className="flex-row gap-3">
          <Button className="flex-1" variant="secondary" isDisabled={busy} onPress={() => void act(socialApi.respond(meetup.id, false), () => router.back())}>
            <Button.Label>Decline</Button.Label>
          </Button>
          <Button className="flex-1" isDisabled={busy} onPress={() => void act(socialApi.respond(meetup.id, true))}>
            <Button.Label>Join</Button.Label>
          </Button>
        </View>
      ) : joined ? (
        <View className="gap-3">
          <View className="flex-row gap-3">
            <Button className="flex-1" onPress={showOnMap}>
              <SymbolView name="map.fill" size={15} tintColor={accentForeground} />
              <Button.Label>{shown === meetup.id ? 'On the map' : 'Show on map'}</Button.Label>
            </Button>
            {place ? (
              <Button
                className="flex-1"
                variant="secondary"
                onPress={() => {
                  showMeetupOnMap(meetup.id);
                  planTrip(place.id);
                  router.dismissAll();
                  router.navigate('/');
                }}>
                <SymbolView name="figure.walk" size={15} tintColor={muted} />
                <Button.Label>Directions</Button.Label>
              </Button>
            ) : null}
          </View>
          <Text className="px-1 text-xs leading-5 text-muted">
            While the meetup is on the map, people in it see where you are, and you see them. Nothing is saved.
          </Text>
        </View>
      ) : null}

      <View className="gap-2">
        <Text className="px-1 text-sm font-semibold text-muted">
          {meetup.visibility === 'public' ? `${meetup.going} going` : 'People'}
        </Text>
        <ListGroup>
          {meetup.members.map((member, index) => (
            <Fragment key={member.username}>
              {index > 0 ? <Separator className="mx-4" /> : null}
              <ListGroup.Item disabled>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle numberOfLines={1}>
                    {member.displayName}
                    {member.username === profile?.username ? ' (you)' : ''}
                  </ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>
                    @{member.username}
                    {member.role === 'host' ? ' · Host' : ''}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                <Chip size="sm" variant={member.status === 'joined' ? 'primary' : 'secondary'} color={member.status === 'joined' ? 'accent' : 'default'}>
                  <Chip.Label>{STATUS_TEXT[member.status]}</Chip.Label>
                </Chip>
              </ListGroup.Item>
            </Fragment>
          ))}
        </ListGroup>
      </View>

      {joined ? (
        <Button variant="danger-soft" isDisabled={busy} onPress={leave}>
          <Button.Label>{host ? 'End meetup' : 'Leave meetup'}</Button.Label>
        </Button>
      ) : null}
    </ScrollView>
  );
}
