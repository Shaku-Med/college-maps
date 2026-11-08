import type { SFSymbol } from 'expo-symbols';
import { ListGroup, Switch, useThemeColor } from 'heroui-native';

import { Icon } from '@/components/icon';

export function ToggleRow({
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
