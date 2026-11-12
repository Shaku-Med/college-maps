import type { Metadata } from "next";
import Link from "next/link";

import { CAMPUS, CATEGORY_LABELS, type PlaceCategory } from "@/data/campus";
import { placePath } from "@/lib/place-pages";

const { app, college } = CAMPUS;

export const metadata: Metadata = {
  title: `${college.shortName} buildings and places`,
  description: `Every building, parking lot, and stop at ${college.name}, with what is inside and walking directions on the campus map.`,
  alternates: { canonical: "/places" },
  robots: { index: true, follow: true },
};

const ORDER = Object.keys(CATEGORY_LABELS) as PlaceCategory[];

export default function PlacesPage() {
  const groups = ORDER.map((category) => ({
    category,
    places: CAMPUS.places.filter((place) => place.category === category),
  })).filter((group) => group.places.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-6 pb-24 pt-14 lg:px-10 lg:pt-20">
      <header className="flex flex-col gap-4 border-b border-separator pb-10">
        <h1 className="text-4xl font-semibold tracking-tight lg:text-5xl">
          {college.shortName} buildings and places
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted lg:text-lg">
          All {CAMPUS.places.length} places on the {college.name} campus. Pick one to see what is inside and get
          walking directions in {app.name}.
        </p>
      </header>

      {groups.map((group) => (
        <section key={group.category} className="flex flex-col gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            {CATEGORY_LABELS[group.category]}
          </h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.places.map((place) => (
              <li key={place.id}>
                <Link
                  href={placePath(place)}
                  className="flex h-full items-center gap-3 rounded-xl border border-separator px-4 py-3 outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent">
                  <span className="min-w-10 rounded-lg bg-surface-secondary px-2 py-1 text-center text-xs font-semibold tabular-nums">
                    {place.label ?? place.id}
                  </span>
                  <span className="text-sm font-medium">{place.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
