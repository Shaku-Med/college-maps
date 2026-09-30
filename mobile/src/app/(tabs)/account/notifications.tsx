import type { SFSymbol } from 'expo-symbols';
import { ListGroup, Separator, Switch, useThemeColor, useToast } from 'heroui-native';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { SectionTitle } from '@/components/section';
import { useAccount } from '@/lib/account';
import { settingsApi, type NotifyPrefs } from '@/lib/api';
import { useReadableStyle } from '@/hooks/use-layout';
import {
  disableNotifications,
  enableNotifications,
  setPhonePref,
  useNotificationsEnabled,
  usePhonePrefs,
  type PhonePrefs,
} from '@/lib/notifications';

function ToggleRow({
  symbol,
  title,
  description,
  value,
  disabled = false,
  onChange,
}: {
  symbol: SFSymbol;
  title: string;
  description?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  const muted = useThemeColor('muted');
  return (
    <ListGroup.Item disabled>
      <ListGroup.ItemPrefix>
        <Icon name={symbol} size={20} tintColor={muted} />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle>{title}</ListGroup.ItemTitle>
        {description ? <ListGroup.ItemDescription>{description}</ListGroup.ItemDescription> : null}
      </ListGroup.ItemContent>
      <Switch isSelected={value} isDisabled={disabled} onSelectedChange={onChange} />
    </ListGroup.Item>
  );
}

const PHONE_ROWS: { key: keyof PhonePrefs; symbol: SFSymbol; title: string; description: string }[] = [
  { key: 'badge', symbol: 'app.badge', title: 'App icon badge', description: 'Count friend requests and invites waiting for you' },
  { key: 'banners', symbol: 'rectangle.stack', title: 'Banners in the app', description: 'Show alerts while CSI Map is open' },
  { key: 'sound', symbol: 'speaker.wave.2', title: 'Sound', description: 'Play a sound when an alert arrives' },
];

const ACCOUNT_ROWS: { key: keyof NotifyPrefs; symbol: SFSymbol; title: string; description: string }[] = [
  { key: 'friendRequests', symbol: 'person.badge.plus', title: 'Friend requests', description: 'When someone wants to be friends' },
  { key: 'meetupInvites', symbol: 'envelope', title: 'Meetup invites', description: 'When a friend invites you to meet' },
  { key: 'meetupJoins', symbol: 'person.2', title: 'Someone joins', description: 'When someone joins a meetup you are in' },
];

export default function NotificationsScreen() {
  const readable = useReadableStyle();
  const account = useAccount();
  const { toast } = useToast();
  const [enabled, setEnabled] = useNotificationsEnabled();
  const phone = usePhonePrefs();
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<NotifyPrefs | null>(null);
  const signedIn = account.status === 'signed-in';

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void settingsApi.notify().then((res) => {
      if (!cancelled && res.ok) setPrefs(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  async function changeEnabled(next: boolean) {
    setBusy(true);
    if (!next) {
      await disableNotifications().catch(() => undefined);
      setEnabled(false);
      setBusy(false);
      return;
    }
    const result = await enableNotifications();
    setBusy(false);
    if (result === 'on') {
      setEnabled(true);
    } else if (result === 'denied') {
      toast.show({
        variant: 'warning',
        label: 'Notifications are off for CSI Map',
        description: 'Turn them on in Settings to hear about friend requests and meetups.',
        actionLabel: 'Settings',
        onActionPress: ({ hide }) => {
          hide();
          void Linking.openSettings();
        },
      });
    } else if (result === 'unavailable') {
      toast.show({
        variant: 'warning',
        label: "Notifications aren't available on this build",
        description: 'This version of the app cannot receive notifications yet. An update will turn them on.',
      });
    } else {
      toast.show({ variant: 'danger', label: "Couldn't turn on notifications", description: 'Try again in a moment.' });
    }
  }

  // The switch moves right away and goes back if the server says no.
  async function changeKind(key: keyof NotifyPrefs, next: boolean) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: next });
    const res = await settingsApi.saveNotify({ [key]: next });
    if (res.ok) {
      setPrefs(res.data);
    } else {
      setPrefs(before);
      toast.show({ variant: 'danger', label: "Couldn't save that", description: res.message });
    }
  }

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-6 px-4 pb-16 pt-4" contentContainerStyle={readable}>
      <View>
        <SectionTitle>This phone</SectionTitle>
          <ListGroup>
            <ToggleRow
              symbol="bell"
              title="Notifications"
              description="Friend requests and meetups on this phone"
              value={enabled}
              disabled={busy || !signedIn}
              onChange={(next) => void changeEnabled(next)}
            />
            {PHONE_ROWS.map((row) => (
              <View key={row.key}>
                <Separator className="mx-4" />
                <ToggleRow
                  symbol={row.symbol}
                  title={row.title}
                  description={row.description}
                  value={phone[row.key]}
                  onChange={(next) => setPhonePref(row.key, next)}
                />
              </View>
            ))}
          </ListGroup>
        </View>

        {signedIn ? (
          <View>
            <SectionTitle>Tell me about</SectionTitle>
            <ListGroup>
              {ACCOUNT_ROWS.map((row, index) => (
                <View key={row.key}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <ToggleRow
                    symbol={row.symbol}
                    title={row.title}
                    description={row.description}
                    value={prefs?.[row.key] ?? true}
                    disabled={!prefs}
                    onChange={(next) => void changeKind(row.key, next)}
                  />
                </View>
              ))}
            </ListGroup>
            <Text className="px-1 pt-2 text-xs leading-5 text-muted">
              These follow your account, so they apply on every phone and on the web.
            </Text>
          </View>
        ) : (
          <Text className="px-1 text-sm leading-5 text-muted">Sign in to choose which notifications you get.</Text>
        )}
      </ScrollView>
  );
}
