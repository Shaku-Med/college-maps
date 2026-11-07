"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const LEAVE_MS = 200;

/** Keeps what was showing on screen for a moment after it goes away, so it can animate out instead of vanishing. */
export function Presence({ show, children }: { show: boolean; children: ReactNode }) {
  const [leaving, setLeaving] = useState(false);
  const [wasShown, setWasShown] = useState(show);
  const lastChildren = useRef(children);

  useEffect(() => {
    if (show) lastChildren.current = children;
  });

  if (wasShown !== show) {
    setWasShown(show);
    setLeaving(!show);
  }

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  if (show) return <div className="contents">{children}</div>;
  if (!leaving) return null;
  // eslint-disable-next-line react-hooks/refs -- Showing the last render again is what this component is for.
  return <div data-leaving className="presence contents">{lastChildren.current}</div>;
}
