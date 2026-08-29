import type { AppFeatures } from "../../generated/ipc";
import { FEATURE_FLAG_DEFINITIONS } from "./definitions";
import { buildFeatureFlagRegistry } from "./registry";
import type { FeatureFlagDefinition, FeatureFlagRegistry } from "./model";

export interface TestFeatureFlagRegistryOptions {
  readonly features: AppFeatures;
  readonly overrides?: Readonly<Record<string, unknown>>;
  readonly definitions?: readonly FeatureFlagDefinition[];
}

/**
 * Test-only construction seam. Unlike the production factory, this explicit
 * entry point can exercise rollout overrides and invalid dependency graphs.
 */
export function createFeatureFlagRegistryForTest({
  features,
  overrides,
  definitions = FEATURE_FLAG_DEFINITIONS,
}: TestFeatureFlagRegistryOptions): FeatureFlagRegistry {
  return buildFeatureFlagRegistry({ features, definitions, overrides });
}
