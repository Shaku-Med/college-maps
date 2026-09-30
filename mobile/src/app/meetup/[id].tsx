import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Chip, CloseButton, ListGroup, Separator, Spinner, useThemeColor, useToast } from 'heroui-native';
import { Fragment, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { NativeMenu } from '@/components/native-menu';
import { getPlace } from '@/data/campus';
import { useProfile } from '@/lib/account';
import { confirmDangerous } from '@/lib/confirm';
import { showMeetupOnMap, useShownMeetup } from '@/lib/meetup-focus';
import { reportMeetup } from '@/lib/moderation';
import { updateMeetup, useSocial } from '@/lib/social';
import { MAX_GUESTS, socialApi, type Meetup, type MeetupMember, type MeetupStatus } from '@/lib/social-api';
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

  const closeAfter = () => {
    if (shown === meetup!.id) showMeetupOnMap(null);
    router.back();
  };

  const canInvite = host && meetup.visibility === 'private' && meetup.active;
  const inMeetup = new Set(meetup.members.map((m) => m.username));
  const guests = meetup.members.filter((m) => m.role === 'guest' && (m.status === 'invited' || m.status === 'joined')).length;
  const moreFriends = canInvite ? social.friends.friends.filter((f) => !inMeetup.has(f.username)) : [];
  const invite = (username: string) => void act(socialApi.inviteToMeetup(meetup.id, [username]));
  const canBeInvitedBack = (member: MeetupMember) =>
    canInvite && member.role === 'guest' && (member.status === 'left' || member.status === 'declined') && !member.staysOut;

  return (
    <ScrollView contentContainerClassName="gap-5 px-5 pb-12 pt-5" contentContainerStyle={{ width: '100%' }}>
      <View className="flex-row items-start gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-xs font-semibold uppercase tracking-wide text-muted">
            {meetup.visibility === 'public' ? 'Campus event' : 'Meetup'} · {timeLeft(meetup.expiresAt)}
          </Text>
          <Text className="text-2xl font-bold text-foreground" numberOfLines={2}>
            {meetup.title ?? (host ? 'Your meetup' : `${meetup.host.displayName}'s meetup`)}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Icon name="mappin.and.ellipse" size={13} tintColor={muted} />
            <Text className="text-sm text-muted" numberOfLines={1}>
              {where}
            </Text>
          </View>
        </View>
        <View className="flex-row items-center gap-1">
          {host || !profile ? null : (
            <NativeMenu
              label="Report or block"
              actions={[
                {
                  id: 'report',
                  title: 'Report this event',
                  onPress: () => reportMeetup(meetup),
                },
                {
                  id: 'block',
                  title: `Block @${meetup.host.username}`,
                  destructive: true,
                  onPress: () =>
                    confirmDangerous({
                      title: `Block @${meetup.host.username}?`,
                      message: 'Their events disappear for you, and they cannot add you or invite you.',
                      confirmLabel: 'Block',
                      onConfirm: async () => {
                        const res = await socialApi.block(meetup.host.username);
                        if (!res.ok) return toast.show({ variant: 'danger', label: res.message });
                        toast.show({ variant: 'success', label: 'Blocked' });
                        router.back();
                      },
                    }),
                },
              ]}>
              <View className="size-9 items-center justify-center">
                <Icon name="ellipsis.circle" size={22} tintColor={muted} />
              </View>
            </NativeMenu>
          )}
          <CloseButton onPress={() => router.back()} />
        </View>
      </View>

      {meetup.note ? <Text className="text-base leading-6 text-foreground">{meetup.note}</Text> : null}

      {meetup.yourStatus === 'invited' ? (
        <View className="flex-row gap-3">
          <NativeMenu
            label="Decline options"
            actions={[
              {
                id: 'decline',
                title: 'Not this time',
                onPress: () => void act(socialApi.respond(meetup.id, false), () => router.back()),
              },
              {
                id: 'decline-forever',
                title: "Don't invite me again",
                destructive: true,
                onPress: () => void act(socialApi.respond(meetup.id, false, true), () => router.back()),
              },
            ]}>
            <View className="flex-1">
              <Button className="w-full" variant="secondary" isDisabled={busy}>
                <Button.Label>Decline</Button.Label>
              </Button>
            </View>
          </NativeMenu>
          <Button className="flex-1" isDisabled={busy} onPress={() => void act(socialApi.respond(meetup.id, true))}>
            <Button.Label>Join</Button.Label>
          </Button>
        </View>
      ) : joined ? (
        <View className="gap-3">
          <View className="flex-row gap-3">
            <Button className="flex-1" onPress={showOnMap}>
              <Icon name="map.fill" size={15} tintColor={accentForeground} />
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
                <Icon name="figure.walk" size={15} tintColor={muted} />
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
                {canBeInvitedBack(member) ? (
                  <Button size="sm" variant="secondary" isDisabled={busy || guests >= MAX_GUESTS} onPress={() => invite(member.username)}>
                    <Button.Label>Invite back</Button.Label>
                  </Button>
                ) : (
                  <Chip size="sm" variant={member.status === 'joined' ? 'primary' : 'secondary'} color={member.status === 'joined' ? 'accent' : 'default'}>
                    <Chip.Label>{member.staysOut ? 'Stays out' : STATUS_TEXT[member.status]}</Chip.Label>
                  </Chip>
                )}
              </ListGroup.Item>
            </Fragment>
          ))}
        </ListGroup>
      </View>

      {moreFriends.length > 0 && guests < MAX_GUESTS ? (
        <View className="gap-2">
          <Text className="px-1 text-sm font-semibold text-muted">Invite more friends</Text>
          <ListGroup>
            {moreFriends.map((friend, index) => (
              <Fragment key={friend.username}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <ListGroup.Item disabled>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle numberOfLines={1}>{friend.displayName}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>@{friend.username}</ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => invite(friend.username)}>
                    <Button.Label>Invite</Button.Label>
                  </Button>
                </ListGroup.Item>
              </Fragment>
            ))}
          </ListGroup>
        </View>
      ) : null}

      {joined ? (
        host || meetup.visibility === 'public' ? (
          <Button
            variant="danger-soft"
            isDisabled={busy}
            onPress={() => {
              if (host) {
                confirmDangerous({
                  title: 'End this meetup?',
                  message: 'Everyone stops sharing their location.',
                  confirmLabel: 'End meetup',
                  onConfirm: () => void act(socialApi.endMeetup(meetup.id), closeAfter),
                });
                return;
              }
              void act(socialApi.leaveMeetup(meetup.id), closeAfter);
            }}>
            <Button.Label>{host ? 'End meetup' : 'Leave meetup'}</Button.Label>
          </Button>
        ) : (
          <NativeMenu
            label="Leave options"
            actions={[
              {
                id: 'leave',
                title: 'Leave',
                destructive: true,
                onPress: () => void act(socialApi.leaveMeetup(meetup.id), closeAfter),
              },
              {
                id: 'leave-forever',
                title: "Leave, don't invite me back",
                destructive: true,
                onPress: () =>
                  confirmDangerous({
                    title: "Leave for good?",
                    message: 'The host will not be able to invite you back to this meetup.',
                    confirmLabel: 'Leave for good',
                    onConfirm: () => void act(socialApi.leaveMeetup(meetup.id, true), closeAfter),
                  }),
              },
            ]}>
            <View>
              <Button variant="danger-soft" isDisabled={busy}>
                <Button.Label>Leave meetup</Button.Label>
              </Button>
            </View>
          </NativeMenu>
        )
      ) : null}
    </ScrollView>
  );
}
