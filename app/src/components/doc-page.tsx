import type { ReactNode } from "react";

import { DocToc } from "@/components/doc-toc";

/** A long read, like the privacy policy: a readable column, with the sections listed beside it on wide screens. */
export function DocPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-6 pb-24 pt-14 lg:grid lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-20 lg:px-10 lg:pt-20">
      <article
        id="doc"
        className="flex max-w-3xl flex-col gap-10 [&_h2]:scroll-mt-24 lg:[&_h2]:text-xl lg:[&_li]:text-base lg:[&_p]:text-base">
        <header className="flex flex-col gap-4 border-b border-separator pb-10">
          <h1 className="text-4xl font-semibold tracking-tight lg:text-5xl">{title}</h1>
          {intro ? <p className="max-w-2xl text-base leading-relaxed text-muted lg:!text-lg">{intro}</p> : null}
        </header>
        {children}
      </article>
      <aside className="hidden lg:block">
        <div className="sticky top-24">
          <DocToc articleId="doc" />
        </div>
      </aside>
    </div>
  );
}
