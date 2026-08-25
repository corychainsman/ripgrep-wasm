import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const generated = await import("./wasm/ripgrep_wasm.js");
const bytes = await readFile(resolve(root, "wasm/ripgrep_wasm_bg.wasm"));

// Use the generated wasm-bindgen initializer with the generated binary. This
// deliberately does not import or exercise the browser app's JS fallback.
generated.initSync({ module: bytes });

assert.deepEqual(
  JSON.parse(generated.search("needle", new TextEncoder().encode("αβ needle"), false, false)),
  [{ start: 5, end: 11 }],
  "search reports UTF-8 byte offsets",
);

assert.throws(
  () => generated.search("[", new Uint8Array([110, 101, 101, 100, 108, 101]), false, false),
  /error|regex|unclosed|opening/i,
  "invalid patterns are surfaced as an exception",
);

assert.deepEqual(
  JSON.parse(generated.filter_paths(
    JSON.stringify(["src/lib.rs", "target/debug/app", "notes.log", "keep.log"]),
    "target/\n*.log\n!keep.log",
  )),
  ["src/lib.rs", "keep.log"],
  "ignore rules filter virtual paths and preserve negations",
);

assert.equal(typeof generated.search_files_json, "function");
const fileResponse = JSON.parse(generated.search_files_json(
  "needle",
  JSON.stringify([
    { path: "src/α.txt", content: Array.from(new TextEncoder().encode("α needle\nneedle\n")) },
    { path: "target/app", content: [110, 101, 101, 100, 108, 101, 0] },
  ]),
  JSON.stringify({
    case_insensitive: false,
    smart_case: false,
    multi_line: false,
    whole_word: false,
    whole_line: false,
    invert_match: false,
    literal: true,
    max_results: 1,
    binary: "skip",
  }),
));
assert.equal(fileResponse.matches.length, 1, "result limit is enforced");
assert.deepEqual(fileResponse.matches[0], {
  path: "src/α.txt",
  line_number: 1,
  byte_offset: 0,
  line: "α needle\n",
  line_is_lossy: false,
  ranges: [{ start: 3, end: 9 }],
}, "structured file match preserves path, line, and byte offsets");
assert.deepEqual(fileResponse.stats, {
  files_searched: 1,
  files_skipped: 0,
  bytes_searched: 17,
  matches: 1,
}, "structured file search reports deterministic statistics");
const binaryResponse = JSON.parse(generated.search_files_json(
  "needle",
  JSON.stringify([{ path: "target/app", content: [110, 101, 101, 100, 108, 101, 0] }]),
  JSON.stringify({
    case_insensitive: false,
    smart_case: false,
    multi_line: false,
    whole_word: false,
    whole_line: false,
    invert_match: false,
    literal: true,
    binary: "skip",
  }),
));
assert.equal(binaryResponse.files_skipped, 1, "binary skip option is honored");
assert.equal(binaryResponse.diagnostics[0].kind, "binary-skipped");
assert.equal(binaryResponse.diagnostics[0].path, "target/app");

console.log("WASM smoke tests passed");
