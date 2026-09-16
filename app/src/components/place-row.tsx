import { ListBox } from "@heroui/react";

import type { Place } from "@/data/campus";
import { CATEGORY_ICONS } from "@/lib/categories";

export function PlaceItem({ place }: { place: Place }) {
  const Icon = CATEGORY_ICONS[place.category];
  const subtitle = place.isBuilding ? `Building ${place.id}` : place.details;

  return (
    <ListBox.Item id={place.id} textValue={place.name} className="gap-3 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-default text-default-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{place.name}</span>
        {subtitle ? <span className="truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
    </ListBox.Item>
  );
}
