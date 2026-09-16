import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const distDir = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");
const outDir = join(import.meta.dirname, "..", "public", "maplibre");

mkdirSync(outDir, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(distDir, file), join(outDir, file));
}
