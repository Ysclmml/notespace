import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppSettingsProvider } from "../../app/settings";
import { UpdateDialog } from "./UpdateDialog";
import type { AvailableUpdate } from "./types";

const update: AvailableUpdate = {
  currentVersion: "0.1.1",
  latestVersion: "0.2.0",
  releaseUrl: "https://github.com/Ysclmml/notespace/releases/tag/v0.2.0",
  publishedAt: "2026-09-04T09:00:00Z",
  status: "available",
};

afterEach(cleanup);

describe("UpdateDialog", () => {
  it("shows both versions and keeps opening the release behind a user click", async () => {
    const onClose = vi.fn();
    const onOpenRelease = vi.fn(async () => undefined);
    render(
      <AppSettingsProvider storage={null}>
        <UpdateDialog
          update={update}
          onClose={onClose}
          onSkip={vi.fn()}
          onOpenRelease={onOpenRelease}
        />
      </AppSettingsProvider>,
    );

    expect(screen.getByText("当前版本：0.1.1")).toBeVisible();
    expect(screen.getByText("最新版本：0.2.0")).toBeVisible();
    expect(onOpenRelease).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "打开 GitHub 发布页面" }));
    await waitFor(() => expect(onOpenRelease).toHaveBeenCalledWith(update.releaseUrl));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("skips only the displayed version and uses later as the safe initial action", () => {
    const onClose = vi.fn();
    const onSkip = vi.fn();
    render(
      <AppSettingsProvider storage={null}>
        <UpdateDialog
          update={update}
          onClose={onClose}
          onSkip={onSkip}
          onOpenRelease={vi.fn(async () => undefined)}
        />
      </AppSettingsProvider>,
    );

    expect(screen.getByRole("button", { name: "稍后提醒" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "跳过此版本" }));
    expect(onSkip).toHaveBeenCalledExactlyOnceWith("0.2.0");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the dialog open when the browser cannot be opened", async () => {
    const onClose = vi.fn();
    render(
      <AppSettingsProvider storage={null}>
        <UpdateDialog
          update={update}
          onClose={onClose}
          onSkip={vi.fn()}
          onOpenRelease={vi.fn(async () => {
            throw new Error("synthetic failure");
          })}
        />
      </AppSettingsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 GitHub 发布页面" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("keeps a safe dismiss action focused while the browser request is pending", async () => {
    let finish: (() => void) | undefined;
    render(
      <AppSettingsProvider storage={null}>
        <UpdateDialog
          update={update}
          onClose={vi.fn()}
          onSkip={vi.fn()}
          onOpenRelease={() =>
            new Promise<void>((resolve) => {
              finish = resolve;
            })
          }
        />
      </AppSettingsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 GitHub 发布页面" }));
    const later = screen.getByRole("button", { name: "稍后提醒" });
    await waitFor(() => expect(later).toHaveFocus());
    expect(later).toBeEnabled();
    fireEvent.keyDown(later, { key: "Tab" });
    expect(later).toHaveFocus();
    finish?.();
  });
});
