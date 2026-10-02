import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Button, CloseButton, FieldError, Label, TextField, useThemeColor, useToast } from 'heroui-native';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useSheetInsets } from '@/hooks/use-sheet-insets';
import { GlassInput } from '@/components/glass-field';
import { Icon } from '@/components/icon';
import { deleteAccount, useAccount } from '@/lib/account';
import { setClasses } from '@/lib/classes';
import { disableNotifications } from '@/lib/notifications';

// Same confirmation as the web: the username must be typed, so a stray tap never erases an account.
export default function DeleteAccountScreen() {
  const sheet = useSheetInsets();
  const account = useAccount();
  const { toast } = useToast();
  const danger = useThemeColor('danger');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (account.status !== 'signed-in') return null;
  const user = account.user;
  const expected = user.username || 'delete';
  const prompt = user.username ? `Type @${user.username} to confirm` : 'Type "delete" to confirm';

  async function wipe() {
    if (confirm.trim().replace(/^@/, '').toLowerCase() !== expected.toLowerCase()) {
      setError(`${prompt}.`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setBusy(true);
    setError(null);
    await disableNotifications().catch(() => undefined);
    const res = await deleteAccount();
    if (!res.ok) {
      setBusy(false);
      setError(res.message);
      return;
    }
    setClasses([]);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast.show({ variant: 'success', label: 'Your information was deleted' });
    router.back();
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5" contentContainerStyle={sheet}>
      <View className="flex-row items-start justify-between gap-3">
        <View className="size-12 items-center justify-center rounded-2xl bg-danger-soft">
          <Icon name="trash" size={20} tintColor={danger} />
        </View>
        <CloseButton onPress={() => router.back()} />
      </View>

      <View className="gap-2">
        <Text className="text-2xl font-bold text-foreground">Delete your account?</Text>
        <Text className="text-base leading-6 text-muted">
          This wipes everything we have on you and cannot be undone. It removes your account, friends, blocks,
          meetups, sessions on every device, leftover sign in codes, notifications, and the classes saved on this
          phone.
        </Text>
      </View>

      <TextField isRequired isInvalid={error !== null}>
        <Label>{prompt}</Label>
        <GlassInput
          value={confirm}
          onChangeText={(text) => {
            setConfirm(text.slice(0, 40));
            setError(null);
          }}
          placeholder={user.username ? `@${user.username}` : 'delete'}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="done"
        />
        <FieldError>{error ?? ''}</FieldError>
      </TextField>

      <View className="flex-row gap-3">
        <Button className="flex-1" variant="secondary" isDisabled={busy} onPress={() => router.back()}>
          <Button.Label>Cancel</Button.Label>
        </Button>
        <Button className="flex-1" variant="danger" isDisabled={busy} onPress={() => void wipe()}>
          <Button.Label>{busy ? 'Deleting' : 'Wipe everything'}</Button.Label>
        </Button>
      </View>
    </ScrollView>
  );
}
