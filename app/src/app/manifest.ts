import type { MetadataRoute } from "next";

import { CAMPUS } from "@/data/campus";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: CAMPUS.app.name,
    short_name: CAMPUS.app.shortName,
    description: CAMPUS.app.description,
    start_url: "/",
    display: "standalone",
    display_override: ["standalone"],
    orientation: "portrait",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.webp", sizes: "512x512", type: "image/webp", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
