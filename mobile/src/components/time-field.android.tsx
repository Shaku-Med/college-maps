import { DateTimePicker, Host } from '@expo/ui/jetpack-compose';
import { Button, useThemeColor } from 'heroui-native';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fromMinutes, toMinutes, type TimeFieldProps } from '@/components/time-field.shared';
import { formatClock } from '@/lib/schedule';

/**
 * The Android time field. Material's clock dial is meant for a dialog, not a form, so the form shows a compact
 * time, and tapping it opens the dial in a sheet at its full size.
 */
export function TimeField({ minutes, onChange, label }: TimeFieldProps) {
  const insets = useSafeAreaInsets();
  const accent = useThemeColor('accent');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(minutes);

  const show = () => {
    setDraft(minutes);
    setOpen(true);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Time'}, ${formatClock(minutes)}. Change`}
        onPress={show}
        className="self-start rounded-xl bg-background px-3 py-2 active:opacity-70">
        <Text className="text-xl font-semibold text-foreground">{formatClock(minutes)}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setOpen(false)}>
        <Pressable accessibilityLabel="Close" onPress={() => setOpen(false)} className="flex-1 bg-black/50" />
        <View className="rounded-t-3xl bg-overlay px-5 pt-5" style={{ paddingBottom: insets.bottom + 16 }}>
          {label ? <Text className="pb-3 text-lg font-semibold text-foreground">{label}</Text> : null}
          <View className="items-center">
            <Host matchContents>
              <DateTimePicker
                initialDate={fromMinutes(draft).toISOString()}
                displayedComponents="hourAndMinute"
                variant="picker"
                color={accent}
                onDateSelected={(date) => setDraft(toMinutes(date))}
              />
            </Host>
          </View>
          <View className="flex-row gap-3 pt-4">
            <Button className="flex-1" variant="secondary" onPress={() => setOpen(false)}>
              <Button.Label>Cancel</Button.Label>
            </Button>
            <Button
              className="flex-1"
              onPress={() => {
                onChange(draft);
                setOpen(false);
              }}>
              <Button.Label>Done</Button.Label>
            </Button>
          </View>
        </View>
      </Modal>
    </>
  );
}
