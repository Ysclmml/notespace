use super::{display_path, BackendError, BackendResult, SavedClipboardImage, UNIQUE_COUNTER};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_IMAGE_PIXELS: usize = 32_000_000;
const PREVIEW_IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "ico",
];

#[derive(Debug, PartialEq)]
struct RgbaImage {
    width: u32,
    height: u32,
    bytes: Vec<u8>,
}

pub(super) fn normalize_image_directory(path: &Path) -> BackendResult<PathBuf> {
    let invalid = || {
        BackendError::new(
            "imageDirectoryUnavailable",
            "choose an existing absolute folder for pasted images",
        )
    };
    if !path.is_absolute() {
        return Err(invalid());
    }
    let path = path.canonicalize().map_err(|_| invalid())?;
    if !path.is_dir() {
        return Err(invalid());
    }
    Ok(path)
}

pub(super) fn normalize_local_image(path: &Path) -> BackendResult<PathBuf> {
    if !path.is_absolute() {
        return Err(BackendError::new(
            "invalidPath",
            "image path must be absolute",
        ));
    }
    let path = path
        .canonicalize()
        .map_err(|error| BackendError::io("image could not be opened", error))?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !path.is_file() || !PREVIEW_IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(BackendError::new(
            "unsupportedImage",
            "image preview requires an existing supported image file",
        ));
    }
    Ok(path)
}

pub(super) fn save_system_clipboard_image(
    document_path: &Path,
    directory_path: Option<&Path>,
) -> BackendResult<SavedClipboardImage> {
    // Resolve the destination before reading or decoding a possibly large image.
    let (document_directory, image_directory) = image_directories(document_path, directory_path)?;
    let image = read_clipboard_image()?;
    save_rgba_image(&document_directory, &image_directory, &image)
}

pub(super) fn has_system_clipboard_image() -> BackendResult<bool> {
    image_presence(read_clipboard_image())
}

fn image_presence(image: BackendResult<RgbaImage>) -> BackendResult<bool> {
    match image {
        Ok(_) => Ok(true),
        Err(error) if error.code == "clipboardNoImage" => Ok(false),
        Err(error) => Err(error),
    }
}

fn image_directories(
    document_path: &Path,
    directory_path: Option<&Path>,
) -> BackendResult<(PathBuf, PathBuf)> {
    let not_saved = || {
        BackendError::new(
            "documentNotSaved",
            "save the Markdown document before pasting an image",
        )
    };
    let document_path = document_path.canonicalize().map_err(|_| not_saved())?;
    if !document_path.is_file() {
        return Err(not_saved());
    }
    let document_directory = document_path.parent().ok_or_else(not_saved)?.to_path_buf();
    let image_directory = match directory_path.filter(|path| !path.as_os_str().is_empty()) {
        Some(directory) => normalize_image_directory(directory)?,
        None => document_directory.clone(),
    };
    Ok((document_directory, image_directory))
}

fn read_clipboard_image() -> BackendResult<RgbaImage> {
    #[cfg(target_os = "macos")]
    {
        // Prefer the original PNG. AppKit handles native TIFF representations
        // produced by other macOS apps that arboard's TIFF decoder can reject.
        read_macos_image()
    }
    #[cfg(not(target_os = "macos"))]
    read_arboard_image()
}

#[cfg(not(target_os = "macos"))]
fn read_arboard_image() -> BackendResult<RgbaImage> {
    let mut clipboard = arboard::Clipboard::new().map_err(clipboard_error)?;
    let image = clipboard.get_image().map_err(clipboard_error)?;
    let width = u32::try_from(image.width).map_err(|_| image_too_large())?;
    let height = u32::try_from(image.height).map_err(|_| image_too_large())?;
    let expected = rgba_length(width, height)?;
    if image.bytes.len() != expected {
        return Err(invalid_rgba());
    }
    Ok(RgbaImage {
        width,
        height,
        bytes: image.bytes.into_owned(),
    })
}

#[cfg(any(not(target_os = "macos"), test))]
fn clipboard_error(error: arboard::Error) -> BackendError {
    let code = match error {
        arboard::Error::ContentNotAvailable => "clipboardNoImage",
        arboard::Error::ConversionFailure => "imageDecodeFailed",
        _ => "clipboardUnavailable",
    };
    BackendError::new(code, error.to_string())
}

#[cfg(any(target_os = "macos", test))]
fn image_with_fallback(
    png: BackendResult<Option<RgbaImage>>,
    fallback: impl FnOnce() -> BackendResult<RgbaImage>,
) -> BackendResult<RgbaImage> {
    match png {
        Ok(Some(image)) => Ok(image),
        Ok(None) => fallback().map_err(|error| {
            BackendError::new(
                error.code,
                format!("No PNG representation; TIFF: {}", error.message),
            )
        }),
        Err(png_error) => match fallback() {
            Ok(image) => Ok(image),
            // Do not disguise malformed PNG data or a denied clipboard read as
            // "there is no image" just because no TIFF alternative was present.
            Err(error) if error.code == "clipboardNoImage" => Err(png_error),
            Err(error) => Err(BackendError::new(
                error.code,
                format!("PNG: {}; TIFF: {}", png_error.message, error.message),
            )),
        },
    }
}

#[cfg(target_os = "macos")]
fn read_macos_image() -> BackendResult<RgbaImage> {
    use objc2::{msg_send, rc::autoreleasepool, rc::Retained, ClassType};
    use objc2_app_kit::NSPasteboard;

    autoreleasepool(|_| {
        // Unlike the non-null binding, this also handles clipboard services
        // being unavailable (for example an app launched without a GUI session).
        let pasteboard: Option<Retained<NSPasteboard>> =
            unsafe { msg_send![NSPasteboard::class(), generalPasteboard] };
        let pasteboard = pasteboard.ok_or_else(|| {
            BackendError::new("clipboardUnavailable", "system clipboard is unavailable")
        })?;
        image_from_macos_pasteboard(&pasteboard)
    })
}

#[cfg(target_os = "macos")]
fn image_from_macos_pasteboard(
    pasteboard: &objc2_app_kit::NSPasteboard,
) -> BackendResult<RgbaImage> {
    image_with_fallback(png_from_pasteboard(pasteboard), || {
        use objc2_app_kit::NSPasteboardTypeTIFF;

        let data = pasteboard
            .dataForType(unsafe { NSPasteboardTypeTIFF })
            .ok_or_else(|| BackendError::new("clipboardNoImage", "no TIFF image is available"))?;
        decode_macos_tiff(&data)
    })
}

#[cfg(target_os = "macos")]
fn decode_macos_tiff(data: &objc2_foundation::NSData) -> BackendResult<RgbaImage> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::NSDictionary;

    if data.len() > MAX_IMAGE_PIXELS * 4 {
        return Err(image_too_large());
    }
    let bitmap = NSBitmapImageRep::imageRepWithData(data).ok_or_else(|| {
        BackendError::new("imageDecodeFailed", "macOS could not decode the TIFF image")
    })?;
    let width = u32::try_from(bitmap.pixelsWide()).map_err(|_| invalid_rgba())?;
    let height = u32::try_from(bitmap.pixelsHigh()).map_err(|_| invalid_rgba())?;
    // Check dimensions before asking AppKit to allocate an encoded PNG. Keep
    // platform-specific TIFF decoding native; no pixels cross the IPC boundary.
    rgba_length(width, height)?;
    // SAFETY: An empty dictionary contains no incorrectly typed properties.
    let png = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }
    .ok_or_else(|| {
        BackendError::new(
            "imageDecodeFailed",
            "macOS could not convert TIFF pixels to PNG",
        )
    })?;
    // SAFETY: The retained immutable NSData stays alive throughout decoding.
    decode_png(unsafe { png.as_bytes_unchecked() }).map_err(|error| {
        BackendError::new(
            error.code,
            format!("TIFF PNG conversion: {}", error.message),
        )
    })
}

#[cfg(target_os = "macos")]
fn png_from_pasteboard(
    pasteboard: &objc2_app_kit::NSPasteboard,
) -> BackendResult<Option<RgbaImage>> {
    use objc2_app_kit::NSPasteboardTypePNG;

    let Some(data) = pasteboard.dataForType(unsafe { NSPasteboardTypePNG }) else {
        return Ok(None);
    };
    if data.len() > MAX_IMAGE_PIXELS * 4 {
        return Err(image_too_large());
    }
    // SAFETY: this immutable NSData is retained through decoding and is never
    // mutated. Pixels stay native; neither bytes nor Base64 cross the IPC bridge.
    decode_png(unsafe { data.as_bytes_unchecked() }).map(Some)
}

#[cfg(any(target_os = "macos", test))]
fn decode_png(bytes: &[u8]) -> BackendResult<RgbaImage> {
    let decode_error = |error: png::DecodingError| {
        BackendError::new(
            "imageDecodeFailed",
            format!("PNG could not be decoded: {error}"),
        )
    };
    let mut decoder = png::Decoder::new(io::Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: MAX_IMAGE_PIXELS * 4,
    });
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(decode_error)?;
    let expected = rgba_length(reader.info().width, reader.info().height)?;
    let output_size = reader.output_buffer_size().ok_or_else(image_too_large)?;
    if output_size > MAX_IMAGE_PIXELS * 4 {
        return Err(image_too_large());
    }
    let mut pixels = vec![0; output_size];
    let frame = reader.next_frame(&mut pixels).map_err(decode_error)?;
    pixels.truncate(frame.buffer_size());
    let bytes = match frame.color_type {
        png::ColorType::Rgba => pixels,
        png::ColorType::Rgb => pixels
            .as_chunks::<3>()
            .0
            .iter()
            .flat_map(|rgb| [rgb[0], rgb[1], rgb[2], 255])
            .collect(),
        png::ColorType::Grayscale => pixels
            .into_iter()
            .flat_map(|gray| [gray, gray, gray, 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => pixels
            .as_chunks::<2>()
            .0
            .iter()
            .flat_map(|gray| [gray[0], gray[0], gray[0], gray[1]])
            .collect(),
        png::ColorType::Indexed => return Err(invalid_rgba()),
    };
    if bytes.len() != expected {
        return Err(invalid_rgba());
    }
    Ok(RgbaImage {
        width: frame.width,
        height: frame.height,
        bytes,
    })
}

fn image_too_large() -> BackendError {
    BackendError::new("imageTooLarge", "clipboard image exceeds 32 million pixels")
}

fn invalid_rgba() -> BackendError {
    BackendError::new(
        "invalidImage",
        "clipboard image does not contain valid RGBA pixels",
    )
}

fn rgba_length(width: u32, height: u32) -> BackendResult<usize> {
    if width == 0 || height == 0 {
        return Err(invalid_rgba());
    }
    let pixels = usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .filter(|pixels| *pixels <= MAX_IMAGE_PIXELS)
        .ok_or_else(image_too_large)?;
    pixels.checked_mul(4).ok_or_else(image_too_large)
}

fn save_rgba_image(
    document_directory: &Path,
    image_directory: &Path,
    image: &RgbaImage,
) -> BackendResult<SavedClipboardImage> {
    if rgba_length(image.width, image.height)? != image.bytes.len() {
        return Err(invalid_rgba());
    }
    let mut encoded = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut encoded, image.width, image.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|error| BackendError::new("imageEncodeFailed", error.to_string()))?;
        writer
            .write_image_data(&image.bytes)
            .map_err(|error| BackendError::new("imageEncodeFailed", error.to_string()))?;
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    for _ in 0..16 {
        let counter = UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let image_path = image_directory.join(format!("paste-{timestamp}-{counter}.png"));
        let markdown_uri = image_markdown_uri(document_directory, &image_path)?;
        match write_new_image(&image_path, &encoded, || Ok(())) {
            Ok(()) => {
                return Ok(SavedClipboardImage {
                    path: display_path(&image_path),
                    markdown_uri,
                    width: image.width,
                    height: image.height,
                });
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(BackendError::io(
                    "clipboard image could not be saved",
                    error,
                ));
            }
        }
    }
    Err(BackendError::new(
        "io",
        "a unique image name could not be allocated",
    ))
}

fn write_new_image(
    image_path: &Path,
    encoded: &[u8],
    before_write: impl FnOnce() -> io::Result<()>,
) -> io::Result<()> {
    // create_new is essential: atomic_write's replacement semantics are correct
    // for document saves, but must never overwrite an existing image on collision.
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(image_path)?;
    let result = (|| {
        before_write()?;
        file.write_all(encoded)?;
        file.flush()?;
        file.sync_all()
    })();
    drop(file);
    if result.is_err() {
        // Only this invocation's successfully created, exact file is removed.
        let _ = fs::remove_file(image_path);
    }
    result
}

fn image_markdown_uri(document_directory: &Path, image_path: &Path) -> BackendResult<String> {
    let base: Vec<_> = document_directory.components().collect();
    let target: Vec<_> = image_path.components().collect();
    if base.first() != target.first() {
        // Different Windows volumes cannot be represented by a relative path.
        return tauri::Url::from_file_path(image_path)
            .map(|url| url.to_string())
            .map_err(|_| BackendError::new("invalidPath", "image path is not a valid file URL"));
    }
    let common = base.iter().zip(&target).take_while(|(a, b)| a == b).count();
    let mut parts = vec!["..".to_owned(); base.len() - common];
    for component in &target[common..] {
        let Component::Normal(name) = component else {
            return Err(BackendError::new(
                "invalidPath",
                "image path is not normalized",
            ));
        };
        let name = name
            .to_str()
            .ok_or_else(|| BackendError::new("invalidPath", "image path is not valid UTF-8"))?;
        parts.push(encode_path_segment(name));
    }
    let relative = parts.join("/");
    Ok(if base.len() == common {
        format!("./{relative}")
    } else {
        relative
    })
}

fn encode_path_segment(name: &str) -> String {
    use std::fmt::Write;

    let mut encoded = String::new();
    for byte in name.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            write!(encoded, "%{byte:02X}").expect("writing to a String is infallible");
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::tests::TestDirectory;

    fn sample_image() -> RgbaImage {
        RgbaImage {
            width: 2,
            height: 1,
            bytes: vec![255, 0, 0, 255, 0, 255, 0, 128],
        }
    }

    fn png_bytes(color: png::ColorType, pixels: &[u8]) -> Vec<u8> {
        let mut encoded = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut encoded, 2, 1);
            encoder.set_color(color);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("PNG header");
            writer.write_image_data(pixels).expect("PNG pixels");
        }
        encoded
    }

    #[test]
    fn png_decoding_preserves_rgba_and_converts_other_screenshot_color_types() {
        let expected = sample_image();
        assert_eq!(
            decode_png(&png_bytes(png::ColorType::Rgba, &expected.bytes)).unwrap(),
            expected
        );
        assert_eq!(
            decode_png(&png_bytes(png::ColorType::Rgb, &[255, 0, 0, 0, 255, 0]))
                .unwrap()
                .bytes,
            [255, 0, 0, 255, 0, 255, 0, 255]
        );
        assert_eq!(
            decode_png(&png_bytes(png::ColorType::Grayscale, &[32, 96]))
                .unwrap()
                .bytes,
            [32, 32, 32, 255, 96, 96, 96, 255]
        );
        assert_eq!(
            decode_png(&png_bytes(
                png::ColorType::GrayscaleAlpha,
                &[32, 128, 96, 255]
            ))
            .unwrap()
            .bytes,
            [32, 32, 32, 128, 96, 96, 96, 255]
        );
    }

    #[test]
    fn malformed_png_and_unsupported_dimensions_are_reported_without_pixels_or_paths() {
        assert_eq!(
            decode_png(b"not a PNG").unwrap_err().code,
            "imageDecodeFailed"
        );
        assert_eq!(rgba_length(0, 1).unwrap_err().code, "invalidImage");
        assert_eq!(rgba_length(1, 0).unwrap_err().code, "invalidImage");
        assert_eq!(rgba_length(8_000, 8_000).unwrap_err().code, "imageTooLarge");
        assert_eq!(
            rgba_length(u32::MAX, u32::MAX).unwrap_err().code,
            "imageTooLarge"
        );
    }

    #[test]
    fn png_only_does_not_require_tiff_and_tiff_fallback_preserves_meaningful_errors() {
        assert_eq!(
            image_with_fallback(Ok(Some(sample_image())), || panic!("PNG needs no fallback"))
                .unwrap(),
            sample_image()
        );
        assert_eq!(
            image_with_fallback(Ok(None), || Ok(sample_image())).unwrap(),
            sample_image()
        );
        assert_eq!(
            image_with_fallback(
                Err(BackendError::new(
                    "imageDecodeFailed",
                    "PNG decoding failed"
                )),
                || Ok(sample_image())
            )
            .unwrap(),
            sample_image()
        );
        assert_eq!(
            image_with_fallback(
                Err(BackendError::new(
                    "imageDecodeFailed",
                    "PNG decoding failed"
                )),
                || Err(clipboard_error(arboard::Error::ContentNotAvailable))
            )
            .unwrap_err()
            .code,
            "imageDecodeFailed"
        );
        assert_eq!(
            clipboard_error(arboard::Error::ContentNotAvailable).code,
            "clipboardNoImage"
        );
        assert_eq!(
            clipboard_error(arboard::Error::ConversionFailure).code,
            "imageDecodeFailed"
        );
        assert_eq!(
            clipboard_error(arboard::Error::ClipboardNotSupported).code,
            "clipboardUnavailable"
        );
    }

    #[test]
    fn image_presence_is_false_only_for_no_image_and_does_not_hide_clipboard_errors() {
        assert!(image_presence(Ok(sample_image())).unwrap());
        assert!(
            !image_presence(Err(clipboard_error(arboard::Error::ContentNotAvailable))).unwrap()
        );
        assert_eq!(
            image_presence(Err(clipboard_error(arboard::Error::ClipboardNotSupported)))
                .unwrap_err()
                .code,
            "clipboardUnavailable"
        );
        assert_eq!(
            image_presence(Err(clipboard_error(arboard::Error::ConversionFailure)))
                .unwrap_err()
                .code,
            "imageDecodeFailed"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_png_named_pasteboard_reads_without_touching_the_user_clipboard() {
        use objc2::rc::autoreleasepool;
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG};
        use objc2_foundation::NSData;

        autoreleasepool(|_| {
            // This is a private temporary pasteboard, never generalPasteboard.
            let pasteboard = NSPasteboard::pasteboardWithUniqueName();
            pasteboard.clearContents();
            assert!(png_from_pasteboard(&pasteboard).unwrap().is_none());
            let image = sample_image();
            let data = NSData::with_bytes(&png_bytes(png::ColorType::Rgba, &image.bytes));
            assert!(pasteboard.setData_forType(Some(&data), unsafe { NSPasteboardTypePNG }));
            let types = pasteboard.types().expect("declared pasteboard formats");
            assert!(types
                .iter()
                .any(|kind| &*kind == unsafe { NSPasteboardTypePNG }));
            // macOS may advertise/synthesize additional TIFF representations;
            // the PNG path reads the requested bytes without depending on them.
            let result = png_from_pasteboard(&pasteboard);
            pasteboard.clearContents();
            assert_eq!(result.unwrap(), Some(image));
        });
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_tiff_named_pasteboard_uses_native_decoding_for_rgb_rgba_and_compression() {
        use objc2::rc::autoreleasepool;
        use objc2_app_kit::{
            NSBitmapImageRep, NSPasteboard, NSPasteboardTypeTIFF, NSTIFFCompression,
        };
        use objc2_foundation::NSData;

        autoreleasepool(|_| {
            for color in [png::ColorType::Rgb, png::ColorType::Rgba] {
                let expected = if color == png::ColorType::Rgba {
                    sample_image()
                } else {
                    RgbaImage {
                        width: 2,
                        height: 1,
                        bytes: vec![255, 0, 0, 255, 0, 255, 0, 255],
                    }
                };
                let pixels = if color == png::ColorType::Rgba {
                    expected.bytes.clone()
                } else {
                    vec![255, 0, 0, 0, 255, 0]
                };
                let data = NSData::with_bytes(&png_bytes(color, &pixels));
                let bitmap = NSBitmapImageRep::imageRepWithData(&data).expect("synthetic pixels");
                for compression in [
                    NSTIFFCompression::None,
                    NSTIFFCompression::LZW,
                    NSTIFFCompression::PackBits,
                ] {
                    let tiff = bitmap
                        .TIFFRepresentationUsingCompression_factor(compression, 1.0)
                        .expect("native TIFF fixture");
                    // Only this private board is accessed, never generalPasteboard.
                    let pasteboard = NSPasteboard::pasteboardWithUniqueName();
                    pasteboard.clearContents();
                    assert!(
                        pasteboard.setData_forType(Some(&tiff), unsafe { NSPasteboardTypeTIFF })
                    );
                    let result = image_from_macos_pasteboard(&pasteboard);
                    pasteboard.clearContents();
                    assert_eq!(result.unwrap(), expected, "{color:?} {compression:?}");
                }
            }
        });
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_native_image_fallback_reports_stages_and_preserves_valid_representations() {
        use objc2::rc::autoreleasepool;
        use objc2_app_kit::{
            NSBitmapImageRep, NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeTIFF,
        };
        use objc2_foundation::NSData;

        autoreleasepool(|_| {
            let image = sample_image();
            let png = NSData::with_bytes(&png_bytes(png::ColorType::Rgba, &image.bytes));
            let bitmap = NSBitmapImageRep::imageRepWithData(&png).expect("synthetic pixels");
            let tiff = bitmap.TIFFRepresentation().expect("native TIFF fixture");
            let invalid = NSData::with_bytes(b"invalid synthetic image");
            let pasteboard = NSPasteboard::pasteboardWithUniqueName();
            pasteboard.clearContents();
            assert_eq!(
                image_from_macos_pasteboard(&pasteboard).unwrap_err().code,
                "clipboardNoImage"
            );

            assert!(pasteboard.setData_forType(Some(&png), unsafe { NSPasteboardTypePNG }));
            assert!(pasteboard.setData_forType(Some(&invalid), unsafe { NSPasteboardTypeTIFF }));
            let png_preferred = image_from_macos_pasteboard(&pasteboard);
            pasteboard.clearContents();
            assert_eq!(png_preferred.unwrap(), image);

            assert!(pasteboard.setData_forType(Some(&invalid), unsafe { NSPasteboardTypePNG }));
            assert!(pasteboard.setData_forType(Some(&tiff), unsafe { NSPasteboardTypeTIFF }));
            let valid_fallback = image_from_macos_pasteboard(&pasteboard);
            pasteboard.clearContents();
            assert_eq!(valid_fallback.unwrap(), image);

            assert!(pasteboard.setData_forType(Some(&invalid), unsafe { NSPasteboardTypeTIFF }));
            let invalid_tiff = image_from_macos_pasteboard(&pasteboard).unwrap_err();
            assert!(pasteboard.setData_forType(Some(&invalid), unsafe { NSPasteboardTypePNG }));
            let invalid_both = image_from_macos_pasteboard(&pasteboard).unwrap_err();
            pasteboard.clearContents();
            assert_eq!(invalid_tiff.code, "imageDecodeFailed");
            assert!(invalid_tiff
                .message
                .starts_with("No PNG representation; TIFF:"));
            assert_eq!(invalid_both.code, "imageDecodeFailed");
            assert!(invalid_both.message.contains("PNG could not be decoded"));
            assert!(invalid_both
                .message
                .contains("TIFF: macOS could not decode"));
            assert!(!invalid_both.message.contains("invalid synthetic image"));
        });
    }

    #[test]
    fn images_default_to_the_saved_markdown_directory_without_creating_assets() {
        let temp = TestDirectory::new("image-same-directory");
        let document = temp.path().join("notes.md");
        fs::write(&document, "# Test notes\n").unwrap();
        let (base, target) = image_directories(&document, None).unwrap();
        let saved = save_rgba_image(&base, &target, &sample_image()).unwrap();
        assert_eq!(Path::new(&saved.path).parent(), Some(base.as_path()));
        assert!(saved.markdown_uri.starts_with("./paste-"));
        assert_eq!(
            decode_png(&fs::read(&saved.path).unwrap()).unwrap(),
            sample_image()
        );
        assert_eq!(fs::read_to_string(&document).unwrap(), "# Test notes\n");
        assert!(!base.join("assets").exists());
    }

    #[test]
    fn custom_directory_uses_relative_links_with_encoded_unicode_spaces_and_punctuation() {
        let temp = TestDirectory::new("image-custom-directory");
        let notes = temp.path().join("notes");
        let images = temp.path().join("图片 (draft)#%");
        fs::create_dir(&notes).unwrap();
        fs::create_dir(&images).unwrap();
        let document = notes.join("notes.md");
        fs::write(&document, "# Test notes\n").unwrap();
        let (base, target) = image_directories(&document, Some(&images)).unwrap();
        let saved = save_rgba_image(&base, &target, &sample_image()).unwrap();
        assert!(saved
            .markdown_uri
            .starts_with("../%E5%9B%BE%E7%89%87%20%28draft%29%23%25/paste-"));
        assert_eq!(Path::new(&saved.path).parent(), Some(target.as_path()));
        let resolved = tauri::Url::from_directory_path(&base)
            .unwrap()
            .join(&saved.markdown_uri)
            .unwrap();
        assert_eq!(resolved.to_file_path().unwrap(), Path::new(&saved.path));
    }

    #[test]
    fn relative_uri_supports_descendants_siblings_and_ancestors() {
        let temp = TestDirectory::new("image-relative-uri");
        assert_eq!(
            image_markdown_uri(temp.path(), &temp.path().join("assets/paste.png")).unwrap(),
            "./assets/paste.png"
        );
        assert_eq!(
            image_markdown_uri(&temp.path().join("notes"), &temp.path().join("paste.png")).unwrap(),
            "../paste.png"
        );
    }

    #[test]
    fn missing_document_invalid_or_missing_target_does_not_create_anything() {
        let temp = TestDirectory::new("image-invalid-directory");
        let document = temp.path().join("notes.md");
        let missing = temp.path().join("missing");
        assert_eq!(
            image_directories(&document, None).unwrap_err().code,
            "documentNotSaved"
        );
        fs::write(&document, "# Test notes\n").unwrap();
        for invalid in [&missing, &document, Path::new("relative/assets")] {
            assert_eq!(
                image_directories(&document, Some(invalid))
                    .unwrap_err()
                    .code,
                "imageDirectoryUnavailable"
            );
        }
        assert_eq!(
            image_directories(&document, Some(Path::new(""))).unwrap(),
            image_directories(&document, None).unwrap()
        );
        assert!(!missing.exists());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn preview_authorization_resolves_only_a_specific_supported_image_file() {
        let temp = TestDirectory::new("image-preview-path");
        let folder = temp.path().join(".custom-images");
        fs::create_dir(&folder).unwrap();
        let image = folder.join("screenshot.PNG");
        fs::write(
            &image,
            png_bytes(png::ColorType::Rgba, &sample_image().bytes),
        )
        .unwrap();
        assert_eq!(
            normalize_local_image(&folder.join(".").join("screenshot.PNG")).unwrap(),
            image.canonicalize().unwrap()
        );
        assert_eq!(
            normalize_local_image(&folder).unwrap_err().code,
            "unsupportedImage"
        );
        assert_eq!(
            normalize_local_image(Path::new("relative.png"))
                .unwrap_err()
                .code,
            "invalidPath"
        );
        let unsupported = folder.join("notes.txt");
        fs::write(&unsupported, "test notes").unwrap();
        assert_eq!(
            normalize_local_image(&unsupported).unwrap_err().code,
            "unsupportedImage"
        );
        assert_eq!(
            normalize_local_image(&folder.join("missing.png"))
                .unwrap_err()
                .code,
            "io"
        );
    }

    #[test]
    fn saving_never_overwrites_existing_images_and_cleans_its_failed_new_file() {
        let temp = TestDirectory::new("image-no-overwrite");
        let existing = temp.path().join("paste.png");
        fs::write(&existing, b"existing image").unwrap();
        let error = write_new_image(&existing, b"replacement", || Ok(())).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&existing).unwrap(), b"existing image");
        let failed = temp.path().join("failed.png");
        assert!(write_new_image(&failed, b"pixels", || Err(io::Error::other(
            "injected write failure"
        )))
        .is_err());
        assert!(!failed.exists());
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn repeated_pastes_keep_both_files_and_invalid_pixels_write_nothing() {
        let temp = TestDirectory::new("image-repeat");
        let first = save_rgba_image(temp.path(), temp.path(), &sample_image()).unwrap();
        let second = save_rgba_image(temp.path(), temp.path(), &sample_image()).unwrap();
        assert_ne!(first.path, second.path);
        let mut invalid = sample_image();
        invalid.bytes.pop();
        assert_eq!(
            save_rgba_image(temp.path(), temp.path(), &invalid)
                .unwrap_err()
                .code,
            "invalidImage"
        );
        assert_eq!(fs::read_dir(temp.path()).unwrap().count(), 2);
    }
}
