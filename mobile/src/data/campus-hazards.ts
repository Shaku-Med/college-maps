import { knownHazardCache } from '@/lib/hazards';

/** The campus crosswalks and crossings the web app ships with, from app/scripts/build-hazards.mjs. */
export function campusHazardCache() {
  return knownHazardCache(require('../../../app/src/data/campus-hazards.json'));
}
