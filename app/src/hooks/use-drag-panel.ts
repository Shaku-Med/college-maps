"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

// The curve system sheets settle on: quick off the finger, a long soft landing, no bounce.
const SETTLE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const SETTLE_MS = 380;
const FLICK_MIN_MS = 160;
const RESIZE_MS = 220;
const START_DRAG_PX = 6;
const OVERPULL_SHARE = 0.18;
const OVERPULL_MAX_PX = 24;
// A flick decides by itself, unless the finger rested before lifting; otherwise it must travel COMMIT_PX, as halfway is out of reach on a long panel.
const FLICK_SPEED = 0.4;
const COMMIT_PX = 120;
const RESTED_MS = 80;
const UNMOUNT_AFTER_MS = 60;
const SWALLOW_CLICK_MS = 100;

type Drag = {
  pointerId?: number;
  startX: number;
  startY: number;
  startHeight: number;
  lastY: number;
  lastAt: number;
  velocity: number;
  moved: boolean;
};

const settleTime = (ms: number) => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms);

// `edge` is the side of the screen the card sits on; a list inside marked `data-panel-scroll` hands over to the panel when pulled past its end.
export function useDragPanel({
  edge,
  open,
  canOpen,
  onOpenChange,
}: {
  edge: "top" | "bottom";
  open: boolean;
  canOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const clipRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const settleMsRef = useRef(SETTLE_MS);
  const swallowClickRef = useRef(false);
  const unmountTimerRef = useRef(0);
  const latest = useRef({ open, onOpenChange });
  const [mounted, setMounted] = useState(open);
  const [dragging, setDragging] = useState(false);
  const opensToward = edge === "top" ? 1 : -1;
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    latest.current = { open, onOpenChange };
  });

  const naturalHeight = () => contentRef.current?.offsetHeight ?? 0;
  const shownHeight = () => clipRef.current?.getBoundingClientRect().height ?? 0;

  const unmountAfter = useCallback((ms: number) => {
    window.clearTimeout(unmountTimerRef.current);
    unmountTimerRef.current = window.setTimeout(() => {
      if (!dragRef.current && !latest.current.open) setMounted(false);
    }, ms + UNMOUNT_AFTER_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(unmountTimerRef.current), []);

  const paint = useCallback((height: number, ms: number) => {
    const clip = clipRef.current;
    const content = contentRef.current;
    if (!clip) return;
    clip.style.transition = ms ? `height ${ms}ms ${SETTLE_EASE}` : "none";
    clip.style.height = `${height}px`;
    if (!content) return;
    const natural = content.offsetHeight;
    content.style.transition = ms ? `opacity ${ms}ms ${SETTLE_EASE}` : "none";
    content.style.opacity = String(natural ? Math.min(1, height / (natural * 0.6)) : 1);
  }, []);

  useLayoutEffect(() => {
    if (dragRef.current?.moved) return;
    const ms = settleTime(settleMsRef.current);
    settleMsRef.current = SETTLE_MS;
    const content = contentRef.current;
    if (open && content && shownHeight() === 0) {
      // Starting from clear, so opening with a tap fades in the same way a drag does.
      content.style.transition = "none";
      content.style.opacity = "0";
      void content.offsetHeight;
    }
    paint(open ? naturalHeight() : 0, ms);
    if (!open) unmountAfter(ms);
  }, [open, mounted, paint, unmountAfter]);

  // Stops being added or dropped change the height while it is open.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !mounted) return;
    let last = content.offsetHeight;
    const observer = new ResizeObserver(() => {
      const next = content.offsetHeight;
      if (next === last) return;
      last = next;
      if (latest.current.open && !dragRef.current?.moved) paint(next, settleTime(RESIZE_MS));
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [mounted, paint]);

  const moveTo = useCallback(
    (y: number) => {
      const drag = dragRef.current;
      if (!drag) return;
      const at = performance.now();
      const gap = at - drag.lastAt;
      if (gap > 0) drag.velocity = 0.7 * (((y - drag.lastY) * opensToward) / gap) + 0.3 * drag.velocity;
      drag.lastY = y;
      drag.lastAt = at;
      const wanted = drag.startHeight + (y - drag.startY) * opensToward;
      const natural = naturalHeight();
      paint(wanted <= natural ? Math.max(0, wanted) : natural + Math.min(OVERPULL_MAX_PX, (wanted - natural) * OVERPULL_SHARE), 0);
    },
    [opensToward, paint],
  );

  const release = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.moved) {
      unmountAfter(0);
      return;
    }
    setDragging(false);
    // The click a mouse sends after letting go is part of the drag; a later Enter on the button is not.
    swallowClickRef.current = true;
    window.setTimeout(() => {
      swallowClickRef.current = false;
    }, SWALLOW_CLICK_MS);
    const natural = naturalHeight();
    const height = shownHeight();
    const velocity = performance.now() - drag.lastAt > RESTED_MS ? 0 : drag.velocity;
    const commit = Math.min(natural / 2, COMMIT_PX);
    const closing = drag.startHeight > natural / 2;
    const wantsOpen = Math.abs(velocity) >= FLICK_SPEED ? velocity > 0 : closing ? height > natural - commit : height > commit;
    const speed = Math.abs(velocity);
    const ms = speed > 0.2 ? Math.max(FLICK_MIN_MS, Math.min(SETTLE_MS, Math.abs((wantsOpen ? natural : 0) - height) / speed)) : SETTLE_MS;
    if (wantsOpen === latest.current.open) {
      paint(wantsOpen ? natural : 0, settleTime(ms));
      if (!wantsOpen) unmountAfter(settleTime(ms));
      return;
    }
    settleMsRef.current = ms;
    latest.current.onOpenChange(wantsOpen);
  }, [paint, unmountAfter]);

  const take = useCallback((x: number, y: number, pointerId?: number, moved = false) => {
    dragRef.current = {
      pointerId,
      startX: x,
      startY: y,
      startHeight: shownHeight(),
      lastY: y,
      lastAt: performance.now(),
      velocity: 0,
      moved,
    };
  }, []);

  function onPointerDown(event: ReactPointerEvent) {
    swallowClickRef.current = false;
    if (!canOpen || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (clipRef.current?.contains(target)) return;
    const control = target.closest("button, a, input, select, textarea, label, [role='button'], [role='switch']");
    if (control && !control.hasAttribute("data-panel-toggle")) return;
    window.clearTimeout(unmountTimerRef.current);
    setMounted(true);
    take(event.clientX, event.clientY, event.pointerId);
    const pointerId = event.pointerId;

    const onMove = (move: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || move.pointerId !== pointerId) return;
      if (!drag.moved) {
        if (Math.abs(move.clientY - drag.startY) < START_DRAG_PX) {
          if (Math.abs(move.clientX - drag.startX) >= START_DRAG_PX * 2) finish();
          return;
        }
        // Counted from here, so the panel does not jump by the distance it took to notice the drag.
        drag.moved = true;
        drag.startY = move.clientY;
        drag.startHeight = shownHeight();
        setDragging(true);
      }
      move.preventDefault();
      moveTo(move.clientY);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    const onUp = (up: PointerEvent) => {
      if (up.pointerId !== pointerId) return;
      finish();
      release();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onClickCapture(event: ReactMouseEvent) {
    if (!swallowClickRef.current) return;
    swallowClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  // Touch events, as the browser claims a scrolling list's pointers; only touchmove can still stop the scroll from starting.
  useEffect(() => {
    const clip = clipRef.current;
    if (!clip) return;
    let startX = 0;
    let startY = 0;
    let decided = false;
    let taking = false;

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      decided = event.touches.length > 1;
      taking = false;
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (taking) {
        if (event.cancelable) event.preventDefault();
        moveTo(touch.clientY);
        return;
      }
      if (decided) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      decided = true;
      if (!event.cancelable || !latest.current.open || Math.abs(dx) > Math.abs(dy) || dy * opensToward > 0) return;
      const list = (event.target as HTMLElement).closest<HTMLElement>("[data-panel-scroll]");
      const atEnd = !list || (edge === "bottom" ? list.scrollTop <= 0 : list.scrollTop + list.clientHeight >= list.scrollHeight - 1);
      if (!atEnd) return;
      taking = true;
      event.preventDefault();
      take(touch.clientX, touch.clientY, undefined, true);
      setDragging(true);
    };
    const onEnd = () => {
      if (taking) release();
      taking = false;
    };
    clip.addEventListener("touchstart", onStart, { passive: true });
    clip.addEventListener("touchmove", onMove, { passive: false });
    clip.addEventListener("touchend", onEnd);
    clip.addEventListener("touchcancel", onEnd);
    return () => {
      clip.removeEventListener("touchstart", onStart);
      clip.removeEventListener("touchmove", onMove);
      clip.removeEventListener("touchend", onEnd);
      clip.removeEventListener("touchcancel", onEnd);
    };
  }, [edge, moveTo, opensToward, release, take]);

  const clip = useCallback((node: HTMLDivElement | null) => {
    clipRef.current = node;
  }, []);
  const content = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node;
  }, []);

  return { clip, content, mounted, dragging, zone: { onPointerDown, onClickCapture } };
}
