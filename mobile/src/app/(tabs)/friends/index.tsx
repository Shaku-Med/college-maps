import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { Button, Chip, FieldError, ListGroup, Separator, TextField, useThemeColor, useToast } from 'heroui-native';
import { Fragment, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { GlassInput } from '@/components/glass-field';
import { EmptyState, SectionTitle } from '@/components/section';
import { StackLinkedItem } from '@/components/stack-linked-item';
import { getPlace } from '@/data/campus';
import { useLinkedParam, useLinkedSuffix } from '@/hooks/use-linked-row-opacity';
import { useReadableStyle } from '@/hooks/use-layout';
import { useProfile } from '@/lib/account';
import { MAX_USERNAME_LENGTH, normalizeUsername } from '@/lib/api';
import { refreshSocial, useSocial } from '@/lib/social';
import { socialApi, type Meetup, type Person } from '@/lib/social-api';

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

function Avatar({ person }: { person: Person }) {
  const letters = person.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View className="size-10 items-center justify-center rounded-full bg-default">
      <Text className="text-sm font-bold text-foreground">{letters || '?'}</Text>
    </View>
  );
}

function countLabel(count: number, empty: string, one: string, many: (n: number) => string) {
  if (count === 0) return empty;
  if (count === 1) return one;
  return many(count);
}

export default function FriendsScreen() {
  const readable = useReadableStyle();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const { toast } = useToast();
  const [accentForeground, muted] = useThemeColor(['accent-foreground', 'muted']);
  const [username, setUsername] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
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

  async function run(action: Promise<{ ok: boolean; message?: string }>, success?: string) {
    const res = await action;
    if (!res.ok) {
      toast.show({ variant: 'danger', label: 'message' in res && res.message ? res.message : 'Something went wrong' });
      return false;
    }
    if (success) toast.show({ variant: 'success', label: success });
    reload();
    return true;
  }

  async function addFriend() {
    const handle = normalizeUsername(username);
    if (handle.length < 3) return setAddError('Enter their username, at least 3 characters.');
    if (handle === me) return setAddError("That's you.");
    setAdding(true);
    setAddError(null);
    const res = await socialApi.addFriend(handle);
    setAdding(false);
    if (!res.ok) return setAddError(res.message);
    setUsername('');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast.show({ variant: 'success', label: res.data.status === 'friends' ? `You and @${handle} are friends` : 'Request sent' });
    reload();
  }

  const { friends, incoming, outgoing, blocked } = social.friends;
  const invitations = social.meetups.filter((m) => m.yourStatus === 'invited');
  const going = social.meetups.filter((m) => m.yourStatus === 'joined');

  return (
    <>
      <Stack.Title large>Friends</Stack.Title>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void reload()} />}
        contentContainerClassName="gap-6 px-4 pb-16 pt-2"
        contentContainerStyle={readable}>
        <View className="flex-row gap-3">
          <Button className="flex-1" onPress={() => router.push({ pathname: '/meetup/new', params: { kind: 'private' } })}>
            <Icon name="person.2.fill" size={14} tintColor={accentForeground} />
            <Button.Label>New meetup</Button.Label>
          </Button>
          <Button className="flex-1" variant="secondary" onPress={() => router.push({ pathname: '/meetup/new', params: { kind: 'public' } })}>
            <Icon name="megaphone" size={14} tintColor={muted} />
            <Button.Label>Campus event</Button.Label>
          </Button>
        </View>

        {invitations.length > 0 || going.length > 0 ? (
          <View>
            <SectionTitle>Your meetups</SectionTitle>
            <ListGroup>
              {[...invitations, ...going].map((meetup, index) => (
                <Fragment key={meetup.id}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <StackLinkedItem
                    linked={meetupLinked === meetup.id}
                    gestureSync={false}
                    onPress={() => router.push({ pathname: '/meetup/[id]', params: { id: meetup.id } })}>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle numberOfLines={1}>
                        {meetup.title ?? (meetup.yourRole === 'host' ? 'Your meetup' : `${meetup.host.displayName}'s meetup`)}
                      </ListGroup.ItemTitle>
                      <ListGroup.ItemDescription numberOfLines={1}>
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
                </Fragment>
              ))}
            </ListGroup>
          </View>
        ) : null}

        <View>
          <SectionTitle>Campus</SectionTitle>
          <ListGroup>
            <StackLinkedItem linked={activePeople === '/campus'} onPress={() => router.push('/friends/campus')}>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Happening on campus</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {countLabel(
                    social.campus.length,
                    'Nothing posted yet',
                    '1 open event',
                    (n) => `${n} open events`,
                  )}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </StackLinkedItem>
          </ListGroup>
        </View>

        <View>
          <SectionTitle>Add a friend</SectionTitle>
          <View className="flex-row items-start gap-2">
            <TextField className="flex-1" isInvalid={addError !== null}>
              <GlassInput
                value={username}
                onChangeText={(text) => {
                  setUsername(normalizeUsername(text).slice(0, MAX_USERNAME_LENGTH));
                  setAddError(null);
                }}
                placeholder="Their username"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={() => void addFriend()}
              />
              <FieldError>{addError ?? ''}</FieldError>
            </TextField>
            <Button isDisabled={adding || !username} onPress={() => void addFriend()}>
              <Button.Label>Add</Button.Label>
            </Button>
          </View>
        </View>

        {incoming.length > 0 ? (
          <View>
            <SectionTitle>Requests</SectionTitle>
            <ListGroup>
              {incoming.map((person, index) => (
                <Fragment key={person.username}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Avatar person={person} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle numberOfLines={1}>{person.displayName}</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription>@{person.username}</ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <View className="flex-row gap-2">
                      <Button size="sm" variant="secondary" onPress={() => void run(socialApi.removeRequest(person.username))}>
                        <Button.Label>Decline</Button.Label>
                      </Button>
                      <Button size="sm" onPress={() => void run(socialApi.acceptFriend(person.username), 'Friend added')}>
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
          <SectionTitle>People</SectionTitle>
          <ListGroup>
            <StackLinkedItem linked={activePeople === '/list'} onPress={() => router.push('/friends/list')}>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Your friends</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {countLabel(friends.length, 'No friends yet', '1 friend', (n) => `${n} friends`)}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </StackLinkedItem>
            <Separator className="mx-4" />
            <StackLinkedItem linked={activePeople === '/sent'} onPress={() => router.push('/friends/sent')}>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Sent</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {countLabel(outgoing.length, 'No pending requests', '1 waiting', (n) => `${n} waiting`)}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </StackLinkedItem>
            <Separator className="mx-4" />
            <StackLinkedItem linked={activePeople === '/blocked'} onPress={() => router.push('/friends/blocked')}>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Blocked</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  {countLabel(blocked.length, 'Nobody blocked yet', '1 person', (n) => `${n} people`)}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </StackLinkedItem>
          </ListGroup>
        </View>
      </ScrollView>
    </>
  );
}
