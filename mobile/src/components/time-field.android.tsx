import { DateTimePicker, Host } from '@expo/ui/jetpack-compose';

import { fromMinutes, toMinutes, type TimeFieldProps } from '@/components/time-field.shared';

/** The Android time picker, Material's time input drawn by Jetpack Compose. */
export function TimeField({ minutes, onChange }: TimeFieldProps) {
  return (
    <Host matchContents>
      <DateTimePicker
        initialDate={fromMinutes(minutes).toISOString()}
        displayedComponents="hourAndMinute"
        variant="input"
        onDateSelected={(date) => onChange(toMinutes(date))}
      />
    </Host>
  );
}
