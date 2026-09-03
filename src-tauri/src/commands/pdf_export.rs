use super::export_resources::ExportImage;
use super::html_export::ExportHtmlResult;
use super::{BackendError, BackendResult};

#[tauri::command(rename_all = "camelCase")]
pub async fn export_pdf(
    app: tauri::AppHandle,
    suggested_file_name: String,
    html: String,
    excluded_paths: Vec<String>,
    images: Option<Vec<ExportImage>>,
    allow_remote_images: Option<bool>,
) -> BackendResult<Option<ExportHtmlResult>> {
    #[cfg(target_os = "macos")]
    {
        let mut excluded_paths = excluded_paths;
        let selected = rfd::AsyncFileDialog::new()
            .set_title("导出 PDF / Export PDF")
            .set_file_name(suggested_pdf_name(&suggested_file_name))
            .add_filter("PDF", &["pdf"])
            .save_file()
            .await;
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.path().to_path_buf();
        let images = images.unwrap_or_default();
        excluded_paths.extend(super::export_resources::image_source_paths(&images));
        validate_pdf_target(&path, &excluded_paths)?;
        let prepared = tauri::async_runtime::spawn_blocking(move || {
            super::export_resources::embed_export_images(
                html,
                &images,
                allow_remote_images.unwrap_or(false),
            )
        })
        .await
        .map_err(|error| BackendError::new("pdfExport", error.to_string()))??;
        let pdf = render_pdf_snapshot(&app, &prepared).await?;
        tauri::async_runtime::spawn_blocking(move || save_pdf(&path, &pdf, &excluded_paths))
            .await
            .map_err(|error| BackendError::new("pdfExport", error.to_string()))?
            .map(Some)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            app,
            suggested_file_name,
            html,
            excluded_paths,
            images,
            allow_remote_images,
        );
        Err(BackendError::new("pdfExportUnsupported", "Native PDF export is currently available on macOS. Export HTML and use your browser's Save as PDF on other platforms."))
    }
}

#[cfg(target_os = "macos")]
pub(crate) async fn render_pdf_snapshot(
    app: &tauri::AppHandle,
    html: &str,
) -> BackendResult<Vec<u8>> {
    macos::render_pdf(app, html).await
}

#[cfg(any(target_os = "macos", test))]
fn suggested_pdf_name(suggestion: &str) -> String {
    let stem = std::path::Path::new(suggestion)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("document");
    format!("{stem}.pdf")
}

#[cfg(any(target_os = "macos", test))]
fn validate_pdf_target(path: &std::path::Path, excluded_paths: &[String]) -> BackendResult<()> {
    if !path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("pdf"))
        || std::fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink())
    {
        return Err(BackendError::new(
            "pdfExportTargetInvalid",
            "Choose a PDF file, not a symbolic link.",
        ));
    }
    if super::save_target_is_excluded(path, excluded_paths) {
        return Err(BackendError::new(
            "saveTargetAlreadyOpen",
            "The export target is already open.",
        ));
    }
    Ok(())
}

#[cfg(any(target_os = "macos", test))]
fn save_pdf(
    path: &std::path::Path,
    bytes: &[u8],
    excluded_paths: &[String],
) -> BackendResult<ExportHtmlResult> {
    validate_pdf_target(path, excluded_paths)?;
    if !bytes.starts_with(b"%PDF-") || bytes.len() > super::export_resources::MAX_EXPORT_BYTES {
        return Err(BackendError::new(
            "pdfExport",
            "The generated PDF is invalid or too large.",
        ));
    }
    super::atomic_write_with_hook(path, bytes, |_| {
        validate_pdf_target(path, excluded_paths)
            .map_err(|error| std::io::Error::other(error.message))
    })
    .map_err(|error| BackendError::io("PDF export failed", error))?;
    Ok(ExportHtmlResult {
        path: super::display_path(path),
        bytes_written: bytes.len() as u64,
    })
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use objc2::{
        define_class, msg_send,
        rc::Retained,
        runtime::{Bool, NSObject},
        DefinedClass, MainThreadOnly,
    };
    use objc2_foundation::{MainThreadMarker, NSObjectProtocol};
    use std::fs;
    use std::io::Read;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};
    use tauri::webview::PageLoadEvent;

    static NEXT_EXPORT: AtomicU64 = AtomicU64::new(1);
    type PrintSender = Arc<Mutex<Option<std::sync::mpsc::SyncSender<BackendResult<()>>>>>;

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "NoteSpacePDFPrintCompletion"]
        #[thread_kind = MainThreadOnly]
        #[ivars = PrintSender]
        struct PrintCompletion;

        unsafe impl NSObjectProtocol for PrintCompletion {}

        impl PrintCompletion {
            #[unsafe(method(printOperation:didRun:contextInfo:))]
            fn completed(&self, _operation: &objc2_app_kit::NSPrintOperation, success: Bool, _context: *mut std::ffi::c_void) {
                if let Some(sender) = self.ivars().lock().ok().and_then(|mut guard| guard.take()) {
                    let result = if success.as_bool() { Ok(()) } else { Err(BackendError::new("pdfExport", "Native PDF rendering failed.")) };
                    let _ = sender.send(result);
                }
                // The native print API does not retain its delegate. Balance the
                // retain transferred at launch, after this callback has returned.
                unsafe {
                    if let Some(owned) = Retained::from_raw(self as *const Self as *mut Self) {
                        let _ = Retained::autorelease_ptr(owned);
                    }
                }
            }
        }
    );

    struct ExportScratch {
        directory: PathBuf,
    }
    impl ExportScratch {
        fn create() -> BackendResult<Self> {
            let time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let directory = std::env::temp_dir().join(format!(
                "notespace-pdf-{}-{time}-{}",
                std::process::id(),
                NEXT_EXPORT.fetch_add(1, Ordering::Relaxed)
            ));
            let mut builder = fs::DirBuilder::new();
            use std::os::unix::fs::DirBuilderExt;
            builder
                .mode(0o700)
                .create(&directory)
                .map_err(|error| BackendError::io("Could not prepare PDF export", error))?;
            Ok(Self { directory })
        }
    }
    impl Drop for ExportScratch {
        fn drop(&mut self) {
            // Only this call's two known scratch files; never recursively delete.
            let _ = fs::remove_file(self.directory.join("document.html"));
            let _ = fs::remove_file(self.directory.join("document.pdf"));
            let _ = fs::remove_dir(&self.directory);
        }
    }

    pub(super) async fn render_pdf(app: &tauri::AppHandle, html: &str) -> BackendResult<Vec<u8>> {
        let scratch = ExportScratch::create()?;
        let source_path = scratch.directory.join("document.html");
        fs::write(&source_path, html)
            .map_err(|error| BackendError::io("Could not prepare PDF HTML", error))?;
        let pdf_path = scratch.directory.join("document.pdf");
        let source_url = tauri::Url::from_file_path(source_path)
            .map_err(|_| BackendError::new("pdfExport", "Invalid PDF scratch path."))?;
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        let sender = Arc::new(Mutex::new(Some(sender)));
        let page_sender = sender.clone();
        let expected_url = source_url.clone();
        let label = format!("pdf-export-{}", NEXT_EXPORT.fetch_add(1, Ordering::Relaxed));
        let window =
            tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::External(source_url))
                .title("NoteSpace PDF")
                .inner_size(794.0, 1123.0)
                .visible(false)
                .focused(false)
                .incognito(true)
                .disable_javascript()
                .on_navigation(move |url| url == &expected_url)
                .on_page_load(move |window, event| {
                    if event.event() != PageLoadEvent::Finished {
                        return;
                    }
                    let Some(sender) = page_sender.lock().ok().and_then(|mut guard| guard.take())
                    else {
                        return;
                    };
                    let path = pdf_path.clone();
                    // Tauri runs this closure on the native main thread. The print
                    // operation uses WebKit layout, preserving text and pagination.
                    let sender = Arc::new(Mutex::new(Some(sender)));
                    let print_sender = sender.clone();
                    if let Err(error) = window.with_webview(move |webview| {
                        if let Err(error) = print_webview(webview, &path, print_sender.clone()) {
                            if let Some(sender) =
                                print_sender.lock().ok().and_then(|mut guard| guard.take())
                            {
                                let _ = sender.send(Err(error));
                            }
                        }
                    }) {
                        if let Some(sender) = sender.lock().ok().and_then(|mut guard| guard.take())
                        {
                            let _ =
                                sender.send(Err(BackendError::new("pdfExport", error.to_string())));
                        }
                    }
                })
                .build()
                .map_err(|error| BackendError::new("pdfExport", error.to_string()))?;
        let result = tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(Duration::from_secs(60))
                .map_err(|_| BackendError::new("pdfExport", "PDF rendering timed out."))
        })
        .await
        .map_err(|error| BackendError::new("pdfExport", error.to_string()));
        let _ = window.destroy();
        result???;
        let mut bytes = Vec::new();
        fs::File::open(scratch.directory.join("document.pdf"))
            .and_then(|file| {
                file.take(super::super::export_resources::MAX_EXPORT_BYTES as u64 + 1)
                    .read_to_end(&mut bytes)
            })
            .map_err(|error| BackendError::io("Could not read generated PDF", error))?;
        Ok(bytes)
    }

    fn print_webview(
        webview: tauri::webview::PlatformWebview,
        path: &std::path::Path,
        sender: PrintSender,
    ) -> BackendResult<()> {
        use objc2::runtime::{AnyObject, ProtocolObject};
        use objc2_app_kit::{
            NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode,
        };
        use objc2_foundation::{NSCopying, NSSize, NSString, NSURL};
        // SAFETY: with_webview provides the live WKWebView on the main thread;
        // AppKit retains the print operation while it runs asynchronously.
        unsafe {
            let view: &objc2_web_kit::WKWebView = &*webview.inner().cast();
            let info = NSPrintInfo::sharedPrintInfo().copy();
            info.setPaperSize(NSSize::new(595.28, 841.89));
            info.setTopMargin(51.0);
            info.setBottomMargin(51.0);
            info.setLeftMargin(51.0);
            info.setRightMargin(51.0);
            info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
            info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
            info.setVerticallyCentered(false);
            info.setJobDisposition(NSPrintSaveJob);
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
            info.dictionary().setObject_forKey(
                &*url as &AnyObject,
                ProtocolObject::from_ref(NSPrintJobSavingURL),
            );
            let operation = view.printOperationWithPrintInfo(&info);
            operation.setShowsPrintPanel(false);
            operation.setShowsProgressPanel(false);
            operation.setCanSpawnSeparateThread(true);
            let marker = MainThreadMarker::new().ok_or_else(|| {
                BackendError::new("pdfExport", "PDF rendering requires the main thread.")
            })?;
            let allocated = PrintCompletion::alloc(marker).set_ivars(sender);
            let delegate: Retained<PrintCompletion> = msg_send![super(allocated), init];
            let delegate = Retained::into_raw(delegate);
            let window: &objc2_app_kit::NSWindow = &*webview.ns_window().cast();
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                window,
                Some(&*delegate as &AnyObject),
                Some(objc2::sel!(printOperation:didRun:contextInfo:)),
                std::ptr::null_mut(),
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::tests::TestDirectory;

    #[test]
    fn names_pdf_and_protects_source_and_open_targets() {
        assert_eq!(suggested_pdf_name("/notes/中文.md"), "中文.pdf");
        let directory = TestDirectory::new("pdf-target");
        for name in ["source.md", "source.pdf"] {
            let path = directory.path().join(name);
            std::fs::write(&path, "original").unwrap();
            assert!(save_pdf(&path, b"%PDF-test", &[super::super::display_path(&path)]).is_err());
            assert_eq!(std::fs::read_to_string(path).unwrap(), "original");
        }
    }

    #[test]
    fn invalid_pdf_never_replaces_previous_output() {
        let directory = TestDirectory::new("pdf-invalid");
        let path = directory.path().join("export.pdf");
        std::fs::write(&path, "previous").unwrap();
        assert!(save_pdf(&path, b"<html>not a PDF</html>", &[]).is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), "previous");
    }
}
