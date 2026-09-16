import type { Metadata } from "next";

import { CAMPUS } from "@/data/campus";

const { app, college } = CAMPUS;
const domains = college.emailDomains.map((d) => `@${d}`).join(" or ");

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${app.name} stores, what it never keeps, and how to delete your information.`,
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <article className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
        <header className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{app.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
          <p className="text-sm leading-relaxed text-muted">{app.disclaimer}</p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">The map itself</h2>
          <p className="text-sm leading-relaxed text-muted">
            You can look up buildings, rooms, and walking directions without an account. That uses
            the campus map on your device. We do not get a copy of the rooms you search or the routes
            you walk.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">If you sign in</h2>
          <p className="text-sm leading-relaxed text-muted">
            Sign in is optional. It uses a one-time code sent to a {college.shortName} email ({domains}).
            We store:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>
              Your school email, encrypted. The database never holds the address in plain text, and
              friends never see it. Only you see it on your own account screen.
            </li>
            <li>The name and username you pick, which friends and people in a meetup with you can see.</li>
            <li>Friend requests, friendships, and people you have blocked.</li>
            <li>
              Meetups you host or join, including the place or pin, until they end. Hosting a campus
              meetup posts the title to the public board for signed-in students.
            </li>
            <li>
              Notification subscriptions for this browser or installed app, if you turn notifications on. Sign out
              removes this device. Wiping your account removes every device.
            </li>
            <li>
              Sign-in sessions on this device (and any other device you signed in on), as a hashed
              cookie, not the cookie itself.
            </li>
            <li>
              Hashed sign-in codes until they expire, get used, or you delete your account. Unused
              codes are removed automatically.
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">What we never keep</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>
              Live location. During a private meetup, your position is streamed in memory and expires
              in minutes. It is never written to a database. Campus public meetups do not share live
              location.
            </li>
            <li>
              Your class list. Classes you save
              {CAMPUS.schedule.portalName ? ` from ${CAMPUS.schedule.portalName}` : ""} stay in this
              browser only.
            </li>
            <li>Passwords. There are none. Sign in is an email code.</li>
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Download a copy</h2>
          <p className="text-sm leading-relaxed text-muted">
            Signed in, open Account and choose JSON, HTML, or PDF. That file is your profile, sessions,
            friends, blocks, meetups, and the class list saved in this browser. Live location is not in
            it, because we never store it.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Delete your information</h2>
          <p className="text-sm leading-relaxed text-muted">
            Signed in, open Account and use the <span className="text-foreground">Danger zone</span>.
            That wipes your account: encrypted email, profile, friends, blocks, meetups you host,
            membership in other people&apos;s meetups, notification subscriptions, sessions, and leftover
            sign-in codes. You will be signed out everywhere. Doing it from this app also clears the class
            list saved in this browser.
          </p>
          <p className="text-sm leading-relaxed text-muted">
            Incomplete accounts that never set a name and username are removed automatically after two
            days.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Who can see you</h2>
          <p className="text-sm leading-relaxed text-muted">
            Other students find you by username, not email. Names and usernames built from your school
            email are refused. Blocking someone hides you from them and removes shared meetup
            membership. Nobody can browse a list of every account.
          </p>
        </section>

        <p className="text-xs leading-relaxed text-muted">
          {app.name} is a student-built campus map for {college.name}. It is not an official{" "}
          {college.shortName} service.
        </p>
      </article>
    </main>
  );
}
