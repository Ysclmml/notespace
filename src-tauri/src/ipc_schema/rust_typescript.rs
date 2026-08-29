//! TypeScript declarations rendered mechanically from Rust `TS` derives.

use std::collections::BTreeMap;

use crate::domain::*;
use schemars::{schema_for, Schema};
use ts_rs::{Config, TS};

macro_rules! wire_type_registry {
    ($callback:ident) => {
        $callback!(
        plain JsSafeU64,
        plain JsSafeI64,
        plain True,
        plain False,
        plain One,
        plain UnknownValue,
        plain WorkspaceId,
        plain DocumentId,
        plain DocumentSessionId,
        plain DocumentViewId,
        plain DraftId,
        plain TabId,
        plain PaneId,
        plain NavEntryId,
        plain AssetId,
        plain GrantId,
        plain GrantRequestId,
        plain RecoveryId,
        plain RequestId,
        plain OperationId,
        plain EventId,
        plain RelativePath,
        plain RevisionToken,
        plain ContentHash,
        plain SessionRevision,
        plain ApiVersion,
        plain CommandRequest<EmptyRequest>,
        plain CommandSuccess<EmptyRequest>,
        plain CommandFailure,
        union CommandResponse<EmptyRequest>,
        plain Workspace,
        union WorkspaceState,
        plain CaseSensitivity,
        union DocumentLocator,
        union DocumentAnchor,
        union ResourceScope,
        union AssetOwner,
        union ResourceRef,
        union MarkdownResourceRef,
        union RevealTarget,
        plain UnresolvedLink,
        plain LinkKindHint,
        union ResourceResolution,
        plain GrantReason,
        plain ResourcePreviewRequest,
        union ResourcePreviewOutcome,
        plain DiskRevision,
        union ExpectedDiskRevision,
        plain TextEncoding,
        plain LineEnding,
        plain PreferredLineEnding,
        plain DocumentFormat,
        plain DocumentDescriptor,
        plain OpenMode,
        plain PreflightReport,
        plain SafetyBlockedReason,
        plain SafetyBlockedAction,
        plain SafetyBlockedReport,
        plain SafetyBlockedReportKind,
        plain UnsupportedReason,
        plain UnsupportedAction,
        plain UnsupportedReport,
        plain UnsupportedReportKind,
        union SafetyReport,
        plain EditableDocument,
        union DocumentOpenOutcome,
        union DocumentLoadState,
        union DiscardReturnState,
        plain ConflictReason,
        union PersistenceState,
        plain DocumentSession,
        plain SessionLifecycle,
        plain SessionEditIntent,
        union SessionEditResult,
        plain Tab,
        plain TabLifecycle,
        plain NavigationHistory,
        plain NavEntry,
        plain DocumentView,
        plain MountState,
        plain ViewState,
        plain SelectionRange,
        plain ScrollAnchor,
        plain FoldedRange,
        plain BlockLocator,
        plain EditorMode,
        plain OpenDisposition,
        plain NavigationSource,
        plain NavigateIntent,
        union NavigateTarget,
        plain PreviewIntent,
        plain AssetRef,
        union AssetState,
        plain AppErrorCode,
        plain AppError,
        plain RecoveryAction,
        union AppErrorDetails,
        plain GrantPurpose,
        plain IoOperation,
        plain IoFailureCause,
        union EventScope,
        plain EventEnvelope<EmptyRequest>,
        plain WorkspaceFilesChanged,
        union WorkspaceFileChange,
        plain RenameConfidence,
        plain WorkspaceCapabilityChanged,
        plain CapabilityState,
        union DocumentExternalChanged,
        union DocumentChangeProvenance,
        plain ExternalChangeSource,
        union NativeOpenTarget,
        plain NativeOpenResourcesRequested,
        plain NativeOpenSource,
        plain TaskProgress,
        plain TaskFinished,
        plain TaskOutcome,
        plain DerivedResultKey,
        plain EmptyRequest,
        plain Platform,
        plain AppFeatures,
        plain AppLimits,
        plain AppCapabilities,
        plain AppCloseRequest,
        plain AppReconcileOutcome,
        plain AppOpenResourcesAckRequest,
        union AppOpenResourcesAckOutcome,
        plain AppCloseDecision,
        plain AppCloseRespondRequest,
        union AppCloseRespondOutcome,
        plain WorkspacePickRequest,
        union WorkspacePickOutcome,
        plain WorkspaceOpenRequest,
        plain WorkspaceOpenRecentRequest,
        plain WorkspaceOpenOutcome,
        plain WorkspaceCloseRequest,
        plain WorkspaceCloseOutcome,
        union WorkspaceRescanRequest,
        plain WorkspaceEntryKind,
        plain WorkspaceSnapshotEntry,
        plain WorkspaceSnapshotPage,
        union ResourceResolutionWithoutGrant,
        union ResourceGrantOutcome,
        plain ResourceGrantRequest,
        plain DocumentPickRequest,
        union DocumentPickOutcome,
        plain DocumentCreateDraftRequest,
        plain InitialSessionRevisions,
        plain DocumentCreateDraftOutcome,
        plain DocumentOpenRequest,
        plain DocumentSaveReason,
        plain DocumentSaveRequest,
        union DocumentSaveOutcome,
        union AbsentDiskRevision,
        union ConflictResolutionRequest,
        union ConflictResolutionOutcome,
        union SaveAsTarget,
        plain DocumentPrepareSaveAsRequest,
        plain UriReplacement,
        plain RelativeLinkImpact,
        union DocumentPrepareSaveAsOutcome,
        plain DocumentSaveAsRequest,
        union DocumentSaveAsOutcome,
        union DocumentSaveAsStatusOutcome,
        plain PendingSaveAsPhase,
        plain PendingSaveAsSummary,
        union DocumentCompareOutcome,
        union DocumentRepairAction,
        plain DocumentRepairRequest,
        plain DocumentRepairOutcome,
        plain DocumentReloadRequest,
        plain DocumentReadDiskSnapshotRequest,
        plain SaveAsAbortReason,
        plain DocumentSaveAsAbortRequest,
        union DocumentSaveAsAbortOutcome,
        plain DocumentSaveAsStatusRequest,
        plain DocumentSaveAsAckRequest,
        union DocumentSaveAsAckOutcome,
        plain ClipboardImageFormat,
        plain AssetImportClipboardRequest,
        plain AssetGrantReason,
        union AssetImportClipboardOutcome,
        plain AssetReleaseReason,
        plain AssetReleaseRequest,
        plain AssetReleaseOutcome,
        plain CheckpointReason,
        plain SessionCheckpointRequest,
        plain SessionCheckpointOutcome,
        plain SessionDiscardRequest,
        plain DiscardedKind,
        plain SessionDiscardOutcome,
        plain RecoveryDescriptor,
        plain RecoveredEditableDocument,
        union RecoveryInitialPersistence,
        plain RestoredRevisions,
        plain ReconciledSaveAs,
        union RecoveryOpenOutcome,
        plain RecoveryListOutcome,
        plain RecoveryOpenRequest,
        plain RecoveryDiscardRequest,
        plain RecoveryDiscardOutcome,
        plain PaneSnapshot,
        union WindowLayout,
        plain WindowTabSnapshot,
        plain RecentlyClosedTabSnapshot,
        plain SidebarSnapshot,
        plain WindowStateSnapshotV1,
        plain WindowStateSaveRequest,
        plain WindowStateSaveOutcome,
        plain WindowStateLoadOutcome,
        plain TaskCancelRequest,
        union TaskCancelOutcome,
        plain ResourceOpenExternalRequest,
        plain ResourceOpenExternalOutcome,
        plain ResourceRevealRequest,
        plain ResourceRevealOutcome,
            plain RecoverySnapshotFailed,
        );
    };
}

pub fn render_declarations() -> String {
    let config = Config::new();
    let mut output = String::from(
        "export type Brand<T, Name extends string> = T & { readonly __brand: Name };\n\
         export type RequiredNullable<T> = T | null;\n\n",
    );

    macro_rules! declare {
        ($($kind:ident $ty:ty),+ $(,)?) => {
            $(
                output.push_str("export ");
                output.push_str(&<$ty as TS>::decl(&config));
                output.push_str("\n\n");
            )+
        };
    }

    wire_type_registry!(declare);

    output.push_str(
        "export type KnownAppErrorCode = (typeof KNOWN_APP_ERROR_CODES)[number];\n\
         export type UnknownAppErrorCode = Brand<string, \"UnknownAppErrorCode\">;\n\n",
    );
    output
}

pub fn required_union_fixture_schemas() -> BTreeMap<&'static str, Schema> {
    let mut schemas = BTreeMap::new();

    macro_rules! register_one {
        (plain $ty:ty) => {};
        (union $ty:ty) => {
            let name = stringify!($ty)
                .split('<')
                .next()
                .expect("registered Rust type has a name")
                .trim();
            schemas.insert(name, schema_for!($ty));
        };
    }

    macro_rules! register {
        ($($kind:ident $ty:ty),+ $(,)?) => {
            $(register_one!($kind $ty);)+
        };
    }

    wire_type_registry!(register);
    schemas
}

pub fn plain_wire_schemas() -> BTreeMap<&'static str, Schema> {
    let mut schemas = BTreeMap::new();

    macro_rules! register_one {
        (union $ty:ty) => {};
        (plain $ty:ty) => {
            let name = stringify!($ty)
                .split('<')
                .next()
                .expect("registered Rust type has a name")
                .trim();
            let previous = schemas.insert(name, schema_for!($ty));
            assert!(previous.is_none(), "duplicate plain wire type: {name}");
        };
    }

    macro_rules! register {
        ($($kind:ident $ty:ty),+ $(,)?) => {
            $(register_one!($kind $ty);)+
        };
    }

    wire_type_registry!(register);
    schemas
}
