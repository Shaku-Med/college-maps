import { router, Stack } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { Button, Chip, ListGroup, Separator, useThemeColor, useToast } from 'heroui-native';
import { Fragment, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { ActionRow } from '@/components/action-row';
import { Icon } from '@/components/icon';
import { Avatar, FriendRow } from '@/components/person';
import { EmptyState, SectionTitle } from '@/components/section';
import { StackLinkedItem } from '@/components/stack-linked-item';
import { getPlace } from '@/data/campus';
import { useLinkedParam, useLinkedSuffix } from '@/hooks/use-linked-row-opacity';
import { useReadableStyle } from '@/hooks/use-layout';
import { useProfile } from '@/lib/account';
import { refreshSocial, useSocial } from '@/lib/social';
import { socialApi, type Meetup } from '@/lib/social-api';

// Enough to find the people you see most; the rest are one tap away with search.
const FRIENDS_SHOWN = 5;

function timeLeft(expiresAt: string) {
  const minutes = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return 'ending';
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.round(minutes / 60)} h left`;
}

function whereText(meetup: Meetup) {
  const destination = meetup.destination;
  if (destination?.kind === 'place') return getPlace(destination.placeId)?.name ?? 'On campus';
  if (destination?.kind === 'member') {
    const member = meetup.members.find((m) => m.username === destination.username);
    return member ? `At ${member.displayName}` : 'At a friend';
  }
  if (destination?.kind === 'pin') return 'At a pin on the map';
  return 'On campus';
}

function countLabel(count: number, empty: string, one: string, many: (n: number) => string) {
  if (count === 0) return empty;
  if (count === 1) return one;
  return many(count);
}

function RowIcon({ symbol }: { symbol: SFSymbol }) {
  const muted = useThemeColor('muted');
  return (
    <View className="size-10 items-center justify-center rounded-full bg-default">
      <Icon name={symbol} size={17} tintColor={muted} />
    </View>
  );
}

export default function FriendsScreen() {
  const readable = useReadableStyle();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const { toast } = useToast();
  const muted = useThemeColor('muted');
  const [pulling, setPulling] = useState(false);
  const activePeople = useLinkedSuffix('/campus', '/list', '/sent', '/blocked');
  const activeMeetupId = useLinkedParam(/\/meetup\/([^/?]+)/);
  const meetupLinked = activeMeetupId && activeMeetupId !== 'new' ? activeMeetupId : null;

  if (!profile) {
    return (
      <>
        <Stack.Title large>Friends</Stack.Title>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="px-4 pt-6" contentContainerStyle={readable}>
          <EmptyState
            title="See friends on the map"
            description="Sign in with your school email to add friends, plan meetups, and find each other on campus.">
            <Button className="mt-3" onPress={() => router.navigate('/account')}>
              <Button.Label>Sign in</Button.Label>
            </Button>
          </EmptyState>
        </ScrollView>
      </>
    );
  }
  const me = profile.username;
  // The spinner is only for a pull by hand. The list refreshes itself quietly in the background.
  const reload = async () => {
    setPulling(true);
    await refreshSocial(me);
    setPulling(false);
  };

  async function answer(action: Promise<{ ok: boolean; message?: string }>, success?: string) {
    const res = await action;
    if (!res.ok) {
      toast.show({ variant: 'danger', label: res.message ?? 'Something went wrong' });
      return;
    }
    if (success) toast.show({ variant: 'success', label: success });
    void reload();
  }

  const { friends, incoming, outgoing, blocked } = social.friends;
  const meetups = [
    ...social.meetups.filter((m) => m.yourStatus === 'invited'),
    ...social.meetups.filter((m) => m.yourStatus === 'joined'),
  ];
  const shownFriends = friends.slice(0, FRIENDS_SHOWN);

  return (
    <>
      <Stack.Title large>Friends</Stack.Title>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void reload()} />}
        contentContainerClassName="gap-6 px-4 pb-16 pt-2"
        contentContainerStyle={readable}>
        {incoming.length > 0 ? (
          <View>
            <SectionTitle>{incoming.length === 1 ? 'Wants to be friends' : `${incoming.length} want to be friends`}</SectionTitle>
            <ListGroup>
              {incoming.map((person, index) => (
                <Fragment key={person.username}>
                  {index > 0 ? <Separator className="ml-16 mr-4" /> : null}
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Avatar person={person} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle numberOfLines={1}>{person.displayName}</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription numberOfLines={1}>@{person.username}</ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <View className="flex-row gap-2">
                      <Button size="sm" variant="secondary" onPress={() => void answer(socialApi.removeRequest(person.username))}>
                        <Button.Label>Decline</Button.Label>
                      </Button>
                      <Button size="sm" onPress={() => void answer(socialApi.acceptFriend(person.username), 'Friend added')}>
                        <Button.Label>Accept</Button.Label>
                      </Button>
                    </View>
                  </ListGroup.Item>
                </Fragment>
              ))}
            </ListGroup>
          </View>
        ) : null}

        <View>
          <SectionTitle>Meetups</SectionTitle>
          <ListGroup>
            {meetups.map((meetup) => (
              <Fragment key={meetup.id}>
                <StackLinkedItem
                  linked={meetupLinked === meetup.id}
                  gestureSync={false}
                  onPress={() => router.push({ pathname: '/meetup/[id]', params: { id: meetup.id } })}>
                  <ListGroup.ItemPrefix>
                    <RowIcon symbol="person.2.fill" />
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle numberOfLines={1}>
                      {meetup.title ??
                        (meetup.note && !meetup.note.startsWith('seed:')
                          ? meetup.note
                          : meetup.yourRole === 'host'
                            ? 'Your meetup'
                            : `${meetup.host.displayName}'s meetup`)}
                    </ListGroup.ItemTitle>
                    <ListGroup.ItemDescription numberOfLines={1}>
                      {meetup.yourStatus === 'invited' ? `${meetup.host.displayName} · ` : ''}
                      {whereText(meetup)} · {timeLeft(meetup.expiresAt)}
                    </ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  {meetup.yourStatus === 'invited' ? (
                    <Chip size="sm" variant="primary" color="accent">
                      <Chip.Label>Invited</Chip.Label>
                    </Chip>
                  ) : (
                    <ListGroup.ItemSuffix />
                  )}
                </StackLinkedItem>
                <Separator className="ml-16 mr-4" />
              </Fragment>
            ))}
            <ActionRow
              symbol="plus"
              title="Start a meetup"
              description={
                friends.length === 0
                  ? 'Add a friend first'
                  : meetups.length === 0
                    ? 'Share where you are with friends for a few hours'
                    : undefined
              }
              onPress={() =>
                friends.length === 0
                  ? router.push('/add-friend')
                  : router.push({ pathname: '/meetup/new', params: { kind: 'private' } })
              }
            />
          </ListGroup>
        </View>

        <View>
          <SectionTitle
            action={
              friends.length > FRIENDS_SHOWN ? (
                <Pressable hitSlop={8} accessibilityRole="button" onPress={() => router.push('/friends/list')}>
                  <Text className="text-sm font-semibold text-accent">See all</Text>
                </Pressable>
              ) : undefined
            }>
            {friends.length > 0 ? `Friends · ${friends.length}` : 'Friends'}
          </SectionTitle>
          <ListGroup>
            {shownFriends.map((person) => (
              <Fragment key={person.username}>
                <FriendRow person={person} onChanged={() => void reload()} />
                <Separator className="ml-16 mr-4" />
              </Fragment>
            ))}
            <ActionRow
              symbol="person.badge.plus"
              title="Add a friend"
              description={friends.length === 0 ? `Or share your username, @${me}` : undefined}
              onPress={() => router.push('/add-friend')}
            />
          </ListGroup>
        </View>

        <View>
          <SectionTitle>On campus</SectionTitle>
          <ListGroup>
            <StackLinkedItem linked={activePeople === '/campus'} onPress={() => router.push('/friends/campus')}>
              <ListGroup.ItemPrefix>
                <RowIcon symbol="megaphone" />
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Happening on campus</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {countLabel(social.campus.length, 'Nothing posted yet', '1 open event', (n) => `${n} open events`)}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </StackLinkedItem>
          </ListGroup>
        </View>

        <ListGroup>
          <StackLinkedItem linked={activePeople === '/sent'} onPress={() => router.push('/friends/sent')}>
            <ListGroup.ItemPrefix>
              <Icon name="paperplane" size={18} tintColor={muted} />
            </ListGroup.ItemPrefix>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>Sent requests</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                {countLabel(outgoing.length, 'None waiting', '1 waiting', (n) => `${n} waiting`)}
              </ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix />
          </StackLinkedItem>
          <Separator className="mx-4" />
          <StackLinkedItem linked={activePeople === '/blocked'} onPress={() => router.push('/friends/blocked')}>
            <ListGroup.ItemPrefix>
              <Icon name="nosign" size={18} tintColor={muted} />
            </ListGroup.ItemPrefix>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>Blocked</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>
                {countLabel(blocked.length, 'Nobody', '1 person', (n) => `${n} people`)}
              </ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            <ListGroup.ItemSuffix />
          </StackLinkedItem>
        </ListGroup>
      </ScrollView>
    </>
  );
}
