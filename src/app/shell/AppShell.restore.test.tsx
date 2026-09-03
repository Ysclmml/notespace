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
import type { WorkspaceSearchResponse } from "../../features/workspace-search/types";

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
        data-reveal={props.reveal?.position}
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
  readonly searchWorkspaces = vi.fn(async (): Promise<WorkspaceSearchResponse> => ({
    matches: [
      {
        path: ALPHA,
        rootPath: ROOT,
        relativePath: "alpha.md",
        line: 2,
        column: 3,
        snippet: "中文查找内容",
      },
    ],
    searchedFiles: 3,
    skippedFiles: 0,
    unavailableRoots: [],
    truncated: false,
  }));
  readonly exportHtml = vi.fn<NonNullable<DesktopAdapter["exportHtml"]>>(async () => {
    return { path: "/export-fixtures/example.html", bytesWritten: 100 };
  });
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

function rail(index: number) {
  return screen.getByRole("navigation", { name: `分屏 ${index} 的标签页` });
}

async function searchForFixture() {
  fireEvent.keyDown(window, { key: "f", metaKey: true, shiftKey: true });
  const search = await screen.findByRole("search");
  const input = within(search).getByRole("searchbox");
  fireEvent.change(input, { target: { value: "查找" } });
  fireEvent.submit(input.closest("form")!);
  return within(search).findByRole("button", { name: /中文查找内容/ });
}

function exportHtml() {
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "导出 HTML…" }));
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
  it("exposes unavailable roots and files, retries them, and forgets only recent records", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    adapter.contents.delete(ALPHA);
    adapter.listWorkspace.mockRejectedValueOnce(new Error("Offline fixture"));
    setup(adapter);
    const notice = await screen.findByRole("complementary", {
      name: "部分浏览位置未能恢复",
    });
    fireEvent.click(within(notice).getByText("查看详情与处理"));
    expect(within(notice).getByText(ROOT)).toBeInTheDocument();
    expect(within(notice).getByText(ALPHA)).toBeInTheDocument();
    fireEvent.click(
      within(within(notice).getByText(ALPHA).closest("li")!).getByRole("button", {
        name: "从记录移除",
      }),
    );
    await waitFor(() => expect(loadWorkspaceHistory().recentFiles).toHaveLength(0));
    expect(screen.getByRole("textbox", { name: `Document body ${GAMMA}` })).toHaveValue(
      "# Gamma on disk\n",
    );
    fireEvent.click(
      within(within(notice).getByText(ROOT).closest("li")!).getByRole("button", {
        name: "重试",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "部分浏览位置未能恢复" }),
      ).not.toBeInTheDocument(),
    );
    expect(adapter.contents.has(ALPHA)).toBe(false);
    expect(loadWorkspaceHistory().recentWorkspaces[0]?.path).toBe(ROOT);
  });

  it("searches disk from the sidebar and opens a result in the focused split without replacing a kept page", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    adapter.contents.set(ALPHA, "# Alpha\n中文查找内容\n");
    setup(adapter);
    const gamma = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.change(gamma, { target: { value: "# Local draft" } });
    fireEvent.keyDown(window, { key: "f", metaKey: true, shiftKey: true });
    const search = await screen.findByRole("search");
    const input = within(search).getByRole("searchbox");
    fireEvent.change(input, { target: { value: "查找" } });
    fireEvent.submit(input.closest("form")!);
    const result = await within(search).findByRole("button", { name: /中文查找内容/ });
    fireEvent.click(result);
    await waitFor(() =>
      expect(
        within(panel(2)).getByRole("textbox", { name: `Document body ${ALPHA}` }),
      ).toHaveAttribute("data-reveal", "10"),
    );
    expect(adapter.searchWorkspaces).toHaveBeenCalledWith(
      [{ path: ROOT, showHidden: false }],
      "查找",
      false,
    );
    const tabs = rail(2);
    expect(within(tabs).getByTitle(GAMMA)).toBeInTheDocument();
    expect(within(tabs).getByLabelText("未保存")).toBeInTheDocument();
    expect(search).toBeInTheDocument();
  });

  it("exports the current unsaved Markdown snapshot without saving or clearing dirty state", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    setup(adapter);
    const gamma = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.change(gamma, { target: { value: "# Export latest\n\n中文内容" } });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出 HTML…" }));
    await waitFor(() => expect(adapter.exportHtml).toHaveBeenCalledTimes(1));
    const [name, html, excluded] = adapter.exportHtml.mock.calls[0]!;
    expect(name).toBe("gamma.html");
    expect(html).toContain("Export latest");
    expect(html).toContain("中文内容");
    expect(excluded).toContain(GAMMA);
    expect(adapter.contents.get(GAMMA)).toBe("# Gamma on disk\n");
    expect(within(rail(2)).getByLabelText("未保存")).toBeInTheDocument();
  });

  it.each(["cancel", "fail"] as const)(
    "keeps the original file and dirty text when HTML export results in %s",
    async (outcome) => {
      seedBrowsing();
      const adapter = new RestoreAdapter();
      const save = vi.spyOn(adapter, "saveDocument");
      if (outcome === "cancel") adapter.exportHtml.mockResolvedValueOnce(null);
      else adapter.exportHtml.mockRejectedValueOnce(new Error("Synthetic export failure"));
      setup(adapter);
      const gamma = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
      fireEvent.change(gamma, { target: { value: "# Unsaved export draft" } });
      exportHtml();
      await waitFor(() => expect(adapter.exportHtml).toHaveBeenCalledTimes(1));
      if (outcome === "fail") {
        expect(await screen.findByText("导出失败：Synthetic export failure")).toBeVisible();
      }
      expect(gamma).toHaveValue("# Unsaved export draft");
      expect(within(rail(2)).getByLabelText("未保存")).toBeInTheDocument();
      expect(adapter.contents.get(GAMMA)).toBe("# Gamma on disk\n");
      expect(save).not.toHaveBeenCalled();
      exportHtml();
      await waitFor(() => expect(adapter.exportHtml).toHaveBeenCalledTimes(2));
      expect(
        screen.queryByText("导出失败：Synthetic export failure"),
      ).not.toBeInTheDocument();
    },
  );

  it("protects the captured export source but not unrelated closed session caches", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    setup(adapter);
    await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.click(within(rail(1)).getByRole("button", { name: "关闭 alpha.md" }));
    exportHtml();
    fireEvent.click(within(rail(2)).getByRole("button", { name: "关闭 gamma.md" }));
    await waitFor(() => expect(adapter.exportHtml).toHaveBeenCalledTimes(1));
    const [name, html, excluded] = adapter.exportHtml.mock.calls[0]!;
    expect(name).toBe("gamma.html");
    expect(html).toContain("Gamma on disk");
    expect(excluded).toEqual(expect.arrayContaining([BETA, GAMMA]));
    expect(excluded).not.toContain(ALPHA);
  });

  it.each([
    {
      locale: "zh-CN" as const,
      more: "更多操作",
      exportLabel: "导出 HTML…",
      message:
        "导出失败：文档超过 HTML 导出的 8 MiB 大小限制。当前编辑已保留，请拆分文档后重试。",
    },
    {
      locale: "en-US" as const,
      more: "More Actions",
      exportLabel: "Export HTML…",
      message:
        "Export failed: This document exceeds the 8 MiB HTML export limit. Your edits are preserved; split the document and try again.",
    },
  ])(
    "explains oversized HTML exports in $locale without losing edits",
    async ({ locale, more, exportLabel, message }) => {
      seedBrowsing();
      const adapter = new RestoreAdapter();
      adapter.exportHtml.mockRejectedValueOnce(
        Object.assign(new Error("Internal export limit"), {
          code: "htmlExportSourceTooLarge",
        }),
      );
      render(
        <AppSettingsProvider initialSettings={{ locale }} storage={null}>
          <AppShell adapter={adapter} />
        </AppSettingsProvider>,
      );
      const gamma = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
      fireEvent.change(gamma, { target: { value: "# Keep this export draft" } });
      fireEvent.click(screen.getByRole("button", { name: more }));
      fireEvent.click(screen.getByRole("menuitem", { name: exportLabel }));
      expect(await screen.findByText(message)).toBeVisible();
      expect(gamma).toHaveValue("# Keep this export draft");
      expect(adapter.contents.get(GAMMA)).toBe("# Gamma on disk\n");
    },
  );

  it("goes back once from a search result to the source page and keeps its reading position", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    adapter.contents.set(ALPHA, "# Alpha\n中文查找内容\n");
    setup(adapter);
    await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.click(
      within(panel(2)).getByRole("button", { name: "Report reading position" }),
    );
    fireEvent.click(await searchForFixture());
    await within(panel(2)).findByRole("textbox", { name: `Document body ${ALPHA}` });
    fireEvent.click(screen.getByRole("button", { name: "后退" }));
    expect(
      within(panel(2)).getByRole("textbox", { name: `Document body ${GAMMA}` }),
    ).toHaveAttribute("data-scroll", "444");
    fireEvent.click(screen.getByRole("button", { name: "前进" }));
    expect(
      within(panel(2)).getByRole("textbox", { name: `Document body ${ALPHA}` }),
    ).toBeVisible();
  });

  it("keeps newer split focus while a search result finishes opening in its original group", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    adapter.contents.set(ALPHA, "# Alpha\n中文查找内容\n");
    setup(adapter);
    await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    adapter.delayed.add(ALPHA);
    fireEvent.click(await searchForFixture());
    await waitFor(() => expect(adapter.pending.has(ALPHA)).toBe(true));
    const beta = within(panel(1)).getByRole("textbox", { name: `Document body ${BETA}` });
    act(() => beta.focus());
    expect(panel(1)).toHaveAttribute("data-focused", "true");
    await act(async () => adapter.pending.get(ALPHA)!());
    expect(
      within(panel(2)).getByRole("textbox", { name: `Document body ${ALPHA}` }),
    ).toBeVisible();
    expect(panel(1)).toHaveAttribute("data-focused", "true");
    expect(panel(2)).toHaveAttribute("data-focused", "false");
    expect(beta).toHaveFocus();
  });

  it("does not resurrect the source group after it closes during a search-result read", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    setup(adapter);
    await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    adapter.delayed.add(ALPHA);
    fireEvent.click(await searchForFixture());
    await waitFor(() => expect(adapter.pending.has(ALPHA)).toBe(true));
    fireEvent.click(within(rail(2)).getByRole("button", { name: "关闭 gamma.md" }));
    await act(async () => adapter.pending.get(ALPHA)!());
    expect(screen.getAllByRole("region", { name: /^编辑分屏 \d+$/u })).toHaveLength(1);
    expect(
      within(panel(1)).getByRole("textbox", { name: `Document body ${BETA}` }),
    ).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: `Document body ${ALPHA}` }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTitle(GAMMA)).not.toBeInTheDocument();
  });

  it("does not show late document failures after the user dismisses the startup notice", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    adapter.contents.delete(ALPHA);
    adapter.delayed.add(ALPHA);
    adapter.listWorkspace.mockRejectedValueOnce(new Error("Offline fixture"));
    setup(adapter);
    const notice = await screen.findByRole("complementary", {
      name: "部分浏览位置未能恢复",
    });
    fireEvent.click(within(notice).getByRole("button", { name: "关闭恢复提示" }));
    await act(async () => adapter.pending.get(ALPHA)!());
    await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    expect(
      screen.queryByRole("complementary", { name: "部分浏览位置未能恢复" }),
    ).not.toBeInTheDocument();
  });

  it("ignores late failed session restoration after an explicit new document", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    adapter.contents.delete(ALPHA);
    adapter.delayed.add(ALPHA);
    setup(adapter);
    await waitFor(() => expect(adapter.pending.has(ALPHA)).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "新建标签页" }));
    const draft = await screen.findByRole("textbox");
    fireEvent.change(draft, { target: { value: "Current draft remains" } });
    await act(async () => adapter.pending.get(ALPHA)!());
    expect(draft).toHaveValue("Current draft remains");
    expect(
      screen.queryByRole("complementary", { name: "部分浏览位置未能恢复" }),
    ).not.toBeInTheDocument();
    expect(adapter.openDocument.mock.calls).toEqual([[ALPHA]]);
  });

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
