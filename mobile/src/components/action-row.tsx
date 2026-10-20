import type { SFSymbol } from 'expo-symbols';
import { ListGroup, useThemeColor } from 'heroui-native';
import { View } from 'react-native';

import { Icon } from '@/components/icon';

/** The one place an action lives, at the end of the list it adds to, lined up with the avatars above it. */
export function ActionRow({
  symbol,
  title,
  description,
  onPress,
}: {
  symbol: SFSymbol;
  title: string;
  description?: string;
  onPress: () => void;
}) {
  const accent = useThemeColor('accent');
  return (
    <ListGroup.Item onPress={onPress} accessibilityRole="button">
      <ListGroup.ItemPrefix>
        <View className="size-10 items-center justify-center rounded-full bg-accent-soft">
          <Icon name={symbol} size={18} weight="semibold" tintColor={accent} />
        </View>
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle className="text-accent">{title}</ListGroup.ItemTitle>
        {description ? <ListGroup.ItemDescription>{description}</ListGroup.ItemDescription> : null}
      </ListGroup.ItemContent>
    </ListGroup.Item>
  );
}
