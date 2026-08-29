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
const INITIALIZATION_SCRIPT_TEMPLATE: &str = include_str!("host_release_smoke_init.js");
const AUDITED_HOST_UI_SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/features/editor/host-smoke/HostReleaseSmoke.tsx"
));
const TOKEN_BUNDLE_PLACEHOLDER: &str = "__HOST_SMOKE_TOKEN_BUNDLE__";
const TOKEN_BYTES: usize = 32;
const TOKEN_COUNT: usize = 7;
const NO_READ_FORBIDDEN_TOKENS: [&str; 11] = [
    "FileReader",
    ".files",
    ".value",
    ".arrayBuffer(",
    ".text(",
    ".stream(",
    ".name",
    ".path",
    "webkitRelativePath",
    "createObjectURL",
    "getAsFile",
];
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
struct StaticNoReadAudit {
    status: &'static str,
    forbidden_api_match_count: u32,
}

impl StaticNoReadAudit {
    fn run() -> Self {
        let sources = [AUDITED_HOST_UI_SOURCE, INITIALIZATION_SCRIPT_TEMPLATE];
        let forbidden_api_match_count = sources
            .iter()
            .flat_map(|source| {
                NO_READ_FORBIDDEN_TOKENS
                    .iter()
                    .filter(move |token| source.contains(**token))
            })
            .count() as u32;
        Self {
            status: if forbidden_api_match_count == 0 {
                "passed"
            } else {
                "failed"
            },
            forbidden_api_match_count,
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
    rejected_untrusted_event_count: u32,
    strict_sequence_valid: bool,
    composition_data_valid: bool,
    input_fields_valid: bool,
    single_target_valid: bool,
    final_state_matches: bool,
    native_nonce_flow_consumed: bool,
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
            rejected_untrusted_event_count: 0,
            strict_sequence_valid: false,
            composition_data_valid: false,
            input_fields_valid: false,
            single_target_valid: false,
            final_state_matches: false,
            native_nonce_flow_consumed: false,
            final_utf16_length: 0,
        }
    }

    fn from_private_capture(
        scenario: &str,
        counts: &[u32],
        flags: &[bool],
        final_utf16_length: u32,
    ) -> Self {
        let expected_length = match scenario {
            "confirm" => "\u{786e}\u{8ba4}\u{ff1a}\u{4e2d}\u{6587}"
                .encode_utf16()
                .count() as u32,
            "cancel" => "\u{53d6}\u{6d88}\u{ff1a}".encode_utf16().count() as u32,
            _ => 0,
        };
        let shape_valid = counts.len() == 6
            && flags.len() == 5
            && counts.iter().all(|count| *count <= 10_000)
            && final_utf16_length <= 10_000
            && expected_length > 0;
        if !shape_valid {
            return Self {
                status: "failed",
                ..Self::pending()
            };
        }

        let pass = counts[0] == 1
            && counts[1] >= 1
            && counts[2] == 1
            && counts[3] == counts[4]
            && counts[3] >= 1
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
            rejected_untrusted_event_count: counts[5],
            strict_sequence_valid: flags[0],
            composition_data_valid: flags[1],
            input_fields_valid: flags[2],
            single_target_valid: flags[3],
            final_state_matches: flags[4],
            native_nonce_flow_consumed: false,
            final_utf16_length,
        }
    }
}

#[derive(Clone, Debug)]
struct ChooserEvidence {
    status: &'static str,
    event_kind: &'static str,
    event_was_trusted: bool,
    native_dialog_interaction_observed: bool,
    native_nonce_flow_consumed: bool,
    selection_data_inspected: bool,
}

impl ChooserEvidence {
    fn pending() -> Self {
        Self {
            status: "pending",
            event_kind: "none",
            event_was_trusted: false,
            native_dialog_interaction_observed: false,
            native_nonce_flow_consumed: false,
            selection_data_inspected: false,
        }
    }

    fn from_private_capture(event_kind: &str) -> Self {
        let event_kind = match event_kind {
            "cancel" => "cancel",
            "change" => "change",
            _ => "invalid",
        };
        let passed = event_kind == "cancel";
        Self {
            status: if passed { "passed" } else { "failed" },
            event_kind,
            event_was_trusted: true,
            native_dialog_interaction_observed: true,
            native_nonce_flow_consumed: false,
            selection_data_inspected: false,
        }
    }
}

#[derive(Clone, Debug)]
struct HostReport {
    mode: HostMode,
    atomic_replace: AtomicReplaceEvidence,
    no_read_audit: StaticNoReadAudit,
    menu_built: bool,
    menu_activation_count: u32,
    capture_boundary_ready: bool,
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
            || self.no_read_audit.status == "failed"
            || self.ime_confirm.status == "failed"
            || self.ime_cancel.status == "failed"
            || self.chooser.status == "failed"
        {
            return "failed";
        }

        if self.automated_ready()
            && self.menu_activation_count >= 1
            && self.ime_confirm.status == "passed"
            && self.ime_cancel.status == "passed"
            && self.chooser.status == "passed"
        {
            return "manualPass";
        }
        if self.automated_ready() {
            "automatedReady"
        } else {
            "starting"
        }
    }

    fn automated_ready(&self) -> bool {
        self.atomic_replace.status == "passed"
            && self.no_read_audit.status == "passed"
            && self.menu_built
            && self.capture_boundary_ready
            && self.frontend_ready
            && self.editor_mounted
            && self.content_editable
            && self.native_file_input_present
    }

    fn to_json(&self) -> String {
        format!(
            concat!(
                "{{\n",
                "  \"schemaVersion\": 2,\n",
                "  \"taskId\": \"{}\",\n",
                "  \"resultState\": \"{}\",\n",
                "  \"build\": {{\"profile\": \"release\", \"targetOs\": \"macos\", \"webview\": \"WKWebView\", \"cargoFeature\": \"host-release-smoke\", \"runtimeEnabled\": true, \"mode\": \"{}\"}},\n",
                "  \"atomicReplace\": {},\n",
                "  \"menu\": {{\"status\": \"{}\", \"itemIds\": [\"{}\", \"{}\"], \"activationCount\": {}}},\n",
                "  \"frontend\": {{\"status\": \"{}\", \"editorKind\": \"CodeMirror6\", \"editorMounted\": {}, \"contentEditable\": {}, \"nativeFileInputPresent\": {}, \"captureBoundary\": \"nativeInitializationScript\", \"captureBoundaryReady\": {}}},\n",
                "  \"imeConfirm\": {},\n",
                "  \"imeCancel\": {},\n",
                "  \"chooserCancel\": {},\n",
                "  \"chooserNoReadAudit\": {{\"status\": \"{}\", \"auditKind\": \"compiledSourceTokenDenylist\", \"compiledSourceCount\": 2, \"forbiddenApiMatchCount\": {}}},\n",
                "  \"privacy\": {{\"containsDocumentContent\": false, \"containsClipboardContent\": false, \"containsAbsolutePaths\": false, \"containsCaptureNonce\": false}}\n",
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
            self.capture_boundary_ready,
            ime_json(&self.ime_confirm),
            ime_json(&self.ime_cancel),
            chooser_json(&self.chooser),
            self.no_read_audit.status,
            self.no_read_audit.forbidden_api_match_count,
        )
    }
}

#[derive(Clone, Debug)]
struct TrustedTokenBundle {
    capture_ready: String,
    confirm_begin: String,
    confirm_finish: String,
    cancel_begin: String,
    cancel_finish: String,
    chooser_begin: String,
    chooser_finish: String,
}

impl TrustedTokenBundle {
    fn generate() -> Result<Self, &'static str> {
        let mut random = [0_u8; TOKEN_BYTES * TOKEN_COUNT];
        File::open("/dev/urandom")
            .and_then(|mut file| file.read_exact(&mut random))
            .map_err(|_| "ERR_HOST_SMOKE_NONCE_GENERATION")?;
        let (chunks, remainder) = random.as_chunks::<TOKEN_BYTES>();
        if !remainder.is_empty() || chunks.len() != TOKEN_COUNT {
            return Err("ERR_HOST_SMOKE_NONCE_COUNT");
        }
        let mut chunks = chunks.iter().map(|chunk| hex_token(chunk));
        Ok(Self {
            capture_ready: chunks.next().ok_or("ERR_HOST_SMOKE_NONCE_COUNT")?,
            confirm_begin: chunks.next().ok_or("ERR_HOST_SMOKE_NONCE_COUNT")?,
            confirm_finish: chunks.next().ok_or("ERR_HOST_SMOKE_NONCE_COUNT")?,
            cancel_begin: chunks.next().ok_or("ERR_HOST_SMOKE_NONCE_COUNT")?,
            cancel_finish: chunks.next().ok_or("ERR_HOST_SMOKE_NONCE_COUNT")?,
            chooser_begin: chunks.next().ok_or("ERR_HOST_SMOKE_NONCE_COUNT")?,
            chooser_finish: chunks.next().ok_or("ERR_HOST_SMOKE_NONCE_COUNT")?,
        })
    }

    fn javascript_object(&self) -> String {
        format!(
            concat!(
                "{{captureReady:\"{}\",confirmBegin:\"{}\",confirmFinish:\"{}\",",
                "cancelBegin:\"{}\",cancelFinish:\"{}\",chooserBegin:\"{}\",chooserFinish:\"{}\"}}"
            ),
            self.capture_ready,
            self.confirm_begin,
            self.confirm_finish,
            self.cancel_begin,
            self.cancel_finish,
            self.chooser_begin,
            self.chooser_finish,
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TrustedFlowStage {
    AwaitConfirmBegin,
    ConfirmActive,
    AwaitCancelBegin,
    CancelActive,
    AwaitChooserBegin,
    ChooserActive,
    Complete,
    Failed,
}

struct TrustedFlow {
    stage: TrustedFlowStage,
    tokens: TrustedTokenBundle,
}

impl TrustedFlow {
    fn consume(slot: &mut String, supplied: &str) -> bool {
        if slot.is_empty() || slot != supplied {
            return false;
        }
        slot.clear();
        true
    }

    fn capture_ready(&mut self, token: &str) -> Result<(), &'static str> {
        if Self::consume(&mut self.tokens.capture_ready, token) {
            Ok(())
        } else {
            Err("ERR_HOST_SMOKE_CAPTURE_TOKEN")
        }
    }

    fn begin_ime(&mut self, scenario: &str, token: &str) -> Result<(), &'static str> {
        let valid = match (self.stage, scenario) {
            (TrustedFlowStage::AwaitConfirmBegin, "confirm") => {
                Self::consume(&mut self.tokens.confirm_begin, token)
            }
            (TrustedFlowStage::AwaitCancelBegin, "cancel") => {
                Self::consume(&mut self.tokens.cancel_begin, token)
            }
            _ => false,
        };
        if !valid {
            return Err("ERR_HOST_SMOKE_IME_BEGIN_TOKEN");
        }
        self.stage = if scenario == "confirm" {
            TrustedFlowStage::ConfirmActive
        } else {
            TrustedFlowStage::CancelActive
        };
        Ok(())
    }

    fn finish_ime(
        &mut self,
        scenario: &str,
        token: &str,
        evidence_passed: bool,
    ) -> Result<(), &'static str> {
        let valid = match (self.stage, scenario) {
            (TrustedFlowStage::ConfirmActive, "confirm") => {
                Self::consume(&mut self.tokens.confirm_finish, token)
            }
            (TrustedFlowStage::CancelActive, "cancel") => {
                Self::consume(&mut self.tokens.cancel_finish, token)
            }
            _ => false,
        };
        if !valid {
            return Err("ERR_HOST_SMOKE_IME_FINISH_TOKEN");
        }
        self.stage = if evidence_passed {
            if scenario == "confirm" {
                TrustedFlowStage::AwaitCancelBegin
            } else {
                TrustedFlowStage::AwaitChooserBegin
            }
        } else {
            TrustedFlowStage::Failed
        };
        Ok(())
    }

    fn begin_chooser(&mut self, token: &str) -> Result<(), &'static str> {
        if self.stage != TrustedFlowStage::AwaitChooserBegin
            || !Self::consume(&mut self.tokens.chooser_begin, token)
        {
            return Err("ERR_HOST_SMOKE_CHOOSER_BEGIN_TOKEN");
        }
        self.stage = TrustedFlowStage::ChooserActive;
        Ok(())
    }

    fn finish_chooser(&mut self, token: &str, evidence_passed: bool) -> Result<(), &'static str> {
        if self.stage != TrustedFlowStage::ChooserActive
            || !Self::consume(&mut self.tokens.chooser_finish, token)
        {
            return Err("ERR_HOST_SMOKE_CHOOSER_FINISH_TOKEN");
        }
        self.stage = if evidence_passed {
            TrustedFlowStage::Complete
        } else {
            TrustedFlowStage::Failed
        };
        Ok(())
    }
}

struct HostSmokeState {
    root: PathBuf,
    mode: HostMode,
    report: Mutex<HostReport>,
    trusted_flow: Mutex<TrustedFlow>,
}

impl HostSmokeState {
    fn new(
        root: PathBuf,
        mode: HostMode,
        tokens: TrustedTokenBundle,
    ) -> Result<Self, &'static str> {
        let atomic_replace = run_atomic_replace_self_test(&root);
        let state = Self {
            root,
            mode,
            report: Mutex::new(HostReport {
                mode,
                atomic_replace,
                no_read_audit: StaticNoReadAudit::run(),
                menu_built: false,
                menu_activation_count: 0,
                capture_boundary_ready: false,
                frontend_ready: false,
                editor_mounted: false,
                content_editable: false,
                native_file_input_present: false,
                ime_confirm: ImeEvidence::pending(),
                ime_cancel: ImeEvidence::pending(),
                chooser: ChooserEvidence::pending(),
            }),
            trusted_flow: Mutex::new(TrustedFlow {
                stage: TrustedFlowStage::AwaitConfirmBegin,
                tokens,
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

    fn result_state(&self) -> Result<&'static str, &'static str> {
        self.report
            .lock()
            .map(|report| report.result_state())
            .map_err(|_| "ERR_HOST_SMOKE_STATE")
    }
}

fn hex_token(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn build_initialization_script(tokens: &TrustedTokenBundle) -> Result<String, &'static str> {
    if INITIALIZATION_SCRIPT_TEMPLATE
        .matches(TOKEN_BUNDLE_PLACEHOLDER)
        .count()
        != 1
    {
        return Err("ERR_HOST_SMOKE_INIT_TEMPLATE");
    }
    Ok(INITIALIZATION_SCRIPT_TEMPLATE
        .replace(TOKEN_BUNDLE_PLACEHOLDER, &tokens.javascript_object()))
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
    let tokens = TrustedTokenBundle::generate()?;
    let initialization_script = build_initialization_script(&tokens)?;
    let state = HostSmokeState::new(root, mode, tokens)?;

    // A plugin initialization script runs after Tauri's core script has
    // installed `__TAURI_INTERNALS__.invoke`, but still at document start and
    // before any HTML/application script. `append_invoke_initialization_script`
    // runs earlier than the core script, so using it here would fail before the
    // private capture closure can latch the invoke function.
    let capture_plugin = tauri::plugin::Builder::<Wry>::new("host-release-smoke-capture")
        .js_init_script(initialization_script)
        .build();

    let builder = builder
        .plugin(capture_plugin)
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
            host_release_smoke_capture_ready,
            host_release_smoke_frontend_ready,
            host_release_smoke_trusted_ime_begin,
            host_release_smoke_trusted_ime_finish,
            host_release_smoke_trusted_chooser_begin,
            host_release_smoke_trusted_chooser_finish,
            host_release_smoke_status,
            host_release_smoke_finish,
        ]);

    Ok(builder)
}

fn maybe_exit_automated(app: &AppHandle, state: &HostSmokeState) {
    if state.mode == HostMode::Automated && state.result_state() == Ok("automatedReady") {
        app.exit(0);
    }
}

#[tauri::command]
fn host_release_smoke_capture_ready(
    app: AppHandle,
    state: State<'_, HostSmokeState>,
    token: String,
) -> Result<String, String> {
    state
        .trusted_flow
        .lock()
        .map_err(|_| "ERR_HOST_SMOKE_STATE".to_string())?
        .capture_ready(&token)
        .map_err(str::to_string)?;
    let snapshot = state
        .update(|report| {
            report.capture_boundary_ready = true;
            Ok(())
        })
        .map_err(str::to_string)?;
    maybe_exit_automated(&app, &state);
    Ok(snapshot)
}

#[tauri::command]
fn host_release_smoke_frontend_ready(
    app: AppHandle,
    state: State<'_, HostSmokeState>,
    harness_version: u32,
    editor_kind: String,
    capabilities: Vec<bool>,
) -> Result<String, String> {
    if harness_version != 2 || editor_kind != "codemirror6" || capabilities.len() != 3 {
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
    maybe_exit_automated(&app, &state);
    Ok(snapshot)
}

#[tauri::command]
fn host_release_smoke_trusted_ime_begin(
    state: State<'_, HostSmokeState>,
    token: String,
    scenario: String,
) -> Result<String, String> {
    if state.mode != HostMode::Manual {
        return Err("ERR_HOST_SMOKE_MANUAL_MODE_REQUIRED".into());
    }
    state
        .trusted_flow
        .lock()
        .map_err(|_| "ERR_HOST_SMOKE_STATE".to_string())?
        .begin_ime(&scenario, &token)
        .map_err(str::to_string)?;
    state.persist_current().map_err(str::to_string)
}

#[tauri::command]
fn host_release_smoke_trusted_ime_finish(
    state: State<'_, HostSmokeState>,
    token: String,
    scenario: String,
    counts: Vec<u32>,
    flags: Vec<bool>,
    final_utf16_length: u32,
) -> Result<String, String> {
    if state.mode != HostMode::Manual {
        return Err("ERR_HOST_SMOKE_MANUAL_MODE_REQUIRED".into());
    }
    let mut evidence =
        ImeEvidence::from_private_capture(&scenario, &counts, &flags, final_utf16_length);
    let passed = evidence.status == "passed";
    state
        .trusted_flow
        .lock()
        .map_err(|_| "ERR_HOST_SMOKE_STATE".to_string())?
        .finish_ime(&scenario, &token, passed)
        .map_err(str::to_string)?;
    evidence.native_nonce_flow_consumed = true;
    let snapshot = state
        .update(|report| {
            let target = if scenario == "confirm" {
                &mut report.ime_confirm
            } else if scenario == "cancel" {
                &mut report.ime_cancel
            } else {
                return Err("ERR_HOST_SMOKE_IME_SCENARIO");
            };
            if target.status != "pending" {
                return Err("ERR_HOST_SMOKE_IME_STICKY_RESULT");
            }
            *target = evidence;
            Ok(())
        })
        .map_err(str::to_string)?;
    if passed {
        Ok(snapshot)
    } else {
        Err("ERR_HOST_SMOKE_IME_EVIDENCE".into())
    }
}

#[tauri::command]
fn host_release_smoke_trusted_chooser_begin(
    state: State<'_, HostSmokeState>,
    token: String,
) -> Result<String, String> {
    if state.mode != HostMode::Manual {
        return Err("ERR_HOST_SMOKE_MANUAL_MODE_REQUIRED".into());
    }
    state
        .trusted_flow
        .lock()
        .map_err(|_| "ERR_HOST_SMOKE_STATE".to_string())?
        .begin_chooser(&token)
        .map_err(str::to_string)?;
    state.persist_current().map_err(str::to_string)
}

#[tauri::command]
fn host_release_smoke_trusted_chooser_finish(
    state: State<'_, HostSmokeState>,
    token: String,
    event_kind: String,
) -> Result<String, String> {
    if state.mode != HostMode::Manual {
        return Err("ERR_HOST_SMOKE_MANUAL_MODE_REQUIRED".into());
    }
    let mut evidence = ChooserEvidence::from_private_capture(&event_kind);
    let passed = evidence.status == "passed";
    state
        .trusted_flow
        .lock()
        .map_err(|_| "ERR_HOST_SMOKE_STATE".to_string())?
        .finish_chooser(&token, passed)
        .map_err(str::to_string)?;
    evidence.native_nonce_flow_consumed = true;
    let snapshot = state
        .update(|report| {
            if report.chooser.status != "pending" {
                return Err("ERR_HOST_SMOKE_CHOOSER_STICKY_RESULT");
            }
            report.chooser = evidence;
            Ok(())
        })
        .map_err(str::to_string)?;
    if passed {
        Ok(snapshot)
    } else {
        Err("ERR_HOST_SMOKE_CHOOSER_EVIDENCE".into())
    }
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
    state.persist_current().map_err(str::to_string)?;
    if state.result_state().map_err(str::to_string)? != "manualPass" {
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
        "{{\"status\": \"{}\", \"captureSource\": \"nativeInitializationScript\", \"compositionStartCount\": {}, \"compositionUpdateCount\": {}, \"compositionEndCount\": {}, \"beforeInputCount\": {}, \"inputCount\": {}, \"rejectedUntrustedEventCount\": {}, \"strictSequenceValid\": {}, \"compositionDataValid\": {}, \"inputFieldsValid\": {}, \"singleTargetValid\": {}, \"finalStateMatches\": {}, \"nativeNonceFlowConsumed\": {}, \"finalUtf16Length\": {}}}",
        evidence.status,
        evidence.composition_start_count,
        evidence.composition_update_count,
        evidence.composition_end_count,
        evidence.before_input_count,
        evidence.input_count,
        evidence.rejected_untrusted_event_count,
        evidence.strict_sequence_valid,
        evidence.composition_data_valid,
        evidence.input_fields_valid,
        evidence.single_target_valid,
        evidence.final_state_matches,
        evidence.native_nonce_flow_consumed,
        evidence.final_utf16_length,
    )
}

fn chooser_json(evidence: &ChooserEvidence) -> String {
    format!(
        "{{\"status\": \"{}\", \"captureSource\": \"nativeInitializationScript\", \"eventKind\": \"{}\", \"eventWasTrusted\": {}, \"nativeDialogInteractionObserved\": {}, \"nativeNonceFlowConsumed\": {}, \"selectionDataInspected\": {}}}",
        evidence.status,
        evidence.event_kind,
        evidence.event_was_trusted,
        evidence.native_dialog_interaction_observed,
        evidence.native_nonce_flow_consumed,
        evidence.selection_data_inspected,
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

    fn test_tokens() -> TrustedTokenBundle {
        TrustedTokenBundle {
            capture_ready: "capture-ready".into(),
            confirm_begin: "confirm-begin".into(),
            confirm_finish: "confirm-finish".into(),
            cancel_begin: "cancel-begin".into(),
            cancel_finish: "cancel-finish".into(),
            chooser_begin: "chooser-begin".into(),
            chooser_finish: "chooser-finish".into(),
        }
    }

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
            no_read_audit: StaticNoReadAudit::run(),
            menu_built: true,
            menu_activation_count: 0,
            capture_boundary_ready: true,
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
    fn ime_001_private_capture_evidence_rejects_untrusted_or_malformed_sequences() {
        let passing = ImeEvidence::from_private_capture(
            "confirm",
            &[1, 2, 1, 2, 2, 0],
            &[true, true, true, true, true],
            "\u{786e}\u{8ba4}\u{ff1a}\u{4e2d}\u{6587}"
                .encode_utf16()
                .count() as u32,
        );
        assert_eq!(passing.status, "passed");

        let synthetic_sample = ImeEvidence::from_private_capture(
            "confirm",
            &[1, 2, 1, 2, 2, 1],
            &[true, true, true, true, true],
            "\u{786e}\u{8ba4}\u{ff1a}\u{4e2d}\u{6587}"
                .encode_utf16()
                .count() as u32,
        );
        assert_eq!(synthetic_sample.status, "failed");

        let loose_order = ImeEvidence::from_private_capture(
            "confirm",
            &[2, 2, 1, 2, 2, 0],
            &[false, true, true, true, true],
            5,
        );
        assert_eq!(loose_order.status, "failed");
        assert_eq!(
            ChooserEvidence::from_private_capture("cancel").status,
            "passed"
        );
        assert_eq!(
            ChooserEvidence::from_private_capture("change").status,
            "failed"
        );
    }

    #[test]
    fn native_nonce_flow_is_ordered_one_time_and_rejects_frontend_fabrication() {
        let tokens = test_tokens();
        let mut flow = TrustedFlow {
            stage: TrustedFlowStage::AwaitConfirmBegin,
            tokens,
        };
        assert_eq!(
            flow.begin_ime("confirm", "frontend-invented"),
            Err("ERR_HOST_SMOKE_IME_BEGIN_TOKEN")
        );
        assert_eq!(flow.stage, TrustedFlowStage::AwaitConfirmBegin);

        let confirm_begin = flow.tokens.confirm_begin.clone();
        let confirm_finish = flow.tokens.confirm_finish.clone();
        flow.begin_ime("confirm", &confirm_begin)
            .expect("private confirm begin token");
        assert_eq!(
            flow.begin_ime("confirm", &confirm_begin),
            Err("ERR_HOST_SMOKE_IME_BEGIN_TOKEN")
        );
        assert_eq!(
            flow.finish_ime("confirm", "frontend-invented", true),
            Err("ERR_HOST_SMOKE_IME_FINISH_TOKEN")
        );
        flow.finish_ime("confirm", &confirm_finish, true)
            .expect("private confirm finish token");
        assert_eq!(flow.stage, TrustedFlowStage::AwaitCancelBegin);

        let cancel_begin = flow.tokens.cancel_begin.clone();
        let cancel_finish = flow.tokens.cancel_finish.clone();
        flow.begin_ime("cancel", &cancel_begin)
            .expect("private cancel begin token");
        flow.finish_ime("cancel", &cancel_finish, false)
            .expect("correct token consumes failing evidence");
        assert_eq!(flow.stage, TrustedFlowStage::Failed);
        assert_eq!(
            flow.begin_chooser("frontend-invented"),
            Err("ERR_HOST_SMOKE_CHOOSER_BEGIN_TOKEN")
        );
    }

    #[test]
    fn chooser_no_read_audit_is_compiled_source_fact_not_runtime_counter() {
        let audit = StaticNoReadAudit::run();
        assert_eq!(audit.status, "passed");
        assert_eq!(audit.forbidden_api_match_count, 0);
        let evidence = ChooserEvidence::from_private_capture("cancel");
        let json = chooser_json(&evidence);
        assert!(json.contains("\"selectionDataInspected\": false"));
        assert!(!json.contains("fileReadAttempts"));
        assert!(!json.contains("pathReadAttempts"));
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
