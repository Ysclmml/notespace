import { describe, expect, it } from "vitest";

import fixtureJson from "../../contracts/generated/ipc-v1-union-fixtures.json?raw";
import {
  CONTRACT_UNION_FIXTURES,
  decodeAppError,
  decodeEventEnvelope,
  IPC_API_VERSION,
  IPC_COMMAND_SPECS,
  IPC_EVENT_SPECS,
  isKnownWriteAction,
  KNOWN_APP_ERROR_CODES,
} from "../generated/ipc";

const eventBase = {
  apiVersion: IPC_API_VERSION,
  eventId: "fixture-event",
  emittedAt: "2030-01-01T00:00:00Z",
};

const taskProgress = {
  ...eventBase,
  eventType: "task.progress",
  scope: { kind: "operation", operationId: "fixture-operation" },
  sequence: 2,
  payload: { operationId: "fixture-operation", phase: "scan" },
};

describe("CONTRACT-001 generated IPC catalog", () => {
  it("exports the canonical command, event and known-error sets", () => {
    expect(IPC_COMMAND_SPECS).toHaveLength(37);
    expect(new Set(IPC_COMMAND_SPECS.map((command) => command.name)).size).toBe(37);
    expect(IPC_EVENT_SPECS).toHaveLength(8);
    expect(KNOWN_APP_ERROR_CODES).toHaveLength(24);
  });
});

describe("CONTRACT-002 Rust serde to TypeScript union fixtures", () => {
  it("keeps the committed JSON value-aligned with concrete Rust variants", () => {
    const fixtureSet: unknown = JSON.parse(fixtureJson);
    expect(fixtureSet).toEqual(CONTRACT_UNION_FIXTURES);
    expect(Object.keys(CONTRACT_UNION_FIXTURES.unions)).toHaveLength(44);
    expect(CONTRACT_UNION_FIXTURES.generatedBy).toBe(
      "src-tauri/src/ipc_schema/fixtures.rs",
    );
  });

  it("contains valid nested wire values rather than placeholder objects", () => {
    const preview = CONTRACT_UNION_FIXTURES.unions.ResourcePreviewOutcome[0];
    const external = CONTRACT_UNION_FIXTURES.unions.DocumentExternalChanged[2];
    const persistence = CONTRACT_UNION_FIXTURES.unions.PersistenceState[5];

    expect(preview.resource.locator.kind).toBe("workspacePath");
    expect(preview.diskRevision?.revision.contentHash).toBe("fixture-content-hash");
    expect(external).toMatchObject({
      change: "replaced",
      source: "ownWrite",
      writeId: "fixture-write",
    });
    expect(persistence).toEqual({ kind: "missing", lastKnown: null });
  });
});

describe("CONTRACT-003 forward compatibility and fail-closed writes", () => {
  it("preserves an unknown error code but strips write recovery actions", () => {
    const decoded = decodeAppError({
      code: "ERR_FUTURE_READ_ONLY",
      message: "Future error",
      retryable: false,
      correlationId: "fixture-correlation",
      recoveryActions: ["overwrite", "openSafetyPage", "futureAction"],
      futureOptionalField: { version: 2 },
    });

    expect(decoded?.knownCode).toBe(false);
    expect(decoded?.error.code).toBe("ERR_FUTURE_READ_ONLY");
    expect(decoded?.error.recoveryActions).toEqual(["openSafetyPage"]);
  });

  it("returns a valid unknown read-only event envelope instead of throwing", () => {
    const decoded = decodeEventEnvelope({
      ...eventBase,
      eventType: "future.readOnlyNotification",
      scope: { kind: "app" },
      sequence: 1,
      payload: { future: true },
      futureOptionalField: "ignored",
    });

    expect(decoded?.kind).toBe("unknown");
    expect(decoded?.eventType).toBe("future.readOnlyNotification");
  });

  it("accepts a valid known event and an unknown optional envelope field", () => {
    expect(decodeEventEnvelope({ ...taskProgress, futureOptionalField: 2 })?.kind).toBe(
      "known",
    );
  });

  it.each([
    ["wrong scope", { ...taskProgress, scope: { kind: "app" } }],
    [
      "mismatched scope identity",
      {
        ...taskProgress,
        scope: { kind: "operation", operationId: "different-operation" },
      },
    ],
    ["empty payload", { ...taskProgress, payload: {} }],
    ["negative sequence", { ...taskProgress, sequence: -1 }],
    ["fractional sequence", { ...taskProgress, sequence: 1.5 }],
    ["unsafe sequence", { ...taskProgress, sequence: Number.MAX_SAFE_INTEGER + 1 }],
    [
      "unsafe payload counter",
      {
        ...taskProgress,
        payload: {
          ...taskProgress.payload,
          completedUnits: Number.MAX_SAFE_INTEGER + 1,
        },
      },
    ],
  ])("rejects task.progress with %s", (_name, event) => {
    expect(decodeEventEnvelope(event)).toBeNull();
  });

  it("rejects a non-markdown NativeOpenTarget.document", () => {
    expect(
      decodeEventEnvelope({
        ...eventBase,
        eventType: "app.openResourcesRequested",
        scope: { kind: "app" },
        sequence: 3,
        payload: {
          nativeRequestId: "fixture-native-request",
          source: "finder",
          targets: [
            {
              kind: "document",
              resource: {
                kind: "asset",
                scope: { kind: "document", documentId: "fixture-document" },
                relativePath: "assets/fixture.png",
              },
            },
          ],
        },
      }),
    ).toBeNull();
  });

  it("rejects invalid document.externalChanged provenance", () => {
    expect(
      decodeEventEnvelope({
        ...eventBase,
        eventType: "document.externalChanged",
        scope: { kind: "document", documentId: "fixture-document" },
        sequence: 4,
        payload: {
          documentId: "fixture-document",
          change: "modified",
          observedDiskRevision: { kind: "absent" },
          source: "ownWrite",
        },
      }),
    ).toBeNull();
  });

  it("rejects an unknown write action by default", () => {
    expect(isKnownWriteAction("overwrite")).toBe(true);
    expect(isKnownWriteAction("futureDestructiveAction")).toBe(false);
  });
});
