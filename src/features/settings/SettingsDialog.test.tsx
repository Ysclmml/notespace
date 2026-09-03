import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppSettingsProvider, useAppSettings } from "../../app/settings";
import { translations } from "../../app/i18n";
import { SettingsDialog } from "./SettingsDialog";

function SettingsSummary() {
  const { settings } = useAppSettings();
  return (
    <output aria-label="settings-summary">
      {settings.locale}/{settings.editorFontSize}/{String(settings.codeWrap)}/
      {settings.autoSaveMode}/{settings.autoSaveDelaySeconds}/{settings.startupBehavior}
    </output>
  );
}

describe("SettingsDialog", () => {
  it.each(["zh-CN", "en-US"] as const)(
    "offers localized startup behavior in %s",
    (locale) => {
      render(
        <AppSettingsProvider initialSettings={{ locale }} storage={null}>
          <SettingsDialog onClose={vi.fn()} open />
          <SettingsSummary />
        </AppSettingsProvider>,
      );
      const messages = translations[locale];
      const startup = screen.getByRole("combobox", {
        name: messages["settings.startupBehavior"],
      });
      expect(startup).toHaveValue("restore");
      expect(
        screen.getByRole("option", { name: messages["settings.startupRestore"] }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("option", { name: messages["settings.startupEmpty"] }),
      ).toBeInTheDocument();
      fireEvent.change(startup, { target: { value: "empty" } });
      expect(screen.getByLabelText("settings-summary")).toHaveTextContent("/empty");
    },
  );

  it("switches languages immediately and edits/reset settings", () => {
    render(
      <AppSettingsProvider storage={null}>
        <SettingsDialog onClose={vi.fn()} open />
        <SettingsSummary />
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("dialog", { name: "设置" })).toBeVisible();
    fireEvent.change(screen.getByRole("combobox", { name: "界面语言" }), {
      target: { value: "en-US" },
    });
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();

    const autoSaveMode = screen.getByRole("combobox", { name: "Save Behavior" });
    const autoSaveDelay = screen.getByRole("spinbutton", { name: "Auto-save Delay" });
    expect(autoSaveMode).toHaveValue("manual");
    expect(autoSaveDelay).toBeDisabled();
    fireEvent.change(autoSaveMode, { target: { value: "afterDelay" } });
    expect(autoSaveDelay).toBeEnabled();
    fireEvent.change(autoSaveDelay, { target: { value: "999" } });

    fireEvent.click(screen.getByRole("tab", { name: "Editor" }));
    fireEvent.change(screen.getByRole("slider", { name: "Editor Font Size" }), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Wrap Long Code Lines" }));
    expect(screen.getByLabelText("settings-summary")).toHaveTextContent(
      "en-US/20/false/afterDelay/300",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset to Defaults" }));
    expect(screen.getByLabelText("settings-summary")).toHaveTextContent(
      "zh-CN/16/true/manual/5",
    );
    expect(screen.getByRole("dialog", { name: "设置" })).toBeVisible();
  });

  it("closes with Escape", () => {
    const onClose = vi.fn();
    render(
      <AppSettingsProvider storage={null}>
        <SettingsDialog onClose={onClose} open />
      </AppSettingsProvider>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
