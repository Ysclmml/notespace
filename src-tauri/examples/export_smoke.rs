//! Opt-in macOS smoke: cargo run --example export_smoke -- /tmp/owned-output.pdf [synthetic.html]
//! No chooser, installed application, real notes, preferences or clipboard access.
#![allow(dead_code, unused_imports)]

#[path = "../src/commands/mod.rs"]
mod commands;
#[path = "../src/lan_share/mod.rs"]
mod lan_share;
#[path = "../src/native_menu.rs"]
mod native_menu;

#[cfg(target_os = "macos")]
fn main() {
    let output = std::env::args()
        .nth(1)
        .expect("an explicit synthetic output PDF path is required");
    let input = std::env::args().nth(2);
    let directory = std::path::Path::new(&output)
        .parent()
        .expect("output parent");
    let fixture_path = directory.join("fixture.png");
    if !fixture_path.exists() {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(fixture_path)
            .expect("create synthetic PNG");
        let mut encoder = png::Encoder::new(file, 480, 180);
        encoder.set_color(png::ColorType::Rgb);
        let mut writer = encoder.write_header().unwrap();
        let pixels: Vec<u8> = (0..480 * 180)
            .flat_map(|index| {
                if index % 480 < 160 {
                    [72, 103, 171]
                } else if index % 480 < 320 {
                    [133, 172, 184]
                } else {
                    [224, 194, 128]
                }
            })
            .collect();
        writer.write_image_data(&pixels).unwrap();
    }
    let html = input.map(|path| {
        let source = std::fs::read_to_string(&path).expect("read synthetic snapshot");
        if std::path::Path::new(&path).extension().is_some_and(|extension| extension == "json") {
            #[derive(serde::Deserialize)]
            struct Snapshot { html: String, images: Vec<commands::export_resources::ExportImage> }
            let snapshot: Snapshot = serde_json::from_str(&source).expect("parse synthetic snapshot");
            commands::export_resources::embed_export_images(snapshot.html, &snapshot.images, false).expect("embed synthetic images")
        } else { source }
    })
        .unwrap_or_else(|| {
            let paragraphs = (1..=80).map(|index| format!("<p>Paragraph {index}: searchable selectable text. 中文段落 {index}，导出应保留清晰的文字、行距与自动分页。The original Markdown remains unchanged.</p>")).collect::<String>();
            format!("<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\"><style>body{{font:16px -apple-system,sans-serif;line-height:1.75}}h1{{color:#263143}}p{{orphans:3;widows:3}}table{{border-collapse:collapse;width:100%}}td,th{{padding:12px;border:1px solid #aaa}}tr{{break-inside:avoid}}svg{{max-width:100%;height:auto}}</style></head><body><h1>NoteSpace PDF 验证</h1><p>Vector diagram and paginated text</p><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"140\" viewBox=\"0 0 400 140\"><rect x=\"10\" y=\"20\" width=\"150\" height=\"80\" fill=\"#eef3ff\" stroke=\"#7895df\"/><text x=\"35\" y=\"65\">开始 / Start</text><path d=\"M160 60 H240\" stroke=\"#647188\"/><rect x=\"240\" y=\"20\" width=\"150\" height=\"80\" fill=\"#eef3ff\" stroke=\"#7895df\"/><text x=\"265\" y=\"65\">结束 / End</text></svg><table><thead><tr><th>名称</th><th>Result</th></tr></thead><tbody><tr><td>文本</td><td>Selectable</td></tr></tbody></table>{paragraphs}</body></html>")
        });
    let html_path = std::path::Path::new(&output).with_extension("html");
    std::fs::write(html_path, &html).expect("write portable synthetic HTML");
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "app.notespace.synthetic-pdf-export".into();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match commands::pdf_export::render_pdf_snapshot(&handle, &html).await {
                    Ok(bytes) => {
                        std::fs::write(&output, &bytes).expect("write synthetic PDF");
                        println!("PDF_SMOKE_OK {} bytes {}", bytes.len(), output);
                        handle.exit(0);
                    }
                    Err(error) => {
                        eprintln!("PDF_SMOKE_FAILED {error:?}");
                        handle.exit(1);
                    }
                }
            });
            Ok(())
        })
        .run(context)
        .expect("run isolated PDF smoke");
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("Native PDF smoke is macOS-only.");
}
