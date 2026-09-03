import { describe, expect, it } from "vitest";

import {
  AUTO_SAVE_DELAY_MAX_SECONDS,
  AUTO_SAVE_DELAY_MIN_SECONDS,
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
} from "./model";

describe("normalizeAppSettings", () => {
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
