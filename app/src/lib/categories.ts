import {
  BedDouble,
  Bike,
  Bus,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Landmark,
  Phone,
  SquareParking,
  Trash,
  Users,
  Utensils,
  Wrench,
  createLucideIcon,
  type LucideIcon,
} from "lucide-react";

import type { AmenityKind } from "@/data/amenities";
import { PLACES, PLACE_CATEGORIES, type PlaceCategory } from "@/data/campus";

export const CATEGORY_ICONS: Record<PlaceCategory, LucideIcon> = {
  academic: GraduationCap,
  student: Users,
  admin: Landmark,
  housing: BedDouble,
  dining: Utensils,
  athletics: Dumbbell,
  health: HeartPulse,
  services: Wrench,
  parking: SquareParking,
  transit: Bus,
};

// Lucide has no bench or picnic table, so these are the same shapes the map's icons are drawn from.
const Bench = createLucideIcon("bench", [["path", { d: "M3 14h13l3-9M5 14v5M14 14v5", key: "bench" }]]);
const Picnic = createLucideIcon("picnic", [["path", { d: "M4 8h16M2 13h20M8 8 5 19M16 8l3 11", key: "picnic" }]]);

export const AMENITY_ICONS: Record<AmenityKind, LucideIcon> = { sos: Phone, bench: Bench, trash: Trash, picnic: Picnic, bikes: Bike };

const USED_CATEGORIES = PLACE_CATEGORIES.filter((category) => PLACES.some((place) => place.category === category));

export type MapFilter = "all" | PlaceCategory;

export const MAP_FILTERS: MapFilter[] = ["all", ...USED_CATEGORIES];

