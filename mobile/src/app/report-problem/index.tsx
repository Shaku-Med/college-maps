import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Button, CloseButton, Description, Label, ListGroup, Switch, TextField, useThemeColor, useToast } from 'heroui-native';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { ChoiceChips } from '@/components/choice-chips';
import { GlassTextArea } from '@/components/glass-field';
import { Icon } from '@/components/icon';
import { getPlace } from '@/data/campus';
import { useSheetInsets } from '@/hooks/use-sheet-insets';
import { useAccount } from '@/lib/account';
import { choosePlace, useChosenPlace } from '@/lib/place-choice';
import {
  MAX_PROBLEM_LENGTH,
  PROBLEM_KINDS,
  isProblemKind,
  problemKind,
  problemMessageIssue,
  sendProblemReport,
  type ProblemKind,
} from '@/lib/problem-reports';

const VERSION = Constants.expoConfig?.version;

export default function ReportProblemScreen() {
  const sheet = useSheetInsets();
  const { toast } = useToast();
  const account = useAccount();
  const [accent, muted] = useThemeColor(['accent', 'muted']);
  const params = useLocalSearchParams<{ place?: string; kind?: string }>();

  const [kind, setKind] = useState<ProblemKind>(isProblemKind(params.kind) ? params.kind : 'bug');
  const [message, setMessage] = useState('');
  const [mayContact, setMayContact] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const placeId = useChosenPlace();
  const place = getPlace(placeId);

  // Opened from a place, the report starts about it; every new report starts fresh otherwise.
  useEffect(() => {
    choosePlace(typeof params.place === 'string' ? params.place : undefined);
    return () => choosePlace(undefined);
  }, [params.place]);

  const signedIn = account.status === 'signed-in';

  async function send() {
    if (busy) return;
    const issue = problemMessageIssue(message);
    if (issue) return setError(issue);
    setError(null);
    setBusy(true);
    const res = await sendProblemReport({
      kind,
      message,
      placeId: place?.id,
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      appVersion: VERSION,
      mayContact,
    });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast.show({ variant: 'success', label: 'We got your report', description: 'Thanks for helping us make the map better.' });
    router.back();
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5" contentContainerStyle={sheet}>
      {/* The header is hidden here, but its title is what the place page's back button reads. */}
      <Stack.Screen options={{ title: 'Report a problem' }} />
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-foreground">Report a problem</Text>
        <CloseButton onPress={() => router.back()} isDisabled={busy} />
      </View>
      <Text className="text-sm leading-5 text-muted">
        Something broken, a building in the wrong spot, or an idea? Tell us and we will look into it.
      </Text>

      {signedIn ? (
        <>
          <View className="gap-2">
            <Text className="px-1 text-sm font-medium text-foreground">What is it about?</Text>
            <ChoiceChips choices={PROBLEM_KINDS} value={kind} onChange={setKind} />
          </View>

          <View className="gap-2">
            <Text className="px-1 text-sm font-medium text-foreground">Place (optional)</Text>
            <View className="flex-row items-center gap-2">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={place ? `About ${place.name}. Change` : 'Choose a place'}
                onPress={() => router.push('/report-problem/place')}
                className="flex-1 flex-row items-center gap-3 rounded-2xl bg-default px-4 py-3.5 active:opacity-70">
                <Icon name="mappin.and.ellipse" size={16} tintColor={place ? accent : muted} />
                <Text className={place ? 'flex-1 text-base text-foreground' : 'flex-1 text-base text-muted'} numberOfLines={1}>
                  {place?.name ?? 'Choose a place'}
                </Text>
                <Icon name="chevron.right" size={13} tintColor={muted} />
              </Pressable>
              {place ? <CloseButton accessibilityLabel="Remove the place" onPress={() => choosePlace(undefined)} /> : null}
            </View>
          </View>

          <TextField isInvalid={Boolean(error)}>
            <Label>What happened?</Label>
            <GlassTextArea
              value={message}
              onChangeText={(next) => {
                setMessage(next);
                if (error) setError(null);
              }}
              placeholder={problemKind(kind).hint}
              maxLength={MAX_PROBLEM_LENGTH}
              editable={!busy}
            />
            <Description>{error ?? `${[...message].length} / ${MAX_PROBLEM_LENGTH}`}</Description>
          </TextField>

          <ListGroup>
            <ListGroup.Item>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>You can email me about this</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>We would only write to your school email about this report.</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <Switch isSelected={mayContact} isDisabled={busy} onSelectedChange={setMayContact} />
            </ListGroup.Item>
          </ListGroup>

          <Button onPress={() => void send()} isDisabled={busy}>
            <Button.Label>{busy ? 'Sending…' : 'Send report'}</Button.Label>
          </Button>
        </>
      ) : (
        <View className="gap-3 rounded-3xl bg-default p-5">
          <Text className="text-base font-semibold text-foreground">Sign in to send a report</Text>
          <Text className="text-sm leading-5 text-muted">
            Reports come from signed-in students, which keeps spam out and lets us follow up if you want us to.
          </Text>
          <Button
            onPress={() => {
              router.back();
              router.navigate('/account');
            }}>
            <Button.Label>Sign in</Button.Label>
          </Button>
        </View>
      )}
    </ScrollView>
  );
}
