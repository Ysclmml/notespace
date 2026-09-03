import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { translations } from "../../app/i18n";
import { AppSettingsProvider } from "../../app/settings";
import { APP_VERSION } from "../../app/version";
import type { UpdateCheckResult } from "../update/types";
import { AboutDialog } from "./AboutDialog";

const repositoryUrl = "https://github.com/Ysclmml/notespace";

afterEach(cleanup);

describe("AboutDialog", () => {
  it("shows the current version before any network request", () => {
    const onCheckForUpdate = vi.fn();
    render(
      <AppSettingsProvider storage={null}>
        <AboutDialog onClose={vi.fn()} onCheckForUpdate={onCheckForUpdate} />
      </AppSettingsProvider>,
    );

    expect(screen.getByText(`当前版本：${APP_VERSION}`)).toBeVisible();
    expect(onCheckForUpdate).not.toHaveBeenCalled();
    expect(document.querySelector(".about-dialog__update-status")).toBeEmptyDOMElement();
  });

  it("keeps one stable status slot while a check is pending and after it resolves", async () => {
    let resolveCheck: ((result: UpdateCheckResult) => void) | undefined;
    const onCheckForUpdate = vi.fn(
      () =>
        new Promise<UpdateCheckResult>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    render(
      <AppSettingsProvider storage={null}>
        <AboutDialog onClose={vi.fn()} onCheckForUpdate={onCheckForUpdate} />
      </AppSettingsProvider>,
    );

    const statusSlot = document.querySelector(".about-dialog__update-status");
    expect(statusSlot).toBeInstanceOf(HTMLElement);
    expect(getComputedStyle(statusSlot as Element).blockSize).toBe("64px");
    expect(getComputedStyle(statusSlot as Element).overflow).toBe("auto");
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(document.querySelector(".about-dialog__update-status")).toBe(statusSlot);
    expect(statusSlot).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("正在检查…");

    await act(async () => {
      resolveCheck?.({
        currentVersion: "0.1.1",
        latestVersion: "0.1.1",
        status: "upToDate",
      });
    });

    expect(document.querySelector(".about-dialog__update-status")).toBe(statusSlot);
    expect(statusSlot).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("status")).toHaveTextContent("已是最新版本。");
    expect(screen.getByRole("button", { name: "检查更新" })).toBeEnabled();
  });

  it("uses the stable status slot for no-release and retryable failure states", async () => {
    const onCheckForUpdate = vi
      .fn<() => Promise<UpdateCheckResult>>()
      .mockResolvedValueOnce({
        currentVersion: "0.1.1",
        status: "noPublishedRelease",
      })
      .mockRejectedValueOnce(new Error("offline"));
    render(
      <AppSettingsProvider storage={null}>
        <AboutDialog onClose={vi.fn()} onCheckForUpdate={onCheckForUpdate} />
      </AppSettingsProvider>,
    );

    const statusSlot = document.querySelector(".about-dialog__update-status");
    const check = screen.getByRole("button", { name: "检查更新" });
    const close = screen.getByRole("button", { name: "关闭" });
    fireEvent.click(check);
    expect(await screen.findByText("暂未找到可用的已发布版本。")).toBeVisible();
    expect(document.querySelector(".about-dialog__update-status")).toBe(statusSlot);

    fireEvent.click(check);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法检查更新，请稍后重试。",
    );
    expect(document.querySelector(".about-dialog__update-status")).toBe(statusSlot);
    expect(getComputedStyle(screen.getByRole("alert")).overflowWrap).toBe("anywhere");
    expect(screen.getByRole("button", { name: "检查更新" })).toBe(check);
    expect(screen.getByRole("button", { name: "关闭" })).toBe(close);
    expect(check).toBeEnabled();
    expect(onCheckForUpdate).toHaveBeenCalledTimes(2);
  });

  it("reports the latest release and opens it only after a separate click", async () => {
    const releaseUrl = "https://github.com/Ysclmml/notespace/releases/tag/v0.2.0";
    const onOpenExternalUrl = vi.fn(async () => undefined);
    const onCheckForUpdate = vi.fn(async () => ({
      currentVersion: "0.1.1",
      latestVersion: "0.2.0",
      releaseUrl,
      publishedAt: "2026-09-04T09:00:00Z",
      status: "available" as const,
    }));
    render(
      <AppSettingsProvider storage={null}>
        <AboutDialog
          onClose={vi.fn()}
          onCheckForUpdate={onCheckForUpdate}
          onOpenExternalUrl={onOpenExternalUrl}
        />
      </AppSettingsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(await screen.findByText("发现新版本 0.2.0。")).toBeVisible();
    expect(onCheckForUpdate).toHaveBeenCalledOnce();
    expect(onOpenExternalUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看发布页面" }));
    await waitFor(() => expect(onOpenExternalUrl).toHaveBeenCalledWith(releaseUrl));
  });

  it("keeps manual update-check failures inside About", async () => {
    render(
      <AppSettingsProvider storage={null}>
        <AboutDialog
          onClose={vi.fn()}
          onCheckForUpdate={vi.fn(async () => {
            throw new Error("offline");
          })}
        />
      </AppSettingsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法检查更新，请稍后重试。",
    );
    expect(screen.getByRole("dialog")).toBeVisible();
  });

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
