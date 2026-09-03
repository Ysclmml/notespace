mod application;
mod commands;
mod infrastructure;
mod native_menu;

fn should_exit_after_window_event(label: &str, event: &tauri::WindowEvent) -> bool {
    label == "main" && matches!(event, tauri::WindowEvent::Destroyed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::filesystem::FileSystemWatchState::default())
        .menu(native_menu::build_default_native_menu)
        .on_menu_event(native_menu::handle_native_menu_event)
        .on_window_event(|window, event| {
            if should_exit_after_window_event(window.label(), event) {
                tauri::Manager::app_handle(window).exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_workspace,
            commands::pick_document,
            commands::pick_image_directory,
            commands::list_workspace,
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
        ])
        .run(tauri::generate_context!())
        .expect("failed to run NoteSpace");
}

#[cfg(test)]
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
