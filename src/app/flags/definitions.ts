import type { FeatureFlagDefinition } from "./model";

function freezeDefinition(definition: FeatureFlagDefinition): FeatureFlagDefinition {
  return Object.freeze({
    ...definition,
    requires: Object.freeze([...definition.requires]),
    requiresCapabilities: Object.freeze([...definition.requiresCapabilities]),
  });
}

const DEFINITION_INPUTS: readonly FeatureFlagDefinition[] = [
  {
    id: "editor.livePreview",
    productionDefault: false,
    requires: [],
    requiresCapabilities: [],
    failClosed: false,
  },
  {
    id: "navigation.tabs",
    productionDefault: false,
    requires: [],
    requiresCapabilities: [],
    failClosed: false,
  },
  {
    id: "navigation.history",
    productionDefault: false,
    requires: ["navigation.tabs"],
    requiresCapabilities: [],
    failClosed: false,
  },
  {
    id: "navigation.peek",
    productionDefault: false,
    requires: ["navigation.tabs"],
    requiresCapabilities: [],
    failClosed: false,
  },
  {
    id: "layout.splitView",
    productionDefault: false,
    requires: ["navigation.tabs"],
    requiresCapabilities: ["splitView"],
    failClosed: false,
  },
  {
    id: "clipboard.imagePaste",
    productionDefault: false,
    requires: [],
    requiresCapabilities: ["clipboardImage"],
    failClosed: false,
  },
  {
    id: "diagram.mermaidViewer",
    productionDefault: false,
    requires: ["editor.livePreview"],
    requiresCapabilities: ["mermaid"],
    failClosed: false,
  },
  {
    id: "table.renderedPreview",
    productionDefault: false,
    requires: ["editor.livePreview"],
    requiresCapabilities: [],
    failClosed: false,
  },
  {
    id: "table.structuredEditing",
    productionDefault: false,
    requires: ["table.renderedPreview"],
    requiresCapabilities: [],
    failClosed: false,
  },
  {
    id: "safety.largeInputGuard",
    productionDefault: true,
    requires: [],
    requiresCapabilities: [],
    failClosed: true,
  },
  {
    id: "safety.base64Repair",
    productionDefault: false,
    requires: ["safety.largeInputGuard"],
    requiresCapabilities: [],
    failClosed: false,
  },
  {
    id: "performance.largeDocumentMode",
    productionDefault: true,
    requires: ["safety.largeInputGuard"],
    requiresCapabilities: [],
    failClosed: false,
  },
  {
    id: "recovery.dirty",
    productionDefault: true,
    requires: [],
    requiresCapabilities: ["recovery"],
    failClosed: true,
  },
  {
    id: "session.restore",
    productionDefault: false,
    requires: ["navigation.tabs", "navigation.history"],
    requiresCapabilities: ["recovery"],
    failClosed: false,
  },
];

export const FEATURE_FLAG_DEFINITIONS: readonly FeatureFlagDefinition[] = Object.freeze(
  DEFINITION_INPUTS.map(freezeDefinition),
);
