//! A small, user-editable Markdown library, isolated by the application's identifier.
//! Only explicit template actions reach this directory; no startup scanning or imports.

use super::{
    display_path, is_markdown_path, is_single_workspace_entry_name, BackendError, BackendResult,
    LineScanner, Utf8StreamValidator, SCAN_BUFFER_BYTES,
};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_TEMPLATE_BYTES: usize = 256 * 1024;
const MAX_TEMPLATES: usize = 128;
const MAX_DIRECTORY_ENTRIES: usize = 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomDocumentTemplate {
    pub path: String,
    pub title: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTemplateLibrary {
    pub directory_path: String,
    pub templates: Vec<CustomDocumentTemplate>,
    pub skipped_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadDocumentTemplate {
    #[serde(flatten)]
    pub template: CustomDocumentTemplate,
    pub markdown: String,
}

#[tauri::command]
pub async fn list_document_templates(
    app: tauri::AppHandle,
) -> BackendResult<DocumentTemplateLibrary> {
    let data = application_data_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || list_templates(&template_directory(&data)?))
        .await
        .map_err(|error| BackendError::new("templateUnavailable", error.to_string()))?
}

#[tauri::command]
pub async fn read_document_template(
    app: tauri::AppHandle,
    path: String,
) -> BackendResult<ReadDocumentTemplate> {
    let data = application_data_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_template(&template_directory(&data)?, Path::new(&path))
    })
    .await
    .map_err(|error| BackendError::new("templateUnavailable", error.to_string()))?
}

#[tauri::command]
pub async fn save_document_template(
    app: tauri::AppHandle,
    name: String,
    content: String,
) -> BackendResult<CustomDocumentTemplate> {
    let data = application_data_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        save_template(&template_directory(&data)?, &name, &content)
    })
    .await
    .map_err(|error| BackendError::new("templateUnavailable", error.to_string()))?
}

fn application_data_directory(app: &tauri::AppHandle) -> BackendResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|error| BackendError::new("templateUnavailable", error.to_string()))
}

fn template_directory(data: &Path) -> BackendResult<PathBuf> {
    fs::create_dir_all(data).map_err(|error| template_io("create application directory", error))?;
    require_directory(data)?;
    let directory = data.join("templates");
    match fs::create_dir(&directory) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(template_io("create templates directory", error)),
    }
    require_directory(&directory)?;
    directory
        .canonicalize()
        .map_err(|error| template_io("resolve templates directory", error))
}

fn require_directory(path: &Path) -> BackendResult<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| template_io("inspect templates directory", error))?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        Ok(())
    } else {
        Err(BackendError::new(
            "templateDirectoryInvalid",
            "the templates location must be a regular directory, not a symbolic link",
        ))
    }
}

fn template_io(action: &str, error: io::Error) -> BackendError {
    BackendError::new(
        "templateUnavailable",
        format!("could not {action}: {error}"),
    )
}

fn template_metadata(path: &Path) -> BackendResult<CustomDocumentTemplate> {
    if !is_markdown_path(path) {
        return Err(BackendError::new(
            "templateInvalid",
            "templates must be .md or .markdown files",
        ));
    }
    let metadata =
        fs::symlink_metadata(path).map_err(|error| template_io("inspect template", error))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(BackendError::new(
            "templateInvalid",
            "a template must be a regular file, not a symbolic link",
        ));
    }
    if metadata.len() > MAX_TEMPLATE_BYTES as u64 {
        return Err(BackendError::new(
            "templateTooLarge",
            "a template must not exceed 256 KiB",
        ));
    }
    let title = path
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| BackendError::new("templateInvalid", "template name is not valid UTF-8"))?;
    Ok(CustomDocumentTemplate {
        path: display_path(path),
        title: title.to_owned(),
        size_bytes: metadata.len(),
    })
}

fn list_templates(directory: &Path) -> BackendResult<DocumentTemplateLibrary> {
    require_directory(directory)?;
    let entries = fs::read_dir(directory).map_err(|error| template_io("list templates", error))?;
    let mut result = DocumentTemplateLibrary {
        directory_path: display_path(directory),
        templates: Vec::new(),
        skipped_count: 0,
        truncated: false,
    };
    for (index, entry) in entries.enumerate() {
        if index == MAX_DIRECTORY_ENTRIES {
            result.truncated = true;
            break;
        }
        let Ok(entry) = entry else {
            result.skipped_count += 1;
            continue;
        };
        if !is_markdown_path(&entry.path()) {
            continue;
        }
        match template_metadata(&entry.path()) {
            Ok(template) => {
                if result.templates.len() == MAX_TEMPLATES {
                    result.truncated = true;
                    break;
                }
                result.templates.push(template);
            }
            Err(_) => result.skipped_count += 1,
        }
    }
    result.templates.sort_by(|left, right| {
        left.title
            .to_lowercase()
            .cmp(&right.title.to_lowercase())
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(result)
}

fn read_template(directory: &Path, path: &Path) -> BackendResult<ReadDocumentTemplate> {
    require_directory(directory)?;
    // The frontend receives canonical paths from list/save. No caller-selected library roots.
    if !path.is_absolute() || path.parent() != Some(directory) {
        return Err(BackendError::new(
            "templateOutsideLibrary",
            "select a file directly inside the templates directory",
        ));
    }
    let mut template = template_metadata(path)?;
    let file = File::open(path).map_err(|error| template_io("open template", error))?;
    let metadata = file
        .metadata()
        .map_err(|error| template_io("inspect open template", error))?;
    if !metadata.is_file() || metadata.len() > MAX_TEMPLATE_BYTES as u64 {
        return Err(BackendError::new(
            "templateTooLarge",
            "a template must be a regular file no larger than 256 KiB",
        ));
    }
    let markdown = read_template_text(file)?;
    template.size_bytes = markdown.len() as u64;
    Ok(ReadDocumentTemplate { template, markdown })
}

fn read_template_text(reader: impl Read) -> BackendResult<String> {
    let mut reader = reader.take(MAX_TEMPLATE_BYTES as u64 + 1);
    let mut buffer = [0_u8; SCAN_BUFFER_BYTES];
    let mut bytes = Vec::new();
    let mut utf8 = Utf8StreamValidator::default();
    let mut line = LineScanner::default();
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| template_io("read template", error))?;
        if count == 0 {
            break;
        }
        if bytes.len() + count > MAX_TEMPLATE_BYTES {
            return Err(BackendError::new(
                "templateTooLarge",
                "a template must not exceed 256 KiB",
            ));
        }
        if !utf8.push(&buffer[..count]) || line.push(&buffer[..count]).is_some() {
            return Err(BackendError::new(
                "templateInvalidContent",
                "the template must contain valid UTF-8 without oversized embedded images or lines",
            ));
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    if !utf8.finish() || line.finish().is_some() {
        return Err(BackendError::new(
            "templateInvalidContent",
            "the template must contain valid UTF-8 without oversized embedded images or lines",
        ));
    }
    String::from_utf8(bytes).map_err(|_| {
        BackendError::new(
            "templateInvalidContent",
            "the template must contain valid UTF-8",
        )
    })
}

fn template_file_name(name: &str) -> BackendResult<String> {
    let name = name.trim();
    if !is_single_workspace_entry_name(name)
        || name.len() > 180
        || name.ends_with('.')
        || name
            .chars()
            .any(|value| value.is_control() || ":*?\"<>|".contains(value))
    {
        return Err(BackendError::new("templateNameInvalid", "use a single file name of at most 180 UTF-8 bytes, without path separators or reserved characters"));
    }
    let file_name = if is_markdown_path(Path::new(name)) {
        name.to_owned()
    } else {
        format!("{name}.md")
    };
    let stem = file_name
        .split('.')
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.as_bytes()[3].is_ascii_digit())
    {
        return Err(BackendError::new(
            "templateNameInvalid",
            "this file name is reserved by the operating system",
        ));
    }
    Ok(file_name)
}

fn save_template(
    directory: &Path,
    name: &str,
    content: &str,
) -> BackendResult<CustomDocumentTemplate> {
    let file_name = template_file_name(name)?;
    // Reuse the native text guards before creating any file, including the lower template budget.
    read_template_text(content.as_bytes())?;
    require_directory(directory)?;
    let target = directory.join(file_name);
    if fs::symlink_metadata(&target).is_ok() {
        return Err(BackendError::new(
            "templateAlreadyExists",
            "a template with this name already exists; choose another name",
        ));
    }
    let current = list_templates(directory)?;
    if current.truncated || current.templates.len() >= MAX_TEMPLATES {
        return Err(BackendError::new(
            "templateLibraryFull",
            "organize the templates directory before adding more files",
        ));
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                BackendError::new(
                    "templateAlreadyExists",
                    "a template with this name already exists; choose another name",
                )
            } else {
                template_io("create template", error)
            }
        })?;
    if let Err(error) = file
        .write_all(content.as_bytes())
        .and_then(|()| file.sync_all())
    {
        drop(file);
        let _ = fs::remove_file(&target);
        return Err(template_io("write template", error));
    }
    Ok(CustomDocumentTemplate {
        path: display_path(&target),
        title: target
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        size_bytes: content.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::tests::TestDirectory;

    #[test]
    fn creates_an_identifier_scoped_directory_and_lists_only_metadata() {
        let temp = TestDirectory::new("templates-library");
        let directory = template_directory(&temp.path().join("isolated-app")).unwrap();
        assert_eq!(directory.file_name().unwrap(), "templates");
        let first = save_template(&directory, "会议", "# 会议\r\n\n草稿正文\n").unwrap();
        save_template(&directory, "Agenda.markdown", "# Agenda\n").unwrap();
        fs::write(directory.join("ignored.txt"), "not a template").unwrap();
        fs::create_dir(directory.join("nested")).unwrap();
        fs::write(directory.join("nested/hidden.md"), "not recursive").unwrap();
        let listing = list_templates(&directory).unwrap();
        assert_eq!(listing.templates.len(), 2);
        assert_eq!(listing.skipped_count, 0);
        assert!(!listing.truncated);
        assert_eq!(listing.templates[0].title, "Agenda");
        let read = read_template(&directory, Path::new(&first.path)).unwrap();
        assert_eq!(read.markdown, "# 会议\r\n\n草稿正文\n");
        assert_eq!(read.template.size_bytes, read.markdown.len() as u64);
        assert!(!serde_json::to_string(&listing)
            .unwrap()
            .contains("草稿正文"));
    }

    #[test]
    fn refuses_overwrite_invalid_names_and_outside_reads() {
        let temp = TestDirectory::new("templates-boundaries");
        let directory = template_directory(temp.path()).unwrap();
        let saved = save_template(&directory, "original", "keep original").unwrap();
        assert_eq!(
            save_template(&directory, "original", "replacement")
                .unwrap_err()
                .code,
            "templateAlreadyExists"
        );
        assert_eq!(fs::read_to_string(&saved.path).unwrap(), "keep original");
        for name in [
            "",
            ".",
            "..",
            "sub/name",
            "sub\\name",
            "a\0b",
            "name.",
            "CON",
            "a:b",
        ] {
            assert_eq!(
                save_template(&directory, name, "x").unwrap_err().code,
                "templateNameInvalid",
                "{name:?}"
            );
        }
        let outside = temp.path().join("outside.md");
        fs::write(&outside, "outside").unwrap();
        assert_eq!(
            read_template(&directory, &outside).unwrap_err().code,
            "templateOutsideLibrary"
        );
        assert_eq!(
            read_template(&directory, Path::new("original.md"))
                .unwrap_err()
                .code,
            "templateOutsideLibrary"
        );
    }

    #[test]
    fn enforces_bounded_reads_utf8_and_template_size_before_writes() {
        let temp = TestDirectory::new("templates-content");
        let directory = template_directory(temp.path()).unwrap();
        fs::write(directory.join("bad.md"), [0xff, 0xfe]).unwrap();
        assert_eq!(
            read_template(&directory, &directory.join("bad.md"))
                .unwrap_err()
                .code,
            "templateInvalidContent"
        );
        let oversized = format!("data:image/png;base64,{}", "A".repeat(MAX_TEMPLATE_BYTES));
        assert_eq!(
            save_template(&directory, "large", &oversized)
                .unwrap_err()
                .code,
            "templateTooLarge"
        );
        assert!(!directory.join("large.md").exists());
        fs::write(directory.join("grown.md"), "small").unwrap();
        assert_eq!(list_templates(&directory).unwrap().templates.len(), 2);
        fs::write(directory.join("grown.md"), &oversized).unwrap();
        assert_eq!(
            read_template(&directory, &directory.join("grown.md"))
                .unwrap_err()
                .code,
            "templateTooLarge"
        );
        assert_eq!(list_templates(&directory).unwrap().skipped_count, 1);
        assert_eq!(
            read_template_text(io::repeat(b'x')).unwrap_err().code,
            "templateTooLarge"
        );
        assert_eq!(
            read_template_text("界".repeat(23_000).as_bytes()).unwrap(),
            "界".repeat(23_000)
        );
    }

    #[test]
    fn reports_file_and_directory_scan_caps() {
        let temp = TestDirectory::new("templates-caps");
        let directory = template_directory(temp.path()).unwrap();
        for index in 0..=MAX_TEMPLATES {
            fs::write(directory.join(format!("{index}.md")), "# Template").unwrap();
        }
        let listing = list_templates(&directory).unwrap();
        assert_eq!(listing.templates.len(), MAX_TEMPLATES);
        assert!(listing.truncated);
        assert_eq!(
            save_template(&directory, "another", "new")
                .unwrap_err()
                .code,
            "templateLibraryFull"
        );
        assert!(!directory.join("another.md").exists());
        let other = temp.path().join("many-entries");
        fs::create_dir(&other).unwrap();
        for index in 0..=MAX_DIRECTORY_ENTRIES {
            fs::write(other.join(format!("{index}.txt")), "").unwrap();
        }
        assert!(list_templates(&other).unwrap().truncated);
    }

    #[cfg(unix)]
    #[test]
    fn skips_linked_files_and_refuses_linked_template_directories() {
        use std::os::unix::fs::symlink;
        let temp = TestDirectory::new("templates-links");
        let directory = template_directory(temp.path()).unwrap();
        let outside = temp.path().join("source.md");
        fs::write(&outside, "source").unwrap();
        symlink(&outside, directory.join("linked.md")).unwrap();
        let listing = list_templates(&directory).unwrap();
        assert!(listing.templates.is_empty());
        assert_eq!(listing.skipped_count, 1);
        assert_eq!(
            read_template(&directory, &directory.join("linked.md"))
                .unwrap_err()
                .code,
            "templateInvalid"
        );
        assert_eq!(
            save_template(&directory, "linked", "changed")
                .unwrap_err()
                .code,
            "templateAlreadyExists"
        );
        assert_eq!(fs::read_to_string(&outside).unwrap(), "source");
        let other = temp.path().join("other-app");
        fs::create_dir(&other).unwrap();
        symlink(&directory, other.join("templates")).unwrap();
        assert_eq!(
            template_directory(&other).unwrap_err().code,
            "templateDirectoryInvalid"
        );
    }
}
