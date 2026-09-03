use serde::Serialize;
use tauri::menu::{
    Menu, MenuBuilder, MenuEvent, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
    HELP_SUBMENU_ID, WINDOW_SUBMENU_ID,
};
#[cfg(debug_assertions)]
use tauri::Manager;
use tauri::{AppHandle, Emitter, Runtime};

pub const NATIVE_MENU_EVENT: &str = "native-menu-action";

pub const ACTION_NEW_DOCUMENT: &str = "file.new";
pub const ACTION_OPEN_DOCUMENT: &str = "file.open";
pub const ACTION_OPEN_WORKSPACE: &str = "workspace.open";
pub const ACTION_SAVE_DOCUMENT: &str = "file.save";
pub const ACTION_SAVE_DOCUMENT_AS: &str = "file.saveAs";
pub const ACTION_REVEAL_IN_FILE_MANAGER: &str = "file.reveal";
pub const ACTION_OPEN_SETTINGS: &str = "app.settings";
pub const ACTION_QUIT_APP: &str = "app.quit";
pub const ACTION_TOGGLE_SOURCE_MODE: &str = "view.toggleSource";
pub const ACTION_TOGGLE_SIDEBAR: &str = "view.toggleSidebar";
pub const ACTION_CLOSE_WINDOW: &str = "window.close";
pub const ACTION_OPEN_HELP: &str = "help.open";
pub const ACTION_OPEN_ABOUT: &str = "app.about";
pub const ACTION_FIND: &str = "edit.find";
pub const ACTION_FIND_WORKSPACE: &str = "edit.findWorkspace";
pub const ACTION_EXPORT_HTML: &str = "file.exportHtml";
pub const ACTION_EXPORT_PDF: &str = "file.exportPdf";
pub const ACTION_NEW_TEMPLATE: &str = "file.newTemplate";
pub const ACTION_TOGGLE_FOCUS: &str = "view.toggleFocus";
#[cfg(debug_assertions)]
const ACTION_OPEN_DEVTOOLS: &str = "view.openDevtools";

const FORWARDED_ACTIONS: &[&str] = &[
    ACTION_NEW_DOCUMENT,
    ACTION_OPEN_DOCUMENT,
    ACTION_OPEN_WORKSPACE,
    ACTION_SAVE_DOCUMENT,
    ACTION_SAVE_DOCUMENT_AS,
    ACTION_REVEAL_IN_FILE_MANAGER,
    ACTION_OPEN_SETTINGS,
    ACTION_QUIT_APP,
    ACTION_TOGGLE_SOURCE_MODE,
    ACTION_TOGGLE_SIDEBAR,
    ACTION_CLOSE_WINDOW,
    ACTION_OPEN_HELP,
    ACTION_OPEN_ABOUT,
    ACTION_FIND,
    ACTION_FIND_WORKSPACE,
    ACTION_EXPORT_HTML,
    ACTION_EXPORT_PDF,
    ACTION_NEW_TEMPLATE,
    ACTION_TOGGLE_FOCUS,
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NativeMenuLocale {
    ZhCn,
    EnUs,
}

impl NativeMenuLocale {
    fn from_locale(locale: &str) -> Self {
        if locale.eq_ignore_ascii_case("en-US") || locale.eq_ignore_ascii_case("en") {
            Self::EnUs
        } else {
            Self::ZhCn
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMenuAction {
    pub id: &'static str,
}

struct NativeMenuLabels {
    application: &'static str,
    file: &'static str,
    edit: &'static str,
    view: &'static str,
    window: &'static str,
    help: &'static str,
    about: &'static str,
    settings: &'static str,
    services: &'static str,
    hide: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    quit: &'static str,
    new_document: &'static str,
    open_document: &'static str,
    open_workspace: &'static str,
    save: &'static str,
    save_as: &'static str,
    reveal_in_file_manager: &'static str,
    close_window: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    find: &'static str,
    find_workspace: &'static str,
    export: &'static str,
    export_html: &'static str,
    export_pdf: &'static str,
    new_template: &'static str,
    toggle_focus: &'static str,
    toggle_source: &'static str,
    toggle_sidebar: &'static str,
    #[cfg(debug_assertions)]
    developer_tools: &'static str,
    fullscreen: &'static str,
    minimize: &'static str,
    maximize: &'static str,
    bring_all_to_front: &'static str,
    open_help: &'static str,
}

fn labels(locale: NativeMenuLocale) -> NativeMenuLabels {
    match locale {
        NativeMenuLocale::ZhCn => NativeMenuLabels {
            application: "笔记空间",
            file: "文件",
            edit: "编辑",
            view: "显示",
            window: "窗口",
            help: "帮助",
            about: "关于笔记空间",
            settings: "设置…",
            services: "服务",
            hide: "隐藏笔记空间",
            hide_others: "隐藏其他",
            show_all: "全部显示",
            quit: "退出笔记空间",
            new_document: "新建文档",
            open_document: "打开文件…",
            open_workspace: "打开工作区…",
            save: "保存",
            save_as: "另存为…",
            reveal_in_file_manager: "在文件管理器中显示",
            close_window: "关闭窗口",
            undo: "撤销",
            redo: "重做",
            cut: "剪切",
            copy: "复制",
            paste: "粘贴",
            select_all: "全选",
            find: "当前页查找…",
            find_workspace: "全文搜索…",
            export: "导出",
            export_html: "HTML…",
            export_pdf: "PDF…",
            new_template: "从模板新建…",
            toggle_focus: "切换专注模式",
            toggle_source: "切换可视/源码",
            toggle_sidebar: "显示/隐藏侧边栏",
            #[cfg(debug_assertions)]
            developer_tools: "开发者工具",
            fullscreen: "进入全屏幕",
            minimize: "最小化",
            maximize: "缩放",
            bring_all_to_front: "前置全部窗口",
            open_help: "笔记空间帮助",
        },
        NativeMenuLocale::EnUs => NativeMenuLabels {
            application: "NoteSpace",
            file: "File",
            edit: "Edit",
            view: "View",
            window: "Window",
            help: "Help",
            about: "About NoteSpace",
            settings: "Settings…",
            services: "Services",
            hide: "Hide NoteSpace",
            hide_others: "Hide Others",
            show_all: "Show All",
            quit: "Quit NoteSpace",
            new_document: "New Document",
            open_document: "Open File…",
            open_workspace: "Open Workspace…",
            save: "Save",
            save_as: "Save As…",
            reveal_in_file_manager: "Reveal in File Manager",
            close_window: "Close Window",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            find: "Find in Page…",
            find_workspace: "Search Contents…",
            export: "Export",
            export_html: "HTML…",
            export_pdf: "PDF…",
            new_template: "New from Template…",
            toggle_focus: "Toggle Focus Mode",
            toggle_source: "Toggle Visual/Source",
            toggle_sidebar: "Toggle Sidebar",
            #[cfg(debug_assertions)]
            developer_tools: "Developer Tools",
            fullscreen: "Enter Full Screen",
            minimize: "Minimize",
            maximize: "Zoom",
            bring_all_to_front: "Bring All to Front",
            open_help: "NoteSpace Help",
        },
    }
}

pub fn build_default_native_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    build_native_menu(app, NativeMenuLocale::ZhCn)
}

pub fn replace_native_menu<R: Runtime>(app: &AppHandle<R>, locale: &str) -> tauri::Result<()> {
    let menu = build_native_menu(app, NativeMenuLocale::from_locale(locale))?;
    app.set_menu(menu)?;
    Ok(())
}

pub fn handle_native_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    #[cfg(debug_assertions)]
    if event.id().as_ref() == ACTION_OPEN_DEVTOOLS {
        // Native-only diagnostic action: never reload the page or touch document state.
        if let Some(window) = app.get_webview_window("main") {
            window.open_devtools();
        }
        return;
    }

    if let Some(id) = forwarded_action(event.id().as_ref()) {
        let _ = app.emit(NATIVE_MENU_EVENT, NativeMenuAction { id });
    }
}

fn forwarded_action(id: &str) -> Option<&'static str> {
    FORWARDED_ACTIONS
        .iter()
        .copied()
        .find(|candidate| *candidate == id)
}

fn build_native_menu<R: Runtime>(
    app: &AppHandle<R>,
    locale: NativeMenuLocale,
) -> tauri::Result<Menu<R>> {
    let labels = labels(locale);

    let settings = MenuItemBuilder::with_id(ACTION_OPEN_SETTINGS, labels.settings)
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let quit = MenuItemBuilder::with_id(ACTION_QUIT_APP, labels.quit)
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let about = MenuItemBuilder::with_id(ACTION_OPEN_ABOUT, labels.about).build(app)?;
    let application = SubmenuBuilder::with_id(app, "menu.application", labels.application)
        .item(&about)
        .separator()
        .item(&settings)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some(labels.services))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(labels.hide))?)
        .item(&PredefinedMenuItem::hide_others(
            app,
            Some(labels.hide_others),
        )?)
        .item(&PredefinedMenuItem::show_all(app, Some(labels.show_all))?)
        .separator()
        .item(&quit)
        .build()?;

    let new_document = MenuItemBuilder::with_id(ACTION_NEW_DOCUMENT, labels.new_document)
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_document = MenuItemBuilder::with_id(ACTION_OPEN_DOCUMENT, labels.open_document)
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let open_workspace = MenuItemBuilder::with_id(ACTION_OPEN_WORKSPACE, labels.open_workspace)
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;
    let save_document = MenuItemBuilder::with_id(ACTION_SAVE_DOCUMENT, labels.save)
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_document_as = MenuItemBuilder::with_id(ACTION_SAVE_DOCUMENT_AS, labels.save_as)
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;
    let reveal_in_file_manager =
        MenuItemBuilder::with_id(ACTION_REVEAL_IN_FILE_MANAGER, labels.reveal_in_file_manager)
            .build(app)?;
    let close_window = MenuItemBuilder::with_id(ACTION_CLOSE_WINDOW, labels.close_window)
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let export = SubmenuBuilder::with_id(app, "menu.export", labels.export)
        .item(&MenuItemBuilder::with_id(ACTION_EXPORT_HTML, labels.export_html).build(app)?)
        .item(
            &MenuItemBuilder::with_id(ACTION_EXPORT_PDF, labels.export_pdf)
                .enabled(cfg!(target_os = "macos"))
                .build(app)?,
        )
        .build()?;
    let file = SubmenuBuilder::with_id(app, "menu.file", labels.file)
        .item(&new_document)
        .item(&MenuItemBuilder::with_id(ACTION_NEW_TEMPLATE, labels.new_template).build(app)?)
        .separator()
        .item(&open_document)
        .item(&open_workspace)
        .separator()
        .item(&save_document)
        .item(&save_document_as)
        .item(&export)
        .separator()
        .item(&reveal_in_file_manager)
        .separator()
        .item(&close_window)
        .build()?;

    let find = MenuItemBuilder::with_id(ACTION_FIND, labels.find)
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    // AppKit/WebKit may append platform editing services (for example AutoFill,
    // Dictation, and Emoji & Symbols) to this standard edit menu. Those items
    // are localized from the bundle's `*.lproj` resources selected at process
    // launch; every item created below still uses the runtime app locale.
    let edit = SubmenuBuilder::with_id(app, "menu.edit", labels.edit)
        .item(&PredefinedMenuItem::undo(app, Some(labels.undo))?)
        .item(&PredefinedMenuItem::redo(app, Some(labels.redo))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some(labels.cut))?)
        .item(&PredefinedMenuItem::copy(app, Some(labels.copy))?)
        .item(&PredefinedMenuItem::paste(app, Some(labels.paste))?)
        .item(&PredefinedMenuItem::select_all(
            app,
            Some(labels.select_all),
        )?)
        .separator()
        .item(&find)
        .item(
            &MenuItemBuilder::with_id(ACTION_FIND_WORKSPACE, labels.find_workspace)
                .accelerator("CmdOrCtrl+Shift+F")
                .build(app)?,
        )
        .build()?;

    let toggle_source = MenuItemBuilder::with_id(ACTION_TOGGLE_SOURCE_MODE, labels.toggle_source)
        .accelerator("CmdOrCtrl+/")
        .build(app)?;
    let toggle_sidebar = MenuItemBuilder::with_id(ACTION_TOGGLE_SIDEBAR, labels.toggle_sidebar)
        .accelerator("CmdOrCtrl+Shift+L")
        .build(app)?;
    let view_builder = SubmenuBuilder::with_id(app, "menu.view", labels.view)
        .item(&toggle_source)
        .item(&toggle_sidebar)
        .item(
            &MenuItemBuilder::with_id(ACTION_TOGGLE_FOCUS, labels.toggle_focus)
                .accelerator("CmdOrCtrl+Shift+Enter")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::fullscreen(
            app,
            Some(labels.fullscreen),
        )?);
    #[cfg(debug_assertions)]
    let view_builder = {
        let developer_tools =
            MenuItemBuilder::with_id(ACTION_OPEN_DEVTOOLS, labels.developer_tools).build(app)?;
        view_builder.separator().item(&developer_tools)
    };
    let view = view_builder.build()?;

    // WINDOW_SUBMENU_ID makes this NSApplication's standard Window menu. AppKit
    // then owns the additional window-management items it inserts here. Their
    // language follows the bundle localization selected by macOS at launch,
    // while these explicitly supplied labels follow the in-app locale now.
    let window = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, labels.window)
        .item(&PredefinedMenuItem::minimize(app, Some(labels.minimize))?)
        .item(&PredefinedMenuItem::maximize(app, Some(labels.maximize))?)
        .separator()
        .item(&PredefinedMenuItem::bring_all_to_front(
            app,
            Some(labels.bring_all_to_front),
        )?)
        .build()?;

    let open_help = MenuItemBuilder::with_id(ACTION_OPEN_HELP, labels.open_help).build(app)?;
    let help = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, labels.help)
        .item(&open_help)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&application, &file, &edit, &view, &window, &help])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_defaults_to_chinese_and_accepts_english() {
        assert_eq!(
            NativeMenuLocale::from_locale("zh-CN"),
            NativeMenuLocale::ZhCn
        );
        assert_eq!(
            NativeMenuLocale::from_locale("unknown"),
            NativeMenuLocale::ZhCn
        );
        assert_eq!(
            NativeMenuLocale::from_locale("en-US"),
            NativeMenuLocale::EnUs
        );
    }

    #[test]
    fn menu_labels_cover_chinese_and_english_titles() {
        let chinese = labels(NativeMenuLocale::ZhCn);
        let english = labels(NativeMenuLocale::EnUs);

        assert_eq!(chinese.file, "文件");
        assert_eq!(chinese.application, "笔记空间");
        assert_eq!(chinese.about, "关于笔记空间");
        assert_eq!(chinese.edit, "编辑");
        assert_eq!(chinese.view, "显示");
        assert_eq!(chinese.window, "窗口");
        assert_eq!(chinese.help, "帮助");
        assert_eq!(chinese.close_window, "关闭窗口");
        assert_eq!(chinese.reveal_in_file_manager, "在文件管理器中显示");
        assert_eq!(chinese.quit, "退出笔记空间");
        assert_eq!(english.file, "File");
        assert_eq!(english.application, "NoteSpace");
        assert_eq!(english.about, "About NoteSpace");
        assert_eq!(english.settings, "Settings…");
        assert_eq!(english.close_window, "Close Window");
        assert_eq!(english.reveal_in_file_manager, "Reveal in File Manager");
        assert_eq!(english.quit, "Quit NoteSpace");
    }

    #[test]
    fn app_owned_edit_and_window_items_have_runtime_localized_labels() {
        let chinese = labels(NativeMenuLocale::ZhCn);
        let english = labels(NativeMenuLocale::EnUs);

        assert_eq!(
            [
                chinese.undo,
                chinese.redo,
                chinese.cut,
                chinese.copy,
                chinese.paste,
                chinese.select_all,
                chinese.fullscreen,
                chinese.minimize,
                chinese.maximize,
                chinese.bring_all_to_front,
            ],
            [
                "撤销",
                "重做",
                "剪切",
                "复制",
                "粘贴",
                "全选",
                "进入全屏幕",
                "最小化",
                "缩放",
                "前置全部窗口",
            ]
        );
        assert_eq!(
            [
                english.undo,
                english.redo,
                english.cut,
                english.copy,
                english.paste,
                english.select_all,
                english.fullscreen,
                english.minimize,
                english.maximize,
                english.bring_all_to_front,
            ],
            [
                "Undo",
                "Redo",
                "Cut",
                "Copy",
                "Paste",
                "Select All",
                "Enter Full Screen",
                "Minimize",
                "Zoom",
                "Bring All to Front",
            ]
        );
    }

    #[test]
    fn macos_bundle_declares_the_localizations_used_by_system_menu_items() {
        let english = include_str!("../resources/en.lproj/InfoPlist.strings");
        let simplified_chinese = include_str!("../resources/zh-Hans.lproj/InfoPlist.strings");

        assert!(english.contains("Markdown Document"));
        assert!(simplified_chinese.contains("Markdown 文稿"));
    }

    #[test]
    fn only_stable_application_actions_are_forwarded() {
        assert_eq!(FORWARDED_ACTIONS.len(), 19);
        assert_eq!(
            FORWARDED_ACTIONS
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            19
        );
        for id in FORWARDED_ACTIONS {
            assert_eq!(forwarded_action(id), Some(*id));
        }
        assert_eq!(forwarded_action("window.close"), Some(ACTION_CLOSE_WINDOW));
        assert_eq!(forwarded_action("app.quit"), Some(ACTION_QUIT_APP));
        assert_eq!(
            forwarded_action("file.reveal"),
            Some(ACTION_REVEAL_IN_FILE_MANAGER)
        );
        assert_eq!(forwarded_action("unknown"), None);
        assert_eq!(forwarded_action("view.openDevtools"), None);
        assert_eq!(forwarded_action("view.reload"), None);
    }

    #[test]
    fn help_and_about_have_distinct_labels_actions_and_payloads() {
        assert_ne!(ACTION_OPEN_HELP, ACTION_OPEN_ABOUT);
        assert_eq!(forwarded_action("help.open"), Some(ACTION_OPEN_HELP));
        assert_eq!(forwarded_action("app.about"), Some(ACTION_OPEN_ABOUT));
        for (locale, help, about) in [
            (NativeMenuLocale::ZhCn, "笔记空间帮助", "关于笔记空间"),
            (NativeMenuLocale::EnUs, "NoteSpace Help", "About NoteSpace"),
        ] {
            assert_eq!(labels(locale).open_help, help);
            assert_eq!(labels(locale).about, about);
        }
        assert_eq!(
            serde_json::to_value(NativeMenuAction {
                id: ACTION_OPEN_HELP
            })
            .unwrap(),
            serde_json::json!({ "id": "help.open" })
        );
        assert_eq!(
            serde_json::to_value(NativeMenuAction {
                id: ACTION_OPEN_ABOUT
            })
            .unwrap(),
            serde_json::json!({ "id": "app.about" })
        );
    }

    #[test]
    fn export_submenu_uses_short_format_labels_and_only_leaf_actions_are_forwarded() {
        for (locale, export) in [
            (NativeMenuLocale::ZhCn, "导出"),
            (NativeMenuLocale::EnUs, "Export"),
        ] {
            let localized = labels(locale);
            assert_eq!(localized.export, export);
            assert_eq!(localized.export_html, "HTML…");
            assert_eq!(localized.export_pdf, "PDF…");
        }
        assert_eq!(forwarded_action("menu.export"), None);
        assert_eq!(
            forwarded_action("file.exportHtml"),
            Some(ACTION_EXPORT_HTML)
        );
        assert_eq!(forwarded_action("file.exportPdf"), Some(ACTION_EXPORT_PDF));
        assert_eq!(
            forwarded_action("file.newTemplate"),
            Some(ACTION_NEW_TEMPLATE)
        );
        assert_eq!(
            forwarded_action("view.toggleFocus"),
            Some(ACTION_TOGGLE_FOCUS)
        );
    }

    #[cfg(debug_assertions)]
    #[test]
    fn debug_developer_tools_are_localized_and_native_only() {
        assert_eq!(labels(NativeMenuLocale::ZhCn).developer_tools, "开发者工具");
        assert_eq!(
            labels(NativeMenuLocale::EnUs).developer_tools,
            "Developer Tools"
        );
        assert_eq!(forwarded_action(ACTION_OPEN_DEVTOOLS), None);
    }
}
