import { DatePicker, Host } from '@expo/ui/swift-ui';
import { useColorScheme } from 'react-native';

import { fromMinutes, toMinutes, type TimeFieldProps } from '@/components/time-field.shared';

/** The iOS time picker, drawn by SwiftUI. Android has its own in time-field.android.tsx. */
export function TimeField({ minutes, onChange }: TimeFieldProps) {
  const scheme = useColorScheme();
  return (
    <Host matchContents colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
      <DatePicker
        selection={fromMinutes(minutes)}
        displayedComponents={['hourAndMinute']}
        onDateChange={(date) => onChange(toMinutes(date))}
      />
    </Host>
  );
}
