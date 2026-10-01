import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { Card, ListGroup, Separator, Spinner, Switch, useThemeColor, useToast } from 'heroui-native';
import { Alert, ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ProfileForm } from '@/components/profile-form';
import { SectionTitle } from '@/components/section';
import { SignIn } from '@/components/sign-in';
import { StackLinkedItem } from '@/components/stack-linked-item';
import { UpdatesSection } from '@/components/updates-section';
import { CAMPUS } from '@/data/campus';
import { useLinkedSuffix } from '@/hooks/use-linked-row-opacity';
import { useReadableStyle } from '@/hooks/use-layout';
import { signOut, useAccount } from '@/lib/account';
import { setDevicePref, useDevicePrefs } from '@/lib/device-prefs';
import { openWeb } from '@/lib/links';
import { HEADER_ICONS } from '@/lib/header-icons';

const VERSION = Constants.expoConfig?.version ?? '1.0.0';

function Row({
  symbol,
  title,
  description,
  onPress,
  linked = false,
  gestureSync = true,
  danger = false,
}: {
  symbol: SFSymbol;
  title: string;
  description?: string;
  onPress?: () => void;
  linked?: boolean;
  gestureSync?: boolean;
  danger?: boolean;
}) {
  const [muted, dangerColor] = useThemeColor(['muted', 'danger']);
  return (
    <StackLinkedItem linked={linked} gestureSync={gestureSync} onPress={onPress} disabled={!onPress}>
      <ListGroup.ItemPrefix>
        <Icon name={symbol} size={20} tintColor={danger ? dangerColor : muted} />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle className={danger ? 'text-danger' : undefined}>{title}</ListGroup.ItemTitle>
        {description ? <ListGroup.ItemDescription>{description}</ListGroup.ItemDescription> : null}
      </ListGroup.ItemContent>
      {onPress && !danger ? <ListGroup.ItemSuffix /> : null}
    </StackLinkedItem>
  );
}

function ToggleRow({
  symbol,
  title,
  description,
  value,
  onChange,
}: {
  symbol: SFSymbol;
  title: string;
  description?: string;
  value: boolean;
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
      <Switch isSelected={value} onSelectedChange={onChange} />
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

export default function AccountScreen() {
  const readable = useReadableStyle();
  const account = useAccount();
  const { toast } = useToast();
  const device = useDevicePrefs();
  const linked = useLinkedSuffix(
    '/notifications',
    '/profile',
    '/voice',
    '/download-data',
    '/delete-account',
  );

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

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You can sign back in any time with your school email.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  return (
    <>
      <Stack.Title large>Account</Stack.Title>
      {account.status === 'signed-in' && !account.user.needsProfile ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={HEADER_ICONS.notifications}
            accessibilityLabel="Notifications"
            onPress={() => router.push('/account/notifications')}
          />
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-6 px-4 pb-16 pt-2"
        contentContainerStyle={readable}>
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
                <Row
                  symbol="pencil"
                  title="Edit profile"
                  linked={linked === '/profile'}
                  gestureSync={false}
                  onPress={() => router.push('/profile')}
                />
                <Separator className="mx-4" />
                <Row symbol="lock" title="Email, only visible to you" description={account.user.email} />
                <Separator className="mx-4" />
                <Row
                  symbol="bell"
                  title="Notifications"
                  description="Alerts, badge, and what you hear about"
                  linked={linked === '/notifications'}
                  onPress={() => router.push('/account/notifications')}
                />
              </ListGroup>
            </View>
            <View>
              <SectionTitle>Your data</SectionTitle>
              <ListGroup>
                <Row
                  symbol="square.and.arrow.down"
                  title="Download my information"
                  description="JSON, HTML, text, or PDF"
                  linked={linked === '/download-data'}
                  gestureSync={false}
                  onPress={() => router.push('/download-data')}
                />
              </ListGroup>
            </View>
            <View>
              <SectionTitle>Sign in</SectionTitle>
              <ListGroup>
                <Row symbol="rectangle.portrait.and.arrow.right" title="Sign out" onPress={confirmSignOut} />
                <Separator className="mx-4" />
                <Row symbol="iphone.slash" title="Sign out everywhere" onPress={confirmSignOutEverywhere} />
                <Separator className="mx-4" />
                <Row
                  symbol="trash"
                  title="Delete account"
                  linked={linked === '/delete-account'}
                  gestureSync={false}
                  onPress={() => router.push('/delete-account')}
                  danger
                />
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
          <SectionTitle>Directions</SectionTitle>
          <ListGroup>
            <ToggleRow
              symbol="sun.max"
              title="Keep screen on"
              description="While turn-by-turn is running, like other navigation apps"
              value={device.keepAwake}
              onChange={(next) => setDevicePref('keepAwake', next)}
            />
            <Separator className="mx-4" />
            <Row
              symbol="speaker.wave.2"
              title="Directions voice"
              description="Which voice speaks each turn"
              linked={linked === '/voice'}
              gestureSync={false}
              onPress={() => router.push('/voice')}
            />
          </ListGroup>
        </View>

        <View>
          <SectionTitle>Legal</SectionTitle>
          <ListGroup>
            <Row
              symbol="hand.raised"
              title="Privacy policy"
              description="What we store and how location is used"
              onPress={() => void openWeb('/privacy')}
            />
            <Separator className="mx-4" />
            <Row
              symbol="doc.text"
              title="Terms of use"
              description="Rules for the map, friends, and meetups"
              onPress={() => void openWeb('/terms')}
            />
            <Separator className="mx-4" />
            <Row symbol="safari" title="Open CSI Map on the web" onPress={() => void openWeb('/')} />
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
