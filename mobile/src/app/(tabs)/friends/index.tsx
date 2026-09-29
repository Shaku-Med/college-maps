import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Button, Card, Chip, FieldError, Input, ListGroup, Separator, TextField, useThemeColor, useToast } from 'heroui-native';
import { Fragment, useState } from 'react';
import { ActionSheetIOS, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';

import { EmptyState, SectionTitle } from '@/components/section';
import { getPlace } from '@/data/campus';
import { useProfile } from '@/lib/account';
import { MAX_USERNAME_LENGTH, normalizeUsername } from '@/lib/api';
import { refreshSocial, updateMeetup, useSocial } from '@/lib/social';
import { socialApi, type Meetup, type Person } from '@/lib/social-api';

function timeLeft(expiresAt: string) {
  const minutes = Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return 'ending';
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.round(minutes / 60)} h left`;
}

function startsText(startsAt?: string) {
  if (!startsAt) return 'Happening now';
  const at = new Date(startsAt);
  if (at.getTime() <= Date.now()) return 'Happening now';
  return at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
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

export default function FriendsScreen() {
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const { toast } = useToast();
  const [accentForeground, muted] = useThemeColor(['accent-foreground', 'muted']);
  const [username, setUsername] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (!profile) {
    return (
      <>
        <Stack.Title large>Friends</Stack.Title>
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="px-4 pt-6">
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
  const reload = () => void refreshSocial(me);

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

  function friendActions(person: Person) {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: person.displayName,
        message: `@${person.username}`,
        options: ['Invite to a meetup', 'Remove friend', 'Block', 'Cancel'],
        destructiveButtonIndex: [1, 2],
        cancelButtonIndex: 3,
      },
      (index) => {
        if (index === 0) router.push({ pathname: '/meetup/new', params: { kind: 'private', friend: person.username } });
        if (index === 1) void run(socialApi.unfriend(person.username), 'Removed');
        if (index === 2) {
          Alert.alert(`Block @${person.username}?`, 'They will not be able to find you, add you, or invite you.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Block', style: 'destructive', onPress: () => void run(socialApi.block(person.username), 'Blocked') },
          ]);
        }
      },
    );
  }

  async function join(meetup: Meetup) {
    const res = await socialApi.joinPublicMeetup(meetup.id);
    if (!res.ok) return toast.show({ variant: 'danger', label: res.message });
    updateMeetup(res.data);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({ pathname: '/meetup/[id]', params: { id: meetup.id } });
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
        refreshControl={<RefreshControl refreshing={social.loading} onRefresh={reload} />}
        contentContainerClassName="gap-6 px-4 pb-16 pt-2">
        <View className="flex-row gap-3">
          <Button className="flex-1" onPress={() => router.push({ pathname: '/meetup/new', params: { kind: 'private' } })}>
            <SymbolView name="person.2.fill" size={14} tintColor={accentForeground} />
            <Button.Label>New meetup</Button.Label>
          </Button>
          <Button className="flex-1" variant="secondary" onPress={() => router.push({ pathname: '/meetup/new', params: { kind: 'public' } })}>
            <SymbolView name="megaphone" size={14} tintColor={muted} />
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
                  <ListGroup.Item onPress={() => router.push({ pathname: '/meetup/[id]', params: { id: meetup.id } })}>
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
                  </ListGroup.Item>
                </Fragment>
              ))}
            </ListGroup>
          </View>
        ) : null}

        {social.campus.length > 0 ? (
          <View>
            <SectionTitle>Happening on campus</SectionTitle>
            <View className="gap-3">
              {social.campus.map((meetup) => (
                <Card key={meetup.id} className="gap-3 rounded-3xl p-4">
                  <View className="gap-1">
                    <Text className="text-lg font-semibold text-foreground" numberOfLines={1}>
                      {meetup.title}
                    </Text>
                    <Text className="text-sm text-muted" numberOfLines={1}>
                      {startsText(meetup.startsAt)} · {whereText(meetup)} · {meetup.going} going
                    </Text>
                    {meetup.note ? <Text className="text-sm leading-5 text-foreground">{meetup.note}</Text> : null}
                  </View>
                  {meetup.yourStatus === 'joined' ? (
                    <Button variant="secondary" size="sm" onPress={() => router.push({ pathname: '/meetup/[id]', params: { id: meetup.id } })}>
                      <Button.Label>You’re going</Button.Label>
                    </Button>
                  ) : (
                    <Button size="sm" onPress={() => void join(meetup)}>
                      <Button.Label>Join</Button.Label>
                    </Button>
                  )}
                </Card>
              ))}
            </View>
          </View>
        ) : null}

        <View>
          <SectionTitle>Add a friend</SectionTitle>
          <View className="flex-row items-start gap-2">
            <TextField className="flex-1" isInvalid={addError !== null}>
              <Input
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
          <SectionTitle>{friends.length > 0 ? `Friends · ${friends.length}` : 'Friends'}</SectionTitle>
          {friends.length === 0 ? (
            <Card className="rounded-3xl p-5">
              <Text className="text-center text-sm leading-5 text-muted">
                No friends yet. Ask for their username and add them above. Yours is @{me}.
              </Text>
            </Card>
          ) : (
            <ListGroup>
              {friends.map((person, index) => (
                <Fragment key={person.username}>
                  {index > 0 ? <Separator className="ml-16 mr-4" /> : null}
                  <ListGroup.Item onPress={() => friendActions(person)}>
                    <ListGroup.ItemPrefix>
                      <Avatar person={person} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle numberOfLines={1}>{person.displayName}</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription>@{person.username}</ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <SymbolView name="ellipsis" size={16} tintColor={muted} />
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                </Fragment>
              ))}
            </ListGroup>
          )}
        </View>

        {outgoing.length > 0 ? (
          <View>
            <SectionTitle>Sent</SectionTitle>
            <ListGroup>
              {outgoing.map((person, index) => (
                <Fragment key={person.username}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <ListGroup.Item disabled>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle numberOfLines={1}>{person.displayName}</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription>@{person.username} · waiting</ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <Button size="sm" variant="ghost" onPress={() => void run(socialApi.removeRequest(person.username))}>
                      <Button.Label>Cancel</Button.Label>
                    </Button>
                  </ListGroup.Item>
                </Fragment>
              ))}
            </ListGroup>
          </View>
        ) : null}

        {blocked.length > 0 ? (
          <View>
            <SectionTitle>Blocked</SectionTitle>
            <ListGroup>
              {blocked.map((person, index) => (
                <Fragment key={person.username}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <ListGroup.Item disabled>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle numberOfLines={1}>@{person.username}</ListGroup.ItemTitle>
                    </ListGroup.ItemContent>
                    <Button size="sm" variant="ghost" onPress={() => void run(socialApi.unblock(person.username), 'Unblocked')}>
                      <Button.Label>Unblock</Button.Label>
                    </Button>
                  </ListGroup.Item>
                </Fragment>
              ))}
            </ListGroup>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}
