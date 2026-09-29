import type { SFSymbol } from 'expo-symbols';

import { CATEGORY_LABELS, PLACES, PLACE_CATEGORIES, type PlaceCategory } from '@/data/campus';

export const CATEGORY_SYMBOLS: Record<PlaceCategory, SFSymbol> = {
  academic: 'graduationcap',
  student: 'person.2',
  admin: 'building.columns',
  housing: 'bed.double',
  dining: 'fork.knife',
  athletics: 'figure.run',
  health: 'cross.case',
  services: 'wrench.and.screwdriver',
  parking: 'parkingsign',
  transit: 'bus',
};

// The order people browse in, most asked for first, limited to categories the campus actually has.
const BROWSE_ORDER: PlaceCategory[] = [
  'student',
  'academic',
  'dining',
  'admin',
  'health',
  'athletics',
  'housing',
  'services',
  'parking',
  'transit',
];

export const USED_CATEGORIES = BROWSE_ORDER.filter(
  (category) => PLACE_CATEGORIES.includes(category) && PLACES.some((place) => place.category === category),
);

export const categoryLabel = (category: PlaceCategory) => CATEGORY_LABELS[category];
