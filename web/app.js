const $ = (selector) => document.querySelector(selector);
const els = {
  form: $("#search-form"), pattern: $("#pattern"), haystack: $("#haystack"), files: $("#files"),
  source: $("#source-wrap"), file: $("#file-wrap"), output: $("#output"), error: $("#error"),
  status: $("#runtime-status"), count: $("#result-count"), elapsed: $("#elapsed"),
  title: $("#demo-title"), kicker: $("#mode-kicker"), ignore: $("#ignore-patterns"),
  caseInsensitive: $("#case-insensitive"), multiLine: $("#multi-line"),
  searchButton: $("#search-button"), fileSummary: $("#file-summary"),
};
const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const encoder = new TextEncoder();

const modes = {
  grep: {
    kicker: "SIMPLEGREP", title: "Find a pattern in text", source: "text",
    pattern: "ripgrep|Rust|WebAssembly",
    text: "ripgrep is a line-oriented search tool.\nIt is written in Rust and built for speed.\nThis browser lab runs the same idea through WebAssembly.\nSearch locally: your text never leaves this tab.",
  },
  walk: {
    kicker: "IGNORE-AWARE WALK", title: "Search selected files", source: "files",
    pattern: "needle|WebAssembly",
  },
  stdin: {
    kicker: "SEARCH-STDIN", title: "Search a pasted stream", source: "text",
    pattern: "WARN|ERROR",
    text: "09:41:02 INFO  WebAssembly worker started\n09:41:03 WARN  Search index is warming up\n09:41:04 INFO  First query completed\n09:41:05 ERROR Sample timeout recovered locally",
  },
};
const sampleFiles = [
  { path: "README.md", contents: encoder.encode("# Browser search\nA needle appears in this bundled sample.\n") },
  { path: "src/search.rs", contents: encoder.encode("// WebAssembly keeps this search local.\nfn search() {}\n") },
  { path: "target/generated.js", contents: encoder.encode("const needle = 'ignored build output';\n") },
];
const modeState = Object.fromEntries(Object.entries(modes).map(([key, config]) => [key, {
  pattern: config.pattern,
  text: config.text ?? "",
  caseInsensitive: false,
  multiLine: false,
}]));
let mode = null;
let engine = null;

function showError(message = "") {
  els.error.hidden = !message;
  els.error.textContent = message;
}

function setMode(next) {
  if (modes[mode]) {
    modeState[mode] = {
      pattern: els.pattern.value,
      text: els.haystack.value,
      caseInsensitive: els.caseInsensitive.checked,
      multiLine: els.multiLine.checked,
    };
  }
  mode = next;
  const config = modes[next];
  const state = modeState[next];
  els.title.textContent = config.title;
  els.kicker.textContent = config.kicker;
  els.pattern.value = state.pattern;
  els.haystack.value = state.text;
  els.caseInsensitive.checked = state.caseInsensitive;
  els.multiLine.checked = state.multiLine;
  els.source.hidden = config.source !== "text";
  els.file.hidden = config.source !== "files";
  document.querySelectorAll(".mode").forEach((button) => {
    const active = button.dataset.mode === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  showError();
  els.output.textContent = "Running sample search…";
  els.count.textContent = engine ? "Searching…" : "Loading…";
  if (engine) queueMicrotask(() => els.form.requestSubmit());
}

async function loadEngine() {
  try {
    // wasm-bindgen's generated module exports its init function as default and
    // the byte-oriented search entry point as `search`.
    const wasm = await import("./wasm/ripgrep_wasm.js");
    await wasm.default();
    engine = wasm;
    els.status.textContent = "WASM engine ready";
    els.searchButton.disabled = false;
    els.form.requestSubmit();
  } catch (error) {
    els.status.textContent = "WASM engine unavailable";
    els.status.dataset.error = "true";
    showError("The WebAssembly package could not be loaded. Build the wasm package into web/wasm before serving this site.");
    console.warn(error);
  }
}

function normalizeResponse(value) {
  const response = typeof value === "string" ? JSON.parse(value) : value;
  if (Array.isArray(response)) return { matches: response };
  return response ?? { matches: [] };
}

function annotate(matches, input, path = "") {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return matches.map((match) => {
    let start = match.start;
    while (start > 0 && input[start - 1] !== 10) start -= 1;
    let end = match.end;
    while (end < input.length && input[end] !== 10) end += 1;
    let line = 1;
    for (let index = 0; index < start; index += 1) {
      if (input[index] === 10) line += 1;
    }
    return {
      ...match,
      path,
      line,
      text: decoder.decode(input.slice(start, end)).trimEnd(),
      before: decoder.decode(input.slice(start, match.start)),
      matched: decoder.decode(input.slice(match.start, match.end)),
      after: decoder.decode(input.slice(match.end, end)).trimEnd(),
    };
  });
}

async function runSearch(pattern, text, files) {
  if (!engine) throw new Error("The WebAssembly engine is not ready yet.");
  if (!pattern) throw new Error("Enter a pattern before searching.");
  if (typeof engine.search !== "function") throw new Error("This WASM package does not export search.");
  const searchOne = (input) => normalizeResponse(engine.search(
    pattern, input, els.caseInsensitive.checked, els.multiLine.checked,
  )).matches ?? [];
  if (mode === "walk") {
    if (typeof engine.filter_paths !== "function") throw new Error("This WASM package does not export ignore filtering.");
    const paths = files.map((file) => file.path);
    const kept = new Set(JSON.parse(engine.filter_paths(JSON.stringify(paths), els.ignore.value)));
    const matches = files
      .filter((file) => kept.has(file.path))
      .flatMap((file) => annotate(searchOne(file.contents), file.contents, file.path));
    return { matches };
  }
  const input = encoder.encode(text);
  return { matches: annotate(searchOne(input), input) };
}

function renderMatches(response) {
  const matches = response.matches ?? response.results ?? [];
  els.output.replaceChildren();
  if (!matches.length) {
    els.output.textContent = "No matches.";
    return 0;
  }
  const fragment = document.createDocumentFragment();
  matches.forEach((match, index) => {
    if (index) fragment.append("\n");
    if (typeof match === "string") {
      fragment.append(match);
      return;
    }
    const file = match.path ? `${match.path}:` : "";
    const line = match.line ?? match.line_number ?? "?";
    const text = match.text ?? match.line_text ?? match.content ?? "";
    fragment.append(`${file}${line}: `);
    if (typeof match.matched !== "string") {
      fragment.append(text);
      return;
    }
    fragment.append(match.before);
    const highlight = document.createElement("mark");
    highlight.textContent = match.matched || " ";
    highlight.setAttribute("aria-label", `match: ${match.matched || "empty expression"}`);
    fragment.append(highlight, match.after);
  });
  els.output.append(fragment);
  return matches.length;
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError();
  els.count.textContent = "Searching…";
  const started = performance.now();
  try {
    const selectedFiles = mode === "walk" ? await Promise.all([...els.files.files].map(async (file) => ({ path: file.webkitRelativePath || file.name, contents: new Uint8Array(await file.arrayBuffer()) }))) : [];
    const files = mode === "walk" && !selectedFiles.length ? sampleFiles : selectedFiles;
    const totalBytes = files.reduce((total, file) => total + file.contents.byteLength, 0);
    if (totalBytes > MAX_INPUT_BYTES) throw new Error("Selected input is larger than 25 MiB. Select fewer or smaller files.");
    const count = renderMatches(await runSearch(els.pattern.value, els.haystack.value, files));
    els.count.textContent = `${count} match${count === 1 ? "" : "es"}`;
    els.elapsed.textContent = `${Math.round(performance.now() - started)} ms`;
  } catch (error) {
    els.count.textContent = "Error";
    showError(error instanceof Error ? error.message : String(error));
  }
});

document.querySelectorAll(".mode").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
els.files.addEventListener("change", () => {
  const files = [...els.files.files];
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  els.fileSummary.textContent = files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected · ${(totalBytes / 1024).toFixed(0)} KiB` : "Using 3 bundled sample files.";
});
document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") els.form.requestSubmit(); });
setMode("grep");
loadEngine();
