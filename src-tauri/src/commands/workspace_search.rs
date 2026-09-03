use super::{
    display_path, is_ignored_workspace_directory, is_supported_text_path, relative_display_path,
    BackendError, BackendResult, LineScanner, Utf8StreamValidator, SCAN_BUFFER_BYTES,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_ROOTS: usize = 32;
const MAX_QUERY_CHARS: usize = 512;
const MAX_PATH_BYTES: usize = 16 * 1024;
const SNIPPET_CHARS: usize = 240;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchRoot {
    pub path: String,
    #[serde(default)]
    pub show_hidden: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchMatch {
    pub path: String,
    pub relative_path: String,
    pub root_path: String,
    pub line: usize,
    pub column: usize,
    pub snippet: String,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResponse {
    pub matches: Vec<WorkspaceSearchMatch>,
    pub searched_files: usize,
    pub skipped_files: usize,
    pub unavailable_roots: Vec<String>,
    pub truncated: bool,
}

#[derive(Clone, Copy)]
struct SearchLimits {
    entries: usize,
    files: usize,
    file_bytes: usize,
    total_bytes: usize,
    depth: usize,
    matches: usize,
}

impl Default for SearchLimits {
    fn default() -> Self {
        Self {
            entries: 20_000,
            files: 5_000,
            file_bytes: 2 * 1024 * 1024,
            total_bytes: 64 * 1024 * 1024,
            depth: 64,
            matches: 200,
        }
    }
}

#[tauri::command]
pub async fn search_workspaces(
    workspaces: Vec<WorkspaceSearchRoot>,
    query: String,
    case_sensitive: bool,
) -> BackendResult<WorkspaceSearchResponse> {
    tauri::async_runtime::spawn_blocking(move || {
        search_with_limits(workspaces, &query, case_sensitive, SearchLimits::default())
    })
    .await
    .map_err(|_| BackendError::new("workspaceSearchFailed", "workspace search task failed"))?
}

struct SearchScan {
    response: WorkspaceSearchResponse,
    entries: usize,
    files: usize,
    bytes: usize,
    limits: SearchLimits,
    result_limit_reached: bool,
}

struct SearchScope<'a> {
    roots: &'a HashSet<PathBuf>,
    needle: &'a str,
    case_sensitive: bool,
}

fn search_with_limits(
    workspaces: Vec<WorkspaceSearchRoot>,
    query: &str,
    case_sensitive: bool,
    limits: SearchLimits,
) -> BackendResult<WorkspaceSearchResponse> {
    if workspaces.len() > MAX_ROOTS
        || workspaces
            .iter()
            .any(|root| root.path.len() > MAX_PATH_BYTES)
    {
        return Err(BackendError::new(
            "workspaceSearchInvalidScope",
            "workspace search scope exceeds its limit",
        ));
    }
    if query.chars().count() > MAX_QUERY_CHARS || query.contains(['\n', '\r', '\0']) {
        return Err(BackendError::new(
            "workspaceSearchInvalidQuery",
            "search for a single line of at most 512 characters",
        ));
    }
    let mut scan = SearchScan {
        response: WorkspaceSearchResponse::default(),
        entries: 0,
        files: 0,
        bytes: 0,
        limits,
        result_limit_reached: false,
    };
    if query.trim().is_empty() {
        return Ok(scan.response);
    }

    let mut roots = Vec::new();
    for workspace in workspaces {
        match Path::new(&workspace.path).canonicalize() {
            Ok(path) if path.is_dir() => {
                if !roots.iter().any(|(root, _)| root == &path) {
                    roots.push((path, workspace.show_hidden));
                }
            }
            _ => scan.response.unavailable_roots.push(workspace.path),
        }
    }
    let root_paths: HashSet<_> = roots.iter().map(|(path, _)| path.clone()).collect();
    let needle = if case_sensitive {
        query.to_owned()
    } else {
        lowercase_literal(query)
    };

    let scope = SearchScope {
        roots: &root_paths,
        needle: &needle,
        case_sensitive,
    };
    for (root, show_hidden) in roots {
        if scan.exhausted() {
            scan.response.truncated = true;
            break;
        }
        scan.directory(&root, &root, show_hidden, 0, &scope);
    }
    scan.response.matches.sort_by(|left, right| {
        left.root_path
            .cmp(&right.root_path)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
            .then_with(|| left.line.cmp(&right.line))
    });
    Ok(scan.response)
}

impl SearchScan {
    fn exhausted(&self) -> bool {
        self.files >= self.limits.files
            || self.bytes >= self.limits.total_bytes
            || self.result_limit_reached
    }

    fn directory(
        &mut self,
        root: &Path,
        directory: &Path,
        show_hidden: bool,
        depth: usize,
        scope: &SearchScope<'_>,
    ) {
        if depth > self.limits.depth {
            self.response.truncated = true;
            return;
        }
        let entries = match fs::read_dir(directory) {
            Ok(entries) => entries,
            Err(_) => {
                if directory == root {
                    self.response.unavailable_roots.push(display_path(root));
                } else {
                    self.response.truncated = true;
                }
                return;
            }
        };
        // Bound directory enumeration itself, not just the number of returned matches.
        let mut children = Vec::new();
        for entry in entries {
            if self.entries >= self.limits.entries {
                self.response.truncated = true;
                break;
            }
            self.entries += 1;
            match entry {
                Ok(entry) => children.push(entry),
                Err(_) => self.response.truncated = true,
            }
        }
        children.sort_by_key(|entry| entry.file_name());
        for entry in children {
            if self.exhausted() {
                self.response.truncated = true;
                break;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(file_type) = entry.file_type() else {
                self.response.truncated = true;
                continue;
            };
            if file_type.is_symlink() || (!show_hidden && name.starts_with('.')) {
                continue;
            }
            if file_type.is_dir() {
                // Explicit nested roots own their own hidden-file preference.
                if !is_ignored_workspace_directory(&name) && !scope.roots.contains(&path) {
                    self.directory(root, &path, show_hidden, depth + 1, scope);
                }
            } else if file_type.is_file() && is_supported_text_path(&path) {
                self.file(root, &path, scope.needle, scope.case_sensitive);
            }
        }
    }

    fn file(&mut self, root: &Path, path: &Path, needle: &str, case_sensitive: bool) {
        self.files += 1;
        let Some(text) = self.read_text(path) else {
            self.response.skipped_files += 1;
            return;
        };
        self.response.searched_files += 1;
        for (index, line) in text.lines().enumerate() {
            let Some(offset) = first_match_offset(line, needle, case_sensitive) else {
                continue;
            };
            if self.response.matches.len() == self.limits.matches {
                self.response.truncated = true;
                self.result_limit_reached = true;
                // Keep the response at exactly the public result bound.
                return;
            }
            self.response.matches.push(WorkspaceSearchMatch {
                path: display_path(path),
                relative_path: relative_display_path(root, path),
                root_path: display_path(root),
                line: index + 1,
                column: line[..offset].encode_utf16().count() + 1,
                snippet: make_snippet(line, offset),
            });
        }
    }

    fn read_text(&mut self, path: &Path) -> Option<String> {
        // Recheck symlinks before opening; as with the file tree this is not a filesystem lock.
        let metadata = fs::symlink_metadata(path).ok()?;
        if !metadata.is_file() || metadata.len() > self.limits.file_bytes as u64 {
            return None;
        }
        let mut file = File::open(path).ok()?;
        let mut content = Vec::new();
        let mut buffer = [0_u8; SCAN_BUFFER_BYTES];
        let mut utf8 = Utf8StreamValidator::default();
        let mut lines = LineScanner::default();
        loop {
            let remaining_file = (self.limits.file_bytes + 1).saturating_sub(content.len());
            let remaining_total = self.limits.total_bytes.saturating_sub(self.bytes);
            let read_limit = buffer.len().min(remaining_file).min(remaining_total);
            if read_limit == 0 {
                self.response.truncated = true;
                return None;
            }
            let read = file.read(&mut buffer[..read_limit]).ok()?;
            self.bytes += read;
            if read == 0 {
                break;
            }
            if content.len() + read > self.limits.file_bytes {
                return None;
            }
            if !utf8.push(&buffer[..read]) || lines.push(&buffer[..read]).is_some() {
                return None;
            }
            content.extend_from_slice(&buffer[..read]);
        }
        if !utf8.finish() || lines.finish().is_some() {
            return None;
        }
        String::from_utf8(content).ok()
    }
}

fn lowercase_literal(value: &str) -> String {
    value.chars().flat_map(char::to_lowercase).collect()
}

fn first_match_offset(line: &str, needle: &str, case_sensitive: bool) -> Option<usize> {
    if case_sensitive {
        return line.find(needle);
    }
    let folded = lowercase_literal(line);
    let folded_offset = folded.find(needle)?;
    let mut cursor = 0;
    for (offset, character) in line.char_indices() {
        cursor += character.to_lowercase().map(char::len_utf8).sum::<usize>();
        if cursor > folded_offset {
            return Some(offset);
        }
    }
    None
}

fn make_snippet(line: &str, offset: usize) -> String {
    let chars_before_match = line[..offset].chars().count();
    let start = chars_before_match.saturating_sub(60);
    let mut chars = line.chars().skip(start);
    let text: String = chars.by_ref().take(SNIPPET_CHARS).collect();
    format!(
        "{}{}{}",
        if start > 0 { "…" } else { "" },
        text,
        if chars.next().is_some() { "…" } else { "" }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(1);

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "notespace-search-test-{}-{}",
                std::process::id(),
                NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path.canonicalize().unwrap())
        }

        fn write(&self, relative: &str, bytes: impl AsRef<[u8]>) {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, bytes).unwrap();
        }

        fn root(&self, show_hidden: bool) -> WorkspaceSearchRoot {
            WorkspaceSearchRoot {
                path: display_path(&self.0),
                show_hidden,
            }
        }

        fn search(&self, query: &str, case_sensitive: bool) -> WorkspaceSearchResponse {
            search_with_limits(
                vec![self.root(false)],
                query,
                case_sensitive,
                SearchLimits::default(),
            )
            .unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn literal_search_reports_physical_lines_and_original_utf16_columns() {
        let fixture = Fixture::new();
        fixture.write("学习.md", "# Demo\r\n😀 中文 HELLO hello\r\nhello .*\r\n");
        let result = fixture.search("hello", false);
        assert_eq!(result.searched_files, 1);
        assert_eq!(result.matches.len(), 2);
        assert_eq!(result.matches[0].line, 2);
        assert_eq!(result.matches[0].column, 7);
        assert_eq!(result.matches[0].snippet, "😀 中文 HELLO hello");
        assert_eq!(result.matches[0].relative_path, "学习.md");
        assert!(!result.truncated);
        let exact = fixture.search("HELLO", true);
        assert_eq!(exact.matches.len(), 1);
        assert_eq!(fixture.search("中文", false).matches[0].column, 4);
        assert_eq!(fixture.search(".*", false).matches.len(), 1);
        assert_eq!(fixture.search("absent", false).matches.len(), 0);
    }

    #[test]
    fn case_expansion_keeps_original_byte_and_utf16_coordinates() {
        assert_eq!(first_match_offset("İ 😀 MATCH", "match", false), Some(8));
        assert_eq!(first_match_offset("中文 ÄBC", "äbc", false), Some(7));
        let fixture = Fixture::new();
        fixture.write("case.txt", "İ 😀 MATCH");
        assert_eq!(fixture.search("match", false).matches[0].column, 6);
    }

    #[test]
    fn hidden_and_heavy_directories_use_existing_workspace_filters() {
        let fixture = Fixture::new();
        fixture.write("visible.md", "match");
        fixture.write(".env", "match");
        fixture.write(".drafts/note.md", "match");
        fixture.write("node_modules/skip.ts", "match");
        fixture.write(".git/config.txt", "match");
        fixture.write("target/skip.rs", "match");
        fixture.write("ignored.bin", "match");
        assert_eq!(fixture.search("match", false).matches.len(), 1);
        let visible = search_with_limits(
            vec![fixture.root(true)],
            "match",
            false,
            SearchLimits::default(),
        )
        .unwrap();
        assert_eq!(visible.matches.len(), 3);
        assert_eq!(visible.searched_files, 3);
        assert_eq!(visible.skipped_files, 0);
    }

    #[test]
    fn nested_roots_own_their_preferences_and_do_not_duplicate_results() {
        let fixture = Fixture::new();
        fixture.write("parent.md", "match");
        fixture.write("nested/child.md", "match");
        fixture.write("nested/.hidden.md", "match");
        let nested = WorkspaceSearchRoot {
            path: display_path(&fixture.0.join("nested")),
            show_hidden: false,
        };
        let result = search_with_limits(
            vec![fixture.root(true), nested, fixture.root(false)],
            "match",
            false,
            SearchLimits::default(),
        )
        .unwrap();
        assert_eq!(result.matches.len(), 2);
        assert_eq!(result.matches[1].relative_path, "child.md");
        assert_eq!(
            result.matches[1].root_path,
            display_path(&fixture.0.join("nested"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_files_and_directories_are_not_followed() {
        let fixture = Fixture::new();
        let outside = Fixture::new();
        outside.write("outside.md", "match");
        std::os::unix::fs::symlink(&outside.0, fixture.0.join("linked")).unwrap();
        std::os::unix::fs::symlink(outside.0.join("outside.md"), fixture.0.join("linked.md"))
            .unwrap();
        assert_eq!(fixture.search("match", false).searched_files, 0);
    }

    #[test]
    fn missing_roots_are_reported_without_losing_valid_results() {
        let fixture = Fixture::new();
        fixture.write("valid.md", "match");
        let missing = display_path(&fixture.0.join("missing"));
        let result = search_with_limits(
            vec![
                fixture.root(false),
                WorkspaceSearchRoot {
                    path: missing.clone(),
                    show_hidden: false,
                },
            ],
            "match",
            false,
            SearchLimits::default(),
        )
        .unwrap();
        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.unavailable_roots, vec![missing]);
        assert!(!fixture.0.join("missing").exists());
    }

    #[test]
    fn invalid_utf8_data_images_long_lines_and_large_files_are_skipped_before_results() {
        let fixture = Fixture::new();
        fixture.write("invalid.txt", [0xff, 0xfe]);
        fixture.write(
            "data.md",
            format!("data:image/png;base64,{}", "A".repeat(513 * 1024)),
        );
        fixture.write("line.md", "x".repeat(1024 * 1024 + 1));
        fixture.write("large.md", "x\n".repeat(1024 * 1024 + 1));
        fixture.write("normal.md", "match");
        let result = fixture.search("match", false);
        assert_eq!(result.skipped_files, 4);
        assert_eq!(result.searched_files, 1);
        assert_eq!(result.matches.len(), 1);
    }

    #[test]
    fn result_limit_counts_matching_lines_not_occurrences_and_reports_incomplete() {
        let fixture = Fixture::new();
        fixture.write("a.md", "match match\n".repeat(201));
        fixture.write("z.md", "match");
        let result = fixture.search("match", false);
        assert_eq!(result.matches.len(), 200);
        assert_eq!(result.searched_files, 1);
        assert!(result.truncated);
        fixture.write("a.md", "match\n".repeat(199));
        let exactly = fixture.search("match", false);
        assert_eq!(exactly.matches.len(), 200);
        assert!(!exactly.truncated);
    }

    #[test]
    fn limits_bound_files_total_reads_directory_entries_and_depth() {
        let fixture = Fixture::new();
        for index in 0..4 {
            fixture.write(&format!("{index}.md"), "match");
        }
        for limits in [
            SearchLimits {
                files: 2,
                ..SearchLimits::default()
            },
            SearchLimits {
                total_bytes: 8,
                ..SearchLimits::default()
            },
            SearchLimits {
                entries: 2,
                ..SearchLimits::default()
            },
        ] {
            let result =
                search_with_limits(vec![fixture.root(false)], "match", false, limits).unwrap();
            assert!(result.truncated);
            assert!(result.matches.len() <= 2);
        }
        fixture.write("deep/nested/note.md", "match");
        let result = search_with_limits(
            vec![fixture.root(false)],
            "match",
            false,
            SearchLimits {
                depth: 0,
                ..SearchLimits::default()
            },
        )
        .unwrap();
        assert!(result.truncated);
        assert_eq!(result.matches.len(), 4);
    }

    #[test]
    fn snippets_are_bounded_and_include_late_unicode_matches() {
        let line = format!("{}needle{}", "中".repeat(400), "文".repeat(400));
        let snippet = make_snippet(&line, 1200);
        assert!(snippet.contains("needle"));
        assert!(snippet.starts_with('…'));
        assert!(snippet.ends_with('…'));
        assert!(snippet.chars().count() <= SNIPPET_CHARS + 2);
    }

    #[test]
    fn empty_and_invalid_queries_do_not_scan_and_scope_is_bounded() {
        let fixture = Fixture::new();
        fixture.write("note.md", "match");
        assert_eq!(fixture.search("  ", false).searched_files, 0);
        assert!(search_with_limits(
            vec![fixture.root(false)],
            &"a".repeat(513),
            false,
            SearchLimits::default()
        )
        .is_err());
        assert!(search_with_limits(
            vec![fixture.root(false)],
            "two\nlines",
            false,
            SearchLimits::default()
        )
        .is_err());
        assert!(search_with_limits(
            vec![fixture.root(false); 33],
            "match",
            false,
            SearchLimits::default()
        )
        .is_err());
    }
}
