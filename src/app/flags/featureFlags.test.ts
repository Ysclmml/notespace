import { describe, expect, expectTypeOf, it } from "vitest";

import type { AppFeatures } from "../../generated/ipc";
import {
  FEATURE_FLAG_DEFINITIONS,
  FEATURE_FLAG_IDS,
  FeatureFlagConfigurationError,
  createProductionFeatureFlagRegistry,
  mapAppFeaturesToFeatureCapabilities,
  type FeatureFlagConfigurationIssue,
  type FeatureFlagDefinition,
  type FeatureFlagId,
  type FeatureFlagState,
  type NativeFeatureCapability,
} from "./index";
import { createFeatureFlagRegistryForTest } from "./testing";

const ALL_CAPABILITIES: AppFeatures = {
  clipboardImage: true,
  splitView: true,
  recovery: true,
  mermaid: true,
};

function enabledSnapshot(
  registry: ReturnType<typeof createProductionFeatureFlagRegistry>,
): Record<FeatureFlagId, boolean> {
  return Object.fromEntries(
    registry.states.map((state) => [state.id, state.enabled]),
  ) as Record<FeatureFlagId, boolean>;
}

function replaceDefinition(
  flagId: FeatureFlagId,
  replacement: Partial<FeatureFlagDefinition>,
): readonly FeatureFlagDefinition[] {
  return FEATURE_FLAG_DEFINITIONS.map((definition) =>
    definition.id === flagId ? { ...definition, ...replacement } : definition,
  );
}

function captureConfigurationIssue(run: () => unknown): FeatureFlagConfigurationIssue {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(FeatureFlagConfigurationError);
  if (!(caught instanceof FeatureFlagConfigurationError)) {
    throw new Error("Expected FeatureFlagConfigurationError");
  }
  return caught.issue;
}

describe("UX-EXT-001 typed feature registry", () => {
  it("EXT-001 exposes exactly the 14 frozen canonical definitions", () => {
    expect(FEATURE_FLAG_IDS).toEqual([
      "editor.livePreview",
      "navigation.tabs",
      "navigation.history",
      "navigation.peek",
      "layout.splitView",
      "clipboard.imagePaste",
      "diagram.mermaidViewer",
      "table.renderedPreview",
      "table.structuredEditing",
      "safety.largeInputGuard",
      "safety.base64Repair",
      "performance.largeDocumentMode",
      "recovery.dirty",
      "session.restore",
    ]);
    expect(FEATURE_FLAG_DEFINITIONS.map(({ id }) => id)).toEqual(FEATURE_FLAG_IDS);
    expect(Object.isFrozen(FEATURE_FLAG_IDS)).toBe(true);
    expect(Object.isFrozen(FEATURE_FLAG_DEFINITIONS)).toBe(true);
    for (const definition of FEATURE_FLAG_DEFINITIONS) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.requires)).toBe(true);
      expect(Object.isFrozen(definition.requiresCapabilities)).toBe(true);
    }
  });

  it("EXT-002 uses fixed production defaults and has no production override parameter", () => {
    expectTypeOf(createProductionFeatureFlagRegistry).parameters.toEqualTypeOf<
      [AppFeatures]
    >();
    expect(createProductionFeatureFlagRegistry).toHaveLength(1);

    const registry = createProductionFeatureFlagRegistry(ALL_CAPABILITIES);
    const invokedWithUnexpectedSecondArgument = (
      createProductionFeatureFlagRegistry as unknown as (
        features: AppFeatures,
        ignoredOverrides: Readonly<Record<string, unknown>>,
      ) => ReturnType<typeof createProductionFeatureFlagRegistry>
    )(ALL_CAPABILITIES, { "safety.largeInputGuard": false });
    expect(enabledSnapshot(registry)).toEqual({
      "editor.livePreview": false,
      "navigation.tabs": false,
      "navigation.history": false,
      "navigation.peek": false,
      "layout.splitView": false,
      "clipboard.imagePaste": false,
      "diagram.mermaidViewer": false,
      "table.renderedPreview": false,
      "table.structuredEditing": false,
      "safety.largeInputGuard": true,
      "safety.base64Repair": false,
      "performance.largeDocumentMode": true,
      "recovery.dirty": true,
      "session.restore": false,
    });
    expect(registry.diagnostics).toEqual([]);
    expect(invokedWithUnexpectedSecondArgument.isEnabled("safety.largeInputGuard")).toBe(
      true,
    );
  });

  it("SEC-001 keeps fail-closed production flags enabled when runtime support exists", () => {
    const registry = createProductionFeatureFlagRegistry(ALL_CAPABILITIES);

    expect(registry.get("safety.largeInputGuard")).toMatchObject({
      enabled: true,
      requested: true,
      failClosed: true,
    });
    expect(registry.get("recovery.dirty")).toMatchObject({
      enabled: true,
      requested: true,
      failClosed: true,
    });
    expect(
      FEATURE_FLAG_DEFINITIONS.find(({ id }) => id === "session.restore")?.requires,
    ).toEqual(["navigation.tabs", "navigation.history"]);
    expect(
      FEATURE_FLAG_DEFINITIONS.find(({ id }) => id === "session.restore")?.requires,
    ).not.toContain("recovery.dirty");
  });

  it("CONTRACT-001 maps every generated AppFeatures field into a frozen availability record", () => {
    const input: AppFeatures = {
      clipboardImage: true,
      splitView: false,
      recovery: true,
      mermaid: false,
    };
    const mapped = mapAppFeaturesToFeatureCapabilities(input);

    expect(mapped).toEqual(input);
    expect(Object.keys(mapped).sort()).toEqual([
      "clipboardImage",
      "mermaid",
      "recovery",
      "splitView",
    ]);
    expect(Object.isFrozen(mapped)).toBe(true);
  });

  it("CONTRACT-002 enables a complete dependency graph only through the explicit test factory", () => {
    const registry = createFeatureFlagRegistryForTest({
      features: ALL_CAPABILITIES,
      overrides: Object.fromEntries(FEATURE_FLAG_IDS.map((flagId) => [flagId, true])),
    });

    expect(registry.states.every(({ enabled }) => enabled)).toBe(true);
    expect(registry.diagnostics).toEqual([]);
  });

  it("CONTRACT-003 resolves transitive dependencies without promoting blocked dependents", () => {
    const registry = createFeatureFlagRegistryForTest({
      features: ALL_CAPABILITIES,
      overrides: {
        "navigation.history": true,
        "session.restore": true,
        "table.renderedPreview": true,
        "table.structuredEditing": true,
      },
    });

    expect(registry.get("navigation.history")).toMatchObject({
      requested: true,
      enabled: false,
    });
    expect(registry.get("session.restore").diagnostics).toEqual([
      {
        code: "dependencyDisabled",
        flagId: "session.restore",
        dependencyId: "navigation.tabs",
      },
      {
        code: "dependencyDisabled",
        flagId: "session.restore",
        dependencyId: "navigation.history",
      },
    ]);
    expect(registry.get("table.renderedPreview").enabled).toBe(false);
    expect(registry.get("table.structuredEditing").diagnostics).toEqual([
      {
        code: "dependencyDisabled",
        flagId: "table.structuredEditing",
        dependencyId: "table.renderedPreview",
      },
    ]);
  });

  it("SEC-001 disables unavailable capabilities with stable diagnostics", () => {
    const registry = createFeatureFlagRegistryForTest({
      features: {
        clipboardImage: false,
        splitView: false,
        recovery: false,
        mermaid: false,
      },
      overrides: {
        "editor.livePreview": true,
        "navigation.tabs": true,
        "navigation.history": true,
        "layout.splitView": true,
        "clipboard.imagePaste": true,
        "diagram.mermaidViewer": true,
        "session.restore": true,
      },
    });

    expect(registry.diagnostics).toEqual([
      {
        code: "capabilityUnavailable",
        flagId: "layout.splitView",
        capabilityId: "splitView",
      },
      {
        code: "capabilityUnavailable",
        flagId: "clipboard.imagePaste",
        capabilityId: "clipboardImage",
      },
      {
        code: "capabilityUnavailable",
        flagId: "diagram.mermaidViewer",
        capabilityId: "mermaid",
      },
      {
        code: "capabilityUnavailable",
        flagId: "recovery.dirty",
        capabilityId: "recovery",
      },
      {
        code: "capabilityUnavailable",
        flagId: "session.restore",
        capabilityId: "recovery",
      },
    ]);
    expect(registry.isEnabled("safety.largeInputGuard")).toBe(true);
    expect(registry.isEnabled("performance.largeDocumentMode")).toBe(true);
  });

  it("OBS-001 returns deeply immutable states and diagnostics with only safe enum/id fields", () => {
    const features = { ...ALL_CAPABILITIES };
    const overrides: Record<string, unknown> = {
      "navigation.history": true,
      "clipboard.imagePaste": true,
    };
    const registry = createFeatureFlagRegistryForTest({ features, overrides });
    const state = registry.get("navigation.history");

    features.clipboardImage = false;
    overrides["navigation.history"] = false;

    expect(registry.isEnabled("clipboard.imagePaste")).toBe(true);
    expect(state.requested).toBe(true);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.definitions)).toBe(true);
    expect(Object.isFrozen(registry.states)).toBe(true);
    expect(Object.isFrozen(registry.diagnostics)).toBe(true);
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.diagnostics)).toBe(true);
    expect(() => (registry.states as FeatureFlagState[]).push(state)).toThrow(TypeError);
    expect(() => {
      (state as { enabled: boolean }).enabled = true;
    }).toThrow(TypeError);

    for (const diagnostic of registry.diagnostics) {
      expect(FEATURE_FLAG_IDS).toContain(diagnostic.flagId);
      if (diagnostic.code === "dependencyDisabled") {
        expect(Object.keys(diagnostic).sort()).toEqual(["code", "dependencyId", "flagId"]);
        expect(FEATURE_FLAG_IDS).toContain(diagnostic.dependencyId);
      } else {
        expect(Object.keys(diagnostic).sort()).toEqual(["capabilityId", "code", "flagId"]);
        expect(["clipboardImage", "splitView", "recovery", "mermaid"]).toContain(
          diagnostic.capabilityId,
        );
      }
      expect(Object.isFrozen(diagnostic)).toBe(true);
    }
  });

  it("OBS-001 canonicalizes state and diagnostic ordering for test definitions", () => {
    const options = {
      features: ALL_CAPABILITIES,
      overrides: {
        "navigation.history": true,
        "session.restore": true,
        "table.renderedPreview": true,
        "table.structuredEditing": true,
      },
    } as const;
    const canonical = createFeatureFlagRegistryForTest(options);
    const reversed = createFeatureFlagRegistryForTest({
      ...options,
      definitions: [...FEATURE_FLAG_DEFINITIONS].reverse(),
    });

    expect(reversed.states.map(({ id }) => id)).toEqual(FEATURE_FLAG_IDS);
    expect(reversed.diagnostics).toEqual(canonical.diagnostics);
  });
});

describe("CONTRACT-003 feature configuration validation", () => {
  it("rejects unknown and non-boolean overrides without retaining their values", () => {
    expect(
      captureConfigurationIssue(() =>
        createFeatureFlagRegistryForTest({
          features: ALL_CAPABILITIES,
          overrides: { "future.flag": true },
        }),
      ),
    ).toEqual({ code: "unknownOverride", flagId: "future.flag" });

    const privateInput = Object.freeze({ opaque: "must-not-appear" });
    const issue = captureConfigurationIssue(() =>
      createFeatureFlagRegistryForTest({
        features: ALL_CAPABILITIES,
        overrides: { "navigation.tabs": privateInput },
      }),
    );
    expect(issue).toEqual({
      code: "invalidOverrideType",
      flagId: "navigation.tabs",
    });
    expect(JSON.stringify(issue)).not.toContain("must-not-appear");
  });

  it("rejects self dependencies", () => {
    const issue = captureConfigurationIssue(() =>
      createFeatureFlagRegistryForTest({
        features: ALL_CAPABILITIES,
        definitions: replaceDefinition("navigation.tabs", {
          requires: ["navigation.tabs"],
        }),
      }),
    );

    expect(issue).toEqual({ code: "selfDependency", flagId: "navigation.tabs" });
  });

  it("rejects dependency cycles with a deterministic cycle", () => {
    const historyCycle = replaceDefinition("navigation.history", {
      requires: ["navigation.peek"],
    }).map((definition) =>
      definition.id === "navigation.peek"
        ? { ...definition, requires: ["navigation.history"] as const }
        : definition,
    );
    const issue = captureConfigurationIssue(() =>
      createFeatureFlagRegistryForTest({
        features: ALL_CAPABILITIES,
        definitions: historyCycle,
      }),
    );

    expect(issue).toEqual({
      code: "dependencyCycle",
      flagId: "navigation.history",
      cycle: ["navigation.history", "navigation.peek", "navigation.history"],
    });
    if (issue.code === "dependencyCycle") expect(Object.isFrozen(issue.cycle)).toBe(true);
  });

  it("rejects missing dependencies before producing a partial registry", () => {
    const definitions = FEATURE_FLAG_DEFINITIONS.filter(
      ({ id }) => id !== "navigation.tabs",
    );
    const issue = captureConfigurationIssue(() =>
      createFeatureFlagRegistryForTest({
        features: ALL_CAPABILITIES,
        definitions,
      }),
    );

    expect(issue).toEqual({
      code: "missingDependency",
      flagId: "navigation.history",
      dependencyId: "navigation.tabs",
    });
  });

  it("rejects duplicate, incomplete, unknown-capability, and unsafe fail-closed definitions", () => {
    const duplicateIssue = captureConfigurationIssue(() =>
      createFeatureFlagRegistryForTest({
        features: ALL_CAPABILITIES,
        definitions: [...FEATURE_FLAG_DEFINITIONS, FEATURE_FLAG_DEFINITIONS[0]!],
      }),
    );
    expect(duplicateIssue).toEqual({
      code: "duplicateDefinition",
      flagId: "editor.livePreview",
    });

    const missingIssue = captureConfigurationIssue(() =>
      createFeatureFlagRegistryForTest({
        features: ALL_CAPABILITIES,
        definitions: FEATURE_FLAG_DEFINITIONS.filter(
          ({ id }) => id !== "safety.base64Repair",
        ),
      }),
    );
    expect(missingIssue).toEqual({
      code: "missingDefinition",
      flagId: "safety.base64Repair",
    });

    const capabilityIssue = captureConfigurationIssue(() =>
      createFeatureFlagRegistryForTest({
        features: ALL_CAPABILITIES,
        definitions: replaceDefinition("layout.splitView", {
          requiresCapabilities: ["futureCapability" as NativeFeatureCapability],
        }),
      }),
    );
    expect(capabilityIssue).toEqual({
      code: "unknownCapability",
      flagId: "layout.splitView",
      capabilityId: "futureCapability",
    });

    const failClosedIssue = captureConfigurationIssue(() =>
      createFeatureFlagRegistryForTest({
        features: ALL_CAPABILITIES,
        definitions: replaceDefinition("safety.largeInputGuard", {
          productionDefault: false,
        }),
      }),
    );
    expect(failClosedIssue).toEqual({
      code: "failClosedDefaultDisabled",
      flagId: "safety.largeInputGuard",
    });
  });

  it("rejects non-boolean generated capability values at the registry boundary", () => {
    const issue = captureConfigurationIssue(() =>
      createProductionFeatureFlagRegistry({
        ...ALL_CAPABILITIES,
        recovery: "yes",
      } as unknown as AppFeatures),
    );

    expect(issue).toEqual({
      code: "invalidCapabilityType",
      capabilityId: "recovery",
    });
  });
});
