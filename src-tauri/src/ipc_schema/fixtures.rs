//! Concrete serde fixtures for every IPC v1 discriminated union.
//!
//! These values are deliberately constructed as Rust variants and only then
//! serialized. There is no parallel list of discriminator strings or required
//! fields for a schema change to bypass.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::Value;

use crate::domain::*;

pub fn concrete_union_fixtures() -> BTreeMap<&'static str, Vec<Value>> {
    let mut unions = BTreeMap::new();

    macro_rules! add {
        ($name:ident, [$($variant:expr),+ $(,)?]) => {
            unions.insert(stringify!($name), serialized(vec![$($variant),+]));
        };
    }

    add!(
        CommandResponse,
        [
            CommandResponse::Success(CommandSuccess {
                api_version: ApiVersion::V1,
                request_id: request_id(),
                ok: True,
                payload: EmptyRequest {},
            }),
            CommandResponse::Failure(Box::new(CommandFailure {
                api_version: ApiVersion::V1,
                request_id: request_id(),
                ok: False,
                error: app_error(),
            })),
        ]
    );
    add!(
        AppOpenResourcesAckOutcome,
        [
            AppOpenResourcesAckOutcome::Acknowledged,
            AppOpenResourcesAckOutcome::AlreadyAcknowledged,
            AppOpenResourcesAckOutcome::Unknown,
        ]
    );
    add!(
        AppCloseRespondOutcome,
        [
            AppCloseRespondOutcome::Cancelled,
            AppCloseRespondOutcome::Closing,
            AppCloseRespondOutcome::AlreadyResolved,
            AppCloseRespondOutcome::Unknown,
        ]
    );
    add!(
        WorkspacePickOutcome,
        [
            WorkspacePickOutcome::Selected {
                grant_token: "fixture-workspace-grant".to_owned(),
                display_path: "/fixture/workspace".to_owned(),
            },
            WorkspacePickOutcome::Cancelled,
        ]
    );
    add!(
        DocumentPickOutcome,
        [
            DocumentPickOutcome::Selected {
                resource: markdown_ref(),
            },
            DocumentPickOutcome::Cancelled,
        ]
    );
    add!(
        WorkspaceState,
        [
            WorkspaceState::Opening,
            WorkspaceState::Ready,
            WorkspaceState::Rescanning {
                operation_id: operation_id(),
            },
            WorkspaceState::Degraded {
                reason: Box::new(app_error()),
            },
            WorkspaceState::Closing,
            WorkspaceState::Closed,
        ]
    );
    add!(
        DocumentLocator,
        [
            workspace_locator(),
            DocumentLocator::Draft {
                draft_id: draft_id(),
                suggested_name: Some("fixture.md".to_owned()),
            },
            DocumentLocator::GrantedFile {
                grant_id: grant_id(),
                display_name: "fixture.md".to_owned(),
            },
        ]
    );
    add!(
        DocumentAnchor,
        [
            DocumentAnchor::Heading {
                slug: "fixture-heading".to_owned(),
            },
            DocumentAnchor::Block {
                block_id: "fixture-block".to_owned(),
            },
            DocumentAnchor::SourcePosition {
                line: safe(12),
                column: Some(safe(4)),
            },
        ]
    );
    add!(
        ResourceScope,
        [
            ResourceScope::Workspace {
                workspace_id: workspace_id(),
            },
            ResourceScope::Document {
                document_id: document_id(),
            },
            ResourceScope::Draft {
                draft_id: draft_id(),
            },
        ]
    );
    add!(
        AssetOwner,
        [
            AssetOwner::Document {
                document_id: document_id(),
            },
            AssetOwner::Draft {
                draft_id: draft_id(),
            },
        ]
    );
    add!(
        ResourceRef,
        [
            markdown_resource(),
            asset_resource(),
            ResourceRef::ExternalUrl {
                url: "https://example.invalid/fixture".to_owned(),
            },
            ResourceRef::Virtual {
                provider_id: "fixture-provider".to_owned(),
                resource_id: "fixture-resource".to_owned(),
                params: Some(BTreeMap::from([(
                    "fixture-key".to_owned(),
                    "fixture-value".to_owned(),
                )])),
            },
        ]
    );
    add!(
        RevealTarget,
        [
            RevealTarget::WorkspaceRoot {
                workspace_id: workspace_id(),
            },
            RevealTarget::WorkspaceEntry {
                workspace_id: workspace_id(),
                relative_path: relative_path(),
            },
            RevealTarget::GrantedFile {
                grant_id: grant_id(),
            },
            RevealTarget::Asset {
                scope: ResourceScope::Document {
                    document_id: document_id(),
                },
                relative_path: relative_path(),
            },
        ]
    );
    add!(
        ResourceResolution,
        [
            resolved_resource(),
            ResourceResolution::NeedsGrant {
                grant_request_id: grant_request_id(),
                display_target: "/fixture/outside.md".to_owned(),
                reason: GrantReason::OutsideWorkspace,
            },
            ResourceResolution::Missing {
                candidate: Some(markdown_resource()),
                display_target: "missing.md".to_owned(),
            },
            ResourceResolution::Unsupported {
                scheme: Some("fixture".to_owned()),
                display_target: "fixture://resource".to_owned(),
            },
            ResourceResolution::Invalid { error: app_error() },
        ]
    );
    add!(
        ResourcePreviewOutcome,
        [
            ResourcePreviewOutcome::Text {
                resource: markdown_resource(),
                title: "Fixture title".to_owned(),
                excerpt: "Fixture excerpt".to_owned(),
                truncated: false,
                resolved_anchor: Some(DocumentAnchor::Heading {
                    slug: "fixture-heading".to_owned(),
                }),
                disk_revision: Some(expected_present()),
            },
            ResourcePreviewOutcome::SafetyBlocked {
                resource: markdown_resource(),
                report: safety_report(),
            },
            ResourcePreviewOutcome::Unsupported {
                resource: markdown_resource(),
                report: unsupported_report(),
            },
        ]
    );
    add!(
        ExpectedDiskRevision,
        [expected_present(), ExpectedDiskRevision::Absent,]
    );
    add!(
        DocumentLoadState,
        [
            DocumentLoadState::Loading {
                resource: markdown_resource(),
                operation_id: operation_id(),
            },
            DocumentLoadState::SafetyBlocked {
                resource: markdown_resource(),
                descriptor: descriptor(),
                report: safety_report(),
                repair_token: "fixture-repair-token".to_owned(),
                disk_revision: expected_present(),
            },
            DocumentLoadState::Unsupported {
                resource: markdown_resource(),
                descriptor: Some(descriptor()),
                report: unsupported_report(),
            },
            DocumentLoadState::Failed {
                resource: markdown_resource(),
                error: app_error(),
            },
        ]
    );
    add!(
        DiscardReturnState,
        [
            DiscardReturnState::Dirty,
            DiscardReturnState::Conflict {
                expected: expected_present(),
                actual: ExpectedDiskRevision::Absent,
                reason: ConflictReason::Deleted,
            },
            DiscardReturnState::Missing {
                last_known: RequiredNullable(Some(disk_revision())),
            },
            DiscardReturnState::SaveError { error: app_error() },
            DiscardReturnState::ReloadError {
                error: app_error(),
                observed: Some(expected_present()),
            },
        ]
    );
    add!(
        PersistenceState,
        [
            PersistenceState::Clean,
            PersistenceState::Dirty,
            PersistenceState::Reloading {
                operation_id: operation_id(),
                previous_disk_revision: expected_present(),
            },
            PersistenceState::Saving {
                operation_id: operation_id(),
                snapshot_session_revision: session_revision(7),
                expected_disk_revision: expected_present(),
                edit_occurred_after_snapshot: true,
            },
            PersistenceState::Conflict {
                expected: expected_present(),
                actual: ExpectedDiskRevision::Absent,
                reason: ConflictReason::Deleted,
            },
            PersistenceState::Missing {
                last_known: RequiredNullable(None),
            },
            PersistenceState::SaveError { error: app_error() },
            PersistenceState::ReloadError {
                error: app_error(),
                observed: Some(ExpectedDiskRevision::Absent),
            },
            PersistenceState::Discarding {
                operation_id: operation_id(),
                discard_intent_id: "fixture-discard-intent".to_owned(),
                snapshot_session_revision: session_revision(8),
                previous: DiscardReturnState::Missing {
                    last_known: RequiredNullable(Some(disk_revision())),
                },
            },
        ]
    );
    add!(
        SessionEditResult,
        [
            SessionEditResult::Applied {
                new_revision: session_revision(9),
            },
            SessionEditResult::Stale {
                actual_revision: session_revision(10),
            },
            SessionEditResult::Rejected {
                error: Box::new(app_error()),
            },
        ]
    );
    add!(
        AssetState,
        [
            AssetState::Staging,
            AssetState::Committing {
                operation_id: operation_id(),
            },
            AssetState::Committed,
            AssetState::Orphaned {
                retain_until_unix_ms: safe(2_000_000_000_000),
            },
            AssetState::Deleted,
            AssetState::Failed {
                error: Box::new(app_error()),
            },
        ]
    );
    add!(
        SafetyReport,
        [
            SafetyReport::SafetyBlocked(safety_report()),
            SafetyReport::Unsupported(unsupported_report()),
        ]
    );
    add!(
        WorkspaceRescanRequest,
        [
            WorkspaceRescanRequest::Start {
                workspace_id: workspace_id(),
                known_generation: safe(12),
                requested_page_entries: Some(safe(100)),
            },
            WorkspaceRescanRequest::Next {
                workspace_id: workspace_id(),
                scan_id: "fixture-scan".to_owned(),
                cursor: "fixture-cursor".to_owned(),
            },
        ]
    );
    add!(
        ResourceGrantOutcome,
        [
            ResourceGrantOutcome::ResourceResolved {
                grant_request_id: grant_request_id(),
                resolution: Box::new(ResourceResolutionWithoutGrant(resolved_resource())),
            },
            ResourceGrantOutcome::AssetDirectoryGranted {
                grant_request_id: grant_request_id(),
                owner: AssetOwner::Document {
                    document_id: document_id(),
                },
                paste_intent_id: "fixture-paste-intent".to_owned(),
            },
            ResourceGrantOutcome::Cancelled {
                grant_request_id: grant_request_id(),
            },
        ]
    );
    add!(
        DocumentOpenOutcome,
        [
            DocumentOpenOutcome::Editable {
                document: editable_document(),
            },
            DocumentOpenOutcome::SafetyBlocked {
                descriptor: descriptor(),
                report: safety_report(),
                repair_token: "fixture-repair-token".to_owned(),
                disk_revision: expected_present(),
            },
            DocumentOpenOutcome::Unsupported {
                descriptor: Some(descriptor()),
                report: unsupported_report(),
            },
        ]
    );
    add!(
        DocumentSaveOutcome,
        [
            saved_document(),
            DocumentSaveOutcome::Noop {
                document_id: document_id(),
                saved_session_revision: session_revision(11),
                disk_revision: expected_present(),
            },
        ]
    );
    add!(
        ConflictResolutionRequest,
        [
            ConflictResolutionRequest::Reload {
                document_id: document_id(),
                observed_disk_revision: expected_present(),
            },
            ConflictResolutionRequest::Overwrite {
                document_id: document_id(),
                content: "# overwrite fixture".to_owned(),
                format: document_format(),
                snapshot_session_revision: session_revision(12),
                observed_disk_revision: expected_present(),
            },
            ConflictResolutionRequest::Recreate {
                document_id: document_id(),
                content: "# recreate fixture".to_owned(),
                format: document_format(),
                snapshot_session_revision: session_revision(13),
                observed_disk_revision: AbsentDiskRevision::Absent,
            },
        ]
    );
    add!(
        ConflictResolutionOutcome,
        [
            ConflictResolutionOutcome::ReloadChecked {
                outcome: Box::new(DocumentOpenOutcome::Editable {
                    document: editable_document(),
                }),
            },
            ConflictResolutionOutcome::Saved {
                result: saved_document(),
            },
        ]
    );
    add!(
        DocumentPrepareSaveAsOutcome,
        [
            DocumentPrepareSaveAsOutcome::Cancelled {
                save_as_intent_id: "fixture-save-as".to_owned(),
            },
            DocumentPrepareSaveAsOutcome::SameDocument {
                save_as_intent_id: "fixture-save-as".to_owned(),
                document_id: document_id(),
            },
            DocumentPrepareSaveAsOutcome::TargetAlreadyOpen {
                save_as_intent_id: "fixture-save-as".to_owned(),
                target: descriptor(),
            },
            DocumentPrepareSaveAsOutcome::Prepared {
                save_as_intent_id: "fixture-save-as".to_owned(),
                save_as_token: "fixture-save-as-token".to_owned(),
                new_descriptor: descriptor(),
                target_expected_disk_revision: ExpectedDiskRevision::Absent,
                uri_replacements: vec![UriReplacement {
                    asset_id: asset_id(),
                    old_uri: "draft-assets/fixture.png".to_owned(),
                    new_uri: "assets/fixture.png".to_owned(),
                }],
                relative_link_impact: RelativeLinkImpact::BaseDirectoryChanged,
            },
        ]
    );
    add!(
        DocumentSaveAsAbortOutcome,
        [
            DocumentSaveAsAbortOutcome::Aborted,
            DocumentSaveAsAbortOutcome::AlreadyAborted,
            DocumentSaveAsAbortOutcome::Unknown,
        ]
    );
    add!(
        DocumentSaveAsStatusOutcome,
        [
            DocumentSaveAsStatusOutcome::Unknown {
                save_as_intent_id: "fixture-save-as".to_owned(),
            },
            DocumentSaveAsStatusOutcome::Prepared {
                save_as_intent_id: "fixture-save-as".to_owned(),
                document_id: document_id(),
            },
            DocumentSaveAsStatusOutcome::Committing {
                save_as_intent_id: "fixture-save-as".to_owned(),
                document_id: document_id(),
            },
            DocumentSaveAsStatusOutcome::Committed {
                outcome: saved_as_document(),
            },
            DocumentSaveAsStatusOutcome::RolledBack {
                save_as_intent_id: "fixture-save-as".to_owned(),
                document_id: document_id(),
                error: Some(app_error()),
            },
            DocumentSaveAsStatusOutcome::Acknowledged {
                save_as_intent_id: "fixture-save-as".to_owned(),
                document_id: document_id(),
            },
        ]
    );
    add!(
        DocumentSaveAsAckOutcome,
        [
            DocumentSaveAsAckOutcome::Acknowledged,
            DocumentSaveAsAckOutcome::AlreadyAcknowledged,
            DocumentSaveAsAckOutcome::Unknown,
        ]
    );
    add!(
        DocumentCompareOutcome,
        [
            DocumentCompareOutcome::Snapshot {
                content: "# fixture snapshot".to_owned(),
                format: document_format(),
                disk_revision: expected_present(),
            },
            DocumentCompareOutcome::SafetyBlocked {
                report: safety_report(),
                disk_revision: expected_present(),
            },
            DocumentCompareOutcome::Unsupported {
                report: unsupported_report(),
                disk_revision: expected_present(),
            },
        ]
    );
    add!(
        DocumentRepairAction,
        [
            DocumentRepairAction::ExtractDataImages {
                asset_directory_name: "assets".to_owned(),
            },
            DocumentRepairAction::DeleteDataImages,
        ]
    );
    add!(
        AssetImportClipboardOutcome,
        [
            AssetImportClipboardOutcome::Imported { asset: asset_ref() },
            AssetImportClipboardOutcome::NeedsGrant {
                grant_request_id: grant_request_id(),
                owner: AssetOwner::Draft {
                    draft_id: draft_id(),
                },
                paste_intent_id: "fixture-paste-intent".to_owned(),
                display_target: "/fixture/assets".to_owned(),
                reason: AssetGrantReason::AssetDirectory,
            },
        ]
    );
    add!(
        RecoveryInitialPersistence,
        [
            RecoveryInitialPersistence::Clean,
            RecoveryInitialPersistence::Dirty,
            RecoveryInitialPersistence::Conflict {
                expected: expected_present(),
                actual: ExpectedDiskRevision::Absent,
                reason: ConflictReason::Deleted,
            },
        ]
    );
    add!(
        RecoveryOpenOutcome,
        [
            RecoveryOpenOutcome::Editable {
                recovery: recovery_descriptor(),
                document: Box::new(RecoveredEditableDocument {
                    descriptor: descriptor(),
                    content: "# recovered fixture".to_owned(),
                    mode: OpenMode::Normal,
                    format: document_format(),
                    observed_disk_revision: expected_present(),
                    preflight: preflight_report(),
                }),
                restored_revisions: RestoredRevisions {
                    current: session_revision(20),
                    persisted: session_revision(19),
                },
                initial_persistence: RecoveryInitialPersistence::Dirty,
                reconciled_save_as: Some(Box::new(ReconciledSaveAs {
                    save_as_intent_id: "fixture-save-as".to_owned(),
                    outcome: saved_as_document(),
                    requires_ack: True,
                })),
            },
            RecoveryOpenOutcome::SafetyBlocked {
                descriptor: recovery_descriptor(),
                report: safety_report(),
            },
        ]
    );
    add!(
        WindowLayout,
        [
            WindowLayout::Single {
                pane: pane("fixture-pane-left"),
                focused_pane_id: PaneId("fixture-pane-left".to_owned()),
            },
            WindowLayout::Split {
                left: pane("fixture-pane-left"),
                right: pane("fixture-pane-right"),
                ratio: 0.5,
                focused_pane_id: PaneId("fixture-pane-right".to_owned()),
            },
        ]
    );
    add!(
        EventScope,
        [
            EventScope::App,
            EventScope::Workspace {
                workspace_id: workspace_id(),
            },
            EventScope::Document {
                document_id: document_id(),
            },
            EventScope::Operation {
                operation_id: operation_id(),
            },
        ]
    );
    add!(
        WorkspaceFileChange,
        [
            WorkspaceFileChange::Created {
                relative_path: RelativePath("created.md".to_owned()),
            },
            WorkspaceFileChange::Modified {
                relative_path: RelativePath("modified.md".to_owned()),
            },
            WorkspaceFileChange::Removed {
                relative_path: RelativePath("removed.md".to_owned()),
            },
            WorkspaceFileChange::Renamed {
                from: RelativePath("before.md".to_owned()),
                to: RelativePath("after.md".to_owned()),
                confidence: RenameConfidence::Certain,
            },
        ]
    );
    add!(
        DocumentChangeProvenance,
        [
            DocumentChangeProvenance::External,
            DocumentChangeProvenance::OwnWrite {
                write_id: "fixture-write".to_owned(),
            },
        ]
    );
    add!(
        DocumentExternalChanged,
        [
            DocumentExternalChanged::Modified {
                document_id: document_id(),
                observed_disk_revision: expected_present(),
                provenance: DocumentChangeProvenance::External,
            },
            DocumentExternalChanged::Deleted {
                document_id: document_id(),
                observed_disk_revision: ExpectedDiskRevision::Absent,
                provenance: DocumentChangeProvenance::External,
            },
            DocumentExternalChanged::Replaced {
                document_id: document_id(),
                observed_disk_revision: expected_present(),
                provenance: DocumentChangeProvenance::OwnWrite {
                    write_id: "fixture-write".to_owned(),
                },
            },
            DocumentExternalChanged::MetadataOnly {
                document_id: document_id(),
                observed_disk_revision: expected_present(),
                provenance: DocumentChangeProvenance::External,
            },
            DocumentExternalChanged::PermissionChanged {
                document_id: document_id(),
                read_only: true,
                capability_epoch: safe(4),
                source: ExternalChangeSource::External,
                error: Some(Box::new(app_error())),
            },
        ]
    );
    add!(
        NativeOpenTarget,
        [
            NativeOpenTarget::Workspace {
                grant_token: "fixture-workspace-grant".to_owned(),
                display_path: "/fixture/workspace".to_owned(),
            },
            NativeOpenTarget::Document {
                resource: markdown_ref(),
            },
        ]
    );
    add!(
        AppErrorDetails,
        [
            AppErrorDetails::Path {
                display_path: Some("/fixture/document.md".to_owned()),
            },
            AppErrorDetails::Conflict {
                expected: expected_present(),
                actual: ExpectedDiskRevision::Absent,
            },
            AppErrorDetails::Safety {
                report: SafetyReport::SafetyBlocked(safety_report()),
            },
            AppErrorDetails::Validation {
                field: Some("fixtureField".to_owned()),
                reason: "fixture validation reason".to_owned(),
            },
            AppErrorDetails::Operation {
                operation_id: operation_id(),
                phase: Some("fixture-phase".to_owned()),
            },
            AppErrorDetails::Grant {
                grant_request_id: grant_request_id(),
                purpose: GrantPurpose::ResourceResolution,
                display_target: "/fixture/outside.md".to_owned(),
            },
            AppErrorDetails::AssetWrite {
                cause: IoFailureCause::DiskFull,
                display_target: Some("/fixture/assets/fixture.png".to_owned()),
                owner: AssetOwner::Document {
                    document_id: document_id(),
                },
            },
            AppErrorDetails::Io {
                operation: IoOperation::Write,
                cause: IoFailureCause::PermissionRevoked,
                display_path: Some("/fixture/document.md".to_owned()),
            },
        ]
    );
    add!(
        TaskCancelOutcome,
        [
            TaskCancelOutcome::Requested,
            TaskCancelOutcome::NotFound,
            TaskCancelOutcome::PastCommitPoint,
        ]
    );

    unions
}

fn serialized<T: Serialize>(values: Vec<T>) -> Vec<Value> {
    values
        .into_iter()
        .map(|value| serde_json::to_value(value).expect("concrete IPC fixture serializes"))
        .collect()
}

fn safe(value: u64) -> JsSafeU64 {
    JsSafeU64(value)
}

fn session_revision(value: u64) -> SessionRevision {
    SessionRevision(safe(value))
}

fn workspace_id() -> WorkspaceId {
    WorkspaceId("fixture-workspace".to_owned())
}

fn document_id() -> DocumentId {
    DocumentId("fixture-document".to_owned())
}

fn draft_id() -> DraftId {
    DraftId("fixture-draft".to_owned())
}

fn grant_id() -> GrantId {
    GrantId("fixture-grant".to_owned())
}

fn grant_request_id() -> GrantRequestId {
    GrantRequestId("fixture-grant-request".to_owned())
}

fn request_id() -> RequestId {
    RequestId("fixture-request".to_owned())
}

fn operation_id() -> OperationId {
    OperationId("fixture-operation".to_owned())
}

fn asset_id() -> AssetId {
    AssetId("fixture-asset".to_owned())
}

fn relative_path() -> RelativePath {
    RelativePath("docs/fixture.md".to_owned())
}

fn workspace_locator() -> DocumentLocator {
    DocumentLocator::WorkspacePath {
        workspace_id: workspace_id(),
        relative_path: relative_path(),
    }
}

fn markdown_resource() -> ResourceRef {
    ResourceRef::Markdown {
        locator: workspace_locator(),
        anchor: Some(DocumentAnchor::Heading {
            slug: "fixture-heading".to_owned(),
        }),
    }
}

fn markdown_ref() -> MarkdownResourceRef {
    MarkdownResourceRef(markdown_resource())
}

fn asset_resource() -> ResourceRef {
    ResourceRef::Asset {
        scope: ResourceScope::Document {
            document_id: document_id(),
        },
        relative_path: RelativePath("assets/fixture.png".to_owned()),
        media_type: Some("image/png".to_owned()),
    }
}

fn resolved_resource() -> ResourceResolution {
    ResourceResolution::Resolved {
        resource: markdown_resource(),
        document_id: Some(document_id()),
    }
}

fn disk_revision() -> DiskRevision {
    DiskRevision {
        token: RevisionToken("fixture-revision-token".to_owned()),
        size_bytes: safe(128),
        modified_at_unix_ms: safe(2_000_000_000_000),
        content_hash: ContentHash("fixture-content-hash".to_owned()),
        file_identity_hint: Some("fixture-file-identity".to_owned()),
    }
}

fn expected_present() -> ExpectedDiskRevision {
    ExpectedDiskRevision::Present {
        revision: disk_revision(),
    }
}

fn document_format() -> DocumentFormat {
    DocumentFormat {
        encoding: TextEncoding::Utf8,
        has_utf8_bom: false,
        line_ending: LineEnding::Lf,
        preferred_line_ending: PreferredLineEnding::Lf,
    }
}

fn descriptor() -> DocumentDescriptor {
    DocumentDescriptor {
        document_id: document_id(),
        locator: workspace_locator(),
        display_name: "fixture.md".to_owned(),
        workspace_id: Some(workspace_id()),
        relative_path: Some(relative_path()),
        read_only: false,
    }
}

fn preflight_report() -> PreflightReport {
    PreflightReport {
        size_bytes: safe(128),
        max_line_bytes: safe(32),
        line_count_estimate: Some(safe(4)),
        has_utf8_bom: false,
        detected_data_image_count: safe(1),
        largest_data_image_estimate_bytes: Some(safe(16)),
    }
}

fn safety_report() -> SafetyBlockedReport {
    SafetyBlockedReport {
        kind: SafetyBlockedReportKind::SafetyBlocked,
        size_bytes: safe(128),
        max_line_bytes: safe(64),
        line_count_estimate: Some(safe(4)),
        has_utf8_bom: false,
        detected_data_image_count: safe(1),
        largest_data_image_estimate_bytes: Some(safe(16)),
        reasons: vec![SafetyBlockedReason::LargeDataImage],
        allowed_actions: vec![SafetyBlockedAction::ExtractDataImages],
    }
}

fn unsupported_report() -> UnsupportedReport {
    UnsupportedReport {
        kind: UnsupportedReportKind::Unsupported,
        size_bytes: safe(128),
        max_line_bytes: safe(64),
        line_count_estimate: Some(safe(4)),
        has_utf8_bom: false,
        detected_data_image_count: safe(0),
        largest_data_image_estimate_bytes: None,
        reasons: vec![UnsupportedReason::InvalidUtf8],
        allowed_actions: vec![UnsupportedAction::OpenExternal],
    }
}

fn editable_document() -> EditableDocument {
    EditableDocument {
        descriptor: descriptor(),
        content: "# fixture document".to_owned(),
        mode: OpenMode::Normal,
        format: document_format(),
        disk_revision: expected_present(),
        preflight: preflight_report(),
    }
}

fn saved_document() -> DocumentSaveOutcome {
    DocumentSaveOutcome::Saved {
        document_id: document_id(),
        saved_session_revision: session_revision(14),
        new_disk_revision: disk_revision(),
        write_id: "fixture-write".to_owned(),
        bytes_written: safe(128),
    }
}

fn saved_as_document() -> DocumentSaveAsOutcome {
    DocumentSaveAsOutcome::Saved {
        save_as_intent_id: "fixture-save-as".to_owned(),
        result: saved_document(),
        new_descriptor: descriptor(),
    }
}

fn asset_ref() -> AssetRef {
    AssetRef {
        id: asset_id(),
        owner: AssetOwner::Document {
            document_id: document_id(),
        },
        state: AssetState::Committed,
        media_type: "image/png".to_owned(),
        size_bytes: safe(64),
        content_hash: ContentHash("fixture-asset-hash".to_owned()),
        width: Some(safe(16)),
        height: Some(safe(16)),
        relative_path: Some(RelativePath("assets/fixture.png".to_owned())),
        markdown_uri: "assets/fixture.png".to_owned(),
    }
}

fn app_error() -> AppError {
    AppError {
        code: AppErrorCode("ERR_IO".to_owned()),
        message: "Fixture I/O failure".to_owned(),
        message_key: Some("fixture.io".to_owned()),
        retryable: true,
        correlation_id: "fixture-correlation".to_owned(),
        recovery_actions: Some(vec![RecoveryAction::Retry, RecoveryAction::Compare]),
        details: None,
    }
}

fn recovery_descriptor() -> RecoveryDescriptor {
    RecoveryDescriptor {
        id: RecoveryId("fixture-recovery".to_owned()),
        title_snapshot: "Fixture recovery".to_owned(),
        locator_hint: Some(workspace_locator()),
        session_revision: session_revision(20),
        persisted_session_revision: session_revision(19),
        base_disk_revision: expected_present(),
        captured_at: "2030-01-01T00:00:00Z".to_owned(),
        quarantined: false,
        pending_save_as_intent_id: Some("fixture-save-as".to_owned()),
    }
}

fn pane(id: &str) -> PaneSnapshot {
    PaneSnapshot {
        pane_id: PaneId(id.to_owned()),
        tab_ids: vec![TabId("fixture-tab".to_owned())],
        active_tab_id: Some(TabId("fixture-tab".to_owned())),
    }
}
