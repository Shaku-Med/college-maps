import { Alert, Linking } from 'react-native';

import { showActionSheet } from '@/lib/action-sheet';

import { SUPPORT_EMAIL } from '@/lib/config';
import { refreshSocial } from '@/lib/social';
import { socialApi, type Meetup } from '@/lib/social-api';

// Other students write event titles and notes, so every event from someone else can be reported, and its
// host blocked, right where it is shown.
export function moderateMeetup(meetup: Meetup, me: string, onBlocked?: () => void) {
  const host = meetup.host;
  const report = () => {
    const subject = encodeURIComponent('Report: CSI Map event');
    const body = encodeURIComponent(
      `Event: ${meetup.title ?? 'meetup'}
Event id: ${meetup.id}
Host: @${host.username}
Reported by: @${me}

What's wrong:
`,
    );
    void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() =>
      Alert.alert('No mail app', `Send your report to ${SUPPORT_EMAIL}.`),
    );
  };
  const block = () =>
    Alert.alert(`Block @${host.username}?`, 'Their events disappear for you, and they cannot add you or invite you.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Block',
        style: 'destructive',
        onPress: async () => {
          const res = await socialApi.block(host.username);
          if (!res.ok) return Alert.alert('Could not block', res.message);
          void refreshSocial(me);
          onBlocked?.();
        },
      },
    ]);

  showActionSheet({
    title: meetup.title ?? `${host.displayName}'s meetup`,
    actions: [
      ...(SUPPORT_EMAIL ? [{ label: 'Report this event', onPress: report }] : []),
      { label: `Block @${host.username}`, destructive: true, onPress: block },
    ],
  });
}
