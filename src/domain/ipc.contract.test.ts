import { describe, expect, it } from "vitest";

import fixtureJson from "../../contracts/generated/ipc-v1-union-fixtures.json?raw";
import {
  CONTRACT_UNION_SPECS,
  decodeAppError,
  decodeEventEnvelope,
  IPC_API_VERSION,
  IPC_COMMAND_SPECS,
  IPC_EVENT_SPECS,
  isKnownWriteAction,
  KNOWN_APP_ERROR_CODES,
  type ContractUnionFixtureSet,
  validateContractUnionFixture,
} from "../generated/ipc";

describe("CONTRACT-001 generated IPC catalog", () => {
  it("exports the canonical command, event and known-error sets", () => {
    expect(IPC_COMMAND_SPECS).toHaveLength(37);
    expect(new Set(IPC_COMMAND_SPECS.map((command) => command.name)).size).toBe(37);
    expect(IPC_EVENT_SPECS).toHaveLength(8);
    expect(KNOWN_APP_ERROR_CODES).toHaveLength(24);
  });
});

describe("CONTRACT-002 Rust serde to TypeScript union fixtures", () => {
  it("accepts every canonical discriminator variant and required field set", () => {
    const fixtureSet = JSON.parse(fixtureJson) as ContractUnionFixtureSet;
    expect(fixtureSet.apiVersion).toBe(IPC_API_VERSION);

    for (const union of CONTRACT_UNION_SPECS) {
      const fixtures = fixtureSet.unions[union.name];
      expect(fixtures, union.name).toHaveLength(union.variants.length);
      for (const fixture of fixtures ?? []) {
        expect(validateContractUnionFixture(union.name, fixture), union.name).toBe(true);
      }
    }
  });
});

describe("CONTRACT-003 forward compatibility and fail-closed writes", () => {
  it("preserves an unknown error code without treating it as known", () => {
    const decoded = decodeAppError({
      code: "ERR_FUTURE_READ_ONLY",
      message: "Future error",
      retryable: false,
      correlationId: "synthetic-correlation",
      futureOptionalField: { version: 2 },
    });

    expect(decoded?.knownCode).toBe(false);
    expect(decoded?.error.code).toBe("ERR_FUTURE_READ_ONLY");
  });

  it("returns an unknown event envelope instead of throwing", () => {
    const decoded = decodeEventEnvelope({
      apiVersion: "1.0",
      eventId: "synthetic-event",
      eventType: "future.readOnlyNotification",
      emittedAt: "2030-01-01T00:00:00Z",
      scope: { kind: "app" },
      sequence: 1,
      payload: { future: true },
      futureOptionalField: "ignored",
    });

    expect(decoded?.kind).toBe("unknown");
    expect(decoded?.eventType).toBe("future.readOnlyNotification");
  });

  it("tolerates an unknown optional field on a known event", () => {
    const decoded = decodeEventEnvelope({
      apiVersion: "1.0",
      eventId: "synthetic-event",
      eventType: "task.progress",
      emittedAt: "2030-01-01T00:00:00Z",
      scope: { kind: "operation", operationId: "synthetic-operation" },
      sequence: 2,
      payload: { operationId: "synthetic-operation", phase: "scan" },
      futureOptionalField: 2,
    });

    expect(decoded?.kind).toBe("known");
  });

  it("rejects an unknown write action by default", () => {
    expect(isKnownWriteAction("overwrite")).toBe(true);
    expect(isKnownWriteAction("futureDestructiveAction")).toBe(false);
  });
});
