//! P0-HOST-SMOKE-01: disposable macOS release-host evidence.
//!
//! This module is compiled only by the non-default `host-release-smoke` Cargo
//! feature on macOS. Runtime activation additionally requires an explicit
//! environment latch and a private, direct child of the system temp directory.

use std::{
    env,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Instant,
};

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    AppHandle, Builder, Manager, State, Wry,
};

const ENABLE_ENV: &str = "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE";
const MODE_ENV: &str = "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE_MODE";
const ROOT_ENV: &str = "MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE_ROOT";
const ROOT_PREFIX: &str = "markdown-workspace-host-smoke.";
const RESULT_FILE: &str = "host-smoke-result.json";
const RESULT_TEMP_FILE: &str = ".host-smoke-result.json.tmp";
const RUNTIME_FRONTEND_LATCH: &str = r#"
Object.defineProperty(window, "__MARKDOWN_WORKSPACE_HOST_RELEASE_SMOKE__", {
  value: true,
  configurable: false,
  enumerable: false,
  writable: false
});
"#;
const MENU_SUBMENU_ID: &str = "host-smoke-menu";
const MENU_PING_ID: &str = "host-smoke-menu-ping";
const TASK_ID: &str = "P0-HOST-SMOKE-01";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HostMode {
    Automated,
    Manual,
}

impl HostMode {
    fn from_environment() -> Result<Self, &'static str> {
        match env::var(MODE_ENV).as_deref() {
            Ok("automated") => Ok(Self::Automated),
            Ok("manual") => Ok(Self::Manual),
            _ => Err("ERR_HOST_SMOKE_MODE"),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Automated => "automated",
            Self::Manual => "manual",
        }
    }
}

#[derive(Clone, Debug)]
struct AtomicReplaceEvidence {
    status: &'static str,
    duration_ms: u128,
    original_was_intact_before_replace: bool,
    final_is_complete_new_version: bool,
    temp_cleaned: bool,
    error_code: Option<&'static str>,
}

impl AtomicReplaceEvidence {
    fn failed(started: Instant, error_code: &'static str) -> Self {
        Self {
            status: "failed",
            duration_ms: started.elapsed().as_millis(),
            original_was_intact_before_replace: false,
            final_is_complete_new_version: false,
            temp_cleaned: false,
            error_code: Some(error_code),
        }
    }
}

#[derive(Clone, Debug)]
struct ImeEvidence {
    status: &'static str,
    composition_start_count: u32,
    composition_update_count: u32,
    composition_end_count: u32,
    before_input_count: u32,
    input_count: u32,
    unsafe_runtime_samples: u32,
    event_order_valid: bool,
    saw_composing_phase: bool,
    saw_refresh_pending_phase: bool,
    final_state_matches: bool,
    final_utf16_length: u32,
}

impl ImeEvidence {
    fn pending() -> Self {
        Self {
            status: "pending",
            composition_start_count: 0,
            composition_update_count: 0,
            composition_end_count: 0,
            before_input_count: 0,
            input_count: 0,
            unsafe_runtime_samples: 0,
            event_order_valid: false,
            saw_composing_phase: false,
            saw_refresh_pending_phase: false,
            final_state_matches: false,
            final_utf16_length: 0,
        }
    }

    fn from_wire(scenario: &str, counts: &[u32], flags: &[bool], final_utf16_length: u32) -> Self {
        let expected_length = match scenario {
            "confirm" => "# \u{4e2d}\u{6587}\n\n".encode_utf16().count() as u32,
            "cancel" => "# \u{4e2d}\u{6587}\n\n\u{53d6}\u{6d88}\u{ff1a}"
                .encode_utf16()
                .count() as u32,
            _ => 0,
        };
        let counts_valid = counts.len() == 6 && counts.iter().all(|count| *count <= 10_000);
        let flags_valid = flags.len() == 4;
        if !counts_valid || !flags_valid || expected_length == 0 || final_utf16_length > 10_000 {
            return Self {
                status: "failed",
                ..Self::pending()
            };
        }

        let pass = counts[0] >= 1
            && counts[1] >= 1
            && counts[2] >= 1
            && counts[5] == 0
            && flags.iter().all(|value| *value)
            && final_utf16_length == expected_length;

        Self {
            status: if pass { "passed" } else { "failed" },
            composition_start_count: counts[0],
            composition_update_count: counts[1],
            composition_end_count: counts[2],
            before_input_count: counts[3],
            input_count: counts[4],
            unsafe_runtime_samples: counts[5],
            event_order_valid: flags[0],
            saw_composing_phase: flags[1],
            saw_refresh_pending_phase: flags[2],
            final_state_matches: flags[3],
            final_utf16_length,
        }
    }
}

#[derive(Clone, Debug)]
struct ChooserEvidence {
    status: &'static str,
    event_kind: &'static str,
    selected_count_bucket: &'static str,
    file_read_attempts: u32,
    path_read_attempts: u32,
}

impl ChooserEvidence {
    fn pending() -> Self {
        Self {
            status: "pending",
            event_kind: "none",
            selected_count_bucket: "zero",
            file_read_attempts: 0,
            path_read_attempts: 0,
        }
    }

    fn from_wire(event_kind: &str, metrics: &[u32]) -> Self {
        if metrics.len() != 3 || metrics.iter().any(|value| *value > 1_000) {
            return Self {
                status: "failed",
                event_kind: "invalid",
                selected_count_bucket: "invalid",
                file_read_attempts: 0,
                path_read_attempts: 0,
            };
        }

        let selected_count = metrics[0];
        let file_read_attempts = metrics[1];
        let path_read_attempts = metrics[2];
        let passed = event_kind == "cancel"
            && selected_count == 0
            && file_read_attempts == 0
            && path_read_attempts == 0;

        Self {
            status: if passed { "passed" } else { "failed" },
            event_kind: match event_kind {
                "cancel" => "cancel",
                "change" => "change",
                _ => "invalid",
            },
            selected_count_bucket: if selected_count == 0 {
                "zero"
            } else {
                "nonzero"
            },
            file_read_attempts,
            path_read_attempts,
        }
    }
}

#[derive(Clone, Debug)]
struct HostReport {
    mode: HostMode,
    atomic_replace: AtomicReplaceEvidence,
    menu_built: bool,
    menu_activation_count: u32,
    frontend_ready: bool,
    editor_mounted: bool,
    content_editable: bool,
    native_file_input_present: bool,
    ime_confirm: ImeEvidence,
    ime_cancel: ImeEvidence,
    chooser: ChooserEvidence,
}

impl HostReport {
    fn result_state(&self) -> &'static str {
        if self.atomic_replace.status == "failed"
            || self.ime_confirm.status == "failed"
            || self.ime_cancel.status == "failed"
            || self.chooser.status == "failed"
        {
            return "failed";
        }

        if self.atomic_replace.status == "passed"
            && self.menu_built
            && self.frontend_ready
            && self.editor_mounted
            && self.content_editable
            && self.native_file_input_present
            && self.menu_activation_count >= 1
            && self.ime_confirm.status == "passed"
            && self.ime_cancel.status == "passed"
            && self.chooser.status == "passed"
        {
            return "manualPass";
        }

        if self.atomic_replace.status == "passed"
            && self.menu_built
            && self.frontend_ready
            && self.editor_mounted
            && self.content_editable
            && self.native_file_input_present
        {
            "automatedReady"
        } else {
            "starting"
        }
    }

    fn to_json(&self) -> String {
        format!(
            concat!(
                "{{\n",
                "  \"schemaVersion\": 1,\n",
                "  \"taskId\": \"{}\",\n",
                "  \"resultState\": \"{}\",\n",
                "  \"build\": {{\"profile\": \"release\", \"targetOs\": \"macos\", \"webview\": \"WKWebView\", \"cargoFeature\": \"host-release-smoke\", \"runtimeEnabled\": true, \"mode\": \"{}\"}},\n",
                "  \"atomicReplace\": {},\n",
                "  \"menu\": {{\"status\": \"{}\", \"itemIds\": [\"{}\", \"{}\"], \"activationCount\": {}}},\n",
                "  \"frontend\": {{\"status\": \"{}\", \"editorKind\": \"CodeMirror6\", \"editorMounted\": {}, \"contentEditable\": {}, \"nativeFileInputPresent\": {}}},\n",
                "  \"imeConfirm\": {},\n",
                "  \"imeCancel\": {},\n",
                "  \"chooserCancel\": {},\n",
                "  \"privacy\": {{\"containsDocumentContent\": false, \"containsClipboardContent\": false, \"containsAbsolutePaths\": false}}\n",
                "}}\n"
            ),
            TASK_ID,
            self.result_state(),
            self.mode.as_str(),
            atomic_json(&self.atomic_replace),
            if self.menu_built { "ready" } else { "pending" },
            MENU_SUBMENU_ID,
            MENU_PING_ID,
            self.menu_activation_count,
            if self.frontend_ready { "ready" } else { "pending" },
            self.editor_mounted,
            self.content_editable,
            self.native_file_input_present,
            ime_json(&self.ime_confirm),
            ime_json(&self.ime_cancel),
            chooser_json(&self.chooser),
        )
    }
}

struct HostSmokeState {
    root: PathBuf,
    mode: HostMode,
    report: Mutex<HostReport>,
}

impl HostSmokeState {
    fn new(root: PathBuf, mode: HostMode) -> Result<Self, &'static str> {
        let atomic_replace = run_atomic_replace_self_test(&root);
        let state = Self {
            root,
            mode,
            report: Mutex::new(HostReport {
                mode,
                atomic_replace,
                menu_built: false,
                menu_activation_count: 0,
                frontend_ready: false,
                editor_mounted: false,
                content_editable: false,
                native_file_input_present: false,
                ime_confirm: ImeEvidence::pending(),
                ime_cancel: ImeEvidence::pending(),
                chooser: ChooserEvidence::pending(),
            }),
        };
        state.persist_current()?;
        Ok(state)
    }

    fn persist_current(&self) -> Result<String, &'static str> {
        let report = self.report.lock().map_err(|_| "ERR_HOST_SMOKE_STATE")?;
        let json = report.to_json();
        write_report_json(&self.root, &json)?;
        Ok(json)
    }

    fn update<F>(&self, update: F) -> Result<String, &'static str>
    where
        F: FnOnce(&mut HostReport) -> Result<(), &'static str>,
    {
        let mut report = self.report.lock().map_err(|_| "ERR_HOST_SMOKE_STATE")?;
        update(&mut report)?;
        let json = report.to_json();
        write_report_json(&self.root, &json)?;
        Ok(json)
    }
}

pub(crate) fn configure(builder: Builder<Wry>) -> Result<Builder<Wry>, &'static str> {
    if env::var(ENABLE_ENV).as_deref() != Ok("1") {
        return Ok(builder);
    }
    if cfg!(debug_assertions) {
        return Err("ERR_HOST_SMOKE_REQUIRES_RELEASE");
    }

    let mode = HostMode::from_environment()?;
    let root = env::var_os(ROOT_ENV).ok_or("ERR_HOST_SMOKE_ROOT_MISSING")?;
    let root = validate_private_temp_root(Path::new(&root))?;
    let state = HostSmokeState::new(root, mode)?;

    let builder = builder
        .append_invoke_initialization_script(RUNTIME_FRONTEND_LATCH)
        .manage(state)
        .menu(|app| {
            let ping = MenuItemBuilder::with_id(MENU_PING_ID, "Record Menu Activation")
                .accelerator("CmdOrCtrl+Shift+H")
                .build(app)?;
            let host_menu = SubmenuBuilder::with_id(app, MENU_SUBMENU_ID, "Host Smoke")
                .item(&ping)
                .build()?;
            let menu = MenuBuilder::new(app).item(&host_menu).build()?;

            let state = app.state::<HostSmokeState>();
            state
                .update(|report| {
                    report.menu_built = true;
                    Ok(())
                })
                .map_err(std::io::Error::other)?;
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() != MENU_PING_ID {
                return;
            }
            let state = app.state::<HostSmokeState>();
            let _ = state.update(|report| {
                report.menu_activation_count = report.menu_activation_count.saturating_add(1);
                Ok(())
            });
        })
        .invoke_handler(tauri::generate_handler![
            host_release_smoke_frontend_ready,
            host_release_smoke_record_ime,
            host_release_smoke_record_chooser,
            host_release_smoke_status,
            host_release_smoke_finish,
        ]);

    Ok(builder)
}

#[tauri::command]
fn host_release_smoke_frontend_ready(
    app: AppHandle,
    state: State<'_, HostSmokeState>,
    harness_version: u32,
    editor_kind: String,
    capabilities: Vec<bool>,
) -> Result<String, String> {
    if harness_version != 1 || editor_kind != "codemirror6" || capabilities.len() != 3 {
        return Err("ERR_HOST_SMOKE_FRONTEND_CONTRACT".into());
    }

    let snapshot = state
        .update(|report| {
            report.frontend_ready = capabilities.iter().all(|value| *value);
            report.editor_mounted = capabilities[0];
            report.content_editable = capabilities[1];
            report.native_file_input_present = capabilities[2];
            Ok(())
        })
        .map_err(str::to_string)?;

    if state.mode == HostMode::Automated {
        app.exit(0);
    }
    Ok(snapshot)
}

#[tauri::command]
fn host_release_smoke_record_ime(
    state: State<'_, HostSmokeState>,
    scenario: String,
    counts: Vec<u32>,
    flags: Vec<bool>,
    final_utf16_length: u32,
) -> Result<String, String> {
    if scenario != "confirm" && scenario != "cancel" {
        return Err("ERR_HOST_SMOKE_IME_SCENARIO".into());
    }
    let evidence = ImeEvidence::from_wire(&scenario, &counts, &flags, final_utf16_length);
    state
        .update(|report| {
            let target = if scenario == "confirm" {
                &mut report.ime_confirm
            } else {
                &mut report.ime_cancel
            };
            if target.status == "failed" {
                return Err("ERR_HOST_SMOKE_IME_STICKY_FAILURE");
            }
            *target = evidence;
            Ok(())
        })
        .map_err(str::to_string)
}

#[tauri::command]
fn host_release_smoke_record_chooser(
    state: State<'_, HostSmokeState>,
    event_kind: String,
    metrics: Vec<u32>,
) -> Result<String, String> {
    let evidence = ChooserEvidence::from_wire(&event_kind, &metrics);
    state
        .update(|report| {
            if report.chooser.status == "failed" {
                return Err("ERR_HOST_SMOKE_CHOOSER_STICKY_FAILURE");
            }
            report.chooser = evidence;
            Ok(())
        })
        .map_err(str::to_string)
}

#[tauri::command]
fn host_release_smoke_status(state: State<'_, HostSmokeState>) -> Result<String, String> {
    state.persist_current().map_err(str::to_string)
}

#[tauri::command]
fn host_release_smoke_finish(
    app: AppHandle,
    state: State<'_, HostSmokeState>,
) -> Result<(), String> {
    let snapshot = state.persist_current().map_err(str::to_string)?;
    if !snapshot.contains("\"resultState\": \"manualPass\"") {
        return Err("ERR_HOST_SMOKE_MANUAL_INCOMPLETE".into());
    }
    app.exit(0);
    Ok(())
}

fn validate_private_temp_root(root: &Path) -> Result<PathBuf, &'static str> {
    if !root.is_absolute() {
        return Err("ERR_HOST_SMOKE_ROOT_NOT_ABSOLUTE");
    }
    let metadata = fs::symlink_metadata(root).map_err(|_| "ERR_HOST_SMOKE_ROOT_METADATA")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("ERR_HOST_SMOKE_ROOT_TYPE");
    }
    if metadata.mode() & 0o077 != 0 {
        return Err("ERR_HOST_SMOKE_ROOT_PERMISSIONS");
    }
    let supplied = root
        .canonicalize()
        .map_err(|_| "ERR_HOST_SMOKE_ROOT_CANONICAL")?;
    if supplied != root {
        return Err("ERR_HOST_SMOKE_ROOT_ALIAS");
    }
    let temp = env::temp_dir()
        .canonicalize()
        .map_err(|_| "ERR_HOST_SMOKE_TEMP_CANONICAL")?;
    if supplied.parent() != Some(temp.as_path()) {
        return Err("ERR_HOST_SMOKE_ROOT_SCOPE");
    }
    let valid_name = supplied
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(ROOT_PREFIX));
    if !valid_name {
        return Err("ERR_HOST_SMOKE_ROOT_NAME");
    }
    Ok(supplied)
}

fn run_atomic_replace_self_test(root: &Path) -> AtomicReplaceEvidence {
    const OLD: &[u8] = b"old-host-smoke";
    const NEW: &[u8] = b"new-host-smoke";

    let started = Instant::now();
    let scope = root.join("atomic-replace");
    if fs::create_dir(&scope).is_err() {
        return AtomicReplaceEvidence::failed(started, "ERR_ATOMIC_SCOPE_CREATE");
    }
    if fs::set_permissions(&scope, fs::Permissions::from_mode(0o700)).is_err() {
        return AtomicReplaceEvidence::failed(started, "ERR_ATOMIC_SCOPE_PERMISSIONS");
    }

    let target = scope.join("target.md");
    let staging = scope.join(".target.md.host-smoke.tmp");
    let result = (|| -> Result<AtomicReplaceEvidence, &'static str> {
        let mut original = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|_| "ERR_ATOMIC_ORIGINAL_CREATE")?;
        original
            .write_all(OLD)
            .map_err(|_| "ERR_ATOMIC_ORIGINAL_WRITE")?;
        original
            .sync_all()
            .map_err(|_| "ERR_ATOMIC_ORIGINAL_SYNC")?;
        drop(original);

        let mut before = Vec::new();
        File::open(&target)
            .and_then(|mut file| file.read_to_end(&mut before))
            .map_err(|_| "ERR_ATOMIC_ORIGINAL_READ")?;
        if before != OLD {
            return Err("ERR_ATOMIC_ORIGINAL_INTEGRITY");
        }

        let mut temporary = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging)
            .map_err(|_| "ERR_ATOMIC_TEMP_CREATE")?;
        temporary
            .write_all(NEW)
            .map_err(|_| "ERR_ATOMIC_TEMP_WRITE")?;
        temporary.sync_all().map_err(|_| "ERR_ATOMIC_TEMP_SYNC")?;
        drop(temporary);

        fs::rename(&staging, &target).map_err(|_| "ERR_ATOMIC_REPLACE")?;
        File::open(&scope)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "ERR_ATOMIC_DIRECTORY_SYNC")?;

        let mut after = Vec::new();
        File::open(&target)
            .and_then(|mut file| file.read_to_end(&mut after))
            .map_err(|_| "ERR_ATOMIC_FINAL_READ")?;
        if after != NEW {
            return Err("ERR_ATOMIC_FINAL_INTEGRITY");
        }

        fs::remove_file(&target).map_err(|_| "ERR_ATOMIC_TARGET_CLEANUP")?;
        fs::remove_dir(&scope).map_err(|_| "ERR_ATOMIC_SCOPE_CLEANUP")?;
        Ok(AtomicReplaceEvidence {
            status: "passed",
            duration_ms: started.elapsed().as_millis(),
            original_was_intact_before_replace: true,
            final_is_complete_new_version: true,
            temp_cleaned: true,
            error_code: None,
        })
    })();

    match result {
        Ok(evidence) => evidence,
        Err(error_code) => {
            let _ = fs::remove_file(&staging);
            let _ = fs::remove_file(&target);
            let _ = fs::remove_dir(&scope);
            AtomicReplaceEvidence::failed(started, error_code)
        }
    }
}

fn write_report_json(root: &Path, json: &str) -> Result<(), &'static str> {
    let temporary = root.join(RESULT_TEMP_FILE);
    let result = root.join(RESULT_FILE);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "ERR_REPORT_TEMP_CREATE")?;
    if file.write_all(json.as_bytes()).is_err() || file.sync_all().is_err() {
        drop(file);
        let _ = fs::remove_file(&temporary);
        return Err("ERR_REPORT_TEMP_WRITE");
    }
    drop(file);
    if fs::rename(&temporary, &result).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err("ERR_REPORT_REPLACE");
    }
    File::open(root)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| "ERR_REPORT_DIRECTORY_SYNC")?;
    Ok(())
}

fn atomic_json(evidence: &AtomicReplaceEvidence) -> String {
    format!(
        "{{\"status\": \"{}\", \"durationMs\": {}, \"originalWasIntactBeforeReplace\": {}, \"finalIsCompleteNewVersion\": {}, \"tempCleaned\": {}, \"errorCode\": {}}}",
        evidence.status,
        evidence.duration_ms,
        evidence.original_was_intact_before_replace,
        evidence.final_is_complete_new_version,
        evidence.temp_cleaned,
        optional_json_string(evidence.error_code),
    )
}

fn ime_json(evidence: &ImeEvidence) -> String {
    format!(
        "{{\"status\": \"{}\", \"compositionStartCount\": {}, \"compositionUpdateCount\": {}, \"compositionEndCount\": {}, \"beforeInputCount\": {}, \"inputCount\": {}, \"unsafeRuntimeSamples\": {}, \"eventOrderValid\": {}, \"sawComposingPhase\": {}, \"sawRefreshPendingPhase\": {}, \"finalStateMatches\": {}, \"finalUtf16Length\": {}}}",
        evidence.status,
        evidence.composition_start_count,
        evidence.composition_update_count,
        evidence.composition_end_count,
        evidence.before_input_count,
        evidence.input_count,
        evidence.unsafe_runtime_samples,
        evidence.event_order_valid,
        evidence.saw_composing_phase,
        evidence.saw_refresh_pending_phase,
        evidence.final_state_matches,
        evidence.final_utf16_length,
    )
}

fn chooser_json(evidence: &ChooserEvidence) -> String {
    format!(
        "{{\"status\": \"{}\", \"eventKind\": \"{}\", \"selectedCountBucket\": \"{}\", \"fileReadAttempts\": {}, \"pathReadAttempts\": {}}}",
        evidence.status,
        evidence.event_kind,
        evidence.selected_count_bucket,
        evidence.file_read_attempts,
        evidence.path_read_attempts,
    )
}

fn optional_json_string(value: Option<&'static str>) -> String {
    value.map_or_else(|| "null".into(), |value| format!("\"{value}\""))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    fn private_test_root() -> PathBuf {
        let name = format!(
            "{ROOT_PREFIX}test-{}-{}",
            std::process::id(),
            TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let root = env::temp_dir().join(name);
        fs::create_dir(&root).expect("create private host-smoke test root");
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700))
            .expect("set private host-smoke test root permissions");
        root.canonicalize().expect("canonical host-smoke test root")
    }

    #[test]
    fn file_001_atomic_self_test_is_scoped_complete_and_content_free() {
        let root = private_test_root();
        let validated = validate_private_temp_root(&root).expect("private temp root is accepted");
        let evidence = run_atomic_replace_self_test(&validated);
        assert_eq!(evidence.status, "passed");
        assert!(evidence.original_was_intact_before_replace);
        assert!(evidence.final_is_complete_new_version);
        assert!(evidence.temp_cleaned);
        assert_eq!(fs::read_dir(&validated).expect("read root").count(), 0);

        let report = HostReport {
            mode: HostMode::Automated,
            atomic_replace: evidence,
            menu_built: true,
            menu_activation_count: 0,
            frontend_ready: true,
            editor_mounted: true,
            content_editable: true,
            native_file_input_present: true,
            ime_confirm: ImeEvidence::pending(),
            ime_cancel: ImeEvidence::pending(),
            chooser: ChooserEvidence::pending(),
        }
        .to_json();
        assert!(report.contains("\"resultState\": \"automatedReady\""));
        assert!(!report.contains("old-host-smoke"));
        assert!(!report.contains("new-host-smoke"));
        assert!(!report.contains(root.to_string_lossy().as_ref()));

        fs::remove_dir(&validated).expect("remove exact test root");
    }

    #[test]
    fn ime_001_and_chooser_evidence_fail_closed() {
        let passing = ImeEvidence::from_wire(
            "confirm",
            &[1, 2, 1, 2, 2, 0],
            &[true, true, true, true],
            "# \u{4e2d}\u{6587}\n\n".encode_utf16().count() as u32,
        );
        assert_eq!(passing.status, "passed");

        let unsafe_sample = ImeEvidence::from_wire(
            "confirm",
            &[1, 2, 1, 2, 2, 1],
            &[true, true, true, true],
            "# \u{4e2d}\u{6587}\n\n".encode_utf16().count() as u32,
        );
        assert_eq!(unsafe_sample.status, "failed");

        assert_eq!(
            ChooserEvidence::from_wire("cancel", &[0, 0, 0]).status,
            "passed"
        );
        assert_eq!(
            ChooserEvidence::from_wire("change", &[1, 0, 0]).status,
            "failed"
        );
        assert_eq!(
            ChooserEvidence::from_wire("cancel", &[0, 1, 0]).status,
            "failed"
        );
    }

    #[test]
    fn private_temp_root_rejects_aliases_and_broad_targets() {
        let canonical_temp = env::temp_dir().canonicalize().expect("canonical temp root");
        assert_eq!(
            validate_private_temp_root(&canonical_temp),
            Err("ERR_HOST_SMOKE_ROOT_SCOPE")
        );
        assert_eq!(
            validate_private_temp_root(Path::new("relative-host-smoke")),
            Err("ERR_HOST_SMOKE_ROOT_NOT_ABSOLUTE")
        );
    }
}
