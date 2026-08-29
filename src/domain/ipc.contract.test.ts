import { describe, expect, it } from "vitest";

import fixtureJson from "../../contracts/generated/ipc-v1-union-fixtures.json?raw";
import unionSchemaJson from "../../contracts/generated/ipc-v1-union-schemas.json?raw";
import {
  CONTRACT_UNION_FIXTURES,
  CONTRACT_UNION_VARIANT_COUNTS,
  decodeAppError,
  decodeEventEnvelope,
  IPC_API_VERSION,
  IPC_COMMAND_SPECS,
  IPC_EVENT_SPECS,
  isKnownWriteAction,
  KNOWN_APP_ERROR_CODES,
  matchesJsonSchema,
  type JsonSchema,
} from "../generated/ipc";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  expect(Array.isArray(value)).toBe(false);
  return value as JsonRecord;
}

function schemaBranches(schema: unknown): readonly unknown[] {
  const record = asRecord(schema);
  if (Array.isArray(record.oneOf)) return record.oneOf;
  if (Array.isArray(record.anyOf)) return record.anyOf;
  return [schema];
}

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
    expect(Object.keys(CONTRACT_UNION_FIXTURES.unions)).toEqual(
      Object.keys(CONTRACT_UNION_VARIANT_COUNTS),
    );
    expect(CONTRACT_UNION_FIXTURES.variantCounts).toEqual(CONTRACT_UNION_VARIANT_COUNTS);
    expect(CONTRACT_UNION_FIXTURES.generatedBy).toBe(
      "src-tauri/src/ipc_schema/fixtures.rs",
    );
  });

  it("mechanically covers every branch in every registered Rust wire union", () => {
    const schemaSet = asRecord(JSON.parse(unionSchemaJson));
    const schemas = asRecord(schemaSet.unions);
    const variantCounts: Readonly<Record<string, number>> = CONTRACT_UNION_VARIANT_COUNTS;
    expect(Object.keys(schemas)).toEqual(Object.keys(CONTRACT_UNION_VARIANT_COUNTS));

    for (const [name, fixtures] of Object.entries(CONTRACT_UNION_FIXTURES.unions)) {
      const schema = schemas[name];
      const expectedVariants = variantCounts[name];
      expect(schema, `${name} schema`).toBeDefined();
      if (expectedVariants === undefined) {
        throw new Error(`${name} has no mechanically generated variant count`);
      }
      expect(fixtures).toHaveLength(expectedVariants);
      expect(
        fixtures.every((fixture) => matchesJsonSchema(fixture, schema as JsonSchema)),
        `${name} fixtures must satisfy their Rust schema`,
      ).toBe(true);

      const branches = schemaBranches(schema);
      expect(branches).toHaveLength(expectedVariants);
      for (const [index, branch] of branches.entries()) {
        expect(
          fixtures.some((fixture) =>
            matchesJsonSchema(fixture, branch as JsonSchema, schema as JsonSchema),
          ),
          `${name} branch ${index} has no concrete Rust fixture`,
        ).toBe(true);
      }
      if (asRecord(schema).oneOf !== undefined) {
        for (const fixture of fixtures) {
          expect(
            branches.filter((branch) =>
              matchesJsonSchema(fixture, branch as JsonSchema, schema as JsonSchema),
            ),
            `${name} fixture must map to exactly one oneOf branch`,
          ).toHaveLength(1);
        }
      }
    }
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

  it("sanitizes a nested AppError through the recovery event entry point", () => {
    const decoded = decodeEventEnvelope({
      ...eventBase,
      eventType: "recovery.snapshotFailed",
      scope: { kind: "document", documentId: "fixture-document" },
      sequence: 5,
      payload: {
        documentId: "fixture-document",
        error: {
          code: "ERR_FUTURE_READ_ONLY",
          message: "Future recovery error",
          retryable: false,
          correlationId: "fixture-correlation",
          recoveryActions: ["overwrite", "openSafetyPage", "futureAction"],
        },
      },
    });

    expect(decoded).toMatchObject({
      kind: "known",
      eventType: "recovery.snapshotFailed",
      envelope: {
        payload: {
          error: { recoveryActions: ["openSafetyPage"] },
        },
      },
    });
  });

  it("rejects an empty AppErrorCode through the recovery event entry point", () => {
    expect(
      decodeEventEnvelope({
        ...eventBase,
        eventType: "recovery.snapshotFailed",
        scope: { kind: "document", documentId: "fixture-document" },
        sequence: 6,
        payload: {
          documentId: "fixture-document",
          error: {
            code: "",
            message: "Invalid empty code",
            retryable: false,
            correlationId: "fixture-correlation",
          },
        },
      }),
    ).toBeNull();
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

  it("accepts exactly the Rust-derived workspace.filesChanged payload shape", () => {
    const event = {
      ...eventBase,
      eventType: "workspace.filesChanged",
      scope: { kind: "workspace", workspaceId: "fixture-workspace" },
      sequence: 3,
      payload: { generationHint: 1, overflow: false, changes: [] },
    };
    expect(decodeEventEnvelope(event)?.kind).toBe("known");
    expect(
      decodeEventEnvelope({
        ...event,
        payload: { generationCounter: 1, overflow: false, changes: [] },
      }),
    ).toBeNull();
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
      "explicit null optional string",
      { ...taskProgress, payload: { ...taskProgress.payload, messageKey: null } },
    ],
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

  it.each([
    [
      "modified external writeId",
      {
        change: "modified",
        documentId: "fixture-document",
        observedDiskRevision: { kind: "absent" },
        source: "external",
        writeId: "forbidden-write",
      },
    ],
    [
      "permissionChanged external writeId",
      {
        change: "permissionChanged",
        documentId: "fixture-document",
        readOnly: true,
        capabilityEpoch: 2,
        source: "external",
        writeId: "forbidden-write",
      },
    ],
  ])("rejects document.externalChanged with %s", (_name, payload) => {
    expect(
      decodeEventEnvelope({
        ...eventBase,
        eventType: "document.externalChanged",
        scope: { kind: "document", documentId: "fixture-document" },
        sequence: 4,
        payload,
      }),
    ).toBeNull();
  });

  it("rejects explicit null for an optional app.closeRequested counter", () => {
    expect(
      decodeEventEnvelope({
        ...eventBase,
        eventType: "app.closeRequested",
        scope: { kind: "app" },
        sequence: 5,
        payload: { closeRequestId: "fixture-close", deadlineUnixMs: null },
      }),
    ).toBeNull();
  });

  it("rejects an unknown write action by default", () => {
    expect(isKnownWriteAction("overwrite")).toBe(true);
    expect(isKnownWriteAction("futureDestructiveAction")).toBe(false);
  });
});
