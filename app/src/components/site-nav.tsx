"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

/** The page you are on gets a filled background, like the rest of the app. */
export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Site" className="hidden items-center gap-1 sm:flex">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
              active ? "bg-surface-secondary font-medium text-foreground" : "text-muted hover:text-foreground"
            }`}>
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
