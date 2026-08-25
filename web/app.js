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

const modes = {
  grep: { kicker: "SIMPLEGREP", title: "Find a pattern in text", source: "text" },
  walk: { kicker: "IGNORE-AWARE WALK", title: "Search selected files", source: "files" },
  stdin: { kicker: "SEARCH-STDIN", title: "Search a pasted stream", source: "text" },
};
let mode = "grep";
let engine = null;

function showError(message = "") {
  els.error.hidden = !message;
  els.error.textContent = message;
}

function setMode(next) {
  mode = next;
  const config = modes[next];
  els.title.textContent = config.title;
  els.kicker.textContent = config.kicker;
  els.source.hidden = config.source !== "text";
  els.file.hidden = config.source !== "files";
  document.querySelectorAll(".mode").forEach((button) => {
    const active = button.dataset.mode === next;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  showError();
  els.output.textContent = config.source === "files" ? "Choose one or more files and search to see results." : "Enter a pattern and search to see results.";
  els.count.textContent = "Ready";
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
    return { ...match, path, line, text: decoder.decode(input.slice(start, end)).trimEnd() };
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
  const input = new TextEncoder().encode(text);
  return { matches: annotate(searchOne(input), input) };
}

function formatMatches(response) {
  const matches = response.matches ?? response.results ?? [];
  if (!matches.length) return { text: "No matches.", count: 0 };
  const lines = matches.map((match) => {
    if (typeof match === "string") return match;
    const file = match.path ? `${match.path}:` : "";
    const line = match.line ?? match.line_number ?? "?";
    const text = match.text ?? match.line_text ?? match.content ?? "";
    return `${file}${line}: ${text}`;
  });
  return { text: lines.join("\n"), count: matches.length };
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError();
  els.count.textContent = "Searching…";
  const started = performance.now();
  try {
    const files = mode === "walk" ? await Promise.all([...els.files.files].map(async (file) => ({ path: file.webkitRelativePath || file.name, contents: new Uint8Array(await file.arrayBuffer()) }))) : [];
    const totalBytes = files.reduce((total, file) => total + file.contents.byteLength, 0);
    if (totalBytes > MAX_INPUT_BYTES) throw new Error("Selected input is larger than 25 MiB. Select fewer or smaller files.");
    if (mode === "walk" && !files.length) throw new Error("Choose at least one file or directory first.");
    const result = formatMatches(await runSearch(els.pattern.value, els.haystack.value, files));
    els.output.textContent = result.text;
    els.count.textContent = `${result.count} match${result.count === 1 ? "" : "es"}`;
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
  els.fileSummary.textContent = files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected · ${(totalBytes / 1024).toFixed(0)} KiB` : "No files selected.";
});
document.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") els.form.requestSubmit(); });
setMode(mode);
loadEngine();
