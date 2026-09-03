import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppSettingsProvider, useAppSettings } from "../../app/settings";
import { SettingsDialog } from "./SettingsDialog";

function BindingProbe() {
  const { settings } = useAppSettings();
  return <output aria-label="bindings">{JSON.stringify(settings.shortcuts)}</output>;
}

function mount(locale: "zh-CN" | "en-US" = "en-US") {
  const onClose = vi.fn();
  render(
    <AppSettingsProvider initialSettings={{ locale }} storage={null}>
      <SettingsDialog onClose={onClose} open />
      <BindingProbe />
    </AppSettingsProvider>,
  );
  fireEvent.click(
    screen.getByRole("tab", { name: locale === "en-US" ? "Shortcuts" : "快捷键" }),
  );
  return { onClose };
}

function record(action: string, key: string, extra = {}) {
  const button = screen.getByRole("button", { name: `Record shortcut for ${action}` });
  fireEvent.click(button);
  fireEvent.keyDown(button, {
    key,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: true,
    ...extra,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("ShortcutSettings", () => {
  it("records, clears and restores one binding while leaving other settings alone", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    mount();
    expect(
      screen.getByRole("button", { name: "Record shortcut for Heading 1" }),
    ).toHaveTextContent("Ctrl+1");
    record("Bold", "j");
    expect(
      screen.getByRole("button", { name: "Record shortcut for Bold" }),
    ).toHaveTextContent("Ctrl+J");
    expect(screen.getByLabelText("bindings")).toHaveTextContent('"toggleBold":"Mod+J"');
    fireEvent.click(screen.getByRole("button", { name: "Clear shortcut for Bold" }));
    expect(
      screen.getByRole("button", { name: "Record shortcut for Bold" }),
    ).toHaveTextContent("Not set");
    expect(screen.getByLabelText("bindings")).toHaveTextContent('"toggleBold":null');
    fireEvent.click(screen.getByRole("button", { name: "Reset shortcut for Bold" }));
    expect(
      screen.getByRole("button", { name: "Record shortcut for Bold" }),
    ).toHaveTextContent("Ctrl+B");
    expect(screen.getByRole("button", { name: "Reset shortcut for Bold" })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
  });

  it("rejects reserved and conflicting keys and cancels recording with Escape before closing", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    const { onClose } = mount();
    const bold = screen.getByRole("button", { name: "Record shortcut for Bold" });
    record("Bold", "s");
    expect(screen.getByRole("alert")).toHaveTextContent("reserved");
    fireEvent.keyDown(bold, { key: "i", ctrlKey: true });
    expect(screen.getByRole("alert")).toHaveTextContent("Already assigned to “Italic”");
    expect(screen.getByLabelText("bindings")).toHaveTextContent('"toggleBold":"Mod+B"');
    fireEvent.keyDown(bold, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(bold).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.keyDown(bold, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a recording hint for unsupported keys and does not consume Tab focus navigation", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    mount();
    const bold = screen.getByRole("button", { name: "Record shortcut for Bold" });
    fireEvent.click(bold);
    fireEvent.keyDown(bold, { key: "j" });
    expect(screen.getByRole("alert")).toHaveTextContent("Single keys");
    fireEvent.keyDown(bold, { key: "Tab" });
    expect(bold).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("bindings")).toHaveTextContent('"toggleBold":"Mod+B"');
    const reset = screen.getByRole("button", { name: "Reset to Defaults" });
    reset.focus();
    fireEvent.keyDown(reset, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("filters actions and restores only shortcut defaults", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    mount();
    record("Bold", "j");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Bold" } });
    expect(screen.getByRole("button", { name: "Record shortcut for Bold" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Record shortcut for Heading 1" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset all shortcuts" }));
    expect(
      screen.getByRole("button", { name: "Record shortcut for Bold" }),
    ).toHaveTextContent("Ctrl+B");
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "no-such-action" },
    });
    expect(screen.getByText("No formatting actions found.")).toBeVisible();
  });

  it("offers Chinese labels and Command keys on Mac, including Option-modified characters", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { onClose } = mount("zh-CN");
    expect(screen.getByRole("button", { name: "录入一级标题快捷键" })).toHaveTextContent(
      "⌘1",
    );
    const code = screen.getByRole("button", { name: "录入代码块快捷键" });
    fireEvent.click(code);
    fireEvent.keyDown(code, { key: "®", code: "KeyR", metaKey: true, altKey: true });
    expect(code).toHaveTextContent("⌘⌥R");
    expect(screen.getByLabelText("bindings")).toHaveTextContent('"codeBlock":"Mod+Alt+R"');
    fireEvent.keyDown(code, { key: "Escape", isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports conflicts when restoring a default already reassigned elsewhere", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Clear shortcut for Bold" }));
    record("Italic", "b");
    fireEvent.click(screen.getByRole("button", { name: "Reset shortcut for Bold" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Already assigned to “Italic”");
    expect(screen.getByLabelText("bindings")).toHaveTextContent('"toggleBold":null');
    fireEvent.click(screen.getByRole("button", { name: "Reset all shortcuts" }));
    expect(
      screen.getByRole("button", { name: "Record shortcut for Bold" }),
    ).toHaveTextContent("Ctrl+B");
    expect(
      screen.getByRole("button", { name: "Record shortcut for Italic" }),
    ).toHaveTextContent("Ctrl+I");
  });
});
