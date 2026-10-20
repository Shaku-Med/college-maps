import { router } from 'expo-router';
import { ListGroup, useThemeColor, useToast } from 'heroui-native';
import { Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { NativeMenu } from '@/components/native-menu';
import { confirmDangerous } from '@/lib/confirm';
import { reportPerson } from '@/lib/moderation';
import { socialApi, type Person } from '@/lib/social-api';

function initials(name: string, fallback: string) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return letters || fallback.slice(0, 2).toUpperCase() || '?';
}

export function Avatar({ person }: { person: Person }) {
  return (
    <View className="size-10 items-center justify-center rounded-full bg-accent-soft">
      <Text className="text-sm font-bold text-accent-soft-foreground">{initials(person.displayName, person.username)}</Text>
    </View>
  );
}

/** A friend with their options behind the ellipsis: invite, report, remove, block. */
export function FriendRow({ person, onChanged }: { person: Person; onChanged: () => void }) {
  const muted = useThemeColor('muted');
  const { toast } = useToast();

  async function run(action: Promise<{ ok: boolean; message?: string }>, success: string) {
    const res = await action;
    if (!res.ok) {
      toast.show({ variant: 'danger', label: res.message ?? 'Something went wrong' });
      return;
    }
    toast.show({ variant: 'success', label: success });
    onChanged();
  }

  return (
    <ListGroup.Item disabled>
      <ListGroup.ItemPrefix>
        <Avatar person={person} />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle numberOfLines={1}>{person.displayName}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription numberOfLines={1}>@{person.username}</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <ListGroup.ItemSuffix>
        <NativeMenu
          label={`${person.displayName} options`}
          actions={[
            {
              id: 'invite',
              title: 'Invite to a meetup',
              onPress: () => router.push({ pathname: '/meetup/new', params: { kind: 'private', friend: person.username } }),
            },
            {
              id: 'report',
              title: 'Report',
              onPress: () => reportPerson({ username: person.username, displayName: person.displayName, isFriend: true }),
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
  );
}
