mod application;
mod commands;
pub mod domain;
#[cfg(all(target_os = "macos", feature = "host-release-smoke"))]
mod host_release_smoke;
mod infrastructure;
pub mod ipc_schema;

#[cfg(all(feature = "ipc-transport-spike", target_os = "macos"))]
mod ipc_transport_spike;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(all(feature = "ipc-transport-spike", target_os = "macos"))]
    let builder = ipc_transport_spike::configure(builder);

    #[cfg(all(target_os = "macos", feature = "host-release-smoke"))]
    let builder = match host_release_smoke::configure(builder) {
        Ok(builder) => builder,
        Err(error_code) => {
            eprintln!("host release smoke startup rejected: {error_code}");
            std::process::exit(78);
        }
    };

    builder
        .run(tauri::generate_context!())
        .expect("failed to run Markdown Workspace");
}
