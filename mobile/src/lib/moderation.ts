import { ActionSheetIOS, Alert, Linking } from 'react-native';

import { SUPPORT_EMAIL } from '@/lib/config';
import { refreshSocial } from '@/lib/social';
import { socialApi, type Meetup } from '@/lib/social-api';

// Other students write event titles and notes, so every event from someone else can be reported, and its
// host blocked, right where it is shown.
export function moderateMeetup(meetup: Meetup, me: string, onBlocked?: () => void) {
  const host = meetup.host;
  const options = [...(SUPPORT_EMAIL ? ['Report this event'] : []), `Block @${host.username}`, 'Cancel'];
  const report = SUPPORT_EMAIL ? 0 : -1;
  const block = report + 1;

  ActionSheetIOS.showActionSheetWithOptions(
    { title: meetup.title ?? `${host.displayName}'s meetup`, options, destructiveButtonIndex: block, cancelButtonIndex: options.length - 1 },
    (index) => {
      if (index === report) {
        const subject = encodeURIComponent('Report: CSI Map event');
        const body = encodeURIComponent(
          `Event: ${meetup.title ?? 'meetup'}\nEvent id: ${meetup.id}\nHost: @${host.username}\nReported by: @${me}\n\nWhat's wrong:\n`,
        );
        void Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() =>
          Alert.alert('No mail app', `Send your report to ${SUPPORT_EMAIL}.`),
        );
      } else if (index === block) {
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
      }
    },
  );
}
