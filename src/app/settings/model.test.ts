import { describe, expect, it } from "vitest";

import {
  AUTO_SAVE_DELAY_MAX_SECONDS,
  AUTO_SAVE_DELAY_MIN_SECONDS,
  DEFAULT_APP_SETTINGS,
  DEFAULT_SEARCH_HISTORY_LIMIT,
  SEARCH_HISTORY_LIMIT_MAX,
  SEARCH_HISTORY_LIMIT_MIN,
  normalizeAppSettings,
} from "./model";

describe("normalizeAppSettings", () => {
  it("shows favorites by default and preserves an explicit hidden preference", () => {
    expect(DEFAULT_APP_SETTINGS.showFavorites).toBe(true);
    expect(normalizeAppSettings(undefined).showFavorites).toBe(true);
    expect(normalizeAppSettings({ showFavorites: false }).showFavorites).toBe(false);
    expect(normalizeAppSettings({ showFavorites: "hidden" }).showFavorites).toBe(true);
  });

  it("checks for updates on startup by default and preserves an explicit opt-out", () => {
    expect(DEFAULT_APP_SETTINGS.checkUpdatesOnStartup).toBe(true);
    expect(normalizeAppSettings(undefined).checkUpdatesOnStartup).toBe(true);
    expect(
      normalizeAppSettings({ checkUpdatesOnStartup: false }).checkUpdatesOnStartup,
    ).toBe(false);
    expect(
      normalizeAppSettings({ checkUpdatesOnStartup: "never" }).checkUpdatesOnStartup,
    ).toBe(true);
  });

  it("defaults search history to 15 entries and clamps custom limits to 1–30", () => {
    expect(DEFAULT_APP_SETTINGS.searchHistoryLimit).toBe(DEFAULT_SEARCH_HISTORY_LIMIT);
    expect(normalizeAppSettings(undefined).searchHistoryLimit).toBe(15);
    expect(normalizeAppSettings({ searchHistoryLimit: 24.6 }).searchHistoryLimit).toBe(25);
    expect(normalizeAppSettings({ searchHistoryLimit: 0 }).searchHistoryLimit).toBe(
      SEARCH_HISTORY_LIMIT_MIN,
    );
    expect(normalizeAppSettings({ searchHistoryLimit: 999 }).searchHistoryLimit).toBe(
      SEARCH_HISTORY_LIMIT_MAX,
    );
    expect(normalizeAppSettings({ searchHistoryLimit: "many" }).searchHistoryLimit).toBe(
      DEFAULT_SEARCH_HISTORY_LIMIT,
    );
  });

  it("migrates old preferences with defaults and normalizes explicit shortcut overrides", () => {
    expect(normalizeAppSettings({ locale: "en-US" }).shortcuts).toEqual(
      DEFAULT_APP_SETTINGS.shortcuts,
    );
    expect(
      normalizeAppSettings({
        shortcuts: { toggleBold: "Mod+J", heading1: null, toggleItalic: "Mod+S" },
      }).shortcuts,
    ).toMatchObject({ toggleBold: "Mod+J", heading1: null, toggleItalic: "Mod+I" });
  });
  it("restores browsing by default and accepts an explicit empty startup", () => {
    expect(DEFAULT_APP_SETTINGS.startupBehavior).toBe("restore");
    expect(normalizeAppSettings({ locale: "en-US" }).startupBehavior).toBe("restore");
    expect(normalizeAppSettings({ startupBehavior: "empty" }).startupBehavior).toBe(
      "empty",
    );
    expect(normalizeAppSettings({ startupBehavior: "anything" }).startupBehavior).toBe(
      "restore",
    );
  });

  it("defaults to manual saving with a five-second inactive delay", () => {
    expect(normalizeAppSettings(undefined)).toMatchObject({
      autoSaveMode: "manual",
      autoSaveDelaySeconds: 5,
    });
    expect(DEFAULT_APP_SETTINGS.autoSaveMode).toBe("manual");
  });

  it("accepts delayed auto-save and clamps its delay to 1–300 seconds", () => {
    expect(
      normalizeAppSettings({
        autoSaveMode: "afterDelay",
        autoSaveDelaySeconds: 0,
      }),
    ).toMatchObject({
      autoSaveMode: "afterDelay",
      autoSaveDelaySeconds: AUTO_SAVE_DELAY_MIN_SECONDS,
    });
    expect(normalizeAppSettings({ autoSaveDelaySeconds: 999 })).toMatchObject({
      autoSaveDelaySeconds: AUTO_SAVE_DELAY_MAX_SECONDS,
    });
  });

  it("falls back safely for unknown modes and invalid delays", () => {
    expect(
      normalizeAppSettings({
        autoSaveMode: "always",
        autoSaveDelaySeconds: Number.NaN,
      }),
    ).toMatchObject({
      autoSaveMode: "manual",
      autoSaveDelaySeconds: 5,
    });
  });
});
