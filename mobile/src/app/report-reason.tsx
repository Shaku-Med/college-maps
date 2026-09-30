import { router, useLocalSearchParams } from 'expo-router';
import { CloseButton, ListGroup, Separator } from 'heroui-native';
import { ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { useSheetInsets } from '@/hooks/use-sheet-insets';
import { REPORT_REASONS, type ReportReason } from '@/lib/moderation';

export default function ReportReasonScreen() {
  const sheet = useSheetInsets();
  const params = useLocalSearchParams<{
    kind?: string;
    meetupId?: string;
    username?: string;
    name?: string;
    friend?: string;
  }>();

  const kind = params.kind === 'meetup' ? 'meetup' : 'user';
  const username = typeof params.username === 'string' ? params.username : '';
  const name = typeof params.name === 'string' && params.name ? params.name : username;
  const friend = params.friend === '1' ? '1' : '0';
  const meetupId = typeof params.meetupId === 'string' ? params.meetupId : undefined;

  if (!username) return null;

  function pick(reason: ReportReason) {
    router.push({
      pathname: '/report',
      params: {
        kind,
        username,
        name,
        reason,
        friend,
        ...(meetupId ? { meetupId } : {}),
      },
    });
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5" contentContainerStyle={sheet}>
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-foreground">Why are you reporting?</Text>
        <CloseButton onPress={() => router.back()} />
      </View>
      <Text className="text-base leading-6 text-muted">
        {kind === 'meetup'
          ? `Pick what fits best for this event from @${username}.`
          : `Pick what fits best for ${name ? `${name} ` : ''}@${username}.`}
      </Text>
      <ListGroup>
        {REPORT_REASONS.map((reason, index) => (
          <View key={reason.id}>
            {index > 0 ? <Separator className="mx-4" /> : null}
            <ListGroup.Item onPress={() => pick(reason.id)}>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{reason.label}</ListGroup.ItemTitle>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <Icon name="chevron.right" size={14} />
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          </View>
        ))}
      </ListGroup>
    </ScrollView>
  );
}
