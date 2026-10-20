import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Button, Card, CloseButton, FieldError, Label, TextField, useThemeColor, useToast } from 'heroui-native';
import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';

import { GlassInput } from '@/components/glass-field';
import { Icon } from '@/components/icon';
import { CAMPUS } from '@/data/campus';
import { useSheetInsets } from '@/hooks/use-sheet-insets';
import { useProfile } from '@/lib/account';
import { MAX_USERNAME_LENGTH, normalizeUsername } from '@/lib/api';
import { refreshSocial } from '@/lib/social';
import { socialApi } from '@/lib/social-api';

export default function AddFriendSheet() {
  const sheet = useSheetInsets();
  const profile = useProfile();
  const { toast } = useToast();
  const muted = useThemeColor('muted');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (!profile) return null;
  const me = profile.username;

  async function add() {
    const handle = normalizeUsername(username);
    if (handle.length < 3) return setError('Enter their username, at least 3 characters.');
    if (handle === me) return setError("That's you.");
    setAdding(true);
    setError(null);
    const res = await socialApi.addFriend(handle);
    setAdding(false);
    if (!res.ok) return setError(res.message);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast.show({ variant: 'success', label: res.data.status === 'friends' ? `You and @${handle} are friends` : `Request sent to @${handle}` });
    void refreshSocial(me);
    router.back();
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-6 px-5" contentContainerStyle={sheet}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-xl font-bold text-foreground">Add a friend</Text>
          <Text className="text-sm leading-5 text-muted">Friends find each other by username. Emails stay private.</Text>
        </View>
        <CloseButton onPress={() => router.back()} />
      </View>

      <View className="gap-3">
        <TextField isInvalid={error !== null}>
          <Label>Their username</Label>
          <GlassInput
            value={username}
            onChangeText={(text) => {
              setUsername(normalizeUsername(text).slice(0, MAX_USERNAME_LENGTH));
              setError(null);
            }}
            placeholder="username"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="send"
            onSubmitEditing={() => void add()}
          />
          <FieldError>{error ?? ''}</FieldError>
        </TextField>
        <Button isDisabled={adding || username.length < 3} onPress={() => void add()}>
          <Button.Label>Send request</Button.Label>
        </Button>
      </View>

      <Card className="flex-row items-center gap-3 rounded-3xl p-4">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-xs font-semibold text-muted">Your username</Text>
          <Text className="text-lg font-semibold text-foreground" numberOfLines={1}>
            @{me}
          </Text>
        </View>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => void Share.share({ message: `Add me on ${CAMPUS.app.name}, my username is @${me}` })}>
          <Icon name="square.and.arrow.up" size={14} tintColor={muted} />
          <Button.Label>Share</Button.Label>
        </Button>
      </Card>
    </ScrollView>
  );
}
