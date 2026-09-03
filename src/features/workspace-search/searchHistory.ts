import {
  DEFAULT_SEARCH_HISTORY_LIMIT,
  SEARCH_HISTORY_LIMIT_MAX,
  normalizeSearchHistoryLimit,
} from "../../app/settings/searchHistoryLimit";

export const SEARCH_HISTORY_STORAGE_KEY = "markdown-workspace.search-history.v1";

export interface SearchHistoryEntry {
  readonly query: string;
  /** Empty means all currently open workspace roots. */
  readonly scopePath: string;
  readonly caseSensitive: boolean;
  readonly useRegex: boolean;
  readonly fileFilter: string;
  readonly lastUsedAt: number;
}

export interface SearchHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function currentStorage(): SearchHistoryStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isSafeSingleLine(value: string, maxLength: number): boolean {
  return (
    value.length <= maxLength &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32)
  );
}

function normalizeEntry(value: unknown): SearchHistoryEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<SearchHistoryEntry>;
  if (
    typeof candidate.query !== "string" ||
    !candidate.query.trim() ||
    !isSafeSingleLine(candidate.query, 512) ||
    typeof candidate.scopePath !== "string" ||
    !isSafeSingleLine(candidate.scopePath, 4096) ||
    typeof candidate.fileFilter !== "string" ||
    !isSafeSingleLine(candidate.fileFilter, 256) ||
    typeof candidate.caseSensitive !== "boolean" ||
    typeof candidate.useRegex !== "boolean" ||
    typeof candidate.lastUsedAt !== "number" ||
    !Number.isSafeInteger(candidate.lastUsedAt) ||
    candidate.lastUsedAt < 0
  )
    return null;
  return {
    query: candidate.query,
    scopePath: candidate.scopePath,
    caseSensitive: candidate.caseSensitive,
    useRegex: candidate.useRegex,
    fileFilter: candidate.fileFilter,
    lastUsedAt: candidate.lastUsedAt,
  };
}

function entryKey(entry: SearchHistoryEntry): string {
  return JSON.stringify([
    entry.query,
    entry.scopePath,
    entry.caseSensitive,
    entry.useRegex,
    entry.fileFilter,
  ]);
}

export function normalizeSearchHistory(
  value: unknown,
  limit = DEFAULT_SEARCH_HISTORY_LIMIT,
): readonly SearchHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const candidates = value
    .map(normalizeEntry)
    .filter((entry): entry is SearchHistoryEntry => entry !== null)
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt);
  const entries: SearchHistoryEntry[] = [];
  const seen = new Set<string>();
  for (const entry of candidates) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries.slice(0, normalizeSearchHistoryLimit(limit));
}

export function loadSearchHistory(
  storage: SearchHistoryStorage | null = currentStorage(),
  limit = DEFAULT_SEARCH_HISTORY_LIMIT,
): readonly SearchHistoryEntry[] {
  try {
    return normalizeSearchHistory(
      JSON.parse(storage?.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? "[]"),
      limit,
    );
  } catch {
    return [];
  }
}

export function pushSearchHistory(
  entry: SearchHistoryEntry,
  storage: SearchHistoryStorage | null = currentStorage(),
  limit = DEFAULT_SEARCH_HISTORY_LIMIT,
): readonly SearchHistoryEntry[] {
  const normalized = normalizeEntry(entry);
  if (!normalized) return loadSearchHistory(storage, limit);
  const next = normalizeSearchHistory(
    [normalized, ...loadSearchHistory(storage, SEARCH_HISTORY_LIMIT_MAX)],
    limit,
  );
  try {
    storage?.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Search history is convenience metadata and must never interrupt a search.
  }
  return next;
}

export function trimSearchHistory(
  limit: number,
  storage: SearchHistoryStorage | null = currentStorage(),
): readonly SearchHistoryEntry[] {
  const next = loadSearchHistory(storage, limit);
  try {
    if (storage && storage.getItem(SEARCH_HISTORY_STORAGE_KEY) !== null)
      storage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Trimming convenience metadata must never interrupt editing or settings.
  }
  return next;
}

export function clearSearchHistory(
  storage: SearchHistoryStorage | null = currentStorage(),
): void {
  try {
    storage?.removeItem(SEARCH_HISTORY_STORAGE_KEY);
  } catch {
    // Clearing convenience metadata must not interrupt editing or search.
  }
}
