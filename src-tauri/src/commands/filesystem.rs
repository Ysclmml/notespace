use super::{comparable_path, display_path, BackendError, BackendResult};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::BTreeSet;
use std::fs::{self, File, Metadata};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::Emitter;

const DEBOUNCE: Duration = Duration::from_millis(150);
const MAX_PENDING_PATHS: usize = 256;
const MAX_WORKSPACE_ROOTS: usize = 32;
const MAX_DOCUMENT_PATHS: usize = 1024;
const MAX_WATCH_TARGETS: usize = 1024;

pub(super) fn metadata_revision(metadata: &Metadata) -> String {
    let modified = metadata
        .modified()
        .map(|time| match time.duration_since(UNIX_EPOCH) {
            Ok(duration) => format!("{:x}", duration.as_nanos()),
            Err(error) => format!("-{:x}", error.duration().as_nanos()),
        })
        .unwrap_or_else(|_| "unknown".to_owned());
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{:x}-{:x}-{:x}-{:x}",
            metadata.dev(),
            metadata.ino(),
            metadata.ctime(),
            metadata.ctime_nsec()
        )
    };
    #[cfg(windows)]
    let identity = {
        use std::os::windows::fs::MetadataExt;
        format!(
            "{:x}-{:x}",
            metadata.creation_time(),
            metadata.file_attributes()
        )
    };
    #[cfg(not(any(unix, windows)))]
    let identity = format!("{:?}", metadata.created().ok());
    format!("v1-{modified}-{:x}-{identity}", metadata.len())
}

pub(super) fn external_change_error() -> BackendError {
    BackendError::new("externalChange", "document changed or disappeared on disk")
}

pub(super) fn check_expected_revision(path: &Path, expected: Option<&str>) -> BackendResult<()> {
    let Some(expected) = expected else {
        return Ok(());
    };
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() && metadata_revision(&metadata) == expected => Ok(()),
        _ => Err(external_change_error()),
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentDiskStatus {
    Present,
    Missing,
    Unreadable,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInspection {
    pub path: String,
    pub status: DocumentDiskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
}

fn inspect_document(path: String) -> DocumentInspection {
    let metadata = fs::metadata(&path).and_then(|metadata| {
        if !metadata.is_file() {
            return Err(std::io::Error::other("not a regular file"));
        }
        // Opening a handle checks readability without loading any document bytes.
        File::open(&path)?.metadata()
    });
    let (status, revision) = match metadata {
        Ok(metadata) if metadata.is_file() => (
            DocumentDiskStatus::Present,
            Some(metadata_revision(&metadata)),
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            (DocumentDiskStatus::Missing, None)
        }
        _ => (DocumentDiskStatus::Unreadable, None),
    };
    DocumentInspection {
        path,
        status,
        revision,
    }
}

#[tauri::command]
pub async fn inspect_documents(paths: Vec<String>) -> BackendResult<Vec<DocumentInspection>> {
    if paths.len() > MAX_DOCUMENT_PATHS {
        return Err(BackendError::new("invalidPaths", "too many document paths"));
    }
    tauri::async_runtime::spawn_blocking(move || paths.into_iter().map(inspect_document).collect())
        .await
        .map_err(|error| BackendError::new("io", error.to_string()))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSystemChanges {
    pub paths: Vec<String>,
}

#[derive(Clone, Debug)]
struct WatchScope {
    roots: Vec<PathBuf>,
    documents: Vec<PathBuf>,
}

impl WatchScope {
    fn new(roots: Vec<String>, documents: Vec<String>) -> BackendResult<Self> {
        if roots.len() > MAX_WORKSPACE_ROOTS {
            return Err(BackendError::new("invalidPaths", "too many watch paths"));
        }
        let normalize = |paths: Vec<String>| -> BackendResult<Vec<PathBuf>> {
            let mut normalized = BTreeSet::new();
            for path in paths {
                if !Path::new(&path).is_absolute() || path.contains('\0') {
                    return Err(BackendError::new(
                        "invalidPaths",
                        "watch paths must be absolute",
                    ));
                }
                normalized.insert(comparable_path(Path::new(&path)));
            }
            Ok(normalized.into_iter().collect())
        };
        Ok(Self {
            roots: normalize(roots)?,
            documents: normalize(documents)?,
        })
    }

    fn accepts(&self, path: &Path) -> bool {
        // An explicitly opened file remains observable even inside a normally ignored directory.
        if self
            .documents
            .iter()
            .any(|document| document == path || document.starts_with(path))
        {
            return true;
        }
        self.roots.iter().any(|root| {
            path.strip_prefix(root).is_ok_and(|relative| {
                !relative
                    .components()
                    .any(|part| is_ignored_name(part.as_os_str()))
                    && !has_symlink_parent(root, path)
            })
        })
    }

    fn refresh_paths(&self) -> Vec<String> {
        self.roots
            .iter()
            .chain(&self.documents)
            .map(|path| display_path(path))
            .collect()
    }

    fn watch_targets(&self) -> Vec<(PathBuf, RecursiveMode)> {
        let roots: Vec<_> = self
            .roots
            .iter()
            .filter(|root| {
                !self
                    .roots
                    .iter()
                    .any(|other| other != *root && root.starts_with(other))
            })
            .cloned()
            .collect();
        let mut targets: Vec<_> = roots
            .iter()
            .cloned()
            .map(|root| (root, RecursiveMode::Recursive))
            .collect();
        let parents: BTreeSet<_> = self
            .documents
            .iter()
            .filter_map(|document| {
                if roots.iter().any(|root| document.starts_with(root)) {
                    None
                } else {
                    document.parent().map(Path::to_path_buf)
                }
            })
            .collect();
        targets.extend(
            parents
                .into_iter()
                .map(|parent| (parent, RecursiveMode::NonRecursive)),
        );
        // Bound native subscriptions after coalescing all root/file scopes.
        // Excess independent directories still participate in the frontend's
        // focus/30-second metadata fallback; never reject every open file.
        targets.truncate(MAX_WATCH_TARGETS);
        targets
    }
}

fn is_ignored_name(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    matches!(
        name.as_ref(),
        ".git"
            | ".hg"
            | ".svn"
            | "node_modules"
            | ".venv"
            | "venv"
            | "target"
            | "dist"
            | "build"
            | "__pycache__"
    ) || (name.starts_with('.') && name.contains(".markdown-workspace-") && name.ends_with(".tmp"))
}

fn has_symlink_parent(root: &Path, path: &Path) -> bool {
    path.ancestors()
        .take_while(|ancestor| *ancestor != root)
        .any(|ancestor| {
            fs::symlink_metadata(ancestor).is_ok_and(|metadata| metadata.file_type().is_symlink())
        })
}

#[derive(Default)]
struct PendingChanges {
    paths: BTreeSet<PathBuf>,
    full_refresh: bool,
}

impl PendingChanges {
    fn record(&mut self, event: notify::Result<Event>, scope: &WatchScope) -> bool {
        let event = match event {
            Ok(event) => event,
            Err(_) => {
                self.full_refresh = true;
                return true;
            }
        };
        if matches!(
            event.kind,
            EventKind::Access(_)
                | EventKind::Modify(notify::event::ModifyKind::Metadata(
                    notify::event::MetadataKind::AccessTime
                ))
        ) {
            return false;
        }
        if event.need_rescan() {
            self.full_refresh = true;
        }
        for path in event.paths {
            if scope.accepts(&path) {
                if self.paths.len() >= MAX_PENDING_PATHS {
                    self.full_refresh = true;
                    break;
                }
                self.paths.insert(path);
            }
        }
        self.full_refresh || !self.paths.is_empty()
    }

    fn drain(&mut self, scope: &WatchScope) -> Vec<String> {
        let paths = if self.full_refresh {
            scope.refresh_paths()
        } else {
            self.paths.iter().map(|path| display_path(path)).collect()
        };
        self.paths.clear();
        self.full_refresh = false;
        paths
    }
}

struct Subscription {
    watcher: Option<RecommendedWatcher>,
    stop: Arc<std::sync::atomic::AtomicBool>,
    wake: mpsc::SyncSender<()>,
    worker: Option<JoinHandle<()>>,
}

impl Drop for Subscription {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::Release);
        self.watcher.take();
        let _ = self.wake.try_send(());
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Subscription {
    fn start(
        scope: WatchScope,
        emit: impl Fn(FileSystemChanges) + Send + 'static,
    ) -> BackendResult<Self> {
        let scope = Arc::new(scope);
        let pending = Arc::new(Mutex::new(PendingChanges::default()));
        let (wake, receiver) = mpsc::sync_channel(1);
        let callback_scope = scope.clone();
        let callback_pending = pending.clone();
        let callback_wake = wake.clone();
        let mut watcher = notify::recommended_watcher(move |event| {
            if let Ok(mut pending) = callback_pending.lock() {
                if pending.record(event, &callback_scope) {
                    let _ = callback_wake.try_send(());
                }
            }
        })
        .map_err(|error| BackendError::new("watchFailed", error.to_string()))?;
        for (path, mode) in scope.watch_targets() {
            // Missing roots/parents may reappear; the next replacement re-evaluates them.
            if !path.is_dir() {
                continue;
            }
            watcher
                .watch(&path, mode)
                .map_err(|error| BackendError::new("watchFailed", error.to_string()))?;
        }
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let worker_stop = stop.clone();
        let worker = thread::spawn(move || {
            while receiver.recv().is_ok() {
                if worker_stop.load(std::sync::atomic::Ordering::Acquire) {
                    break;
                }
                let deadline = Instant::now() + DEBOUNCE;
                while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
                    if receiver.recv_timeout(remaining).is_err() {
                        break;
                    }
                    if worker_stop.load(std::sync::atomic::Ordering::Acquire) {
                        return;
                    }
                }
                if worker_stop.load(std::sync::atomic::Ordering::Acquire) {
                    break;
                }
                let paths = pending
                    .lock()
                    .map(|mut pending| pending.drain(&scope))
                    .unwrap_or_default();
                for batch in paths.chunks(MAX_PENDING_PATHS) {
                    if worker_stop.load(std::sync::atomic::Ordering::Acquire) {
                        return;
                    }
                    emit(FileSystemChanges {
                        paths: batch.to_vec(),
                    });
                }
            }
        });
        Ok(Self {
            watcher: Some(watcher),
            stop,
            wake,
            worker: Some(worker),
        })
    }
}

#[derive(Default)]
pub struct FileSystemWatchState(Arc<Mutex<Option<Subscription>>>);

#[tauri::command(rename_all = "camelCase")]
pub async fn watch_filesystem(
    app: tauri::AppHandle,
    state: tauri::State<'_, FileSystemWatchState>,
    workspace_roots: Vec<String>,
    document_paths: Vec<String>,
) -> BackendResult<()> {
    let scope = WatchScope::new(workspace_roots, document_paths)?;
    let state = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut subscription = state
            .lock()
            .map_err(|_| BackendError::new("watchFailed", "watch state unavailable"))?;
        subscription.take();
        if scope.roots.is_empty() && scope.documents.is_empty() {
            return Ok(());
        }
        *subscription = Some(Subscription::start(scope, move |changes| {
            let _ = app.emit("filesystem-changed", changes);
        })?);
        Ok(())
    })
    .await
    .map_err(|error| BackendError::new("watchFailed", error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::tests::TestDirectory;
    use notify::event::{AccessKind, CreateKind, ModifyKind, RemoveKind};

    fn scope(root: &Path, documents: Vec<String>) -> WatchScope {
        WatchScope::new(vec![display_path(root)], documents).unwrap()
    }

    #[test]
    fn more_than_one_metadata_batch_of_documents_keeps_coalesced_watch_scopes() {
        let temp = TestDirectory::new("many-watched-documents");
        let documents: Vec<_> = (0..MAX_DOCUMENT_PATHS + 25)
            .map(|index| display_path(&temp.path().join(format!("{index}.md"))))
            .collect();
        let independent = WatchScope::new(vec![], documents.clone()).unwrap();
        assert_eq!(independent.documents.len(), MAX_DOCUMENT_PATHS + 25);
        assert_eq!(
            independent.watch_targets(),
            vec![(temp.path().to_path_buf(), RecursiveMode::NonRecursive)]
        );
        let rooted = scope(temp.path(), documents);
        assert_eq!(
            rooted.watch_targets(),
            vec![(temp.path().to_path_buf(), RecursiveMode::Recursive)]
        );
        assert!(rooted.accepts(&temp.path().join("1025.md")));
    }

    #[test]
    fn native_target_budget_preserves_roots_and_fallback_paths() {
        let temp = TestDirectory::new("many-watch-parents");
        let root = temp.path().join("workspace");
        let documents: Vec<_> = (0..MAX_WATCH_TARGETS + 10)
            .map(|index| display_path(&temp.path().join(format!("parent-{index}/note.md"))))
            .collect();
        let scope = WatchScope::new(vec![display_path(&root)], documents).unwrap();
        let targets = scope.watch_targets();
        assert_eq!(targets.len(), MAX_WATCH_TARGETS);
        assert_eq!(targets[0], (root, RecursiveMode::Recursive));
        assert_eq!(scope.refresh_paths().len(), MAX_WATCH_TARGETS + 11);
    }

    #[test]
    fn inspection_reports_revision_missing_and_unreadable_without_bodies() {
        let temp = TestDirectory::new("inspect-documents");
        let path = temp.path().join("readme.md");
        fs::write(&path, "private fixture body").unwrap();
        let result = inspect_document(display_path(&path));
        assert_eq!(result.status, DocumentDiskStatus::Present);
        assert_eq!(
            result.revision,
            Some(metadata_revision(&fs::metadata(&path).unwrap()))
        );
        assert!(!format!("{result:?}").contains("private fixture body"));
        assert_eq!(
            inspect_document(display_path(&temp.path().join("missing.md"))).status,
            DocumentDiskStatus::Missing
        );
        assert_eq!(
            inspect_document(display_path(temp.path())).status,
            DocumentDiskStatus::Unreadable
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
            assert_eq!(
                inspect_document(display_path(&path)).status,
                DocumentDiskStatus::Unreadable
            );
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        }
    }

    #[test]
    fn metadata_revision_detects_equal_length_replacement_and_in_place_changes() {
        let temp = TestDirectory::new("disk-revisions");
        let path = temp.path().join("readme.md");
        fs::write(&path, "before").unwrap();
        let first = metadata_revision(&fs::metadata(&path).unwrap());
        fs::write(&path, "edited").unwrap();
        let second = metadata_revision(&fs::metadata(&path).unwrap());
        assert_ne!(first, second);
        crate::commands::atomic_write(&path, b"edited").unwrap();
        assert_ne!(second, metadata_revision(&fs::metadata(&path).unwrap()));
    }

    #[test]
    fn event_filter_ignores_access_heavy_directories_temp_files_and_unrelated_files() {
        let temp = TestDirectory::new("watch-filter");
        let root = temp.path().canonicalize().unwrap();
        let outside = root.with_file_name("standalone.md");
        let scope = scope(&root, vec![display_path(&outside)]);
        let mut pending = PendingChanges::default();
        for path in [
            root.join(".git/index"),
            root.join("node_modules/pkg/index.js"),
            root.join(".readme.md.markdown-workspace-1-2.tmp"),
            root.with_file_name("other.md"),
        ] {
            assert!(!pending.record(
                Ok(Event::new(EventKind::Create(CreateKind::Any)).add_path(path)),
                &scope
            ));
        }
        assert!(!pending.record(
            Ok(Event::new(EventKind::Access(AccessKind::Read)).add_path(root.join("readme.md"))),
            &scope
        ));
        for (path, kind) in [
            (
                root.join("nested/new.md"),
                EventKind::Create(CreateKind::File),
            ),
            (
                root.join("nested/deleted"),
                EventKind::Remove(RemoveKind::Folder),
            ),
            (outside.clone(), EventKind::Modify(ModifyKind::Any)),
        ] {
            assert!(pending.record(Ok(Event::new(kind).add_path(path.clone())), &scope));
            assert_eq!(pending.drain(&scope), vec![display_path(&path)]);
        }
        let targets = scope.watch_targets();
        assert!(targets.contains(&(root.clone(), RecursiveMode::Recursive)));
        assert!(targets.contains(&(
            outside.parent().unwrap().to_path_buf(),
            RecursiveMode::NonRecursive
        )));
    }

    #[test]
    fn event_batches_are_bounded_and_overflow_requests_a_scope_refresh() {
        let temp = TestDirectory::new("watch-bounds");
        let root = temp.path().canonicalize().unwrap();
        let scope = scope(&root, vec![]);
        let mut pending = PendingChanges::default();
        let paths = (0..500)
            .map(|index| root.join(format!("{index}.md")))
            .collect();
        let mut event = Event::new(EventKind::Create(CreateKind::Any));
        event.paths = paths;
        pending.record(Ok(event), &scope);
        assert!(pending.paths.len() <= MAX_PENDING_PATHS);
        assert_eq!(pending.drain(&scope), vec![display_path(&root)]);
        assert!(pending.drain(&scope).is_empty());
        assert!(WatchScope::new(vec!["relative".into()], vec![]).is_err());
    }

    fn expect_path(receiver: &mpsc::Receiver<FileSystemChanges>, path: &Path) {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .expect("filesystem event timed out");
            let changes = receiver.recv_timeout(remaining).expect("filesystem event");
            if changes.paths.contains(&display_path(path)) {
                return;
            }
        }
    }

    #[test]
    fn native_recursive_watch_detects_create_modify_replace_and_remove() {
        let temp = TestDirectory::new("native-recursive-watch");
        let root = temp.path().canonicalize().unwrap();
        fs::create_dir(root.join("nested")).unwrap();
        let (send, receive) = mpsc::channel();
        let subscription = Subscription::start(scope(&root, vec![]), move |changes| {
            let _ = send.send(changes);
        })
        .unwrap();
        let path = root.join("nested/readme.md");
        fs::write(&path, "created").unwrap();
        expect_path(&receive, &path);
        fs::write(&path, "modified").unwrap();
        expect_path(&receive, &path);
        crate::commands::atomic_write(&path, b"atomically replaced").unwrap();
        expect_path(&receive, &path);
        fs::remove_file(&path).unwrap();
        expect_path(&receive, &path);
        drop(subscription);
    }

    #[test]
    fn native_standalone_parent_watch_survives_delete_recreate_and_stops_on_replacement() {
        let temp = TestDirectory::new("native-standalone-watch");
        let root = temp.path().canonicalize().unwrap();
        let path = root.join("readme.md");
        fs::write(&path, "initial").unwrap();
        let (send, receive) = mpsc::channel();
        let subscription = Subscription::start(
            WatchScope::new(vec![], vec![display_path(&path)]).unwrap(),
            move |changes| {
                let _ = send.send(changes);
            },
        )
        .unwrap();
        fs::remove_file(&path).unwrap();
        expect_path(&receive, &path);
        fs::write(&path, "recreated").unwrap();
        expect_path(&receive, &path);
        drop(subscription);
        while receive.try_recv().is_ok() {}
        fs::write(&path, "after subscription removed").unwrap();
        assert!(matches!(
            receive.recv_timeout(DEBOUNCE * 2),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ));
        // Replacing an unchanged configuration re-evaluates parents that were absent.
        let missing = root.join("later/notes.md");
        let initial = Subscription::start(
            WatchScope::new(vec![], vec![display_path(&missing)]).unwrap(),
            |_| {},
        )
        .unwrap();
        drop(initial);
        fs::create_dir(root.join("later")).unwrap();
        let (send, receive) = mpsc::channel();
        let _replacement = Subscription::start(
            WatchScope::new(vec![], vec![display_path(&missing)]).unwrap(),
            move |changes| {
                let _ = send.send(changes);
            },
        )
        .unwrap();
        fs::write(&missing, "now present").unwrap();
        expect_path(&receive, &missing);
    }
}
