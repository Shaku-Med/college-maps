import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

export function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <View className="flex-row items-end justify-between px-1 pb-2">
      <Text className="text-sm font-semibold text-muted">{children}</Text>
      {action}
    </View>
  );
}

export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <View className="items-center gap-2 px-6 py-10">
      <Text className="text-center text-base font-semibold text-foreground">{title}</Text>
      {description ? <Text className="text-center text-sm leading-5 text-muted">{description}</Text> : null}
      {children}
    </View>
  );
}
