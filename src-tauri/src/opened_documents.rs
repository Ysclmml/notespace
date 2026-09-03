use std::{path::PathBuf, sync::Mutex};

#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

pub const OPENED_DOCUMENTS_AVAILABLE_EVENT: &str = "opened-document-paths-available";
const MAX_PENDING_DOCUMENTS: usize = 32;
const MAX_PATH_CHARACTERS: usize = 4_096;

#[derive(Default)]
pub struct OpenedDocumentQueue {
    paths: Mutex<Vec<String>>,
}

impl OpenedDocumentQueue {
    pub fn from_launch_arguments() -> Self {
        let queue = Self::default();
        queue.enqueue_paths(std::env::args_os().skip(1).map(PathBuf::from));
        queue
    }

    fn enqueue_paths<I>(&self, paths: I) -> bool
    where
        I: IntoIterator<Item = PathBuf>,
    {
        let mut pending = self
            .paths
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut added = false;

        for path in paths {
            let Some(path) = supported_markdown_path(path) else {
                continue;
            };
            if pending.iter().any(|queued| queued == &path) {
                continue;
            }
            if pending.len() == MAX_PENDING_DOCUMENTS {
                pending.remove(0);
            }
            pending.push(path);
            added = true;
        }

        added
    }

    fn take(&self) -> Vec<String> {
        std::mem::take(
            &mut *self
                .paths
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        )
    }
}

fn supported_markdown_path(path: PathBuf) -> Option<String> {
    let extension = path.extension()?.to_str()?;
    if !extension.eq_ignore_ascii_case("md") && !extension.eq_ignore_ascii_case("markdown") {
        return None;
    }

    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir().ok()?.join(path)
    };
    let text = absolute.to_str()?;
    if text.is_empty() || text.chars().count() > MAX_PATH_CHARACTERS {
        return None;
    }
    Some(text.to_owned())
}

#[tauri::command]
pub fn take_opened_document_paths(state: tauri::State<'_, OpenedDocumentQueue>) -> Vec<String> {
    state.take()
}

#[cfg(target_os = "macos")]
pub fn handle_run_event(app_handle: &tauri::AppHandle, event: tauri::RunEvent) {
    let tauri::RunEvent::Opened { urls } = event else {
        return;
    };
    let state = app_handle.state::<OpenedDocumentQueue>();
    let queued = state.enqueue_paths(urls.into_iter().filter_map(|url| url.to_file_path().ok()));
    if !queued {
        return;
    }

    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app_handle.emit(OPENED_DOCUMENTS_AVAILABLE_EVENT, ());
}

#[cfg(not(target_os = "macos"))]
pub fn handle_run_event(_app_handle: &tauri::AppHandle, _event: tauri::RunEvent) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::OsString, path::Path};

    fn queue(paths: impl IntoIterator<Item = impl Into<OsString>>) -> OpenedDocumentQueue {
        let queue = OpenedDocumentQueue::default();
        queue.enqueue_paths(paths.into_iter().map(|path| PathBuf::from(path.into())));
        queue
    }

    #[test]
    fn accepts_only_markdown_extensions_and_normalizes_relative_arguments() {
        let queue = queue(["notes/one.md", "notes/two.MARKDOWN", "notes/three.txt"]);
        let current = std::env::current_dir().expect("current directory");

        assert_eq!(
            queue.take(),
            vec![
                current.join("notes/one.md").to_string_lossy().into_owned(),
                current
                    .join("notes/two.MARKDOWN")
                    .to_string_lossy()
                    .into_owned(),
            ]
        );
    }

    #[test]
    fn deduplicates_pending_paths_and_drain_is_destructive() {
        let queue = queue(["/tmp/one.md", "/tmp/one.md", "/tmp/two.markdown"]);

        assert_eq!(queue.take(), vec!["/tmp/one.md", "/tmp/two.markdown"]);
        assert!(queue.take().is_empty());
    }

    #[test]
    fn keeps_the_most_recent_bounded_launch_requests() {
        let paths = (0..(MAX_PENDING_DOCUMENTS + 3))
            .map(|index| format!("/tmp/{index}.md"))
            .collect::<Vec<_>>();
        let queue = queue(paths.iter().map(OsString::from));
        assert!(queue.enqueue_paths([PathBuf::from("/tmp/new.md")]));
        let pending = queue.take();

        assert_eq!(pending.len(), MAX_PENDING_DOCUMENTS);
        assert_eq!(pending.first().map(String::as_str), Some("/tmp/4.md"));
        assert_eq!(pending.last().map(String::as_str), Some("/tmp/new.md"));
    }

    #[test]
    fn rejects_paths_above_the_metadata_budget() {
        let queue = queue([format!("/tmp/{}.md", "a".repeat(MAX_PATH_CHARACTERS))]);

        assert!(queue.take().is_empty());
    }

    #[test]
    fn path_filter_accepts_absolute_markdown_paths() {
        assert_eq!(
            supported_markdown_path(Path::new("/tmp/文档.markdown").to_path_buf()),
            Some("/tmp/文档.markdown".to_owned())
        );
    }
}
