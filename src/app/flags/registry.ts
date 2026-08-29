import type { AppFeatures } from "../../generated/ipc";
import { FEATURE_FLAG_DEFINITIONS } from "./definitions";
import {
  FEATURE_FLAG_IDS,
  FeatureFlagConfigurationError,
  type FeatureCapabilityAvailability,
  type FeatureFlagDefinition,
  type FeatureFlagDiagnostic,
  type FeatureFlagId,
  type FeatureFlagRegistry,
  type FeatureFlagState,
  type NativeFeatureCapability,
} from "./model";

const FEATURE_FLAG_ID_SET: ReadonlySet<string> = new Set(FEATURE_FLAG_IDS);
const FEATURE_FLAG_ORDER = new Map(
  FEATURE_FLAG_IDS.map((flagId, index) => [flagId, index] as const),
);
const FAIL_CLOSED_FLAG_IDS = Object.freeze([
  "safety.largeInputGuard",
  "recovery.dirty",
] as const satisfies readonly FeatureFlagId[]);
const APP_FEATURE_CAPABILITY_READERS: Readonly<{
  [Capability in keyof AppFeatures]: (features: AppFeatures) => boolean;
}> = Object.freeze({
  clipboardImage: (features: AppFeatures) => features.clipboardImage,
  splitView: (features: AppFeatures) => features.splitView,
  recovery: (features: AppFeatures) => features.recovery,
  mermaid: (features: AppFeatures) => features.mermaid,
});
const NATIVE_FEATURE_CAPABILITY_SET: ReadonlySet<string> = new Set(
  Object.keys(APP_FEATURE_CAPABILITY_READERS),
);

function isFeatureFlagId(value: string): value is FeatureFlagId {
  return FEATURE_FLAG_ID_SET.has(value);
}

function flagOrder(flagId: FeatureFlagId): number {
  return FEATURE_FLAG_ORDER.get(flagId) ?? Number.MAX_SAFE_INTEGER;
}

function cloneAndValidateDefinitions(
  source: readonly FeatureFlagDefinition[],
): readonly FeatureFlagDefinition[] {
  const seen = new Set<FeatureFlagId>();
  const cloned: FeatureFlagDefinition[] = [];

  for (const sourceDefinition of source) {
    const rawDefinition = sourceDefinition as unknown as {
      id?: unknown;
      productionDefault?: unknown;
      requires?: unknown;
      requiresCapabilities?: unknown;
      failClosed?: unknown;
    };
    const rawId = rawDefinition.id;

    if (typeof rawId !== "string" || !isFeatureFlagId(rawId)) {
      throw new FeatureFlagConfigurationError({
        code: "unknownDefinition",
        flagId: typeof rawId === "string" ? rawId : "unrecognized",
      });
    }
    if (seen.has(rawId)) {
      throw new FeatureFlagConfigurationError({
        code: "duplicateDefinition",
        flagId: rawId,
      });
    }
    if (
      typeof rawDefinition.productionDefault !== "boolean" ||
      typeof rawDefinition.failClosed !== "boolean" ||
      !Array.isArray(rawDefinition.requires) ||
      !Array.isArray(rawDefinition.requiresCapabilities)
    ) {
      throw new FeatureFlagConfigurationError({
        code: "invalidDefinitionType",
        flagId: rawId,
      });
    }

    const requires = rawDefinition.requires.map((dependencyId) => {
      if (typeof dependencyId !== "string" || !isFeatureFlagId(dependencyId)) {
        throw new FeatureFlagConfigurationError({
          code: "missingDependency",
          flagId: rawId,
          dependencyId: typeof dependencyId === "string" ? dependencyId : "unrecognized",
        });
      }
      return dependencyId;
    });
    const requiresCapabilities = rawDefinition.requiresCapabilities.map((capabilityId) => {
      if (
        typeof capabilityId !== "string" ||
        !NATIVE_FEATURE_CAPABILITY_SET.has(capabilityId)
      ) {
        throw new FeatureFlagConfigurationError({
          code: "unknownCapability",
          flagId: rawId,
          capabilityId: typeof capabilityId === "string" ? capabilityId : "unrecognized",
        });
      }
      return capabilityId as NativeFeatureCapability;
    });

    seen.add(rawId);
    cloned.push(
      Object.freeze({
        id: rawId,
        productionDefault: rawDefinition.productionDefault,
        requires: Object.freeze(
          [...requires].sort((left, right) => flagOrder(left) - flagOrder(right)),
        ),
        requiresCapabilities: Object.freeze([...requiresCapabilities].sort()),
        failClosed: rawDefinition.failClosed,
      }),
    );
  }

  const byId = new Map(cloned.map((definition) => [definition.id, definition]));

  for (const definition of cloned) {
    for (const dependencyId of definition.requires) {
      if (dependencyId === definition.id) {
        throw new FeatureFlagConfigurationError({
          code: "selfDependency",
          flagId: definition.id,
        });
      }
      if (!byId.has(dependencyId)) {
        throw new FeatureFlagConfigurationError({
          code: "missingDependency",
          flagId: definition.id,
          dependencyId,
        });
      }
    }
  }

  const visitState = new Map<FeatureFlagId, "visiting" | "visited">();
  const visitPath: FeatureFlagId[] = [];

  const visit = (flagId: FeatureFlagId): void => {
    const state = visitState.get(flagId);
    if (state === "visited") return;
    if (state === "visiting") {
      const cycleStart = visitPath.indexOf(flagId);
      const cycle = [...visitPath.slice(cycleStart), flagId];
      throw new FeatureFlagConfigurationError({
        code: "dependencyCycle",
        flagId,
        cycle,
      });
    }

    visitState.set(flagId, "visiting");
    visitPath.push(flagId);
    const definition = byId.get(flagId);
    if (definition === undefined) {
      throw new FeatureFlagConfigurationError({
        code: "missingDefinition",
        flagId,
      });
    }
    for (const dependencyId of definition.requires) visit(dependencyId);
    visitPath.pop();
    visitState.set(flagId, "visited");
  };

  for (const definition of [...cloned].sort(
    (left, right) => flagOrder(left.id) - flagOrder(right.id),
  )) {
    visit(definition.id);
  }

  for (const flagId of FEATURE_FLAG_IDS) {
    if (!byId.has(flagId)) {
      throw new FeatureFlagConfigurationError({ code: "missingDefinition", flagId });
    }
  }

  for (const flagId of FAIL_CLOSED_FLAG_IDS) {
    const definition = byId.get(flagId);
    if (definition?.failClosed !== true || definition.productionDefault !== true) {
      throw new FeatureFlagConfigurationError({
        code: "failClosedDefaultDisabled",
        flagId,
      });
    }
  }

  return Object.freeze(
    [...cloned].sort((left, right) => flagOrder(left.id) - flagOrder(right.id)),
  );
}

export function mapAppFeaturesToFeatureCapabilities(
  features: AppFeatures,
): FeatureCapabilityAvailability {
  const mapped = Object.fromEntries(
    Object.entries(APP_FEATURE_CAPABILITY_READERS).map(([capabilityId, readCapability]) => [
      capabilityId,
      readCapability(features),
    ]),
  ) as { [Capability in keyof AppFeatures]: boolean };

  for (const capabilityId of Object.keys(mapped).sort()) {
    const capability = mapped[capabilityId as NativeFeatureCapability];
    if (typeof capability !== "boolean") {
      throw new FeatureFlagConfigurationError({
        code: "invalidCapabilityType",
        capabilityId,
      });
    }
  }

  return Object.freeze(mapped);
}

function createRequestedValues(
  definitions: readonly FeatureFlagDefinition[],
  overrides?: Readonly<Record<string, unknown>>,
): ReadonlyMap<FeatureFlagId, boolean> {
  const requested = new Map(
    definitions.map((definition) => [definition.id, definition.productionDefault] as const),
  );

  if (overrides === undefined) return requested;

  for (const rawFlagId of Object.keys(overrides).sort()) {
    if (!isFeatureFlagId(rawFlagId) || !requested.has(rawFlagId)) {
      throw new FeatureFlagConfigurationError({
        code: "unknownOverride",
        flagId: rawFlagId,
      });
    }
    const override = overrides[rawFlagId];
    if (typeof override !== "boolean") {
      throw new FeatureFlagConfigurationError({
        code: "invalidOverrideType",
        flagId: rawFlagId,
      });
    }
    requested.set(rawFlagId, override);
  }

  return requested;
}

interface RegistryBuildOptions {
  readonly features: AppFeatures;
  readonly definitions: readonly FeatureFlagDefinition[];
  readonly overrides?: Readonly<Record<string, unknown>>;
}

export function buildFeatureFlagRegistry({
  features,
  definitions: sourceDefinitions,
  overrides,
}: RegistryBuildOptions): FeatureFlagRegistry {
  const capabilities = mapAppFeaturesToFeatureCapabilities(features);
  const definitions = cloneAndValidateDefinitions(sourceDefinitions);
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition] as const),
  );
  const requested = createRequestedValues(definitions, overrides);
  const resolved = new Map<FeatureFlagId, FeatureFlagState>();

  const resolve = (flagId: FeatureFlagId): FeatureFlagState => {
    const existing = resolved.get(flagId);
    if (existing !== undefined) return existing;

    const definition = definitionById.get(flagId);
    const requestedValue = requested.get(flagId);
    if (definition === undefined || requestedValue === undefined) {
      throw new FeatureFlagConfigurationError({
        code: "missingDefinition",
        flagId,
      });
    }

    const diagnostics: FeatureFlagDiagnostic[] = [];
    if (requestedValue) {
      for (const capabilityId of definition.requiresCapabilities) {
        if (!capabilities[capabilityId]) {
          diagnostics.push(
            Object.freeze({
              code: "capabilityUnavailable",
              flagId,
              capabilityId,
            }),
          );
        }
      }
      for (const dependencyId of definition.requires) {
        if (!resolve(dependencyId).enabled) {
          diagnostics.push(
            Object.freeze({
              code: "dependencyDisabled",
              flagId,
              dependencyId,
            }),
          );
        }
      }
    }

    const state = Object.freeze({
      id: flagId,
      productionDefault: definition.productionDefault,
      requested: requestedValue,
      enabled: requestedValue && diagnostics.length === 0,
      failClosed: definition.failClosed,
      diagnostics: Object.freeze(diagnostics),
    });
    resolved.set(flagId, state);
    return state;
  };

  const states = Object.freeze(FEATURE_FLAG_IDS.map(resolve));
  const diagnostics = Object.freeze(states.flatMap((state) => [...state.diagnostics]));

  return Object.freeze({
    definitions,
    states,
    diagnostics,
    get(flagId: FeatureFlagId): FeatureFlagState {
      return resolve(flagId);
    },
    isEnabled(flagId: FeatureFlagId): boolean {
      return resolve(flagId).enabled;
    },
  });
}

/**
 * Builds the shipped rollout policy from native/runtime availability only.
 * Safety enforcement remains a Rust invariant; this registry never authorizes
 * bypassing preflight, recovery, or other native safety checks.
 */
export function createProductionFeatureFlagRegistry(
  features: AppFeatures,
): FeatureFlagRegistry {
  return buildFeatureFlagRegistry({
    features,
    definitions: FEATURE_FLAG_DEFINITIONS,
  });
}
