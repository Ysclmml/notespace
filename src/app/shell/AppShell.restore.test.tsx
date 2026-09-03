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

import type { MarkdownEditorProps } from "../../features/editor/MarkdownEditor";
import {
  SESSION_SNAPSHOT_STORAGE_KEY,
  loadSessionSnapshot,
  saveSessionSnapshot,
  type SessionSnapshot,
} from "../../features/session-restore";
import {
  WORKSPACE_HISTORY_STORAGE_KEY,
  loadWorkspaceHistory,
  saveWorkspaceHistory,
} from "../../features/workspace/workspaceHistory";
import type {
  DesktopAdapter,
  EditableDocumentResult,
  OpenDocumentResult,
  WorkspaceNode,
} from "../../infrastructure/tauri/desktopAdapter";
import { AppSettingsProvider, type StartupBehavior } from "../settings";
import { createViewState } from "../state";
import { AppShell } from "./AppShell";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy: async () => undefined,
    onCloseRequested: async () => () => undefined,
  }),
}));

// This is a Shell lifecycle contract test; editor rendering/selection is covered
// separately. Keep view reporting explicit so restoring state cannot look like input.
vi.mock("../../features/editor/MarkdownEditor", () => ({
  MarkdownEditor: (props: MarkdownEditorProps) => (
    <div>
      <textarea
        aria-label={`Document body ${props.documentId}`}
        autoFocus={props.autofocus}
        data-mode={props.presentationMode}
        data-scroll={props.initialView?.scrollTop}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        value={props.value}
      />
      <button
        onClick={() =>
          props.onViewChange?.({
            scrollTop: 444,
            selectionFrom: 2,
            selectionTo: 3,
          })
        }
        type="button"
      >
        Report reading position
      </button>
    </div>
  ),
}));

const ROOT = "/session-fixtures";
const ALPHA = `${ROOT}/alpha.md`;
const BETA = `${ROOT}/beta.md`;
const GAMMA = `${ROOT}/gamma.md`;
const PICKED = "/independent-fixtures/picked.md";

function editable(path: string, content: string): EditableDocumentResult {
  return {
    status: "editable",
    path,
    content,
    mode: "normal",
    documentKind: "markdown",
    language: "markdown",
    preflight: {
      sizeBytes: content.length,
      longestLineBytes: content.length,
      containsDataImageBase64: false,
    },
  };
}

class RestoreAdapter implements DesktopAdapter {
  readonly kind = "tauri" as const;
  readonly contents = new Map([
    [ALPHA, "# Alpha on disk\n"],
    [BETA, "# Beta on disk\n"],
    [GAMMA, "# Gamma on disk\n"],
    [PICKED, "# Explicitly opened file\n"],
  ]);
  readonly pending = new Map<string, () => void>();
  readonly delayed = new Set<string>();
  readonly pickWorkspace = vi.fn(async () => ({ path: ROOT, name: "Session fixtures" }));
  readonly pickDocument = vi.fn(async () => ({ path: PICKED, name: "picked.md" }));
  readonly listWorkspace = vi.fn(async (rootPath: string): Promise<WorkspaceNode[]> =>
    [...this.contents.keys()]
      .filter((path) => path.startsWith(`${rootPath}/`))
      .map((path) => ({
        path,
        relativePath: path.slice(rootPath.length + 1),
        name: path.slice(path.lastIndexOf("/") + 1),
        kind: "markdown",
      })),
  );
  readonly openDocument = vi.fn(async (path: string): Promise<OpenDocumentResult> => {
    if (this.delayed.has(path)) {
      await new Promise<void>((resolve) => this.pending.set(path, resolve));
    }
    const content = this.contents.get(path);
    if (content === undefined) throw new Error("Missing fixture");
    return editable(path, content);
  });
  async revealInFileManager() {}
  async moveWorkspaceEntryToTrash() {}
  async createWorkspaceTextFile(): Promise<never> {
    throw new Error("Not used by restore tests");
  }
  async previewLocalFile(): Promise<never> {
    throw new Error("Not used by restore tests");
  }
  async saveDocument(path: string, content: string) {
    this.contents.set(path, content);
    return { path, bytesWritten: content.length };
  }
  async saveDocumentAs(): Promise<never> {
    throw new Error("Not used by restore tests");
  }
  async saveClipboardImage(): Promise<never> {
    throw new Error("Not used by restore tests");
  }
}

function seedBrowsing(): SessionSnapshot {
  const snapshot: SessionSnapshot = {
    version: 1,
    workspacePaths: [ROOT],
    activeWorkspacePath: ROOT,
    activeGroupIndex: 1,
    groups: [
      {
        activeTabIndex: 1,
        tabs: [
          { path: ALPHA, preview: false, view: createViewState() },
          {
            path: BETA,
            preview: true,
            view: createViewState({ editorMode: "source", sourceScrollTop: 123 }),
          },
        ],
      },
      {
        activeTabIndex: 0,
        tabs: [
          {
            path: GAMMA,
            preview: true,
            view: createViewState({ visualScrollTop: 234 }),
          },
        ],
      },
    ],
  };
  saveSessionSnapshot(snapshot);
  const workspace = { path: ROOT, name: "Session fixtures", lastOpenedAt: 1 };
  saveWorkspaceHistory({
    openWorkspaces: [workspace],
    activeWorkspacePath: ROOT,
    recentWorkspaces: [workspace],
    recentFiles: [{ path: ALPHA, name: "alpha.md", lastOpenedAt: 1 }],
  });
  return snapshot;
}

function setup(adapter: RestoreAdapter, startupBehavior: StartupBehavior = "restore") {
  return render(
    <AppSettingsProvider
      initialSettings={{ locale: "zh-CN", startupBehavior }}
      storage={null}
    >
      <AppShell adapter={adapter} />
    </AppSettingsProvider>,
  );
}

function panel(index: number) {
  return screen.getByRole("region", { name: `编辑分屏 ${index}` });
}

function clearBrowsingStorage() {
  localStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
  localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_KEY);
}

beforeEach(clearBrowsingStorage);
afterEach(() => {
  cleanup();
  clearBrowsingStorage();
});

describe("AppShell startup browsing", () => {
  it("relaunches groups and views from metadata but rereads disk instead of restoring dirty drafts", async () => {
    seedBrowsing();
    const firstAdapter = new RestoreAdapter();
    const first = setup(firstAdapter);
    const gamma = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    expect(gamma).toHaveValue("# Gamma on disk\n");
    expect(gamma).toHaveAttribute("data-scroll", "234");
    expect(panel(2)).toHaveAttribute("data-focused", "true");
    const beta = within(panel(1)).getByRole("textbox", { name: `Document body ${BETA}` });
    expect(beta).toHaveAttribute("data-mode", "source");
    expect(beta).toHaveAttribute("data-scroll", "123");
    expect(firstAdapter.openDocument.mock.calls).toEqual([[ALPHA], [BETA], [GAMMA]]);
    expect(firstAdapter.listWorkspace).toHaveBeenCalledWith(ROOT);
    expect(screen.getByRole("button", { name: "后退" })).toBeDisabled();

    fireEvent.change(gamma, { target: { value: "PRIVATE_UNSAVED_DRAFT" } });
    fireEvent.click(
      within(panel(2)).getByRole("button", { name: "Report reading position" }),
    );
    act(() => window.dispatchEvent(new Event("pagehide")));
    const persisted = loadSessionSnapshot()!;
    expect(persisted.groups[1]!.tabs[0]).toMatchObject({
      preview: false,
      view: { visualScrollTop: 444, visualSelectionFrom: 2, visualSelectionTo: 3 },
    });
    expect(localStorage.getItem(SESSION_SNAPSHOT_STORAGE_KEY)).not.toContain("PRIVATE");
    first.unmount();

    const secondAdapter = new RestoreAdapter();
    secondAdapter.contents.set(GAMMA, "# New contents read on next launch\n");
    setup(secondAdapter);
    const reopened = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    expect(reopened).toHaveValue("# New contents read on next launch\n");
    expect(reopened).toHaveAttribute("data-scroll", "444");
    expect(panel(2)).toHaveAttribute("data-focused", "true");
    const rails = screen.getAllByRole("navigation", { name: /^分屏 \d+ 的标签页$/u });
    expect(rails).toHaveLength(2);
    expect(within(rails[0]!).getByTitle(ALPHA).closest(".tab-rail__item")).not.toHaveClass(
      "tab-rail__item--preview",
    );
    expect(within(rails[1]!).queryByLabelText("未保存")).not.toBeInTheDocument();
    expect(secondAdapter.openDocument.mock.calls).toEqual([[ALPHA], [BETA], [GAMMA]]);
  });

  it("starts empty without reading saved files or workspaces and keeps recent paths available", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    setup(adapter, "empty");
    await screen.findByRole("heading", { name: "把本地文档，当作可以编辑的浏览器。" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(adapter.openDocument).not.toHaveBeenCalled();
    expect(adapter.listWorkspace).not.toHaveBeenCalled();
    expect(loadWorkspaceHistory().openWorkspaces).toEqual([]);
    expect(loadWorkspaceHistory().recentWorkspaces[0]!.path).toBe(ROOT);
    expect(loadWorkspaceHistory().recentFiles[0]!.path).toBe(ALPHA);
    fireEvent.click(screen.getByRole("button", { name: "切换工作区" }));
    expect(screen.getByRole("menuitem", { name: /Session fixtures/u })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /alpha\.md/u })).toBeVisible();
    expect(adapter.openDocument).not.toHaveBeenCalled();
    expect(adapter.listWorkspace).not.toHaveBeenCalled();
  });

  it.each(["new", "open"] as const)(
    "does not apply a late restored tab after the user chooses %s",
    async (action) => {
      seedBrowsing();
      const adapter = new RestoreAdapter();
      adapter.delayed.add(ALPHA);
      setup(adapter);
      await waitFor(() => expect(adapter.pending.has(ALPHA)).toBe(true));
      if (action === "new") {
        fireEvent.click(screen.getByRole("button", { name: "新建标签页" }));
        const draft = await screen.findByRole("textbox");
        fireEvent.change(draft, { target: { value: "New user draft survives" } });
      } else {
        fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
        fireEvent.click(screen.getByRole("menuitem", { name: /^打开文件/u }));
        await screen.findByRole("textbox", { name: `Document body ${PICKED}` });
      }
      await act(async () => adapter.pending.get(ALPHA)!());
      const editor = screen.getByRole("textbox");
      expect(editor).toHaveValue(
        action === "new" ? "New user draft survives" : "# Explicitly opened file\n",
      );
      expect(screen.getAllByRole("region", { name: /^编辑分屏 \d+$/u })).toHaveLength(1);
      expect(adapter.openDocument.mock.calls).toEqual(
        action === "new" ? [[ALPHA]] : [[ALPHA], [PICKED]],
      );
      expect(screen.queryByTitle(GAMMA)).not.toBeInTheDocument();
      expect(screen.queryByTitle(BETA)).not.toBeInTheDocument();
    },
  );
});
