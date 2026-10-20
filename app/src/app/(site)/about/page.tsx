import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { OPEN_MAP_CLASS } from "@/components/site-chrome";
import ART from "@/data/about-art.json";
import { CAMPUS } from "@/data/campus";

const { app, college, rooms, schedule } = CAMPUS;
const portal = schedule.portalName ?? "your student portal";

export const metadata: Metadata = {
  title: "About",
  description: `${app.name} finds any building or room at ${college.name}, walks you there on the campus paths, and keeps your classes a tap away.`,
  alternates: { canonical: "/about" },
  robots: { index: true, follow: true },
};

// Phone screenshots, cut from 1080 wide captures with the status bar and gesture handle removed.
const SHOT_WIDTH = 720;
const SHOT_HEIGHT = 1469;

const STORIES = [
  {
    shot: "place",
    alt: "A building card in the app with a Which room field and a Directions button",
    kicker: "Search",
    title: `Type ${rooms.example}. That is the whole search.`,
    body: `Every building and room at ${college.shortName} is in it, along with the floor each room is on. Only know the building? Leave the room empty and it takes you to the door.`,
    points: [
      "Tells you to take the stairs down when a room is below ground.",
      "Shares any place as a link that opens right on it.",
      "Works without an account.",
    ],
  },
  {
    shot: "classes",
    alt: "The Classes screen with the next class on top and a week strip",
    kicker: "Classes",
    title: "Your schedule, with the walk built in.",
    body: `Paste it from ${portal} once. The next class sits on top with directions a tap away, and each day of the week is one tap on the strip.`,
    points: [
      "Warns when two classes are too far apart to make it in time.",
      "Starts the walk from your last class, not from where you sat down.",
      "Stays on your device. Nothing is uploaded.",
    ],
  },
  {
    shot: "friends",
    alt: "The Friends screen with a friend request, meetups, and a list of friends",
    kicker: "Friends",
    title: "Meet up without the “where are you” texts.",
    body: "Pick a spot and invite friends. Everyone shows on the map until the meetup ends, and then it forgets where you were.",
    points: [
      "Friends find you by username. Your email stays private.",
      "Campus events anyone can join, from study groups to pickup games.",
      "Block or report anyone, any time.",
    ],
  },
];

const DETAILS = [
  "Directions keep going with the screen off, and show on the Lock Screen on iPhone.",
  "A natural voice reads each turn, made on your phone so it keeps talking with no signal.",
  "One switch to avoid stairs, for the whole walk.",
  "Add stops on the way, and it asks before sending you around campus for one.",
  "From off campus it handles the drive or ride in, then walks you from where you park.",
  "On iPhone, ask Siri for directions to any building.",
];

function Shot({ name, alt, className = "", eager = false }: { name: string; alt: string; className?: string; eager?: boolean }) {
  const loading = eager ? "eager" : "lazy";
  return (
    <div
      className={`rounded-[2.4rem] border border-separator bg-surface p-1.5 shadow-[0_40px_90px_-45px_rgb(0_0_0/0.5)] ${className}`}>
      <Image
        src={`/about/${name}-light.webp`}
        alt={alt}
        width={SHOT_WIDTH}
        height={SHOT_HEIGHT}
        loading={loading}
        unoptimized
        className="block h-auto w-full rounded-[2.05rem] dark:hidden"
      />
      <Image
        src={`/about/${name}-dark.webp`}
        alt={alt}
        width={SHOT_WIDTH}
        height={SHOT_HEIGHT}
        loading={loading}
        unoptimized
        className="hidden h-auto w-full rounded-[2.05rem] dark:block"
      />
    </div>
  );
}

function LogoMark() {
  return (
    <div aria-hidden className="relative size-14">
      <span className="about-mark-ripple" />
      <Image
        src="/icons/icon.svg"
        alt=""
        width={56}
        height={56}
        unoptimized
        className="about-mark-icon relative size-14 rounded-[16px] shadow-[0_12px_28px_-12px_rgb(0_0_0/0.45)]"
      />
    </div>
  );
}

// The campus walkways, faint in the text color, with real walks drawing over them in the accent color.
function CampusBackdrop() {
  const { width, height, routes } = ART;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <svg className="absolute inset-0 size-full text-foreground" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <mask id="about-campus-paths" maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height} style={{ maskType: "alpha" }}>
            <image href="/about/campus-paths.svg" width={width} height={height} />
          </mask>
        </defs>
        <g className="about-drift">
          <rect width={width} height={height} fill="currentColor" mask="url(#about-campus-paths)" className="opacity-[0.11] dark:opacity-[0.16]" />
          {routes.map((route, index) => {
            const delay = { animationDelay: `${index * 4}s` };
            return (
              <g key={route.d}>
                <path d={route.d} pathLength={1} className="about-route" style={delay} />
                <circle cx={route.end[0]} cy={route.end[1]} r={10} className="about-route-end" style={delay} />
              </g>
            );
          })}
        </g>
      </svg>
      <div className="absolute inset-0 bg-[radial-gradient(110%_85%_at_70%_40%,transparent_30%,var(--background)_78%)]" />
      <div className="absolute inset-0 hidden bg-[linear-gradient(90deg,var(--background)_8%,transparent_52%)] lg:block" />
    </div>
  );
}

export default function AboutPage() {
  return (
    <>
      <section className="relative isolate overflow-hidden">
        <CampusBackdrop />
        <div className="mx-auto grid w-full max-w-7xl items-center gap-16 px-6 pb-20 pt-14 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[1.15fr_0.85fr] lg:gap-12 lg:px-10 lg:py-12">
          <div className="flex flex-col items-start gap-8">
            <LogoMark />
            <h1 className="max-w-4xl text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-6xl lg:text-[clamp(3.25rem,8.5svh,4.5rem)] xl:text-[clamp(3.5rem,10svh,5.5rem)]">
              Find any room at {college.shortName}. Get there on time.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted lg:text-xl">
              {app.name} turns a room number into walking directions on the campus paths, and tells you when to leave
              for your next class.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
              <Link href="/" className={`${OPEN_MAP_CLASS} h-12 px-6 text-base`}>
                Open the map
              </Link>
              <Link
                href="#how"
                className="group inline-flex items-center gap-2 rounded-full text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent">
                See how it works
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </div>
            <p className="text-sm text-muted">Free, and on the web today. The iPhone and Android apps are in testing.</p>
          </div>
          <Shot
            name="nav"
            alt="Turn by turn walking directions in the app, with the next turn on top and the time left at the bottom"
            className="mx-auto w-[72%] max-w-[320px] sm:max-w-[340px] lg:w-[min(400px,calc((100svh-11rem)*0.49))] lg:max-w-none"
            eager
          />
        </div>
      </section>

      <section id="how" className="scroll-mt-20">
        {STORIES.map((story, index) => (
          <div key={story.shot} className="border-t border-separator">
            <div className="mx-auto grid w-full max-w-7xl items-center gap-14 px-6 py-20 lg:grid-cols-2 lg:gap-24 lg:px-10 lg:py-28">
              <div className={`flex flex-col gap-5 ${index % 2 === 1 ? "lg:order-2" : ""}`}>
                <p className="text-sm font-semibold text-accent">{story.kicker}</p>
                <h2 className="max-w-xl text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
                  {story.title}
                </h2>
                <p className="max-w-lg text-base leading-relaxed text-muted lg:text-lg">{story.body}</p>
                <ul className="mt-3 flex max-w-lg flex-col divide-y divide-separator border-y border-separator">
                  {story.points.map((point) => (
                    <li key={point} className="py-3.5 text-sm leading-relaxed lg:text-base">
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
              <Shot name={story.shot} alt={story.alt} className="mx-auto w-[72%] max-w-[320px] lg:w-[66%] lg:max-w-[380px]" />
            </div>
          </div>
        ))}
      </section>

      <section className="border-t border-separator">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:px-10 lg:py-28">
          <h2 className="text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">And the small things.</h2>
          <ul className="grid gap-x-12 sm:grid-cols-2">
            {DETAILS.map((detail) => (
              <li key={detail} className="border-t border-separator py-5 text-base leading-relaxed text-muted">
                {detail}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-separator bg-surface">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:px-10 lg:py-28">
          <h2 className="text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">Private by default.</h2>
          <div className="flex max-w-2xl flex-col gap-5 text-base leading-relaxed text-muted lg:text-lg">
            <p>
              The map, search, and directions work without an account, and the rooms you look up never leave your device.
            </p>
            <p>
              Sign in only if you want friends. Your school email is stored encrypted, friends see your name and username,
              and nobody sees where you are unless you join a meetup. When it ends, so does the sharing.
            </p>
            <Link
              href="/privacy"
              className="group inline-flex w-fit items-center gap-2 rounded font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent">
              Read the privacy policy
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      <section className="relative isolate overflow-hidden border-t border-separator">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-8 px-6 py-24 lg:flex-row lg:items-end lg:justify-between lg:px-10 lg:py-32">
          <h2 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl lg:text-6xl">
            Try it on your way to class.
          </h2>
          <Link href="/" className={`${OPEN_MAP_CLASS} h-12 shrink-0 px-6 text-base`}>
            Open the map
          </Link>
        </div>
      </section>
    </>
  );
}
