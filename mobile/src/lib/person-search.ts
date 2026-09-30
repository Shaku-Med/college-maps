import type { Person } from '@/lib/social-api';

/** Match a person by username or display name (optional leading @). */
export function matchesPerson(person: Person, query: string) {
  const q = query.trim().toLowerCase().replace(/^@/, '');
  if (!q) return true;
  return person.username.toLowerCase().includes(q) || person.displayName.toLowerCase().includes(q);
}
