"use client";

import { useEffect, useId, useState, type AnimationEvent } from "react";

import { LAUNCH_KEY } from "@/lib/launch";

// The app icon's pin, as the phone app's splash draws it: scaled 2.9 times in a 1024 square, roads cut through.
const PIN = "M256 70 C 188 70 134 124 134 192 C 134 268 220 334 251 357 C 254 359.3 258 359.3 261 357 C 292 334 378 268 378 192 C 378 124 324 70 256 70 Z";

// A map that never reports in, like one without WebGL, still gets the splash out of the way.
const MAX_WAIT_MS = 4000;

/** The phone app's launch: the pin waits on the brand color, then hops, pings, and fades into the map once `ready`. */
export function LaunchSplash({ ready }: { ready?: boolean }) {
  const waits = ready !== undefined;
  const [timedOut, setTimedOut] = useState(false);
  const [gone, setGone] = useState(false);
  const clip = `launch-pin-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;

  useEffect(() => {
    if (!waits) return;
    const timer = window.setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [waits]);

  const finish = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.animationName !== "launch-exit") return;
    try {
      sessionStorage.setItem(LAUNCH_KEY, "1");
    } catch {}
    setGone(true);
  };

  if (gone) return null;

  return (
    <div className="launch-splash" data-leaving={waits && (ready || timedOut) ? "" : undefined} onAnimationEnd={finish} aria-hidden>
      <div className="launch-stage">
        <div className="launch-ripple" />
        <div className="launch-grow">
          <svg className="launch-pin" width="96" height="96" viewBox="0 0 1024 1024">
            <defs>
              <clipPath id={clip}>
                <path d={PIN} />
              </clipPath>
            </defs>
            <g transform="translate(512 512) scale(2.9) translate(-256 -214)">
              <path d={PIN} fill="var(--brand-foreground)" />
              <g clipPath={`url(#${clip})`} fill="none" stroke="var(--brand)" strokeWidth={14}>
                <line x1={206} y1={40} x2={206} y2={380} />
                <line x1={292} y1={40} x2={292} y2={380} />
                <path d="M206 96 C 250 190 320 250 410 276" />
                <path d="M206 150 C 246 230 316 286 410 312" />
              </g>
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
