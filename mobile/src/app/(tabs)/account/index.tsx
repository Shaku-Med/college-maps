import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Card, ListGroup, Separator, Spinner, Switch, useThemeColor, useToast } from 'heroui-native';
import { useState } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';

import { ProfileForm } from '@/components/profile-form';
import { SectionTitle } from '@/components/section';
import { SignIn } from '@/components/sign-in';
import { UpdatesSection } from '@/components/updates-section';
import { CAMPUS } from '@/data/campus';
import { signOut, useAccount } from '@/lib/account';
import { openWeb } from '@/lib/links';
import { disableNotifications, enableNotifications, useNotificationsEnabled } from '@/lib/notifications';

const VERSION = Constants.expoConfig?.version ?? '1.0.0';

function Row({
  symbol,
  title,
  description,
  onPress,
  danger = false,
}: {
  symbol: SFSymbol;
  title: string;
  description?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  const [muted, dangerColor] = useThemeColor(['muted', 'danger']);
  return (
    <ListGroup.Item onPress={onPress} disabled={!onPress}>
      <ListGroup.ItemPrefix>
        <SymbolView name={symbol} size={20} tintColor={danger ? dangerColor : muted} />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle className={danger ? 'text-danger' : undefined}>{title}</ListGroup.ItemTitle>
        {description ? <ListGroup.ItemDescription>{description}</ListGroup.ItemDescription> : null}
      </ListGroup.ItemContent>
      {onPress && !danger ? <ListGroup.ItemSuffix /> : null}
    </ListGroup.Item>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

function NotificationsRow() {
  const { toast } = useToast();
  const muted = useThemeColor('muted');
  const [enabled, setEnabled] = useNotificationsEnabled();
  const [busy, setBusy] = useState(false);

  async function change(next: boolean) {
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
    } else {
      toast.show({ variant: 'danger', label: "Couldn't turn on notifications", description: 'Try again in a moment.' });
    }
  }

  return (
    <ListGroup.Item disabled>
      <ListGroup.ItemPrefix>
        <SymbolView name="bell" size={20} tintColor={muted} />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle>Notifications</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>Friend requests and meetup invites on this phone</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      <Switch isSelected={enabled} isDisabled={busy} onSelectedChange={(next) => void change(next)} />
    </ListGroup.Item>
  );
}

export default function AccountScreen() {
  const account = useAccount();
  const { toast } = useToast();

  function confirmSignOutEverywhere() {
    Alert.alert('Sign out everywhere?', 'This signs you out on every phone and browser, including this one.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out everywhere',
        style: 'destructive',
        onPress: async () => {
          const res = await signOut({ everywhere: true });
          if (!res.ok && res.status !== 401) toast.show({ variant: 'danger', label: res.message });
        },
      },
    ]);
  }

  // A stray tap on Sign out should not end the session, so it asks first.
  function confirmSignOut() {
    Alert.alert('Sign out?', 'You can sign back in any time with your school email.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  return (
    <>
      <Stack.Title large>Account</Stack.Title>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-6 px-4 pb-16 pt-2">
        {account.status === 'loading' ? (
          <View className="items-center py-16">
            <Spinner />
          </View>
        ) : account.status === 'signed-in' && account.user.needsProfile ? (
          <Card className="gap-5 rounded-3xl p-5">
            <View className="gap-1.5">
              <Text className="text-2xl font-bold text-foreground">Set up your profile</Text>
              <Text className="text-base leading-6 text-muted">Pick the name and username friends will see.</Text>
            </View>
            <ProfileForm user={account.user} submitLabel="Continue" />
          </Card>
        ) : account.status === 'signed-in' ? (
          <>
            <Card className="flex-row items-center gap-4 rounded-3xl p-5">
              <View className="size-16 items-center justify-center rounded-full bg-accent">
                <Text className="text-xl font-bold text-accent-foreground">{initials(account.user.displayName)}</Text>
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xl font-bold text-foreground" numberOfLines={1}>
                  {account.user.displayName}
                </Text>
                <Text className="text-base text-muted" numberOfLines={1}>
                  @{account.user.username}
                </Text>
              </View>
            </Card>
            <View>
              <SectionTitle>Profile</SectionTitle>
              <ListGroup>
                <Row symbol="pencil" title="Edit profile" onPress={() => router.push('/profile')} />
                <Separator className="mx-4" />
                <Row symbol="lock" title="Email, only visible to you" description={account.user.email} />
                <Separator className="mx-4" />
                <NotificationsRow />
              </ListGroup>
            </View>
            <View>
              <SectionTitle>Sign in</SectionTitle>
              <ListGroup>
                <Row symbol="rectangle.portrait.and.arrow.right" title="Sign out" onPress={confirmSignOut} />
                <Separator className="mx-4" />
                <Row symbol="iphone.slash" title="Sign out everywhere" onPress={confirmSignOutEverywhere} />
                <Separator className="mx-4" />
                <Row symbol="trash" title="Delete account" onPress={() => router.push('/delete-account')} danger />
              </ListGroup>
            </View>
          </>
        ) : (
          <Card className="rounded-3xl p-5">
            {account.status === 'unreachable' ? (
              <Text className="pb-4 text-sm leading-5 text-muted">
                Can’t reach the server right now. You can still use the map and your classes.
              </Text>
            ) : null}
            <SignIn />
          </Card>
        )}

        <View>
          <SectionTitle>On the web</SectionTitle>
          <ListGroup>
            <Row symbol="safari" title="Open CSI Map on the web" onPress={() => void openWeb('/')} />
            <Separator className="mx-4" />
            <Row symbol="hand.raised" title="Privacy" onPress={() => void openWeb('/privacy')} />
          </ListGroup>
        </View>

        <View>
          <SectionTitle>App updates</SectionTitle>
          <UpdatesSection />
        </View>

        <View className="items-center gap-1 px-6 pt-2">
          <Text className="text-sm font-medium text-foreground">
            {CAMPUS.app.name} {VERSION}
          </Text>
          {CAMPUS.app.disclaimer ? (
            <Text className="text-center text-xs leading-5 text-muted">{CAMPUS.app.disclaimer}</Text>
          ) : null}
        </View>
      </ScrollView>
    </>
  );
}
