//! IPC v1 wire value objects copied from the canonical chapter 03 contract.
//!
//! These types are serialization-only domain data. They deliberately contain no
//! Tauri command handlers, filesystem capabilities, or application behavior.

use std::{borrow::Cow, collections::BTreeMap};

use schemars::{json_schema, JsonSchema, Schema, SchemaGenerator};
use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};
use ts_rs::TS;

pub const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub const KNOWN_APP_ERROR_CODES: &[&str] = &[
    "ERR_API_VERSION_MISMATCH",
    "ERR_INVALID_REQUEST",
    "ERR_INVALID_PATH",
    "ERR_PATH_OUTSIDE_SCOPE",
    "ERR_GRANT_REQUIRED",
    "ERR_NOT_FOUND",
    "ERR_PERMISSION_DENIED",
    "ERR_INVALID_UTF8",
    "ERR_UNSAFE_CONTENT",
    "ERR_FILE_TOO_LARGE",
    "ERR_REVISION_CONFLICT",
    "ERR_DOCUMENT_BUSY",
    "ERR_CANCELLED",
    "ERR_CLIPBOARD_NO_IMAGE",
    "ERR_UNSUPPORTED_IMAGE",
    "ERR_ASSET_WRITE_FAILED",
    "ERR_WATCH_OVERFLOW",
    "ERR_IO",
    "ERR_UNSUPPORTED",
    "ERR_INTERNAL",
    "ERR_INVALID_STATE",
    "ERR_STALE_TOKEN",
    "ERR_ASSET_MIGRATION_FAILED",
    "ERR_RECOVERY_CORRUPT",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, TS)]
#[ts(type = "number")]
pub struct JsSafeU64(pub u64);

impl Serialize for JsSafeU64 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if self.0 > JS_MAX_SAFE_INTEGER {
            return Err(serde::ser::Error::custom(
                "integer exceeds Number.MAX_SAFE_INTEGER",
            ));
        }
        serializer.serialize_u64(self.0)
    }
}

impl<'de> Deserialize<'de> for JsSafeU64 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = u64::deserialize(deserializer)?;
        if value > JS_MAX_SAFE_INTEGER {
            return Err(D::Error::custom("integer exceeds Number.MAX_SAFE_INTEGER"));
        }
        Ok(Self(value))
    }
}

impl JsonSchema for JsSafeU64 {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> Cow<'static, str> {
        "JsSafeU64".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({
            "type": "integer",
            "minimum": 0,
            "maximum": JS_MAX_SAFE_INTEGER,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, TS)]
#[ts(type = "number")]
pub struct JsSafeI64(pub i64);

impl Serialize for JsSafeI64 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if self.0.unsigned_abs() > JS_MAX_SAFE_INTEGER {
            return Err(serde::ser::Error::custom(
                "integer exceeds JavaScript safe integer range",
            ));
        }
        serializer.serialize_i64(self.0)
    }
}

impl<'de> Deserialize<'de> for JsSafeI64 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = i64::deserialize(deserializer)?;
        if value.unsigned_abs() > JS_MAX_SAFE_INTEGER {
            return Err(D::Error::custom(
                "integer exceeds JavaScript safe integer range",
            ));
        }
        Ok(Self(value))
    }
}

impl JsonSchema for JsSafeI64 {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> Cow<'static, str> {
        "JsSafeI64".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({
            "type": "integer",
            "minimum": -(JS_MAX_SAFE_INTEGER as i64),
            "maximum": JS_MAX_SAFE_INTEGER,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(as = "Option<T>")]
pub struct RequiredNullable<T>(pub Option<T>);

macro_rules! opaque_string_id {
    ($(($name:ident, $typescript:literal)),+ $(,)?) => {
        $(
            #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS, JsonSchema)]
            #[ts(type = $typescript)]
            pub struct $name(pub String);
        )+
    };
}

opaque_string_id!(
    (WorkspaceId, "Brand<string, \"WorkspaceId\">"),
    (DocumentId, "Brand<string, \"DocumentId\">"),
    (DocumentSessionId, "Brand<string, \"DocumentSessionId\">"),
    (DocumentViewId, "Brand<string, \"DocumentViewId\">"),
    (DraftId, "Brand<string, \"DraftId\">"),
    (TabId, "Brand<string, \"TabId\">"),
    (PaneId, "Brand<string, \"PaneId\">"),
    (NavEntryId, "Brand<string, \"NavEntryId\">"),
    (AssetId, "Brand<string, \"AssetId\">"),
    (GrantId, "Brand<string, \"GrantId\">"),
    (GrantRequestId, "Brand<string, \"GrantRequestId\">"),
    (RecoveryId, "Brand<string, \"RecoveryId\">"),
    (RequestId, "Brand<string, \"RequestId\">"),
    (OperationId, "Brand<string, \"OperationId\">"),
    (EventId, "Brand<string, \"EventId\">"),
    (RelativePath, "Brand<string, \"RelativePath\">"),
    (RevisionToken, "Brand<string, \"RevisionToken\">"),
    (ContentHash, "Brand<string, \"ContentHash\">"),
);

#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS, JsonSchema,
)]
#[ts(type = "Brand<number, \"SessionRevision\">")]
pub struct SessionRevision(pub JsSafeU64);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub enum ApiVersion {
    #[serde(rename = "1.0")]
    V1,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(type = "true")]
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

impl JsonSchema for True {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> Cow<'static, str> {
        "True".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "boolean", "const": true })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(type = "false")]
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

impl JsonSchema for False {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> Cow<'static, str> {
        "False".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "boolean", "const": false })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(type = "1")]
pub struct One;

impl Serialize for One {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u8(1)
    }
}

impl<'de> Deserialize<'de> for One {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        if u8::deserialize(deserializer)? == 1 {
            Ok(Self)
        } else {
            Err(D::Error::custom("expected literal 1"))
        }
    }
}

impl JsonSchema for One {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> Cow<'static, str> {
        "One".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "integer", "const": 1 })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[ts(type = "unknown")]
pub struct UnknownValue(pub serde_json::Value);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommandRequest<T> {
    pub api_version: ApiVersion,
    pub request_id: RequestId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub operation_id: Option<OperationId>,
    pub payload: T,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommandSuccess<T> {
    pub api_version: ApiVersion,
    pub request_id: RequestId,
    pub ok: True,
    pub payload: T,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommandFailure {
    pub api_version: ApiVersion,
    pub request_id: RequestId,
    pub ok: False,
    pub error: AppError,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
pub enum CommandResponse<T> {
    Success(CommandSuccess<T>),
    Failure(Box<CommandFailure>),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: WorkspaceId,
    pub display_name: String,
    pub display_path: String,
    pub state: WorkspaceState,
    pub case_sensitivity: CaseSensitivity,
    pub scan_generation: JsSafeU64,
    pub capability_epoch: JsSafeU64,
    pub opened_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CaseSensitivity {
    Sensitive,
    Insensitive,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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
        #[ts(optional)]
        suggested_name: Option<String>,
    },
    GrantedFile {
        grant_id: GrantId,
        display_name: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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
        line: JsSafeU64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        column: Option<JsSafeU64>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssetOwner {
    Document { document_id: DocumentId },
    Draft { draft_id: DraftId },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ResourceRef {
    Markdown {
        locator: DocumentLocator,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        anchor: Option<DocumentAnchor>,
    },
    Asset {
        scope: ResourceScope,
        relative_path: RelativePath,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        media_type: Option<String>,
    },
    ExternalUrl {
        url: String,
    },
    Virtual {
        provider_id: String,
        resource_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        params: Option<BTreeMap<String, String>>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, TS)]
#[ts(type = "Extract<ResourceRef, { kind: \"markdown\" }>")]
pub struct MarkdownResourceRef(pub ResourceRef);

impl Serialize for MarkdownResourceRef {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if !matches!(self.0, ResourceRef::Markdown { .. }) {
            return Err(serde::ser::Error::custom("expected markdown ResourceRef"));
        }
        self.0.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for MarkdownResourceRef {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let resource = ResourceRef::deserialize(deserializer)?;
        if matches!(resource, ResourceRef::Markdown { .. }) {
            Ok(Self(resource))
        } else {
            Err(D::Error::custom("expected markdown ResourceRef"))
        }
    }
}

impl JsonSchema for MarkdownResourceRef {
    fn schema_name() -> Cow<'static, str> {
        "MarkdownResourceRef".into()
    }

    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        let resource_schema = ResourceRef::json_schema(generator);
        let markdown_variant = resource_schema
            .as_object()
            .and_then(|schema| schema.get("oneOf"))
            .and_then(serde_json::Value::as_array)
            .and_then(|variants| {
                variants.iter().find(|variant| {
                    variant.pointer("/properties/kind/const")
                        == Some(&serde_json::Value::String("markdown".to_owned()))
                })
            })
            .cloned()
            .expect("ResourceRef must retain its markdown serde variant");
        Schema::try_from(markdown_variant).expect("markdown ResourceRef variant is a schema")
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnresolvedLink {
    pub source_document_id: DocumentId,
    pub raw_destination: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub link_kind_hint: Option<LinkKindHint>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum LinkKindHint {
    Markdown,
    Asset,
    Url,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ResourceResolution {
    Resolved {
        resource: ResourceRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        document_id: Option<DocumentId>,
    },
    NeedsGrant {
        grant_request_id: GrantRequestId,
        display_target: String,
        reason: GrantReason,
    },
    Missing {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        candidate: Option<ResourceRef>,
        display_target: String,
    },
    Unsupported {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        scheme: Option<String>,
        display_target: String,
    },
    Invalid {
        error: AppError,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum GrantReason {
    OutsideWorkspace,
    RevokedGrant,
    AssetDirectory,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePreviewRequest {
    pub resource: ResourceRef,
    pub max_utf8_bytes: JsSafeU64,
    pub max_lines: JsSafeU64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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
        #[ts(optional)]
        resolved_anchor: Option<DocumentAnchor>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiskRevision {
    pub token: RevisionToken,
    pub size_bytes: JsSafeU64,
    pub modified_at_unix_ms: JsSafeU64,
    pub content_hash: ContentHash,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub file_identity_hint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ExpectedDiskRevision {
    Present { revision: DiskRevision },
    Absent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum TextEncoding {
    Utf8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum LineEnding {
    Lf,
    Crlf,
    Mixed,
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum PreferredLineEnding {
    Lf,
    Crlf,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFormat {
    pub encoding: TextEncoding,
    pub has_utf8_bom: bool,
    pub line_ending: LineEnding,
    pub preferred_line_ending: PreferredLineEnding,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDescriptor {
    pub document_id: DocumentId,
    pub locator: DocumentLocator,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub workspace_id: Option<WorkspaceId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub relative_path: Option<RelativePath>,
    pub read_only: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum OpenMode {
    Normal,
    LargeText,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PreflightReport {
    pub size_bytes: JsSafeU64,
    pub max_line_bytes: JsSafeU64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line_count_estimate: Option<JsSafeU64>,
    pub has_utf8_bom: bool,
    pub detected_data_image_count: JsSafeU64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub largest_data_image_estimate_bytes: Option<JsSafeU64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SafetyBlockedReason {
    LineTooLong,
    LargeDataImage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SafetyBlockedAction {
    ExtractDataImages,
    DeleteDataImages,
    OpenExternal,
    Cancel,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SafetyBlockedReport {
    pub kind: SafetyBlockedReportKind,
    pub size_bytes: JsSafeU64,
    pub max_line_bytes: JsSafeU64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line_count_estimate: Option<JsSafeU64>,
    pub has_utf8_bom: bool,
    pub detected_data_image_count: JsSafeU64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub largest_data_image_estimate_bytes: Option<JsSafeU64>,
    pub reasons: Vec<SafetyBlockedReason>,
    pub allowed_actions: Vec<SafetyBlockedAction>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub enum SafetyBlockedReportKind {
    #[serde(rename = "safetyBlocked")]
    SafetyBlocked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum UnsupportedReason {
    Binary,
    FileTooLarge,
    InvalidUtf8,
    UnsupportedEncoding,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum UnsupportedAction {
    OpenExternal,
    Cancel,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UnsupportedReport {
    pub kind: UnsupportedReportKind,
    pub size_bytes: JsSafeU64,
    pub max_line_bytes: JsSafeU64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub line_count_estimate: Option<JsSafeU64>,
    pub has_utf8_bom: bool,
    pub detected_data_image_count: JsSafeU64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub largest_data_image_estimate_bytes: Option<JsSafeU64>,
    pub reasons: Vec<UnsupportedReason>,
    pub allowed_actions: Vec<UnsupportedAction>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub enum UnsupportedReportKind {
    #[serde(rename = "unsupported")]
    Unsupported,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
pub enum SafetyReport {
    SafetyBlocked(SafetyBlockedReport),
    Unsupported(UnsupportedReport),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditableDocument {
    pub descriptor: DocumentDescriptor,
    pub content: String,
    pub mode: OpenMode,
    pub format: DocumentFormat,
    pub disk_revision: ExpectedDiskRevision,
    pub preflight: PreflightReport,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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
        #[ts(optional)]
        descriptor: Option<DocumentDescriptor>,
        report: UnsupportedReport,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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
        #[ts(optional)]
        descriptor: Option<DocumentDescriptor>,
        report: UnsupportedReport,
    },
    Failed {
        resource: ResourceRef,
        error: AppError,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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
        last_known: RequiredNullable<DiskRevision>,
    },
    SaveError {
        error: AppError,
    },
    ReloadError {
        error: AppError,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        observed: Option<ExpectedDiskRevision>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ConflictReason {
    Modified,
    Deleted,
    Replaced,
    Created,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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
        last_known: RequiredNullable<DiskRevision>,
    },
    SaveError {
        error: AppError,
    },
    ReloadError {
        error: AppError,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        observed: Option<ExpectedDiskRevision>,
    },
    Discarding {
        operation_id: OperationId,
        discard_intent_id: String,
        snapshot_session_revision: SessionRevision,
        previous: DiscardReturnState,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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
    pub ref_count: JsSafeU64,
    pub last_accessed_at: JsSafeU64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SessionLifecycle {
    Active,
    Closing,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: TabId,
    pub title: String,
    pub history: NavigationHistory,
    pub pinned: bool,
    pub lifecycle: TabLifecycle,
    pub navigation_epoch: JsSafeU64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TabLifecycle {
    Open,
    Closing,
    Closed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NavigationHistory {
    pub entries: Vec<NavEntry>,
    pub index: JsSafeI64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NavEntry {
    pub id: NavEntryId,
    pub resource: ResourceRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub title_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub view_state: Option<ViewState>,
    pub visited_at: JsSafeU64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentView {
    pub id: DocumentViewId,
    pub session_id: DocumentSessionId,
    pub tab_id: TabId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pane_id: Option<PaneId>,
    pub view_state: ViewState,
    pub mount_state: MountState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MountState {
    Mounted,
    Suspended,
    Disposed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ViewState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub selection: Option<SelectionRange>,
    pub scroll: ScrollAnchor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub folded_ranges: Option<Vec<FoldedRange>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub editor_mode: Option<EditorMode>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct SelectionRange {
    pub anchor: JsSafeU64,
    pub head: JsSafeU64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScrollAnchor {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub top_block: Option<BlockLocator>,
    pub y_within_block: f64,
    pub fallback_scroll_top: f64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct FoldedRange {
    pub from: JsSafeU64,
    pub to: JsSafeU64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fingerprint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BlockLocator {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub syntax_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub heading_path: Option<Vec<String>>,
    pub source_offset: JsSafeU64,
    pub source_line: JsSafeU64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub fingerprint: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum EditorMode {
    Source,
    LivePreview,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum OpenDisposition {
    Current,
    NewForegroundTab,
    NewBackgroundTab,
    SplitRight,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NavigateIntent {
    pub target: NavigateTarget,
    pub disposition: OpenDisposition,
    pub source: NavigationSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin_tab_id: Option<TabId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin_view_id: Option<DocumentViewId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(untagged)]
pub enum NavigateTarget {
    Resource(ResourceRef),
    Unresolved(UnresolvedLink),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AssetRef {
    pub id: AssetId,
    pub owner: AssetOwner,
    pub state: AssetState,
    pub media_type: String,
    pub size_bytes: JsSafeU64,
    pub content_hash: ContentHash,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub width: Option<JsSafeU64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub height: Option<JsSafeU64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub relative_path: Option<RelativePath>,
    pub markdown_uri: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssetState {
    Staging,
    Committing { operation_id: OperationId },
    Committed,
    Orphaned { retain_until_unix_ms: JsSafeU64 },
    Deleted,
    Failed { error: Box<AppError> },
}

#[derive(Clone, Debug, PartialEq, Eq, TS)]
#[ts(rename_all = "camelCase")]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
    #[ts(optional)]
    pub message_key: Option<String>,
    pub retryable: bool,
    pub correlation_id: String,
    #[ts(optional)]
    pub recovery_actions: Option<Vec<RecoveryAction>>,
    #[ts(optional)]
    pub details: Option<AppErrorDetails>,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct SafeAppError<'a> {
            code: &'a AppErrorCode,
            message: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            message_key: Option<&'a str>,
            retryable: bool,
            correlation_id: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            recovery_actions: Option<Vec<RecoveryAction>>,
            #[serde(skip_serializing_if = "Option::is_none")]
            details: Option<&'a AppErrorDetails>,
        }

        let recovery_actions = self.recovery_actions.as_ref().map(|actions| {
            actions
                .iter()
                .copied()
                .filter(|action| self.code.is_known() || action.is_read_only())
                .collect()
        });
        SafeAppError {
            code: &self.code,
            message: &self.message,
            message_key: self.message_key.as_deref(),
            retryable: self.retryable,
            correlation_id: &self.correlation_id,
            recovery_actions,
            details: self.details.as_ref(),
        }
        .serialize(serializer)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, TS)]
#[ts(type = "KnownAppErrorCode | UnknownAppErrorCode")]
pub struct AppErrorCode(pub String);

impl Serialize for AppErrorCode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        if self.0.is_empty() {
            return Err(serde::ser::Error::custom("AppErrorCode must not be empty"));
        }
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for AppErrorCode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let code = String::deserialize(deserializer)?;
        if code.is_empty() {
            return Err(D::Error::custom("AppErrorCode must not be empty"));
        }
        Ok(Self(code))
    }
}

impl JsonSchema for AppErrorCode {
    fn schema_name() -> Cow<'static, str> {
        "AppErrorCode".into()
    }

    fn json_schema(_: &mut SchemaGenerator) -> Schema {
        json_schema!({ "type": "string", "minLength": 1 })
    }
}

impl AppErrorCode {
    pub fn is_known(&self) -> bool {
        KNOWN_APP_ERROR_CODES.contains(&self.0.as_str())
    }
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
struct RawAppError {
    code: AppErrorCode,
    message: String,
    #[serde(default)]
    message_key: Option<String>,
    retryable: bool,
    correlation_id: String,
    #[serde(default)]
    recovery_actions: Option<Vec<String>>,
    #[serde(default)]
    details: Option<AppErrorDetails>,
}

impl JsonSchema for AppError {
    fn schema_name() -> Cow<'static, str> {
        "AppError".into()
    }

    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        RawAppError::json_schema(generator)
    }
}

impl<'de> Deserialize<'de> for AppError {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = RawAppError::deserialize(deserializer)?;
        let recovery_actions = raw.recovery_actions.map(|actions| {
            actions
                .into_iter()
                .filter_map(|action| RecoveryAction::from_wire(&action))
                .filter(|action| raw.code.is_known() || action.is_read_only())
                .collect()
        });
        Ok(Self {
            code: raw.code,
            message: raw.message,
            message_key: raw.message_key,
            retryable: raw.retryable,
            correlation_id: raw.correlation_id,
            recovery_actions,
            details: raw.details,
        })
    }
}

macro_rules! define_recovery_actions {
    ($(($variant:ident, $wire:literal, $read_only:literal)),+ $(,)?) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
        pub enum RecoveryAction {
            $(
                #[serde(rename = $wire)]
                $variant,
            )+
        }

        impl RecoveryAction {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            pub const fn wire_name(self) -> &'static str {
                match self {
                    $(Self::$variant => $wire),+
                }
            }

            pub fn from_wire(value: &str) -> Option<Self> {
                match value {
                    $($wire => Some(Self::$variant),)+
                    _ => None,
                }
            }

            pub const fn is_read_only(&self) -> bool {
                match self {
                    $(Self::$variant => $read_only),+
                }
            }

            pub fn wire_values() -> Vec<&'static str> {
                Self::ALL
                    .iter()
                    .copied()
                    .map(Self::wire_name)
                    .collect()
            }

            pub fn read_only_wire_values() -> Vec<&'static str> {
                Self::ALL
                    .iter()
                    .copied()
                    .filter(Self::is_read_only)
                    .map(Self::wire_name)
                    .collect()
            }
        }
    };
}

define_recovery_actions!(
    (Retry, "retry", false),
    (RequestGrant, "requestGrant", false),
    (OpenSafetyPage, "openSafetyPage", true),
    (Reload, "reload", false),
    (Compare, "compare", true),
    (Overwrite, "overwrite", false),
    (SaveAs, "saveAs", false),
    (OpenExternal, "openExternal", true),
);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AppErrorDetails {
    Path {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
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
        #[ts(optional)]
        field: Option<String>,
        reason: String,
    },
    Operation {
        operation_id: OperationId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
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
        #[ts(optional)]
        display_target: Option<String>,
        owner: AssetOwner,
    },
    Io {
        operation: IoOperation,
        cause: IoFailureCause,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        display_path: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum GrantPurpose {
    ResourceResolution,
    AssetDirectory,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum IoOperation {
    Read,
    Write,
    Flush,
    Rename,
    Remove,
    Stat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventEnvelope<T> {
    pub api_version: ApiVersion,
    pub event_id: EventId,
    pub event_type: String,
    pub emitted_at: String,
    pub scope: EventScope,
    pub sequence: JsSafeU64,
    pub payload: T,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFilesChanged {
    pub generation_hint: JsSafeU64,
    pub overflow: bool,
    pub changes: Vec<WorkspaceFileChange>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RenameConfidence {
    Certain,
    Likely,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCapabilityChanged {
    pub workspace_id: WorkspaceId,
    pub previous_epoch: JsSafeU64,
    pub capability_epoch: JsSafeU64,
    pub state: CapabilityState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<AppError>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityState {
    Ready,
    Revoked,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[doc(hidden)]
pub struct ForbiddenWriteId;

impl<'de> Deserialize<'de> for ForbiddenWriteId {
    fn deserialize<D>(_: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Err(D::Error::custom("writeId is forbidden for this provenance"))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[schemars(transform = forbid_external_write_id)]
#[serde(
    tag = "change",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentExternalChanged {
    Modified {
        document_id: DocumentId,
        observed_disk_revision: ExpectedDiskRevision,
        #[serde(flatten)]
        provenance: DocumentChangeProvenance,
    },
    Deleted {
        document_id: DocumentId,
        observed_disk_revision: ExpectedDiskRevision,
        #[serde(flatten)]
        provenance: DocumentChangeProvenance,
    },
    Replaced {
        document_id: DocumentId,
        observed_disk_revision: ExpectedDiskRevision,
        #[serde(flatten)]
        provenance: DocumentChangeProvenance,
    },
    MetadataOnly {
        document_id: DocumentId,
        observed_disk_revision: ExpectedDiskRevision,
        #[serde(flatten)]
        provenance: DocumentChangeProvenance,
    },
    PermissionChanged {
        document_id: DocumentId,
        read_only: bool,
        capability_epoch: JsSafeU64,
        source: ExternalChangeSource,
        #[serde(default, rename = "writeId", skip_serializing)]
        #[schemars(skip)]
        #[ts(skip)]
        forbidden_write_id: ForbiddenWriteId,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        error: Option<Box<AppError>>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[schemars(transform = forbid_external_write_id)]
#[serde(
    tag = "source",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DocumentChangeProvenance {
    External {
        #[serde(default, rename = "writeId", skip_serializing)]
        #[schemars(skip)]
        #[ts(skip)]
        forbidden_write_id: ForbiddenWriteId,
    },
    OwnWrite {
        write_id: String,
    },
}

fn forbid_external_write_id(schema: &mut Schema) {
    fn has_const_property(
        object: &serde_json::Map<String, serde_json::Value>,
        property: &str,
        expected: &str,
    ) -> bool {
        object
            .get("properties")
            .and_then(serde_json::Value::as_object)
            .and_then(|properties| properties.get(property))
            .and_then(|schema| schema.get("const"))
            .and_then(serde_json::Value::as_str)
            == Some(expected)
    }

    fn visit(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(object) => {
                if has_const_property(object, "source", "external")
                    || has_const_property(object, "change", "permissionChanged")
                {
                    object.insert(
                        "not".to_owned(),
                        serde_json::json!({ "required": ["writeId"] }),
                    );
                }
                for child in object.values_mut() {
                    visit(child);
                }
            }
            serde_json::Value::Array(values) => {
                for child in values {
                    visit(child);
                }
            }
            _ => {}
        }
    }

    let Some(object) = schema.as_object_mut() else {
        return;
    };
    for value in object.values_mut() {
        visit(value);
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ExternalChangeSource {
    External,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
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
        resource: MarkdownResourceRef,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NativeOpenResourcesRequested {
    pub native_request_id: String,
    pub source: NativeOpenSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub origin_pane_id: Option<PaneId>,
    pub targets: Vec<NativeOpenTarget>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum NativeOpenSource {
    Launch,
    Finder,
    DragDrop,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskProgress {
    pub operation_id: OperationId,
    pub phase: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub completed_units: Option<JsSafeU64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub total_units: Option<JsSafeU64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub message_key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskFinished {
    pub operation_id: OperationId,
    pub outcome: TaskOutcome,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<AppError>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum TaskOutcome {
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DerivedResultKey {
    pub document_id: DocumentId,
    pub session_revision: SessionRevision,
    pub producer_version: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ConflictResolutionRequest, ResourceResolutionWithoutGrant};

    #[test]
    fn core_001_session_revision_serializes_as_number() {
        let value =
            serde_json::to_value(SessionRevision(JsSafeU64(7))).expect("revision serializes");
        assert_eq!(value, serde_json::json!(7));
    }

    #[test]
    fn contract_003_core_001_exact_wire_integers_reject_unsafe_json_numbers() {
        let maximum: SessionRevision =
            serde_json::from_value(serde_json::json!(JS_MAX_SAFE_INTEGER))
                .expect("Number.MAX_SAFE_INTEGER is accepted");
        assert_eq!(maximum, SessionRevision(JsSafeU64(JS_MAX_SAFE_INTEGER)));

        assert!(serde_json::from_value::<SessionRevision>(serde_json::json!(
            JS_MAX_SAFE_INTEGER + 1
        ))
        .is_err());
        assert!(serde_json::to_value(SessionRevision(JsSafeU64(JS_MAX_SAFE_INTEGER + 1))).is_err());

        let envelope = |sequence: serde_json::Value| {
            serde_json::json!({
                "apiVersion": "1.0",
                "eventId": "fixture-event",
                "eventType": "task.progress",
                "emittedAt": "2030-01-01T00:00:00Z",
                "scope": { "kind": "operation", "operationId": "fixture-operation" },
                "sequence": sequence,
                "payload": {}
            })
        };
        assert!(
            serde_json::from_value::<EventEnvelope<serde_json::Value>>(envelope(
                serde_json::json!(-1)
            ))
            .is_err()
        );
        assert!(
            serde_json::from_value::<EventEnvelope<serde_json::Value>>(envelope(
                serde_json::json!(1.5)
            ))
            .is_err()
        );
        assert!(
            serde_json::from_value::<EventEnvelope<serde_json::Value>>(envelope(
                serde_json::json!(JS_MAX_SAFE_INTEGER + 1)
            ))
            .is_err()
        );
    }

    #[test]
    fn sec_001_unknown_error_code_is_preserved() {
        let error = AppError {
            code: AppErrorCode("ERR_FUTURE_READ_ONLY".to_owned()),
            message: "Unsupported future error".to_owned(),
            message_key: None,
            retryable: false,
            correlation_id: "correlation-1".to_owned(),
            recovery_actions: None,
            details: None,
        };

        let encoded = serde_json::to_string(&error).expect("error serializes");
        let decoded: AppError = serde_json::from_str(&encoded).expect("error deserializes");
        assert_eq!(decoded.code.0, "ERR_FUTURE_READ_ONLY");
    }

    #[test]
    fn contract_003_app_error_code_is_non_empty_on_both_serde_directions() {
        assert!(serde_json::from_value::<AppErrorCode>(serde_json::json!("")).is_err());
        assert!(serde_json::to_value(AppErrorCode(String::new())).is_err());
        assert_eq!(
            serde_json::from_value::<AppErrorCode>(serde_json::json!("ERR_FUTURE"))
                .expect("unknown non-empty codes remain forward readable")
                .0,
            "ERR_FUTURE"
        );
    }

    #[test]
    fn contract_003_unknown_error_code_keeps_only_read_only_recovery_actions() {
        let decoded: AppError = serde_json::from_value(serde_json::json!({
            "code": "ERR_FUTURE_READ_ONLY",
            "message": "Future error",
            "retryable": false,
            "correlationId": "fixture-correlation",
            "recoveryActions": ["overwrite", "openSafetyPage", "futureAction"]
        }))
        .expect("unknown error remains readable");

        assert_eq!(decoded.code.0, "ERR_FUTURE_READ_ONLY");
        assert_eq!(
            decoded.recovery_actions,
            Some(vec![RecoveryAction::OpenSafetyPage])
        );

        let unsafe_outbound = AppError {
            code: AppErrorCode("ERR_FUTURE_READ_ONLY".to_owned()),
            message: "Future error".to_owned(),
            message_key: None,
            retryable: false,
            correlation_id: "fixture-correlation".to_owned(),
            recovery_actions: Some(vec![
                RecoveryAction::Overwrite,
                RecoveryAction::OpenSafetyPage,
            ]),
            details: None,
        };
        let encoded = serde_json::to_value(unsafe_outbound).expect("error serializes safely");
        assert_eq!(
            encoded["recoveryActions"],
            serde_json::json!(["openSafetyPage"])
        );
    }

    #[test]
    fn contract_003_app_error_details_and_recovery_registry_follow_serde() {
        assert!(serde_json::from_value::<AppError>(serde_json::json!({
            "code": "ERR_INVALID_REQUEST",
            "message": "Invalid details",
            "retryable": false,
            "correlationId": "fixture-correlation",
            "details": { "kind": "notARealDetailsVariant" }
        }))
        .is_err());

        let wire_values = RecoveryAction::ALL
            .iter()
            .copied()
            .map(|action| serde_json::to_value(action).expect("action serializes"))
            .collect::<Vec<_>>();
        assert_eq!(
            wire_values,
            serde_json::json!(RecoveryAction::wire_values())
                .as_array()
                .expect("wire registry is an array")
                .to_owned()
        );
        assert_eq!(
            RecoveryAction::read_only_wire_values(),
            vec!["openSafetyPage", "compare", "openExternal"]
        );
    }

    #[test]
    fn contract_003_unknown_write_action_reaches_real_request_decoder_and_fails() {
        let request = serde_json::json!({
            "apiVersion": "1.0",
            "requestId": "fixture-request",
            "payload": {
                "action": "futureDestructiveAction",
                "documentId": "fixture-document",
                "content": "# must not be written"
            }
        });

        assert!(
            serde_json::from_value::<CommandRequest<ConflictResolutionRequest>>(request).is_err()
        );
    }

    #[test]
    fn contract_002_required_nullable_is_not_an_optional_wire_field() {
        assert!(
            serde_json::from_value::<PersistenceState>(serde_json::json!({
                "kind": "missing"
            }))
            .is_err()
        );

        let explicit_null: PersistenceState = serde_json::from_value(serde_json::json!({
            "kind": "missing",
            "lastKnown": null
        }))
        .expect("explicit null is a valid required lastKnown value");
        assert_eq!(
            explicit_null,
            PersistenceState::Missing {
                last_known: RequiredNullable(None)
            }
        );
    }

    #[test]
    fn contract_003_native_document_open_rejects_non_markdown_resources() {
        let asset_target = serde_json::json!({
            "kind": "document",
            "resource": {
                "kind": "asset",
                "scope": { "kind": "document", "documentId": "fixture-document" },
                "relativePath": "assets/fixture.png"
            }
        });
        assert!(serde_json::from_value::<NativeOpenTarget>(asset_target).is_err());

        let invalid_outbound = MarkdownResourceRef(ResourceRef::ExternalUrl {
            url: "https://example.invalid".to_owned(),
        });
        assert!(serde_json::to_value(invalid_outbound).is_err());

        let invalid_grant_outcome =
            ResourceResolutionWithoutGrant(ResourceResolution::NeedsGrant {
                grant_request_id: GrantRequestId("fixture-grant-request".to_owned()),
                display_target: "/fixture/outside.md".to_owned(),
                reason: GrantReason::OutsideWorkspace,
            });
        assert!(serde_json::to_value(invalid_grant_outcome).is_err());
    }

    #[test]
    fn contract_003_external_change_rejects_illegal_provenance_states() {
        let own_write_without_id = serde_json::json!({
            "documentId": "fixture-document",
            "change": "modified",
            "observedDiskRevision": { "kind": "absent" },
            "source": "ownWrite"
        });
        assert!(serde_json::from_value::<DocumentExternalChanged>(own_write_without_id).is_err());

        let permission_from_own_write = serde_json::json!({
            "documentId": "fixture-document",
            "change": "permissionChanged",
            "readOnly": true,
            "capabilityEpoch": 4,
            "source": "ownWrite",
            "writeId": "fixture-write"
        });
        assert!(
            serde_json::from_value::<DocumentExternalChanged>(permission_from_own_write).is_err()
        );

        for change in ["modified", "deleted", "replaced", "metadataOnly"] {
            let external_with_write_id = serde_json::json!({
                "documentId": "fixture-document",
                "change": change,
                "observedDiskRevision": { "kind": "absent" },
                "source": "external",
                "writeId": "fixture-write"
            });
            assert!(
                serde_json::from_value::<DocumentExternalChanged>(external_with_write_id).is_err(),
                "{change}/external must reject a present writeId"
            );
        }

        let permission_external_with_write_id = serde_json::json!({
            "documentId": "fixture-document",
            "change": "permissionChanged",
            "readOnly": true,
            "capabilityEpoch": 4,
            "source": "external",
            "writeId": "fixture-write"
        });
        assert!(serde_json::from_value::<DocumentExternalChanged>(
            permission_external_with_write_id
        )
        .is_err());

        let external_with_null_write_id = serde_json::json!({
            "documentId": "fixture-document",
            "change": "modified",
            "observedDiskRevision": { "kind": "absent" },
            "source": "external",
            "writeId": null
        });
        assert!(
            serde_json::from_value::<DocumentExternalChanged>(external_with_null_write_id).is_err()
        );
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
