"use client";

import { Button, Surface } from "@heroui/react";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

export const COLLAPSE_AFTER_PX = 48;

export const SHEET_PEEK_WRAP =
  "absolute inset-x-0 bottom-0 z-20 md:inset-x-auto md:bottom-4 md:left-4 md:w-[400px]";

export const SHEET_FULL_WRAP =
  "absolute inset-x-0 bottom-0 z-30 md:bottom-auto md:left-4 md:right-auto md:top-4 md:w-[420px]";

const SNAP_MS = 280;
const SNAP_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const DRAG_LOCK_PX = 8;
const VELOCITY_FLICK = 0.65;

function isDesktop() {
  return window.matchMedia("(min-width: 768px)").matches;
}

function nearestScrollable(start: HTMLElement, root: HTMLElement) {
  let node: HTMLElement | null = start;
  while (node && node !== root) {
    const style = window.getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function DraggableSheet({
  onCollapse,
  onExpand,
  children,
}: {
  onCollapse?: () => void;
  onExpand?: () => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tracking = useRef(false);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startX = useRef(0);
  const lastY = useRef(0);
  const lastT = useRef(0);
  const velocity = useRef(0);
  const offset = useRef(0);
  const pointerId = useRef<number | null>(null);

  const setOffset = useCallback((y: number, withSnap: boolean) => {
    offset.current = y;
    const node = rootRef.current;
    if (!node) return;
    node.style.transition = withSnap ? `transform ${SNAP_MS}ms ${SNAP_EASE}` : "none";
    node.style.transform = y ? `translate3d(0, ${y}px, 0)` : "";
  }, []);

  const dismiss = useCallback(() => {
    const node = rootRef.current;
    const distance = (node?.offsetHeight ?? 320) + 40;
    setOffset(distance, true);
    window.setTimeout(() => onCollapse?.(), SNAP_MS - 40);
  }, [onCollapse, setOffset]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!tracking.current || event.pointerId !== pointerId.current) return;
      const dy = event.clientY - startY.current;
      const dx = event.clientX - startX.current;
      if (!dragging.current) {
        if (Math.abs(dy) < DRAG_LOCK_PX && Math.abs(dx) < DRAG_LOCK_PX) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          tracking.current = false;
          return;
        }
        dragging.current = true;
        const node = rootRef.current;
        if (node) {
          node.style.touchAction = "none";
          try {
            node.setPointerCapture(event.pointerId);
          } catch {
            /* pointer already released */
          }
        }
      }
      event.preventDefault();
      const now = performance.now();
      const dt = now - lastT.current;
      if (dt > 0) velocity.current = (event.clientY - lastY.current) / dt;
      lastY.current = event.clientY;
      lastT.current = now;
      const maxDown = rootRef.current?.offsetHeight ?? 480;
      const next = onExpand && !onCollapse ? Math.min(40, Math.max(-120, dy)) : Math.min(maxDown, Math.max(onExpand ? -80 : 0, dy));
      setOffset(next, false);
    };

    const onUp = (event: PointerEvent) => {
      if (!tracking.current || event.pointerId !== pointerId.current) return;
      const dy = event.clientY - startY.current;
      const flickedDown = velocity.current > VELOCITY_FLICK;
      const flickedUp = velocity.current < -VELOCITY_FLICK;
      tracking.current = false;
      dragging.current = false;
      pointerId.current = null;
      if (rootRef.current) rootRef.current.style.touchAction = "";
      if (onCollapse && (dy > COLLAPSE_AFTER_PX || flickedDown)) {
        dismiss();
        return;
      }
      if (onExpand && (dy < -COLLAPSE_AFTER_PX || flickedUp)) {
        setOffset(0, false);
        onExpand();
        return;
      }
      setOffset(0, true);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dismiss, onCollapse, onExpand, setOffset]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isDesktop() || event.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-sheet-no-drag]")) return;
    const fromGrab = Boolean(target.closest("[data-sheet-grab]"));
    if (!fromGrab && target.closest("input, textarea, select, [contenteditable='true']")) return;
    const scrollable = nearestScrollable(target, root);
    if (!fromGrab && scrollable && scrollable.scrollTop > 0) return;
    tracking.current = true;
    dragging.current = false;
    pointerId.current = event.pointerId;
    startY.current = event.clientY;
    startX.current = event.clientX;
    lastY.current = event.clientY;
    lastT.current = performance.now();
    velocity.current = 0;
  }

  return (
    <div ref={rootRef} onPointerDown={onPointerDown} className="will-change-transform md:will-change-auto">
      {children}
    </div>
  );
}

export function SheetLayer({
  wrapClassName,
  onCollapse,
  onExpand,
  children,
}: {
  wrapClassName: string;
  onCollapse?: () => void;
  onExpand?: () => void;
  children: ReactNode;
}) {
  return (
    <div className={wrapClassName}>
      <DraggableSheet onCollapse={onCollapse} onExpand={onExpand}>
        {children}
      </DraggableSheet>
    </div>
  );
}

export function SheetGrabber({ onCollapse: _onCollapse }: { onCollapse?: () => void } = {}) {
  return (
    <div data-sheet-grab className="flex shrink-0 cursor-grab touch-none justify-center pt-2.5 md:hidden">
      <div className="h-1 w-10 rounded-full bg-separator" aria-hidden />
    </div>
  );
}

export function CollapseButton({ onCollapse }: { onCollapse: () => void }) {
  return (
    <Button isIconOnly variant="ghost" aria-label="Show the map" onPress={onCollapse} className="rounded-full">
      <ChevronDown aria-hidden />
    </Button>
  );
}

export function SheetPeek({
  icon,
  title,
  subtitle,
  label,
  onExpand,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  label: string;
  onExpand: () => void;
}) {
  return (
    <Surface className="animate-sheet-in overflow-hidden rounded-t-[28px] pb-[var(--map-safe-bottom)] shadow-2xl md:rounded-[28px] md:pb-0">
      <div data-sheet-grab className="flex cursor-grab touch-none justify-center pt-2.5 md:hidden">
        <div className="h-1 w-10 shrink-0 rounded-full bg-separator" aria-hidden />
      </div>
      <Button
        variant="ghost"
        onPress={onExpand}
        aria-label={label}
        className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3 text-left">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight text-foreground">{title}</span>
          <span className="block truncate text-xs text-muted">{subtitle}</span>
        </span>
      </Button>
    </Surface>
  );
}
