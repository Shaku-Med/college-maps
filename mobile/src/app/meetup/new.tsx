import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Button,
  Checkbox,
  CloseButton,
  FieldError,
  Input,
  Label,
  ListGroup,
  Separator,
  TextField,
  useThemeColor,
  useToast,
} from 'heroui-native';
import { Fragment, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ChoiceChips } from '@/components/choice-chips';
import { PlacePicker } from '@/components/place-picker';
import { getPlace } from '@/data/campus';
import { useProfile } from '@/lib/account';
import { updateMeetup, useSocial } from '@/lib/social';
import { MAX_GUESTS, socialApi, type MeetupDestination } from '@/lib/social-api';

// The same choices as the web app.
const DURATIONS = [
  { id: '30', label: '30 min' },
  { id: '60', label: '1 hour' },
  { id: '120', label: '2 hours' },
  { id: '240', label: '4 hours' },
] as const;
const START_OPTIONS = [
  { id: '0', label: 'Now' },
  { id: '30', label: 'In 30 min' },
  { id: '60', label: 'In 1 hour' },
  { id: '180', label: 'In 3 hours' },
  { id: '1440', label: 'Tomorrow' },
] as const;
const MAX_NOTE = 80;
const MAX_TITLE = 60;

type Where = 'me' | 'friend' | 'place';

export default function NewMeetupSheet() {
  const params = useLocalSearchParams<{ kind?: string; friend?: string }>();
  const isPublic = params.kind === 'public';
  const profile = useProfile();
  const social = useSocial(profile?.username ?? null);
  const { toast } = useToast();
  const [muted, accent] = useThemeColor(['muted', 'accent']);

  const invited = social.friends.friends.some((f) => f.username === params.friend) ? [params.friend as string] : [];
  const [picked, setPicked] = useState<string[]>(invited);
  const [where, setWhere] = useState<Where>(isPublic ? 'place' : 'me');
  const [target, setTarget] = useState<string>();
  const [placeId, setPlaceId] = useState<string>();
  const [choosingPlace, setChoosingPlace] = useState(false);
  const [minutes, setMinutes] = useState<(typeof DURATIONS)[number]['id']>('120');
  const [startsIn, setStartsIn] = useState<(typeof START_OPTIONS)[number]['id']>('60');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!profile) return null;
  const place = getPlace(placeId);

  if (choosingPlace) {
    return (
      <View className="flex-1 gap-3 px-4 pt-5">
        <View className="flex-row items-center gap-2 px-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to the meetup"
            hitSlop={10}
            onPress={() => setChoosingPlace(false)}
            className="flex-row items-center gap-1 active:opacity-60">
            <Icon name="chevron.left" size={16} weight="semibold" tintColor={accent} />
            <Text className="text-base font-medium text-accent">Back</Text>
          </Pressable>
          <Text className="flex-1 text-center text-lg font-bold text-foreground">Where</Text>
          <View style={{ width: 56 }} />
        </View>
        <PlacePicker
          selectedId={placeId}
          onPick={(picked) => {
            setPlaceId(picked.id);
            setWhere('place');
            setChoosingPlace(false);
          }}
        />
      </View>
    );
  }

  async function create() {
    setError(null);
    let destination: MeetupDestination;
    if (where === 'place') {
      if (!place) return setError('Pick where to meet.');
      destination = { kind: 'place', placeId: place.id };
    } else {
      const username = where === 'me' ? profile!.username : target;
      if (!username) return setError('Pick who everyone meets at.');
      destination = { kind: 'member', username };
    }

    setBusy(true);
    const res = isPublic
      ? await socialApi.createPublicMeetup({
          title: title.trim(),
          note: note.trim() || undefined,
          destination,
          startsIn: Number(startsIn),
          minutes: Number(minutes),
        })
      : picked.length === 0
        ? null
        : await socialApi.createMeetup({ friends: picked, destination, note: note.trim() || undefined, minutes: Number(minutes) });
    setBusy(false);
    if (!res) return setError('Invite at least one friend.');
    if (!res.ok) return setError(res.message);
    updateMeetup(res.data);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast.show({ variant: 'success', label: isPublic ? 'Event posted' : 'Meetup started' });
    router.replace({ pathname: '/meetup/[id]', params: { id: res.data.id } });
  }

  const friends = social.friends.friends;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5 pb-12 pt-5">
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-foreground">{isPublic ? 'Campus event' : 'New meetup'}</Text>
        <CloseButton onPress={() => router.back()} />
      </View>
      <Text className="text-sm leading-5 text-muted">
        {isPublic
          ? 'Anyone on campus can see it and join. Location is only shared between people who join.'
          : 'Friends you invite see where you are while the meetup runs, and you see them. Nothing is saved.'}
      </Text>

      {isPublic ? (
        <TextField isRequired>
          <Label>Name</Label>
          <Input value={title} onChangeText={(text) => setTitle(text.slice(0, MAX_TITLE))} placeholder="Study group, pickup game..." />
        </TextField>
      ) : (
        <View className="gap-2">
          <Text className="px-1 text-sm font-medium text-foreground">
            Invite {picked.length > 0 ? `· ${picked.length} of ${MAX_GUESTS}` : `up to ${MAX_GUESTS}`}
          </Text>
          {friends.length === 0 ? (
            <Text className="px-1 text-sm text-muted">Add friends first, from the Friends tab.</Text>
          ) : (
            <ListGroup>
              {friends.map((friend, index) => {
                const on = picked.includes(friend.username);
                const full = !on && picked.length >= MAX_GUESTS;
                return (
                  <Fragment key={friend.username}>
                    {index > 0 ? <Separator className="mx-4" /> : null}
                    <ListGroup.Item
                      disabled={full}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setPicked((current) => (on ? current.filter((u) => u !== friend.username) : [...current, friend.username]));
                      }}>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle numberOfLines={1}>{friend.displayName}</ListGroup.ItemTitle>
                        <ListGroup.ItemDescription>@{friend.username}</ListGroup.ItemDescription>
                      </ListGroup.ItemContent>
                      <Checkbox isSelected={on} isDisabled={full} pointerEvents="none" />
                    </ListGroup.Item>
                  </Fragment>
                );
              })}
            </ListGroup>
          )}
        </View>
      )}

      <View className="gap-2">
        <Text className="px-1 text-sm font-medium text-foreground">Meet at</Text>
        {isPublic ? null : (
          <ChoiceChips
            choices={[
              { id: 'me', label: 'Where I am' },
              ...(picked.length > 0 ? [{ id: 'friend' as const, label: 'A friend' }] : []),
              { id: 'place', label: 'A place' },
            ]}
            value={where}
            onChange={setWhere}
          />
        )}
        {where === 'friend' ? (
          <ChoiceChips
            choices={picked.map((username) => ({
              id: username,
              label: friends.find((f) => f.username === username)?.displayName ?? username,
            }))}
            value={target ?? ''}
            onChange={setTarget}
          />
        ) : null}
        {where === 'place' ? (
          <Pressable onPress={() => setChoosingPlace(true)} className="flex-row items-center gap-3 rounded-2xl bg-default px-4 py-3.5 active:opacity-70">
            <Icon name="mappin.and.ellipse" size={16} tintColor={place ? accent : muted} />
            <Text className={place ? 'flex-1 text-base text-foreground' : 'flex-1 text-base text-muted'} numberOfLines={1}>
              {place?.name ?? 'Choose a place'}
            </Text>
            <Icon name="chevron.right" size={13} tintColor={muted} />
          </Pressable>
        ) : null}
      </View>

      {isPublic ? (
        <View className="gap-2">
          <Text className="px-1 text-sm font-medium text-foreground">Starts</Text>
          <ChoiceChips choices={START_OPTIONS} value={startsIn} onChange={setStartsIn} />
        </View>
      ) : null}

      <View className="gap-2">
        <Text className="px-1 text-sm font-medium text-foreground">Lasts</Text>
        <ChoiceChips choices={DURATIONS} value={minutes} onChange={setMinutes} />
      </View>

      <TextField>
        <Label>Note</Label>
        <Input value={note} onChangeText={(text) => setNote(text.slice(0, MAX_NOTE))} placeholder="Optional, like which entrance" />
      </TextField>

      {error ? <FieldError isInvalid>{error}</FieldError> : null}
      <Button size="lg" isDisabled={busy} onPress={() => void create()}>
        <Button.Label>{busy ? 'Starting' : isPublic ? 'Post event' : 'Start meetup'}</Button.Label>
      </Button>
    </ScrollView>
  );
}
