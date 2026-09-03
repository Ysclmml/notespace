use super::export_resources::{
    embed_export_images, image_source_paths, ExportImage, MAX_EXPORT_BYTES,
};
use super::{
    atomic_write_with_hook, display_path, save_target_is_excluded, BackendError, BackendResult,
};
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportHtmlResult {
    pub path: String,
    pub bytes_written: u64,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn export_html(
    suggested_file_name: String,
    html: String,
    mut excluded_paths: Vec<String>,
    images: Option<Vec<ExportImage>>,
    allow_remote_images: Option<bool>,
) -> BackendResult<Option<ExportHtmlResult>> {
    let selected = rfd::AsyncFileDialog::new()
        .set_title("导出 HTML / Export HTML")
        .set_file_name(suggested_html_name(&suggested_file_name))
        .add_filter("HTML", &["html", "htm"])
        .save_file()
        .await;
    let selected_path = selected.map(|handle| handle.path().to_path_buf());
    tauri::async_runtime::spawn_blocking(move || {
        let Some(ref path) = selected_path else {
            return Ok(None);
        };
        let images = images.unwrap_or_default();
        excluded_paths.extend(image_source_paths(&images));
        validate_export_target(path, &excluded_paths)?;
        let html = embed_export_images(html, &images, allow_remote_images.unwrap_or(false))?;
        export_selected_html_path(selected_path, &html, &excluded_paths)
    })
    .await
    .map_err(|error| BackendError::new("htmlExport", error.to_string()))?
}

fn suggested_html_name(suggestion: &str) -> String {
    let name = Path::new(suggestion)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("document");
    let stem = Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or("document");
    format!("{stem}.html")
}

fn export_selected_html_path(
    selected_path: Option<PathBuf>,
    html: &str,
    excluded_paths: &[String],
) -> BackendResult<Option<ExportHtmlResult>> {
    selected_path
        .map(|path| export_html_path_with_hook(&path, html, excluded_paths, |_| Ok(())))
        .transpose()
}

fn validate_export_target(path: &Path, excluded_paths: &[String]) -> BackendResult<()> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !["html", "htm"]
        .iter()
        .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        || fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err(BackendError::new(
            "htmlExportTargetInvalid",
            "choose an HTML file, not a source document or symbolic link",
        ));
    }
    if save_target_is_excluded(path, excluded_paths) {
        return Err(BackendError::new(
            "saveTargetAlreadyOpen",
            "the export target is already open in a document session",
        ));
    }
    Ok(())
}

fn export_html_path_with_hook(
    path: &Path,
    html: &str,
    excluded_paths: &[String],
    before_rename: impl FnOnce(&Path) -> io::Result<()>,
) -> BackendResult<ExportHtmlResult> {
    validate_export_target(path, excluded_paths)?;
    if html.len() > MAX_EXPORT_BYTES {
        return Err(BackendError::new(
            "htmlExportTooLarge",
            "HTML export is too large",
        ));
    }
    atomic_write_with_hook(path, html.as_bytes(), |temporary| {
        before_rename(temporary)?;
        validate_export_target(path, excluded_paths)
            .map_err(|error| io::Error::other(error.message))
    })
    .map_err(|error| BackendError::io("HTML export failed", error))?;
    Ok(ExportHtmlResult {
        path: display_path(path),
        bytes_written: html.len() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::tests::TestDirectory;

    #[test]
    fn export_name_uses_only_filename_and_html_extension() {
        assert_eq!(suggested_html_name("/notes/中文笔记.md"), "中文笔记.html");
        assert_eq!(suggested_html_name("page.html"), "page.html");
        assert_eq!(suggested_html_name(" "), "document.html");
    }

    #[test]
    fn export_cancellation_is_not_an_error_and_writes_nothing() {
        assert!(export_selected_html_path(None, "<h1>Draft</h1>", &[])
            .unwrap()
            .is_none());
    }

    #[test]
    fn export_writes_utf8_html_without_touching_markdown() {
        let directory = TestDirectory::new("html-export");
        let source = directory.path().join("note.md");
        let target = directory.path().join("note.html");
        fs::write(&source, "# Saved\r\n").unwrap();
        let html = "<!doctype html><h1>未保存的草稿</h1>";
        let result =
            export_selected_html_path(Some(target.clone()), html, &[display_path(&source)])
                .unwrap()
                .unwrap();
        assert_eq!(result.bytes_written, html.len() as u64);
        assert_eq!(result.path, display_path(&target));
        assert_eq!(fs::read_to_string(target).unwrap(), html);
        assert_eq!(fs::read_to_string(source).unwrap(), "# Saved\r\n");
    }

    #[test]
    fn export_rejects_source_extensions_and_open_html_before_writing() {
        let directory = TestDirectory::new("html-export-protected");
        for name in ["note.md", "note.txt", "no-extension", "note.html"] {
            let target = directory.path().join(name);
            fs::write(&target, "original").unwrap();
            let result = export_selected_html_path(
                Some(target.clone()),
                "replacement",
                &[display_path(&target)],
            );
            assert!(result.is_err());
            assert_eq!(fs::read_to_string(target).unwrap(), "original");
        }
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 4);
    }

    #[test]
    fn export_failure_keeps_previous_html_and_cleans_only_temporary_file() {
        let directory = TestDirectory::new("html-export-failure");
        let target = directory.path().join("old.htm");
        fs::write(&target, "old HTML").unwrap();
        let result = export_html_path_with_hook(&target, "new HTML", &[], |_| {
            Err(io::Error::other("injected write failure"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "old HTML");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn export_rejects_a_symbolic_link_to_a_markdown_file() {
        let directory = TestDirectory::new("html-export-symlink");
        let source = directory.path().join("source.md");
        let target = directory.path().join("alias.html");
        fs::write(&source, "do not replace").unwrap();
        std::os::unix::fs::symlink(&source, &target).unwrap();
        assert!(export_selected_html_path(Some(target.clone()), "HTML", &[]).is_err());
        assert!(fs::symlink_metadata(target)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_to_string(source).unwrap(), "do not replace");
    }

    #[test]
    fn an_image_source_is_protected_even_with_an_html_extension() {
        let directory = TestDirectory::new("html-export-image-protected");
        let image = directory.path().join("image.html");
        fs::write(&image, b"image bytes").unwrap();
        let images = [ExportImage {
            id: "notespace-export-image-0".into(),
            source: tauri::Url::from_file_path(&image).unwrap().into(),
        }];
        assert!(export_html_path_with_hook(
            &image,
            "replacement",
            &image_source_paths(&images),
            |_| Ok(())
        )
        .is_err());
        assert_eq!(fs::read(image).unwrap(), b"image bytes");
    }
}
