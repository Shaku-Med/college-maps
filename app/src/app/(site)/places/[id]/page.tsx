import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OPEN_MAP_CLASS } from "@/components/site-chrome";
import { CAMPUS, CATEGORY_LABELS, type Place } from "@/data/campus";
import { findPlace, jsonLd, mapLink, nearbyPlaces, placePath, walkMinutes } from "@/lib/place-pages";

const { app, college, rooms } = CAMPUS;

export function generateStaticParams() {
  return CAMPUS.places.map((place) => ({ id: place.id.toLowerCase() }));
}

function summary(place: Place) {
  const where = place.isBuilding ? `Building ${place.id} at ${college.name}` : `${place.name} at ${college.name}`;
  return place.details ? `${where}. ${place.details}` : `${where}. See it on the campus map and get walking directions.`;
}

function exampleRoom(place: Place) {
  const room = rooms.pattern.exec(rooms.example)?.groups?.room;
  return room ? `${place.id}-${room}` : undefined;
}

export async function generateMetadata({ params }: PageProps<"/places/[id]">): Promise<Metadata> {
  const place = findPlace((await params).id);
  if (!place) return {};
  const title = `${college.shortName} ${place.id}: ${place.name}`;
  return {
    title,
    description: summary(place),
    keywords: [place.name, `${college.shortName} ${place.id}`, `${place.id} ${college.shortName}`, ...(place.keywords ?? [])],
    alternates: { canonical: placePath(place) },
    robots: { index: true, follow: true },
    openGraph: { title, description: summary(place), url: placePath(place) },
  };
}

export default async function PlacePage({ params }: PageProps<"/places/[id]">) {
  const place = findPlace((await params).id);
  if (!place) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const nearby = nearbyPlaces(place, 4);
  const room = place.isBuilding ? exampleRoom(place) : undefined;
  const structured = jsonLd({
    "@context": "https://schema.org",
    "@type": place.category === "parking" ? "ParkingFacility" : "Place",
    name: place.name,
    alternateName: `${college.shortName} ${place.id}`,
    description: summary(place),
    geo: { "@type": "GeoCoordinates", latitude: place.coordinate.latitude, longitude: place.coordinate.longitude },
    containedInPlace: { "@type": "CollegeOrUniversity", name: college.name, alternateName: college.shortName },
    ...(app.url ? { url: `${app.url}${placePath(place)}`, hasMap: `${app.url}${mapLink(place)}` } : {}),
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 pb-24 pt-14 lg:px-10 lg:pt-20">
      <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: structured }} />

      <header className="flex flex-col gap-4 border-b border-separator pb-10">
        <nav aria-label="Breadcrumb" className="text-sm text-muted">
          <Link href="/places" className="rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
            Places
          </Link>
          <span aria-hidden> / </span>
          <span>{CATEGORY_LABELS[place.category]}</span>
        </nav>
        <h1 className="text-4xl font-semibold tracking-tight lg:text-5xl">{place.name}</h1>
        <p className="text-base leading-relaxed text-muted lg:text-lg">{summary(place)}</p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href={mapLink(place)} className={OPEN_MAP_CLASS}>
            Walking directions
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </header>

      {room ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Finding a room</h2>
          <p className="text-sm leading-relaxed text-muted lg:text-base">
            Rooms here start with {place.id}. Search a full room code like{" "}
            <span className="font-medium text-foreground">{room}</span> and {app.name} walks you to the building and tells
            you the floor. {rooms.help}
          </p>
        </section>
      ) : null}

      {place.staffOnly ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Who can park here</h2>
          <p className="text-sm leading-relaxed text-muted lg:text-base">
            This lot is for staff only, so driving directions for students and visitors end at another lot.
          </p>
        </section>
      ) : null}

      {place.keywords?.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Also known for</h2>
          <ul className="flex flex-wrap gap-2">
            {place.keywords.map((keyword) => (
              <li key={keyword} className="rounded-full bg-surface-secondary px-3 py-1 text-sm">
                {keyword}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {nearby.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Nearby</h2>
          <ul className="flex flex-col divide-y divide-separator overflow-hidden rounded-xl border border-separator">
            {nearby.map(({ place: other, meters }) => (
              <li key={other.id}>
                <Link
                  href={placePath(other)}
                  className="flex items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
                  <span className="min-w-10 rounded-lg bg-surface-secondary px-2 py-1 text-center text-xs font-semibold tabular-nums">
                    {other.label ?? other.id}
                  </span>
                  <span className="flex-1 text-sm font-medium">{other.name}</span>
                  <span className="text-sm text-muted tabular-nums">About {walkMinutes(meters)} min walk</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
