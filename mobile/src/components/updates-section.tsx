import * as Updates from 'expo-updates';
import { Button, ListGroup, Separator, Spinner, useThemeColor, useToast } from 'heroui-native';
import { View } from 'react-native';

import { Icon } from '@/components/icon';

function formatUpdateDate(date: Date) {
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Live updates: a new JavaScript bundle published with `eas update` reaches installed builds without a new
// TestFlight build. The app checks on every launch; this checks and applies one right away.
export function UpdatesSection() {
  const { toast } = useToast();
  const muted = useThemeColor('muted');
  const { currentlyRunning, isUpdateAvailable, isUpdatePending, isChecking, isDownloading } = Updates.useUpdates();

  if (!Updates.isEnabled) {
    return (
      <ListGroup>
        <ListGroup.Item disabled>
          <ListGroup.ItemPrefix>
            <Icon name="hammer" size={20} tintColor={muted} />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>Development build</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>Changes appear as you save, no updates needed</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
        </ListGroup.Item>
      </ListGroup>
    );
  }

  const busy = isChecking || isDownloading;
  const running = currentlyRunning.isEmbeddedLaunch
    ? 'The version this build shipped with'
    : currentlyRunning.createdAt
      ? `Update from ${formatUpdateDate(currentlyRunning.createdAt)}`
      : 'A live update';

  async function check() {
    try {
      if (isUpdatePending) {
        await Updates.reloadAsync();
        return;
      }
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        toast.show({ label: "You're up to date" });
        return;
      }
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch {
      toast.show({ variant: 'danger', label: "Couldn't check for updates", description: 'Check your connection.' });
    }
  }

  return (
    <View className="gap-3">
      <ListGroup>
        <ListGroup.Item disabled>
          <ListGroup.ItemPrefix>
            <Icon name="arrow.triangle.2.circlepath" size={20} tintColor={muted} />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>Running</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>{running}</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
        </ListGroup.Item>
        <Separator className="mx-4" />
        <ListGroup.Item disabled>
          <ListGroup.ItemPrefix>
            <Icon name="point.3.connected.trianglepath.dotted" size={20} tintColor={muted} />
          </ListGroup.ItemPrefix>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>Channel</ListGroup.ItemTitle>
            <ListGroup.ItemDescription>{Updates.channel ?? 'None'}</ListGroup.ItemDescription>
          </ListGroup.ItemContent>
        </ListGroup.Item>
      </ListGroup>
      <Button
        variant={isUpdateAvailable || isUpdatePending ? 'primary' : 'secondary'}
        isDisabled={busy}
        onPress={() => void check()}>
        {busy ? <Spinner size="sm" /> : null}
        <Button.Label>{isUpdatePending ? 'Restart to update' : busy ? 'Checking' : 'Check for updates'}</Button.Label>
      </Button>
    </View>
  );
}
