"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

const DRAG_THRESHOLD_PX = 6;

type DragScrollProps = {
  children: ReactNode;
  className?: string;
  activeKey?: string;
};

export function DragScroll({ children, className, activeKey }: DragScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const updateEdges = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft < max - 2 });
    };

    const handleWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      el.scrollBy({ left: event.deltaY, behavior: "auto" });
    };

    let pointerId: number | null = null;
    let startX = 0;
    let startScroll = 0;
    let dragged = false;

    // Capture phase runs before React Aria's press handlers, which stop propagation on the buttons.
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startScroll = el.scrollLeft;
      dragged = false;
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      if (!dragged && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      if (!dragged) {
        dragged = true;
        setIsDragging(true);
        // Capturing on the track cancels the pending press, so a drag never toggles a chip.
        el.setPointerCapture(event.pointerId);
      }
      el.scrollLeft = startScroll - dx;
    };

    const endDrag = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (dragged) {
        setIsDragging(false);
        if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
      }
    };

    const suppressClickAfterDrag = (event: MouseEvent) => {
      if (!dragged) return;
      event.preventDefault();
      event.stopPropagation();
      dragged = false;
    };

    updateEdges();
    const resize = new ResizeObserver(updateEdges);
    resize.observe(el);
    el.addEventListener("scroll", updateEdges, { passive: true });
    el.addEventListener("wheel", handleWheel, { passive: false });
    el.addEventListener("pointerdown", handlePointerDown, { capture: true });
    el.addEventListener("pointermove", handlePointerMove);
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);
    el.addEventListener("click", suppressClickAfterDrag, { capture: true });

    return () => {
      resize.disconnect();
      el.removeEventListener("scroll", updateEdges);
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("pointerdown", handlePointerDown, { capture: true });
      el.removeEventListener("pointermove", handlePointerMove);
      el.removeEventListener("pointerup", endDrag);
      el.removeEventListener("pointercancel", endDrag);
      el.removeEventListener("click", suppressClickAfterDrag, { capture: true });
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    const active = el?.querySelector<HTMLElement>('[data-selected="true"]');
    if (!el || !active || el.clientWidth === 0) return;

    const margin = 32;
    const start = active.offsetLeft - el.offsetLeft;
    const end = start + active.offsetWidth;
    if (start < el.scrollLeft + margin) {
      el.scrollTo({ left: Math.max(0, start - margin), behavior: "smooth" });
    } else if (end > el.scrollLeft + el.clientWidth - margin) {
      el.scrollTo({ left: end - el.clientWidth + margin, behavior: "smooth" });
    }
  }, [activeKey]);

  return (
    <div
      ref={ref}
      className={cn(
        "overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        isDragging ? "cursor-grabbing select-none [&_*]:cursor-grabbing" : "cursor-grab",
        edges.start &&
          edges.end &&
          "[mask-image:linear-gradient(to_right,transparent,black_28px,black_calc(100%-28px),transparent)]",
        edges.start && !edges.end && "[mask-image:linear-gradient(to_right,transparent,black_28px)]",
        !edges.start && edges.end && "[mask-image:linear-gradient(to_left,transparent,black_28px)]",
        className,
      )}>
      {children}
    </div>
  );
}
