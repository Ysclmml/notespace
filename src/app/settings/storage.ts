import { normalizeAppSettings, type AppSettings } from "./model";

export const APP_SETTINGS_STORAGE_KEY = "markdown-workspace.settings.v1";

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function browserSettingsStorage(): SettingsStorage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadAppSettings(
  storage: SettingsStorage | null = browserSettingsStorage(),
): AppSettings {
  if (!storage) return normalizeAppSettings(undefined);

  try {
    const serialized = storage.getItem(APP_SETTINGS_STORAGE_KEY);
    return serialized
      ? normalizeAppSettings(JSON.parse(serialized))
      : normalizeAppSettings({});
  } catch {
    return normalizeAppSettings({});
  }
}

export function saveAppSettings(
  settings: AppSettings,
  storage: SettingsStorage | null = browserSettingsStorage(),
): boolean {
  if (!storage) return false;

  try {
    storage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
