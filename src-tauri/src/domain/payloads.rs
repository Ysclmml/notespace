//! Complete IPC v1 request, response, and event payload surface.
//!
//! Every public wire type derives both serde and `ts-rs`; generated TypeScript
//! declarations are emitted from these exact Rust types.

use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

use super::wire::*;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct EmptyRequest {}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Macos,
    Windows,
    Linux,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppFeatures {
    pub clipboard_image: bool,
    pub split_view: bool,
    pub recovery: bool,
    pub mermaid: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppLimits {
    pub policy_version: One,
    pub normal_file_bytes: JsSafeU64,
    pub max_editable_file_bytes: JsSafeU64,
    pub max_normal_line_bytes: JsSafeU64,
    pub safety_block_line_bytes: JsSafeU64,
    pub safety_block_data_image_decoded_bytes: JsSafeU64,
    pub mermaid_source_bytes: JsSafeU64,
    pub mermaid_max_nodes: JsSafeU64,
    pub mermaid_render_timeout_ms: JsSafeU64,
    pub image_decoded_pixel_max: JsSafeU64,
    pub preview_max_utf8_bytes: JsSafeU64,
    pub preview_max_lines: JsSafeU64,
    pub native_open_queue_max_targets: JsSafeU64,
    pub workspace_scan_page_max_entries: JsSafeU64,
    pub ipc_default_payload_bytes: JsSafeU64,
    pub ipc_document_raw_content_bytes: JsSafeU64,
    pub ipc_document_wire_bytes: JsSafeU64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppCapabilities {
    pub api_version: ApiVersion,
    pub platform: Platform,
    pub features: AppFeatures,
    pub limits: AppLimits,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppCloseRequest {
    pub close_request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub deadline_unix_ms: Option<JsSafeU64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppReconcileOutcome {
    pub app_sequence: JsSafeU64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pending_close_request: Option<AppCloseRequest>,
    pub pending_open_requests: Vec<NativeOpenResourcesRequested>,
    pub pending_save_as_intents: Vec<PendingSaveAsSummary>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppOpenResourcesAckRequest {
    pub native_request_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppOpenResourcesAckOutcome {
    Acknowledged,
    AlreadyAcknowledged,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AppCloseDecision {
    Cancel,
    Proceed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppCloseRespondRequest {
    pub close_request_id: String,
    pub decision: AppCloseDecision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AppCloseRespondOutcome {
    Cancelled,
    Closing,
    AlreadyResolved,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePickRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub initial_workspace_id: Option<WorkspaceId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkspacePickOutcome {
    Selected {
        grant_token: String,
        display_path: String,
    },
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpenRequest {
    pub grant_token: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpenRecentRequest {
    pub workspace_id: WorkspaceId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpenOutcome {
    pub workspace: Workspace,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCloseRequest {
    pub workspace_id: WorkspaceId,
    pub capability_epoch: JsSafeU64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct WorkspaceCloseOutcome {
    pub closed: True,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceRescanRequest {
    Start {
        workspace_id: WorkspaceId,
        known_generation: JsSafeU64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        requested_page_entries: Option<JsSafeU64>,
    },
    Next {
        workspace_id: WorkspaceId,
        scan_id: String,
        cursor: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceEntryKind {
    Directory,
    Markdown,
    Asset,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshotEntry {
    pub kind: WorkspaceEntryKind,
    pub relative_path: RelativePath,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub size_bytes: Option<JsSafeU64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub modified_at_unix_ms: Option<JsSafeU64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshotPage {
    pub workspace: Workspace,
    pub scan_id: String,
    pub target_generation: JsSafeU64,
    pub entries: Vec<WorkspaceSnapshotEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_cursor: Option<String>,
    pub complete: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, TS)]
#[ts(type = "Exclude<ResourceResolution, { kind: \"needsGrant\" }>")]
pub struct ResourceResolutionWithoutGrant(pub ResourceResolution);

impl Serialize for ResourceResolutionWithoutGrant {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if matches!(self.0, ResourceResolution::NeedsGrant { .. }) {
            return Err(serde::ser::Error::custom(
                "resource grant outcome cannot contain needsGrant",
            ));
        }
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ResourceResolutionWithoutGrant {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let resolution = ResourceResolution::deserialize(deserializer)?;
        if matches!(resolution, ResourceResolution::NeedsGrant { .. }) {
            Err(D::Error::custom(
                "resource grant outcome cannot contain needsGrant",
            ))
        } else {
            Ok(Self(resolution))
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ResourceGrantOutcome {
    ResourceResolved {
        grant_request_id: GrantRequestId,
        resolution: Box<ResourceResolutionWithoutGrant>,
    },
    AssetDirectoryGranted {
        grant_request_id: GrantRequestId,
        owner: AssetOwner,
        paste_intent_id: String,
    },
    Cancelled {
        grant_request_id: GrantRequestId,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ResourceGrantRequest {
    pub grant_request_id: GrantRequestId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPickRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub initial_workspace_id: Option<WorkspaceId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentPickOutcome {
    Selected { resource: MarkdownResourceRef },
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionEditIntent {
    pub session_id: DocumentSessionId,
    pub origin_view_id: DocumentViewId,
    pub base_revision: SessionRevision,
    pub changes: UnknownValue,
    pub add_to_history: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SessionEditResult {
    Applied { new_revision: SessionRevision },
    Stale { actual_revision: SessionRevision },
    Rejected { error: Box<AppError> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PreviewIntent {
    pub target: NavigateTarget,
    pub source: NavigationSource,
    pub origin_tab_id: TabId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin_view_id: Option<DocumentViewId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCreateDraftRequest {
    pub draft_intent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub suggested_name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct InitialSessionRevisions {
    pub current: SessionRevision,
    pub persisted: SessionRevision,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCreateDraftOutcome {
    pub document: EditableDocument,
    pub initial_revisions: InitialSessionRevisions,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentOpenRequest {
    pub resource: MarkdownResourceRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub expected_document_id: Option<DocumentId>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DocumentSaveReason {
    Explicit,
    Autosave,
    Close,
    CheckpointPromotion,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveRequest {
    pub document_id: DocumentId,
    pub content: String,
    pub format: DocumentFormat,
    pub snapshot_session_revision: SessionRevision,
    pub expected_disk_revision: ExpectedDiskRevision,
    pub reason: DocumentSaveReason,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentSaveOutcome {
    Saved {
        document_id: DocumentId,
        saved_session_revision: SessionRevision,
        new_disk_revision: DiskRevision,
        write_id: String,
        bytes_written: JsSafeU64,
    },
    Noop {
        document_id: DocumentId,
        saved_session_revision: SessionRevision,
        disk_revision: ExpectedDiskRevision,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AbsentDiskRevision {
    Absent,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ConflictResolutionRequest {
    Reload {
        document_id: DocumentId,
        observed_disk_revision: ExpectedDiskRevision,
    },
    Overwrite {
        document_id: DocumentId,
        content: String,
        format: DocumentFormat,
        snapshot_session_revision: SessionRevision,
        observed_disk_revision: ExpectedDiskRevision,
    },
    Recreate {
        document_id: DocumentId,
        content: String,
        format: DocumentFormat,
        snapshot_session_revision: SessionRevision,
        observed_disk_revision: AbsentDiskRevision,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ConflictResolutionOutcome {
    ReloadChecked { outcome: Box<DocumentOpenOutcome> },
    Saved { result: DocumentSaveOutcome },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SaveAsTarget {
    Prompt {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        suggested_name: Option<String>,
    },
    Grant {
        grant_token: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPrepareSaveAsRequest {
    pub save_as_intent_id: String,
    pub document_id: DocumentId,
    pub source_snapshot_session_revision: SessionRevision,
    pub target: SaveAsTarget,
    pub referenced_draft_asset_ids: Vec<AssetId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct UriReplacement {
    pub asset_id: AssetId,
    pub old_uri: String,
    pub new_uri: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum RelativeLinkImpact {
    None,
    BaseDirectoryChanged,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentPrepareSaveAsOutcome {
    Cancelled {
        save_as_intent_id: String,
    },
    SameDocument {
        save_as_intent_id: String,
        document_id: DocumentId,
    },
    TargetAlreadyOpen {
        save_as_intent_id: String,
        target: DocumentDescriptor,
    },
    Prepared {
        save_as_intent_id: String,
        save_as_token: String,
        new_descriptor: DocumentDescriptor,
        target_expected_disk_revision: ExpectedDiskRevision,
        uri_replacements: Vec<UriReplacement>,
        relative_link_impact: RelativeLinkImpact,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveAsRequest {
    pub save_as_intent_id: String,
    pub document_id: DocumentId,
    pub save_as_token: String,
    pub content: String,
    pub format: DocumentFormat,
    pub source_snapshot_session_revision: SessionRevision,
    pub snapshot_session_revision: SessionRevision,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentSaveAsOutcome {
    Saved {
        save_as_intent_id: String,
        result: DocumentSaveOutcome,
        new_descriptor: DocumentDescriptor,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentSaveAsStatusOutcome {
    Unknown {
        save_as_intent_id: String,
    },
    Prepared {
        save_as_intent_id: String,
        document_id: DocumentId,
    },
    Committing {
        save_as_intent_id: String,
        document_id: DocumentId,
    },
    Committed {
        outcome: DocumentSaveAsOutcome,
    },
    RolledBack {
        save_as_intent_id: String,
        document_id: DocumentId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        error: Option<AppError>,
    },
    Acknowledged {
        save_as_intent_id: String,
        document_id: DocumentId,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum PendingSaveAsPhase {
    Prepared,
    Committing,
    Committed,
    RolledBack,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PendingSaveAsSummary {
    pub document_id: DocumentId,
    pub save_as_intent_id: String,
    pub phase: PendingSaveAsPhase,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentCompareOutcome {
    Snapshot {
        content: String,
        format: DocumentFormat,
        disk_revision: ExpectedDiskRevision,
    },
    SafetyBlocked {
        report: SafetyBlockedReport,
        disk_revision: ExpectedDiskRevision,
    },
    Unsupported {
        report: UnsupportedReport,
        disk_revision: ExpectedDiskRevision,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentRepairAction {
    ExtractDataImages { asset_directory_name: String },
    DeleteDataImages,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRepairRequest {
    pub repair_token: String,
    pub expected_disk_revision: ExpectedDiskRevision,
    pub action: DocumentRepairAction,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRepairOutcome {
    pub backup_display_path: String,
    pub repaired_disk_revision: DiskRevision,
    pub extracted_assets: Vec<AssetRef>,
    pub reopen: DocumentOpenOutcome,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReloadRequest {
    pub document_id: DocumentId,
    pub known_disk_revision: ExpectedDiskRevision,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentReadDiskSnapshotRequest {
    pub document_id: DocumentId,
    pub observed_disk_revision: ExpectedDiskRevision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum SaveAsAbortReason {
    UserCancelled,
    Superseded,
    RecoveryAbandoned,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveAsAbortRequest {
    pub document_id: DocumentId,
    pub save_as_intent_id: String,
    pub reason: SaveAsAbortReason,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DocumentSaveAsAbortOutcome {
    Aborted,
    AlreadyAborted,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveAsStatusRequest {
    pub document_id: DocumentId,
    pub save_as_intent_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSaveAsAckRequest {
    pub document_id: DocumentId,
    pub save_as_intent_id: String,
    pub accepted_disk_revision: DiskRevision,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DocumentSaveAsAckOutcome {
    Acknowledged,
    AlreadyAcknowledged,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardImageFormat {
    Png,
    Preserve,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AssetImportClipboardRequest {
    pub paste_intent_id: String,
    pub owner: AssetOwner,
    pub preferred_format: ClipboardImageFormat,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub naming_hint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssetImportClipboardOutcome {
    Imported {
        asset: AssetRef,
    },
    NeedsGrant {
        grant_request_id: GrantRequestId,
        owner: AssetOwner,
        paste_intent_id: String,
        display_target: String,
        reason: AssetGrantReason,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AssetGrantReason {
    AssetDirectory,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum AssetReleaseReason {
    InsertFailed,
    Undo,
    DocumentClosed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AssetReleaseRequest {
    pub asset_id: AssetId,
    pub reason: AssetReleaseReason,
    pub retain_until_unix_ms: JsSafeU64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AssetReleaseOutcome {
    pub state: AssetState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum CheckpointReason {
    Debounce,
    AppClose,
    CrashGuard,
    SaveAsPrepare,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionCheckpointRequest {
    pub document_id: DocumentId,
    pub session_revision: SessionRevision,
    pub persisted_session_revision: SessionRevision,
    pub base_disk_revision: ExpectedDiskRevision,
    pub content: String,
    pub reason: CheckpointReason,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pending_save_as_intent_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionCheckpointOutcome {
    pub checkpointed: SessionRevision,
    pub stored_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiscardRequest {
    pub discard_intent_id: String,
    pub document_id: DocumentId,
    pub snapshot_session_revision: SessionRevision,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiscardOutcome {
    pub kind: DiscardedKind,
    pub document_id: DocumentId,
    pub discarded_recovery_ids: Vec<RecoveryId>,
    pub orphaned_asset_ids: Vec<AssetId>,
    pub draft_identity_released: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub enum DiscardedKind {
    Discarded,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDescriptor {
    pub id: RecoveryId,
    pub title_snapshot: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub locator_hint: Option<DocumentLocator>,
    pub session_revision: SessionRevision,
    pub persisted_session_revision: SessionRevision,
    pub base_disk_revision: ExpectedDiskRevision,
    pub captured_at: String,
    pub quarantined: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pending_save_as_intent_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredEditableDocument {
    pub descriptor: DocumentDescriptor,
    pub content: String,
    pub mode: OpenMode,
    pub format: DocumentFormat,
    pub observed_disk_revision: ExpectedDiskRevision,
    pub preflight: PreflightReport,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RecoveryInitialPersistence {
    Clean,
    Dirty,
    Conflict {
        expected: ExpectedDiskRevision,
        actual: ExpectedDiskRevision,
        reason: ConflictReason,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RestoredRevisions {
    pub current: SessionRevision,
    pub persisted: SessionRevision,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct ReconciledSaveAs {
    pub save_as_intent_id: String,
    pub outcome: DocumentSaveAsOutcome,
    pub requires_ack: True,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RecoveryOpenOutcome {
    Editable {
        recovery: RecoveryDescriptor,
        document: Box<RecoveredEditableDocument>,
        restored_revisions: RestoredRevisions,
        initial_persistence: RecoveryInitialPersistence,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        reconciled_save_as: Option<Box<ReconciledSaveAs>>,
    },
    SafetyBlocked {
        descriptor: RecoveryDescriptor,
        report: SafetyBlockedReport,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RecoveryListOutcome {
    pub items: Vec<RecoveryDescriptor>,
    #[serde(rename = "safeMode")]
    pub safe_mode: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryOpenRequest {
    pub recovery_id: RecoveryId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDiscardRequest {
    pub recovery_id: RecoveryId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RecoveryDiscardOutcome {
    pub discarded: True,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PaneSnapshot {
    pub pane_id: PaneId,
    pub tab_ids: Vec<TabId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub active_tab_id: Option<TabId>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WindowLayout {
    Single {
        pane: PaneSnapshot,
        focused_pane_id: PaneId,
    },
    Split {
        left: PaneSnapshot,
        right: PaneSnapshot,
        ratio: f64,
        focused_pane_id: PaneId,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct WindowTabSnapshot {
    pub id: TabId,
    pub history: NavigationHistory,
    pub pinned: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecentlyClosedTabSnapshot {
    pub history: NavigationHistory,
    pub pinned: bool,
    pub closed_at: JsSafeU64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct SidebarSnapshot {
    pub visible: bool,
    pub width: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateSnapshotV1 {
    pub schema_version: One,
    pub tabs: Vec<WindowTabSnapshot>,
    pub recently_closed_tabs: Vec<RecentlyClosedTabSnapshot>,
    pub sidebar: SidebarSnapshot,
    pub layout: WindowLayout,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
pub struct WindowStateSaveRequest {
    pub snapshot: WindowStateSnapshotV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateSaveOutcome {
    pub stored_at: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateLoadOutcome {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub snapshot: Option<WindowStateSnapshotV1>,
    pub safe_mode: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TaskCancelRequest {
    pub operation_id: OperationId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TaskCancelOutcome {
    Requested,
    NotFound,
    PastCommitPoint,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ResourceOpenExternalRequest {
    pub resource: ResourceRef,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ResourceOpenExternalOutcome {
    pub opened: True,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ResourceRevealRequest {
    pub target: RevealTarget,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ResourceRevealOutcome {
    pub revealed: True,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshotFailed {
    pub document_id: DocumentId,
    pub error: AppError,
}
