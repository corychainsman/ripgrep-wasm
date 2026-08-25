# Browser demo mapping

The static browser lab rebuilds every Rust example shipped by this workspace.
All matching runs in the generated `ripgrep_wasm_bg.wasm`; there is no
JavaScript search fallback and selected content never leaves the tab.

| Native example | Browser mode | Preserved behavior |
| --- | --- | --- |
| `crates/grep/examples/simplegrep.rs` | Simple grep | Compile a ripgrep regex and report matching text with line numbers. Browser input replaces native paths. |
| `crates/ignore/examples/walk.rs` | Walk files | Enumerate user-selected virtual paths, apply ordered gitignore-style rules, and search only included files. Browser selection replaces native walking and permissions. |
| `crates/searcher/examples/search-stdin.rs` | Search stdin | Search pasted bytes and report line-numbered results. The textarea replaces process stdin. |

The adapter also exposes `search_files_json` for callers needing deterministic
multi-file results, literal/smart-case/whole-word/whole-line/invert options,
binary policy, result limits, lossy-text indicators, diagnostics, and aggregate
statistics. Native-only process execution, terminal rendering, mmap, symlinks,
PCRE2/JIT, and unrestricted filesystem access are deliberately outside the
browser contract.

## Build and deployment contract

The `ripgrep-wasm` workspace crate compiles for `wasm32-unknown-unknown` and
`wasm-bindgen` emits the ES module package consumed by `web/app.js`. The Pages
workflow:

1. Installs pinned Rust 1.96.0, Node, Chromium, and locked dependencies.
2. Builds release WASM and generates `web/wasm`.
3. Runs generated-WASM API tests and four production-site Chromium tests.
4. Builds the dependency-light static artifact in `web/dist`.
5. Uploads and deploys that artifact with GitHub's official Pages actions and
   least-privilege deployment permissions.

All asset references are relative so the same artifact works at a repository
sub-path or custom domain. A missing WASM module produces an explicit visible
initialization error instead of silently switching engines.

## Verification coverage

- Full native workspace tests, PCRE2 tests, and unstable-index tests.
- `wasm32-wasip1` CLI build and artifact assertion.
- `wasm32-unknown-unknown` debug/release adapter builds.
- Generated-WASM tests for Unicode byte offsets, structured multi-file output,
  binary diagnostics/statistics, invalid patterns, ignore negation, and limits.
- Chromium tests for simple grep, malformed patterns, ignore-aware files, and
  multiline stdin behavior.
- Locked, reproducible static production build and live Pages deployment.
