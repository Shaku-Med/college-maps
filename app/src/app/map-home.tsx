import { connection } from "next/server";

import { MapApp } from "@/components/map-app";
import { getPlace } from "@/data/campus";
import { isValidRoom } from "@/lib/search";

type Search = { place?: string | string[]; room?: string | string[] };

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function MapHome({ searchParams }: { searchParams: Promise<Search> }) {
  await connection();
  const params = await searchParams;

  const place = getPlace(firstParam(params.place));
  const room = firstParam(params.room)?.toUpperCase();

  return <MapApp initialPlaceId={place?.id} initialRoom={place?.isBuilding && isValidRoom(room) ? room : undefined} />;
}
