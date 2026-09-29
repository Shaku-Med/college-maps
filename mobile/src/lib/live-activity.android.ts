// Live Activities are an iOS feature. Android shows the ongoing "Directions are on" notification from the
// background location task instead, so these do nothing and the iOS-only widget modules never load here.
import type { TripSnapshot } from './live-activity';

export type { TripSnapshot };

export function showTrip(_trip: TripSnapshot) {}

export function endTrip() {}
