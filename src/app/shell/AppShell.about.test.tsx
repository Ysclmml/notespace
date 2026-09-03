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

function makeAdapter() {
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
  nativeWindow.destroy.mockClear();
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
  localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_KEY);
});

describe("AppShell about repository", () => {
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

  it("reuses native help/about and blocks background commands only while the dialog is open", async () => {
    const { adapter, nativeAction, unused } = makeAdapter();
    render(
      <AppSettingsProvider initialSettings={{ startupBehavior: "empty" }} storage={null}>
        <AppShell adapter={adapter} />
      </AppSettingsProvider>,
    );
    await waitFor(() => expect(nativeWindow.onClose).toBeDefined());
    act(() => nativeAction("help.open"));
    expect(screen.getByRole("dialog", { name: "关于笔记空间" })).toBeInTheDocument();
    const preventDefault = vi.fn();
    act(() => {
      nativeAction("file.new");
      nativeAction("file.open");
      nativeAction("file.save");
      nativeAction("app.settings");
      nativeAction("window.close");
      nativeAction("app.quit");
      nativeWindow.onClose?.({ preventDefault });
    });
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(unused).not.toHaveBeenCalled();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("未保存")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => nativeAction("window.close"));
    await waitFor(() => expect(nativeWindow.destroy).toHaveBeenCalledOnce());
  });
});
