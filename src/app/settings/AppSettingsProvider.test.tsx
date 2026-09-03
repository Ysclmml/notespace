import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppSettingsProvider } from "./AppSettingsProvider";
import { DEFAULT_APP_SETTINGS } from "./model";
import { APP_SETTINGS_STORAGE_KEY, type SettingsStorage } from "./storage";
import { useAppSettings } from "./useAppSettings";

class MemoryStorage implements SettingsStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function SettingsProbe() {
  const { resetSettings, setLocale, settings, updateSettings } = useAppSettings();
  return (
    <div>
      <output aria-label="locale">{settings.locale}</output>
      <output aria-label="font-size">{settings.editorFontSize}</output>
      <output aria-label="auto-save-mode">{settings.autoSaveMode}</output>
      <output aria-label="auto-save-delay">{settings.autoSaveDelaySeconds}</output>
      <output aria-label="startup-behavior">{settings.startupBehavior}</output>
      <button onClick={() => updateSettings({ startupBehavior: "empty" })} type="button">
        Start empty
      </button>
      <button onClick={() => setLocale("en-US")} type="button">
        English
      </button>
      <button onClick={() => updateSettings({ editorFontSize: 21 })} type="button">
        Large text
      </button>
      <button
        onClick={() =>
          updateSettings({ autoSaveMode: "afterDelay", autoSaveDelaySeconds: 12 })
        }
        type="button"
      >
        Auto-save
      </button>
      <button onClick={resetSettings} type="button">
        Reset
      </button>
    </div>
  );
}

describe("AppSettingsProvider", () => {
  it("loads, updates, persists and resets settings", async () => {
    const storage = new MemoryStorage();
    storage.values.set(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_APP_SETTINGS, editorFontSize: 18 }),
    );
    const { unmount } = render(
      <AppSettingsProvider storage={storage}>
        <SettingsProbe />
      </AppSettingsProvider>,
    );

    expect(screen.getByLabelText("font-size")).toHaveTextContent("18");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.click(screen.getByRole("button", { name: "Large text" }));
    fireEvent.click(screen.getByRole("button", { name: "Auto-save" }));
    fireEvent.click(screen.getByRole("button", { name: "Start empty" }));
    await waitFor(() =>
      expect(JSON.parse(storage.getItem(APP_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
        autoSaveDelaySeconds: 12,
        autoSaveMode: "afterDelay",
        editorFontSize: 21,
        locale: "en-US",
        startupBehavior: "empty",
      }),
    );

    unmount();
    render(
      <AppSettingsProvider storage={storage}>
        <SettingsProbe />
      </AppSettingsProvider>,
    );
    expect(screen.getByLabelText("locale")).toHaveTextContent("en-US");
    expect(screen.getByLabelText("font-size")).toHaveTextContent("21");
    expect(screen.getByLabelText("auto-save-mode")).toHaveTextContent("afterDelay");
    expect(screen.getByLabelText("auto-save-delay")).toHaveTextContent("12");
    expect(screen.getByLabelText("startup-behavior")).toHaveTextContent("empty");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("locale")).toHaveTextContent("zh-CN");
    expect(screen.getByLabelText("font-size")).toHaveTextContent("16");
    expect(screen.getByLabelText("auto-save-mode")).toHaveTextContent("manual");
    expect(screen.getByLabelText("auto-save-delay")).toHaveTextContent("5");
    expect(screen.getByLabelText("startup-behavior")).toHaveTextContent("restore");
  });

  it("uses safe defaults when browser storage is unavailable", () => {
    expect(() =>
      renderToString(
        <AppSettingsProvider storage={null}>
          <SettingsProbe />
        </AppSettingsProvider>,
      ),
    ).not.toThrow();
  });

  it("normalizes malformed persisted values", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        autoSaveDelaySeconds: 900,
        autoSaveMode: "whenever",
        codeWrap: "yes",
        editorFontSize: 900,
        locale: "invalid",
      }),
    );
    render(
      <AppSettingsProvider storage={storage}>
        <SettingsProbe />
      </AppSettingsProvider>,
    );

    expect(screen.getByLabelText("locale")).toHaveTextContent("zh-CN");
    expect(screen.getByLabelText("font-size")).toHaveTextContent("28");
    expect(screen.getByLabelText("auto-save-mode")).toHaveTextContent("manual");
    expect(screen.getByLabelText("auto-save-delay")).toHaveTextContent("300");
  });
});
