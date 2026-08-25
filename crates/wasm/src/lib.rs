//! Browser-safe, in-memory search built on ripgrep's regex matcher.
//!
//! This crate deliberately does not walk a filesystem, inspect process state,
//! or use threads. Match offsets are byte offsets into the supplied input.

use globset::{GlobBuilder, GlobMatcher};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use serde::Deserialize;
use serde::Serialize;
use wasm_bindgen::prelude::*;

/// Configuration for an in-memory search.
#[derive(Clone, Copy, Debug, Default)]
pub struct SearchOptions {
    /// Match letters without regard to case.
    pub case_insensitive: bool,
    /// Make `^` and `$` match line boundaries.
    pub multi_line: bool,
}

/// A byte range containing one non-overlapping match.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct MatchRange {
    /// Inclusive start byte offset.
    pub start: usize,
    /// Exclusive end byte offset.
    pub end: usize,
}

/// Options accepted by the multi-file API. All offsets remain byte offsets.
#[derive(Clone, Debug, Deserialize)]
pub struct FileSearchOptions {
    pub case_insensitive: bool,
    pub smart_case: bool,
    pub multi_line: bool,
    pub whole_word: bool,
    pub whole_line: bool,
    pub invert_match: bool,
    pub literal: bool,
    pub max_results: Option<usize>,
    /// `skip` omits files containing NUL bytes; `text` searches them normally.
    #[serde(default = "default_binary_policy")]
    pub binary: String,
}

fn default_binary_policy() -> String {
    "text".to_string()
}

impl Default for FileSearchOptions {
    fn default() -> FileSearchOptions {
        FileSearchOptions {
            case_insensitive: false,
            smart_case: false,
            multi_line: false,
            whole_word: false,
            whole_line: false,
            invert_match: false,
            literal: false,
            max_results: None,
            binary: default_binary_policy(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct VirtualFile {
    pub path: String,
    pub content: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct FileMatch {
    pub path: String,
    pub line_number: usize,
    pub byte_offset: usize,
    pub line: String,
    pub line_is_lossy: bool,
    pub ranges: Vec<MatchRange>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FileSearchResponse {
    pub matches: Vec<FileMatch>,
    pub files_skipped: usize,
    pub diagnostics: Vec<SearchDiagnostic>,
    pub stats: SearchStats,
}

/// A non-fatal condition encountered while searching virtual files.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct SearchDiagnostic {
    pub path: String,
    pub kind: String,
    pub message: String,
}

/// Deterministic aggregate counters for one multi-file search.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct SearchStats {
    pub files_searched: usize,
    pub files_skipped: usize,
    pub bytes_searched: usize,
    pub matches: usize,
}

/// Search a deterministic, ordered virtual file list. This is the portable
/// boundary used by browser directory pickers; it performs no I/O itself.
pub fn search_files(
    pattern: &str,
    files: &[VirtualFile],
    options: &FileSearchOptions,
) -> Result<FileSearchResponse, String> {
    if !matches!(options.binary.as_str(), "text" | "skip") {
        return Err(format!(
            "invalid binary policy {:?}; expected \"text\" or \"skip\"",
            options.binary
        ));
    }
    let mut builder = RegexMatcherBuilder::new();
    builder
        .case_insensitive(options.case_insensitive)
        .case_smart(options.smart_case)
        .multi_line(options.multi_line)
        .word(options.whole_word)
        .whole_line(options.whole_line);
    let compiled_pattern = if options.literal {
        escape_literal(pattern)
    } else {
        pattern.to_string()
    };
    let matcher =
        builder.build(&compiled_pattern).map_err(|err| err.to_string())?;
    let mut out = vec![];
    let mut skipped = 0;
    let mut files_searched = 0;
    let mut bytes_searched = 0;
    let mut diagnostics = vec![];
    for file in files {
        if options.binary == "skip" && file.content.contains(&0) {
            skipped += 1;
            diagnostics.push(SearchDiagnostic {
                path: file.path.clone(),
                kind: "binary-skipped".to_string(),
                message: "file contains a NUL byte and binary policy is skip"
                    .to_string(),
            });
            continue;
        }
        files_searched += 1;
        bytes_searched += file.content.len();
        let mut ranges = vec![];
        matcher
            .find_iter(&file.content, |m| {
                ranges.push(MatchRange { start: m.start(), end: m.end() });
                options
                    .max_results
                    .map_or(true, |limit| out.len() + ranges.len() <= limit)
            })
            .map_err(|err| err.to_string())?;
        if options.invert_match {
            let mut offset = 0;
            for (line_no, line) in
                file.content.split_inclusive(|&b| b == b'\n').enumerate()
            {
                let end = offset + line.len();
                let hit =
                    ranges.iter().any(|m| m.start < end && m.end > offset);
                if !hit {
                    if options
                        .max_results
                        .is_some_and(|limit| out.len() >= limit)
                    {
                        break;
                    }
                    out.push(make_file_match(
                        file,
                        line_no + 1,
                        offset,
                        line,
                        vec![],
                    ));
                }
                offset = end;
            }
        } else {
            for m in ranges {
                if options.max_results.is_some_and(|limit| out.len() >= limit)
                {
                    break;
                }
                let line_start = file.content[..m.start]
                    .iter()
                    .rposition(|&b| b == b'\n')
                    .map_or(0, |p| p + 1);
                let line_end = file.content[m.end..]
                    .iter()
                    .position(|&b| b == b'\n')
                    .map_or(file.content.len(), |p| m.end + p + 1);
                out.push(make_file_match(
                    file,
                    file.content[..line_start]
                        .iter()
                        .filter(|&&b| b == b'\n')
                        .count()
                        + 1,
                    line_start,
                    &file.content[line_start..line_end],
                    vec![m],
                ));
            }
        }
        if options.max_results.is_some_and(|limit| out.len() >= limit) {
            break;
        }
    }
    let match_count = out.len();
    Ok(FileSearchResponse {
        matches: out,
        files_skipped: skipped,
        diagnostics,
        stats: SearchStats {
            files_searched,
            files_skipped: skipped,
            bytes_searched,
            matches: match_count,
        },
    })
}

fn escape_literal(pattern: &str) -> String {
    let mut escaped = String::with_capacity(pattern.len());
    for ch in pattern.chars() {
        if matches!(
            ch,
            '.' | '^'
                | '$'
                | '*'
                | '+'
                | '?'
                | '('
                | ')'
                | '['
                | ']'
                | '{'
                | '}'
                | '|'
                | '\\'
        ) {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn make_file_match(
    file: &VirtualFile,
    line_number: usize,
    byte_offset: usize,
    line: &[u8],
    ranges: Vec<MatchRange>,
) -> FileMatch {
    let text = String::from_utf8_lossy(line);
    FileMatch {
        path: file.path.clone(),
        line_number,
        byte_offset,
        line: text.to_string(),
        line_is_lossy: std::str::from_utf8(line).is_err(),
        ranges,
    }
}

/// Search virtual files encoded as JSON (`[{"path":"...","content":[...]},...]`).
#[wasm_bindgen]
pub fn search_files_json(
    pattern: &str,
    files_json: &str,
    options_json: &str,
) -> Result<String, JsValue> {
    let files: Vec<VirtualFile> = serde_json::from_str(files_json)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let options: FileSearchOptions = serde_json::from_str(options_json)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_json::to_string(
        &search_files(pattern, &files, &options)
            .map_err(|e| JsValue::from_str(&e))?,
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Search bytes in memory and return all non-overlapping matches.
pub fn search_bytes(
    pattern: &str,
    input: &[u8],
    options: SearchOptions,
) -> Result<Vec<MatchRange>, String> {
    let mut builder = RegexMatcherBuilder::new();
    builder
        .case_insensitive(options.case_insensitive)
        .multi_line(options.multi_line);
    let matcher = builder.build(pattern).map_err(|err| err.to_string())?;
    let mut matches = vec![];
    matcher
        .find_iter(input, |m| {
            matches.push(MatchRange { start: m.start(), end: m.end() });
            true
        })
        .map_err(|err| err.to_string())?;
    Ok(matches)
}

/// Search a byte array from JavaScript and return match ranges as JSON.
///
/// The JSON result is an array of `{start, end}` objects. Invalid patterns are
/// returned as a rejected JavaScript error rather than causing a panic.
#[wasm_bindgen]
pub fn search(
    pattern: &str,
    input: &[u8],
    case_insensitive: bool,
    multi_line: bool,
) -> Result<String, JsValue> {
    let matches = search_bytes(
        pattern,
        input,
        SearchOptions { case_insensitive, multi_line },
    )
    .map_err(|err| JsValue::from_str(&err))?;
    serde_json::to_string(&matches)
        .map_err(|err| JsValue::from_str(&err.to_string()))
}

/// Filter virtual file paths with line-oriented gitignore syntax.
///
/// `paths_json` must be a JSON array of relative UTF-8 paths. The returned
/// array preserves input order. Browser directory enumeration remains a host
/// responsibility; this function provides ripgrep's ignore semantics.
#[wasm_bindgen]
pub fn filter_paths(
    paths_json: &str,
    ignore_patterns: &str,
) -> Result<String, JsValue> {
    let paths: Vec<String> = serde_json::from_str(paths_json)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let matchers = compile_ignore_patterns(ignore_patterns)
        .map_err(|err| JsValue::from_str(&err))?;
    let kept: Vec<&str> = paths
        .iter()
        .filter(|path| !is_ignored(path, &matchers))
        .map(String::as_str)
        .collect();
    serde_json::to_string(&kept)
        .map_err(|err| JsValue::from_str(&err.to_string()))
}

fn compile_ignore_patterns(
    patterns: &str,
) -> Result<Vec<(GlobMatcher, bool)>, String> {
    let mut matchers = vec![];
    for original in patterns.lines() {
        let mut pattern = original.trim_end();
        if pattern.is_empty() || pattern.starts_with('#') {
            continue;
        }
        let is_ignore = !pattern.starts_with('!');
        if !is_ignore {
            pattern = &pattern[1..];
        }
        let anchored = pattern.starts_with('/');
        if anchored {
            pattern = &pattern[1..];
        }
        let directory = pattern.ends_with('/');
        if directory {
            pattern = &pattern[..pattern.len() - 1];
        }
        if pattern.is_empty() {
            continue;
        }
        let mut actual = if !anchored && !pattern.contains('/') {
            format!("**/{pattern}")
        } else {
            pattern.to_string()
        };
        if directory {
            actual.push_str("/**");
        }
        let matcher = GlobBuilder::new(&actual)
            .literal_separator(true)
            .backslash_escape(true)
            .build()
            .map_err(|err| err.to_string())?
            .compile_matcher();
        matchers.push((matcher, is_ignore));
    }
    Ok(matchers)
}

fn is_ignored(path: &str, matchers: &[(GlobMatcher, bool)]) -> bool {
    let mut ignored = false;
    for &(ref matcher, is_ignore) in matchers {
        if matcher.is_match(path) {
            ignored = is_ignore;
        }
    }
    ignored
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_byte_offsets() {
        let got = search_bytes("rust", b"Rust rust", SearchOptions::default())
            .unwrap();
        assert_eq!(got, vec![MatchRange { start: 5, end: 9 }]);
    }

    #[test]
    fn supports_options_and_invalid_patterns() {
        let opts = SearchOptions { case_insensitive: true, multi_line: true };
        assert_eq!(
            search_bytes("^rust$", b"Rust\nother", opts).unwrap().len(),
            1
        );
        assert!(
            search_bytes("[", b"input", SearchOptions::default()).is_err()
        );
    }

    #[test]
    fn handles_invalid_utf8_as_bytes() {
        let got = search_bytes("byte", b"x\xffbyte", SearchOptions::default())
            .unwrap();
        assert_eq!(got, vec![MatchRange { start: 2, end: 6 }]);
    }

    #[test]
    fn empty_input_and_results_are_deterministic() {
        let files = [
            VirtualFile { path: "empty".into(), content: vec![] },
            VirtualFile {
                path: "text".into(),
                content: "snowman ☃\n".as_bytes().to_vec(),
            },
        ];
        let options = FileSearchOptions::default();
        let first = search_files("snowman", &files, &options).unwrap();
        let second = search_files("snowman", &files, &options).unwrap();
        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&second).unwrap()
        );
        assert_eq!(first.matches.len(), 1);
        assert!(
            first.matches[0]
                .ranges
                .iter()
                .all(|range| range.start <= range.end
                    && range.end <= files[1].content.len())
        );
        assert!(
            search_bytes("anything", b"", SearchOptions::default())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn filters_virtual_paths_with_gitignore_rules() {
        let got = filter_paths(
            r#"["src/lib.rs","target/debug/app","notes.log","keep.log"]"#,
            "target/\n*.log\n!keep.log",
        )
        .unwrap();
        assert_eq!(got, r#"["src/lib.rs","keep.log"]"#);
    }

    #[test]
    fn searches_ordered_files_with_limits_and_lossy_lines() {
        let files = vec![
            VirtualFile {
                path: "a.txt".into(),
                content: b"foo\nfoo\n".to_vec(),
            },
            VirtualFile {
                path: "b.bin".into(),
                content: b"x\0\xfffoo\n".to_vec(),
            },
        ];
        let options = FileSearchOptions {
            literal: true,
            max_results: Some(2),
            ..Default::default()
        };
        let got = search_files("foo", &files, &options).unwrap();
        assert_eq!(got.matches.len(), 2);
        assert_eq!(got.matches[0].path, "a.txt");
        assert_eq!(got.matches[1].line_number, 2);

        let options =
            FileSearchOptions { binary: "skip".into(), ..Default::default() };
        let got = search_files("foo", &files, &options).unwrap();
        assert_eq!(got.files_skipped, 1);
        assert_eq!(got.diagnostics[0].kind, "binary-skipped");
        assert_eq!(got.stats.files_searched, 1);
        assert_eq!(got.stats.files_skipped, 1);
        assert_eq!(got.stats.bytes_searched, files[0].content.len());
    }

    #[test]
    fn invert_returns_unmatched_lines() {
        let files =
            [VirtualFile { path: "a".into(), content: b"yes\nno\n".to_vec() }];
        let options =
            FileSearchOptions { invert_match: true, ..Default::default() };
        let got = search_files("yes", &files, &options).unwrap();
        assert_eq!(got.matches[0].line, "no\n");
        let limited = FileSearchOptions {
            invert_match: true,
            max_results: Some(1),
            ..Default::default()
        };
        assert_eq!(
            search_files("yes", &files, &limited).unwrap().matches.len(),
            1
        );
    }

    #[test]
    fn rejects_unknown_binary_policy() {
        let files = [VirtualFile { path: "a".into(), content: vec![] }];
        let options =
            FileSearchOptions { binary: "guess".into(), ..Default::default() };
        let err = search_files("x", &files, &options).unwrap_err();
        assert!(err.contains("invalid binary policy"));
    }
}
