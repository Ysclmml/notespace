import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DesktopAdapter,
  NativeMenuActionId,
} from "../../infrastructure/tauri/desktopAdapter";
import { SESSION_SNAPSHOT_STORAGE_KEY } from "../../features/session-restore/sessionSnapshot";
import { WORKSPACE_HISTORY_STORAGE_KEY } from "../../features/workspace/workspaceHistory";
import { UPDATE_PREFERENCES_STORAGE_KEY } from "../../features/update/updatePreferences";
import type { UpdateCheckResult } from "../../features/update/types";
import { AppSettingsProvider } from "../settings";
import { translations } from "../i18n";
import { AppShell } from "./AppShell";

const nativeWindow = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  onClose: undefined as ((event: { preventDefault(): void }) => void) | undefined,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy: nativeWindow.destroy,
    onCloseRequested: async (listener: (event: { preventDefault(): void }) => void) => {
      nativeWindow.onClose = listener;
      return () => {
        nativeWindow.onClose = undefined;
      };
    },
  }),
}));

function makeAdapter(checkForUpdate?: () => Promise<UpdateCheckResult>) {
  let nativeAction: ((action: NativeMenuActionId) => void) | undefined;
  const unused = vi.fn(async (): Promise<never> => {
    throw new Error("Unused synthetic operation");
  });
  const adapter: DesktopAdapter = {
    kind: "tauri",
    pickWorkspace: unused,
    pickDocument: unused,
    listWorkspace: unused,
    openDocument: unused,
    revealInFileManager: unused,
    saveDocument: unused,
    saveDocumentAs: unused,
    moveWorkspaceEntryToTrash: unused,
    createWorkspaceTextFile: unused,
    previewLocalFile: unused,
    saveClipboardImage: unused,
    openExternalUrl: vi.fn(async () => undefined),
    ...(checkForUpdate ? { checkForUpdate } : {}),
    listenNativeMenuAction: async (listener) => {
      nativeAction = listener;
      return () => {
        nativeAction = undefined;
      };
    },
  };
  return {
    adapter,
    unused,
    nativeAction: (action: NativeMenuActionId) => nativeAction?.(action),
  };
}

beforeEach(() => {
  localStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
  localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_KEY);
  localStorage.removeItem(UPDATE_PREFERENCES_STORAGE_KEY);
  nativeWindow.destroy.mockClear();
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
  localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_KEY);
  localStorage.removeItem(UPDATE_PREFERENCES_STORAGE_KEY);
});

describe("AppShell about repository", () => {
  it("checks once at startup, announces a newer release, and remembers a skipped version", async () => {
    const update = {
      currentVersion: "0.1.1",
      latestVersion: "0.2.0",
      releaseUrl: "https://github.com/Ysclmml/notespace/releases/tag/v0.2.0",
      publishedAt: "2026-09-04T09:00:00Z",
      status: "available" as const,
    };
    const checkForUpdate = vi.fn(async () => update);
    const first = makeAdapter(checkForUpdate);
    const mounted = render(
      <AppSettingsProvider initialSettings={{ startupBehavior: "empty" }} storage={null}>
        <AppShell adapter={first.adapter} />
      </AppSettingsProvider>,
    );

    expect(await screen.findByRole("dialog", { name: "发现新版本" })).toBeVisible();
    expect(checkForUpdate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "跳过此版本" }));
    expect(screen.queryByRole("dialog", { name: "发现新版本" })).toBeNull();
    expect(localStorage.getItem(UPDATE_PREFERENCES_STORAGE_KEY)).toContain("0.2.0");

    mounted.unmount();
    const second = makeAdapter(checkForUpdate);
    render(
      <AppSettingsProvider initialSettings={{ startupBehavior: "empty" }} storage={null}>
        <AppShell adapter={second.adapter} />
      </AppSettingsProvider>,
    );
    await waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("dialog", { name: "发现新版本" })).toBeNull();
  });

  it("can disable startup checks while keeping the manual About check available", async () => {
    const checkForUpdate = vi.fn(async () => ({
      currentVersion: "0.1.1",
      status: "upToDate" as const,
    }));
    const { adapter } = makeAdapter(checkForUpdate);
    render(
      <AppSettingsProvider
        initialSettings={{ startupBehavior: "empty", checkUpdatesOnStartup: false }}
        storage={null}
      >
        <AppShell adapter={adapter} />
      </AppSettingsProvider>,
    );
    await act(async () => Promise.resolve());
    expect(checkForUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /设置/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "启动时检查更新" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await act(async () => Promise.resolve());
    expect(checkForUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "关于笔记空间" }));
    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));
    expect(await screen.findByText("已是最新版本。")).toBeVisible();
    expect(checkForUpdate).toHaveBeenCalledOnce();
  });

  it("queues a delayed startup announcement until the existing modal closes", async () => {
    let resolveCheck: ((result: UpdateCheckResult) => void) | undefined;
    const checkForUpdate = vi.fn(
      () =>
        new Promise<UpdateCheckResult>((resolve) => {
          resolveCheck = resolve;
        }),
    );
    const { adapter } = makeAdapter(checkForUpdate);
    render(
      <AppSettingsProvider initialSettings={{ startupBehavior: "empty" }} storage={null}>
        <AppShell adapter={adapter} />
      </AppSettingsProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /设置/ }));
    expect(screen.getByRole("dialog", { name: "设置" })).toBeVisible();
    await act(async () => {
      resolveCheck?.({
        currentVersion: "0.1.1",
        latestVersion: "0.2.0",
        releaseUrl: "https://github.com/Ysclmml/notespace/releases/tag/v0.2.0",
        status: "available",
      });
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "发现新版本" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(await screen.findByRole("dialog", { name: "发现新版本" })).toBeVisible();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it.each(["zh-CN", "en-US"] as const)(
    "offers a localized About entry in %s",
    async (locale) => {
      const { adapter, unused } = makeAdapter();
      render(
        <AppSettingsProvider
          initialSettings={{ locale, startupBehavior: "empty" }}
          storage={null}
        >
          <AppShell adapter={adapter} />
        </AppSettingsProvider>,
      );
      const messages = translations[locale];
      fireEvent.click(
        screen.getByRole("button", { name: messages["toolbar.moreActions"] }),
      );
      fireEvent.click(screen.getByRole("menuitem", { name: messages["about.title"] }));
      const dialog = screen.getByRole("dialog", { name: messages["about.title"] });
      const link = within(dialog).getByRole("link", {
        name: "https://github.com/Ysclmml/notespace",
      });
      expect(adapter.openExternalUrl).not.toHaveBeenCalled();
      fireEvent.click(link);
      await waitFor(() =>
        expect(adapter.openExternalUrl).toHaveBeenCalledExactlyOnceWith(
          "https://github.com/Ysclmml/notespace",
        ),
      );
      expect(unused).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.queryByLabelText(messages["tabs.unsaved"])).toBeNull();
    },
  );

  it.each(["zh-CN", "en-US"] as const)(
    "opens the localized User guide from More separately from About in %s",
    (locale) => {
      const { adapter, unused } = makeAdapter();
      render(
        <AppSettingsProvider
          initialSettings={{ locale, startupBehavior: "empty" }}
          storage={null}
        >
          <AppShell adapter={adapter} />
        </AppSettingsProvider>,
      );
      const messages = translations[locale];
      fireEvent.click(
        screen.getByRole("button", { name: messages["toolbar.moreActions"] }),
      );
      expect(screen.getByRole("menuitem", { name: messages["about.title"] })).toBeVisible();
      fireEvent.click(screen.getByRole("menuitem", { name: messages["help.title"] }));
      const guide = screen.getByRole("dialog", { name: messages["help.title"] });
      expect(
        within(guide).getByRole("navigation", {
          name: locale === "zh-CN" ? "帮助主题" : "Help topics",
        }),
      ).toBeVisible();
      expect(screen.queryByRole("dialog", { name: messages["about.title"] })).toBeNull();
      expect(within(guide).queryByRole("link")).toBeNull();
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.queryByLabelText(messages["tabs.unsaved"])).toBeNull();
      expect(adapter.openExternalUrl).not.toHaveBeenCalled();
      expect(unused).not.toHaveBeenCalled();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it.each([
    {
      action: "app.about",
      title: "关于笔记空间",
      other: "help.open",
      otherTitle: "使用帮助",
    },
    {
      action: "help.open",
      title: "使用帮助",
      other: "app.about",
      otherTitle: "关于笔记空间",
    },
  ] as const)(
    "routes $action to its own modal and blocks background commands until Escape",
    async ({ action, title, other, otherTitle }) => {
      const { adapter, nativeAction, unused } = makeAdapter();
      render(
        <AppSettingsProvider initialSettings={{ startupBehavior: "empty" }} storage={null}>
          <AppShell adapter={adapter} />
        </AppSettingsProvider>,
      );
      await waitFor(() => expect(nativeWindow.onClose).toBeDefined());
      act(() => nativeAction(action));
      expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
      const preventDefault = vi.fn();
      act(() => {
        nativeAction("file.new");
        nativeAction("file.open");
        nativeAction("file.save");
        nativeAction("file.newTemplate");
        nativeAction("edit.findWorkspace");
        nativeAction("app.settings");
        nativeAction(other);
        nativeAction("window.close");
        nativeAction("app.quit");
        nativeWindow.onClose?.({ preventDefault });
      });
      fireEvent.keyDown(window, { key: "n", ctrlKey: true });
      fireEvent.keyDown(window, { key: "s", ctrlKey: true });
      fireEvent.keyDown(window, { key: "f", ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(window, { key: ",", ctrlKey: true });
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: title })).toBeInTheDocument();
      expect(unused).not.toHaveBeenCalled();
      expect(nativeWindow.destroy).not.toHaveBeenCalled();
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(screen.queryByLabelText("未保存")).toBeNull();
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      act(() => nativeAction(other));
      expect(screen.getByRole("dialog", { name: otherTitle })).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: title })).toBeNull();
      fireEvent.keyDown(window, { key: "Escape" });
      act(() => nativeAction("window.close"));
      await waitFor(() => expect(nativeWindow.destroy).toHaveBeenCalledOnce());
    },
  );
});
