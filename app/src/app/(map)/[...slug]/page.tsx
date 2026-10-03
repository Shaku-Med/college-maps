import type { Metadata } from "next";

import { MapHome } from "@/app/map-home";

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function UnknownRoute({
  searchParams,
}: {
  searchParams: Promise<{ place?: string | string[]; room?: string | string[] }>;
}) {
  return <MapHome searchParams={searchParams} />;
}
