pub const TYPESCRIPT_BINDINGS: &str = r#"
export const IPC_API_VERSION = "1.0" as const;

export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type DocumentId = Brand<string, "DocumentId">;
export type DocumentSessionId = Brand<string, "DocumentSessionId">;
export type DocumentViewId = Brand<string, "DocumentViewId">;
export type DraftId = Brand<string, "DraftId">;
export type TabId = Brand<string, "TabId">;
export type PaneId = Brand<string, "PaneId">;
export type NavEntryId = Brand<string, "NavEntryId">;
export type AssetId = Brand<string, "AssetId">;
export type GrantId = Brand<string, "GrantId">;
export type GrantRequestId = Brand<string, "GrantRequestId">;
export type RecoveryId = Brand<string, "RecoveryId">;
export type RequestId = Brand<string, "RequestId">;
export type OperationId = Brand<string, "OperationId">;
export type EventId = Brand<string, "EventId">;
export type RelativePath = Brand<string, "RelativePath">;
export type RevisionToken = Brand<string, "RevisionToken">;
export type ContentHash = Brand<string, "ContentHash">;
export type SessionRevision = Brand<number, "SessionRevision">;

export interface CommandRequest<T> {
  apiVersion: typeof IPC_API_VERSION;
  requestId: RequestId;
  operationId?: OperationId;
  payload: T;
}

export type CommandResponse<T> =
  | { apiVersion: typeof IPC_API_VERSION; requestId: RequestId; ok: true; payload: T }
  | { apiVersion: typeof IPC_API_VERSION; requestId: RequestId; ok: false; error: AppError };

export interface Workspace {
  id: WorkspaceId;
  displayName: string;
  displayPath: string;
  state: WorkspaceState;
  caseSensitivity: "sensitive" | "insensitive" | "unknown";
  scanGeneration: number;
  capabilityEpoch: number;
  openedAt: string;
}

export type WorkspaceState =
  | { kind: "opening" }
  | { kind: "ready" }
  | { kind: "rescanning"; operationId: OperationId }
  | { kind: "degraded"; reason: AppError }
  | { kind: "closing" }
  | { kind: "closed" };

export type DocumentLocator =
  | { kind: "workspacePath"; workspaceId: WorkspaceId; relativePath: RelativePath }
  | { kind: "draft"; draftId: DraftId; suggestedName?: string }
  | { kind: "grantedFile"; grantId: GrantId; displayName: string };

export type DocumentAnchor =
  | { kind: "heading"; slug: string }
  | { kind: "block"; blockId: string }
  | { kind: "sourcePosition"; line: number; column?: number };

export type ResourceScope =
  | { kind: "workspace"; workspaceId: WorkspaceId }
  | { kind: "document"; documentId: DocumentId }
  | { kind: "draft"; draftId: DraftId };

export type AssetOwner =
  | { kind: "document"; documentId: DocumentId }
  | { kind: "draft"; draftId: DraftId };

export type ResourceRef =
  | { kind: "markdown"; locator: DocumentLocator; anchor?: DocumentAnchor }
  | {
      kind: "asset";
      scope: ResourceScope;
      relativePath: RelativePath;
      mediaType?: string;
    }
  | { kind: "externalUrl"; url: string }
  | {
      kind: "virtual";
      providerId: string;
      resourceId: string;
      params?: Record<string, string>;
    };

export type RevealTarget =
  | { kind: "workspaceRoot"; workspaceId: WorkspaceId }
  | { kind: "workspaceEntry"; workspaceId: WorkspaceId; relativePath: RelativePath }
  | { kind: "grantedFile"; grantId: GrantId }
  | { kind: "asset"; scope: ResourceScope; relativePath: RelativePath };

export interface UnresolvedLink {
  sourceDocumentId: DocumentId;
  rawDestination: string;
  linkKindHint?: "markdown" | "asset" | "url" | "unknown";
}

export type ResourceResolution =
  | { kind: "resolved"; resource: ResourceRef; documentId?: DocumentId }
  | {
      kind: "needsGrant";
      grantRequestId: GrantRequestId;
      displayTarget: string;
      reason: "outsideWorkspace" | "revokedGrant" | "assetDirectory";
    }
  | { kind: "missing"; candidate?: ResourceRef; displayTarget: string }
  | { kind: "unsupported"; scheme?: string; displayTarget: string }
  | { kind: "invalid"; error: AppError };

export interface ResourcePreviewRequest {
  resource: ResourceRef;
  maxUtf8Bytes: number;
  maxLines: number;
}

export type ResourcePreviewOutcome =
  | {
      kind: "text";
      resource: ResourceRef;
      title: string;
      excerpt: string;
      truncated: boolean;
      resolvedAnchor?: DocumentAnchor;
      diskRevision?: ExpectedDiskRevision;
    }
  | { kind: "safetyBlocked"; resource: ResourceRef; report: SafetyBlockedReport }
  | { kind: "unsupported"; resource: ResourceRef; report: UnsupportedReport };

export interface DiskRevision {
  token: RevisionToken;
  sizeBytes: number;
  modifiedAtUnixMs: number;
  contentHash: ContentHash;
  fileIdentityHint?: string;
}

export type ExpectedDiskRevision =
  | { kind: "present"; revision: DiskRevision }
  | { kind: "absent" };

export interface DocumentFormat {
  encoding: "utf8";
  hasUtf8Bom: boolean;
  lineEnding: "lf" | "crlf" | "mixed" | "none";
  preferredLineEnding: "lf" | "crlf";
}

export interface DocumentDescriptor {
  documentId: DocumentId;
  locator: DocumentLocator;
  displayName: string;
  workspaceId?: WorkspaceId;
  relativePath?: RelativePath;
  readOnly: boolean;
}

export interface PreflightReport {
  sizeBytes: number;
  maxLineBytes: number;
  lineCountEstimate?: number;
  hasUtf8Bom: boolean;
  detectedDataImageCount: number;
  largestDataImageEstimateBytes?: number;
}

export type SafetyBlockedReport = PreflightReport & {
  kind: "safetyBlocked";
  reasons: Array<"lineTooLong" | "largeDataImage">;
  allowedActions: Array<
    "extractDataImages" | "deleteDataImages" | "openExternal" | "cancel"
  >;
};

export type UnsupportedReport = PreflightReport & {
  kind: "unsupported";
  reasons: Array<"binary" | "fileTooLarge" | "invalidUtf8" | "unsupportedEncoding">;
  allowedActions: Array<"openExternal" | "cancel">;
};

export type SafetyReport = SafetyBlockedReport | UnsupportedReport;
export type OpenMode = "normal" | "largeText";

export interface EditableDocument {
  descriptor: DocumentDescriptor;
  content: string;
  mode: OpenMode;
  format: DocumentFormat;
  diskRevision: ExpectedDiskRevision;
  preflight: PreflightReport;
}

export type DocumentOpenOutcome =
  | { kind: "editable"; document: EditableDocument }
  | {
      kind: "safetyBlocked";
      descriptor: DocumentDescriptor;
      report: SafetyBlockedReport;
      repairToken: string;
      diskRevision: ExpectedDiskRevision;
    }
  | { kind: "unsupported"; descriptor?: DocumentDescriptor; report: UnsupportedReport };

export type DocumentLoadState =
  | { kind: "loading"; resource: ResourceRef; operationId: OperationId }
  | {
      kind: "safetyBlocked";
      resource: ResourceRef;
      descriptor: DocumentDescriptor;
      report: SafetyBlockedReport;
      repairToken: string;
      diskRevision: ExpectedDiskRevision;
    }
  | {
      kind: "unsupported";
      resource: ResourceRef;
      descriptor?: DocumentDescriptor;
      report: UnsupportedReport;
    }
  | { kind: "failed"; resource: ResourceRef; error: AppError };

export type DiscardReturnState =
  | { kind: "dirty" }
  | {
      kind: "conflict";
      expected: ExpectedDiskRevision;
      actual: ExpectedDiskRevision;
      reason: "modified" | "deleted" | "replaced" | "created";
    }
  | { kind: "missing"; lastKnown: DiskRevision | null }
  | { kind: "saveError"; error: AppError }
  | { kind: "reloadError"; error: AppError; observed?: ExpectedDiskRevision };

export type PersistenceState =
  | { kind: "clean" }
  | { kind: "dirty" }
  | {
      kind: "reloading";
      operationId: OperationId;
      previousDiskRevision: ExpectedDiskRevision;
    }
  | {
      kind: "saving";
      operationId: OperationId;
      snapshotSessionRevision: SessionRevision;
      expectedDiskRevision: ExpectedDiskRevision;
      editOccurredAfterSnapshot: boolean;
    }
  | {
      kind: "conflict";
      expected: ExpectedDiskRevision;
      actual: ExpectedDiskRevision;
      reason: "modified" | "deleted" | "replaced" | "created";
    }
  | { kind: "missing"; lastKnown: DiskRevision | null }
  | { kind: "saveError"; error: AppError }
  | { kind: "reloadError"; error: AppError; observed?: ExpectedDiskRevision }
  | {
      kind: "discarding";
      operationId: OperationId;
      discardIntentId: string;
      snapshotSessionRevision: SessionRevision;
      previous: DiscardReturnState;
    };

export interface DocumentSession {
  id: DocumentSessionId;
  descriptor: DocumentDescriptor;
  currentSessionRevision: SessionRevision;
  persistedSessionRevision: SessionRevision;
  diskRevision: ExpectedDiskRevision;
  format: DocumentFormat;
  mode: OpenMode;
  persistence: PersistenceState;
  lifecycle: "active" | "closing";
  refCount: number;
  lastAccessedAt: number;
}

export interface SessionEditIntent {
  sessionId: DocumentSessionId;
  originViewId: DocumentViewId;
  baseRevision: SessionRevision;
  changes: unknown;
  addToHistory: boolean;
}

export type SessionEditResult =
  | { kind: "applied"; newRevision: SessionRevision }
  | { kind: "stale"; actualRevision: SessionRevision }
  | { kind: "rejected"; error: AppError };

export interface Tab {
  id: TabId;
  title: string;
  history: NavigationHistory;
  pinned: boolean;
  lifecycle: "open" | "closing" | "closed";
  navigationEpoch: number;
}

export interface NavigationHistory {
  entries: NavEntry[];
  index: number;
}

export interface NavEntry {
  id: NavEntryId;
  resource: ResourceRef;
  titleSnapshot?: string;
  viewState?: ViewState;
  visitedAt: number;
}

export interface DocumentView {
  id: DocumentViewId;
  sessionId: DocumentSessionId;
  tabId: TabId;
  paneId?: PaneId;
  viewState: ViewState;
  mountState: "mounted" | "suspended" | "disposed";
}

export interface ViewState {
  selection?: { anchor: number; head: number };
  scroll: ScrollAnchor;
  foldedRanges?: Array<{ from: number; to: number; fingerprint?: string }>;
  editorMode?: "source" | "livePreview";
}

export interface ScrollAnchor {
  topBlock?: BlockLocator;
  yWithinBlock: number;
  fallbackScrollTop: number;
}

export interface BlockLocator {
  syntaxKind?: string;
  headingPath?: string[];
  sourceOffset: number;
  sourceLine: number;
  fingerprint?: string;
}

export type OpenDisposition =
  | "current"
  | "newForegroundTab"
  | "newBackgroundTab"
  | "splitRight";

export type NavigationSource =
  | "link"
  | "fileTree"
  | "outline"
  | "search"
  | "backlink"
  | "command"
  | "nativeOpen"
  | "dragDrop"
  | "restore";

export interface NavigateIntent {
  target: ResourceRef | UnresolvedLink;
  disposition: OpenDisposition;
  source: NavigationSource;
  originTabId?: TabId;
  originViewId?: DocumentViewId;
}

export interface PreviewIntent {
  target: ResourceRef | UnresolvedLink;
  source: NavigationSource;
  originTabId: TabId;
  originViewId?: DocumentViewId;
}

export interface AssetRef {
  id: AssetId;
  owner: AssetOwner;
  state: AssetState;
  mediaType: string;
  sizeBytes: number;
  contentHash: ContentHash;
  width?: number;
  height?: number;
  relativePath?: RelativePath;
  markdownUri: string;
}

export type AssetState =
  | { kind: "staging" }
  | { kind: "committing"; operationId: OperationId }
  | { kind: "committed" }
  | { kind: "orphaned"; retainUntilUnixMs: number }
  | { kind: "deleted" }
  | { kind: "failed"; error: AppError };

export interface AppCapabilities {
  apiVersion: "1.0";
  platform: "macos" | "windows" | "linux";
  features: {
    clipboardImage: boolean;
    splitView: boolean;
    recovery: boolean;
    mermaid: boolean;
  };
  limits: {
    policyVersion: 1;
    normalFileBytes: number;
    maxEditableFileBytes: number;
    maxNormalLineBytes: number;
    safetyBlockLineBytes: number;
    safetyBlockDataImageDecodedBytes: number;
    mermaidSourceBytes: number;
    mermaidMaxNodes: number;
    mermaidRenderTimeoutMs: number;
    imageDecodedPixelMax: number;
    previewMaxUtf8Bytes: number;
    previewMaxLines: number;
    nativeOpenQueueMaxTargets: number;
    workspaceScanPageMaxEntries: number;
    ipcDefaultPayloadBytes: number;
    ipcDocumentRawContentBytes: number;
    ipcDocumentWireBytes: number;
  };
}

export interface AppCloseRequest {
  closeRequestId: string;
  deadlineUnixMs?: number;
}

export interface AppReconcileOutcome {
  appSequence: number;
  pendingCloseRequest?: AppCloseRequest;
  pendingOpenRequests: NativeOpenResourcesRequested[];
  pendingSaveAsIntents: PendingSaveAsSummary[];
}

export type WorkspaceRescanRequest =
  | {
      kind: "start";
      workspaceId: WorkspaceId;
      knownGeneration: number;
      requestedPageEntries?: number;
    }
  | { kind: "next"; workspaceId: WorkspaceId; scanId: string; cursor: string };

export interface WorkspaceSnapshotPage {
  workspace: Workspace;
  scanId: string;
  targetGeneration: number;
  entries: Array<{
    kind: "directory" | "markdown" | "asset" | "other";
    relativePath: RelativePath;
    displayName: string;
    sizeBytes?: number;
    modifiedAtUnixMs?: number;
  }>;
  nextCursor?: string;
  complete: boolean;
}

export type ResourceGrantOutcome =
  | {
      kind: "resourceResolved";
      grantRequestId: GrantRequestId;
      resolution: Exclude<ResourceResolution, { kind: "needsGrant" }>;
    }
  | {
      kind: "assetDirectoryGranted";
      grantRequestId: GrantRequestId;
      owner: AssetOwner;
      pasteIntentId: string;
    }
  | { kind: "cancelled"; grantRequestId: GrantRequestId };

export interface DocumentCreateDraftRequest {
  draftIntentId: string;
  suggestedName?: string;
}

export interface DocumentCreateDraftOutcome {
  document: EditableDocument;
  initialRevisions: { current: SessionRevision; persisted: SessionRevision };
}

export interface DocumentOpenRequest {
  resource: Extract<ResourceRef, { kind: "markdown" }>;
  expectedDocumentId?: DocumentId;
}

export interface DocumentSaveRequest {
  documentId: DocumentId;
  content: string;
  format: DocumentFormat;
  snapshotSessionRevision: SessionRevision;
  expectedDiskRevision: ExpectedDiskRevision;
  reason: "explicit" | "autosave" | "close" | "checkpointPromotion";
}

export type DocumentSaveOutcome =
  | {
      kind: "saved";
      documentId: DocumentId;
      savedSessionRevision: SessionRevision;
      newDiskRevision: DiskRevision;
      writeId: string;
      bytesWritten: number;
    }
  | {
      kind: "noop";
      documentId: DocumentId;
      savedSessionRevision: SessionRevision;
      diskRevision: ExpectedDiskRevision;
    };

export type ConflictResolutionRequest =
  | {
      action: "reload";
      documentId: DocumentId;
      observedDiskRevision: ExpectedDiskRevision;
    }
  | {
      action: "overwrite";
      documentId: DocumentId;
      content: string;
      format: DocumentFormat;
      snapshotSessionRevision: SessionRevision;
      observedDiskRevision: ExpectedDiskRevision;
    }
  | {
      action: "recreate";
      documentId: DocumentId;
      content: string;
      format: DocumentFormat;
      snapshotSessionRevision: SessionRevision;
      observedDiskRevision: { kind: "absent" };
    };

export type ConflictResolutionOutcome =
  | { kind: "reloadChecked"; outcome: DocumentOpenOutcome }
  | { kind: "saved"; result: DocumentSaveOutcome };

export interface DocumentPrepareSaveAsRequest {
  saveAsIntentId: string;
  documentId: DocumentId;
  sourceSnapshotSessionRevision: SessionRevision;
  target:
    | { kind: "prompt"; suggestedName?: string }
    | { kind: "grant"; grantToken: string };
  referencedDraftAssetIds: AssetId[];
}

export type DocumentPrepareSaveAsOutcome =
  | { kind: "cancelled"; saveAsIntentId: string }
  | { kind: "sameDocument"; saveAsIntentId: string; documentId: DocumentId }
  | {
      kind: "targetAlreadyOpen";
      saveAsIntentId: string;
      target: DocumentDescriptor;
    }
  | {
      kind: "prepared";
      saveAsIntentId: string;
      saveAsToken: string;
      newDescriptor: DocumentDescriptor;
      targetExpectedDiskRevision: ExpectedDiskRevision;
      uriReplacements: Array<{ assetId: AssetId; oldUri: string; newUri: string }>;
      relativeLinkImpact: "none" | "baseDirectoryChanged";
    };

export interface DocumentSaveAsRequest {
  saveAsIntentId: string;
  documentId: DocumentId;
  saveAsToken: string;
  content: string;
  format: DocumentFormat;
  sourceSnapshotSessionRevision: SessionRevision;
  snapshotSessionRevision: SessionRevision;
}

export interface DocumentSaveAsOutcome {
  kind: "saved";
  saveAsIntentId: string;
  result: DocumentSaveOutcome;
  newDescriptor: DocumentDescriptor;
}

export type DocumentSaveAsStatusOutcome =
  | { kind: "unknown"; saveAsIntentId: string }
  | { kind: "prepared"; saveAsIntentId: string; documentId: DocumentId }
  | { kind: "committing"; saveAsIntentId: string; documentId: DocumentId }
  | { kind: "committed"; outcome: DocumentSaveAsOutcome }
  | {
      kind: "rolledBack";
      saveAsIntentId: string;
      documentId: DocumentId;
      error?: AppError;
    }
  | { kind: "acknowledged"; saveAsIntentId: string; documentId: DocumentId };

export interface PendingSaveAsSummary {
  documentId: DocumentId;
  saveAsIntentId: string;
  phase: "prepared" | "committing" | "committed" | "rolledBack";
}

export type DocumentCompareOutcome =
  | {
      kind: "snapshot";
      content: string;
      format: DocumentFormat;
      diskRevision: ExpectedDiskRevision;
    }
  | {
      kind: "safetyBlocked";
      report: SafetyBlockedReport;
      diskRevision: ExpectedDiskRevision;
    }
  | {
      kind: "unsupported";
      report: UnsupportedReport;
      diskRevision: ExpectedDiskRevision;
    };

export type DocumentRepairAction =
  | { kind: "extractDataImages"; assetDirectoryName: string }
  | { kind: "deleteDataImages" };

export interface DocumentRepairRequest {
  repairToken: string;
  expectedDiskRevision: ExpectedDiskRevision;
  action: DocumentRepairAction;
}

export interface DocumentRepairOutcome {
  backupDisplayPath: string;
  repairedDiskRevision: DiskRevision;
  extractedAssets: AssetRef[];
  reopen: DocumentOpenOutcome;
}

export interface AssetImportClipboardRequest {
  pasteIntentId: string;
  owner: AssetOwner;
  preferredFormat: "png" | "preserve";
  namingHint?: string;
}

export type AssetImportClipboardOutcome =
  | { kind: "imported"; asset: AssetRef }
  | {
      kind: "needsGrant";
      grantRequestId: GrantRequestId;
      owner: AssetOwner;
      pasteIntentId: string;
      displayTarget: string;
      reason: "assetDirectory";
    };

export interface SessionCheckpointRequest {
  documentId: DocumentId;
  sessionRevision: SessionRevision;
  persistedSessionRevision: SessionRevision;
  baseDiskRevision: ExpectedDiskRevision;
  content: string;
  reason: "debounce" | "appClose" | "crashGuard" | "saveAsPrepare";
  pendingSaveAsIntentId?: string;
}

export interface SessionDiscardRequest {
  discardIntentId: string;
  documentId: DocumentId;
  snapshotSessionRevision: SessionRevision;
}

export interface SessionDiscardOutcome {
  kind: "discarded";
  documentId: DocumentId;
  discardedRecoveryIds: RecoveryId[];
  orphanedAssetIds: AssetId[];
  draftIdentityReleased: boolean;
}

export interface RecoveryDescriptor {
  id: RecoveryId;
  titleSnapshot: string;
  locatorHint?: DocumentLocator;
  sessionRevision: SessionRevision;
  persistedSessionRevision: SessionRevision;
  baseDiskRevision: ExpectedDiskRevision;
  capturedAt: string;
  quarantined: boolean;
  pendingSaveAsIntentId?: string;
}

export interface RecoveredEditableDocument {
  descriptor: DocumentDescriptor;
  content: string;
  mode: OpenMode;
  format: DocumentFormat;
  observedDiskRevision: ExpectedDiskRevision;
  preflight: PreflightReport;
}

export type RecoveryInitialPersistence =
  | { kind: "clean" }
  | { kind: "dirty" }
  | {
      kind: "conflict";
      expected: ExpectedDiskRevision;
      actual: ExpectedDiskRevision;
      reason: "modified" | "deleted" | "replaced" | "created";
    };

export type RecoveryOpenOutcome =
  | {
      kind: "editable";
      recovery: RecoveryDescriptor;
      document: RecoveredEditableDocument;
      restoredRevisions: { current: SessionRevision; persisted: SessionRevision };
      initialPersistence: RecoveryInitialPersistence;
      reconciledSaveAs?: {
        saveAsIntentId: string;
        outcome: DocumentSaveAsOutcome;
        requiresAck: true;
      };
    }
  | {
      kind: "safetyBlocked";
      descriptor: RecoveryDescriptor;
      report: SafetyBlockedReport;
    };

export interface PaneSnapshot {
  paneId: PaneId;
  tabIds: TabId[];
  activeTabId?: TabId;
}

export type WindowLayout =
  | { kind: "single"; pane: PaneSnapshot; focusedPaneId: PaneId }
  | {
      kind: "split";
      left: PaneSnapshot;
      right: PaneSnapshot;
      ratio: number;
      focusedPaneId: PaneId;
    };

export interface WindowStateSnapshotV1 {
  schemaVersion: 1;
  tabs: Array<{ id: TabId; history: NavigationHistory; pinned: boolean }>;
  recentlyClosedTabs: Array<{
    history: NavigationHistory;
    pinned: boolean;
    closedAt: number;
  }>;
  sidebar: { visible: boolean; width: number };
  layout: WindowLayout;
}

export type EventScope =
  | { kind: "app" }
  | { kind: "workspace"; workspaceId: WorkspaceId }
  | { kind: "document"; documentId: DocumentId }
  | { kind: "operation"; operationId: OperationId };

export interface EventEnvelope<T> {
  apiVersion: "1.0";
  eventId: EventId;
  eventType: string;
  emittedAt: string;
  scope: EventScope;
  sequence: number;
  payload: T;
}

export interface WorkspaceFilesChanged {
  generationHint: number;
  overflow: boolean;
  changes: WorkspaceFileChange[];
}

export type WorkspaceFileChange =
  | { kind: "created" | "modified" | "removed"; relativePath: RelativePath }
  | {
      kind: "renamed";
      from: RelativePath;
      to: RelativePath;
      confidence: "certain" | "likely";
    };

export interface WorkspaceCapabilityChanged {
  workspaceId: WorkspaceId;
  previousEpoch: number;
  capabilityEpoch: number;
  state: "ready" | "revoked";
  error?: AppError;
}

export type DocumentChangeProvenance =
  | { source: "external"; writeId?: never }
  | { source: "ownWrite"; writeId: string };

export type DocumentExternalChanged =
  | ({
      documentId: DocumentId;
      change: "modified" | "deleted" | "replaced" | "metadataOnly";
      observedDiskRevision: ExpectedDiskRevision;
    } & DocumentChangeProvenance)
  | {
      documentId: DocumentId;
      change: "permissionChanged";
      readOnly: boolean;
      capabilityEpoch: number;
      source: "external";
      writeId?: never;
      error?: AppError;
    };

export type NativeOpenTarget =
  | { kind: "workspace"; grantToken: string; displayPath: string }
  | {
      kind: "document";
      resource: Extract<ResourceRef, { kind: "markdown" }>;
    };

export interface NativeOpenResourcesRequested {
  nativeRequestId: string;
  source: "launch" | "finder" | "dragDrop";
  originPaneId?: PaneId;
  targets: NativeOpenTarget[];
}

export interface TaskProgress {
  operationId: OperationId;
  phase: string;
  completedUnits?: number;
  totalUnits?: number;
  messageKey?: string;
}

export interface TaskFinished {
  operationId: OperationId;
  outcome: "succeeded" | "failed" | "cancelled";
  error?: AppError;
}

export interface DerivedResultKey {
  documentId: DocumentId;
  sessionRevision: SessionRevision;
  producerVersion: string;
}

export type KnownAppErrorCode = (typeof KNOWN_APP_ERROR_CODES)[number];
export type UnknownAppErrorCode = Brand<string, "UnknownAppErrorCode">;
export type AppErrorCode = KnownAppErrorCode | UnknownAppErrorCode;

export interface AppError {
  code: AppErrorCode;
  message: string;
  messageKey?: string;
  retryable: boolean;
  correlationId: string;
  recoveryActions?: Array<
    | "retry"
    | "requestGrant"
    | "openSafetyPage"
    | "reload"
    | "compare"
    | "overwrite"
    | "saveAs"
    | "openExternal"
  >;
  details?: AppErrorDetails;
}

export type AppErrorDetails =
  | { kind: "path"; displayPath?: string }
  | { kind: "conflict"; expected: ExpectedDiskRevision; actual: ExpectedDiskRevision }
  | { kind: "safety"; report: SafetyReport }
  | { kind: "validation"; field?: string; reason: string }
  | { kind: "operation"; operationId: OperationId; phase?: string }
  | {
      kind: "grant";
      grantRequestId: GrantRequestId;
      purpose: "resourceResolution" | "assetDirectory";
      displayTarget: string;
    }
  | {
      kind: "assetWrite";
      cause: IoFailureCause;
      displayTarget?: string;
      owner: AssetOwner;
    }
  | {
      kind: "io";
      operation: "read" | "write" | "flush" | "rename" | "remove" | "stat";
      cause: IoFailureCause;
      displayPath?: string;
    };

export type IoFailureCause =
  | "readOnly"
  | "permissionRevoked"
  | "diskFull"
  | "quotaExceeded"
  | "nameConflict"
  | "pathConflict"
  | "notFound"
  | "deviceUnavailable"
  | "unknown";

export type EmptyRequest = Record<string, never>;
export interface AppOpenResourcesAckRequest { nativeRequestId: string }
export interface AppOpenResourcesAckOutcome { kind: "acknowledged" | "alreadyAcknowledged" | "unknown" }
export interface AppCloseRespondRequest { closeRequestId: string; decision: "cancel" | "proceed" }
export interface AppCloseRespondOutcome { kind: "cancelled" | "closing" | "alreadyResolved" | "unknown" }
export interface WorkspacePickRequest { initialWorkspaceId?: WorkspaceId }
export type WorkspacePickOutcome =
  | { kind: "selected"; grantToken: string; displayPath: string }
  | { kind: "cancelled" };
export interface WorkspaceOpenRequest { grantToken: string }
export interface WorkspaceOpenRecentRequest { workspaceId: WorkspaceId }
export interface WorkspaceOpenOutcome { workspace: Workspace }
export interface WorkspaceCloseRequest { workspaceId: WorkspaceId; capabilityEpoch: number }
export interface WorkspaceCloseOutcome { closed: true }
export interface DocumentPickRequest { initialWorkspaceId?: WorkspaceId }
export type DocumentPickOutcome =
  | { kind: "selected"; resource: Extract<ResourceRef, { kind: "markdown" }> }
  | { kind: "cancelled" };
export interface ResourceGrantRequest { grantRequestId: GrantRequestId }
export interface DocumentSaveAsAbortRequest {
  documentId: DocumentId;
  saveAsIntentId: string;
  reason: "userCancelled" | "superseded" | "recoveryAbandoned";
}
export interface DocumentSaveAsAbortOutcome { kind: "aborted" | "alreadyAborted" | "unknown" }
export interface DocumentReloadRequest {
  documentId: DocumentId;
  knownDiskRevision: ExpectedDiskRevision;
}
export interface DocumentReadDiskSnapshotRequest {
  documentId: DocumentId;
  observedDiskRevision: ExpectedDiskRevision;
}
export interface DocumentSaveAsStatusRequest { documentId: DocumentId; saveAsIntentId: string }
export interface DocumentSaveAsAckRequest {
  documentId: DocumentId;
  saveAsIntentId: string;
  acceptedDiskRevision: DiskRevision;
}
export interface DocumentSaveAsAckOutcome { kind: "acknowledged" | "alreadyAcknowledged" | "unknown" }
export interface AssetReleaseRequest {
  assetId: AssetId;
  reason: "insertFailed" | "undo" | "documentClosed";
  retainUntilUnixMs: number;
}
export interface AssetReleaseOutcome { state: AssetState }
export interface SessionCheckpointOutcome { checkpointed: SessionRevision; storedAt: string }
export interface RecoveryListOutcome { items: RecoveryDescriptor[]; safeMode: boolean }
export interface RecoveryOpenRequest { recoveryId: RecoveryId }
export interface RecoveryDiscardRequest { recoveryId: RecoveryId }
export interface RecoveryDiscardOutcome { discarded: true }
export interface WindowStateSaveRequest { snapshot: WindowStateSnapshotV1 }
export interface WindowStateSaveOutcome { storedAt: string }
export interface WindowStateLoadOutcome { snapshot?: WindowStateSnapshotV1; safeMode: boolean }
export interface TaskCancelRequest { operationId: OperationId }
export interface TaskCancelOutcome { kind: "requested" | "notFound" | "pastCommitPoint" }
export interface ResourceOpenExternalRequest { resource: ResourceRef }
export interface ResourceOpenExternalOutcome { opened: true }
export interface ResourceRevealRequest { target: RevealTarget }
export interface ResourceRevealOutcome { revealed: true }
export interface RecoverySnapshotFailed { documentId: DocumentId; error: AppError }

export interface IpcCommandMap {
  app_capabilities_v1: { request: EmptyRequest; response: AppCapabilities };
  app_state_reconcile_v1: { request: EmptyRequest; response: AppReconcileOutcome };
  app_open_resources_ack_v1: { request: AppOpenResourcesAckRequest; response: AppOpenResourcesAckOutcome };
  app_close_respond_v1: { request: AppCloseRespondRequest; response: AppCloseRespondOutcome };
  workspace_pick_v1: { request: WorkspacePickRequest; response: WorkspacePickOutcome };
  workspace_open_v1: { request: WorkspaceOpenRequest; response: WorkspaceOpenOutcome };
  workspace_open_recent_v1: { request: WorkspaceOpenRecentRequest; response: WorkspaceOpenOutcome };
  workspace_close_v1: { request: WorkspaceCloseRequest; response: WorkspaceCloseOutcome };
  workspace_rescan_v1: { request: WorkspaceRescanRequest; response: WorkspaceSnapshotPage };
  document_pick_v1: { request: DocumentPickRequest; response: DocumentPickOutcome };
  resource_grant_v1: { request: ResourceGrantRequest; response: ResourceGrantOutcome };
  resource_resolve_v1: { request: UnresolvedLink; response: ResourceResolution };
  resource_preview_v1: { request: ResourcePreviewRequest; response: ResourcePreviewOutcome };
  document_save_as_abort_v1: { request: DocumentSaveAsAbortRequest; response: DocumentSaveAsAbortOutcome };
  document_create_draft_v1: { request: DocumentCreateDraftRequest; response: DocumentCreateDraftOutcome };
  document_open_v1: { request: DocumentOpenRequest; response: DocumentOpenOutcome };
  document_save_v1: { request: DocumentSaveRequest; response: DocumentSaveOutcome };
  document_reload_v1: { request: DocumentReloadRequest; response: DocumentOpenOutcome };
  document_resolve_conflict_v1: { request: ConflictResolutionRequest; response: ConflictResolutionOutcome };
  document_repair_v1: { request: DocumentRepairRequest; response: DocumentRepairOutcome };
  document_prepare_save_as_v1: { request: DocumentPrepareSaveAsRequest; response: DocumentPrepareSaveAsOutcome };
  document_save_as_v1: { request: DocumentSaveAsRequest; response: DocumentSaveAsOutcome };
  document_read_disk_snapshot_v1: { request: DocumentReadDiskSnapshotRequest; response: DocumentCompareOutcome };
  document_save_as_status_v1: { request: DocumentSaveAsStatusRequest; response: DocumentSaveAsStatusOutcome };
  document_save_as_ack_v1: { request: DocumentSaveAsAckRequest; response: DocumentSaveAsAckOutcome };
  asset_import_clipboard_v1: { request: AssetImportClipboardRequest; response: AssetImportClipboardOutcome };
  asset_release_v1: { request: AssetReleaseRequest; response: AssetReleaseOutcome };
  session_checkpoint_v1: { request: SessionCheckpointRequest; response: SessionCheckpointOutcome };
  recovery_list_v1: { request: EmptyRequest; response: RecoveryListOutcome };
  recovery_open_v1: { request: RecoveryOpenRequest; response: RecoveryOpenOutcome };
  recovery_discard_v1: { request: RecoveryDiscardRequest; response: RecoveryDiscardOutcome };
  window_state_save_v1: { request: WindowStateSaveRequest; response: WindowStateSaveOutcome };
  window_state_load_v1: { request: EmptyRequest; response: WindowStateLoadOutcome };
  session_discard_v1: { request: SessionDiscardRequest; response: SessionDiscardOutcome };
  task_cancel_v1: { request: TaskCancelRequest; response: TaskCancelOutcome };
  resource_open_external_v1: { request: ResourceOpenExternalRequest; response: ResourceOpenExternalOutcome };
  resource_reveal_v1: { request: ResourceRevealRequest; response: ResourceRevealOutcome };
}

export type IpcCommandName = keyof IpcCommandMap;
export type IpcCommandRequest<Name extends IpcCommandName> = IpcCommandMap[Name]["request"];
export type IpcCommandResponse<Name extends IpcCommandName> = IpcCommandMap[Name]["response"];

export interface IpcEventMap {
  "workspace.filesChanged": WorkspaceFilesChanged;
  "workspace.capabilityChanged": WorkspaceCapabilityChanged;
  "document.externalChanged": DocumentExternalChanged;
  "task.progress": TaskProgress;
  "task.finished": TaskFinished;
  "recovery.snapshotFailed": RecoverySnapshotFailed;
  "app.closeRequested": AppCloseRequest;
  "app.openResourcesRequested": NativeOpenResourcesRequested;
}

export type IpcEventType = keyof IpcEventMap;
"#;

pub const TYPESCRIPT_RUNTIME: &str = r#"
type JsonRecord = Record<string, unknown>;

export type DecodedEventEnvelope =
  | { kind: "known"; eventType: IpcEventType; envelope: EventEnvelope<unknown> }
  | { kind: "unknown"; eventType: string; envelope: EventEnvelope<unknown> };

export interface DecodedAppError {
  error: AppError;
  knownCode: boolean;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isKnownAppErrorCode(code: string): code is KnownAppErrorCode {
  return (KNOWN_APP_ERROR_CODES as readonly string[]).includes(code);
}

export function isKnownWriteAction(action: string): boolean {
  return (KNOWN_WRITE_ACTIONS as readonly string[]).includes(action);
}

export function decodeAppError(value: unknown): DecodedAppError | null {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    typeof value.retryable !== "boolean" ||
    typeof value.correlationId !== "string"
  ) {
    return null;
  }

  return {
    error: value as unknown as AppError,
    knownCode: isKnownAppErrorCode(value.code),
  };
}

export function decodeEventEnvelope(value: unknown): DecodedEventEnvelope | null {
  if (
    !isRecord(value) ||
    value.apiVersion !== IPC_API_VERSION ||
    typeof value.eventId !== "string" ||
    typeof value.eventType !== "string" ||
    typeof value.emittedAt !== "string" ||
    !isRecord(value.scope) ||
    typeof value.sequence !== "number" ||
    !("payload" in value)
  ) {
    return null;
  }

  const envelope = value as unknown as EventEnvelope<unknown>;
  const knownEventTypes = IPC_EVENT_SPECS.map((event) => event.eventType) as readonly string[];
  return knownEventTypes.includes(value.eventType)
    ? { kind: "known", eventType: value.eventType as IpcEventType, envelope }
    : { kind: "unknown", eventType: value.eventType, envelope };
}

export interface ContractUnionFixtureSet {
  schemaVersion: 1;
  apiVersion: "1.0";
  generatedBy: string;
  unions: Record<string, unknown[]>;
}

export function validateContractUnionFixture(
  unionName: string,
  fixture: unknown,
): boolean {
  const union = CONTRACT_UNION_SPECS.find((item) => item.name === unionName);
  if (!union || !isRecord(fixture)) return false;

  const discriminator = fixture[union.discriminator];
  const tag = typeof discriminator === "boolean" ? String(discriminator) : discriminator;
  const variant = union.variants.find((candidate) => candidate.tag === tag);
  if (!variant) return false;
  return variant.requiredFields.every((field) => field in fixture);
}
"#;
