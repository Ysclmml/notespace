import type { AppFeatures } from "../../generated/ipc";

export const FEATURE_FLAG_IDS = Object.freeze([
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
] as const);

export type FeatureFlagId = (typeof FEATURE_FLAG_IDS)[number];
export type NativeFeatureCapability = keyof AppFeatures;

export type FeatureCapabilityAvailability = Readonly<{
  [Capability in NativeFeatureCapability]: boolean;
}>;

export interface FeatureFlagDefinition {
  readonly id: FeatureFlagId;
  readonly productionDefault: boolean;
  readonly requires: readonly FeatureFlagId[];
  readonly requiresCapabilities: readonly NativeFeatureCapability[];
  readonly failClosed: boolean;
}

export type FeatureFlagDiagnostic =
  | Readonly<{
      code: "dependencyDisabled";
      flagId: FeatureFlagId;
      dependencyId: FeatureFlagId;
    }>
  | Readonly<{
      code: "capabilityUnavailable";
      flagId: FeatureFlagId;
      capabilityId: NativeFeatureCapability;
    }>;

export interface FeatureFlagState {
  readonly id: FeatureFlagId;
  readonly productionDefault: boolean;
  readonly requested: boolean;
  readonly enabled: boolean;
  readonly failClosed: boolean;
  readonly diagnostics: readonly FeatureFlagDiagnostic[];
}

export interface FeatureFlagRegistry {
  readonly definitions: readonly FeatureFlagDefinition[];
  readonly states: readonly FeatureFlagState[];
  readonly diagnostics: readonly FeatureFlagDiagnostic[];
  get(flagId: FeatureFlagId): FeatureFlagState;
  isEnabled(flagId: FeatureFlagId): boolean;
}

export type FeatureFlagConfigurationIssue =
  | Readonly<{ code: "unknownDefinition"; flagId: string }>
  | Readonly<{ code: "duplicateDefinition"; flagId: string }>
  | Readonly<{ code: "missingDefinition"; flagId: FeatureFlagId }>
  | Readonly<{ code: "invalidDefinitionType"; flagId: string }>
  | Readonly<{ code: "selfDependency"; flagId: FeatureFlagId }>
  | Readonly<{
      code: "missingDependency";
      flagId: FeatureFlagId;
      dependencyId: string;
    }>
  | Readonly<{
      code: "dependencyCycle";
      flagId: FeatureFlagId;
      cycle: readonly FeatureFlagId[];
    }>
  | Readonly<{
      code: "unknownCapability";
      flagId: FeatureFlagId;
      capabilityId: string;
    }>
  | Readonly<{ code: "invalidCapabilityType"; capabilityId: string }>
  | Readonly<{ code: "unknownOverride"; flagId: string }>
  | Readonly<{ code: "invalidOverrideType"; flagId: FeatureFlagId }>
  | Readonly<{ code: "failClosedDefaultDisabled"; flagId: FeatureFlagId }>;

function freezeConfigurationIssue(
  issue: FeatureFlagConfigurationIssue,
): FeatureFlagConfigurationIssue {
  if (issue.code === "dependencyCycle") {
    return Object.freeze({ ...issue, cycle: Object.freeze([...issue.cycle]) });
  }

  return Object.freeze({ ...issue });
}

export class FeatureFlagConfigurationError extends Error {
  readonly issue: FeatureFlagConfigurationIssue;

  constructor(issue: FeatureFlagConfigurationIssue) {
    super(`Feature flag configuration rejected: ${issue.code}`);
    this.name = "FeatureFlagConfigurationError";
    this.issue = freezeConfigurationIssue(issue);
  }
}
