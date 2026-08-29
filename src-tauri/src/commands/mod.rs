use serde::Serialize;
use std::ffi::OsStr;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const SCAN_BUFFER_BYTES: usize = 64 * 1024;
const NORMAL_FILE_BYTES: u64 = 8 * 1024 * 1024;
const NORMAL_LINE_BYTES: u64 = 256 * 1024;
const BLOCK_DATA_URI_LINE_BYTES: u64 = 512 * 1024;
const BLOCK_LINE_BYTES: u64 = 1024 * 1024;
const DATA_IMAGE_PREFIX: &[u8] = b"data:image/";
const BASE64_MARKER: &[u8] = b";base64,";

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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceNodeKind {
    Directory,
    Markdown,
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
#[serde(tag = "status", rename_all = "camelCase")]
pub enum OpenDocumentResult {
    Editable {
        path: String,
        content: String,
        mode: DocumentMode,
        preflight: DocumentPreflight,
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedClipboardImage {
    pub path: String,
    pub markdown_uri: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug)]
struct ScanResult {
    preflight: DocumentPreflight,
    blocked: Option<BlockedReason>,
}

#[tauri::command]
pub async fn pick_workspace() -> BackendResult<Option<WorkspaceSelection>> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("Open Markdown workspace")
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

#[tauri::command(rename_all = "camelCase")]
pub fn list_workspace(root_path: String) -> BackendResult<Vec<WorkspaceNode>> {
    list_workspace_path(Path::new(&root_path))
}

#[tauri::command]
pub fn open_document(path: String) -> BackendResult<OpenDocumentResult> {
    open_document_path(Path::new(&path))
}

#[tauri::command]
pub fn save_document(path: String, content: String) -> BackendResult<SaveDocumentResult> {
    let path = Path::new(&path);
    atomic_write(path, content.as_bytes())
        .map_err(|error| BackendError::io("save failed", error))?;

    Ok(SaveDocumentResult {
        path: display_path(path),
        bytes_written: content.len() as u64,
    })
}

#[tauri::command(rename_all = "camelCase")]
pub fn save_clipboard_image(document_path: String) -> BackendResult<SavedClipboardImage> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| BackendError::new("clipboardUnavailable", error.to_string()))?;
    let image = clipboard
        .get_image()
        .map_err(|error| BackendError::new("clipboardNoImage", error.to_string()))?;

    let width = u32::try_from(image.width)
        .map_err(|_| BackendError::new("imageTooLarge", "clipboard image width is too large"))?;
    let height = u32::try_from(image.height)
        .map_err(|_| BackendError::new("imageTooLarge", "clipboard image height is too large"))?;

    save_rgba_image(
        Path::new(&document_path),
        width,
        height,
        image.bytes.as_ref(),
    )
}

fn list_workspace_path(root: &Path) -> BackendResult<Vec<WorkspaceNode>> {
    let root = root
        .canonicalize()
        .map_err(|error| BackendError::io("workspace could not be opened", error))?;
    if !root.is_dir() {
        return Err(BackendError::new(
            "notDirectory",
            "selected workspace is not a directory",
        ));
    }

    collect_workspace_nodes(&root, &root)
        .map_err(|error| BackendError::io("workspace could not be listed", error))
}

fn collect_workspace_nodes(root: &Path, directory: &Path) -> io::Result<Vec<WorkspaceNode>> {
    let mut nodes = Vec::new();

    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if file_type.is_dir() {
            if name == ".git" {
                continue;
            }
            nodes.push(WorkspaceNode {
                name,
                path: display_path(&path),
                relative_path: relative_display_path(root, &path),
                kind: WorkspaceNodeKind::Directory,
                children: collect_workspace_nodes(root, &path)?,
            });
        } else if file_type.is_file() && is_markdown_path(&path) {
            nodes.push(WorkspaceNode {
                name,
                path: display_path(&path),
                relative_path: relative_display_path(root, &path),
                kind: WorkspaceNodeKind::Markdown,
                children: Vec::new(),
            });
        }
    }

    nodes.sort_by(|left, right| {
        let left_rank = matches!(left.kind, WorkspaceNodeKind::Markdown);
        let right_rank = matches!(right.kind, WorkspaceNodeKind::Markdown);
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(nodes)
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(OsStr::to_str)
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
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
    let scan = scan_document(path)?;
    let display = display_path(path);

    if let Some(reason) = scan.blocked {
        return Ok(OpenDocumentResult::Blocked {
            path: display,
            reason,
            preflight: scan.preflight,
        });
    }

    let bytes =
        fs::read(path).map_err(|error| BackendError::io("document could not be read", error))?;
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
        preflight: scan.preflight,
    })
}

fn scan_document(path: &Path) -> BackendResult<ScanResult> {
    let metadata = fs::metadata(path)
        .map_err(|error| BackendError::io("document metadata could not be read", error))?;
    if !metadata.is_file() {
        return Err(BackendError::new(
            "notFile",
            "selected document is not a file",
        ));
    }

    let mut file = File::open(path)
        .map_err(|error| BackendError::io("document could not be opened", error))?;
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
                preflight: line.report(metadata.len().max(bytes_read)),
                blocked: Some(BlockedReason::InvalidUtf8),
            });
        }

        if let Some(reason) = line.push(&buffer[..read]) {
            return Ok(ScanResult {
                preflight: line.report(metadata.len().max(bytes_read)),
                blocked: Some(reason),
            });
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

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    atomic_write_with_hook(path, bytes, |_| Ok(()))
}

fn atomic_write_with_hook<F>(path: &Path, bytes: &[u8], before_rename: F) -> io::Result<()>
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
        drop(temp_file);
        before_rename(&temp_path)?;
        fs::rename(&temp_path, path)?;
        Ok(())
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

fn save_rgba_image(
    document_path: &Path,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> BackendResult<SavedClipboardImage> {
    if !document_path.is_file() {
        return Err(BackendError::new(
            "documentNotSaved",
            "save the Markdown document before pasting an image",
        ));
    }
    let expected_len = usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| BackendError::new("imageTooLarge", "clipboard image is too large"))?;
    if rgba.len() != expected_len {
        return Err(BackendError::new(
            "invalidImage",
            "clipboard image does not contain RGBA pixels",
        ));
    }

    let parent = document_path.parent().ok_or_else(|| {
        BackendError::new(
            "documentNotSaved",
            "save the Markdown document before pasting an image",
        )
    })?;
    let assets = parent.join("assets");
    fs::create_dir_all(&assets)
        .map_err(|error| BackendError::io("assets directory could not be created", error))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let counter = UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let file_name = format!("paste-{timestamp}-{counter}.png");
    let image_path = assets.join(&file_name);

    let mut encoded = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut encoded, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| BackendError::new("imageEncodeFailed", error.to_string()))?;
        writer
            .write_image_data(rgba)
            .map_err(|error| BackendError::new("imageEncodeFailed", error.to_string()))?;
    }

    atomic_write(&image_path, &encoded)
        .map_err(|error| BackendError::io("clipboard image could not be saved", error))?;

    Ok(SavedClipboardImage {
        path: display_path(&image_path),
        markdown_uri: format!("./assets/{file_name}"),
        width,
        height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let counter = UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "markdown-workspace-{label}-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create isolated test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
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
    fn list_workspace_returns_sorted_directories_and_markdown_only() {
        let temp = TestDirectory::new("workspace-list");
        fs::create_dir(temp.path().join("guides")).expect("create guides");
        fs::create_dir(temp.path().join(".git")).expect("create git directory");
        fs::write(temp.path().join("readme.md"), "# Readme").expect("write markdown");
        fs::write(temp.path().join("notes.MARKDOWN"), "notes").expect("write markdown");
        fs::write(temp.path().join("ignored.txt"), "ignored").expect("write text");
        fs::write(temp.path().join("guides").join("start.md"), "start")
            .expect("write nested markdown");

        let nodes = list_workspace_path(temp.path()).expect("list workspace");

        assert_eq!(nodes.len(), 3);
        assert_eq!(nodes[0].kind, WorkspaceNodeKind::Directory);
        assert_eq!(nodes[0].relative_path, "guides");
        assert_eq!(nodes[0].children.len(), 1);
        assert_eq!(nodes[0].children[0].relative_path, "guides/start.md");
        assert_eq!(nodes[1].name, "notes.MARKDOWN");
        assert_eq!(nodes[2].name, "readme.md");
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
                mode,
                preflight,
                ..
            } => {
                assert_eq!(content, "# 中文\n\nHello 🌍\n");
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
    fn atomic_save_replaces_complete_file() {
        let temp = TestDirectory::new("save-success");
        let document = temp.path().join("document.md");
        fs::write(&document, "old bytes").expect("write original");

        let result = save_document(display_path(&document), "new 完整 markdown\n".to_owned())
            .expect("save document");

        assert_eq!(result.bytes_written, "new 完整 markdown\n".len() as u64);
        assert_eq!(
            fs::read_to_string(&document).expect("read saved document"),
            "new 完整 markdown\n"
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

    #[test]
    fn rgba_image_is_saved_as_png_with_relative_markdown_uri() {
        let temp = TestDirectory::new("save-image");
        let document = temp.path().join("document.md");
        fs::write(&document, "# Image\n").expect("write document");
        let rgba = [255_u8, 0, 0, 255, 0, 255, 0, 255];

        let saved = save_rgba_image(&document, 2, 1, &rgba).expect("save image");

        assert!(saved.markdown_uri.starts_with("./assets/paste-"));
        assert!(saved.markdown_uri.ends_with(".png"));
        let bytes = fs::read(&saved.path).expect("read saved PNG");
        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");

        let decoder = png::Decoder::new(Cursor::new(bytes));
        let reader = decoder.read_info().expect("read PNG metadata");
        assert_eq!(reader.info().width, 2);
        assert_eq!(reader.info().height, 1);
    }

    #[test]
    fn image_paste_requires_a_saved_document() {
        let temp = TestDirectory::new("save-image-unsaved");
        let document = temp.path().join("missing.md");

        let error = save_rgba_image(&document, 1, 1, &[0, 0, 0, 255])
            .expect_err("unsaved document must be rejected");

        assert_eq!(error.code, "documentNotSaved");
        assert!(!temp.path().join("assets").exists());
    }
}
