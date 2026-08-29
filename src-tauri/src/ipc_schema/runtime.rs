//! Generic TypeScript JSON-Schema evaluator and fail-closed envelope policy.
//! Event payload fields live only in the schemas derived from Rust serde types.

pub const TYPESCRIPT_RUNTIME: &str = r##"
type JsonRecord = Record<string, unknown>;

export type JsonSchema = boolean | JsonRecord;

export interface EventPayloadSchemaSet {
  schemaVersion: 1;
  apiVersion: ApiVersion;
  generatedBy: string;
  appError: JsonSchema;
  recoveryActions: readonly RecoveryAction[];
  readOnlyRecoveryActions: readonly RecoveryAction[];
  scope: JsonSchema;
  events: Record<IpcEventType, JsonSchema>;
}

export interface ContractUnionFixtureSet {
  schemaVersion: 1;
  apiVersion: ApiVersion;
  generatedBy: string;
  variantCounts: Record<string, number>;
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

export const RECOVERY_ACTIONS = IPC_EVENT_PAYLOAD_SCHEMAS.recoveryActions;
export const READ_ONLY_RECOVERY_ACTIONS =
  IPC_EVENT_PAYLOAD_SCHEMAS.readOnlyRecoveryActions;

const INVALID_SCHEMA_VALUE = Symbol("invalid JSON Schema value");
type DecodedSchemaValue = unknown | typeof INVALID_SCHEMA_VALUE;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === "boolean" || isRecord(value);
}

function hasOwn(value: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
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
    (RECOVERY_ACTIONS as readonly string[]).includes(value)
  );
}

export function decodeAppError(value: unknown): DecodedAppError | null {
  const decoded = decodeSchemaInternal(
    value,
    IPC_EVENT_PAYLOAD_SCHEMAS.appError,
    IPC_EVENT_PAYLOAD_SCHEMAS.appError,
    false,
  );
  if (decoded === INVALID_SCHEMA_VALUE || !isRecord(decoded)) return null;

  const openError = decoded as JsonRecord & {
    code: string;
    recoveryActions?: readonly unknown[];
  };
  const knownCode = isKnownAppErrorCode(openError.code);
  const knownActions = openError.recoveryActions?.filter(isKnownRecoveryAction);
  const recoveryActions = knownCode
    ? knownActions
    : knownActions?.filter((action) =>
        (READ_ONLY_RECOVERY_ACTIONS as readonly string[]).includes(action),
      );
  const error = {
    ...openError,
    ...(openError.recoveryActions === undefined ? {} : { recoveryActions }),
  } as unknown as AppError;
  return { error, knownCode };
}

function jsonEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => jsonEquals(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) => hasOwn(right, key) && jsonEquals(left[key], right[key]))
    );
  }
  return false;
}

function resolveJsonPointer(root: JsonSchema, reference: string): JsonSchema | null {
  if (!reference.startsWith("#/")) return null;
  let current: unknown = root;
  for (const encodedToken of reference.slice(2).split("/")) {
    if (!isRecord(current)) return null;
    const token = encodedToken.replaceAll("~1", "/").replaceAll("~0", "~");
    current = current[token];
  }
  return typeof current === "boolean" || isRecord(current) ? current : null;
}

function referenceName(reference: string): string | null {
  const token = reference.split("/").at(-1);
  return token === undefined
    ? null
    : token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    default:
      return false;
  }
}

function matchesDeclaredType(value: unknown, declaredType: unknown): boolean {
  if (typeof declaredType === "string") return matchesType(value, declaredType);
  return (
    Array.isArray(declaredType) &&
    declaredType.every((type) => typeof type === "string") &&
    declaredType.some((type) => matchesType(value, type))
  );
}

function decodeObjectKeywords(
  value: JsonRecord,
  schema: JsonRecord,
  root: JsonSchema,
  normalizeAppErrorReferences: boolean,
): DecodedSchemaValue {
  const required = schema.required;
  if (
    required !== undefined &&
    (!Array.isArray(required) ||
      !required.every((key) => typeof key === "string" && hasOwn(value, key)))
  ) {
    return INVALID_SCHEMA_VALUE;
  }

  const properties = schema.properties;
  if (properties !== undefined && !isRecord(properties)) return INVALID_SCHEMA_VALUE;
  const decoded: JsonRecord = { ...value };
  if (isRecord(properties)) {
    for (const [name, propertySchema] of Object.entries(properties)) {
      if (!hasOwn(value, name)) continue;
      if (!(typeof propertySchema === "boolean" || isRecord(propertySchema))) {
        return INVALID_SCHEMA_VALUE;
      }
      const property = decodeSchemaInternal(
        value[name],
        propertySchema,
        root,
        normalizeAppErrorReferences,
      );
      if (property === INVALID_SCHEMA_VALUE) return INVALID_SCHEMA_VALUE;
      decoded[name] = property;
    }
  }

  const additional = schema.additionalProperties;
  if (additional !== undefined) {
    const knownProperties = new Set(isRecord(properties) ? Object.keys(properties) : []);
    for (const [name, additionalValue] of Object.entries(value)) {
      if (knownProperties.has(name)) continue;
      if (additional === false) return INVALID_SCHEMA_VALUE;
      if (additional === true) continue;
      if (!isRecord(additional)) return INVALID_SCHEMA_VALUE;
      const property = decodeSchemaInternal(
        additionalValue,
        additional,
        root,
        normalizeAppErrorReferences,
      );
      if (property === INVALID_SCHEMA_VALUE) return INVALID_SCHEMA_VALUE;
      decoded[name] = property;
    }
  }
  return decoded;
}

function decodeArrayKeywords(
  value: readonly unknown[],
  schema: JsonRecord,
  root: JsonSchema,
  normalizeAppErrorReferences: boolean,
): DecodedSchemaValue {
  if (
    (typeof schema.minItems === "number" && value.length < schema.minItems) ||
    (typeof schema.maxItems === "number" && value.length > schema.maxItems)
  ) {
    return INVALID_SCHEMA_VALUE;
  }
  const decoded = [...value];
  const prefixItems = schema.prefixItems;
  if (prefixItems !== undefined) {
    if (!Array.isArray(prefixItems)) return INVALID_SCHEMA_VALUE;
    for (let index = 0; index < Math.min(prefixItems.length, value.length); index += 1) {
      const itemSchema = prefixItems[index];
      if (!(typeof itemSchema === "boolean" || isRecord(itemSchema))) {
        return INVALID_SCHEMA_VALUE;
      }
      const item = decodeSchemaInternal(
        value[index],
        itemSchema,
        root,
        normalizeAppErrorReferences,
      );
      if (item === INVALID_SCHEMA_VALUE) return INVALID_SCHEMA_VALUE;
      decoded[index] = item;
    }
  }
  const items = schema.items;
  if (items !== undefined) {
    if (!(typeof items === "boolean" || isRecord(items))) return INVALID_SCHEMA_VALUE;
    const start = Array.isArray(prefixItems) ? prefixItems.length : 0;
    for (let index = start; index < value.length; index += 1) {
      const item = decodeSchemaInternal(
        value[index],
        items,
        root,
        normalizeAppErrorReferences,
      );
      if (item === INVALID_SCHEMA_VALUE) return INVALID_SCHEMA_VALUE;
      decoded[index] = item;
    }
  }
  return decoded;
}

function decodeSchemaInternal(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  normalizeAppErrorReferences = true,
): DecodedSchemaValue {
  if (schema === true) return value;
  if (schema === false) return INVALID_SCHEMA_VALUE;

  const reference = schema.$ref;
  let decodedFromReference: DecodedSchemaValue = value;
  if (reference !== undefined) {
    if (typeof reference !== "string") return INVALID_SCHEMA_VALUE;
    const resolved = resolveJsonPointer(root, reference);
    if (resolved === null) return INVALID_SCHEMA_VALUE;
    if (normalizeAppErrorReferences && referenceName(reference) === "AppError") {
      const decodedError = decodeAppError(value);
      if (decodedError === null) return INVALID_SCHEMA_VALUE;
      decodedFromReference = decodeSchemaInternal(
        decodedError.error,
        resolved,
        root,
        false,
      );
    } else {
      decodedFromReference = decodeSchemaInternal(
        value,
        resolved,
        root,
        normalizeAppErrorReferences,
      );
    }
    if (decodedFromReference === INVALID_SCHEMA_VALUE) return INVALID_SCHEMA_VALUE;
  }
  value = decodedFromReference;

  if (hasOwn(schema, "const") && !jsonEquals(value, schema.const)) {
    return INVALID_SCHEMA_VALUE;
  }
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) || !schema.enum.some((item) => jsonEquals(value, item)))
  ) {
    return INVALID_SCHEMA_VALUE;
  }
  if (schema.type !== undefined && !matchesDeclaredType(value, schema.type)) {
    return INVALID_SCHEMA_VALUE;
  }

  if (typeof value === "number") {
    if (
      (typeof schema.minimum === "number" && value < schema.minimum) ||
      (typeof schema.maximum === "number" && value > schema.maximum) ||
      (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) ||
      (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum)
    ) {
      return INVALID_SCHEMA_VALUE;
    }
  }
  if (typeof value === "string") {
    if (
      (typeof schema.minLength === "number" && value.length < schema.minLength) ||
      (typeof schema.maxLength === "number" && value.length > schema.maxLength)
    ) {
      return INVALID_SCHEMA_VALUE;
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern, "u").test(value)) return INVALID_SCHEMA_VALUE;
      } catch {
        return INVALID_SCHEMA_VALUE;
      }
    }
  }

  let decoded: DecodedSchemaValue = value;
  if (isRecord(value)) {
    decoded = decodeObjectKeywords(value, schema, root, normalizeAppErrorReferences);
    if (decoded === INVALID_SCHEMA_VALUE) return INVALID_SCHEMA_VALUE;
  } else if (Array.isArray(value)) {
    decoded = decodeArrayKeywords(value, schema, root, normalizeAppErrorReferences);
    if (decoded === INVALID_SCHEMA_VALUE) return INVALID_SCHEMA_VALUE;
  }

  const notSchema = schema.not;
  if (notSchema !== undefined) {
    if (!(typeof notSchema === "boolean" || isRecord(notSchema))) {
      return INVALID_SCHEMA_VALUE;
    }
    if (
      decodeSchemaInternal(decoded, notSchema, root, normalizeAppErrorReferences) !==
      INVALID_SCHEMA_VALUE
    ) {
      return INVALID_SCHEMA_VALUE;
    }
  }

  const allOf = schema.allOf;
  if (allOf !== undefined) {
    if (!Array.isArray(allOf)) return INVALID_SCHEMA_VALUE;
    for (const branch of allOf) {
      if (!(typeof branch === "boolean" || isRecord(branch))) return INVALID_SCHEMA_VALUE;
      decoded = decodeSchemaInternal(
        decoded,
        branch,
        root,
        normalizeAppErrorReferences,
      );
      if (decoded === INVALID_SCHEMA_VALUE) return INVALID_SCHEMA_VALUE;
    }
  }

  const anyOf = schema.anyOf;
  if (anyOf !== undefined) {
    if (
      !Array.isArray(anyOf) ||
      anyOf.length === 0 ||
      !anyOf.every(isJsonSchema)
    ) {
      return INVALID_SCHEMA_VALUE;
    }
    const candidates = anyOf
      .map((branch) =>
        decodeSchemaInternal(decoded, branch, root, normalizeAppErrorReferences),
      )
      .filter((candidate) => candidate !== INVALID_SCHEMA_VALUE);
    if (candidates.length === 0) return INVALID_SCHEMA_VALUE;
    decoded = candidates[0];
  }

  const oneOf = schema.oneOf;
  if (oneOf !== undefined) {
    if (
      !Array.isArray(oneOf) ||
      oneOf.length === 0 ||
      !oneOf.every(isJsonSchema)
    ) {
      return INVALID_SCHEMA_VALUE;
    }
    const candidates = oneOf
      .map((branch) =>
        decodeSchemaInternal(decoded, branch, root, normalizeAppErrorReferences),
      )
      .filter((candidate) => candidate !== INVALID_SCHEMA_VALUE);
    if (candidates.length !== 1) return INVALID_SCHEMA_VALUE;
    decoded = candidates[0];
  }

  return decoded;
}

export function matchesJsonSchema(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema = schema,
): boolean {
  return decodeSchemaInternal(value, schema, root) !== INVALID_SCHEMA_VALUE;
}

function scopeIdentityMatchesPayload(
  spec: (typeof IPC_EVENT_SPECS)[number],
  scope: unknown,
  payload: unknown,
): boolean {
  if (spec.identityField === null) return true;
  if (!isRecord(scope) || !isRecord(payload) || typeof scope.kind !== "string") return false;
  const scopeIdentityField = `${scope.kind}Id`;
  return scope[scopeIdentityField] === payload[spec.identityField];
}

export function decodeEventEnvelope(value: unknown): DecodedEventEnvelope | null {
  if (
    !isRecord(value) ||
    value.apiVersion !== IPC_API_VERSION ||
    typeof value.eventId !== "string" ||
    typeof value.eventType !== "string" ||
    typeof value.emittedAt !== "string" ||
    !isJsSafeUnsignedInteger(value.sequence) ||
    !hasOwn(value, "payload")
  ) {
    return null;
  }

  const decodedScope = decodeSchemaInternal(
    value.scope,
    IPC_EVENT_PAYLOAD_SCHEMAS.scope,
    IPC_EVENT_PAYLOAD_SCHEMAS.scope,
  );
  if (decodedScope === INVALID_SCHEMA_VALUE) return null;

  const spec = IPC_EVENT_SPECS.find((candidate) => candidate.eventType === value.eventType);
  if (!spec) {
    return {
      kind: "unknown",
      eventType: value.eventType,
      envelope: { ...value, scope: decodedScope } as unknown as EventEnvelope<unknown>,
    };
  }
  if (!isRecord(decodedScope) || decodedScope.kind !== spec.scopeKind) return null;

  const eventType = value.eventType as IpcEventType;
  const payloadSchema = IPC_EVENT_PAYLOAD_SCHEMAS.events[eventType];
  const decodedPayload = decodeSchemaInternal(value.payload, payloadSchema, payloadSchema);
  if (
    decodedPayload === INVALID_SCHEMA_VALUE ||
    !scopeIdentityMatchesPayload(spec, decodedScope, decodedPayload)
  ) {
    return null;
  }
  return {
    kind: "known",
    eventType,
    envelope: {
      ...value,
      scope: decodedScope,
      payload: decodedPayload,
    } as unknown as KnownEventEnvelope,
  };
}
"##;
