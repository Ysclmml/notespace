import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SEARCH_HISTORY_LIMIT,
  SEARCH_HISTORY_LIMIT_MAX,
  SEARCH_HISTORY_LIMIT_MIN,
  normalizeSearchHistoryLimit,
} from "../../app/settings/searchHistoryLimit";
import {
  clearSearchHistory,
  loadSearchHistory,
  normalizeSearchHistory,
  pushSearchHistory,
  SEARCH_HISTORY_STORAGE_KEY,
  trimSearchHistory,
  type SearchHistoryEntry,
  type SearchHistoryStorage,
} from "./searchHistory";

function entry(
  query: string,
  lastUsedAt: number,
  overrides: Partial<SearchHistoryEntry> = {},
): SearchHistoryEntry {
  return {
    query,
    scopePath: "",
    caseSensitive: false,
    useRegex: false,
    fileFilter: "",
    lastUsedAt,
    ...overrides,
  };
}

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(SEARCH_HISTORY_STORAGE_KEY, initial);
  const storage: SearchHistoryStorage = {
    getItem: vi.fn((key) => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    removeItem: vi.fn((key) => values.delete(key)),
  };
  return { storage, values };
}

describe("workspace search history", () => {
  it("normalizes newest-first, keeps distinct contexts, deduplicates, and enforces the cap", () => {
    const records = Array.from({ length: DEFAULT_SEARCH_HISTORY_LIMIT + 3 }, (_, index) =>
      entry(`query-${index}`, index),
    );
    const normalized = normalizeSearchHistory([
      ...records,
      entry("query-4", 100, { useRegex: true }),
      entry("query-4", 99),
      { ...entry("bad-newline", 101), query: "bad\nquery" },
      { ...entry("bad-filter", 102), fileFilter: "x".repeat(257) },
      null,
    ]);
    expect(normalized).toHaveLength(DEFAULT_SEARCH_HISTORY_LIMIT);
    expect(normalized.slice(0, 3)).toEqual([
      entry("query-4", 100, { useRegex: true }),
      entry("query-4", 99),
      entry("query-17", 17),
    ]);
    expect(normalized.filter((record) => record.query === "query-4")).toHaveLength(2);
    expect(normalized.some((record) => record.query.startsWith("bad"))).toBe(false);
  });

  it("uses configurable 1–30 limits and immediately trims persisted older entries", () => {
    const records = Array.from({ length: 20 }, (_, index) => entry(`q-${index}`, index));
    const { storage, values } = memoryStorage(JSON.stringify(records));
    expect(loadSearchHistory(storage, 18)).toHaveLength(18);
    expect(trimSearchHistory(6, storage)).toHaveLength(6);
    expect(JSON.parse(values.get(SEARCH_HISTORY_STORAGE_KEY)!)).toHaveLength(6);
    expect(normalizeSearchHistory(records, 0)).toHaveLength(SEARCH_HISTORY_LIMIT_MIN);
    expect(normalizeSearchHistory(records, 99)).toHaveLength(20);
    expect(normalizeSearchHistoryLimit(99)).toBe(SEARCH_HISTORY_LIMIT_MAX);
    expect(normalizeSearchHistoryLimit("many")).toBe(DEFAULT_SEARCH_HISTORY_LIMIT);
  });

  it("persists the complete search context and refreshes an exact duplicate", () => {
    const { storage, values } = memoryStorage();
    const first = entry("TODO|FIXME", 10, {
      scopePath: "/notes",
      caseSensitive: true,
      useRegex: true,
      fileFilter: "\\.(md|tsx)$",
    });
    expect(pushSearchHistory(first, storage)).toEqual([first]);
    const refreshed = { ...first, lastUsedAt: 20 };
    expect(pushSearchHistory(refreshed, storage)).toEqual([refreshed]);
    expect(loadSearchHistory(storage)).toEqual([refreshed]);
    expect(JSON.parse(values.get(SEARCH_HISTORY_STORAGE_KEY)!)).toEqual([refreshed]);
  });

  it("writes new searches using the selected limit instead of the default", () => {
    const records = Array.from({ length: 12 }, (_, index) => entry(`q-${index}`, index));
    const { storage, values } = memoryStorage(JSON.stringify(records));
    const latest = entry("latest", 100);
    expect(pushSearchHistory(latest, storage, 4)).toEqual([
      latest,
      entry("q-11", 11),
      entry("q-10", 10),
      entry("q-9", 9),
    ]);
    expect(JSON.parse(values.get(SEARCH_HISTORY_STORAGE_KEY)!)).toHaveLength(4);
  });

  it("treats corrupt or unavailable storage as optional and clears with removeItem", () => {
    const corrupt = memoryStorage("{not json");
    expect(loadSearchHistory(corrupt.storage)).toEqual([]);
    clearSearchHistory(corrupt.storage);
    expect(corrupt.storage.removeItem).toHaveBeenCalledExactlyOnceWith(
      SEARCH_HISTORY_STORAGE_KEY,
    );
    const unavailable: SearchHistoryStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadSearchHistory(unavailable)).toEqual([]);
    expect(() => pushSearchHistory(entry("safe", 1), unavailable)).not.toThrow();
    expect(() => clearSearchHistory(unavailable)).not.toThrow();
  });
});
