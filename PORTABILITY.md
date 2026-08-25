# ripgrep-to-WASM portability plan

This repository tracks the upstream ripgrep source tree. The following
checklist describes the portable boundary required by the browser adapter;
`WASM_PORT_PLAN.md` contains the full implementation and verification plan.

## Core boundary

Keep the search engine as a pure library function over an explicit input tree:

```text
SearchRequest { patterns, options, files }
  -> SearchResponse { matches, diagnostics, stats }
```

`files` should contain UTF-8 names and byte contents (or an adapter-owned
reader trait). The core must not access the process environment, current
directory, command line, stdin/stdout, clocks, threads, signals, or a native
filesystem. Return diagnostics as data so each host can render them.

## API and build layout

* Put the portable implementation in a library crate (`src/lib.rs`), with a
  thin native CLI in a separate binary or feature-gated module.
* Keep `wasm-bindgen`, browser APIs, and JavaScript types out of the core API;
  expose a small `wasm` adapter crate/feature that performs serialization.
* Prefer `std` data structures that compile to `wasm32-unknown-unknown`; avoid
  platform-dependent crates unless they are optional and disabled for WASM.
* Make all configuration explicit and deterministic. Do not use `env!`,
  `option_env!`, `std::env`, `SystemTime`, or locale-dependent formatting.

## Native-only features to isolate

The following ripgrep concerns need host adapters or feature gates: directory
walking and symlink metadata (`std::fs`, `walkdir`), mmap, file descriptors,
stdin/stdout/stderr, process spawning, shell/glob expansion, terminal color and
TTY detection, signals, parallel worker pools, regex JIT/backends requiring
OS support, and native path encoding. In WASM, receive a pre-built file list;
define an explicit policy for symlinks, hidden files, binary files, and invalid
UTF-8 rather than inheriting OS behavior.

## Required tests

1. Unit tests for literal, regex, case-insensitive, multiline, binary, empty,
   and invalid UTF-8 inputs.
2. Determinism tests: identical requests produce byte-identical responses and
   stable ordering regardless of host.
3. Property tests for offsets (every reported span indexes the original bytes)
   and malformed patterns (no panic).
4. Native and `wasm32-unknown-unknown` compilation checks in CI.
5. A small wasm-bindgen smoke test that invokes the public adapter without
   filesystem, process, or browser-global access.

## Implementation sequence

1. Add workspace/library manifests with optional `cli` and `wasm` features.
2. Define request/response/error types and document byte-offset semantics.
3. Implement an in-memory search core and deterministic result ordering.
4. Add the native filesystem/CLI adapter behind `cli`.
5. Add the WASM serialization adapter and compile/test matrix.
6. Add fuzz/property tests and benchmark representative files.
