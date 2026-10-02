function isStandaloneApp() {
  return (
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)) ||
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches
  );
}

function applyColorScheme() {
  const root = document.documentElement;
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

function applyCoverViewport() {
  applyColorScheme();
  const root = document.documentElement;
  if (isStandaloneApp()) {
    root.classList.add("is-standalone");
    // WebKit bug 254868: innerHeight / 100dvh / visualViewport omit the home indicator in an installed app.
    root.style.setProperty("--app-height", "100vh");
    // Standalone iOS often reports a 0px bottom inset on a cold launch; 34px is the home bar.
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
