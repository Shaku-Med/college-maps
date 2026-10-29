import type { LucideProps } from "lucide-react";

import { isAmenity } from "@/data/amenities";
import type { Place } from "@/data/campus";
import { AMENITY_ICONS, CATEGORY_ICONS } from "@/lib/categories";

/** The place's kind as an icon: a phone for an SOS phone, a cap for a classroom building. */
export function PlaceIcon({ place, ...props }: LucideProps & { place: Place }) {
  const Icon = isAmenity(place) ? AMENITY_ICONS[place.amenity] : CATEGORY_ICONS[place.category];
  return <Icon aria-hidden {...props} />;
}
