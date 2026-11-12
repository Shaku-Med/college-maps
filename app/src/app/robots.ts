import type { MetadataRoute } from "next";

import { CAMPUS } from "@/data/campus";

export default function robots(): MetadataRoute.Robots {
  const site = CAMPUS.app.url;
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/v1/", "/verify", "/voice-bank/", "/voice-engine"] },
    ...(site ? { sitemap: `${site}/sitemap.xml`, host: site } : {}),
  };
}
