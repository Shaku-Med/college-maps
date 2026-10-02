import { Stack } from 'expo-router';
import { Button, ListGroup, Separator, useToast } from 'heroui-native';
import { Fragment, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { EmptyState } from '@/components/section';
import { useProfile } from '@/lib/account';
import { useReadableStyle } from '@/hooks/use-layout';
import { matchesPerson } from '@/lib/person-search';
import { refreshSocial, useSocial } from '@/lib/social';
import { socialApi } from '@/lib/social-api';
import { MAX_QUERY_LENGTH } from '@/lib/search';

export default function SentScreen() {
  const readable = useReadableStyle();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [pulling, setPulling] = useState(false);
  const [busy, setBusy] = useState(false);

  const outgoing = social.friends.outgoing;
  const filtered = useMemo(() => outgoing.filter((person) => matchesPerson(person, query)), [outgoing, query]);

  async function reload() {
    if (!profile) return;
    setPulling(true);
    await refreshSocial(profile.username);
    setPulling(false);
  }

  async function cancel(username: string) {
    setBusy(true);
    const res = await socialApi.removeRequest(username);
    setBusy(false);
    if (!res.ok) {
      toast.show({ variant: 'danger', label: res.message });
      return;
    }
    toast.show({ variant: 'success', label: 'Request cancelled' });
    void reload();
  }

  return (
    <>
      {/* Stacked: on iOS 26 an automatic bar can sink behind the tab bar's search, out of reach. */}
      <Stack.SearchBar
        placement="stacked"
        hideWhenScrolling={false}
        placeholder="Search sent requests"
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
        {outgoing.length === 0 ? (
          <EmptyState
            title="No sent requests"
            description="When you add someone and they have not answered yet, they show up here."
          />
        ) : filtered.length === 0 ? (
          <View className="rounded-3xl bg-default px-5 py-6">
            <Text className="text-center text-sm leading-5 text-muted">No matches for “{query.trim()}”.</Text>
          </View>
        ) : (
          <ListGroup>
            {filtered.map((person, index) => (
              <Fragment key={person.username}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <ListGroup.Item disabled>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle numberOfLines={1}>{person.displayName}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>@{person.username} · waiting</ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => void cancel(person.username)}>
                    <Button.Label>Cancel</Button.Label>
                  </Button>
                </ListGroup.Item>
              </Fragment>
            ))}
          </ListGroup>
        )}
      </ScrollView>
    </>
  );
}
