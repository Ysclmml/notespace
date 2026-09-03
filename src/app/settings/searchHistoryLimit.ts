export const SEARCH_HISTORY_LIMIT_MIN = 1;
export const SEARCH_HISTORY_LIMIT_MAX = 30;
export const DEFAULT_SEARCH_HISTORY_LIMIT = 15;

export function normalizeSearchHistoryLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_SEARCH_HISTORY_LIMIT;
  return Math.min(
    SEARCH_HISTORY_LIMIT_MAX,
    Math.max(SEARCH_HISTORY_LIMIT_MIN, Math.round(value)),
  );
}
