import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const out = resolve(root, "dist");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(resolve(root, "index.html"), resolve(out, "index.html"));
await cp(resolve(root, "404.html"), resolve(out, "404.html"));
await cp(resolve(root, "styles.css"), resolve(out, "styles.css"));
await cp(resolve(root, "app.js"), resolve(out, "app.js"));

// The wasm-bindgen package is produced by the Rust adapter build. Keep the
// static site build useful before that package exists, while copying it when
// CI (or a local build) has generated it.
try {
  await cp(resolve(root, "wasm"), resolve(out, "wasm"), { recursive: true });
  console.log("Copied wasm package");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.warn("No web/wasm package found; the site will show a loader error.");
}

console.log(`Built ${out}`);
