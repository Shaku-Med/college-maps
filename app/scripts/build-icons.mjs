// Turns campus/icon.svg (and the optional campus/og-icon.svg) into every icon format the app ships.
// Needs ffmpeg and Chrome, Edge, or Chromium. Run it again whenever an icon changes, then commit public/icons and public/favicon.ico.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { APP_DIR } from "./lib/campus.mjs";

const ICON = join(APP_DIR, "campus", "icon.svg");
const SHARE_ICON = join(APP_DIR, "campus", "og-icon.svg");
const OUT = join(APP_DIR, "public", "icons");
const MASTER = 1024;
// About 22% of the edge, close to the corner curve Apple and Android use for app icons.
const CORNER_RATIO = 0.225;
// Android masks can crop anything outside the center 80%, so the maskable icon shrinks the artwork to fit.
const MASKABLE_SCALE = 0.78;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    fail(`${command} failed: ${result.error?.message ?? result.stderr?.slice(-400)}`);
  }
}

function findBrowser() {
  const candidates = [
    process.env.ICON_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path));
}

function readSvg(path) {
  const svg = readFileSync(path, "utf8");
  if (svg.length > 200_000 || !/^\s*<svg[\s>]/.test(svg) || /<script|<foreignObject|href\s*=\s*["']https?:/i.test(svg)) {
    fail(`${path} must be a self-contained SVG under 200 KB with no scripts or external links`);
  }
  return svg;
}

// The first full-size rect is the icon background, reused behind the shrunken maskable artwork.
function backgroundOf(svg) {
  return /<rect[^>]*width="(?:512|100%)"[^>]*fill="(#[0-9a-fA-F]{3,8})"/.exec(svg)?.[1] ?? "#ffffff";
}

function roundedSvg(svg) {
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 512 512";
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  const inner = svg.replace(/^\s*<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const radius = Math.round(Math.min(width, height) * CORNER_RATIO);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <defs><clipPath id="app-icon-corners"><rect width="${width}" height="${height}" rx="${radius}"/></clipPath></defs>
  <g clip-path="url(#app-icon-corners)">${inner}</g>
</svg>
`;
}

// ICO files may hold PNG images directly, which every current browser reads.
function writeIco(target, pngPaths) {
  const images = pngPaths.map(({ size, path }) => ({ size, data: readFileSync(path) }));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  writeFileSync(target, Buffer.concat([header, ...images.map(({ data }) => data)]));
}

const browser = findBrowser();
if (!browser) fail("Could not find Chrome, Edge, or Chromium. Set ICON_BROWSER to its executable path.");
if (spawnSync("ffmpeg", ["-version"]).status !== 0) fail("ffmpeg is not on your PATH. Install it from ffmpeg.org.");

const work = mkdtempSync(join(tmpdir(), "campus-icons-"));

function rasterize(svg, name, { scale = 1, background = "transparent" } = {}) {
  const page = join(work, `${name}.html`);
  const art = Math.round(MASTER * scale);
  writeFileSync(
    page,
    `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:${background}}body{width:${MASTER}px;height:${MASTER}px;display:flex;align-items:center;justify-content:center}svg{display:block;width:${art}px;height:${art}px}</style></head><body>${svg}</body></html>`,
  );
  const target = join(work, `${name}.png`);
  run(browser, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    `--window-size=${MASTER},${MASTER}`,
    `--screenshot=${target}`,
    pathToFileURL(page).href,
  ]);
  return target;
}

function roundCorners(source, name) {
  const radius = Math.round(MASTER * CORNER_RATIO);
  const half = MASTER / 2;
  const inner = half - radius;
  const target = join(work, `${name}.png`);
  const alpha = `clip(255*(${radius}.5-hypot(max(abs(X+0.5-${half})-${inner},0),max(abs(Y+0.5-${half})-${inner},0))),0,255)`;
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vf", `format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'`, target]);
  return target;
}

function resize(source, size, name, extra = []) {
  const target = join(OUT, name);
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vf", `scale=${size}:${size}:flags=lanczos`, ...extra, target]);
  return target;
}

try {
  const icon = readSvg(ICON);
  const square = rasterize(icon, "square");
  const rounded = roundCorners(square, "rounded");
  const maskable = rasterize(icon, "maskable", { scale: MASKABLE_SCALE, background: backgroundOf(icon) });

  mkdirSync(OUT, { recursive: true });
  const favicons = [16, 32, 48].map((size) => ({ size, path: resize(rounded, size, `favicon-${size}.png`) }));
  resize(rounded, 192, "icon-192.png");
  resize(rounded, 512, "icon-512.png");
  resize(rounded, 512, "icon-512.webp", ["-c:v", "libwebp", "-quality", "92"]);
  resize(maskable, 192, "maskable-192.png");
  resize(maskable, 512, "maskable-512.png");
  resize(square, 180, "apple-touch-icon.png");
  writeFileSync(join(OUT, "icon.svg"), roundedSvg(icon));
  writeIco(join(APP_DIR, "public", "favicon.ico"), favicons);

  // The share image can carry extra branding, like a wordmark that would be unreadable at favicon size.
  const shareSource = existsSync(SHARE_ICON) ? roundCorners(rasterize(readSvg(SHARE_ICON), "share"), "share-rounded") : rounded;
  resize(shareSource, 512, "og-icon.png");

  const version = createHash("sha256")
    .update(readFileSync(join(APP_DIR, "public", "favicon.ico")))
    .update(readFileSync(join(OUT, "icon-512.png")))
    .update(readFileSync(join(OUT, "icon.svg")))
    .digest("hex")
    .slice(0, 10);
  writeFileSync(join(APP_DIR, "src", "data", "icon-version.json"), JSON.stringify({ version }, null, 2) + "\n");

  console.log(`Wrote public/favicon.ico and public/icons (svg, png, webp, maskable, apple touch, share icon). Version ${version}.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
