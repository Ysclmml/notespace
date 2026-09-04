mod application;
#[cfg(desktop)]
mod commands;
mod infrastructure;
#[cfg(desktop)]
pub mod lan_share;
#[cfg(mobile)]
mod mobile_discovery;
#[cfg(desktop)]
mod native_menu;
#[cfg(desktop)]
mod opened_documents;

#[cfg(desktop)]
fn should_exit_after_window_event(label: &str, event: &tauri::WindowEvent) -> bool {
    label == "main" && matches!(event, tauri::WindowEvent::Destroyed)
}

#[cfg(desktop)]
fn run_platform() {
    let builder = tauri::Builder::default()
        .manage(commands::filesystem::FileSystemWatchState::default())
        .manage(opened_documents::OpenedDocumentQueue::from_launch_arguments())
        .menu(native_menu::build_default_native_menu)
        .on_menu_event(native_menu::handle_native_menu_event)
        .on_window_event(|window, event| {
            if should_exit_after_window_event(window.label(), event) {
                tauri::Manager::app_handle(window).exit(0);
            }
        });

    let builder = builder
        .manage(commands::lan_share::LanShareState::default())
        .invoke_handler(tauri::generate_handler![
            commands::pick_workspace,
            commands::pick_document,
            commands::pick_image_directory,
            commands::list_workspace,
            commands::workspace_search::search_workspaces,
            commands::lan_share::lan_share_status,
            commands::lan_share::start_lan_share,
            commands::lan_share::stop_lan_share,
            commands::update_check::check_for_update,
            commands::html_export::export_html,
            commands::pdf_export::export_pdf,
            commands::document_templates::list_document_templates,
            commands::document_templates::read_document_template,
            commands::document_templates::save_document_template,
            commands::open_document,
            commands::filesystem::inspect_documents,
            commands::filesystem::watch_filesystem,
            commands::open_external_url,
            commands::reveal_in_file_manager,
            commands::move_workspace_entry_to_trash,
            commands::create_workspace_text_file,
            commands::create_workspace_folder,
            commands::preview_local_file,
            commands::save_document,
            commands::save_document_as,
            commands::save_clipboard_image,
            commands::clipboard_has_image,
            commands::prepare_local_image,
            commands::set_native_menu_locale,
            opened_documents::take_opened_document_paths,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build NoteSpace");
    app.run(opened_documents::handle_run_event);
}

#[cfg(mobile)]
fn run_platform() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            mobile_discovery::discover_lan_services,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run NoteSpace Mobile");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    run_platform();
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[test]
    fn exits_only_after_the_main_window_is_destroyed() {
        assert!(should_exit_after_window_event(
            "main",
            &tauri::WindowEvent::Destroyed
        ));
        assert!(!should_exit_after_window_event(
            "preview",
            &tauri::WindowEvent::Destroyed
        ));
        assert!(!should_exit_after_window_event(
            "main",
            &tauri::WindowEvent::Focused(false)
        ));
    }
}
