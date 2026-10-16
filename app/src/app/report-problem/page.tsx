import type { Metadata } from "next";
import Link from "next/link";

import { ReportProblemForm } from "@/components/report-problem-form";
import { CAMPUS, getPlace } from "@/data/campus";
import { isProblemKind } from "@/lib/problem-reports";

const { app } = CAMPUS;

export const metadata: Metadata = {
  title: "Report a problem",
  description: `Tell us when something in ${app.name} is broken, a place is wrong, or you have an idea.`,
  alternates: { canonical: "/report-problem" },
  robots: { index: false, follow: true },
};

type Search = { place?: string | string[]; kind?: string | string[] };

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ReportProblemPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const place = getPlace(firstParam(params.place));
  const kind = firstParam(params.kind);

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <article className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <header className="flex flex-col gap-2">
          <Link href="/" className="text-xs font-medium uppercase tracking-wide text-muted hover:text-foreground">
            {app.name}
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Report a problem</h1>
          <p className="text-sm leading-relaxed text-muted">
            Something broken, a building in the wrong spot, or an idea? Tell us and we will look into it.
          </p>
        </header>

        <ReportProblemForm initialPlaceId={place?.id} initialKind={isProblemKind(kind) ? kind : place ? "map" : "bug"} />
      </article>
    </main>
  );
}
