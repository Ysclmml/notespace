const UPDATE_PREFERENCES_STORAGE_KEY = "markdown-workspace.update.v1";

interface UpdatePreferences {
  readonly skippedVersion?: string;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadSkippedUpdateVersion(storage = browserStorage()): string | null {
  if (!storage) return null;
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(UPDATE_PREFERENCES_STORAGE_KEY) ?? "",
    );
    if (typeof parsed !== "object" || parsed === null) return null;
    const version = (parsed as UpdatePreferences).skippedVersion;
    return typeof version === "string" && /^\d+\.\d+\.\d+$/u.test(version) ? version : null;
  } catch {
    return null;
  }
}

export function saveSkippedUpdateVersion(
  version: string,
  storage = browserStorage(),
): void {
  if (!storage || !/^\d+\.\d+\.\d+$/u.test(version)) return;
  try {
    storage.setItem(
      UPDATE_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ skippedVersion: version } satisfies UpdatePreferences),
    );
  } catch {
    // A blocked or full settings store must not interrupt the editor.
  }
}

export { UPDATE_PREFERENCES_STORAGE_KEY };
