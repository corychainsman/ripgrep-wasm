# ripgrep WebAssembly port plan

This plan treats the upstream ripgrep 15.2.0 source tree as the native
reference implementation. The browser port reuses ripgrep's matcher and
searcher crates, but replaces process, terminal, and filesystem boundaries
with explicit in-memory data supplied by JavaScript.

## Success criteria

The port is complete only when all of the following are true:

1. The existing native workspace builds and every existing native test passes.
2. A browser-targeted Rust crate builds for `wasm32-unknown-unknown` without
   PCRE2, OS process, terminal, mmap, or native filesystem dependencies.
3. The JavaScript API returns stable structured matches, diagnostics, and
   statistics for text and uploaded byte content, including Unicode, invalid
   patterns, empty input, and configured binary handling.
4. Browser tests execute the generated WebAssembly, not a JavaScript fallback.
5. The existing `simplegrep`, `ignore/walk`, and `search-stdin` examples each
   have a discoverable browser demo preserving the example's useful behavior.
6. A production build is entirely static, works below an arbitrary repository
   sub-path, and is deployed through GitHub Pages with least-privilege jobs.
7. CI proves native tests, WASI portability, browser-WASM compilation/tests,
   web tests, and the production site build on every relevant change.

## Architecture and compatibility decisions

- Keep upstream crates and native behavior intact. Add a leaf `ripgrep-wasm`
  adapter crate instead of putting `wasm-bindgen` types into core crates.
- Use `grep-regex` and `grep-searcher` as the execution engine. PCRE2/JIT is a
  native-only optional backend and is not promised by the browser API.
- Search uploaded/pasted bytes in memory. Browser-selected directories are
  enumerated by JavaScript and passed as a deterministic virtual file list;
  WebAssembly does not impersonate a POSIX filesystem.
- Represent matches with file name, complete matching line bytes/text, 1-based
  line number, absolute byte offset, and match sub-ranges. Byte offsets always
  index the original byte input; lossy display text never changes offsets.
- Implement ignore filtering over virtual paths with the existing `ignore` or
  `globset` semantics where possible. Browser directory traversal, permission
  prompts, and symlinks remain host concerns.
- Make output ordering deterministic by preserving input-file order and
  ascending match offsets. Do not introduce threads in the browser module.
- Keep the public JavaScript boundary small and versionable. Convert errors to
  structured diagnostics; malformed patterns must never panic across WASM.

## Phase 1: baseline and guardrails

- Record upstream revision, Rust MSRV/pinned version, workspace packages,
  examples, features, and existing CI matrix.
- Run `cargo test --workspace` and retain its result as the native baseline.
- Compile the native `rg` binary for `wasm32-wasip1` as a portability smoke
  test with an explicit target flag.
- Document browser exclusions: process execution/decompression helpers,
  terminal detection/color, signals, memory mapping, native paths, PCRE2 JIT,
  shell completion, configuration discovery, and unrestricted OS walking.

## Phase 2: portable Rust API

- Add the adapter crate to the workspace with `cdylib` and `rlib` outputs.
- Define serializable request/options/file/match/diagnostic/statistics types.
- Implement single-haystack search through ripgrep's matcher/searcher APIs.
- Add multi-file search with deterministic ordering and a match/result limit.
- Support regex, literal mode, case sensitive/insensitive/smart case,
  whole-word, whole-line, multiline, invert-match, and binary policy where the
  underlying portable crates support them.
- Preserve raw bytes internally. Clearly encode non-UTF-8 display values and
  expose whether conversion was lossy.
- Catch configuration/search errors and return actionable stable error data.
- Export a wasm-bindgen API and TypeScript declarations suitable for bundlers
  and direct ES-module loading.

## Phase 3: Rust and WASM tests

- Unit-test defaults, option mapping, literal/regex behavior, smart case,
  Unicode, CRLF, empty pattern/input, multiline, binary/NUL input, result
  limits, invalid regexes, byte offsets, and deterministic multi-file order.
- Add parity fixtures that execute the same in-memory cases natively and in a
  browser-WASM runner and compare normalized structured results.
- Add browser smoke tests for module initialization, successful search,
  structured error propagation, and repeated invocation.
- Compile the adapter for `wasm32-unknown-unknown` in debug and release modes.
- Keep the broader native suite unchanged and green, including optional PCRE2
  and unstable-index jobs where the upstream matrix already exercises them.

## Phase 4: web application and all demos

- Build a static, dependency-light site with shared navigation, status/error
  regions, accessible labels, keyboard operation, responsive layout, and a
  visible indication that matching runs in ripgrep WebAssembly.
- Rebuild `simplegrep` as a virtual-file search: pattern/options plus dropped,
  selected, or sample files; render file-grouped matches and byte/line data.
- Rebuild `ignore/examples/walk` as a directory/file picker: enumerate browser
  handles or `webkitdirectory` files, normalize relative paths, accept ignore
  patterns, preview included/excluded paths, and search the included files.
- Rebuild `searcher/examples/search-stdin` as pasted/uploaded byte input with
  line-numbered results and downloadable/copyable structured output.
- Add loading, empty, no-match, invalid-pattern, permission-denied,
  unsupported-picker, oversized-input, and WASM-initialization states.
- Avoid a JS search fallback: failure to load WASM must be visible and tested.

## Phase 5: web tests and quality gates

- Unit-test virtual path normalization, ignore selection, file reading,
  rendering-safe escaping, option serialization, and sub-path URL handling.
- Run integration tests against the generated wasm-bindgen package.
- Run an end-to-end browser smoke test from a production static server under a
  non-root base path and exercise all three demo modes.
- Check keyboard navigation, labels, contrast, responsive narrow/wide layouts,
  uncaught console errors, missing network resources, and WebAssembly MIME
  loading.
- Enforce formatting, linting/type checking, locked dependency installation,
  and reproducible production output.

## Phase 6: GitHub Pages delivery

- Add a build job that installs pinned Rust, the browser target, wasm tooling,
  and locked Node dependencies; builds the release WASM package and site; then
  uploads only the static output.
- Run build-only validation for pull requests. Deploy only trusted pushes to
  the default branch using `actions/configure-pages`, `upload-pages-artifact`,
  and `deploy-pages`.
- Grant `contents: read` to build and only `pages: write` plus `id-token: write`
  to deploy. Add deployment concurrency without cancelling an active deploy.
- Generate relative/sub-path-safe asset references and a useful `404.html`.
- Document repository Pages settings, local development, production build,
  API usage, browser support, limitations, and troubleshooting.

## Completion evidence

Before declaring completion, capture and inspect all of this evidence:

- Clean results from native workspace tests, formatting, and documentation.
- Clean WASI build and browser adapter debug/release builds.
- Passing Rust adapter tests and real browser-WASM integration tests.
- Passing web unit/type/lint tests and all-demo end-to-end browser run.
- Production artifact inventory proving HTML, JavaScript, and `.wasm` assets
  load from a simulated repository sub-path without console/network failures.
- Valid workflow syntax and a successful GitHub Pages deployment run/URL once
  the repository is hosted with Pages enabled.
