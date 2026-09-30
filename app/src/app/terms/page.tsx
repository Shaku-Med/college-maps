import type { Metadata } from "next";
import Link from "next/link";

import { CAMPUS } from "@/data/campus";

const { app, college } = CAMPUS;
const domains = college.emailDomains.map((d) => `@${d}`).join(" or ");

export const metadata: Metadata = {
  title: "Terms of use",
  description: `The rules for using ${app.name}: accounts, friends, meetups, and the campus map.`,
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <article className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <header className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{app.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Terms of use</h1>
          <p className="text-sm leading-relaxed text-muted">{app.disclaimer}</p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">What this is</h2>
          <p className="text-sm leading-relaxed text-muted">
            {app.name} is a student-built campus map for {college.name}. It helps you find buildings and
            rooms, get walking directions, keep a class list on your device, and optionally sign in to
            add friends and plan meetups. It is not an official {college.shortName} service and is not
            affiliated with the college.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Using the map</h2>
          <p className="text-sm leading-relaxed text-muted">
            You can browse the map and directions without an account. Routes are a guide, not a promise:
            paths change, doors close, and weather matters. Use common sense outdoors and indoors. We are
            not responsible if a route is wrong, blocked, or unsafe.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Accounts</h2>
          <p className="text-sm leading-relaxed text-muted">
            Sign in is optional and uses a one-time code to a {college.shortName} email ({domains}). Pick a
            display name and username that do not harass others. Do not pretend to be someone else or use
            someone else&apos;s email. You are responsible for what happens on your signed-in devices.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Friends and meetups</h2>
          <p className="text-sm leading-relaxed text-muted">
            Friend requests, private meetups, and campus events are for students using this app in good
            faith. During a private meetup, live location is shared only with people in that meetup, and
            only while it is active. Treat others with respect. Do not use meetups to stalk, threaten,
            spam, or pressure anyone.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">What is not allowed</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>Harassment, hate, threats, or sexual content involving minors.</li>
            <li>Impersonation, scams, or trying to break into someone else&apos;s account.</li>
            <li>Spam, scraping, or automated abuse of the map or the API.</li>
            <li>Posting illegal content, or using the app to plan harm.</li>
            <li>Anything that interferes with other students&apos; safe use of the campus tools.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Blocking, reporting, and removals</h2>
          <p className="text-sm leading-relaxed text-muted">
            You can block someone so they cannot add or invite you, and you can report a person or a
            campus event from inside the app. We may remove content, end meetups, or suspend or delete
            accounts that break these terms or put others at risk. Blocking and reporting do not replace
            calling campus security or emergency services when you need them.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Your content</h2>
          <p className="text-sm leading-relaxed text-muted">
            Names, usernames, meetup titles, and notes you post stay yours. By posting them here you let
            us show them to the people the feature is meant for (for example friends, or signed-in
            students on the campus board) and keep them long enough to run the feature and review reports.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Privacy</h2>
          <p className="text-sm leading-relaxed text-muted">
            What we store and what we never keep is explained in the{" "}
            <Link href="/privacy" className="font-medium text-accent underline-offset-2 hover:underline">
              privacy policy
            </Link>
            . If these terms and the privacy policy say different things about data, the privacy policy
            wins for that topic.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">No warranty</h2>
          <p className="text-sm leading-relaxed text-muted">
            The app is provided as is, for free, by a student project. It may be unavailable, incomplete,
            or wrong. To the fullest extent the law allows, we are not liable for lost data, missed
            classes, injury, or other damages from using or not being able to use {app.name}.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Changes</h2>
          <p className="text-sm leading-relaxed text-muted">
            We may update these terms when the app changes. The page you are reading is the current
            version. Keeping an account after a change means you accept the updated terms. You can delete
            your account anytime from Account.
          </p>
        </section>

        <p className="text-xs leading-relaxed text-muted">
          {app.name} is a student-built campus map for {college.name}. It is not an official{" "}
          {college.shortName} service. These terms are written in plain language for students; they are
          not a substitute for legal advice.
        </p>
      </article>
    </main>
  );
}
