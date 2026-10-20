import { Stack } from 'expo-router';
import { ListGroup, Separator } from 'heroui-native';
import { Fragment, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { FriendRow } from '@/components/person';
import { EmptyState } from '@/components/section';
import { useProfile } from '@/lib/account';
import { useReadableStyle } from '@/hooks/use-layout';
import { matchesPerson } from '@/lib/person-search';
import { refreshSocial, useSocial } from '@/lib/social';
import { MAX_QUERY_LENGTH } from '@/lib/search';

export default function FriendsListScreen() {
  const readable = useReadableStyle();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
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

  return (
    <>
      {/* Stacked: on iOS 26 an automatic bar can sink behind the tab bar's search, out of reach. */}
      <Stack.SearchBar
        placement="stacked"
        hideWhenScrolling={false}
        placeholder="Search friends"
        autoCapitalize="none"
        onChangeText={(event) => setQuery(event.nativeEvent.text.slice(0, MAX_QUERY_LENGTH))}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void reload()} />}
        contentContainerClassName="gap-4 px-4 pb-16 pt-2"
        contentContainerStyle={readable}>
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
                <FriendRow person={person} onChanged={() => void reload()} />
              </Fragment>
            ))}
          </ListGroup>
        )}
      </ScrollView>
    </>
  );
}
