mod application;
mod commands;
pub mod domain;
mod infrastructure;
pub mod ipc_schema;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run Markdown Workspace");
}
