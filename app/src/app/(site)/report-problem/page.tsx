import type { Metadata } from "next";

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
    <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 pb-24 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-20 lg:px-10 lg:pt-20">
      <header className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <h1 className="text-4xl font-semibold tracking-tight lg:text-5xl">Report a problem</h1>
        <p className="max-w-md text-base leading-relaxed text-muted lg:text-lg">
          Something broken, a building in the wrong spot, or an idea? Tell us and we will look into it.
        </p>
        <ul className="mt-2 flex max-w-md flex-col gap-3 border-t border-separator pt-6 text-sm leading-relaxed text-muted">
          <li>Pick a place and it goes along with the report, so a fix lands in the right spot.</li>
          <li>Turn on email only if you want an answer. Otherwise we never write to you about it.</li>
          <li>Reports come from signed-in students, which keeps the inbox free of spam.</li>
        </ul>
      </header>

      <div className="rounded-3xl border border-separator bg-surface p-6 sm:p-8">
        <ReportProblemForm initialPlaceId={place?.id} initialKind={isProblemKind(kind) ? kind : place ? "map" : "bug"} />
      </div>
    </div>
  );
}
