import type { MetadataRoute } from "next";

import { CAMPUS } from "@/data/campus";
import { placePath } from "@/lib/place-pages";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = CAMPUS.app.url;
  if (!site) return [];
  const page = (path: string, priority: number): MetadataRoute.Sitemap[number] => ({
    url: `${site}${path}`,
    changeFrequency: "monthly",
    priority,
  });
  return [
    page("/", 1),
    page("/places", 0.9),
    ...CAMPUS.places.map((place) => page(placePath(place), 0.8)),
    page("/about", 0.7),
    page("/privacy", 0.3),
    page("/terms", 0.3),
  ];
}
