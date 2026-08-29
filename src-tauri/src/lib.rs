mod application;
mod commands;
mod domain;
mod infrastructure;

#[cfg(all(feature = "ipc-transport-spike", target_os = "macos"))]
mod ipc_transport_spike;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(all(feature = "ipc-transport-spike", target_os = "macos"))]
    let builder = ipc_transport_spike::configure(builder);

    builder
        .run(tauri::generate_context!())
        .expect("failed to run Markdown Workspace");
}
