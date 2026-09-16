// The Go backend embeds its own copies of campus.json and the app icon because go:embed cannot read outside its package.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { APP_DIR, CAMPUS_FILE, readCampus } from "./lib/campus.mjs";

readCampus();
const target = join(APP_DIR, "..", "backend", "bkapp", "internal", "campus", "campus.json");

if (!existsSync(join(target, ".."))) {
  console.log("No backend folder found next to app, skipping backend sync.");
} else {
  copyFileSync(CAMPUS_FILE, target);
  console.log("Copied campus.json to backend/bkapp/internal/campus/campus.json");

  // Emails attach the app icon, so the backend keeps a copy made by npm run campus:icons.
  const logo = join(APP_DIR, "public", "icons", "icon-192.png");
  const logoTarget = join(APP_DIR, "..", "backend", "bkapp", "internal", "email", "assets", "logo.png");
  if (existsSync(logo)) {
    mkdirSync(join(logoTarget, ".."), { recursive: true });
    copyFileSync(logo, logoTarget);
    console.log("Copied the app icon to backend/bkapp/internal/email/assets/logo.png");
  }
}
