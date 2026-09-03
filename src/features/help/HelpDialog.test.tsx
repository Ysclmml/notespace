import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppSettingsProvider, useAppSettings } from "../../app/settings";
import { DEFAULT_SHORTCUTS } from "../shortcuts/shortcuts";
import { HelpDialog } from "./HelpDialog";
import { helpSections } from "./helpContent";

function SettingsControls() {
  const { settings, updateSettings, setLocale } = useAppSettings();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          updateSettings({
            shortcuts: {
              ...settings.shortcuts,
              toggleBold: "Mod+Shift+J",
              toggleItalic: null,
            },
          })
        }
      >
        Change bindings
      </button>
      <button type="button" onClick={() => setLocale("en-US")}>
        Use English
      </button>
    </>
  );
}

function HelpLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open help
      </button>
      {open && <HelpDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function shortcutValue(label: string) {
  return screen.getByText(label, { selector: "dt" }).nextElementSibling;
}

describe("HelpDialog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("documents recent-search reuse, deliberate Favorites hiding, and system Open With", () => {
    const chinese = helpSections("zh-CN");
    const english = helpSections("en-US");
    const text = (sections: ReturnType<typeof helpSections>, sectionId: string) =>
      sections
        .find((section) => section.id === sectionId)!
        .items.map((item) => item.text)
        .join(" ");

    expect(text(chinese, "start")).toMatch(/“打开方式”.*\.md\/\.markdown/);
    expect(text(chinese, "search")).toMatch(
      /默认 15 条.*1–30 条.*只回填条件.*不会自动触发磁盘搜索/,
    );
    expect(text(chinese, "search")).toMatch(/上次结果.*滚动位置.*不重复扫描/);
    expect(text(chinese, "organize")).toMatch(
      /Control 点击“收藏”标题.*“关闭收藏”.*设置中恢复.*不会清空已收藏路径/,
    );
    expect(text(english, "start")).toMatch(/\.md\/\.markdown.*Open With/);
    expect(text(english, "search")).toMatch(
      /15 by default.*1–30.*only fills the controls.*never starts a disk search/,
    );
    expect(text(english, "search")).toMatch(
      /previous in-memory results.*scroll position.*without scanning again/,
    );
    expect(text(english, "organize")).toMatch(
      /Control-click the Favorites heading.*Close Favorites.*Settings.*does not clear/,
    );
  });

  it("switches help topics, exposes the selected topic, and resets only the content scroll", () => {
    const onClose = vi.fn();
    const { container } = render(
      <AppSettingsProvider storage={null}>
        <HelpDialog onClose={onClose} />
      </AppSettingsProvider>,
    );
    const dialog = screen.getByRole("dialog", { name: "使用帮助" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const nav = screen.getByRole("navigation", { name: "帮助主题" });
    expect(within(nav).getAllByRole("button")).toHaveLength(6);
    expect(within(nav).getByRole("button", { name: "开始使用" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("heading", { level: 3, name: "开始使用" })).toBeInTheDocument();
    const content = container.querySelector<HTMLElement>(".help-dialog__content")!;
    for (const [topic, detail] of [
      ["编辑与阅读", "表格、图片和图表"],
      ["查找与搜索", "搜索为什么可能不完整"],
      ["收藏与模板", "工作区关闭或文件失效"],
      ["导出与文件安全", "什么是离线帮助"],
    ]) {
      content.scrollTop = 250;
      fireEvent.click(within(nav).getByRole("button", { name: topic }));
      expect(screen.getByRole("heading", { level: 3, name: topic })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 4, name: detail })).toBeInTheDocument();
      expect(within(nav).getByRole("button", { name: topic })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expect(content.scrollTop).toBe(0);
    }
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("随应用提供，无需联网")).toBeInTheDocument();
  });

  it.each([
    ["MacIntel", "⌘1", "⌘⇧J", "⌘K"],
    ["Win32", "Ctrl+1", "Ctrl+Shift+J", "Ctrl+K"],
  ])(
    "shows actual customized, cleared and default shortcuts on %s",
    (platform, heading, bold, quickOpen) => {
      vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
      render(
        <AppSettingsProvider
          storage={null}
          initialSettings={{
            shortcuts: {
              ...DEFAULT_SHORTCUTS,
              toggleBold: "Mod+Shift+J",
              toggleItalic: null,
            },
          }}
        >
          <HelpDialog onClose={vi.fn()} />
        </AppSettingsProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "快捷键速查" }));
      expect(shortcutValue("一级标题")).toHaveTextContent(heading!);
      expect(shortcutValue("粗体")).toHaveTextContent(bold!);
      expect(shortcutValue("斜体")).toHaveTextContent("未设置");
      expect(shortcutValue("快速打开文件")).toHaveTextContent(quickOpen!);
      expect(screen.getAllByRole("term")).toHaveLength(19);
      expect(screen.getByText(/不是 Word 字号/)).toBeInTheDocument();
    },
  );

  it("updates shortcut values and language live while retaining the chosen help topic", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    render(
      <AppSettingsProvider storage={null}>
        <SettingsControls />
        <HelpDialog onClose={vi.fn()} />
      </AppSettingsProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "快捷键速查" }));
    expect(shortcutValue("粗体")).toHaveTextContent("Ctrl+B");
    fireEvent.click(screen.getByRole("button", { name: "Change bindings" }));
    expect(shortcutValue("粗体")).toHaveTextContent("Ctrl+Shift+J");
    expect(shortcutValue("斜体")).toHaveTextContent("未设置");
    fireEvent.click(screen.getByRole("button", { name: "Use English" }));
    expect(screen.getByRole("dialog", { name: "User guide" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Shortcut reference" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(shortcutValue("Bold")).toHaveTextContent("Ctrl+Shift+J");
    expect(shortcutValue("Italic")).toHaveTextContent("Not set");
    fireEvent.click(screen.getByRole("button", { name: "Finding and searching" }));
    expect(
      screen.getByRole("heading", { level: 4, name: "Incomplete results" }),
    ).toBeInTheDocument();
  });

  it("closes on Escape without bubbling to the editor and restores the opener's focus", () => {
    render(
      <AppSettingsProvider storage={null}>
        <HelpLauncher />
      </AppSettingsProvider>,
    );
    const opener = screen.getByRole("button", { name: "Open help" });
    opener.focus();
    fireEvent.click(opener);
    const close = screen.getByRole("button", { name: "关闭使用帮助" });
    expect(close).toHaveFocus();
    const background = vi.fn();
    window.addEventListener("keydown", background);
    try {
      expect(fireEvent.keyDown(close, { key: "Escape" })).toBe(false);
      expect(background).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    } finally {
      window.removeEventListener("keydown", background);
    }
  });

  it("traps Tab and Shift+Tab at both ends, including after outside focus, and leaves IME alone", () => {
    const onClose = vi.fn();
    const { container } = render(
      <AppSettingsProvider storage={null}>
        <button type="button">Background</button>
        <HelpDialog onClose={onClose} />
      </AppSettingsProvider>,
    );
    const close = screen.getByRole("button", { name: "关闭使用帮助" });
    const content = container.querySelector<HTMLElement>(".help-dialog__content")!;
    expect(close).toHaveFocus();
    expect(fireEvent.keyDown(close, { key: "Tab", shiftKey: true })).toBe(false);
    expect(content).toHaveFocus();
    expect(fireEvent.keyDown(content, { key: "Tab" })).toBe(false);
    expect(close).toHaveFocus();
    const background = screen.getByRole("button", { name: "Background" });
    background.focus();
    fireEvent.keyDown(background, { key: "Tab" });
    expect(close).toHaveFocus();
    background.focus();
    fireEvent.keyDown(background, { key: "Tab", shiftKey: true });
    expect(content).toHaveFocus();
    expect(fireEvent.keyDown(content, { key: "Escape", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(content, { key: "Tab", isComposing: true })).toBe(true);
    expect(content).toHaveFocus();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses the latest close callback and dismisses only explicit close or backdrop actions", () => {
    const firstClose = vi.fn();
    const nextClose = vi.fn();
    const view = (onClose: () => void) => (
      <AppSettingsProvider storage={null}>
        <HelpDialog onClose={onClose} />
      </AppSettingsProvider>
    );
    const { container, rerender, unmount } = render(view(firstClose));
    rerender(view(nextClose));
    fireEvent.mouseDown(screen.getByRole("heading", { level: 3, name: "开始使用" }));
    expect(nextClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(container.querySelector(".help-dialog-layer")!);
    fireEvent.click(screen.getByRole("button", { name: "关闭使用帮助" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(nextClose).toHaveBeenCalledTimes(3);
    expect(firstClose).not.toHaveBeenCalled();
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(nextClose).toHaveBeenCalledTimes(3);
  });
});
