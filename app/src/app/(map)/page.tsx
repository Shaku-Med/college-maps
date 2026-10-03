import { MapHome } from "@/app/map-home";

export default function Home({ searchParams }: PageProps<"/">) {
  return <MapHome searchParams={searchParams} />;
}
