function isStandaloneApp() {
  return (
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)) ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

function applyCoverViewport() {
  const root = document.documentElement;
  if (isStandaloneApp()) {
    root.classList.add("is-standalone");
    // WebKit bug 254868: innerHeight / 100dvh / visualViewport omit the home
    // indicator in an installed app. 100vh is the full screen from cold start.
    root.style.setProperty("--app-height", "100vh");
    // env(safe-area-inset-bottom) is often 0px on a cold standalone launch, so
    // sheets would sit under the home indicator. 34px is the iPhone home bar.
    if (window.matchMedia("(pointer: coarse)").matches) {
      root.style.setProperty("--standalone-home", "34px");
    }
    return;
  }
  root.classList.remove("is-standalone");
  root.style.removeProperty("--app-height");
  root.style.removeProperty("--standalone-home");
}

// Runs before paint so the first frame is already 100vh on an iPhone home-screen app.
export const COVER_SCRIPT =
  '(()=>{const s=navigator.standalone===true||matchMedia("(display-mode: standalone)").matches||matchMedia("(display-mode: fullscreen)").matches;if(!s)return;const r=document.documentElement;r.classList.add("is-standalone");r.style.setProperty("--app-height","100vh");if(matchMedia("(pointer: coarse)").matches)r.style.setProperty("--standalone-home","34px")})()';

export { applyCoverViewport };
