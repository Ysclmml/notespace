import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { translations } from "../../app/i18n";
import { AppSettingsProvider } from "../../app/settings";
import { AboutDialog } from "./AboutDialog";

const repositoryUrl = "https://github.com/Ysclmml/notespace";

afterEach(cleanup);

describe("AboutDialog", () => {
  it.each(["zh-CN", "en-US"] as const)(
    "shows the repository in %s and opens it only after a click",
    async (locale) => {
      const onOpenExternalUrl = vi.fn(async () => undefined);
      render(
        <AppSettingsProvider initialSettings={{ locale }} storage={null}>
          <AboutDialog onClose={vi.fn()} onOpenExternalUrl={onOpenExternalUrl} />
        </AppSettingsProvider>,
      );
      const messages = translations[locale];
      expect(screen.getByRole("dialog", { name: messages["about.title"] })).toBeVisible();
      expect(screen.getByText(messages["about.repository"])).toBeInTheDocument();
      const link = screen.getByRole("link", { name: repositoryUrl });
      expect(link).toHaveAttribute("href", repositoryUrl);
      expect(onOpenExternalUrl).not.toHaveBeenCalled();
      expect(fireEvent.click(link)).toBe(false);
      await waitFor(() =>
        expect(onOpenExternalUrl).toHaveBeenCalledExactlyOnceWith(repositoryUrl),
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it.each(["zh-CN", "en-US"] as const)(
    "keeps localized failure visible in %s and allows retry",
    async (locale) => {
      const onOpenExternalUrl = vi
        .fn(async () => undefined)
        .mockRejectedValueOnce(new Error("Synthetic browser failure"));
      render(
        <AppSettingsProvider initialSettings={{ locale }} storage={null}>
          <AboutDialog onClose={vi.fn()} onOpenExternalUrl={onOpenExternalUrl} />
        </AppSettingsProvider>,
      );
      const link = screen.getByRole("link", { name: repositoryUrl });
      fireEvent.click(link);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        translations[locale]["about.openFailed"],
      );
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.click(link);
      await waitFor(() => expect(link).toHaveAttribute("aria-busy", "false"));
      expect(onOpenExternalUrl).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("does not navigate the WebView when no external opener is available", async () => {
    render(
      <AppSettingsProvider storage={null}>
        <AboutDialog onClose={vi.fn()} />
      </AppSettingsProvider>,
    );
    expect(fireEvent.click(screen.getByRole("link"))).toBe(false);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      translations["zh-CN"]["about.openFailed"],
    );
  });

  it("guards repeated and middle clicks while opening and ignores late failure after close", async () => {
    let rejectOpen: ((error: Error) => void) | undefined;
    const onOpenExternalUrl = vi.fn(
      () =>
        new Promise<void>((_, reject) => {
          rejectOpen = reject;
        }),
    );
    const { unmount } = render(
      <AppSettingsProvider storage={null}>
        <AboutDialog onClose={vi.fn()} onOpenExternalUrl={onOpenExternalUrl} />
      </AppSettingsProvider>,
    );
    const link = screen.getByRole("link");
    expect(
      fireEvent(
        link,
        new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }),
      ),
    ).toBe(false);
    fireEvent.click(link);
    expect(onOpenExternalUrl).toHaveBeenCalledExactlyOnceWith(repositoryUrl);
    expect(link).toHaveAttribute("aria-busy", "true");
    unmount();
    await act(async () => rejectOpen?.(new Error("Synthetic late failure")));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("traps focus, closes with Escape and restores focus on unmount", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { unmount } = render(
      <AppSettingsProvider storage={null}>
        <AboutDialog onClose={onClose} />
      </AppSettingsProvider>,
    );
    try {
      const close = screen.getByRole("button", { name: "关闭" });
      const link = screen.getByRole("link");
      expect(close).toHaveFocus();
      fireEvent.keyDown(close, { key: "Tab" });
      expect(link).toHaveFocus();
      fireEvent.keyDown(link, { key: "Tab", shiftKey: true });
      expect(close).toHaveFocus();
      trigger.focus();
      fireEvent.keyDown(trigger, { key: "Tab" });
      expect(link).toHaveFocus();
      fireEvent.keyDown(window, { key: "Escape", isComposing: true });
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(onClose).toHaveBeenCalledOnce();
      unmount();
      expect(trigger).toHaveFocus();
    } finally {
      trigger.remove();
    }
  });
});
