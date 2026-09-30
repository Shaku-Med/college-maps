import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Button, Card, SearchField, useThemeColor, useToast } from 'heroui-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { NativeMenu } from '@/components/native-menu';
import { EmptyState } from '@/components/section';
import { getPlace } from '@/data/campus';
import { useReadableStyle } from '@/hooks/use-layout';
import { useProfile } from '@/lib/account';
import { matchesCampusEvent } from '@/lib/campus-search';
import { confirmDangerous } from '@/lib/confirm';
import { reportMeetup } from '@/lib/moderation';
import { refreshSocial, updateMeetup, useSocial } from '@/lib/social';
import { socialApi, type Meetup } from '@/lib/social-api';

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
  if (destination?.kind === 'pin') return 'At a pin on the map';
  return 'On campus';
}

export default function CampusEventsScreen() {
  const readable = useReadableStyle();
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const { toast } = useToast();
  const muted = useThemeColor('muted');
  const [query, setQuery] = useState('');
  const [pulling, setPulling] = useState(false);

  const events = social.campus;
  const filtered = useMemo(() => events.filter((meetup) => matchesCampusEvent(meetup, query)), [events, query]);

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

  async function join(meetup: Meetup) {
    const res = await socialApi.joinPublicMeetup(meetup.id);
    if (!res.ok) return toast.show({ variant: 'danger', label: res.message });
    updateMeetup(res.data);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({ pathname: '/meetup/[id]', params: { id: meetup.id } });
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
          <SearchField.Input
            placeholder="Search events, places, hosts"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
          />
          <SearchField.ClearButton />
        </SearchField.Group>
      </SearchField>

      <Button variant="secondary" onPress={() => router.push({ pathname: '/meetup/new', params: { kind: 'public' } })}>
        <Icon name="megaphone" size={14} tintColor={muted} />
        <Button.Label>Post a campus event</Button.Label>
      </Button>

      {events.length === 0 ? (
        <EmptyState
          title="Nothing on campus yet"
          description="Be the first to post something open to every student."
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matches" description={`Nothing matched “${query.trim()}”.`} />
      ) : (
        <View className="gap-3">
          {filtered.map((meetup) => (
            <Card key={meetup.id} className="gap-3 rounded-3xl p-4">
              <View className="gap-1">
                <View className="flex-row items-start gap-2">
                  <Text className="flex-1 text-lg font-semibold text-foreground" numberOfLines={2}>
                    {meetup.title}
                  </Text>
                  {meetup.yourRole === 'host' ? null : (
                    <NativeMenu
                      label="Event options"
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
                              onConfirm: () => void run(socialApi.block(meetup.host.username), 'Blocked'),
                            }),
                        },
                      ]}>
                      <View className="p-1">
                        <Icon name="ellipsis" size={18} tintColor={muted} />
                      </View>
                    </NativeMenu>
                  )}
                </View>
                <Text className="text-sm text-muted" numberOfLines={2}>
                  {startsText(meetup.startsAt)} · {whereText(meetup)} · {meetup.going} going · by{' '}
                  {meetup.host.displayName}
                </Text>
                {meetup.note && !meetup.note.startsWith('seed:') ? (
                  <Text className="text-sm leading-5 text-foreground">{meetup.note}</Text>
                ) : null}
                <Text className="text-xs text-muted">{timeLeft(meetup.expiresAt)}</Text>
              </View>
              {meetup.yourStatus === 'joined' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => router.push({ pathname: '/meetup/[id]', params: { id: meetup.id } })}>
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
      )}
    </ScrollView>
  );
}
