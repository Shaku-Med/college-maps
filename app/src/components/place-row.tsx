import { ListBox } from "@heroui/react";

import type { Place } from "@/data/campus";
import { PlaceIcon } from "@/components/place-icon";

export function PlaceItem({ place, note }: { place: Place; note?: string }) {
  const subtitle = note ?? (place.isBuilding ? `Building ${place.id}` : place.details);

  return (
    <ListBox.Item id={place.id} textValue={place.name} className="gap-3 py-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-default text-default-foreground">
        <PlaceIcon place={place} className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{place.name}</span>
        {subtitle ? <span className="truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
    </ListBox.Item>
  );
}
