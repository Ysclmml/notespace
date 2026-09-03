import { describe, expect, it } from "vitest";

import {
  loadSkippedUpdateVersion,
  saveSkippedUpdateVersion,
  UPDATE_PREFERENCES_STORAGE_KEY,
} from "./updatePreferences";

function memoryStorage(initial?: string): Storage {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(UPDATE_PREFERENCES_STORAGE_KEY, initial);
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("update preferences", () => {
  it("stores and reloads one skipped stable version", () => {
    const storage = memoryStorage();
    saveSkippedUpdateVersion("0.2.0", storage);
    expect(loadSkippedUpdateVersion(storage)).toBe("0.2.0");
  });

  it.each(["", "not json", "{}", '{"skippedVersion":"v0.2.0"}'])(
    "ignores malformed preferences: %s",
    (value) => expect(loadSkippedUpdateVersion(memoryStorage(value))).toBeNull(),
  );

  it("does not overwrite storage with an invalid version", () => {
    const storage = memoryStorage('{"skippedVersion":"0.1.0"}');
    saveSkippedUpdateVersion("next", storage);
    expect(loadSkippedUpdateVersion(storage)).toBe("0.1.0");
  });
});
