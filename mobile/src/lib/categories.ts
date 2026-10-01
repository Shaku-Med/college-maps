import type { SFSymbol } from 'expo-symbols';

import { CATEGORY_LABELS, type PlaceCategory } from '@/data/campus';
import { BROWSE_ORDER } from '@/lib/search';

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

// The shared browse order, so the map's filter chips and every place list read the same as the web.
export const USED_CATEGORIES = BROWSE_ORDER;

export const categoryLabel = (category: PlaceCategory) => CATEGORY_LABELS[category];
