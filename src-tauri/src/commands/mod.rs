mod clipboard_image;
mod external_url;
pub mod filesystem;

use serde::Serialize;
use std::ffi::{OsStr, OsString};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Seek, Write};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

const SCAN_BUFFER_BYTES: usize = 64 * 1024;
const NORMAL_FILE_BYTES: u64 = 8 * 1024 * 1024;
const NORMAL_LINE_BYTES: u64 = 256 * 1024;
const BLOCK_DATA_URI_LINE_BYTES: u64 = 512 * 1024;
const BLOCK_LINE_BYTES: u64 = 1024 * 1024;
const DATA_IMAGE_PREFIX: &[u8] = b"data:image/";
const BASE64_MARKER: &[u8] = b";base64,";
const PREVIEW_CONTEXT_LINES: usize = 20;
const PREVIEW_DEFAULT_LINES: usize = 80;
const PREVIEW_LINE_CHARS: usize = 600;

const SUPPORTED_TEXT_EXTENSIONS: &[&str] = &[
    "md",
    "markdown",
    "json",
    "jsonc",
    "py",
    "pyw",
    "js",
    "mjs",
    "cjs",
    "jsx",
    "ts",
    "mts",
    "cts",
    "tsx",
    "css",
    "scss",
    "sass",
    "less",
    "rs",
    "java",
    "cs",
    "c",
    "h",
    "cc",
    "cpp",
    "cxx",
    "hpp",
    "hh",
    "hxx",
    "go",
    "rb",
    "php",
    "swift",
    "kt",
    "kts",
    "sh",
    "bash",
    "zsh",
    "fish",
    "yaml",
    "yml",
    "toml",
    "xml",
    "svg",
    "html",
    "htm",
    "sql",
    "vue",
    "svelte",
    "txt",
    "log",
    "conf",
    "cfg",
    "ini",
    "properties",
    "env",
    "csv",
    "tsv",
    "lua",
    "dart",
    "scala",
    "groovy",
    "pl",
    "pm",
    "proto",
    "graphql",
    "gql",
];

static UNIQUE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendError {
    pub code: &'static str,
    pub message: String,
}

impl BackendError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn io(action: &str, error: io::Error) -> Self {
        Self::new("io", format!("{action}: {error}"))
    }
}

type BackendResult<T> = Result<T, BackendError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSelection {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSelection {
    pub path: String,
    pub name: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceNodeKind {
    Directory,
    Markdown,
    Text,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentKind {
    Markdown,
    Text,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceNode {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub kind: WorkspaceNodeKind,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<WorkspaceNode>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentMode {
    Normal,
    SourceOnly,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockedReason {
    InvalidUtf8,
    LineTooLong,
    LargeDataUri,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPreflight {
    pub size_bytes: u64,
    pub longest_line_bytes: u64,
    pub contains_data_image_base64: bool,
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum OpenDocumentResult {
    Editable {
        path: String,
        content: String,
        mode: DocumentMode,
        document_kind: DocumentKind,
        language: String,
        preflight: DocumentPreflight,
        disk_revision: String,
    },
    Blocked {
        path: String,
        reason: BlockedReason,
        preflight: DocumentPreflight,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDocumentResult {
    pub path: String,
    pub bytes_written: u64,
    pub disk_revision: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedClipboardImage {
    pub path: String,
    pub markdown_uri: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFilePreview {
    pub path: String,
    pub language: String,
    pub target_line: Option<usize>,
    pub start_line: usize,
    pub content: String,
}

#[derive(Debug)]
struct ScanResult {
    preflight: DocumentPreflight,
    blocked: Option<BlockedReason>,
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FileManagerPlatform {
    MacOs,
    Windows,
    Linux,
}

#[derive(Debug, Eq, PartialEq)]
struct FileManagerCommand {
    program: &'static str,
    args: Vec<OsString>,
}

#[tauri::command]
pub async fn pick_workspace() -> BackendResult<Option<WorkspaceSelection>> {
    let selected = rfd::AsyncFileDialog::new()
        // rfd follows the platform locale for its built-in controls, but this small
        // backend does not receive the React locale. Keep our custom title useful in
        // both supported UI languages without expanding the command contract.
        .set_title("选择工作区 / Open Workspace")
        .pick_folder()
        .await;

    Ok(selected.map(|handle| {
        let path = handle.path();
        WorkspaceSelection {
            path: display_path(path),
            name: path
                .file_name()
                .and_then(OsStr::to_str)
                .unwrap_or("Workspace")
                .to_owned(),
        }
    }))
}

#[tauri::command]
pub async fn pick_image_directory(locale: Option<String>) -> BackendResult<Option<String>> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title(if locale.as_deref() == Some("en-US") {
            "Choose Image Folder"
        } else {
            "选择图片保存目录"
        })
        .pick_folder()
        .await;

    selected
        .map(|handle| clipboard_image::normalize_image_directory(handle.path()))
        .transpose()
        .map(|selected| selected.map(|path| display_path(&path)))
}

#[tauri::command]
pub fn prepare_local_image(app: tauri::AppHandle, path: String) -> BackendResult<String> {
    use tauri::Manager;

    let path = clipboard_image::normalize_local_image(Path::new(&path))?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| BackendError::new("imagePreviewUnavailable", error.to_string()))?;
    Ok(display_path(&path))
}

#[tauri::command]
pub async fn pick_document() -> BackendResult<Option<DocumentSelection>> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("打开文本或代码文件 / Open Text or Code File")
        .add_filter("文本和代码 / Text & Code", SUPPORTED_TEXT_EXTENSIONS)
        .pick_file()
        .await;

    selected
        .map(|handle| {
            let path = handle.path();
            if !is_supported_text_path(path) {
                return Err(BackendError::new(
                    "unsupportedDocument",
                    "selected file type is not supported",
                ));
            }
            Ok(DocumentSelection {
                path: display_path(path),
                name: path
                    .file_name()
                    .and_then(OsStr::to_str)
                    .unwrap_or("未命名")
                    .to_owned(),
            })
        })
        .transpose()
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_workspace(
    root_path: String,
    show_hidden: Option<bool>,
) -> BackendResult<Vec<WorkspaceNode>> {
    list_workspace_path(Path::new(&root_path), show_hidden.unwrap_or(false))
}

#[tauri::command]
pub fn open_document(path: String) -> BackendResult<OpenDocumentResult> {
    open_document_path(Path::new(&path))
}

#[tauri::command]
pub async fn open_external_url(url: String) -> BackendResult<()> {
    tauri::async_runtime::spawn_blocking(move || external_url::open_in_browser(&url))
        .await
        .map_err(|error| BackendError::new("externalOpenFailed", error.to_string()))?
}

#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> BackendResult<()> {
    reveal_in_file_manager_path(Path::new(&path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn move_workspace_entry_to_trash(workspace_root: String, path: String) -> BackendResult<()> {
    move_workspace_entry_to_trash_path(Path::new(&workspace_root), Path::new(&path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_workspace_text_file(
    workspace_root: String,
    directory_path: String,
    file_name: String,
) -> BackendResult<OpenDocumentResult> {
    create_workspace_text_file_path(
        Path::new(&workspace_root),
        Path::new(&directory_path),
        &file_name,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_workspace_folder(
    workspace_root: String,
    directory_path: String,
    folder_name: String,
) -> BackendResult<()> {
    create_workspace_folder_path(
        Path::new(&workspace_root),
        Path::new(&directory_path),
        &folder_name,
    )
}

#[tauri::command(rename_all = "camelCase")]
pub fn preview_local_file(
    reference: String,
    document_path: String,
) -> BackendResult<LocalFilePreview> {
    preview_local_file_path(&reference, Path::new(&document_path))
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_document(
    path: String,
    content: String,
    expected_revision: Option<String>,
) -> BackendResult<SaveDocumentResult> {
    save_document_guarded(Path::new(&path), &content, expected_revision.as_deref())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_document_as(
    suggested_file_name: String,
    content: String,
    excluded_paths: Vec<String>,
) -> BackendResult<Option<SaveDocumentResult>> {
    let suggested_file_name = if suggested_file_name.trim().is_empty() {
        "未命名.md".to_owned()
    } else {
        suggested_file_name
    };
    let selected = rfd::AsyncFileDialog::new()
        .set_title("另存为 / Save As")
        .set_file_name(suggested_file_name)
        .add_filter("文本和代码 / Text & Code", SUPPORTED_TEXT_EXTENSIONS)
        .save_file()
        .await;

    selected
        .map(|handle| save_document_as_path(handle.path(), &content, &excluded_paths))
        .transpose()
}

#[tauri::command(rename_all = "camelCase")]
pub fn set_native_menu_locale(app: tauri::AppHandle, locale: String) -> BackendResult<()> {
    crate::native_menu::replace_native_menu(&app, &locale)
        .map_err(|error| BackendError::new("nativeMenu", error.to_string()))
}

fn save_document_path(path: &Path, content: &str) -> BackendResult<SaveDocumentResult> {
    save_document_guarded(path, content, None)
}

fn save_document_guarded(
    path: &Path,
    content: &str,
    expected_revision: Option<&str>,
) -> BackendResult<SaveDocumentResult> {
    save_document_guarded_with_hook(path, content, expected_revision, || {})
}

fn save_document_guarded_with_hook(
    path: &Path,
    content: &str,
    expected_revision: Option<&str>,
    before_commit: impl FnOnce(),
) -> BackendResult<SaveDocumentResult> {
    filesystem::check_expected_revision(path, expected_revision)?;
    let mut conflict = None;
    let result = atomic_write_with_hook(path, content.as_bytes(), |_| {
        before_commit();
        if let Err(error) = filesystem::check_expected_revision(path, expected_revision) {
            conflict = Some(error);
            return Err(io::Error::other("document changed before replacement"));
        }
        Ok(())
    });
    if let Some(error) = conflict {
        return Err(error);
    }
    let metadata = result.map_err(|error| BackendError::io("save failed", error))?;

    Ok(SaveDocumentResult {
        path: display_path(path),
        bytes_written: content.len() as u64,
        disk_revision: filesystem::metadata_revision(&metadata),
    })
}

fn save_document_as_path(
    path: &Path,
    content: &str,
    excluded_paths: &[String],
) -> BackendResult<SaveDocumentResult> {
    if save_target_is_excluded(path, excluded_paths) {
        return Err(BackendError::new(
            "saveTargetAlreadyOpen",
            "target file is already open in another document session",
        ));
    }

    save_document_path(path, content)
}

fn save_target_is_excluded(target: &Path, excluded_paths: &[String]) -> bool {
    let target = comparable_path(target);

    excluded_paths.iter().any(|excluded| {
        if excluded.contains("://") {
            return false;
        }
        comparable_path(Path::new(excluded)) == target
    })
}

/// Produce a stable comparison path without requiring the selected Save As target to exist yet.
/// Existing files are fully canonicalized; otherwise the parent directory is canonicalized before
/// the final file name is appended.
fn comparable_path(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map(|directory| directory.join(path))
            .unwrap_or_else(|_| path.to_path_buf())
    };

    if let Ok(canonical) = absolute.canonicalize() {
        return canonical;
    }

    if let (Some(parent), Some(file_name)) = (absolute.parent(), absolute.file_name()) {
        if let Ok(canonical_parent) = parent.canonicalize() {
            return canonical_parent.join(file_name);
        }
    }

    absolute
}

#[tauri::command(rename_all = "camelCase")]
pub async fn save_clipboard_image(
    app: tauri::AppHandle,
    document_path: String,
    directory_path: Option<String>,
) -> BackendResult<SavedClipboardImage> {
    use tauri::Manager;

    let saved = tauri::async_runtime::spawn_blocking(move || {
        clipboard_image::save_system_clipboard_image(
            Path::new(&document_path),
            directory_path.as_deref().map(Path::new),
        )
    })
    .await
    .map_err(|error| BackendError::new("clipboardUnavailable", error.to_string()))??;

    // Explicit custom folders may be outside the default HOME asset scope. Only
    // the image just written becomes readable, never the whole chosen directory.
    app.asset_protocol_scope()
        .allow_file(&saved.path)
        .map_err(|error| BackendError::new("imagePreviewUnavailable", error.to_string()))?;
    Ok(saved)
}

#[tauri::command]
pub async fn clipboard_has_image() -> BackendResult<bool> {
    tauri::async_runtime::spawn_blocking(clipboard_image::has_system_clipboard_image)
        .await
        .map_err(|error| BackendError::new("clipboardUnavailable", error.to_string()))?
}

fn list_workspace_path(root: &Path, show_hidden: bool) -> BackendResult<Vec<WorkspaceNode>> {
    let root = root
        .canonicalize()
        .map_err(|error| BackendError::io("workspace could not be opened", error))?;
    if !root.is_dir() {
        return Err(BackendError::new(
            "notDirectory",
            "selected workspace is not a directory",
        ));
    }

    collect_workspace_nodes(&root, &root, show_hidden)
        .map_err(|error| BackendError::io("workspace could not be listed", error))
}

fn workspace_creation_directory(
    workspace_root: &Path,
    directory_path: &Path,
) -> BackendResult<PathBuf> {
    let workspace_root = workspace_root
        .canonicalize()
        .map_err(|error| BackendError::io("workspace could not be opened", error))?;
    if !workspace_root.is_dir() {
        return Err(BackendError::new(
            "notDirectory",
            "selected workspace is not a directory",
        ));
    }

    let requested_directory = if directory_path.is_absolute() {
        directory_path.to_path_buf()
    } else {
        workspace_root.join(directory_path)
    };
    let directory = requested_directory
        .canonicalize()
        .map_err(|error| BackendError::io("target directory could not be opened", error))?;
    if !directory.is_dir() {
        return Err(BackendError::new(
            "notDirectory",
            "target parent is not a directory",
        ));
    }
    if !directory.starts_with(&workspace_root) {
        return Err(BackendError::new(
            "outsideWorkspace",
            "target directory must be inside the selected workspace",
        ));
    }

    Ok(directory)
}

fn is_single_workspace_entry_name(name: &str) -> bool {
    let mut components = Path::new(name).components();
    matches!(components.next(), Some(Component::Normal(_)))
        && components.next().is_none()
        && !name.trim().is_empty()
        && !name.contains(['/', '\\', '\0'])
}

fn create_workspace_folder_path(
    workspace_root: &Path,
    directory_path: &Path,
    folder_name: &str,
) -> BackendResult<()> {
    let directory = workspace_creation_directory(workspace_root, directory_path)?;
    if !is_single_workspace_entry_name(folder_name) {
        return Err(BackendError::new(
            "invalidFolderName",
            "folder name must be a single non-empty name",
        ));
    }

    fs::create_dir(directory.join(folder_name)).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            BackendError::new(
                "folderAlreadyExists",
                "a file or folder with that name already exists",
            )
        } else {
            BackendError::io("folder could not be created", error)
        }
    })
}

fn create_workspace_text_file_path(
    workspace_root: &Path,
    directory_path: &Path,
    file_name: &str,
) -> BackendResult<OpenDocumentResult> {
    let directory = workspace_creation_directory(workspace_root, directory_path)?;
    if !is_single_workspace_entry_name(file_name) {
        return Err(BackendError::new(
            "invalidFileName",
            "file name must be a single non-empty name",
        ));
    }

    let target = directory.join(file_name);
    if !is_supported_text_path(&target) {
        return Err(BackendError::new(
            "unsupportedDocument",
            "file name must use a supported text or code extension",
        ));
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                BackendError::new("fileAlreadyExists", "target file already exists")
            } else {
                BackendError::io("text file could not be created", error)
            }
        })?;
    file.flush()
        .map_err(|error| BackendError::io("text file could not be created", error))?;
    drop(file);

    open_document_path(&target)
}

fn reveal_in_file_manager_path(path: &Path) -> BackendResult<()> {
    if path.as_os_str().is_empty() {
        return Err(BackendError::new(
            "invalidPath",
            "path to reveal must not be empty",
        ));
    }
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| BackendError::io("current directory could not be read", error))?
            .join(path)
    };
    let metadata = fs::metadata(&path).map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            BackendError::new("pathNotFound", "path to reveal does not exist")
        } else {
            BackendError::io("path could not be revealed", error)
        }
    })?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(BackendError::new(
            "unsupportedPath",
            "only files and directories can be revealed",
        ));
    }
    let command = file_manager_command(&path, metadata.is_dir(), current_file_manager_platform()?)?;
    let status = Command::new(command.program)
        .args(command.args)
        .status()
        .map_err(|error| BackendError::new("revealFailed", error.to_string()))?;

    if status.success() {
        Ok(())
    } else {
        Err(BackendError::new(
            "revealFailed",
            format!("file manager exited with status {status}"),
        ))
    }
}

fn move_workspace_entry_to_trash_path(workspace_root: &Path, path: &Path) -> BackendResult<()> {
    move_workspace_entry_to_trash_path_with(workspace_root, path, |target| {
        trash::delete(target).map_err(|error| error.to_string())
    })
}

fn move_workspace_entry_to_trash_path_with<F>(
    workspace_root: &Path,
    path: &Path,
    move_to_trash: F,
) -> BackendResult<()>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    let workspace_root = workspace_root
        .canonicalize()
        .map_err(|error| BackendError::io("workspace could not be opened", error))?;
    if !workspace_root.is_dir() {
        return Err(BackendError::new(
            "notDirectory",
            "selected workspace is not a directory",
        ));
    }

    let requested_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        workspace_root.join(path)
    };
    let target = requested_path.canonicalize().map_err(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            BackendError::new("pathNotFound", "workspace entry does not exist")
        } else {
            BackendError::io("workspace entry could not be opened", error)
        }
    })?;

    if target == workspace_root {
        return Err(BackendError::new(
            "workspaceRootDeletionDenied",
            "the workspace root cannot be moved to the trash",
        ));
    }
    if !target.starts_with(&workspace_root) {
        return Err(BackendError::new(
            "outsideWorkspace",
            "only entries inside the selected workspace can be moved to the trash",
        ));
    }

    let metadata = fs::metadata(&target)
        .map_err(|error| BackendError::io("workspace entry could not be inspected", error))?;
    if !metadata.is_file() && !metadata.is_dir() {
        return Err(BackendError::new(
            "unsupportedPath",
            "only files and directories can be moved to the trash",
        ));
    }

    move_to_trash(&target)
        .map_err(|error| BackendError::new("trashFailed", format!("delete failed: {error}")))
}

fn current_file_manager_platform() -> BackendResult<FileManagerPlatform> {
    #[cfg(target_os = "macos")]
    {
        return Ok(FileManagerPlatform::MacOs);
    }
    #[cfg(target_os = "windows")]
    {
        return Ok(FileManagerPlatform::Windows);
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return Ok(FileManagerPlatform::Linux);
    }
    #[allow(unreachable_code)]
    Err(BackendError::new(
        "fileManagerUnsupported",
        "opening the system file manager is not supported on this platform",
    ))
}

fn file_manager_command(
    path: &Path,
    is_directory: bool,
    platform: FileManagerPlatform,
) -> BackendResult<FileManagerCommand> {
    match platform {
        FileManagerPlatform::MacOs => Ok(FileManagerCommand {
            program: "open",
            args: if is_directory {
                vec![path.as_os_str().to_owned()]
            } else {
                vec![OsString::from("-R"), path.as_os_str().to_owned()]
            },
        }),
        FileManagerPlatform::Windows => Ok(FileManagerCommand {
            program: "explorer.exe",
            args: if is_directory {
                vec![path.as_os_str().to_owned()]
            } else {
                // Explorer expects `/select,<path>` as one command-line argument.
                // `Command` performs Windows quoting for spaces; keeping the prefix
                // and path in one OsString preserves the required comma syntax.
                let mut select = OsString::from("/select,");
                select.push(path.as_os_str());
                vec![select]
            },
        }),
        FileManagerPlatform::Linux => {
            let target = if is_directory {
                path
            } else {
                path.parent().ok_or_else(|| {
                    BackendError::new("fileManager", "file has no parent directory to reveal")
                })?
            };
            Ok(FileManagerCommand {
                program: "xdg-open",
                args: vec![target.as_os_str().to_owned()],
            })
        }
    }
}

fn collect_workspace_nodes(
    root: &Path,
    directory: &Path,
    show_hidden: bool,
) -> io::Result<Vec<WorkspaceNode>> {
    let mut nodes = Vec::new();

    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if !show_hidden && name.starts_with('.') {
            continue;
        }
        if file_type.is_dir() {
            if is_ignored_workspace_directory(&name) {
                continue;
            }
            nodes.push(WorkspaceNode {
                name,
                path: display_path(&path),
                relative_path: relative_display_path(root, &path),
                kind: WorkspaceNodeKind::Directory,
                children: collect_workspace_nodes(root, &path, show_hidden)?,
            });
        } else if file_type.is_file() && is_supported_text_path(&path) {
            nodes.push(WorkspaceNode {
                name,
                path: display_path(&path),
                relative_path: relative_display_path(root, &path),
                kind: if is_markdown_path(&path) {
                    WorkspaceNodeKind::Markdown
                } else {
                    WorkspaceNodeKind::Text
                },
                children: Vec::new(),
            });
        }
    }

    nodes.sort_by(|left, right| {
        let left_rank = !matches!(left.kind, WorkspaceNodeKind::Directory);
        let right_rank = !matches!(right.kind, WorkspaceNodeKind::Directory);
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(nodes)
}

fn is_markdown_path(path: &Path) -> bool {
    text_extension(path).is_some_and(|extension| {
        extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
    })
}

fn is_ignored_workspace_directory(name: &str) -> bool {
    matches!(
        name,
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
    )
}

fn is_supported_text_path(path: &Path) -> bool {
    text_extension(path).is_some_and(|extension| language_for_extension(extension).is_some())
}

fn language_for_path(path: &Path) -> String {
    text_extension(path)
        .and_then(language_for_extension)
        .unwrap_or("text")
        .to_owned()
}

/// Return the ordinary extension, or the complete name of a bare dotfile as an
/// extension. `Path::extension` intentionally reports no extension for `.env`;
/// treating that name like `settings.env` keeps creation, listing, opening and
/// language detection on the same central registry.
fn text_extension(path: &Path) -> Option<&str> {
    path.extension().and_then(OsStr::to_str).or_else(|| {
        let name = path.file_name()?.to_str()?;
        let dotfile_extension = name.strip_prefix('.')?;
        (!dotfile_extension.is_empty() && !dotfile_extension.contains('.'))
            .then_some(dotfile_extension)
    })
}

fn language_for_extension(extension: &str) -> Option<&'static str> {
    Some(match extension.to_ascii_lowercase().as_str() {
        "md" | "markdown" => "markdown",
        "py" | "pyw" => "python",
        "rs" => "rust",
        "js" | "mjs" | "cjs" => "javascript",
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "tsx",
        "jsx" => "jsx",
        "json" | "jsonc" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "sh" | "bash" | "zsh" | "fish" => "shell",
        "sql" => "sql",
        "java" => "java",
        "cs" => "csharp",
        "go" => "go",
        "rb" => "ruby",
        "php" => "php",
        "swift" => "swift",
        "kt" | "kts" => "kotlin",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => "cpp",
        "css" | "scss" | "sass" | "less" => "css",
        "html" | "htm" => "html",
        "xml" | "svg" => "xml",
        "vue" => "vue",
        "svelte" => "svelte",
        "lua" => "lua",
        "dart" => "dart",
        "scala" => "scala",
        "groovy" => "groovy",
        "pl" | "pm" => "perl",
        "proto" => "protobuf",
        "graphql" | "gql" => "graphql",
        "ini" | "conf" | "cfg" | "properties" | "env" => "config",
        "txt" | "log" | "csv" | "tsv" => "text",
        _ => return None,
    })
}

fn relative_display_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn open_document_path(path: &Path) -> BackendResult<OpenDocumentResult> {
    open_document_with_hook(path, || {})
}

fn open_document_with_hook(
    path: &Path,
    after_preflight: impl FnOnce(),
) -> BackendResult<OpenDocumentResult> {
    let mut file = File::open(path)
        .map_err(|error| BackendError::io("document could not be opened", error))?;
    let metadata = file
        .metadata()
        .map_err(|error| BackendError::io("document metadata could not be read", error))?;
    if !metadata.is_file() {
        return Err(BackendError::new(
            "notFile",
            "selected document is not a file",
        ));
    }
    let revision = filesystem::metadata_revision(&metadata);
    let mut scan = scan_document_file(&mut file, metadata.len(), None)?;
    let display = display_path(path);
    let document_kind = if is_markdown_path(path) {
        DocumentKind::Markdown
    } else {
        DocumentKind::Text
    };
    let language = language_for_path(path);

    if let Some(reason) = scan.blocked {
        return Ok(OpenDocumentResult::Blocked {
            path: display,
            reason,
            preflight: scan.preflight,
        });
    }

    after_preflight();
    file.rewind()
        .map_err(|error| BackendError::io("document could not be rewound", error))?;
    // Validate the actual second-pass bytes too: in-place writes must never bypass
    // the bounded preflight, even before the final metadata consistency check.
    let mut bytes = Vec::new();
    scan = scan_document_file(&mut file, metadata.len(), Some(&mut bytes))?;
    if let Some(reason) = scan.blocked {
        return Ok(OpenDocumentResult::Blocked {
            path: display,
            reason,
            preflight: scan.preflight,
        });
    }
    let read_metadata = file
        .metadata()
        .map_err(|error| BackendError::io("document metadata could not be read", error))?;
    if filesystem::metadata_revision(&read_metadata) != revision {
        return Err(filesystem::external_change_error());
    }
    filesystem::check_expected_revision(path, Some(&revision))?;
    let content = String::from_utf8(bytes).map_err(|_| {
        BackendError::new(
            "documentChanged",
            "document changed during preflight and is no longer valid UTF-8",
        )
    })?;
    let mode = if scan.preflight.size_bytes > NORMAL_FILE_BYTES
        || scan.preflight.longest_line_bytes > NORMAL_LINE_BYTES
    {
        DocumentMode::SourceOnly
    } else {
        DocumentMode::Normal
    };

    Ok(OpenDocumentResult::Editable {
        path: display,
        content,
        mode,
        document_kind,
        language,
        preflight: scan.preflight,
        disk_revision: revision,
    })
}

fn preview_local_file_path(
    reference: &str,
    document_path: &Path,
) -> BackendResult<LocalFilePreview> {
    let (reference_path, target_line) = parse_local_file_reference(reference)?;
    let path = resolve_local_file_path(&reference_path, document_path).ok_or_else(|| {
        BackendError::new(
            "localFileNotFound",
            format!("referenced file does not exist: {reference_path}"),
        )
    })?;
    if !path.is_file() {
        return Err(BackendError::new(
            "localFileNotFile",
            "referenced path is not a file",
        ));
    }

    let start_line = target_line
        .map(|line| line.saturating_sub(PREVIEW_CONTEXT_LINES).max(1))
        .unwrap_or(1);
    let end_line = target_line
        .map(|line| line.saturating_add(PREVIEW_CONTEXT_LINES))
        .unwrap_or(PREVIEW_DEFAULT_LINES);
    let file = File::open(&path)
        .map_err(|error| BackendError::io("referenced file could not be opened", error))?;
    let mut preview_lines = Vec::new();

    for (index, line) in BufReader::new(file).lines().enumerate() {
        let line_number = index + 1;
        if line_number > end_line {
            break;
        }
        let line = line.map_err(|error| {
            BackendError::new(
                "localFileNotText",
                format!("referenced file is not readable UTF-8 text: {error}"),
            )
        })?;
        if line_number >= start_line {
            preview_lines.push(truncate_preview_line(&line));
        }
    }

    if preview_lines.is_empty() && start_line > 1 {
        return Err(BackendError::new(
            "localFileLineMissing",
            format!("referenced line {start_line} is outside the file"),
        ));
    }

    Ok(LocalFilePreview {
        path: display_path(&path),
        language: language_for_path(&path),
        target_line,
        start_line,
        content: preview_lines.join("\n"),
    })
}

fn parse_local_file_reference(reference: &str) -> BackendResult<(String, Option<usize>)> {
    let mut value = reference.trim().trim_matches('`').trim();
    if value.starts_with('<') && value.ends_with('>') && value.len() > 2 {
        value = &value[1..value.len() - 1];
    }
    let value = value.replace("%20", " ");
    let (path, target_line) = match value.rsplit_once(':') {
        Some((path, suffix))
            if !path.is_empty() && suffix.chars().all(|ch| ch.is_ascii_digit()) =>
        {
            let line = suffix.parse::<usize>().ok().filter(|line| *line > 0);
            (path.to_owned(), line)
        }
        _ => (value, None),
    };
    if path.trim().is_empty() {
        return Err(BackendError::new(
            "invalidLocalFileReference",
            "local file reference is empty",
        ));
    }
    Ok((path, target_line))
}

fn resolve_local_file_path(reference: &str, document_path: &Path) -> Option<PathBuf> {
    let path = PathBuf::from(reference);
    if path.is_absolute() {
        return path.exists().then(|| path.canonicalize().unwrap_or(path));
    }

    let base = document_path.parent()?;
    for ancestor in base.ancestors() {
        let candidate = ancestor.join(&path);
        if candidate.exists() {
            return Some(candidate.canonicalize().unwrap_or(candidate));
        }
    }
    None
}

fn truncate_preview_line(line: &str) -> String {
    let mut characters = line.chars();
    let prefix = characters
        .by_ref()
        .take(PREVIEW_LINE_CHARS)
        .collect::<String>();
    if characters.next().is_some() {
        format!("{prefix} …")
    } else {
        prefix
    }
}

fn scan_document_file(
    file: &mut File,
    expected_size: u64,
    mut content: Option<&mut Vec<u8>>,
) -> BackendResult<ScanResult> {
    let mut buffer = vec![0_u8; SCAN_BUFFER_BYTES];
    let mut utf8 = Utf8StreamValidator::default();
    let mut line = LineScanner::default();
    let mut bytes_read = 0_u64;

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| BackendError::io("document preflight failed", error))?;
        if read == 0 {
            break;
        }

        bytes_read += read as u64;
        if !utf8.push(&buffer[..read]) {
            return Ok(ScanResult {
                preflight: line.report(expected_size.max(bytes_read)),
                blocked: Some(BlockedReason::InvalidUtf8),
            });
        }

        if let Some(reason) = line.push(&buffer[..read]) {
            return Ok(ScanResult {
                preflight: line.report(expected_size.max(bytes_read)),
                blocked: Some(reason),
            });
        }
        if let Some(bytes) = content.as_mut() {
            bytes.extend_from_slice(&buffer[..read]);
        }
    }

    let blocked = if utf8.finish() {
        line.finish()
    } else {
        Some(BlockedReason::InvalidUtf8)
    };
    Ok(ScanResult {
        preflight: line.report(bytes_read),
        blocked,
    })
}

#[derive(Default)]
struct Utf8StreamValidator {
    carry: Vec<u8>,
}

impl Utf8StreamValidator {
    fn push(&mut self, chunk: &[u8]) -> bool {
        let mut combined = Vec::with_capacity(self.carry.len() + chunk.len());
        combined.extend_from_slice(&self.carry);
        combined.extend_from_slice(chunk);
        self.carry.clear();

        match std::str::from_utf8(&combined) {
            Ok(_) => true,
            Err(error) if error.error_len().is_none() => {
                let incomplete = &combined[error.valid_up_to()..];
                if incomplete.len() > 3 {
                    return false;
                }
                self.carry.extend_from_slice(incomplete);
                true
            }
            Err(_) => false,
        }
    }

    fn finish(&self) -> bool {
        self.carry.is_empty()
    }
}

#[derive(Default)]
struct LineScanner {
    current_line_bytes: u64,
    longest_line_bytes: u64,
    data_prefix_match: usize,
    base64_match: usize,
    saw_data_prefix_on_line: bool,
    current_line_has_data_image_base64: bool,
    contains_data_image_base64: bool,
}

impl LineScanner {
    fn push(&mut self, bytes: &[u8]) -> Option<BlockedReason> {
        for &byte in bytes {
            if byte == b'\n' {
                self.longest_line_bytes = self.longest_line_bytes.max(self.current_line_bytes);
                self.reset_line();
                continue;
            }

            self.current_line_bytes += 1;
            let ascii = byte.to_ascii_lowercase();
            if !self.saw_data_prefix_on_line {
                if advance_match(&mut self.data_prefix_match, DATA_IMAGE_PREFIX, ascii) {
                    self.saw_data_prefix_on_line = true;
                    self.base64_match = 0;
                }
            } else if !self.current_line_has_data_image_base64
                && advance_match(&mut self.base64_match, BASE64_MARKER, ascii)
            {
                self.current_line_has_data_image_base64 = true;
                self.contains_data_image_base64 = true;
            }

            self.longest_line_bytes = self.longest_line_bytes.max(self.current_line_bytes);
            if self.current_line_bytes > BLOCK_LINE_BYTES {
                return Some(BlockedReason::LineTooLong);
            }
            if self.current_line_has_data_image_base64
                && self.current_line_bytes > BLOCK_DATA_URI_LINE_BYTES
            {
                return Some(BlockedReason::LargeDataUri);
            }
        }
        None
    }

    fn finish(&mut self) -> Option<BlockedReason> {
        self.longest_line_bytes = self.longest_line_bytes.max(self.current_line_bytes);
        if self.current_line_bytes > BLOCK_LINE_BYTES {
            Some(BlockedReason::LineTooLong)
        } else if self.current_line_has_data_image_base64
            && self.current_line_bytes > BLOCK_DATA_URI_LINE_BYTES
        {
            Some(BlockedReason::LargeDataUri)
        } else {
            None
        }
    }

    fn report(&self, size_bytes: u64) -> DocumentPreflight {
        DocumentPreflight {
            size_bytes,
            longest_line_bytes: self.longest_line_bytes.max(self.current_line_bytes),
            contains_data_image_base64: self.contains_data_image_base64,
        }
    }

    fn reset_line(&mut self) {
        self.current_line_bytes = 0;
        self.data_prefix_match = 0;
        self.base64_match = 0;
        self.saw_data_prefix_on_line = false;
        self.current_line_has_data_image_base64 = false;
    }
}

fn advance_match(matched: &mut usize, pattern: &[u8], byte: u8) -> bool {
    if byte == pattern[*matched] {
        *matched += 1;
    } else {
        *matched = usize::from(byte == pattern[0]);
    }

    if *matched == pattern.len() {
        *matched = 0;
        true
    } else {
        false
    }
}

#[cfg(test)]
fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    atomic_write_with_hook(path, bytes, |_| Ok(())).map(|_| ())
}

fn atomic_write_with_hook<F>(
    path: &Path,
    bytes: &[u8],
    before_rename: F,
) -> io::Result<fs::Metadata>
where
    F: FnOnce(&Path) -> io::Result<()>,
{
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "path has no parent directory")
        })?;
    if !parent.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "parent directory does not exist",
        ));
    }

    let (temp_path, mut temp_file) = create_temp_file(parent, path.file_name())?;
    let result = (|| {
        if let Ok(metadata) = fs::metadata(path) {
            temp_file.set_permissions(metadata.permissions())?;
        }
        temp_file.write_all(bytes)?;
        temp_file.flush()?;
        temp_file.sync_all()?;
        before_rename(&temp_path)?;
        fs::rename(&temp_path, path)?;
        // Read the handle we wrote, not the target path which an external editor
        // could already have replaced again after our rename.
        temp_file.metadata()
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

fn create_temp_file(parent: &Path, target_name: Option<&OsStr>) -> io::Result<(PathBuf, File)> {
    let target_name = target_name.and_then(OsStr::to_str).unwrap_or("document");
    for _ in 0..16 {
        let counter = UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(
            ".{target_name}.markdown-workspace-{}-{counter}.tmp",
            std::process::id()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not allocate a temporary file",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    pub(super) struct TestDirectory(PathBuf);

    impl TestDirectory {
        pub(super) fn new(label: &str) -> Self {
            let counter = UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "markdown-workspace-{label}-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create isolated test directory");
            Self(path)
        }

        pub(super) fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_repeated(file: &mut File, bytes: &[u8], total: usize) {
        let mut remaining = total;
        while remaining > 0 {
            let count = remaining.min(bytes.len());
            file.write_all(&bytes[..count]).expect("write fixture");
            remaining -= count;
        }
        file.flush().expect("flush fixture");
    }

    #[test]
    fn list_workspace_returns_sorted_directories_markdown_and_code_files() {
        let temp = TestDirectory::new("workspace-list");
        fs::create_dir(temp.path().join("guides")).expect("create guides");
        fs::create_dir(temp.path().join(".git")).expect("create git directory");
        fs::write(temp.path().join("readme.md"), "# Readme").expect("write markdown");
        fs::write(temp.path().join("notes.MARKDOWN"), "notes").expect("write markdown");
        fs::write(temp.path().join("notes.txt"), "notes").expect("write text");
        fs::write(temp.path().join("worker.py"), "print('ok')").expect("write code");
        fs::write(temp.path().join("ignored.bin"), [0_u8, 1, 2]).expect("write binary");
        fs::write(temp.path().join("guides").join("start.md"), "start")
            .expect("write nested markdown");

        let nodes = list_workspace_path(temp.path(), false).expect("list workspace");

        assert_eq!(nodes.len(), 5);
        assert_eq!(nodes[0].kind, WorkspaceNodeKind::Directory);
        assert_eq!(nodes[0].relative_path, "guides");
        assert_eq!(nodes[0].children.len(), 1);
        assert_eq!(nodes[0].children[0].relative_path, "guides/start.md");
        assert_eq!(nodes[1].name, "notes.MARKDOWN");
        assert_eq!(nodes[2].name, "notes.txt");
        assert_eq!(nodes[2].kind, WorkspaceNodeKind::Text);
        assert_eq!(nodes[3].name, "readme.md");
        assert_eq!(nodes[4].name, "worker.py");
    }

    #[test]
    fn list_workspace_hidden_flag_applies_recursively_and_preserves_heavy_directory_exclusions() {
        fn paths(nodes: &[WorkspaceNode]) -> Vec<String> {
            nodes
                .iter()
                .flat_map(|node| {
                    std::iter::once(node.relative_path.clone()).chain(paths(&node.children))
                })
                .collect()
        }

        let temp = TestDirectory::new("workspace-hidden");
        for directory in ["visible/.nested", ".private/inner", ".empty"] {
            fs::create_dir_all(temp.path().join(directory)).expect("create fixture folder");
        }
        for file in [
            "readme.md",
            ".env",
            ".config.json",
            "visible/guide.md",
            "visible/.notes.md",
            "visible/.nested/example.py",
            ".private/inner/note.md",
        ] {
            fs::write(temp.path().join(file), "fixture").expect("write text fixture");
        }
        fs::write(temp.path().join(".unknown"), "fixture").expect("write unknown suffix");
        fs::write(temp.path().join(".binary.bin"), [0_u8, 1, 2]).expect("write binary fixture");
        for directory in [
            ".git",
            ".hg",
            ".svn",
            "node_modules",
            ".venv",
            "venv",
            "target",
            "dist",
            "build",
            "__pycache__",
        ] {
            fs::create_dir_all(temp.path().join("visible").join(directory))
                .expect("create excluded folder");
            fs::write(
                temp.path()
                    .join("visible")
                    .join(directory)
                    .join("ignored.md"),
                "ignored",
            )
            .expect("write excluded fixture");
        }

        let default_nodes =
            list_workspace(display_path(temp.path()), None).expect("list legacy request");
        assert_eq!(
            paths(&default_nodes),
            vec!["visible", "visible/guide.md", "readme.md"]
        );
        assert_eq!(
            paths(&list_workspace_path(temp.path(), false).expect("explicit hidden off")),
            paths(&default_nodes)
        );

        let shown = paths(&list_workspace_path(temp.path(), true).expect("show hidden entries"));
        for path in [
            ".env",
            ".config.json",
            ".empty",
            ".private",
            ".private/inner/note.md",
            "visible/.notes.md",
            "visible/.nested/example.py",
        ] {
            assert!(
                shown.contains(&path.to_owned()),
                "missing hidden entry {path}"
            );
        }
        assert!(!shown.iter().any(|path| path.ends_with("ignored.md")));
        assert!(!shown.contains(&".unknown".to_owned()));
        assert!(!shown.contains(&".binary.bin".to_owned()));
        assert_eq!(
            paths(&list_workspace_path(temp.path(), false).expect("hide entries again")),
            paths(&default_nodes)
        );
    }

    #[cfg(unix)]
    #[test]
    fn list_workspace_show_hidden_still_excludes_symlinks() {
        let temp = TestDirectory::new("workspace-hidden-symlink");
        fs::create_dir(temp.path().join("real")).expect("create real folder");
        fs::write(temp.path().join("real/note.md"), "fixture").expect("write text fixture");
        std::os::unix::fs::symlink(temp.path().join("real"), temp.path().join(".linked-folder"))
            .expect("create folder symlink");
        std::os::unix::fs::symlink(
            temp.path().join("real/note.md"),
            temp.path().join(".linked.md"),
        )
        .expect("create file symlink");

        let nodes = list_workspace_path(temp.path(), true).expect("list without symlinks");
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].name, "real");
        assert_eq!(nodes[0].children[0].name, "note.md");
    }

    #[test]
    fn create_workspace_text_file_creates_and_opens_utf8_document_in_subdirectory() {
        let temp = TestDirectory::new("create-workspace-file");
        fs::create_dir(temp.path().join("guides")).expect("create guides directory");

        let result = create_workspace_text_file_path(temp.path(), Path::new("guides"), "新文档.md")
            .expect("create workspace document");
        let target = temp
            .path()
            .join("guides")
            .join("新文档.md")
            .canonicalize()
            .expect("canonicalize new document");

        assert_eq!(fs::read_to_string(&target).expect("read new file"), "");
        match result {
            OpenDocumentResult::Editable {
                path,
                content,
                document_kind,
                language,
                mode,
                ..
            } => {
                assert_eq!(path, display_path(&target));
                assert_eq!(content, "");
                assert_eq!(document_kind, DocumentKind::Markdown);
                assert_eq!(language, "markdown");
                assert_eq!(mode, DocumentMode::Normal);
            }
            OpenDocumentResult::Blocked { .. } => panic!("empty UTF-8 document was blocked"),
        }

        let code_result =
            create_workspace_text_file_path(temp.path(), temp.path(), "任务 worker.py")
                .expect("create workspace code file");
        match code_result {
            OpenDocumentResult::Editable {
                document_kind,
                language,
                preflight,
                ..
            } => {
                assert_eq!(document_kind, DocumentKind::Text);
                assert_eq!(language, "python");
                assert_eq!(preflight.size_bytes, 0);
            }
            OpenDocumentResult::Blocked { .. } => panic!("empty UTF-8 code file was blocked"),
        }
    }

    #[test]
    fn create_workspace_text_file_supports_registered_bare_dotfiles() {
        let temp = TestDirectory::new("create-workspace-dotfile");

        let result = create_workspace_text_file_path(temp.path(), temp.path(), ".env")
            .expect("create registered dotfile");
        let target = temp
            .path()
            .join(".env")
            .canonicalize()
            .expect("canonicalize dotfile");

        assert_eq!(fs::read_to_string(&target).expect("read dotfile"), "");
        match result {
            OpenDocumentResult::Editable {
                path,
                document_kind,
                language,
                ..
            } => {
                assert_eq!(path, display_path(&target));
                assert_eq!(document_kind, DocumentKind::Text);
                assert_eq!(language, "config");
            }
            OpenDocumentResult::Blocked { .. } => panic!("empty UTF-8 dotfile was blocked"),
        }
    }

    #[test]
    fn editable_document_serializes_document_kind_for_the_typescript_boundary() {
        let result = OpenDocumentResult::Editable {
            path: "/workspace/sample.json".to_owned(),
            content: "{\"ready\":true}".to_owned(),
            mode: DocumentMode::Normal,
            document_kind: DocumentKind::Text,
            language: "json".to_owned(),
            disk_revision: "revision-fixture".to_owned(),
            preflight: DocumentPreflight {
                size_bytes: 14,
                longest_line_bytes: 14,
                contains_data_image_base64: false,
            },
        };

        let body = result.body().expect("serialize IPC response");
        let InvokeResponseBody::Json(json) = body else {
            panic!("serialized document response was not JSON")
        };

        assert!(json.contains("\"status\":\"editable\""));
        assert!(json.contains("\"documentKind\":\"text\""));
        assert!(!json.contains("document_kind"));
        assert!(json.contains("\"diskRevision\":\"revision-fixture\""));
    }

    #[test]
    fn create_workspace_text_file_does_not_overwrite_existing_file() {
        let temp = TestDirectory::new("create-workspace-file-existing");
        let target = temp.path().join("notes.txt");
        fs::write(&target, "keep me").expect("write existing document");

        let error = create_workspace_text_file_path(temp.path(), temp.path(), "notes.txt")
            .expect_err("existing target must not be overwritten");

        assert_eq!(error.code, "fileAlreadyExists");
        assert_eq!(
            fs::read_to_string(target).expect("read existing document"),
            "keep me"
        );
    }

    #[test]
    fn create_workspace_text_file_rejects_outside_parent_and_invalid_names() {
        let workspace = TestDirectory::new("create-workspace-file-root");
        let outside = TestDirectory::new("create-workspace-file-outside");

        let outside_error =
            create_workspace_text_file_path(workspace.path(), outside.path(), "notes.md")
                .expect_err("outside parent must be rejected");
        assert_eq!(outside_error.code, "outsideWorkspace");

        let nested_name_error =
            create_workspace_text_file_path(workspace.path(), workspace.path(), "nested/notes.md")
                .expect_err("nested file name must be rejected");
        assert_eq!(nested_name_error.code, "invalidFileName");

        let unsupported_error =
            create_workspace_text_file_path(workspace.path(), workspace.path(), "image.png")
                .expect_err("unsupported extension must be rejected");
        assert_eq!(unsupported_error.code, "unsupportedDocument");

        let nul_error =
            create_workspace_text_file_path(workspace.path(), workspace.path(), "bad\0name.md")
                .expect_err("NUL file name must be rejected");
        assert_eq!(nul_error.code, "invalidFileName");
    }

    #[test]
    fn create_workspace_folder_creates_empty_unicode_root_and_nested_directories() {
        let workspace = TestDirectory::new("create-workspace-folder");
        create_workspace_folder_path(workspace.path(), workspace.path(), "笔记 目录")
            .expect("create root folder");
        create_workspace_folder_path(workspace.path(), Path::new("笔记 目录"), "子目录")
            .expect("create nested folder");

        let nested = workspace.path().join("笔记 目录").join("子目录");
        assert!(nested.is_dir());
        assert_eq!(fs::read_dir(nested).expect("read empty folder").count(), 0);
        let nodes = list_workspace_path(workspace.path(), false).expect("refresh tree");
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].name, "笔记 目录");
        assert_eq!(nodes[0].kind, WorkspaceNodeKind::Directory);
        assert_eq!(nodes[0].children[0].name, "子目录");
        assert!(nodes[0].children[0].children.is_empty());
    }

    #[test]
    fn create_workspace_folder_does_not_replace_existing_files_or_directories() {
        let workspace = TestDirectory::new("create-workspace-folder-conflict");
        fs::write(workspace.path().join("existing.md"), "keep existing text")
            .expect("create existing file");
        fs::create_dir(workspace.path().join("existing-folder")).expect("create existing folder");
        fs::write(
            workspace.path().join("existing-folder/child.txt"),
            "keep nested text",
        )
        .expect("create nested file");

        for name in ["existing.md", "existing-folder"] {
            let error = create_workspace_folder_path(workspace.path(), workspace.path(), name)
                .expect_err("conflicting target must not be replaced");
            assert_eq!(error.code, "folderAlreadyExists");
        }
        assert_eq!(
            fs::read_to_string(workspace.path().join("existing.md")).unwrap(),
            "keep existing text"
        );
        assert_eq!(
            fs::read_to_string(workspace.path().join("existing-folder/child.txt")).unwrap(),
            "keep nested text"
        );
    }

    #[test]
    fn create_workspace_folder_rejects_invalid_names_and_missing_or_outside_parents() {
        let workspace = TestDirectory::new("create-workspace-folder-root");
        let outside = TestDirectory::new("create-workspace-folder-outside");
        for name in [
            "",
            "  ",
            ".",
            "..",
            "../outside",
            "one/two",
            "one\\two",
            "bad\0name",
        ] {
            let error = create_workspace_folder_path(workspace.path(), workspace.path(), name)
                .expect_err("invalid folder name must be rejected");
            assert_eq!(error.code, "invalidFolderName", "{name:?}");
        }
        assert_eq!(fs::read_dir(workspace.path()).unwrap().count(), 0);
        let error = create_workspace_folder_path(workspace.path(), outside.path(), "escape")
            .expect_err("outside parent must be rejected");
        assert_eq!(error.code, "outsideWorkspace");
        assert!(!outside.path().join("escape").exists());
        assert!(
            create_workspace_folder_path(workspace.path(), Path::new("missing"), "child").is_err()
        );
        assert!(!workspace.path().join("missing").exists());
        fs::write(workspace.path().join("not-folder.txt"), "keep").unwrap();
        let error =
            create_workspace_folder_path(workspace.path(), Path::new("not-folder.txt"), "child")
                .expect_err("file parent must be rejected");
        assert_eq!(error.code, "notDirectory");
    }

    #[cfg(unix)]
    #[test]
    fn create_workspace_folder_rejects_symlink_parent_outside_the_workspace() {
        let workspace = TestDirectory::new("create-workspace-folder-symlink");
        let outside = TestDirectory::new("create-workspace-folder-symlink-outside");
        std::os::unix::fs::symlink(outside.path(), workspace.path().join("linked"))
            .expect("create symlink to outside directory");

        let error = create_workspace_folder_path(workspace.path(), Path::new("linked"), "escape")
            .expect_err("canonical outside parent must be rejected");
        assert_eq!(error.code, "outsideWorkspace");
        assert!(!outside.path().join("escape").exists());
    }

    #[test]
    fn file_manager_commands_match_each_supported_platform() {
        let file = Path::new("/workspace/guide.md");
        let directory = Path::new("/workspace");

        assert_eq!(
            file_manager_command(file, false, FileManagerPlatform::MacOs)
                .expect("macOS reveal command"),
            FileManagerCommand {
                program: "open",
                args: vec![OsString::from("-R"), file.as_os_str().to_owned()],
            }
        );
        assert_eq!(
            file_manager_command(directory, true, FileManagerPlatform::MacOs)
                .expect("macOS open command"),
            FileManagerCommand {
                program: "open",
                args: vec![directory.as_os_str().to_owned()],
            }
        );
        assert_eq!(
            file_manager_command(file, false, FileManagerPlatform::Windows)
                .expect("Windows reveal command"),
            FileManagerCommand {
                program: "explorer.exe",
                args: vec![OsString::from("/select,/workspace/guide.md")],
            }
        );
        assert_eq!(
            file_manager_command(directory, true, FileManagerPlatform::Windows)
                .expect("Windows open command"),
            FileManagerCommand {
                program: "explorer.exe",
                args: vec![directory.as_os_str().to_owned()],
            }
        );
        assert_eq!(
            file_manager_command(file, false, FileManagerPlatform::Linux)
                .expect("Linux open-parent command"),
            FileManagerCommand {
                program: "xdg-open",
                args: vec![directory.as_os_str().to_owned()],
            }
        );
    }

    #[test]
    fn reveal_rejects_a_missing_path_before_launching_file_manager() {
        let temp = TestDirectory::new("reveal-missing");
        let invalid = reveal_in_file_manager_path(Path::new(""))
            .expect_err("empty path must not launch file manager");
        let error = reveal_in_file_manager_path(&temp.path().join("missing.md"))
            .expect_err("missing path must not launch file manager");

        assert_eq!(invalid.code, "invalidPath");
        assert_eq!(error.code, "pathNotFound");
    }

    #[test]
    fn workspace_entry_trash_is_scoped_below_the_selected_root() {
        let workspace = TestDirectory::new("trash-workspace-root");
        let outside = TestDirectory::new("trash-workspace-outside");
        let target = workspace.path().join("old-notes.md");
        fs::write(&target, "recoverable content").expect("write trash target");
        let expected_target = target.canonicalize().expect("canonicalize trash target");
        let mut received_target = None;

        move_workspace_entry_to_trash_path_with(workspace.path(), &target, |resolved_target| {
            received_target = Some(resolved_target.to_path_buf());
            Ok(())
        })
        .expect("accept a file below the workspace root");

        assert_eq!(received_target, Some(expected_target));

        let target_directory = workspace.path().join("old-folder");
        fs::create_dir(&target_directory).expect("create trash target directory");
        let expected_directory = target_directory
            .canonicalize()
            .expect("canonicalize trash target directory");
        let mut received_directory = None;
        move_workspace_entry_to_trash_path_with(
            workspace.path(),
            &target_directory,
            |resolved_target| {
                received_directory = Some(resolved_target.to_path_buf());
                Ok(())
            },
        )
        .expect("accept a directory below the workspace root");
        assert_eq!(received_directory, Some(expected_directory));

        let root_error =
            move_workspace_entry_to_trash_path_with(workspace.path(), workspace.path(), |_| Ok(()))
                .expect_err("workspace root deletion must be rejected");
        assert_eq!(root_error.code, "workspaceRootDeletionDenied");

        let outside_target = outside.path().join("outside.md");
        fs::write(&outside_target, "outside").expect("write outside target");
        let outside_error =
            move_workspace_entry_to_trash_path_with(workspace.path(), &outside_target, |_| Ok(()))
                .expect_err("outside deletion must be rejected");
        assert_eq!(outside_error.code, "outsideWorkspace");

        let missing_error = move_workspace_entry_to_trash_path_with(
            workspace.path(),
            &workspace.path().join("missing.md"),
            |_| Ok(()),
        )
        .expect_err("missing entries must be rejected");
        assert_eq!(missing_error.code, "pathNotFound");
    }

    #[test]
    fn workspace_entry_trash_failure_keeps_the_original_entry() {
        let workspace = TestDirectory::new("trash-workspace-failure");
        let target = workspace.path().join("keep.md");
        fs::write(&target, "keep me").expect("write trash target");

        let error = move_workspace_entry_to_trash_path_with(workspace.path(), &target, |_| {
            Err("recycle bin unavailable".to_owned())
        })
        .expect_err("trash failure must be reported");

        assert_eq!(error.code, "trashFailed");
        assert_eq!(
            fs::read_to_string(target).expect("read preserved target"),
            "keep me"
        );
    }

    #[test]
    fn open_document_returns_normal_utf8_markdown() {
        let temp = TestDirectory::new("open-normal");
        let document = temp.path().join("normal.md");
        fs::write(&document, "# 中文\n\nHello 🌍\n").expect("write markdown");

        let result = open_document_path(&document).expect("open document");
        match result {
            OpenDocumentResult::Editable {
                content,
                document_kind,
                language,
                mode,
                preflight,
                ..
            } => {
                assert_eq!(content, "# 中文\n\nHello 🌍\n");
                assert_eq!(document_kind, DocumentKind::Markdown);
                assert_eq!(language, "markdown");
                assert_eq!(mode, DocumentMode::Normal);
                assert!(!preflight.contains_data_image_base64);
            }
            OpenDocumentResult::Blocked { .. } => panic!("ordinary Markdown was blocked"),
        }
    }

    #[test]
    fn open_ten_mib_multiline_document_in_source_only_mode() {
        let temp = TestDirectory::new("open-large-text");
        let document = temp.path().join("large.md");
        let mut file = File::create(&document).expect("create fixture");
        write_repeated(&mut file, b"ordinary markdown line\n", 10 * 1024 * 1024);

        let result = open_document_path(&document).expect("open document");
        match result {
            OpenDocumentResult::Editable {
                content,
                mode,
                preflight,
                ..
            } => {
                assert_eq!(content.len(), 10 * 1024 * 1024);
                assert_eq!(mode, DocumentMode::SourceOnly);
                assert_eq!(preflight.size_bytes, 10 * 1024 * 1024);
            }
            OpenDocumentResult::Blocked { .. } => panic!("ordinary large text was blocked"),
        }
    }

    #[test]
    fn open_large_data_uri_is_blocked_before_content_result() {
        let temp = TestDirectory::new("open-data-uri");
        let document = temp.path().join("data-uri.md");
        let mut file = File::create(&document).expect("create fixture");
        let padding = SCAN_BUFFER_BYTES - 5;
        write_repeated(&mut file, b"x", padding);
        file.write_all(b"data:image/png;base64,")
            .expect("write data URI prefix");
        write_repeated(&mut file, b"A", 10 * 1024 * 1024);

        let result = open_document_path(&document).expect("preflight document");
        match result {
            OpenDocumentResult::Blocked {
                reason, preflight, ..
            } => {
                assert_eq!(reason, BlockedReason::LargeDataUri);
                assert!(preflight.contains_data_image_base64);
                assert!(preflight.longest_line_bytes > BLOCK_DATA_URI_LINE_BYTES);
            }
            OpenDocumentResult::Editable { .. } => panic!("large data URI entered editable result"),
        }
    }

    #[test]
    fn small_data_uri_does_not_taint_a_later_ordinary_line() {
        let temp = TestDirectory::new("open-small-data-uri");
        let document = temp.path().join("small-data-uri.md");
        let mut file = File::create(&document).expect("create fixture");
        file.write_all(b"![tiny](data:image/png;base64,AAAA)\n")
            .expect("write small data URI");
        write_repeated(&mut file, b"x", BLOCK_DATA_URI_LINE_BYTES as usize + 1);

        let result = open_document_path(&document).expect("preflight document");
        match result {
            OpenDocumentResult::Editable {
                mode, preflight, ..
            } => {
                assert_eq!(mode, DocumentMode::SourceOnly);
                assert!(preflight.contains_data_image_base64);
            }
            OpenDocumentResult::Blocked { .. } => {
                panic!("small data URI tainted an unrelated line")
            }
        }
    }

    #[test]
    fn open_extreme_non_data_line_is_blocked() {
        let temp = TestDirectory::new("open-long-line");
        let document = temp.path().join("long-line.md");
        let mut file = File::create(&document).expect("create fixture");
        write_repeated(&mut file, b"x", BLOCK_LINE_BYTES as usize + 1);

        let result = open_document_path(&document).expect("preflight document");
        match result {
            OpenDocumentResult::Blocked { reason, .. } => {
                assert_eq!(reason, BlockedReason::LineTooLong);
            }
            OpenDocumentResult::Editable { .. } => panic!("extreme line entered editable result"),
        }
    }

    #[test]
    fn invalid_utf8_is_blocked() {
        let temp = TestDirectory::new("open-invalid-utf8");
        let document = temp.path().join("invalid.md");
        fs::write(&document, [b'o', b'k', 0xff]).expect("write invalid UTF-8 fixture");

        let result = open_document_path(&document).expect("preflight document");
        match result {
            OpenDocumentResult::Blocked { reason, .. } => {
                assert_eq!(reason, BlockedReason::InvalidUtf8);
            }
            OpenDocumentResult::Editable { .. } => panic!("invalid UTF-8 entered editable result"),
        }
    }

    #[test]
    fn open_python_document_reports_text_kind_and_language() {
        let temp = TestDirectory::new("open-python");
        let document = temp.path().join("worker.py");
        fs::write(&document, "def run():\n    return 1\n").expect("write python");

        let result = open_document_path(&document).expect("open python");
        match result {
            OpenDocumentResult::Editable {
                document_kind,
                language,
                content,
                ..
            } => {
                assert_eq!(document_kind, DocumentKind::Text);
                assert_eq!(language, "python");
                assert!(content.contains("def run"));
            }
            OpenDocumentResult::Blocked { .. } => panic!("ordinary Python was blocked"),
        }
    }

    #[test]
    fn common_code_and_text_extensions_have_stable_language_ids() {
        let expected = [
            ("json", "json"),
            ("jsonc", "json"),
            ("py", "python"),
            ("mjs", "javascript"),
            ("jsx", "jsx"),
            ("tsx", "tsx"),
            ("scss", "css"),
            ("rs", "rust"),
            ("java", "java"),
            ("cs", "csharp"),
            ("hpp", "cpp"),
            ("go", "go"),
            ("rb", "ruby"),
            ("php", "php"),
            ("swift", "swift"),
            ("kts", "kotlin"),
            ("zsh", "shell"),
            ("yml", "yaml"),
            ("toml", "toml"),
            ("xml", "xml"),
            ("html", "html"),
            ("sql", "sql"),
            ("vue", "vue"),
            ("svelte", "svelte"),
            ("log", "text"),
            ("ini", "config"),
        ];

        for (extension, language) in expected {
            assert_eq!(language_for_extension(extension), Some(language));
        }
        for extension in SUPPORTED_TEXT_EXTENSIONS {
            assert!(
                language_for_extension(extension).is_some(),
                "filter extension {extension} must have a language mapping"
            );
        }
        assert_eq!(language_for_extension("png"), None);
    }

    #[test]
    fn local_file_preview_resolves_relative_reference_and_target_line() {
        let temp = TestDirectory::new("local-preview");
        let docs = temp.path().join("docs");
        let source = temp.path().join("src");
        fs::create_dir(&docs).expect("create docs");
        fs::create_dir(&source).expect("create source");
        let markdown = docs.join("guide.md");
        fs::write(&markdown, "# Guide").expect("write guide");
        fs::write(
            source.join("worker.py"),
            (1..=100)
                .map(|line| format!("value_{line} = {line}"))
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .expect("write source");

        let preview = preview_local_file_path("src/worker.py:50", &markdown)
            .expect("preview relative source");

        assert_eq!(preview.language, "python");
        assert_eq!(preview.target_line, Some(50));
        assert_eq!(preview.start_line, 30);
        assert_eq!(preview.content.lines().count(), 41);
        assert!(preview.content.contains("value_50 = 50"));
        assert!(!preview.content.contains("value_1 = 1\n"));
        assert!(!preview.content.contains("value_71 = 71"));
    }

    #[test]
    fn local_file_preview_without_target_returns_first_eighty_lines() {
        let temp = TestDirectory::new("local-preview-default");
        let markdown = temp.path().join("guide.md");
        let source = temp.path().join("worker.py");
        fs::write(&markdown, "# Guide").expect("write guide");
        fs::write(
            &source,
            (1..=100)
                .map(|line| format!("line_{line}"))
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .expect("write source");

        let preview = preview_local_file_path("worker.py", &markdown).expect("preview source");

        assert_eq!(preview.target_line, None);
        assert_eq!(preview.start_line, 1);
        assert_eq!(preview.content.lines().count(), 80);
        assert!(preview.content.ends_with("line_80"));
    }

    #[test]
    fn local_file_preview_accepts_angle_wrapped_absolute_reference() {
        let temp = TestDirectory::new("local-preview-absolute");
        let markdown = temp.path().join("guide.md");
        let source = temp.path().join("worker.rs");
        fs::write(&markdown, "# Guide").expect("write guide");
        fs::write(&source, "fn main() {}\n").expect("write source");
        let reference = format!("<{}:1>", display_path(&source));

        let preview =
            preview_local_file_path(&reference, &markdown).expect("preview absolute source");

        assert_eq!(preview.language, "rust");
        assert_eq!(preview.target_line, Some(1));
        assert_eq!(preview.start_line, 1);
        assert_eq!(preview.content, "fn main() {}");
    }

    #[test]
    fn atomic_save_replaces_complete_file() {
        let temp = TestDirectory::new("save-success");
        let document = temp.path().join("document.md");
        fs::write(&document, "old bytes").expect("write original");

        let result = save_document(
            display_path(&document),
            "new 完整 markdown\n".to_owned(),
            None,
        )
        .expect("save document");

        assert_eq!(result.bytes_written, "new 完整 markdown\n".len() as u64);
        assert_eq!(
            fs::read_to_string(&document).expect("read saved document"),
            "new 完整 markdown\n"
        );
    }

    #[test]
    fn guarded_save_rejects_stale_or_missing_revision_and_tracks_own_saves() {
        let temp = TestDirectory::new("save-revision");
        let path = temp.path().join("notes.md");
        fs::write(&path, "initial").unwrap();
        let OpenDocumentResult::Editable { disk_revision, .. } = open_document_path(&path).unwrap()
        else {
            panic!("editable");
        };
        let saved = save_document_guarded(&path, "own first save", Some(&disk_revision)).unwrap();
        assert_eq!(
            saved.disk_revision,
            filesystem::metadata_revision(&fs::metadata(&path).unwrap())
        );
        let OpenDocumentResult::Editable {
            disk_revision: reopened_revision,
            content,
            ..
        } = open_document_path(&path).unwrap()
        else {
            panic!("editable saved file");
        };
        assert_eq!(saved.disk_revision, reopened_revision);
        assert_eq!(content, "own first save");
        let next =
            save_document_guarded(&path, "own next save", Some(&saved.disk_revision)).unwrap();
        assert_ne!(next.disk_revision, saved.disk_revision);
        fs::write(&path, "external edit").unwrap();
        assert_eq!(
            save_document_guarded(&path, "must not overwrite", Some(&next.disk_revision))
                .unwrap_err()
                .code,
            "externalChange"
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "external edit");
        fs::remove_file(&path).unwrap();
        assert_eq!(
            save_document_guarded(&path, "must not recreate", Some(&next.disk_revision))
                .unwrap_err()
                .code,
            "externalChange"
        );
        assert!(!path.exists());
    }

    #[test]
    fn guarded_save_checks_again_after_temp_write_before_rename() {
        let temp = TestDirectory::new("save-revision-before-rename");
        let path = temp.path().join("notes.md");
        fs::write(&path, "initial").unwrap();
        let revision = filesystem::metadata_revision(&fs::metadata(&path).unwrap());
        let result = save_document_guarded_with_hook(&path, "stale save", Some(&revision), || {
            atomic_write(&path, b"concurrent atomic replacement").unwrap();
        });
        assert_eq!(result.unwrap_err().code, "externalChange");
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "concurrent atomic replacement"
        );
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn open_rejects_file_replacement_between_preflight_and_read() {
        let temp = TestDirectory::new("open-revision-replacement");
        let path = temp.path().join("notes.md");
        fs::write(&path, "original").unwrap();
        let result = open_document_with_hook(&path, || {
            atomic_write(&path, b"new file").unwrap();
        });
        assert_eq!(result.unwrap_err().code, "externalChange");
    }

    #[test]
    fn actual_read_cannot_bypass_preflight_after_in_place_change() {
        let temp = TestDirectory::new("open-revision-preflight");
        let path = temp.path().join("notes.md");
        fs::write(&path, "safe small text").unwrap();
        let result = open_document_with_hook(&path, || {
            let mut file = File::create(&path).unwrap();
            file.write_all(b"data:image/png;base64,").unwrap();
            write_repeated(
                &mut file,
                &[b'A'; 4096],
                BLOCK_DATA_URI_LINE_BYTES as usize + 1,
            );
        })
        .unwrap();
        assert!(matches!(
            result,
            OpenDocumentResult::Blocked {
                reason: BlockedReason::LargeDataUri,
                ..
            }
        ));
    }

    #[test]
    fn save_document_path_creates_a_new_document_atomically() {
        let temp = TestDirectory::new("save-new");
        let document = temp.path().join("未命名.md");

        let result = save_document_path(&document, "# 新建文档\n").expect("save new document");

        assert_eq!(result.path, display_path(&document));
        assert_eq!(result.bytes_written, "# 新建文档\n".len() as u64);
        assert_eq!(
            fs::read_to_string(document).expect("read new document"),
            "# 新建文档\n"
        );
    }

    #[test]
    fn save_as_rejects_an_open_target_before_writing() {
        let temp = TestDirectory::new("save-as-open-target");
        let document = temp.path().join("already-open.py");
        fs::write(&document, "original remains\n").expect("write open document");
        let aliased_open_path = temp
            .path()
            .join(".")
            .join("already-open.py")
            .to_string_lossy()
            .into_owned();

        let error = save_document_as_path(&document, "must not be written\n", &[aliased_open_path])
            .expect_err("open target must be rejected");

        assert_eq!(error.code, "saveTargetAlreadyOpen");
        assert_eq!(
            fs::read_to_string(&document).expect("read open document"),
            "original remains\n"
        );
        assert_eq!(
            fs::read_dir(temp.path())
                .expect("list directory")
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
                .count(),
            0
        );
    }

    #[test]
    fn save_as_ignores_virtual_sessions_and_writes_a_new_target() {
        let temp = TestDirectory::new("save-as-new-target");
        let document = temp.path().join("created.rs");

        let result = save_document_as_path(
            &document,
            "fn main() {}\n",
            &["untitled://text/1".to_owned()],
        )
        .expect("save new target");

        assert_eq!(result.path, display_path(&document));
        assert_eq!(
            fs::read_to_string(&document).expect("read saved document"),
            "fn main() {}\n"
        );
    }

    #[test]
    fn atomic_save_failure_before_rename_preserves_original() {
        let temp = TestDirectory::new("save-failure");
        let document = temp.path().join("document.md");
        fs::write(&document, "original remains").expect("write original");

        let result = atomic_write_with_hook(&document, b"replacement", |_| {
            Err(io::Error::other("injected failure"))
        });

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&document).expect("read original"),
            "original remains"
        );
        let leftovers = fs::read_dir(temp.path())
            .expect("list test directory")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }
}
