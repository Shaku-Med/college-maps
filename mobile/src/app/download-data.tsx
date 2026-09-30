import { router } from 'expo-router';
import type { SFSymbol } from 'expo-symbols';
import { Button, CloseButton, ListGroup, Separator, Spinner, useThemeColor, useToast } from 'heroui-native';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { useSheetInsets } from '@/hooks/use-sheet-insets';
import { useAccount } from '@/lib/account';
import { EXPORT_OPTIONS, shareAccountExport, type ExportFormat } from '@/lib/account-export';

export default function DownloadDataScreen() {
  const sheet = useSheetInsets();
  const account = useAccount();
  const { toast } = useToast();
  const muted = useThemeColor('muted');
  const [pending, setPending] = useState<ExportFormat | null>(null);
  const [step, setStep] = useState<string | null>(null);

  if (account.status !== 'signed-in') return null;

  async function download(format: ExportFormat) {
    if (pending) return;
    setPending(format);
    setStep('Starting…');
    try {
      await shareAccountExport(format, setStep);
      toast.show({
        variant: 'success',
        label: format === 'pdf' ? 'Choose Print, then Save as PDF' : 'Ready to share',
        description: format === 'pdf' ? 'In the share sheet, open Print and save a PDF.' : undefined,
      });
    } catch (error) {
      toast.show({
        variant: 'danger',
        label: error instanceof Error ? error.message : 'Could not export your information',
      });
    } finally {
      setPending(null);
      setStep(null);
    }
  }

  const busy = pending !== null;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5" contentContainerStyle={sheet}>
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-foreground">Download my information</Text>
        <CloseButton onPress={() => router.back()} isDisabled={busy} />
      </View>
      <Text className="text-base leading-6 text-muted">
        Everything we store about your account, plus the class list saved on this phone. Pick a format, then save or
        share the file.
      </Text>

      {busy ? (
        <View className="flex-row items-center gap-3 rounded-2xl bg-default px-4 py-4">
          <Spinner />
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-sm font-medium text-foreground">
              Preparing {EXPORT_OPTIONS.find((o) => o.id === pending)?.title ?? 'file'}
            </Text>
            <Text className="text-sm text-muted">{step ?? 'Working…'}</Text>
          </View>
        </View>
      ) : null}

      <ListGroup>
        {EXPORT_OPTIONS.map((option, index) => (
          <View key={option.id}>
            {index > 0 ? <Separator className="mx-4" /> : null}
            <ListGroup.Item onPress={() => void download(option.id)} disabled={busy}>
              <ListGroup.ItemPrefix>
                {pending === option.id ? (
                  <Spinner size="sm" />
                ) : (
                  <Icon name={option.symbol as SFSymbol} size={20} tintColor={muted} />
                )}
              </ListGroup.ItemPrefix>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{option.title}</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>{option.description}</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix />
            </ListGroup.Item>
          </View>
        ))}
      </ListGroup>
      <Button variant="secondary" onPress={() => router.back()} isDisabled={busy}>
        <Button.Label>Done</Button.Label>
      </Button>
    </ScrollView>
  );
}
