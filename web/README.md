# Browser lab

This is a dependency-free static site with three modes matching the existing
Rust examples: `simplegrep`, ignore-aware `walk`, and `search-stdin`. It expects
the wasm-bindgen package at `web/wasm/ripgrep_wasm.js` with this API:

```js
import init, { search } from "./wasm/ripgrep_wasm.js";
await init();
search(pattern, Uint8Array, caseInsensitive, multiLine)
// Returns a JSON string: [{"start": 12, "end": 16}]
filter_paths(JSON.stringify(paths), gitignorePatterns)
// Returns the included virtual paths as a JSON string.
```

The site intentionally passes file contents to WASM instead of attempting to
emulate a native filesystem. Build output is `web/dist`:

```sh
npm --prefix web run lint
npm --prefix web run test:wasm
npm --prefix web run build
python3 -m http.server --directory web/dist 4173
```

The browser adapter intentionally searches bytes supplied by the page. It does
not access the host filesystem, run the native CLI, use PCRE2, or preserve
native terminal output. The Walk demo uses browser file/directory selection and
applies the supplied gitignore-style patterns to relative paths. The UI limits
one search to 25 MiB to keep tab memory use predictable.

For local sub-path testing, serve the generated directory below a prefix (for
example, mount `web/dist` at `/ripgrep-demo/`). The site uses relative asset
URLs, so the same artifact works at a repository Pages URL and a custom domain.
If no WASM package is present, the static shell still builds and reports a
useful initialization error in the page; the Pages workflow builds the Rust
adapter into `web/wasm` before running the site build.
