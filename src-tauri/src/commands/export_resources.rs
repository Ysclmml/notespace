use super::{BackendError, BackendResult};
use base64::Engine;
use quick_xml::events::Event;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::time::{Duration, Instant};

pub(super) const MAX_EXPORT_BYTES: usize = 80 * 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_MEDIA_BYTES: usize = 48 * 1024 * 1024;
const MAX_IMAGES: usize = 128;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportImage {
    pub id: String,
    pub source: String,
}

pub(super) fn image_source_paths(images: &[ExportImage]) -> Vec<String> {
    images
        .iter()
        .filter_map(|image| {
            let mut url = tauri::Url::parse(&image.source).ok()?;
            if url.scheme() != "file" {
                return None;
            }
            url.set_fragment(None);
            url.set_query(None);
            url.to_file_path()
                .ok()
                .map(|path| super::display_path(&path))
        })
        .collect()
}

fn resource_error(message: impl Into<String>) -> BackendError {
    BackendError::new("exportImageFailed", message)
}

fn read_bounded(reader: impl Read) -> BackendResult<Vec<u8>> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_IMAGE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| resource_error(error.to_string()))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(BackendError::new(
            "exportImageTooLarge",
            "Each exported image must be at most 16 MiB.",
        ));
    }
    Ok(bytes)
}

fn static_svg(bytes: &[u8]) -> BackendResult<()> {
    let source = std::str::from_utf8(bytes).map_err(|_| resource_error("SVG is not UTF-8."))?;
    let mut reader = quick_xml::Reader::from_str(source);
    let mut root_seen = false;
    let mut depth = 0usize;
    let mut style_depth = None;
    loop {
        let event = reader
            .read_event()
            .map_err(|error| resource_error(error.to_string()))?;
        let start = matches!(event, Event::Start(_));
        match event {
            Event::Start(element) | Event::Empty(element) => {
                let name = element.local_name();
                let tag = name.as_ref();
                if depth == 0 {
                    if root_seen {
                        return Err(resource_error("SVG has more than one root element."));
                    }
                    if tag != b"svg" {
                        return Err(resource_error("Image is not an SVG document."));
                    }
                    root_seen = true;
                }
                if start {
                    depth += 1;
                    if tag == b"style" {
                        style_depth = Some(depth);
                    }
                }
                if [
                    b"script".as_slice(),
                    b"iframe",
                    b"object",
                    b"embed",
                    b"foreignObject",
                    b"set",
                    b"animate",
                ]
                .contains(&tag)
                {
                    return Err(resource_error(
                        "SVG contains active or unsupported embedded content.",
                    ));
                }
                for attribute in element.attributes() {
                    let attribute = attribute.map_err(|error| resource_error(error.to_string()))?;
                    let key = attribute.key.local_name();
                    let value = attribute
                        .decoded_and_normalized_value(
                            quick_xml::XmlVersion::Implicit1_0,
                            reader.decoder(),
                        )
                        .map_err(|error| resource_error(error.to_string()))?;
                    if key.as_ref().starts_with(b"on")
                        || (key.as_ref() == b"href" && !value.starts_with('#'))
                        || key.as_ref() == b"base"
                    {
                        return Err(resource_error(
                            "SVG contains an external resource or action.",
                        ));
                    }
                    if [
                        b"style".as_slice(),
                        b"fill",
                        b"stroke",
                        b"filter",
                        b"clip-path",
                        b"mask",
                        b"marker-start",
                        b"marker-mid",
                        b"marker-end",
                        b"cursor",
                    ]
                    .contains(&key.as_ref())
                    {
                        validate_svg_style(&value)?;
                    }
                }
            }
            Event::Text(text) => {
                let decoded = text
                    .decode()
                    .map_err(|error| resource_error(error.to_string()))?;
                let value = quick_xml::escape::unescape(&decoded)
                    .map_err(|error| resource_error(error.to_string()))?;
                if depth == 0 && !value.trim().is_empty() {
                    return Err(resource_error(
                        "SVG contains text outside its root element.",
                    ));
                }
                if style_depth.is_some() {
                    validate_svg_style(&value)?;
                }
            }
            Event::CData(text) => {
                if style_depth.is_some() {
                    validate_svg_style(
                        &text
                            .decode()
                            .map_err(|error| resource_error(error.to_string()))?,
                    )?;
                }
            }
            Event::DocType(_) | Event::PI(_) => {
                return Err(resource_error(
                    "SVG external declarations are not supported.",
                ))
            }
            Event::End(_) => {
                if style_depth == Some(depth) {
                    style_depth = None;
                }
                depth = depth.saturating_sub(1);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !root_seen || depth != 0 {
        return Err(resource_error("Image is empty."));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn validate_native_raster(bytes: &[u8]) -> BackendResult<()> {
    objc2::rc::autoreleasepool(|_| {
        let data = objc2_foundation::NSData::with_bytes(bytes);
        let image = objc2_app_kit::NSBitmapImageRep::imageRepWithData(&data)
            .ok_or_else(|| resource_error("The image could not be decoded."))?;
        let width = usize::try_from(image.pixelsWide()).unwrap_or_default();
        let height = usize::try_from(image.pixelsHigh()).unwrap_or_default();
        if width == 0
            || height == 0
            || width
                .checked_mul(height)
                .is_none_or(|pixels| pixels > 32_000_000)
        {
            return Err(BackendError::new(
                "exportImageTooLarge",
                "An exported image must contain at most 32 million pixels.",
            ));
        }
        if image.bitmapData().is_null() {
            return Err(resource_error("The image pixels could not be decoded."));
        }
        Ok(())
    })
}

fn validate_raster(bytes: &[u8]) -> BackendResult<()> {
    // AVIF needs a platform decoder. Other platforms fail explicitly rather
    // than claiming a complete export with an unreadable image.
    if image_mime(bytes)? == "image/avif" {
        #[cfg(target_os = "macos")]
        return validate_native_raster(bytes);
        #[cfg(not(target_os = "macos"))]
        return Err(resource_error("AVIF export is not supported on this platform; convert this image to PNG or JPEG first."));
    }
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| resource_error(error.to_string()))?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(32_000_000);
    limits.max_image_height = Some(32_000_000);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let decoder = reader
        .into_decoder()
        .map_err(|error| resource_error(format!("The image could not be decoded: {error}")))?;
    use image::ImageDecoder;
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || u64::from(width) * u64::from(height) > 32_000_000
        || decoder.total_bytes() > 128 * 1024 * 1024
    {
        return Err(BackendError::new(
            "exportImageTooLarge",
            "An exported image must contain at most 32 million pixels.",
        ));
    }
    let mut pixels = vec![0; decoder.total_bytes() as usize];
    decoder.read_image(&mut pixels).map_err(|error| {
        resource_error(format!("The image pixels could not be decoded: {error}"))
    })?;
    Ok(())
}

fn validate_svg_style(value: &str) -> BackendResult<()> {
    let lower = value.to_ascii_lowercase();
    if lower.contains("@import") || lower.contains("\\") {
        return Err(resource_error(
            "SVG contains an unsupported external style.",
        ));
    }
    for tail in lower.split("url(").skip(1) {
        let reference = tail
            .split(')')
            .next()
            .unwrap_or_default()
            .trim()
            .trim_matches(['\'', '"']);
        if !reference.starts_with('#') {
            return Err(resource_error("SVG depends on an external style resource."));
        }
    }
    Ok(())
}

fn image_mime(bytes: &[u8]) -> BackendResult<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Ok("image/png");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Ok("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Ok("image/gif");
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Ok("image/webp");
    }
    if bytes.starts_with(b"BM") {
        return Ok("image/bmp");
    }
    if bytes.starts_with(b"\0\0\x01\0") {
        return Ok("image/x-icon");
    }
    if bytes.get(4..8) == Some(b"ftyp")
        && bytes
            .get(8..12)
            .is_some_and(|brand| brand == b"avif" || brand == b"avis")
    {
        return Ok("image/avif");
    }
    static_svg(bytes)?;
    Ok("image/svg+xml")
}

fn read_image(
    source: &str,
    allow_remote_images: bool,
    remaining: Duration,
) -> BackendResult<Vec<u8>> {
    let mut url = tauri::Url::parse(source).map_err(|error| resource_error(error.to_string()))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(resource_error(
            "Image URLs containing credentials are not supported.",
        ));
    }
    match url.scheme() {
        "file" => {
            url.set_fragment(None);
            url.set_query(None);
            let path = url
                .to_file_path()
                .map_err(|_| resource_error("Invalid local image path."))?;
            if !std::fs::metadata(&path).is_ok_and(|metadata| metadata.is_file()) {
                return Err(resource_error(format!(
                    "Image is missing or not a regular file: {}",
                    path.display()
                )));
            }
            let file = File::open(&path)
                .map_err(|error| resource_error(format!("{}: {error}", path.display())))?;
            let metadata = file
                .metadata()
                .map_err(|error| resource_error(error.to_string()))?;
            if !metadata.is_file() {
                return Err(resource_error("The image path is not a regular file."));
            }
            if metadata.len() > MAX_IMAGE_BYTES as u64 {
                return Err(BackendError::new(
                    "exportImageTooLarge",
                    "Each exported image must be at most 16 MiB.",
                ));
            }
            read_bounded(file)
        }
        "https" | "http" => {
            if !allow_remote_images {
                return Err(BackendError::new("exportRemoteImagesDisabled", "This document has online images. Enable downloading images for this export, or save the images locally first."));
            }
            url.set_fragment(None);
            let agent: ureq::Agent = ureq::Agent::config_builder()
                .timeout_global(Some(remaining.min(Duration::from_secs(15))))
                .max_redirects(5)
                .build()
                .into();
            let mut response = agent
                .get(url.as_str())
                .header("Accept", "image/*")
                .call()
                .map_err(|error| resource_error(format!("{}: {error}", url.as_str())))?;
            read_bounded(response.body_mut().as_reader())
        }
        _ => Err(resource_error("Unsupported image URL protocol.")),
    }
}

/** Image bytes stay native. Only the finished export contains Base64. */
pub(crate) fn embed_export_images(
    html: String,
    images: &[ExportImage],
    allow_remote_images: bool,
) -> BackendResult<String> {
    if images.len() > MAX_IMAGES || html.len() > MAX_EXPORT_BYTES {
        return Err(BackendError::new(
            "htmlExportTooLarge",
            "Export exceeds its resource budget.",
        ));
    }
    let started = Instant::now();
    let mut total_media = 0;
    let mut identifiers = HashSet::new();
    let mut cache = HashMap::<&str, String>::new();
    let mut replacements = Vec::new();
    for image in images {
        if !image
            .id
            .strip_prefix("notespace-export-image-")
            .is_some_and(|suffix| {
                !suffix.is_empty() && suffix.bytes().all(|character| character.is_ascii_digit())
            })
            || !identifiers.insert(&image.id)
        {
            return Err(resource_error("Invalid export image identifier."));
        }
        let token = format!("src=\"{}\"", image.id);
        if !html.contains(&token) {
            return Err(resource_error("The export image reference is missing."));
        }
        let data = if let Some(data) = cache.get(image.source.as_str()) {
            data.clone()
        } else {
            let remaining = Duration::from_secs(60)
                .checked_sub(started.elapsed())
                .ok_or_else(|| resource_error("Image export timed out."))?;
            let bytes = read_image(&image.source, allow_remote_images, remaining)?;
            total_media += bytes.len();
            if total_media > MAX_MEDIA_BYTES {
                return Err(BackendError::new(
                    "htmlExportTooLarge",
                    "Export supports at most 48 MiB of images.",
                ));
            }
            let mime = image_mime(&bytes)?;
            if mime != "image/svg+xml" {
                validate_raster(&bytes)?;
            }
            let data = format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            );
            cache.insert(image.source.as_str(), data.clone());
            data
        };
        let fragment = tauri::Url::parse(&image.source)
            .ok()
            .and_then(|url| url.fragment().map(str::to_owned));
        // Preserve SVG view fragments while keeping attribute syntax inert.
        let fragment = fragment
            .map(|value| {
                format!(
                    "#{}",
                    value
                        .replace('&', "&amp;")
                        .replace('"', "&quot;")
                        .replace('<', "&lt;")
                )
            })
            .unwrap_or_default();
        replacements.push((token, format!("src=\"{data}{fragment}\"")));
    }
    let mut result = html;
    for (token, replacement) in replacements {
        let count = result.matches(&token).count();
        let final_length = count
            .checked_mul(replacement.len().saturating_sub(token.len()))
            .and_then(|growth| result.len().checked_add(growth));
        if final_length.is_none_or(|length| length > MAX_EXPORT_BYTES) {
            return Err(BackendError::new(
                "htmlExportTooLarge",
                "The completed export is larger than 80 MiB.",
            ));
        }
        result = result.replace(&token, &replacement);
        if result.len() > MAX_EXPORT_BYTES {
            return Err(BackendError::new(
                "htmlExportTooLarge",
                "The completed export is larger than 80 MiB.",
            ));
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::tests::TestDirectory;

    fn image(id: usize, source: String) -> ExportImage {
        ExportImage {
            id: format!("notespace-export-image-{id}"),
            source,
        }
    }

    #[test]
    fn embeds_local_unicode_images_and_preserves_original_files() {
        let directory = TestDirectory::new("portable-images");
        let path = directory.path().join("中文 image.svg");
        let bytes = b"<svg xmlns=\"http://www.w3.org/2000/svg\"><text>hello</text></svg>";
        std::fs::write(&path, bytes).unwrap();
        let source = tauri::Url::from_file_path(&path).unwrap().to_string();
        let html =
            "<img src=\"notespace-export-image-0\"><img src=\"notespace-export-image-0\">".into();
        let result = embed_export_images(html, &[image(0, source)], false).unwrap();
        assert_eq!(result.matches("data:image/svg+xml;base64,").count(), 2);
        assert!(!result.contains("file:"));
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn online_images_require_explicit_opt_in_before_any_request() {
        let result = embed_export_images(
            "<img src=\"notespace-export-image-0\">".into(),
            &[image(0, "https://example.invalid/image.png".into())],
            false,
        );
        assert_eq!(result.unwrap_err().code, "exportRemoteImagesDisabled");
    }

    #[test]
    fn refuses_missing_and_non_image_resources() {
        let directory = TestDirectory::new("portable-invalid");
        let path = directory.path().join("missing.png");
        let source = tauri::Url::from_file_path(&path).unwrap().to_string();
        assert!(read_image(&source, false, Duration::from_secs(1)).is_err());
        assert!(image_mime(b"<html>not an image</html>").is_err());
        assert!(image_mime(b"").is_err());
    }

    #[test]
    fn svg_must_not_depend_on_remote_images_or_execute_content() {
        for source in [
            "<svg><image href=\"https://example.invalid/a.png\"/></svg>",
            "<svg><style>@import 'https://example.invalid/a.css';</style></svg>",
            "<svg><style>rect{fill:url(https://example.invalid/a.svg)}</style></svg>",
            "<svg onload=\"alert(1)\"/>",
            "<svg><script>alert(1)</script></svg>",
            "<svg><foreignObject/></svg>",
        ] {
            assert!(image_mime(source.as_bytes()).is_err(), "{source}");
        }
        assert!(image_mime(
            b"<svg><defs><linearGradient id=\"a\"/></defs><rect fill=\"url(#a)\"/></svg>"
        )
        .is_ok());
        assert!(image_mime(br#"<svg xmlns="http://www.w3.org/2000/svg"><text aria-label="C:\notes">C:\notes\file.md @import</text></svg>"#).is_ok());
    }

    #[test]
    fn exact_read_budget_and_invalid_ids_are_rejected() {
        assert!(read_bounded(std::io::repeat(0).take(MAX_IMAGE_BYTES as u64)).is_ok());
        assert!(read_bounded(std::io::repeat(0).take(MAX_IMAGE_BYTES as u64 + 1)).is_err());
        assert!(embed_export_images(
            "<img>".into(),
            &[ExportImage {
                id: "bad\"".into(),
                source: "file:///missing".into()
            }],
            false
        )
        .is_err());
    }

    #[test]
    fn explicit_remote_download_is_a_bounded_get_without_credentials_or_referrer() {
        use std::io::Write;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = [0; 4096];
            let count = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..count]).to_lowercase();
            assert!(request.starts_with("get /image.svg http/1.1"));
            for header in ["cookie:", "authorization:", "referer:"] {
                assert!(!request.contains(header));
            }
            let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><text>download</text></svg>";
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: image/svg+xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{svg}", svg.len()).unwrap();
        });
        let result = embed_export_images(
            "<img src=\"notespace-export-image-0\">".into(),
            &[image(0, format!("http://{address}/image.svg"))],
            true,
        )
        .unwrap();
        assert!(result.contains("data:image/svg+xml;base64,"));
        server.join().unwrap();
    }

    #[test]
    fn repeated_images_cannot_expand_past_final_budget() {
        let directory = TestDirectory::new("portable-repeated-budget");
        let path = directory.path().join("large.svg");
        let source = format!("<svg><text>{}</text></svg>", "x".repeat(1024 * 1024));
        std::fs::write(&path, source).unwrap();
        let url = tauri::Url::from_file_path(path).unwrap().to_string();
        let result = embed_export_images(
            "<img src=\"notespace-export-image-0\">".repeat(100),
            &[image(0, url)],
            false,
        );
        assert_eq!(result.unwrap_err().code, "htmlExportTooLarge");
    }

    #[test]
    fn a_raster_header_without_decodable_pixels_is_rejected() {
        assert!(validate_raster(b"\x89PNG\r\n\x1a\n").is_err());
        let mut png = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut png, 1, 1);
            encoder.set_color(png::ColorType::Rgb);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&[10, 20, 30]).unwrap();
        }
        assert!(validate_raster(&png).is_ok());
    }
}
