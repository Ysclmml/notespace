//! Executable IPC v1 schema catalog and deterministic artifact generation.
//!
//! Chapter 03 remains the normative prose source until Integration publishes F0.
//! This module is its executable Rust mapping. It intentionally does not register
//! Tauri commands or implement any Phase 1 behavior.

mod typescript;

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{json, Map, Value};

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
}

pub const EVENTS: &[EventSpec] = &[
    EventSpec {
        id: "IPC-EVT-010",
        event_type: "workspace.filesChanged",
        payload_type: "WorkspaceFilesChanged",
    },
    EventSpec {
        id: "IPC-EVT-011",
        event_type: "workspace.capabilityChanged",
        payload_type: "WorkspaceCapabilityChanged",
    },
    EventSpec {
        id: "IPC-EVT-020",
        event_type: "document.externalChanged",
        payload_type: "DocumentExternalChanged",
    },
    EventSpec {
        id: "IPC-EVT-030",
        event_type: "task.progress",
        payload_type: "TaskProgress",
    },
    EventSpec {
        id: "IPC-EVT-031",
        event_type: "task.finished",
        payload_type: "TaskFinished",
    },
    EventSpec {
        id: "IPC-EVT-040",
        event_type: "recovery.snapshotFailed",
        payload_type: "RecoverySnapshotFailed",
    },
    EventSpec {
        id: "IPC-EVT-050",
        event_type: "app.closeRequested",
        payload_type: "AppCloseRequest",
    },
    EventSpec {
        id: "IPC-EVT-060",
        event_type: "app.openResourcesRequested",
        payload_type: "NativeOpenResourcesRequested",
    },
];

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
pub struct VariantSpec {
    pub tag: &'static str,
    pub required_fields: &'static [&'static str],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnionSpec {
    pub name: &'static str,
    pub discriminator: &'static str,
    pub variants: &'static [VariantSpec],
}

macro_rules! variant {
    ($tag:literal $(, $field:literal)*) => {
        VariantSpec { tag: $tag, required_fields: &[$($field),*] }
    };
}

pub const UNION_SPECS: &[UnionSpec] = &[
    UnionSpec {
        name: "CommandResponse",
        discriminator: "ok",
        variants: &[
            variant!("true", "apiVersion", "requestId", "ok", "payload"),
            variant!("false", "apiVersion", "requestId", "ok", "error"),
        ],
    },
    UnionSpec {
        name: "AppOpenResourcesAckOutcome",
        discriminator: "kind",
        variants: &[
            variant!("acknowledged", "kind"),
            variant!("alreadyAcknowledged", "kind"),
            variant!("unknown", "kind"),
        ],
    },
    UnionSpec {
        name: "AppCloseRespondOutcome",
        discriminator: "kind",
        variants: &[
            variant!("cancelled", "kind"),
            variant!("closing", "kind"),
            variant!("alreadyResolved", "kind"),
            variant!("unknown", "kind"),
        ],
    },
    UnionSpec {
        name: "WorkspacePickOutcome",
        discriminator: "kind",
        variants: &[
            variant!("selected", "kind", "grantToken", "displayPath"),
            variant!("cancelled", "kind"),
        ],
    },
    UnionSpec {
        name: "DocumentPickOutcome",
        discriminator: "kind",
        variants: &[
            variant!("selected", "kind", "resource"),
            variant!("cancelled", "kind"),
        ],
    },
    UnionSpec {
        name: "WorkspaceState",
        discriminator: "kind",
        variants: &[
            variant!("opening", "kind"),
            variant!("ready", "kind"),
            variant!("rescanning", "kind", "operationId"),
            variant!("degraded", "kind", "reason"),
            variant!("closing", "kind"),
            variant!("closed", "kind"),
        ],
    },
    UnionSpec {
        name: "DocumentLocator",
        discriminator: "kind",
        variants: &[
            variant!("workspacePath", "kind", "workspaceId", "relativePath"),
            variant!("draft", "kind", "draftId"),
            variant!("grantedFile", "kind", "grantId", "displayName"),
        ],
    },
    UnionSpec {
        name: "DocumentAnchor",
        discriminator: "kind",
        variants: &[
            variant!("heading", "kind", "slug"),
            variant!("block", "kind", "blockId"),
            variant!("sourcePosition", "kind", "line"),
        ],
    },
    UnionSpec {
        name: "ResourceScope",
        discriminator: "kind",
        variants: &[
            variant!("workspace", "kind", "workspaceId"),
            variant!("document", "kind", "documentId"),
            variant!("draft", "kind", "draftId"),
        ],
    },
    UnionSpec {
        name: "AssetOwner",
        discriminator: "kind",
        variants: &[
            variant!("document", "kind", "documentId"),
            variant!("draft", "kind", "draftId"),
        ],
    },
    UnionSpec {
        name: "ResourceRef",
        discriminator: "kind",
        variants: &[
            variant!("markdown", "kind", "locator"),
            variant!("asset", "kind", "scope", "relativePath"),
            variant!("externalUrl", "kind", "url"),
            variant!("virtual", "kind", "providerId", "resourceId"),
        ],
    },
    UnionSpec {
        name: "RevealTarget",
        discriminator: "kind",
        variants: &[
            variant!("workspaceRoot", "kind", "workspaceId"),
            variant!("workspaceEntry", "kind", "workspaceId", "relativePath"),
            variant!("grantedFile", "kind", "grantId"),
            variant!("asset", "kind", "scope", "relativePath"),
        ],
    },
    UnionSpec {
        name: "ResourceResolution",
        discriminator: "kind",
        variants: &[
            variant!("resolved", "kind", "resource"),
            variant!(
                "needsGrant",
                "kind",
                "grantRequestId",
                "displayTarget",
                "reason"
            ),
            variant!("missing", "kind", "displayTarget"),
            variant!("unsupported", "kind", "displayTarget"),
            variant!("invalid", "kind", "error"),
        ],
    },
    UnionSpec {
        name: "ResourcePreviewOutcome",
        discriminator: "kind",
        variants: &[
            variant!("text", "kind", "resource", "title", "excerpt", "truncated"),
            variant!("safetyBlocked", "kind", "resource", "report"),
            variant!("unsupported", "kind", "resource", "report"),
        ],
    },
    UnionSpec {
        name: "ExpectedDiskRevision",
        discriminator: "kind",
        variants: &[
            variant!("present", "kind", "revision"),
            variant!("absent", "kind"),
        ],
    },
    UnionSpec {
        name: "DocumentLoadState",
        discriminator: "kind",
        variants: &[
            variant!("loading", "kind", "resource", "operationId"),
            variant!(
                "safetyBlocked",
                "kind",
                "resource",
                "descriptor",
                "report",
                "repairToken",
                "diskRevision"
            ),
            variant!("unsupported", "kind", "resource", "report"),
            variant!("failed", "kind", "resource", "error"),
        ],
    },
    UnionSpec {
        name: "DiscardReturnState",
        discriminator: "kind",
        variants: &[
            variant!("dirty", "kind"),
            variant!("conflict", "kind", "expected", "actual", "reason"),
            variant!("missing", "kind", "lastKnown"),
            variant!("saveError", "kind", "error"),
            variant!("reloadError", "kind", "error"),
        ],
    },
    UnionSpec {
        name: "PersistenceState",
        discriminator: "kind",
        variants: &[
            variant!("clean", "kind"),
            variant!("dirty", "kind"),
            variant!("reloading", "kind", "operationId", "previousDiskRevision"),
            variant!(
                "saving",
                "kind",
                "operationId",
                "snapshotSessionRevision",
                "expectedDiskRevision",
                "editOccurredAfterSnapshot"
            ),
            variant!("conflict", "kind", "expected", "actual", "reason"),
            variant!("missing", "kind", "lastKnown"),
            variant!("saveError", "kind", "error"),
            variant!("reloadError", "kind", "error"),
            variant!(
                "discarding",
                "kind",
                "operationId",
                "discardIntentId",
                "snapshotSessionRevision",
                "previous"
            ),
        ],
    },
    UnionSpec {
        name: "SessionEditResult",
        discriminator: "kind",
        variants: &[
            variant!("applied", "kind", "newRevision"),
            variant!("stale", "kind", "actualRevision"),
            variant!("rejected", "kind", "error"),
        ],
    },
    UnionSpec {
        name: "AssetState",
        discriminator: "kind",
        variants: &[
            variant!("staging", "kind"),
            variant!("committing", "kind", "operationId"),
            variant!("committed", "kind"),
            variant!("orphaned", "kind", "retainUntilUnixMs"),
            variant!("deleted", "kind"),
            variant!("failed", "kind", "error"),
        ],
    },
    UnionSpec {
        name: "SafetyReport",
        discriminator: "kind",
        variants: &[
            variant!(
                "safetyBlocked",
                "kind",
                "sizeBytes",
                "maxLineBytes",
                "hasUtf8Bom",
                "detectedDataImageCount",
                "reasons",
                "allowedActions"
            ),
            variant!(
                "unsupported",
                "kind",
                "sizeBytes",
                "maxLineBytes",
                "hasUtf8Bom",
                "detectedDataImageCount",
                "reasons",
                "allowedActions"
            ),
        ],
    },
    UnionSpec {
        name: "WorkspaceRescanRequest",
        discriminator: "kind",
        variants: &[
            variant!("start", "kind", "workspaceId", "knownGeneration"),
            variant!("next", "kind", "workspaceId", "scanId", "cursor"),
        ],
    },
    UnionSpec {
        name: "ResourceGrantOutcome",
        discriminator: "kind",
        variants: &[
            variant!("resourceResolved", "kind", "grantRequestId", "resolution"),
            variant!(
                "assetDirectoryGranted",
                "kind",
                "grantRequestId",
                "owner",
                "pasteIntentId"
            ),
            variant!("cancelled", "kind", "grantRequestId"),
        ],
    },
    UnionSpec {
        name: "DocumentOpenOutcome",
        discriminator: "kind",
        variants: &[
            variant!("editable", "kind", "document"),
            variant!(
                "safetyBlocked",
                "kind",
                "descriptor",
                "report",
                "repairToken",
                "diskRevision"
            ),
            variant!("unsupported", "kind", "report"),
        ],
    },
    UnionSpec {
        name: "DocumentSaveOutcome",
        discriminator: "kind",
        variants: &[
            variant!(
                "saved",
                "kind",
                "documentId",
                "savedSessionRevision",
                "newDiskRevision",
                "writeId",
                "bytesWritten"
            ),
            variant!(
                "noop",
                "kind",
                "documentId",
                "savedSessionRevision",
                "diskRevision"
            ),
        ],
    },
    UnionSpec {
        name: "ConflictResolutionRequest",
        discriminator: "action",
        variants: &[
            variant!("reload", "action", "documentId", "observedDiskRevision"),
            variant!(
                "overwrite",
                "action",
                "documentId",
                "content",
                "format",
                "snapshotSessionRevision",
                "observedDiskRevision"
            ),
            variant!(
                "recreate",
                "action",
                "documentId",
                "content",
                "format",
                "snapshotSessionRevision",
                "observedDiskRevision"
            ),
        ],
    },
    UnionSpec {
        name: "ConflictResolutionOutcome",
        discriminator: "kind",
        variants: &[
            variant!("reloadChecked", "kind", "outcome"),
            variant!("saved", "kind", "result"),
        ],
    },
    UnionSpec {
        name: "DocumentPrepareSaveAsOutcome",
        discriminator: "kind",
        variants: &[
            variant!("cancelled", "kind", "saveAsIntentId"),
            variant!("sameDocument", "kind", "saveAsIntentId", "documentId"),
            variant!("targetAlreadyOpen", "kind", "saveAsIntentId", "target"),
            variant!(
                "prepared",
                "kind",
                "saveAsIntentId",
                "saveAsToken",
                "newDescriptor",
                "targetExpectedDiskRevision",
                "uriReplacements",
                "relativeLinkImpact"
            ),
        ],
    },
    UnionSpec {
        name: "DocumentSaveAsAbortOutcome",
        discriminator: "kind",
        variants: &[
            variant!("aborted", "kind"),
            variant!("alreadyAborted", "kind"),
            variant!("unknown", "kind"),
        ],
    },
    UnionSpec {
        name: "DocumentSaveAsStatusOutcome",
        discriminator: "kind",
        variants: &[
            variant!("unknown", "kind", "saveAsIntentId"),
            variant!("prepared", "kind", "saveAsIntentId", "documentId"),
            variant!("committing", "kind", "saveAsIntentId", "documentId"),
            variant!("committed", "kind", "outcome"),
            variant!("rolledBack", "kind", "saveAsIntentId", "documentId"),
            variant!("acknowledged", "kind", "saveAsIntentId", "documentId"),
        ],
    },
    UnionSpec {
        name: "DocumentSaveAsAckOutcome",
        discriminator: "kind",
        variants: &[
            variant!("acknowledged", "kind"),
            variant!("alreadyAcknowledged", "kind"),
            variant!("unknown", "kind"),
        ],
    },
    UnionSpec {
        name: "DocumentCompareOutcome",
        discriminator: "kind",
        variants: &[
            variant!("snapshot", "kind", "content", "format", "diskRevision"),
            variant!("safetyBlocked", "kind", "report", "diskRevision"),
            variant!("unsupported", "kind", "report", "diskRevision"),
        ],
    },
    UnionSpec {
        name: "DocumentRepairAction",
        discriminator: "kind",
        variants: &[
            variant!("extractDataImages", "kind", "assetDirectoryName"),
            variant!("deleteDataImages", "kind"),
        ],
    },
    UnionSpec {
        name: "AssetImportClipboardOutcome",
        discriminator: "kind",
        variants: &[
            variant!("imported", "kind", "asset"),
            variant!(
                "needsGrant",
                "kind",
                "grantRequestId",
                "owner",
                "pasteIntentId",
                "displayTarget",
                "reason"
            ),
        ],
    },
    UnionSpec {
        name: "RecoveryInitialPersistence",
        discriminator: "kind",
        variants: &[
            variant!("clean", "kind"),
            variant!("dirty", "kind"),
            variant!("conflict", "kind", "expected", "actual", "reason"),
        ],
    },
    UnionSpec {
        name: "RecoveryOpenOutcome",
        discriminator: "kind",
        variants: &[
            variant!(
                "editable",
                "kind",
                "recovery",
                "document",
                "restoredRevisions",
                "initialPersistence"
            ),
            variant!("safetyBlocked", "kind", "descriptor", "report"),
        ],
    },
    UnionSpec {
        name: "WindowLayout",
        discriminator: "kind",
        variants: &[
            variant!("single", "kind", "pane", "focusedPaneId"),
            variant!("split", "kind", "left", "right", "ratio", "focusedPaneId"),
        ],
    },
    UnionSpec {
        name: "EventScope",
        discriminator: "kind",
        variants: &[
            variant!("app", "kind"),
            variant!("workspace", "kind", "workspaceId"),
            variant!("document", "kind", "documentId"),
            variant!("operation", "kind", "operationId"),
        ],
    },
    UnionSpec {
        name: "WorkspaceFileChange",
        discriminator: "kind",
        variants: &[
            variant!("created", "kind", "relativePath"),
            variant!("modified", "kind", "relativePath"),
            variant!("removed", "kind", "relativePath"),
            variant!("renamed", "kind", "from", "to", "confidence"),
        ],
    },
    UnionSpec {
        name: "DocumentChangeProvenance",
        discriminator: "source",
        variants: &[
            variant!("external", "source"),
            variant!("ownWrite", "source", "writeId"),
        ],
    },
    UnionSpec {
        name: "DocumentExternalChanged",
        discriminator: "change",
        variants: &[
            variant!(
                "modified",
                "documentId",
                "change",
                "observedDiskRevision",
                "source"
            ),
            variant!(
                "deleted",
                "documentId",
                "change",
                "observedDiskRevision",
                "source"
            ),
            variant!(
                "replaced",
                "documentId",
                "change",
                "observedDiskRevision",
                "source"
            ),
            variant!(
                "metadataOnly",
                "documentId",
                "change",
                "observedDiskRevision",
                "source"
            ),
            variant!(
                "permissionChanged",
                "documentId",
                "change",
                "readOnly",
                "capabilityEpoch",
                "source"
            ),
        ],
    },
    UnionSpec {
        name: "NativeOpenTarget",
        discriminator: "kind",
        variants: &[
            variant!("workspace", "kind", "grantToken", "displayPath"),
            variant!("document", "kind", "resource"),
        ],
    },
    UnionSpec {
        name: "AppErrorDetails",
        discriminator: "kind",
        variants: &[
            variant!("path", "kind"),
            variant!("conflict", "kind", "expected", "actual"),
            variant!("safety", "kind", "report"),
            variant!("validation", "kind", "reason"),
            variant!("operation", "kind", "operationId"),
            variant!(
                "grant",
                "kind",
                "grantRequestId",
                "purpose",
                "displayTarget"
            ),
            variant!("assetWrite", "kind", "cause", "owner"),
            variant!("io", "kind", "operation", "cause"),
        ],
    },
    UnionSpec {
        name: "TaskCancelOutcome",
        discriminator: "kind",
        variants: &[
            variant!("requested", "kind"),
            variant!("notFound", "kind"),
            variant!("pastCommitPoint", "kind"),
        ],
    },
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
    let unions = serde_json::to_string_pretty(UNION_SPECS).expect("union schema serializes");

    format!(
        "// @generated by src-tauri/src/bin/generate_ipc.rs from src-tauri/src/ipc_schema.rs.\n// Do not edit by hand. Canonical semantics: docs/design/03-domain-model-and-contracts.md.\n\n{}\n\nexport const IPC_COMMAND_SPECS = {} as const;\n\nexport const IPC_EVENT_SPECS = {} as const;\n\nexport const KNOWN_APP_ERROR_CODES = {} as const;\n\nexport const KNOWN_WRITE_ACTIONS = {} as const;\n\nexport const CONTRACT_UNION_SPECS = {} as const;\n\n{}",
        typescript::TYPESCRIPT_BINDINGS.trim(),
        commands,
        events,
        errors,
        writes,
        unions,
        typescript::TYPESCRIPT_RUNTIME.trim(),
    )
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
    let unions = UNION_SPECS
        .iter()
        .map(|union| {
            let fixtures = union
                .variants
                .iter()
                .map(|variant| shape_fixture(union.discriminator, variant))
                .collect::<Vec<_>>();
            (union.name, fixtures)
        })
        .collect::<BTreeMap<_, _>>();
    let fixture_set = UnionFixtureSet {
        schema_version: 1,
        api_version: IPC_API_VERSION,
        generated_by: "src-tauri/src/ipc_schema.rs",
        unions,
    };
    let mut rendered = serde_json::to_string_pretty(&fixture_set).expect("fixtures serialize");
    rendered.push('\n');
    rendered
}

fn shape_fixture(discriminator: &str, variant: &VariantSpec) -> Value {
    let mut fields = Map::new();
    for field in variant.required_fields {
        fields.insert((*field).to_owned(), placeholder(field));
    }
    fields.insert(
        discriminator.to_owned(),
        if discriminator == "ok" {
            Value::Bool(variant.tag == "true")
        } else {
            Value::String(variant.tag.to_owned())
        },
    );
    Value::Object(fields)
}

fn placeholder(field: &str) -> Value {
    if field.starts_with("is")
        || matches!(
            field,
            "ok" | "pinned"
                | "readOnly"
                | "truncated"
                | "overflow"
                | "complete"
                | "hasUtf8Bom"
                | "editOccurredAfterSnapshot"
        )
    {
        return Value::Bool(false);
    }
    if field.ends_with("Bytes")
        || field.ends_with("Revision")
        || field.ends_with("Generation")
        || field.ends_with("Epoch")
        || field.ends_with("Units")
        || field.ends_with("At")
        || field.ends_with("AtUnixMs")
        || matches!(
            field,
            "line" | "column" | "sequence" | "bytesWritten" | "ratio"
        )
    {
        return json!(1);
    }
    if field.ends_with("s") || matches!(field, "reasons" | "allowedActions" | "uriReplacements") {
        return json!([]);
    }
    if field == "kind" || field == "action" {
        return Value::Null;
    }
    if matches!(
        field,
        "resource"
            | "target"
            | "locator"
            | "scope"
            | "owner"
            | "descriptor"
            | "report"
            | "error"
            | "format"
            | "diskRevision"
            | "expected"
            | "actual"
            | "previous"
            | "outcome"
            | "result"
            | "document"
            | "recovery"
            | "restoredRevisions"
            | "initialPersistence"
            | "pane"
            | "left"
            | "right"
            | "payload"
            | "resolution"
            | "newDiskRevision"
            | "targetExpectedDiskRevision"
    ) {
        return json!({});
    }
    Value::String("synthetic".to_owned())
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
            if type_name != "EmptyRequest" && !typescript_has_declaration(type_name) {
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

    for union in UNION_SPECS {
        let generated_declaration = generated_union_declaration(union.name)?;
        for variant in union.variants {
            if !CANONICAL_CONTRACT_DOCUMENT.contains(variant.tag) {
                return Err(format!(
                    "{}.{} tag is absent from canonical chapter 03",
                    union.name, variant.tag
                ));
            }
            if !generated_declaration.contains(variant.tag) {
                return Err(format!(
                    "generated {} declaration omits canonical tag {}",
                    union.name, variant.tag
                ));
            }
            for field in variant.required_fields {
                if !CANONICAL_CONTRACT_DOCUMENT.contains(field) {
                    return Err(format!(
                        "{}.{} field {field} is absent from canonical chapter 03",
                        union.name, variant.tag
                    ));
                }
                if !generated_declaration.contains(field) {
                    return Err(format!(
                        "generated {} declaration omits canonical field {field}",
                        union.name
                    ));
                }
            }
        }
    }
    Ok(())
}

fn typescript_has_declaration(name: &str) -> bool {
    typescript::TYPESCRIPT_BINDINGS.contains(&format!("export type {name}"))
        || typescript::TYPESCRIPT_BINDINGS.contains(&format!("export interface {name}"))
}

fn generated_union_declaration(name: &str) -> Result<&'static str, String> {
    if name == "SafetyReport" {
        let start = typescript::TYPESCRIPT_BINDINGS
            .find("export interface PreflightReport")
            .ok_or_else(|| "generated PreflightReport declaration is missing".to_owned())?;
        let end = typescript::TYPESCRIPT_BINDINGS[start..]
            .find("export type OpenMode")
            .map(|offset| start + offset)
            .ok_or_else(|| "generated safety report declarations are unterminated".to_owned())?;
        return Ok(&typescript::TYPESCRIPT_BINDINGS[start..end]);
    }

    let type_marker = format!("export type {name}");
    let interface_marker = format!("export interface {name}");
    let start = typescript::TYPESCRIPT_BINDINGS
        .find(&type_marker)
        .or_else(|| typescript::TYPESCRIPT_BINDINGS.find(&interface_marker))
        .ok_or_else(|| format!("generated TypeScript source has no declaration for {name}"))?;
    let after_start = start + 1;
    let end = typescript::TYPESCRIPT_BINDINGS[after_start..]
        .find("\nexport ")
        .map(|offset| after_start + offset)
        .unwrap_or(typescript::TYPESCRIPT_BINDINGS.len());
    Ok(&typescript::TYPESCRIPT_BINDINGS[start..end])
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
    fn contract_002_every_union_variant_has_a_shape_fixture() {
        let rendered = render_union_fixtures();
        let fixtures: Value = serde_json::from_str(&rendered).expect("fixture JSON parses");
        for union in UNION_SPECS {
            let fixture_variants = fixtures["unions"][union.name]
                .as_array()
                .expect("union fixture list exists");
            assert_eq!(
                fixture_variants.len(),
                union.variants.len(),
                "{}",
                union.name
            );
            for (fixture, variant) in fixture_variants.iter().zip(union.variants) {
                for field in variant.required_fields {
                    assert!(
                        fixture.get(field).is_some(),
                        "{}.{} missing {field}",
                        union.name,
                        variant.tag
                    );
                }
            }
        }
    }

    #[test]
    fn contract_003_unknown_codes_are_not_promoted_to_known_or_write_actions() {
        assert!(!KNOWN_APP_ERROR_CODES.contains(&"ERR_FUTURE_WRITE"));
        assert!(!KNOWN_WRITE_ACTIONS.contains(&"futureDestructiveAction"));
    }
}
