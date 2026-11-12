import type { Metadata } from "next";

import { MapHome } from "@/app/map-home";
import { CAMPUS } from "@/data/campus";

export const metadata: Metadata = {
  title: { absolute: `${CAMPUS.app.name}: ${CAMPUS.college.name} campus map and directions` },
};

export default function Home({ searchParams }: PageProps<"/">) {
  return <MapHome searchParams={searchParams} />;
}
