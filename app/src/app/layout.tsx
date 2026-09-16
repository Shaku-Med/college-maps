import { Toast } from "@heroui/react";
import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";

import { CoverViewport } from "@/components/cover-viewport";
import { OfflineSupport } from "@/components/offline-support";
import { CAMPUS } from "@/data/campus";
import iconBuild from "@/data/icon-version.json";
import { COVER_SCRIPT } from "@/lib/cover-viewport";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Runs before paint so HeroUI's .dark class matches the system theme without a flash.
// Colors are validated as hex in campus.json, so this cannot inject arbitrary CSS.
function themeVariables(colors: { accent?: string; accentForeground?: string } | undefined) {
  if (!colors?.accent || !colors.accentForeground) return "";
  return `--accent:${colors.accent};--accent-foreground:${colors.accentForeground};`;
}

const LIGHT_THEME = themeVariables(CAMPUS.theme);
const DARK_THEME = themeVariables(CAMPUS.theme.dark);
const THEME_OVERRIDES = [
  LIGHT_THEME && `:root{${LIGHT_THEME}}`,
  DARK_THEME && `:root.dark{${DARK_THEME}}`,
  DARK_THEME && `@media (prefers-color-scheme: dark){:root{${DARK_THEME}}}`,
]
  .filter(Boolean)
  .join("");

const THEME_SCRIPT = `(()=>{const m=matchMedia("(prefers-color-scheme: dark)");const a=()=>{const r=document.documentElement;r.classList.toggle("dark",m.matches);r.style.colorScheme=m.matches?"dark":"light"};a();m.addEventListener("change",a)})()`;

// Written by `npm run campus:icons`. New icons get a new version, so browsers drop their cached favicon.
const icon = (path: string) => `${path}?v=${iconBuild.version}`;

const { app, college } = CAMPUS;

export const metadata: Metadata = {
  metadataBase: app.url ? new URL(app.url) : undefined,
  title: { default: app.name, template: `%s · ${app.name}` },
  description: app.description,
  applicationName: app.name,
  keywords: [
    college.name,
    college.shortName,
    `${college.shortName} campus map`,
    `${college.name} map`,
    "campus map",
    "room finder",
    "building directions",
    "walking directions",
    "class schedule",
  ],
  category: "navigation",
  creator: app.name,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large" } },
  openGraph: {
    type: "website",
    siteName: app.name,
    title: app.name,
    description: app.description,
    url: "/",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: app.name, description: app.description },
  icons: {
    icon: [
      { url: icon("/icons/icon.svg"), type: "image/svg+xml" },
      { url: icon("/icons/favicon-48.png"), sizes: "48x48", type: "image/png" },
      { url: icon("/icons/favicon-32.png"), sizes: "32x32", type: "image/png" },
      { url: icon("/icons/favicon-16.png"), sizes: "16x16", type: "image/png" },
      { url: icon("/icons/icon-192.png"), sizes: "192x192", type: "image/png" },
    ],
    shortcut: icon("/favicon.ico"),
    apple: [{ url: icon("/icons/apple-touch-icon.png"), sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: app.shortName, statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  other: { "mobile-web-app-capable": "yes" },
};

// Structured data helps search engines show the app as a free web app for this college.
const STRUCTURED_DATA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: app.name,
  description: app.description,
  applicationCategory: "TravelApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires JavaScript",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  about: { "@type": "CollegeOrUniversity", name: college.name, alternateName: college.shortName },
  ...(app.url ? { url: app.url } : {}),
}).replace(/</g, "\\u003c");

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "overlays-content",
  themeColor: [
    { media: "(display-mode: standalone)", color: "transparent" },
    { media: "(prefers-color-scheme: light)", color: CAMPUS.theme.accent ?? "#f5f5f5" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" className={`${geistSans.variable} antialiased`} suppressHydrationWarning>
      <head>
        {nonce ? <meta name="csp-nonce" content={nonce} /> : null}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: COVER_SCRIPT }} />
        {THEME_OVERRIDES ? <style nonce={nonce}>{THEME_OVERRIDES}</style> : null}
        <script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{ __html: STRUCTURED_DATA }} />
      </head>
      <body className="bg-background font-sans text-foreground" suppressHydrationWarning>
        <Toast.Provider placement="top" />
        <CoverViewport />
        <OfflineSupport />
        {children}
      </body>
    </html>
  );
}
