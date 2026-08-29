//! Executable IPC v1 schema catalog and deterministic artifact generation.
//!
//! Chapter 03 remains the normative prose source until Integration publishes F0.
//! This module is its executable Rust mapping. It intentionally does not register
//! Tauri commands or implement any Phase 1 behavior.

mod fixtures;
mod runtime;
mod rust_typescript;

use std::collections::BTreeMap;

use crate::domain::KNOWN_APP_ERROR_CODES;
use serde::Serialize;
use serde_json::Value;

pub const IPC_API_VERSION: &str = "1.0";
pub const IPC_SCHEMA_STATUS: &str = "1.0-draft";
pub const POLICY_VERSION: u8 = 1;
const CANONICAL_CONTRACT_DOCUMENT: &str =
    include_str!("../../docs/design/03-domain-model-and-contracts.md");

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PayloadBudget {
    Default,
    Document,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CancellationPolicy {
    None,
    Supported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub request_type: &'static str,
    pub response_type: &'static str,
    pub cancellation: CancellationPolicy,
    pub payload_budget: PayloadBudget,
}

macro_rules! command {
    ($id:literal, $name:literal, $request:literal, $response:literal) => {
        CommandSpec {
            id: $id,
            name: $name,
            request_type: $request,
            response_type: $response,
            cancellation: CancellationPolicy::None,
            payload_budget: PayloadBudget::Default,
        }
    };
    ($id:literal, $name:literal, $request:literal, $response:literal, cancel) => {
        CommandSpec {
            id: $id,
            name: $name,
            request_type: $request,
            response_type: $response,
            cancellation: CancellationPolicy::Supported,
            payload_budget: PayloadBudget::Default,
        }
    };
    ($id:literal, $name:literal, $request:literal, $response:literal, document) => {
        CommandSpec {
            id: $id,
            name: $name,
            request_type: $request,
            response_type: $response,
            cancellation: CancellationPolicy::Supported,
            payload_budget: PayloadBudget::Document,
        }
    };
}

pub const COMMANDS: &[CommandSpec] = &[
    command!(
        "IPC-CMD-001",
        "app_capabilities_v1",
        "EmptyRequest",
        "AppCapabilities"
    ),
    command!(
        "IPC-CMD-002",
        "app_state_reconcile_v1",
        "EmptyRequest",
        "AppReconcileOutcome"
    ),
    command!(
        "IPC-CMD-003",
        "app_open_resources_ack_v1",
        "AppOpenResourcesAckRequest",
        "AppOpenResourcesAckOutcome"
    ),
    command!(
        "IPC-CMD-004",
        "app_close_respond_v1",
        "AppCloseRespondRequest",
        "AppCloseRespondOutcome"
    ),
    command!(
        "IPC-CMD-010",
        "workspace_pick_v1",
        "WorkspacePickRequest",
        "WorkspacePickOutcome"
    ),
    command!(
        "IPC-CMD-011",
        "workspace_open_v1",
        "WorkspaceOpenRequest",
        "WorkspaceOpenOutcome"
    ),
    command!(
        "IPC-CMD-012",
        "workspace_open_recent_v1",
        "WorkspaceOpenRecentRequest",
        "WorkspaceOpenOutcome"
    ),
    command!(
        "IPC-CMD-013",
        "workspace_close_v1",
        "WorkspaceCloseRequest",
        "WorkspaceCloseOutcome"
    ),
    command!(
        "IPC-CMD-014",
        "workspace_rescan_v1",
        "WorkspaceRescanRequest",
        "WorkspaceSnapshotPage",
        cancel
    ),
    command!(
        "IPC-CMD-015",
        "document_pick_v1",
        "DocumentPickRequest",
        "DocumentPickOutcome"
    ),
    command!(
        "IPC-CMD-016",
        "resource_grant_v1",
        "ResourceGrantRequest",
        "ResourceGrantOutcome"
    ),
    command!(
        "IPC-CMD-020",
        "resource_resolve_v1",
        "UnresolvedLink",
        "ResourceResolution"
    ),
    command!(
        "IPC-CMD-021",
        "resource_preview_v1",
        "ResourcePreviewRequest",
        "ResourcePreviewOutcome",
        cancel
    ),
    command!(
        "IPC-CMD-028",
        "document_save_as_abort_v1",
        "DocumentSaveAsAbortRequest",
        "DocumentSaveAsAbortOutcome"
    ),
    command!(
        "IPC-CMD-029",
        "document_create_draft_v1",
        "DocumentCreateDraftRequest",
        "DocumentCreateDraftOutcome"
    ),
    command!(
        "IPC-CMD-030",
        "document_open_v1",
        "DocumentOpenRequest",
        "DocumentOpenOutcome",
        document
    ),
    command!(
        "IPC-CMD-031",
        "document_save_v1",
        "DocumentSaveRequest",
        "DocumentSaveOutcome",
        document
    ),
    command!(
        "IPC-CMD-032",
        "document_reload_v1",
        "DocumentReloadRequest",
        "DocumentOpenOutcome",
        document
    ),
    command!(
        "IPC-CMD-033",
        "document_resolve_conflict_v1",
        "ConflictResolutionRequest",
        "ConflictResolutionOutcome",
        document
    ),
    command!(
        "IPC-CMD-034",
        "document_repair_v1",
        "DocumentRepairRequest",
        "DocumentRepairOutcome",
        document
    ),
    command!(
        "IPC-CMD-035",
        "document_prepare_save_as_v1",
        "DocumentPrepareSaveAsRequest",
        "DocumentPrepareSaveAsOutcome",
        cancel
    ),
    command!(
        "IPC-CMD-036",
        "document_save_as_v1",
        "DocumentSaveAsRequest",
        "DocumentSaveAsOutcome",
        document
    ),
    command!(
        "IPC-CMD-037",
        "document_read_disk_snapshot_v1",
        "DocumentReadDiskSnapshotRequest",
        "DocumentCompareOutcome",
        document
    ),
    command!(
        "IPC-CMD-038",
        "document_save_as_status_v1",
        "DocumentSaveAsStatusRequest",
        "DocumentSaveAsStatusOutcome"
    ),
    command!(
        "IPC-CMD-039",
        "document_save_as_ack_v1",
        "DocumentSaveAsAckRequest",
        "DocumentSaveAsAckOutcome"
    ),
    command!(
        "IPC-CMD-040",
        "asset_import_clipboard_v1",
        "AssetImportClipboardRequest",
        "AssetImportClipboardOutcome",
        cancel
    ),
    command!(
        "IPC-CMD-041",
        "asset_release_v1",
        "AssetReleaseRequest",
        "AssetReleaseOutcome"
    ),
    command!(
        "IPC-CMD-050",
        "session_checkpoint_v1",
        "SessionCheckpointRequest",
        "SessionCheckpointOutcome",
        document
    ),
    command!(
        "IPC-CMD-051",
        "recovery_list_v1",
        "EmptyRequest",
        "RecoveryListOutcome"
    ),
    command!(
        "IPC-CMD-052",
        "recovery_open_v1",
        "RecoveryOpenRequest",
        "RecoveryOpenOutcome",
        document
    ),
    command!(
        "IPC-CMD-053",
        "recovery_discard_v1",
        "RecoveryDiscardRequest",
        "RecoveryDiscardOutcome"
    ),
    command!(
        "IPC-CMD-054",
        "window_state_save_v1",
        "WindowStateSaveRequest",
        "WindowStateSaveOutcome"
    ),
    command!(
        "IPC-CMD-055",
        "window_state_load_v1",
        "EmptyRequest",
        "WindowStateLoadOutcome"
    ),
    command!(
        "IPC-CMD-056",
        "session_discard_v1",
        "SessionDiscardRequest",
        "SessionDiscardOutcome"
    ),
    command!(
        "IPC-CMD-060",
        "task_cancel_v1",
        "TaskCancelRequest",
        "TaskCancelOutcome"
    ),
    command!(
        "IPC-CMD-070",
        "resource_open_external_v1",
        "ResourceOpenExternalRequest",
        "ResourceOpenExternalOutcome"
    ),
    command!(
        "IPC-CMD-071",
        "resource_reveal_v1",
        "ResourceRevealRequest",
        "ResourceRevealOutcome"
    ),
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSpec {
    pub id: &'static str,
    pub event_type: &'static str,
    pub payload_type: &'static str,
    pub scope_kind: &'static str,
}

pub const EVENTS: &[EventSpec] = &[
    EventSpec {
        id: "IPC-EVT-010",
        event_type: "workspace.filesChanged",
        payload_type: "WorkspaceFilesChanged",
        scope_kind: "workspace",
    },
    EventSpec {
        id: "IPC-EVT-011",
        event_type: "workspace.capabilityChanged",
        payload_type: "WorkspaceCapabilityChanged",
        scope_kind: "workspace",
    },
    EventSpec {
        id: "IPC-EVT-020",
        event_type: "document.externalChanged",
        payload_type: "DocumentExternalChanged",
        scope_kind: "document",
    },
    EventSpec {
        id: "IPC-EVT-030",
        event_type: "task.progress",
        payload_type: "TaskProgress",
        scope_kind: "operation",
    },
    EventSpec {
        id: "IPC-EVT-031",
        event_type: "task.finished",
        payload_type: "TaskFinished",
        scope_kind: "operation",
    },
    EventSpec {
        id: "IPC-EVT-040",
        event_type: "recovery.snapshotFailed",
        payload_type: "RecoverySnapshotFailed",
        scope_kind: "document",
    },
    EventSpec {
        id: "IPC-EVT-050",
        event_type: "app.closeRequested",
        payload_type: "AppCloseRequest",
        scope_kind: "app",
    },
    EventSpec {
        id: "IPC-EVT-060",
        event_type: "app.openResourcesRequested",
        payload_type: "NativeOpenResourcesRequested",
        scope_kind: "app",
    },
];

pub const KNOWN_WRITE_ACTIONS: &[&str] = &[
    "cancel",
    "proceed",
    "reload",
    "overwrite",
    "recreate",
    "extractDataImages",
    "deleteDataImages",
    "userCancelled",
    "superseded",
    "recoveryAbandoned",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContractGate {
    F0,
    Feature,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ContractImplementationStatus {
    Executable,
    FrozenPort,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractSpec {
    pub id: &'static str,
    pub layer: &'static str,
    pub path: &'static str,
    pub source: &'static str,
    pub summary: &'static str,
    pub gate: ContractGate,
    pub status: ContractImplementationStatus,
    pub future_tasks: &'static [&'static str],
}

macro_rules! contract {
    ($n:literal, $layer:literal, $path:literal, $summary:literal, f0, $tasks:expr) => {
        ContractSpec {
            id: concat!("CONTRACT-", $n),
            layer: $layer,
            path: $path,
            source: "docs/design/03-domain-model-and-contracts.md#17-契约测试清单",
            summary: $summary,
            gate: ContractGate::F0,
            status: ContractImplementationStatus::Executable,
            future_tasks: $tasks,
        }
    };
    ($n:literal, $layer:literal, $path:literal, $summary:literal, $tasks:expr) => {
        ContractSpec {
            id: concat!("CONTRACT-", $n),
            layer: $layer,
            path: $path,
            source: "docs/design/03-domain-model-and-contracts.md#17-契约测试清单",
            summary: $summary,
            gate: ContractGate::Feature,
            status: ContractImplementationStatus::FrozenPort,
            future_tasks: $tasks,
        }
    };
}

pub const CONTRACTS: &[ContractSpec] = &[
    contract!(
        "001",
        "CI schema-drift",
        "tests/contract/schema/contract-001-schema-drift/",
        "Rust schema regeneration leaves committed TypeScript bindings unchanged",
        f0,
        &["P0-CONTRACT-01"]
    ),
    contract!(
        "002",
        "Rust serde + TypeScript fixture",
        "tests/contract/schema/contract-002-union-roundtrip/",
        "Discriminated union tags and fields agree across Rust JSON and TypeScript",
        f0,
        &["P0-CONTRACT-01"]
    ),
    contract!(
        "003",
        "TypeScript forward compatibility",
        "tests/contract/schema/contract-003-forward-compat/",
        "Unknown events/errors/optional fields remain readable and unknown writes fail closed",
        f0,
        &["P0-CONTRACT-01"]
    ),
    contract!(
        "004",
        "Rust ResourceResolver property + integration",
        "tests/contract/resource/contract-004-path-policy/",
        "Path, Unicode, symlink and capability policy",
        &["P1-FILE-01"]
    ),
    contract!(
        "005",
        "Resolver + SessionRegistry integration",
        "tests/contract/session/contract-005-document-identity/",
        "Canonical file identity maps to one DocumentId and session",
        &["P1-FILE-01", "P1-SESSION-01"]
    ),
    contract!(
        "006",
        "TypeScript session reducer + save fixture",
        "tests/contract/session/contract-006-save-snapshot/",
        "A newer edit remains dirty after an older save snapshot succeeds",
        &["P1-SESSION-01", "P1-SAVE-01"]
    ),
    contract!(
        "007",
        "Rust compare-and-save fault injection",
        "tests/contract/file/contract-007-save-cas/",
        "Revision mismatch never replaces the target",
        &["P1-SAVE-01"]
    ),
    contract!(
        "008",
        "Watcher + DocumentSession integration",
        "tests/contract/file/contract-008-external-change/",
        "External changes preserve dirty content and stale reloads cannot overwrite edits",
        &["P1-SAVE-01", "P5-CONFLICT-01"]
    ),
    contract!(
        "009",
        "TypeScript event consumer + app ingress property",
        "tests/contract/events/contract-009-sequence-reconcile/",
        "Duplicate/gap reconcile and pending native intents are idempotent",
        &["P1-SHELL-01", "P2-HISTORY-01"]
    ),
    contract!(
        "010",
        "Rust task lifecycle + save commit point",
        "tests/contract/cancellation/contract-010-commit-point/",
        "Cancellation has one disk-consistent terminal outcome",
        &["P1-SAVE-01"]
    ),
    contract!(
        "011",
        "Rust preflight outcome serde negative",
        "tests/contract/safety/contract-011-blocked-envelope/",
        "Blocked and unsupported outcomes never leak unsafe content",
        &["P1-PREFLIGHT-01"]
    ),
    contract!(
        "012",
        "CodeMirror + Asset gateway fault integration",
        "tests/contract/assets/contract-012-paste-failure/",
        "Asset failure leaves editor content and history unchanged",
        &["P3-PASTE-01"]
    ),
    contract!(
        "013",
        "Browser navigation integration",
        "tests/contract/navigation/contract-013-history-anchor/",
        "History restores block-relative position across async layout",
        &["P2-HISTORY-01"]
    ),
    contract!(
        "014",
        "TypeScript SessionRegistry refcount integration",
        "tests/contract/session/contract-014-tab-refcount/",
        "Closing one Tab cannot retire another Tab's shared session",
        &["P2-TABS-01"]
    ),
    contract!(
        "015",
        "Rust recovery + TypeScript persistence",
        "tests/contract/recovery/contract-015-checkpoint-dirty/",
        "Checkpoint never marks a session clean or blocks explicit save",
        &["P5-RECOVERY-01"]
    ),
    contract!(
        "016",
        "Rust native grant/capability integration",
        "tests/contract/grants/contract-016-native-token/",
        "Only native-bound unexpired grants can be continued",
        &["P1-FILE-01"]
    ),
    contract!(
        "017",
        "Rust AssetService authorization/storage",
        "tests/contract/assets/contract-017-resource-scope/",
        "Workspace, standalone and draft asset scopes stay capability-safe",
        &["P3-ASSET-01", "P3-STAGING-01"]
    ),
    contract!(
        "018",
        "Rust recovery preflight/discard",
        "tests/contract/recovery/contract-018-recovery-preflight/",
        "Recovery is preflighted and discard never touches user files",
        &["P5-RECOVERY-01"]
    ),
    contract!(
        "019",
        "CommandBroker + Rust capability security",
        "tests/contract/security/contract-019-external-policy/",
        "External open/reveal require activation and narrow authorized targets",
        &["P2-ROUTER-01", "P2-INDEX-01"]
    ),
    contract!(
        "020",
        "Save As identity + Router/Registry integration",
        "tests/contract/save-as/contract-020-identity-rebind/",
        "Save As is idempotent and preserves DocumentId while rebinding",
        &["P1-SAVE-01", "P1-SHELL-01"]
    ),
    contract!(
        "021",
        "Save As journal rollback/fault injection",
        "tests/contract/save-as/contract-021-rollback/",
        "Crash or response loss resolves to one commit or full rollback",
        &["P1-SAVE-01", "P3-STAGING-01"]
    ),
    contract!(
        "022",
        "Rust draft identity + SessionRegistry",
        "tests/contract/session/contract-022-draft-create/",
        "Draft creation is idempotent, dirty and first-save-only",
        &["P1-SESSION-01", "P1-SHELL-01"]
    ),
    contract!(
        "023",
        "Native close + Session discard + Recovery",
        "tests/contract/recovery/contract-023-explicit-discard/",
        "Native close proceeds only after every explicit dirty decision succeeds",
        &["P1-SHELL-01", "P5-RECOVERY-01"]
    ),
    contract!(
        "024",
        "Tauri gateway + Rust/TypeScript payload budget",
        "tests/contract/ipc/contract-024-document-content-budget/",
        "All full-content directions share raw and wire budgets",
        &["P0-SPIKE-02", "P1-PREFLIGHT-01"]
    ),
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContractManifest<'a> {
    schema_version: u8,
    api_version: &'a str,
    schema_status: &'a str,
    canonical_source: &'a str,
    commands: &'a [CommandSpec],
    events: &'a [EventSpec],
    known_app_error_codes: &'a [&'a str],
    contracts: &'a [ContractSpec],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnionFixtureSet<'a> {
    schema_version: u8,
    api_version: &'a str,
    generated_by: &'a str,
    unions: BTreeMap<&'a str, Vec<Value>>,
}

pub fn render_typescript() -> String {
    let commands = serde_json::to_string_pretty(COMMANDS).expect("command schema serializes");
    let events = serde_json::to_string_pretty(EVENTS).expect("event schema serializes");
    let errors = serde_json::to_string_pretty(KNOWN_APP_ERROR_CODES).expect("errors serialize");
    let writes = serde_json::to_string_pretty(KNOWN_WRITE_ACTIONS).expect("actions serialize");
    let union_fixtures = render_union_fixtures();
    let command_map = render_command_map();
    let event_map = render_event_map();

    format!(
        "// @generated by src-tauri/src/bin/generate_ipc.rs from Rust serde + ts-rs types.\n// Do not edit by hand. Canonical semantics: docs/design/03-domain-model-and-contracts.md.\n\nexport const IPC_API_VERSION = \"{}\" as const;\n\n{}\n\n{}\n\n{}\n\nexport const IPC_COMMAND_SPECS = {} as const;\n\nexport const IPC_EVENT_SPECS = {} as const;\n\nexport const KNOWN_APP_ERROR_CODES = {} as const;\n\nexport const KNOWN_WRITE_ACTIONS = {} as const;\n\nexport const CONTRACT_UNION_FIXTURES = {} as const;\n\n{}",
        IPC_API_VERSION,
        rust_typescript::render_declarations().trim(),
        command_map,
        event_map,
        commands,
        events,
        errors,
        writes,
        union_fixtures.trim(),
        runtime::TYPESCRIPT_RUNTIME.trim(),
    )
}

fn render_command_map() -> String {
    let mut output = String::from("export interface IpcCommandMap {\n");
    for command in COMMANDS {
        output.push_str(&format!(
            "  {}: {{ request: {}; response: {} }};\n",
            command.name, command.request_type, command.response_type
        ));
    }
    output.push_str(
        "}\n\nexport type IpcCommandName = keyof IpcCommandMap;\n\
         export type IpcCommandRequest<Name extends IpcCommandName> = IpcCommandMap[Name][\"request\"];\n\
         export type IpcCommandResponse<Name extends IpcCommandName> = IpcCommandMap[Name][\"response\"];",
    );
    output
}

fn render_event_map() -> String {
    let mut output = String::from("export interface IpcEventMap {\n");
    for event in EVENTS {
        output.push_str(&format!(
            "  \"{}\": {};\n",
            event.event_type, event.payload_type
        ));
    }
    output.push_str("}\n\nexport type IpcEventType = keyof IpcEventMap;");
    output
}

pub fn render_contract_manifest() -> String {
    let manifest = ContractManifest {
        schema_version: 1,
        api_version: IPC_API_VERSION,
        schema_status: IPC_SCHEMA_STATUS,
        canonical_source: "docs/design/03-domain-model-and-contracts.md",
        commands: COMMANDS,
        events: EVENTS,
        known_app_error_codes: KNOWN_APP_ERROR_CODES,
        contracts: CONTRACTS,
    };
    let mut rendered = serde_json::to_string_pretty(&manifest).expect("manifest serializes");
    rendered.push('\n');
    rendered
}

pub fn render_union_fixtures() -> String {
    let fixture_set = UnionFixtureSet {
        schema_version: 1,
        api_version: IPC_API_VERSION,
        generated_by: "src-tauri/src/ipc_schema/fixtures.rs",
        unions: fixtures::concrete_union_fixtures(),
    };
    let mut rendered = serde_json::to_string_pretty(&fixture_set).expect("fixtures serialize");
    rendered.push('\n');
    rendered
}

pub fn validate_catalog() -> Result<(), String> {
    let expected_contracts = (1..=24)
        .map(|number| format!("CONTRACT-{number:03}"))
        .collect::<Vec<_>>();
    let actual_contracts = CONTRACTS.iter().map(|item| item.id).collect::<Vec<_>>();
    if actual_contracts
        != expected_contracts
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
    {
        return Err(
            "contract IDs must be the canonical contiguous CONTRACT-001..024 set".to_owned(),
        );
    }

    let mut command_names = BTreeMap::new();
    for command in COMMANDS {
        if command_names.insert(command.name, command.id).is_some() {
            return Err(format!("duplicate command name: {}", command.name));
        }
    }
    if COMMANDS.len() != 37 {
        return Err(format!("expected 37 commands, found {}", COMMANDS.len()));
    }
    if EVENTS.len() != 8 {
        return Err(format!("expected 8 events, found {}", EVENTS.len()));
    }
    if KNOWN_APP_ERROR_CODES.len() != 24 {
        return Err(format!(
            "expected 24 known error codes, found {}",
            KNOWN_APP_ERROR_CODES.len()
        ));
    }
    validate_canonical_document()
}

fn validate_canonical_document() -> Result<(), String> {
    let generated_typescript = rust_typescript::render_declarations();
    if generated_typescript.contains("bigint") {
        return Err("wire declarations must use JS-safe numbers, never bigint".to_owned());
    }

    let canonical_commands = parse_table_entries("IPC-CMD-");
    let executable_commands = COMMANDS
        .iter()
        .map(|command| (command.id, command.name))
        .collect::<Vec<_>>();
    if canonical_commands != executable_commands {
        return Err("Rust command catalog differs from the canonical chapter 03 table".to_owned());
    }

    let canonical_events = parse_table_entries("IPC-EVT-");
    let executable_events = EVENTS
        .iter()
        .map(|event| (event.id, event.event_type))
        .collect::<Vec<_>>();
    if canonical_events != executable_events {
        return Err("Rust event catalog differs from the canonical chapter 03 table".to_owned());
    }

    let canonical_errors = parse_known_error_codes()?;
    if canonical_errors != KNOWN_APP_ERROR_CODES {
        return Err(
            "Rust known error codes differ from the canonical chapter 03 constant".to_owned(),
        );
    }

    for command in COMMANDS {
        let canonical_row = CANONICAL_CONTRACT_DOCUMENT
            .lines()
            .find(|line| line.contains(&format!("`{}`", command.id)))
            .ok_or_else(|| format!("{} has no canonical chapter 03 row", command.id))?;
        if !canonical_row.contains(&format!("`{}`", command.name)) {
            return Err(format!(
                "{} command name differs from its canonical chapter 03 row",
                command.id
            ));
        }
        for type_name in [command.request_type, command.response_type] {
            if !typescript_has_declaration(&generated_typescript, type_name) {
                return Err(format!(
                    "{} references {type_name}, but generated bindings do not declare it",
                    command.name
                ));
            }
            if type_name != "EmptyRequest"
                && !CANONICAL_CONTRACT_DOCUMENT.contains(type_name)
                && !is_named_inline_payload(type_name)
            {
                return Err(format!(
                    "{} references payload type {type_name} absent from canonical chapter 03",
                    command.name
                ));
            }
            if type_name != "EmptyRequest"
                && !is_named_inline_payload(type_name)
                && !canonical_row.contains(type_name)
            {
                return Err(format!(
                    "{} does not map {type_name} on its canonical chapter 03 row",
                    command.name
                ));
            }
        }
    }

    for event in EVENTS {
        if !typescript_has_declaration(&generated_typescript, event.payload_type) {
            return Err(format!(
                "{} references {}, but generated bindings do not declare it",
                event.event_type, event.payload_type
            ));
        }
    }

    let fixtures = fixtures::concrete_union_fixtures();
    if fixtures.len() != 44 || fixtures.values().any(Vec::is_empty) {
        return Err(format!(
            "expected 44 non-empty concrete union fixture groups, found {}",
            fixtures.len()
        ));
    }
    Ok(())
}

fn typescript_has_declaration(source: &str, name: &str) -> bool {
    source.contains(&format!("type {name} =")) || source.contains(&format!("interface {name} "))
}

fn parse_table_entries(prefix: &str) -> Vec<(&'static str, &'static str)> {
    CANONICAL_CONTRACT_DOCUMENT
        .lines()
        .filter_map(|line| {
            let columns = line.split('|').map(str::trim).collect::<Vec<_>>();
            if columns.len() < 4 || !columns[1].starts_with(&format!("`{prefix}")) {
                return None;
            }
            Some((trim_backticks(columns[1]), trim_backticks(columns[2])))
        })
        .collect()
}

fn parse_known_error_codes() -> Result<Vec<&'static str>, String> {
    let start_marker = "const KNOWN_APP_ERROR_CODES = [";
    let start = CANONICAL_CONTRACT_DOCUMENT
        .find(start_marker)
        .ok_or_else(|| "canonical known error code constant is missing".to_owned())?
        + start_marker.len();
    let tail = &CANONICAL_CONTRACT_DOCUMENT[start..];
    let end = tail
        .find("] as const")
        .ok_or_else(|| "canonical known error code constant is unterminated".to_owned())?;
    Ok(tail[..end]
        .lines()
        .filter_map(|line| {
            let value = line.trim().trim_end_matches(',');
            value
                .strip_prefix('"')
                .and_then(|value| value.strip_suffix('"'))
        })
        .collect())
}

fn trim_backticks(value: &'static str) -> &'static str {
    value.trim().trim_matches('`')
}

fn is_named_inline_payload(type_name: &str) -> bool {
    matches!(
        type_name,
        "AppOpenResourcesAckRequest"
            | "AppOpenResourcesAckOutcome"
            | "AppCloseRespondRequest"
            | "AppCloseRespondOutcome"
            | "WorkspacePickRequest"
            | "WorkspacePickOutcome"
            | "WorkspaceOpenRequest"
            | "WorkspaceOpenRecentRequest"
            | "WorkspaceOpenOutcome"
            | "WorkspaceCloseRequest"
            | "WorkspaceCloseOutcome"
            | "DocumentPickRequest"
            | "DocumentPickOutcome"
            | "ResourceGrantRequest"
            | "DocumentSaveAsAbortRequest"
            | "DocumentSaveAsAbortOutcome"
            | "DocumentReloadRequest"
            | "DocumentReadDiskSnapshotRequest"
            | "DocumentSaveAsStatusRequest"
            | "DocumentSaveAsAckRequest"
            | "DocumentSaveAsAckOutcome"
            | "AssetReleaseRequest"
            | "AssetReleaseOutcome"
            | "SessionCheckpointOutcome"
            | "RecoveryListOutcome"
            | "RecoveryOpenRequest"
            | "RecoveryDiscardRequest"
            | "RecoveryDiscardOutcome"
            | "WindowStateSaveRequest"
            | "WindowStateSaveOutcome"
            | "WindowStateLoadOutcome"
            | "TaskCancelRequest"
            | "TaskCancelOutcome"
            | "ResourceOpenExternalRequest"
            | "ResourceOpenExternalOutcome"
            | "ResourceRevealRequest"
            | "ResourceRevealOutcome"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_001_catalog_has_canonical_counts_and_ids() {
        validate_catalog().expect("canonical IPC catalog is internally consistent");
    }

    #[test]
    fn contract_002_every_union_fixture_is_concrete_and_nested() {
        let rendered = render_union_fixtures();
        let fixtures: Value = serde_json::from_str(&rendered).expect("fixture JSON parses");
        let unions = fixtures["unions"]
            .as_object()
            .expect("fixture unions exist");
        assert_eq!(unions.len(), 44);
        assert_eq!(unions["WorkspaceState"][2]["kind"], "rescanning");
        assert_eq!(
            unions["ResourcePreviewOutcome"][0]["resource"]["locator"]["kind"],
            "workspacePath"
        );
        assert_eq!(
            unions["PersistenceState"][5]["lastKnown"],
            Value::Null,
            "required nullable fields serialize explicit null"
        );
        assert_eq!(unions["DocumentExternalChanged"][2]["source"], "ownWrite");
        assert_eq!(
            unions["DocumentExternalChanged"][2]["writeId"],
            "fixture-write"
        );
    }

    #[test]
    fn contract_002_serde_discriminators_and_nullability_drive_generated_typescript() {
        let generated = rust_typescript::render_declarations();
        let normalized = generated
            .replace("\"kind\"", "kind")
            .replace("\"type\"", "type")
            .replace("\"lastKnown\"", "lastKnown")
            .replace("\"suggestedName\"", "suggestedName");
        assert!(normalized.contains("type WorkspaceState ="));
        assert!(normalized.contains("{ kind: \"opening\" }"));
        assert!(normalized.contains("{ kind: \"ready\" }"));
        assert!(!normalized.contains("{ type: \"opening\" }"));
        assert!(normalized.contains("kind: \"missing\""));
        assert!(normalized.contains("lastKnown: RequiredNullable<DiskRevision>"));
        assert!(!normalized.contains("lastKnown?: RequiredNullable<DiskRevision>"));
        assert!(normalized.contains("suggestedName?: string"));
        assert!(!normalized.contains("bigint"));
    }

    #[test]
    fn contract_003_unknown_codes_are_not_promoted_to_known_or_write_actions() {
        assert!(!KNOWN_APP_ERROR_CODES.contains(&"ERR_FUTURE_WRITE"));
        assert!(!KNOWN_WRITE_ACTIONS.contains(&"futureDestructiveAction"));
    }
}
