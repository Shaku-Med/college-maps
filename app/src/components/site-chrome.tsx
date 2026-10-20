import Link from "next/link";

import { SiteNav } from "@/components/site-nav";
import { CAMPUS } from "@/data/campus";

const { app, college } = CAMPUS;

export const OPEN_MAP_CLASS =
  "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-medium text-accent-foreground outline-none transition-[opacity,transform] hover:opacity-90 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function Logo() {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a tiny same origin SVG that needs no resizing
    <img src="/icons/icon.svg" alt="" width={28} height={28} className="size-7 rounded-[8px]" />
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-separator bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-4 px-6 lg:px-10">
        <Link
          href="/about"
          className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">{app.name}</span>
        </Link>
        <SiteNav />
        <Link href="/" className={`${OPEN_MAP_CLASS} ml-auto h-9 px-4`}>
          Open the map
        </Link>
      </div>
    </header>
  );
}

const FOOTER_LINKS = [
  {
    title: "Product",
    links: [
      { href: "/", label: "Open the map" },
      { href: "/about", label: "About" },
      { href: "/report-problem", label: "Report a problem" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms of use" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-separator">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 pb-[max(3rem,env(safe-area-inset-bottom))] pt-14 sm:grid-cols-[1fr_auto_auto] sm:gap-20 lg:px-10">
        <div className="flex max-w-xs flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[15px] font-semibold tracking-tight">{app.name}</span>
          </div>
          <p className="text-sm leading-relaxed text-muted">{app.description}</p>
        </div>
        {FOOTER_LINKS.map((group) => (
          <nav key={group.title} aria-label={group.title} className="flex flex-col gap-2.5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{group.title}</h2>
            {group.links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="w-fit rounded text-sm text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent">
                {link.label}
              </Link>
            ))}
          </nav>
        ))}
        <p className="text-xs leading-relaxed text-muted sm:col-span-3">
          {app.disclaimer} Made by a {college.shortName} student, {new Date().getFullYear()}.
        </p>
      </div>
    </footer>
  );
}
