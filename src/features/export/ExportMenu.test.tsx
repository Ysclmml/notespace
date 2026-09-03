import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExportMenu } from "./ExportMenu";

describe("ExportMenu", () => {
  it.each([
    ["zh-CN", "导出", "导出格式", "离线网页"],
    ["en-US", "Export", "Export formats", "Offline page"],
  ] as const)(
    "shows one localized parent entry and only exposes formats when expanded (%s)",
    (locale, title, menuName, htmlHint) => {
      const onSelect = vi.fn();
      render(
        <ExportMenu locale={locale} disabled={false} pdfAvailable onSelect={onSelect} />,
      );
      const parent = screen.getByRole("menuitem", { name: title });
      expect(parent).toHaveAttribute("aria-haspopup", "menu");
      expect(parent).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      fireEvent.click(parent);
      expect(parent).toHaveAttribute("aria-expanded", "true");
      const menu = screen.getByRole("menu", { name: menuName });
      expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
      expect(
        within(menu).getByRole("menuitem", { name: new RegExp(`^HTML.*${htmlHint}`) }),
      ).toBeEnabled();
      fireEvent.click(parent);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it("does not open or choose a format from a disabled parent", () => {
    const onSelect = vi.fn();
    render(<ExportMenu locale="en-US" disabled pdfAvailable onSelect={onSelect} />);
    const parent = screen.getByRole("menuitem", { name: "Export" });
    expect(parent).toBeDisabled();
    fireEvent.click(parent);
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    expect(parent).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("withdraws all format actions if the active document becomes ineligible while expanded", () => {
    const onSelect = vi.fn();
    const view = (disabled: boolean) => (
      <ExportMenu locale="en-US" disabled={disabled} pdfAvailable onSelect={onSelect} />
    );
    const { rerender } = render(view(false));
    fireEvent.click(screen.getByRole("menuitem", { name: "Export" }));
    rerender(view(true));
    expect(screen.getByRole("menuitem", { name: "Export" })).toBeDisabled();
    const submenu = screen.queryByRole("menu", { name: "Export formats" });
    if (submenu) {
      for (const action of within(submenu).getAllByRole("menuitem")) {
        expect(action).toBeDisabled();
        fireEvent.click(action);
      }
    }
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Export" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    rerender(view(false));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it.each(["html", "pdf"] as const)(
    "selects %s only after choosing that format",
    (format) => {
      const onSelect = vi.fn();
      render(
        <ExportMenu locale="en-US" disabled={false} pdfAvailable onSelect={onSelect} />,
      );
      fireEvent.click(screen.getByRole("menuitem", { name: "Export" }));
      expect(onSelect).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("menuitem", { name: new RegExp(`^${format.toUpperCase()}`) }),
      );
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(format);
    },
  );

  it.each([
    ["zh-CN", "导出", "PDF 导出目前支持 macOS"],
    ["en-US", "Export", "PDF export currently supports macOS"],
  ] as const)(
    "explains unavailable PDF and skips it during keyboard navigation (%s)",
    (locale, title, unavailable) => {
      const onSelect = vi.fn();
      render(
        <ExportMenu
          locale={locale}
          disabled={false}
          pdfAvailable={false}
          onSelect={onSelect}
        />,
      );
      const parent = screen.getByRole("menuitem", { name: title });
      parent.focus();
      fireEvent.keyDown(parent, { key: "ArrowRight" });
      const html = screen.getByRole("menuitem", { name: /^HTML/ });
      const pdf = screen.getByRole("menuitem", { name: /^PDF/ });
      expect(html).toHaveFocus();
      expect(pdf).toBeDisabled();
      expect(pdf).toHaveAttribute("title", unavailable);
      fireEvent.keyDown(html, { key: "ArrowDown" });
      expect(html).toHaveFocus();
      fireEvent.keyDown(html, { key: "ArrowUp" });
      expect(html).toHaveFocus();
      fireEvent.click(pdf);
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it.each(["ArrowRight", "ArrowDown"])(
    "opens and focuses the first format from the parent with %s",
    (key) => {
      render(
        <ExportMenu locale="en-US" disabled={false} pdfAvailable onSelect={vi.fn()} />,
      );
      const parent = screen.getByRole("menuitem", { name: "Export" });
      parent.focus();
      expect(fireEvent.keyDown(parent, { key })).toBe(false);
      expect(parent).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("menuitem", { name: /^HTML/ })).toHaveFocus();
    },
  );

  it("moves from an already pointer-opened parent into its submenu with ArrowRight", () => {
    render(<ExportMenu locale="en-US" disabled={false} pdfAvailable onSelect={vi.fn()} />);
    const parent = screen.getByRole("menuitem", { name: "Export" });
    parent.focus();
    fireEvent.click(parent);
    expect(parent).toHaveFocus();
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    expect(screen.getByRole("menuitem", { name: /^HTML/ })).toHaveFocus();
  });

  it("cycles enabled formats and returns focus to the parent without bubbling Escape or Left", () => {
    const onKeyDown = vi.fn();
    render(
      <div onKeyDown={onKeyDown}>
        <ExportMenu locale="en-US" disabled={false} pdfAvailable onSelect={vi.fn()} />
      </div>,
    );
    const parent = screen.getByRole("menuitem", { name: "Export" });
    parent.focus();
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    onKeyDown.mockClear();
    const html = screen.getByRole("menuitem", { name: /^HTML/ });
    const pdf = screen.getByRole("menuitem", { name: /^PDF/ });
    fireEvent.keyDown(html, { key: "ArrowDown" });
    expect(pdf).toHaveFocus();
    fireEvent.keyDown(pdf, { key: "ArrowDown" });
    expect(html).toHaveFocus();
    fireEvent.keyDown(html, { key: "ArrowUp" });
    expect(pdf).toHaveFocus();
    expect(fireEvent.keyDown(pdf, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(parent).toHaveFocus();
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    onKeyDown.mockClear();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: /^HTML/ }), {
      key: "ArrowLeft",
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(parent).toHaveFocus();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it("does not enter or navigate the submenu during composition", () => {
    render(<ExportMenu locale="en-US" disabled={false} pdfAvailable onSelect={vi.fn()} />);
    const parent = screen.getByRole("menuitem", { name: "Export" });
    parent.focus();
    expect(fireEvent.keyDown(parent, { key: "ArrowDown", isComposing: true })).toBe(true);
    expect(fireEvent.keyDown(parent, { key: "ArrowDown", keyCode: 229 })).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.keyDown(parent, { key: "ArrowRight" });
    const html = screen.getByRole("menuitem", { name: /^HTML/ });
    expect(fireEvent.keyDown(html, { key: "ArrowDown", isComposing: true })).toBe(true);
    expect(html).toHaveFocus();
    fireEvent.keyDown(html, { key: "Escape", isComposing: true });
    fireEvent.keyDown(html, { key: "Escape", keyCode: 229 });
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});
