//! Runtime TypeScript guards. Wire declarations themselves come only from
//! `ts-rs`; this module contains security policy that static types cannot express.

pub const TYPESCRIPT_RUNTIME: &str = r#"
type JsonRecord = Record<string, unknown>;

export interface ContractUnionFixtureSet {
  schemaVersion: 1;
  apiVersion: ApiVersion;
  generatedBy: string;
  unions: Record<string, readonly unknown[]>;
}

export type KnownEventEnvelope = {
  [Name in IpcEventType]: EventEnvelope<IpcEventMap[Name]> & { eventType: Name };
}[IpcEventType];

export type DecodedEventEnvelope =
  | { kind: "known"; eventType: IpcEventType; envelope: KnownEventEnvelope }
  | { kind: "unknown"; eventType: string; envelope: EventEnvelope<unknown> };

export interface DecodedAppError {
  error: AppError;
  knownCode: boolean;
}

const READ_ONLY_UNKNOWN_ERROR_ACTIONS = [
  "openSafetyPage",
  "compare",
  "openExternal",
] as const satisfies readonly RecoveryAction[];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

export function isJsSafeUnsignedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isKnownAppErrorCode(code: string): code is KnownAppErrorCode {
  return (KNOWN_APP_ERROR_CODES as readonly string[]).includes(code);
}

export function isKnownWriteAction(action: string): boolean {
  return (KNOWN_WRITE_ACTIONS as readonly string[]).includes(action);
}

function isKnownRecoveryAction(value: unknown): value is RecoveryAction {
  return (
    typeof value === "string" &&
    [
      "retry",
      "requestGrant",
      "openSafetyPage",
      "reload",
      "compare",
      "overwrite",
      "saveAs",
      "openExternal",
    ].includes(value)
  );
}

export function decodeAppError(value: unknown): DecodedAppError | null {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    value.code.length === 0 ||
    typeof value.message !== "string" ||
    !isOptionalString(value.messageKey) ||
    typeof value.retryable !== "boolean" ||
    typeof value.correlationId !== "string" ||
    (value.details !== undefined && !isRecord(value.details)) ||
    (value.recoveryActions !== undefined &&
      (!Array.isArray(value.recoveryActions) ||
        !value.recoveryActions.every((action) => typeof action === "string")))
  ) {
    return null;
  }

  const knownCode = isKnownAppErrorCode(value.code);
  const knownActions = value.recoveryActions?.filter(isKnownRecoveryAction);
  const recoveryActions = knownCode
    ? knownActions
    : knownActions?.filter((action) =>
        (READ_ONLY_UNKNOWN_ERROR_ACTIONS as readonly string[]).includes(action),
      );
  const error = {
    ...value,
    ...(value.recoveryActions === undefined ? {} : { recoveryActions }),
  } as AppError;
  return { error, knownCode };
}

function isEventScope(value: unknown): value is EventScope {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "app":
      return true;
    case "workspace":
      return typeof value.workspaceId === "string";
    case "document":
      return typeof value.documentId === "string";
    case "operation":
      return typeof value.operationId === "string";
    default:
      return false;
  }
}

function isExpectedDiskRevision(value: unknown): value is ExpectedDiskRevision {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "absent") return true;
  if (value.kind !== "present" || !isRecord(value.revision)) return false;
  const revision = value.revision;
  return (
    typeof revision.token === "string" &&
    isJsSafeUnsignedInteger(revision.sizeBytes) &&
    isJsSafeUnsignedInteger(revision.modifiedAtUnixMs) &&
    typeof revision.contentHash === "string" &&
    isOptionalString(revision.fileIdentityHint)
  );
}

function isWorkspaceFileChange(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (["created", "modified", "removed"].includes(value.kind)) {
    return typeof value.relativePath === "string";
  }
  return (
    value.kind === "renamed" &&
    typeof value.from === "string" &&
    typeof value.to === "string" &&
    (value.confidence === "certain" || value.confidence === "likely")
  );
}

function isWorkspaceFilesChanged(value: unknown): value is WorkspaceFilesChanged {
  return (
    isRecord(value) &&
    isJsSafeUnsignedInteger(value.generationHint) &&
    typeof value.overflow === "boolean" &&
    Array.isArray(value.changes) &&
    value.changes.every(isWorkspaceFileChange)
  );
}

function isOptionalAppError(value: unknown): boolean {
  return value === undefined || decodeAppError(value) !== null;
}

function isWorkspaceCapabilityChanged(value: unknown): value is WorkspaceCapabilityChanged {
  return (
    isRecord(value) &&
    typeof value.workspaceId === "string" &&
    isJsSafeUnsignedInteger(value.previousEpoch) &&
    isJsSafeUnsignedInteger(value.capabilityEpoch) &&
    (value.state === "ready" || value.state === "revoked") &&
    isOptionalAppError(value.error)
  );
}

function hasValidProvenance(value: JsonRecord): boolean {
  if (value.source === "external") return !("writeId" in value);
  return value.source === "ownWrite" && typeof value.writeId === "string";
}

function isDocumentExternalChanged(value: unknown): value is DocumentExternalChanged {
  if (!isRecord(value) || typeof value.documentId !== "string") return false;
  if (["modified", "deleted", "replaced", "metadataOnly"].includes(String(value.change))) {
    return isExpectedDiskRevision(value.observedDiskRevision) && hasValidProvenance(value);
  }
  return (
    value.change === "permissionChanged" &&
    typeof value.readOnly === "boolean" &&
    isJsSafeUnsignedInteger(value.capabilityEpoch) &&
    value.source === "external" &&
    !("writeId" in value) &&
    isOptionalAppError(value.error)
  );
}

function isTaskProgress(value: unknown): value is TaskProgress {
  return (
    isRecord(value) &&
    typeof value.operationId === "string" &&
    typeof value.phase === "string" &&
    (value.completedUnits === undefined || isJsSafeUnsignedInteger(value.completedUnits)) &&
    (value.totalUnits === undefined || isJsSafeUnsignedInteger(value.totalUnits)) &&
    isOptionalString(value.messageKey)
  );
}

function isTaskFinished(value: unknown): value is TaskFinished {
  return (
    isRecord(value) &&
    typeof value.operationId === "string" &&
    ["succeeded", "failed", "cancelled"].includes(String(value.outcome)) &&
    isOptionalAppError(value.error)
  );
}

function isRecoverySnapshotFailed(value: unknown): value is RecoverySnapshotFailed {
  return (
    isRecord(value) &&
    typeof value.documentId === "string" &&
    decodeAppError(value.error) !== null
  );
}

function isAppCloseRequest(value: unknown): value is AppCloseRequest {
  return (
    isRecord(value) &&
    typeof value.closeRequestId === "string" &&
    (value.deadlineUnixMs === undefined || isJsSafeUnsignedInteger(value.deadlineUnixMs))
  );
}

function isMarkdownResource(value: unknown): value is MarkdownResourceRef {
  if (!isRecord(value) || value.kind !== "markdown" || !isRecord(value.locator)) {
    return false;
  }
  const locator = value.locator;
  const validLocator =
    (locator.kind === "workspacePath" &&
      typeof locator.workspaceId === "string" &&
      typeof locator.relativePath === "string") ||
    (locator.kind === "draft" &&
      typeof locator.draftId === "string" &&
      isOptionalString(locator.suggestedName)) ||
    (locator.kind === "grantedFile" &&
      typeof locator.grantId === "string" &&
      typeof locator.displayName === "string");
  if (!validLocator || value.anchor === undefined) return validLocator;
  if (!isRecord(value.anchor)) return false;
  const anchor = value.anchor;
  return (
    (anchor.kind === "heading" && typeof anchor.slug === "string") ||
    (anchor.kind === "block" && typeof anchor.blockId === "string") ||
    (anchor.kind === "sourcePosition" &&
      isJsSafeUnsignedInteger(anchor.line) &&
      (anchor.column === undefined || isJsSafeUnsignedInteger(anchor.column)))
  );
}

function isNativeOpenTarget(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "workspace") {
    return typeof value.grantToken === "string" && typeof value.displayPath === "string";
  }
  return value.kind === "document" && isMarkdownResource(value.resource);
}

function isNativeOpenResourcesRequested(
  value: unknown,
): value is NativeOpenResourcesRequested {
  return (
    isRecord(value) &&
    typeof value.nativeRequestId === "string" &&
    ["launch", "finder", "dragDrop"].includes(String(value.source)) &&
    isOptionalString(value.originPaneId) &&
    Array.isArray(value.targets) &&
    value.targets.every(isNativeOpenTarget)
  );
}

const EVENT_PAYLOAD_DECODERS: {
  [Name in IpcEventType]: (value: unknown) => value is IpcEventMap[Name];
} = {
  "workspace.filesChanged": isWorkspaceFilesChanged,
  "workspace.capabilityChanged": isWorkspaceCapabilityChanged,
  "document.externalChanged": isDocumentExternalChanged,
  "task.progress": isTaskProgress,
  "task.finished": isTaskFinished,
  "recovery.snapshotFailed": isRecoverySnapshotFailed,
  "app.closeRequested": isAppCloseRequest,
  "app.openResourcesRequested": isNativeOpenResourcesRequested,
};

function scopeIdentityMatchesPayload(
  eventType: IpcEventType,
  scope: EventScope,
  payload: unknown,
): boolean {
  if (!isRecord(payload)) return false;
  switch (eventType) {
    case "workspace.capabilityChanged":
      return scope.kind === "workspace" && scope.workspaceId === payload.workspaceId;
    case "document.externalChanged":
    case "recovery.snapshotFailed":
      return scope.kind === "document" && scope.documentId === payload.documentId;
    case "task.progress":
    case "task.finished":
      return scope.kind === "operation" && scope.operationId === payload.operationId;
    default:
      return true;
  }
}

export function decodeEventEnvelope(value: unknown): DecodedEventEnvelope | null {
  if (
    !isRecord(value) ||
    value.apiVersion !== IPC_API_VERSION ||
    typeof value.eventId !== "string" ||
    typeof value.eventType !== "string" ||
    typeof value.emittedAt !== "string" ||
    !isEventScope(value.scope) ||
    !isJsSafeUnsignedInteger(value.sequence) ||
    !("payload" in value)
  ) {
    return null;
  }

  const spec = IPC_EVENT_SPECS.find((candidate) => candidate.eventType === value.eventType);
  if (!spec) {
    return {
      kind: "unknown",
      eventType: value.eventType,
      envelope: value as unknown as EventEnvelope<unknown>,
    };
  }
  if (value.scope.kind !== spec.scopeKind) return null;

  const eventType = value.eventType as IpcEventType;
  const decoder = EVENT_PAYLOAD_DECODERS[eventType] as (payload: unknown) => boolean;
  if (!decoder(value.payload) || !scopeIdentityMatchesPayload(eventType, value.scope, value.payload)) {
    return null;
  }
  return {
    kind: "known",
    eventType,
    envelope: value as unknown as KnownEventEnvelope,
  };
}
"#;
