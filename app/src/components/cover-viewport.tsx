"use client";

import { useEffect } from "react";

import { applyCoverViewport } from "@/lib/cover-viewport";

export function CoverViewport() {
  useEffect(() => {
    applyCoverViewport();
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
    };
  }, []);
  return null;
}
