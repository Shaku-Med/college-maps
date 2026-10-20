"use client";

import { useEffect, useState } from "react";

type Heading = { id: string; text: string };

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);

/** Lists the page's sections, and fills in the one being read. */
export function DocToc({ articleId }: { articleId: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>();

  useEffect(() => {
    const article = document.getElementById(articleId);
    if (!article) return;
    const nodes = [...article.querySelectorAll("h2")];
    const found = nodes.map((node) => {
      node.id ||= slug(node.textContent ?? "");
      return { id: node.id, text: node.textContent ?? "" };
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the headings live in each page's markup, readable only once it is on screen
    setHeadings(found);

    // The top band below the sticky header decides which section counts as the one being read.
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (first) setActive(first.target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [articleId]);

  if (headings.length === 0) return null;

  return (
    <nav aria-label="On this page" className="flex flex-col gap-0.5">
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-muted">On this page</p>
      {headings.map((heading) => {
        const on = active === heading.id;
        return (
          <a
            key={heading.id}
            href={`#${heading.id}`}
            aria-current={on ? "location" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
              on ? "bg-surface-secondary font-medium text-foreground" : "text-muted hover:text-foreground"
            }`}>
            {heading.text}
          </a>
        );
      })}
    </nav>
  );
}
