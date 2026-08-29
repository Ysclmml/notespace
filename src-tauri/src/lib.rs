mod application;
mod commands;
mod infrastructure;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::pick_workspace,
            commands::list_workspace,
            commands::open_document,
            commands::save_document,
            commands::save_clipboard_image,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Markdown Workspace");
}
