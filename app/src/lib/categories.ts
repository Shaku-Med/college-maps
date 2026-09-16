import {
  BedDouble,
  Bus,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Landmark,
  SquareParking,
  Users,
  Utensils,
  Wrench,
  type LucideIcon,
} from "lucide-react";

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

const USED_CATEGORIES = PLACE_CATEGORIES.filter((category) => PLACES.some((place) => place.category === category));

export type MapFilter = "all" | PlaceCategory;

export const MAP_FILTERS: MapFilter[] = ["all", ...USED_CATEGORIES];

export const BROWSE_ORDER: PlaceCategory[] = [
  "student",
  "academic",
  "dining",
  "admin",
  "health",
  "athletics",
  "housing",
  "services",
  "parking",
  "transit",
].filter((category): category is PlaceCategory => USED_CATEGORIES.includes(category as PlaceCategory));
