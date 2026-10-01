import { router } from 'expo-router';
import { ListGroup, SearchField, Separator, useThemeColor, useToast } from 'heroui-native';
import { Fragment, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { GlassSearchInput } from '@/components/glass-field';
import { NativeMenu } from '@/components/native-menu';
import { EmptyState } from '@/components/section';
import { useProfile } from '@/lib/account';
import { confirmDangerous } from '@/lib/confirm';
import { useReadableStyle } from '@/hooks/use-layout';
import { reportPerson } from '@/lib/moderation';
import { matchesPerson } from '@/lib/person-search';
import { refreshSocial, useSocial } from '@/lib/social';
import { socialApi, type Person } from '@/lib/social-api';

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

export default function FriendsListScreen() {
  const readable = useReadableStyle();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const { toast } = useToast();
  const muted = useThemeColor('muted');
  const [query, setQuery] = useState('');
  const [pulling, setPulling] = useState(false);

  const friends = social.friends.friends;
  const filtered = useMemo(() => friends.filter((person) => matchesPerson(person, query)), [friends, query]);

  async function reload() {
    if (!profile) return;
    setPulling(true);
    await refreshSocial(profile.username);
    setPulling(false);
  }

  async function run(action: Promise<{ ok: boolean; message?: string }>, success?: string) {
    const res = await action;
    if (!res.ok) {
      toast.show({ variant: 'danger', label: 'message' in res && res.message ? res.message : 'Something went wrong' });
      return;
    }
    if (success) toast.show({ variant: 'success', label: success });
    void reload();
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void reload()} />}
      contentContainerClassName="gap-4 px-4 pb-16 pt-2"
      contentContainerStyle={readable}>
      <SearchField value={query} onChange={setQuery}>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <GlassSearchInput placeholder="Search friends" autoCapitalize="none" autoCorrect={false} autoComplete="off" />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      {friends.length === 0 ? (
        <EmptyState
          title="No friends yet"
          description={
            profile
              ? `Ask for their username and add them from Friends. Yours is @${profile.username}.`
              : 'Sign in to add friends.'
          }
        />
      ) : filtered.length === 0 ? (
        <View className="rounded-3xl bg-default px-5 py-6">
          <Text className="text-center text-sm leading-5 text-muted">No matches for “{query.trim()}”.</Text>
        </View>
      ) : (
        <ListGroup>
          {filtered.map((person, index) => (
            <Fragment key={person.username}>
              {index > 0 ? <Separator className="ml-16 mr-4" /> : null}
              <ListGroup.Item disabled>
                <ListGroup.ItemPrefix>
                  <Avatar person={person} />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle numberOfLines={1}>{person.displayName}</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>@{person.username}</ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix>
                  <NativeMenu
                    label={`${person.displayName} options`}
                    actions={[
                      {
                        id: 'invite',
                        title: 'Invite to a meetup',
                        onPress: () =>
                          router.push({ pathname: '/meetup/new', params: { kind: 'private', friend: person.username } }),
                      },
                      {
                        id: 'report',
                        title: 'Report',
                        onPress: () =>
                          reportPerson({
                            username: person.username,
                            displayName: person.displayName,
                            isFriend: true,
                          }),
                      },
                      {
                        id: 'unfriend',
                        title: 'Remove friend',
                        destructive: true,
                        onPress: () =>
                          confirmDangerous({
                            title: `Remove @${person.username}?`,
                            message: 'You will no longer see each other as friends. You can add them again later.',
                            confirmLabel: 'Remove',
                            onConfirm: () => void run(socialApi.unfriend(person.username), 'Removed'),
                          }),
                      },
                      {
                        id: 'block',
                        title: 'Block',
                        destructive: true,
                        onPress: () =>
                          confirmDangerous({
                            title: `Block @${person.username}?`,
                            message: 'They will not be able to find you, add you, or invite you.',
                            confirmLabel: 'Block',
                            onConfirm: () => void run(socialApi.block(person.username), 'Blocked'),
                          }),
                      },
                    ]}>
                    <View className="p-2">
                      <Icon name="ellipsis" size={16} tintColor={muted} />
                    </View>
                  </NativeMenu>
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            </Fragment>
          ))}
        </ListGroup>
      )}
    </ScrollView>
  );
}
