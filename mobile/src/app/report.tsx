import { router, useLocalSearchParams } from 'expo-router';
import {
  Button,
  CloseButton,
  Description,
  Label,
  ListGroup,
  Separator,
  Switch,
  TextArea,
  TextField,
  useToast,
} from 'heroui-native';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useSheetInsets } from '@/hooks/use-sheet-insets';
import { useProfile } from '@/lib/account';
import { reasonLabel, sendReport, type ReportReason } from '@/lib/moderation';
import { refreshSocial } from '@/lib/social';
import { socialApi } from '@/lib/social-api';

const REASONS = new Set<ReportReason>(['spam', 'harassment', 'inappropriate', 'other']);

export default function ReportScreen() {
  const sheet = useSheetInsets();
  const { toast } = useToast();
  const me = useProfile()?.username;
  const params = useLocalSearchParams<{
    kind?: string;
    meetupId?: string;
    username?: string;
    name?: string;
    reason?: string;
    friend?: string;
  }>();

  const kind = params.kind === 'meetup' ? 'meetup' : 'user';
  const username = typeof params.username === 'string' ? params.username : '';
  const name = typeof params.name === 'string' && params.name ? params.name : username;
  const reason = REASONS.has(params.reason as ReportReason) ? (params.reason as ReportReason) : 'other';
  const isFriend = params.friend === '1' && kind === 'user';
  const meetupId = typeof params.meetupId === 'string' ? params.meetupId : undefined;
  const needsDetails = reason === 'other';

  const [details, setDetails] = useState('');
  const [alsoUnfriend, setAlsoUnfriend] = useState(false);
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!username) return null;

  async function submit() {
    if (busy) return;
    if (needsDetails && !details.trim()) {
      toast.show({ variant: 'danger', label: 'Tell us a little more so we know what went wrong.' });
      return;
    }
    setBusy(true);
    const report = await sendReport({
      kind,
      meetupId,
      username,
      reason,
      details: details.trim() || undefined,
    });
    if (!report.ok) {
      setBusy(false);
      toast.show({ variant: 'danger', label: report.message });
      return;
    }

    if (alsoBlock) {
      const blocked = await socialApi.block(username);
      if (!blocked.ok) toast.show({ variant: 'danger', label: blocked.message });
    } else if (alsoUnfriend && isFriend) {
      const removed = await socialApi.unfriend(username);
      if (!removed.ok) toast.show({ variant: 'danger', label: removed.message });
    }

    if (me) void refreshSocial(me);
    setBusy(false);
    toast.show({
      variant: 'success',
      label: alsoBlock ? `@${username} is blocked` : 'We got your report',
      description: alsoBlock
        ? 'We will look into what you shared.'
        : 'Thanks for telling us. We will look into it.',
    });
    router.dismissAll();
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5" contentContainerStyle={sheet}>
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-foreground">Submit report</Text>
        <CloseButton onPress={() => router.back()} isDisabled={busy} />
      </View>

      <View className="gap-2">
        <Text className="text-base leading-6 text-foreground">
          Thanks for looking out for everyone here. Notes like yours help us find accounts that are causing trouble so we
          can keep CSI Map a place students can trust.
        </Text>
        <Text className="text-sm leading-5 text-muted">
          You chose “{reasonLabel(reason)}” for {name ? `${name} ` : ''}@{username}.
        </Text>
      </View>

      <TextField>
        <Label>{needsDetails ? 'What happened?' : 'Anything else we should know? (optional)'}</Label>
        <TextArea
          value={details}
          onChangeText={setDetails}
          placeholder={
            needsDetails
              ? 'A short note helps us understand what went wrong.'
              : 'Add a short note if you want. You can leave this blank.'
          }
          maxLength={500}
          editable={!busy}
        />
        <Description>{needsDetails ? 'A few words are enough.' : 'Optional. Keep it under 500 characters.'}</Description>
      </TextField>

      {kind === 'user' ? (
        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">While you are here</Text>
          <ListGroup>
            {isFriend ? (
              <>
                <ListGroup.Item>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>Remove as a friend</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>You will no longer see each other as friends.</ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <Switch
                    isSelected={alsoUnfriend || alsoBlock}
                    isDisabled={busy || alsoBlock}
                    onSelectedChange={setAlsoUnfriend}
                  />
                </ListGroup.Item>
                <Separator className="mx-4" />
              </>
            ) : null}
            <ListGroup.Item>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>Block @{username}</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>
                  They will not be able to find you, add you, or invite you.
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <Switch
                isSelected={alsoBlock}
                isDisabled={busy}
                onSelectedChange={(next) => {
                  setAlsoBlock(next);
                  if (next) setAlsoUnfriend(true);
                }}
              />
            </ListGroup.Item>
          </ListGroup>
        </View>
      ) : null}

      <Button onPress={() => void submit()} isDisabled={busy}>
        <Button.Label>{busy ? 'Sending…' : 'Submit report'}</Button.Label>
      </Button>
      <Button variant="secondary" onPress={() => router.back()} isDisabled={busy}>
        <Button.Label>Cancel</Button.Label>
      </Button>
    </ScrollView>
  );
}
