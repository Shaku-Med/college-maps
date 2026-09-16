"use client";

import { useLayoutEffect } from "react";

import { applyCoverViewport } from "@/lib/cover-viewport";

export function CoverViewport() {
  useLayoutEffect(() => {
    applyCoverViewport();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyCoverViewport);
    window.addEventListener("resize", applyCoverViewport);
    window.addEventListener("orientationchange", applyCoverViewport);
    window.addEventListener("pageshow", applyCoverViewport);
    window.visualViewport?.addEventListener("resize", applyCoverViewport);
    window.visualViewport?.addEventListener("scroll", applyCoverViewport);
    return () => {
      window.removeEventListener("resize", applyCoverViewport);
      window.removeEventListener("orientationchange", applyCoverViewport);
      window.removeEventListener("pageshow", applyCoverViewport);
      window.visualViewport?.removeEventListener("resize", applyCoverViewport);
      window.visualViewport?.removeEventListener("scroll", applyCoverViewport);
      media.removeEventListener("change", applyCoverViewport);
    };
  }, []);
  return null;
}
