import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

// The voice model runs on ONNX Runtime compiled to WebAssembly. transformers.js would fetch it from a
// CDN at runtime; serving the exact copy from node_modules keeps third party code out of the page.
const require = createRequire(import.meta.url);
const distDir = dirname(require.resolve("@huggingface/transformers"));
const outDir = join(import.meta.dirname, "..", "public", "ort");

mkdirSync(outDir, { recursive: true });
for (const file of ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"]) {
  copyFileSync(join(distDir, file), join(outDir, file));
}
