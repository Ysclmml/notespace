//! IPC v1 wire value objects copied from the canonical chapter 03 contract.
//!
//! These types are serialization-only domain data. They deliberately contain no
//! Tauri command handlers, filesystem capabilities, or application behavior.

use std::collections::BTreeMap;

use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};

macro_rules! opaque_string_id {
    ($($name:ident),+ $(,)?) => {
        $(
            #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
            #[serde(transparent)]
            pub struct $name(pub String);
        )+
    };
}

opaque_string_id!(
    WorkspaceId,
    DocumentId,
    DocumentSessionId,
    DocumentViewId,
    DraftId,
    TabId,
    PaneId,
    NavEntryId,
    AssetId,
    GrantId,
    GrantRequestId,
    RecoveryId,
    RequestId,
    OperationId,
    EventId,
    RelativePath,
    RevisionToken,
    ContentHash,
);

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SessionRevision(pub u64);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ApiVersion {
    #[serde(rename = "1.0")]
    V1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct True;

impl Serialize for True {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_bool(true)
    }
}

impl<'de> Deserialize<'de> for True {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        if bool::deserialize(deserializer)? {
            Ok(Self)
        } else {
            Err(D::Error::custom("expected literal true"))
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct False;

impl Serialize for False {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_bool(false)
    }
}

impl<'de> Deserialize<'de> for False {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        if bool::deserialize(deserializer)? {
            Err(D::Error::custom("expected literal false"))
        } else {
            Ok(Self)
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRequest<T> {
    pub api_version: ApiVersion,
    pub request_id: RequestId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<OperationId>,
    pub payload: T,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuccess<T> {
    pub api_version: ApiVersion,
    pub request_id: RequestId,
    pub ok: True,
    pub payload: T,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandFailure {
    pub api_version: ApiVersion,
    pub request_id: RequestId,
    pub ok: False,
    pub error: AppError,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CommandResponse<T> {
    Success(CommandSuccess<T>),
    Failure(Box<CommandFailure>),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: WorkspaceId,
    pub display_name: String,
    pub display_path: String,
    pub state: WorkspaceState,
    pub case_sensitivity: CaseSensitivity,
    pub scan_generation: u64,
    pub capability_epoch: u64,
    pub opened_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceState {
    Opening,
    Ready,
    Rescanning { operation_id: OperationId },
    Degraded { reason: Box<AppError> },
    Closing,
    Closed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaseSensitivity {
    Sensitive,
    Insensitive,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentLocator {
    WorkspacePath {
        workspace_id: WorkspaceId,
        relative_path: RelativePath,
    },
    Draft {
        draft_id: DraftId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        suggested_name: Option<String>,
    },
    GrantedFile {
        grant_id: GrantId,
        display_name: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentAnchor {
    Heading {
        slug: String,
    },
    Block {
        block_id: String,
    },
    SourcePosition {
        line: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        column: Option<u64>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ResourceScope {
    Workspace { workspace_id: WorkspaceId },
    Document { document_id: DocumentId },
    Draft { draft_id: DraftId },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssetOwner {
    Document { document_id: DocumentId },
    Draft { draft_id: DraftId },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ResourceRef {
    Markdown {
        locator: DocumentLocator,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        anchor: Option<DocumentAnchor>,
    },
    Asset {
        scope: ResourceScope,
        relative_path: RelativePath,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        media_type: Option<String>,
    },
    ExternalUrl {
        url: String,
    },
    Virtual {
        provider_id: String,
        resource_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        params: Option<BTreeMap<String, String>>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RevealTarget {
    WorkspaceRoot {
        workspace_id: WorkspaceId,
    },
    WorkspaceEntry {
        workspace_id: WorkspaceId,
        relative_path: RelativePath,
    },
    GrantedFile {
        grant_id: GrantId,
    },
    Asset {
        scope: ResourceScope,
        relative_path: RelativePath,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedLink {
    pub source_document_id: DocumentId,
    pub raw_destination: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_kind_hint: Option<LinkKindHint>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkKindHint {
    Markdown,
    Asset,
    Url,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ResourceResolution {
    Resolved {
        resource: ResourceRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        document_id: Option<DocumentId>,
    },
    NeedsGrant {
        grant_request_id: GrantRequestId,
        display_target: String,
        reason: GrantReason,
    },
    Missing {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        candidate: Option<ResourceRef>,
        display_target: String,
    },
    Unsupported {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scheme: Option<String>,
        display_target: String,
    },
    Invalid {
        error: AppError,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GrantReason {
    OutsideWorkspace,
    RevokedGrant,
    AssetDirectory,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePreviewRequest {
    pub resource: ResourceRef,
    pub max_utf8_bytes: u64,
    pub max_lines: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ResourcePreviewOutcome {
    Text {
        resource: ResourceRef,
        title: String,
        excerpt: String,
        truncated: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resolved_anchor: Option<DocumentAnchor>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        disk_revision: Option<ExpectedDiskRevision>,
    },
    SafetyBlocked {
        resource: ResourceRef,
        report: SafetyBlockedReport,
    },
    Unsupported {
        resource: ResourceRef,
        report: UnsupportedReport,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskRevision {
    pub token: RevisionToken,
    pub size_bytes: u64,
    pub modified_at_unix_ms: u64,
    pub content_hash: ContentHash,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_identity_hint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExpectedDiskRevision {
    Present { revision: DiskRevision },
    Absent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextEncoding {
    Utf8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Mixed,
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PreferredLineEnding {
    Lf,
    Crlf,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFormat {
    pub encoding: TextEncoding,
    pub has_utf8_bom: bool,
    pub line_ending: LineEnding,
    pub preferred_line_ending: PreferredLineEnding,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDescriptor {
    pub document_id: DocumentId,
    pub locator: DocumentLocator,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<WorkspaceId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<RelativePath>,
    pub read_only: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpenMode {
    Normal,
    LargeText,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    pub size_bytes: u64,
    pub max_line_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_count_estimate: Option<u64>,
    pub has_utf8_bom: bool,
    pub detected_data_image_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub largest_data_image_estimate_bytes: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SafetyBlockedReason {
    LineTooLong,
    LargeDataImage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SafetyBlockedAction {
    ExtractDataImages,
    DeleteDataImages,
    OpenExternal,
    Cancel,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SafetyBlockedReport {
    pub kind: SafetyBlockedReportKind,
    pub size_bytes: u64,
    pub max_line_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_count_estimate: Option<u64>,
    pub has_utf8_bom: bool,
    pub detected_data_image_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub largest_data_image_estimate_bytes: Option<u64>,
    pub reasons: Vec<SafetyBlockedReason>,
    pub allowed_actions: Vec<SafetyBlockedAction>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SafetyBlockedReportKind {
    #[serde(rename = "safetyBlocked")]
    SafetyBlocked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UnsupportedReason {
    Binary,
    FileTooLarge,
    InvalidUtf8,
    UnsupportedEncoding,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UnsupportedAction {
    OpenExternal,
    Cancel,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsupportedReport {
    pub kind: UnsupportedReportKind,
    pub size_bytes: u64,
    pub max_line_bytes: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_count_estimate: Option<u64>,
    pub has_utf8_bom: bool,
    pub detected_data_image_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub largest_data_image_estimate_bytes: Option<u64>,
    pub reasons: Vec<UnsupportedReason>,
    pub allowed_actions: Vec<UnsupportedAction>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum UnsupportedReportKind {
    #[serde(rename = "unsupported")]
    Unsupported,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SafetyReport {
    SafetyBlocked(SafetyBlockedReport),
    Unsupported(UnsupportedReport),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditableDocument {
    pub descriptor: DocumentDescriptor,
    pub content: String,
    pub mode: OpenMode,
    pub format: DocumentFormat,
    pub disk_revision: ExpectedDiskRevision,
    pub preflight: PreflightReport,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentOpenOutcome {
    Editable {
        document: EditableDocument,
    },
    SafetyBlocked {
        descriptor: DocumentDescriptor,
        report: SafetyBlockedReport,
        repair_token: String,
        disk_revision: ExpectedDiskRevision,
    },
    Unsupported {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        descriptor: Option<DocumentDescriptor>,
        report: UnsupportedReport,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentLoadState {
    Loading {
        resource: ResourceRef,
        operation_id: OperationId,
    },
    SafetyBlocked {
        resource: ResourceRef,
        descriptor: DocumentDescriptor,
        report: SafetyBlockedReport,
        repair_token: String,
        disk_revision: ExpectedDiskRevision,
    },
    Unsupported {
        resource: ResourceRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        descriptor: Option<DocumentDescriptor>,
        report: UnsupportedReport,
    },
    Failed {
        resource: ResourceRef,
        error: AppError,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DiscardReturnState {
    Dirty,
    Conflict {
        expected: ExpectedDiskRevision,
        actual: ExpectedDiskRevision,
        reason: ConflictReason,
    },
    Missing {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        last_known: Option<DiskRevision>,
    },
    SaveError {
        error: AppError,
    },
    ReloadError {
        error: AppError,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        observed: Option<ExpectedDiskRevision>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictReason {
    Modified,
    Deleted,
    Replaced,
    Created,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PersistenceState {
    Clean,
    Dirty,
    Reloading {
        operation_id: OperationId,
        previous_disk_revision: ExpectedDiskRevision,
    },
    Saving {
        operation_id: OperationId,
        snapshot_session_revision: SessionRevision,
        expected_disk_revision: ExpectedDiskRevision,
        edit_occurred_after_snapshot: bool,
    },
    Conflict {
        expected: ExpectedDiskRevision,
        actual: ExpectedDiskRevision,
        reason: ConflictReason,
    },
    Missing {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        last_known: Option<DiskRevision>,
    },
    SaveError {
        error: AppError,
    },
    ReloadError {
        error: AppError,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        observed: Option<ExpectedDiskRevision>,
    },
    Discarding {
        operation_id: OperationId,
        discard_intent_id: String,
        snapshot_session_revision: SessionRevision,
        previous: DiscardReturnState,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSession {
    pub id: DocumentSessionId,
    pub descriptor: DocumentDescriptor,
    pub current_session_revision: SessionRevision,
    pub persisted_session_revision: SessionRevision,
    pub disk_revision: ExpectedDiskRevision,
    pub format: DocumentFormat,
    pub mode: OpenMode,
    pub persistence: PersistenceState,
    pub lifecycle: SessionLifecycle,
    pub ref_count: u64,
    pub last_accessed_at: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionLifecycle {
    Active,
    Closing,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: TabId,
    pub title: String,
    pub history: NavigationHistory,
    pub pinned: bool,
    pub lifecycle: TabLifecycle,
    pub navigation_epoch: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TabLifecycle {
    Open,
    Closing,
    Closed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationHistory {
    pub entries: Vec<NavEntry>,
    pub index: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavEntry {
    pub id: NavEntryId,
    pub resource: ResourceRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_state: Option<ViewState>,
    pub visited_at: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentView {
    pub id: DocumentViewId,
    pub session_id: DocumentSessionId,
    pub tab_id: TabId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<PaneId>,
    pub view_state: ViewState,
    pub mount_state: MountState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MountState {
    Mounted,
    Suspended,
    Disposed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection: Option<SelectionRange>,
    pub scroll: ScrollAnchor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folded_ranges: Option<Vec<FoldedRange>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub editor_mode: Option<EditorMode>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelectionRange {
    pub anchor: u64,
    pub head: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrollAnchor {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_block: Option<BlockLocator>,
    pub y_within_block: f64,
    pub fallback_scroll_top: f64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FoldedRange {
    pub from: u64,
    pub to: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockLocator {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub syntax_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading_path: Option<Vec<String>>,
    pub source_offset: u64,
    pub source_line: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditorMode {
    Source,
    LivePreview,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OpenDisposition {
    Current,
    NewForegroundTab,
    NewBackgroundTab,
    SplitRight,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NavigationSource {
    Link,
    FileTree,
    Outline,
    Search,
    Backlink,
    Command,
    NativeOpen,
    DragDrop,
    Restore,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigateIntent {
    pub target: NavigateTarget,
    pub disposition: OpenDisposition,
    pub source: NavigationSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_tab_id: Option<TabId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_view_id: Option<DocumentViewId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NavigateTarget {
    Resource(ResourceRef),
    Unresolved(UnresolvedLink),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRef {
    pub id: AssetId,
    pub owner: AssetOwner,
    pub state: AssetState,
    pub media_type: String,
    pub size_bytes: u64,
    pub content_hash: ContentHash,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<RelativePath>,
    pub markdown_uri: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssetState {
    Staging,
    Committing { operation_id: OperationId },
    Committed,
    Orphaned { retain_until_unix_ms: u64 },
    Deleted,
    Failed { error: Box<AppError> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_key: Option<String>,
    pub retryable: bool,
    pub correlation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery_actions: Option<Vec<RecoveryAction>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<AppErrorDetails>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RecoveryAction {
    Retry,
    RequestGrant,
    OpenSafetyPage,
    Reload,
    Compare,
    Overwrite,
    SaveAs,
    OpenExternal,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AppErrorDetails {
    Path {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        display_path: Option<String>,
    },
    Conflict {
        expected: ExpectedDiskRevision,
        actual: ExpectedDiskRevision,
    },
    Safety {
        report: SafetyReport,
    },
    Validation {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        field: Option<String>,
        reason: String,
    },
    Operation {
        operation_id: OperationId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        phase: Option<String>,
    },
    Grant {
        grant_request_id: GrantRequestId,
        purpose: GrantPurpose,
        display_target: String,
    },
    AssetWrite {
        cause: IoFailureCause,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        display_target: Option<String>,
        owner: AssetOwner,
    },
    Io {
        operation: IoOperation,
        cause: IoFailureCause,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        display_path: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GrantPurpose {
    ResourceResolution,
    AssetDirectory,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IoOperation {
    Read,
    Write,
    Flush,
    Rename,
    Remove,
    Stat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IoFailureCause {
    ReadOnly,
    PermissionRevoked,
    DiskFull,
    QuotaExceeded,
    NameConflict,
    PathConflict,
    NotFound,
    DeviceUnavailable,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EventScope {
    App,
    Workspace { workspace_id: WorkspaceId },
    Document { document_id: DocumentId },
    Operation { operation_id: OperationId },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope<T> {
    pub api_version: ApiVersion,
    pub event_id: EventId,
    pub event_type: String,
    pub emitted_at: String,
    pub scope: EventScope,
    pub sequence: u64,
    pub payload: T,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFilesChanged {
    pub generation_hint: u64,
    pub overflow: bool,
    pub changes: Vec<WorkspaceFileChange>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceFileChange {
    Created {
        relative_path: RelativePath,
    },
    Modified {
        relative_path: RelativePath,
    },
    Removed {
        relative_path: RelativePath,
    },
    Renamed {
        from: RelativePath,
        to: RelativePath,
        confidence: RenameConfidence,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RenameConfidence {
    Certain,
    Likely,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCapabilityChanged {
    pub workspace_id: WorkspaceId,
    pub previous_epoch: u64,
    pub capability_epoch: u64,
    pub state: CapabilityState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<AppError>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityState {
    Ready,
    Revoked,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentExternalChanged {
    pub document_id: DocumentId,
    pub change: DocumentExternalChangeKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed_disk_revision: Option<ExpectedDiskRevision>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability_epoch: Option<u64>,
    pub source: DocumentChangeSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub write_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<AppError>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentExternalChangeKind {
    Modified,
    Deleted,
    Replaced,
    MetadataOnly,
    PermissionChanged,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentChangeSource {
    External,
    OwnWrite,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NativeOpenTarget {
    Workspace {
        grant_token: String,
        display_path: String,
    },
    Document {
        resource: ResourceRef,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeOpenResourcesRequested {
    pub native_request_id: String,
    pub source: NativeOpenSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin_pane_id: Option<PaneId>,
    pub targets: Vec<NativeOpenTarget>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeOpenSource {
    Launch,
    Finder,
    DragDrop,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub operation_id: OperationId,
    pub phase: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_units: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_units: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskFinished {
    pub operation_id: OperationId,
    pub outcome: TaskOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<AppError>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskOutcome {
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedResultKey {
    pub document_id: DocumentId,
    pub session_revision: SessionRevision,
    pub producer_version: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_001_session_revision_serializes_as_number() {
        let value = serde_json::to_value(SessionRevision(7)).expect("revision serializes");
        assert_eq!(value, serde_json::json!(7));
    }

    #[test]
    fn sec_001_unknown_error_code_is_preserved() {
        let error = AppError {
            code: "ERR_FUTURE_READ_ONLY".to_owned(),
            message: "Unsupported future error".to_owned(),
            message_key: None,
            retryable: false,
            correlation_id: "correlation-1".to_owned(),
            recovery_actions: None,
            details: None,
        };

        let encoded = serde_json::to_string(&error).expect("error serializes");
        let decoded: AppError = serde_json::from_str(&encoded).expect("error deserializes");
        assert_eq!(decoded.code, "ERR_FUTURE_READ_ONLY");
    }

    #[test]
    fn contract_002_envelope_literals_and_resource_tags_are_typed() {
        let response = CommandResponse::Success(CommandSuccess {
            api_version: ApiVersion::V1,
            request_id: RequestId("request-1".to_owned()),
            ok: True,
            payload: serde_json::json!({ "kind": "synthetic" }),
        });
        let encoded = serde_json::to_value(response).expect("response serializes");
        assert_eq!(encoded["apiVersion"], "1.0");
        assert_eq!(encoded["ok"], true);

        let invalid = serde_json::json!({
            "apiVersion": "1.0",
            "requestId": "request-1",
            "ok": false,
            "payload": {}
        });
        assert!(serde_json::from_value::<CommandResponse<serde_json::Value>>(invalid).is_err());

        let resource = ResourceRef::ExternalUrl {
            url: "https://example.invalid".to_owned(),
        };
        let resource_json = serde_json::to_value(resource).expect("resource serializes");
        assert_eq!(resource_json["kind"], "externalUrl");
        assert_eq!(resource_json["url"], "https://example.invalid");
    }
}
