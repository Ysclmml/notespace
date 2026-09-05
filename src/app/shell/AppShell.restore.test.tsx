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
import { SEARCH_HISTORY_STORAGE_KEY } from "../../features/workspace-search/searchHistory";
import {
  FAVORITES_STORAGE_KEY,
  loadFavorites,
  saveFavorites,
} from "../../features/favorites/favorites";
import { documentTemplates } from "../../features/templates/templates";

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
        matchLength: 2,
        snippet: "中文查找内容",
        snippetMatchStart: 2,
        snippetMatchEnd: 4,
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
  fireEvent.keyDown(window, { key: "f", ctrlKey: true, shiftKey: true });
  const search = await screen.findByRole("search");
  const input = within(search).getByRole("searchbox");
  fireEvent.change(input, { target: { value: "查找" } });
  fireEvent.submit(input.closest("form")!);
  return within(search).findByRole("button", { name: /中文\s*查找\s*内容/ });
}

function exportHtml() {
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "导出" }));
  fireEvent.click(screen.getByRole("menuitem", { name: /^HTML…/ }));
  fireEvent.click(screen.getByRole("button", { name: "选择保存位置并导出" }));
}

function clearBrowsingStorage() {
  localStorage.removeItem(FAVORITES_STORAGE_KEY);
  localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
  localStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
  localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_KEY);
}

beforeEach(clearBrowsingStorage);
afterEach(() => {
  cleanup();
  clearBrowsingStorage();
});

describe("AppShell startup browsing", () => {
  it("creates a dirty template in the focused group without replacing another document", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    setup(adapter);
    const original = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从模板新建" }));
    fireEvent.click(screen.getByRole("button", { name: /工作周报 本周进展/ }));
    const template = documentTemplates("zh-CN").find((item) => item.id === "weekly")!;
    expect(
      await screen.findByRole("textbox", {
        name: "Document body untitled://工作周报-1.md",
      }),
    ).toHaveValue(template.markdown);
    expect(
      within(rail(2)).getByRole("button", { name: /工作周报-1.md 未保存/ }),
    ).toBeInTheDocument();
    expect(within(rail(2)).getByLabelText("未保存")).toBeInTheDocument();
    expect(adapter.contents.get(GAMMA)).toBe("# Gamma on disk\n");
    expect(original).toHaveValue("# Gamma on disk\n");
    expect(screen.getByRole("button", { name: "收藏当前文件" })).toBeDisabled();
  });

  it("loads the custom library lazily, saves the current draft as a copy, and reads it into a new dirty tab", async () => {
    seedBrowsing();
    const draft = "# Current unsaved draft\n\nKeep the original document.\n";
    const template = {
      path: "/template-fixtures/Local copy.md",
      title: "Local copy",
      sizeBytes: draft.length,
    };
    const adapter = Object.assign(new RestoreAdapter(), {
      listDocumentTemplates: vi.fn<NonNullable<DesktopAdapter["listDocumentTemplates"]>>(
        async () => ({
          directoryPath: "/template-fixtures",
          templates: [],
          skippedCount: 0,
          truncated: false,
        }),
      ),
      readDocumentTemplate: vi.fn<NonNullable<DesktopAdapter["readDocumentTemplate"]>>(
        async () => ({ ...template, markdown: draft }),
      ),
      saveDocumentTemplate: vi.fn<NonNullable<DesktopAdapter["saveDocumentTemplate"]>>(
        async () => template,
      ),
    });
    const saveDocument = vi.spyOn(adapter, "saveDocument");
    const saveDocumentAs = vi.spyOn(adapter, "saveDocumentAs");
    setup(adapter);
    const original = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.change(original, { target: { value: draft } });
    expect(adapter.listDocumentTemplates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从模板新建" }));
    const dialog = screen.getByRole("dialog", { name: "从模板新建" });
    expect(within(dialog).getByRole("tab", { name: "内置模板" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(adapter.listDocumentTemplates).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("tab", { name: "自定义模板" }));
    await within(dialog).findByText(
      "还没有自定义模板。可以保存当前正文，或打开文件夹放入 Markdown 文件。",
    );
    expect(adapter.listDocumentTemplates).toHaveBeenCalledExactlyOnceWith();
    expect(adapter.readDocumentTemplate).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "模板名称" }), {
      target: { value: template.title },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存模板" }));
    await within(dialog).findByText("已保存模板“Local copy”。原文档保持不变。");
    expect(adapter.saveDocumentTemplate).toHaveBeenCalledExactlyOnceWith(
      template.title,
      draft,
    );
    expect(adapter.listDocumentTemplates).toHaveBeenCalledTimes(1);
    expect(adapter.readDocumentTemplate).not.toHaveBeenCalled();
    expect(saveDocument).not.toHaveBeenCalled();
    expect(saveDocumentAs).not.toHaveBeenCalled();
    expect(adapter.contents.get(GAMMA)).toBe("# Gamma on disk\n");
    expect(original).toHaveValue(draft);
    expect(screen.getAllByRole("button", { name: /^关闭 .+\.md$/ })).toHaveLength(3);
    expect(within(rail(2)).getByRole("button", { name: /gamma.md 未保存/ })).toBeVisible();

    fireEvent.click(within(dialog).getByRole("button", { name: /Local copy.*Markdown/ }));
    const copy = await screen.findByRole("textbox", {
      name: "Document body untitled://Local copy-1.md",
    });
    expect(copy).toHaveValue(draft);
    expect(adapter.readDocumentTemplate).toHaveBeenCalledExactlyOnceWith(template.path);
    expect(adapter.openDocument).not.toHaveBeenCalledWith(template.path);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      within(rail(2)).getByRole("button", { name: /Local copy-1.md 未保存/ }),
    ).toBeVisible();
    fireEvent.change(copy, { target: { value: "# Independent template document\n" } });
    fireEvent.click(within(rail(2)).getByRole("button", { name: /gamma.md 未保存/ }));
    expect(screen.getByRole("textbox", { name: `Document body ${GAMMA}` })).toHaveValue(
      draft,
    );
    expect(adapter.contents.get(GAMMA)).toBe("# Gamma on disk\n");
    expect(saveDocument).not.toHaveBeenCalled();
    expect(saveDocumentAs).not.toHaveBeenCalled();
  });

  it("keeps built-in templates usable when the adapter has no custom-template methods", async () => {
    setup(new RestoreAdapter(), "empty");
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从模板新建" }));
    const dialog = screen.getByRole("dialog", { name: "从模板新建" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "自定义模板" }));
    expect(
      within(dialog).getByText("自定义模板需要桌面应用；浏览器演示可使用内置模板。"),
    ).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "保存模板" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("tab", { name: "内置模板" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /会议记录 议题/ }));
    expect(
      await screen.findByRole("textbox", {
        name: "Document body untitled://会议记录-1.md",
      }),
    ).toHaveValue(documentTemplates("zh-CN")[0]!.markdown);
  });

  it("keeps an empty custom template dirty and asks before closing without touching the source", async () => {
    seedBrowsing();
    const template = {
      path: "/template-fixtures/Empty template.md",
      title: "Empty template",
      sizeBytes: 0,
    };
    const adapter = Object.assign(new RestoreAdapter(), {
      listDocumentTemplates: vi.fn<NonNullable<DesktopAdapter["listDocumentTemplates"]>>(
        async () => ({
          directoryPath: "/template-fixtures",
          templates: [template],
          skippedCount: 0,
          truncated: false,
        }),
      ),
      readDocumentTemplate: vi.fn<NonNullable<DesktopAdapter["readDocumentTemplate"]>>(
        async () => ({ ...template, markdown: "" }),
      ),
      saveDocumentTemplate: vi.fn<NonNullable<DesktopAdapter["saveDocumentTemplate"]>>(
        async () => template,
      ),
    });
    const saveDocument = vi.spyOn(adapter, "saveDocument");
    const saveDocumentAs = vi.spyOn(adapter, "saveDocumentAs");
    setup(adapter);
    const original = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从模板新建" }));
    const dialog = screen.getByRole("dialog", { name: "从模板新建" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "自定义模板" }));
    fireEvent.click(
      await within(dialog).findByRole("button", { name: /Empty template.*Markdown/ }),
    );
    const empty = await screen.findByRole("textbox", {
      name: "Document body untitled://Empty template-1.md",
    });
    expect(empty).toHaveValue("");
    expect(
      within(rail(2)).getByRole("button", { name: /Empty template-1.md 未保存/ }),
    ).toBeVisible();
    expect(original).toHaveValue("# Gamma on disk\n");
    expect(adapter.contents.get(GAMMA)).toBe("# Gamma on disk\n");
    fireEvent.click(
      within(rail(2)).getByRole("button", { name: "关闭 Empty template-1.md" }),
    );
    const confirmation = screen.getByRole("alertdialog", { name: "有未保存的更改" });
    expect(within(confirmation).getByText("Empty template-1.md")).toBeVisible();
    fireEvent.click(within(confirmation).getByRole("button", { name: "取消" }));
    expect(empty).toBeInTheDocument();
    expect(adapter.saveDocumentTemplate).not.toHaveBeenCalled();
    expect(saveDocument).not.toHaveBeenCalled();
    expect(saveDocumentAs).not.toHaveBeenCalled();
  });

  it("cancels a template without creating a new tab and keeps focus mode view-only", async () => {
    seedBrowsing();
    setup(new RestoreAdapter());
    const original = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "从模板新建" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getAllByRole("button", { name: /^关闭 .+\.md$/ })).toHaveLength(3);
    fireEvent.keyDown(original, { key: "Enter", ctrlKey: true, shiftKey: true });
    expect(original.closest(".app-shell")).toHaveClass("app-shell--focus");
    fireEvent.keyDown(original, { key: ",", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(original.closest(".app-shell")).toHaveClass("app-shell--focus");
    fireEvent.keyDown(original, { key: "Escape" });
    expect(original.closest(".app-shell")).not.toHaveClass("app-shell--focus");
    expect(screen.getByRole("textbox", { name: `Document body ${GAMMA}` })).toBe(original);
    expect(within(rail(2)).queryByLabelText("未保存")).not.toBeInTheDocument();
  });

  it("persists favorite paths independently of tabs and keeps missing favorites removable", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    setup(adapter);
    await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.click(screen.getByRole("button", { name: "收藏当前文件" }));
    expect(loadFavorites()).toEqual([GAMMA]);
    fireEvent.click(within(rail(2)).getByRole("button", { name: "关闭 gamma.md" }));
    adapter.contents.delete(GAMMA);
    const favorites = screen.getByRole("region", { name: "收藏" });
    fireEvent.click(within(favorites).getByRole("button", { name: "gamma.md" }));
    expect(await screen.findByText(/Missing fixture/)).toBeVisible();
    expect(loadFavorites()).toEqual([GAMMA]);
    fireEvent.click(within(favorites).getByRole("button", { name: "取消收藏 gamma.md" }));
    expect(loadFavorites()).toEqual([]);
    expect(within(favorites).getByText("还没有收藏的文件")).toBeVisible();
  });

  it("hides the Favorites group only after choosing its heading-menu action", async () => {
    seedBrowsing();
    saveFavorites([ALPHA]);
    setup(new RestoreAdapter());
    await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    const heading = within(screen.getByRole("region", { name: "收藏" })).getByRole(
      "button",
      { name: "折叠收藏" },
    );

    fireEvent.contextMenu(heading);
    expect(screen.getByRole("region", { name: "收藏" })).toBeVisible();
    expect(loadFavorites()).toEqual([ALPHA]);
    fireEvent.click(screen.getByRole("menuitem", { name: "关闭收藏" }));
    expect(screen.queryByRole("region", { name: "收藏" })).not.toBeInTheDocument();
    expect(loadFavorites()).toEqual([ALPHA]);

    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    const settings = screen.getByRole("dialog");
    const showFavorites = within(settings).getByRole("checkbox", { name: "显示收藏" });
    expect(showFavorites).not.toBeChecked();
    fireEvent.click(showFavorites);
    expect(screen.getByRole("region", { name: "收藏" })).toBeVisible();
    expect(loadFavorites()).toEqual([ALPHA]);
  });

  it("adds and removes a file-tree favorite without opening or changing the active document", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    setup(adapter);
    const original = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    const tree = screen.getByRole("list", { name: /工作区文件.*Session fixtures/ });
    const file = within(tree).getByRole("button", { name: "alpha.md" });
    const openCalls = adapter.openDocument.mock.calls.length;
    fireEvent.contextMenu(file);
    fireEvent.click(screen.getByRole("menuitem", { name: "添加到收藏" }));
    const favorites = screen.getByRole("region", { name: "收藏" });
    expect(within(favorites).getByRole("button", { name: "alpha.md" })).toBeVisible();
    expect(loadFavorites()).toEqual([ALPHA]);
    expect(screen.getByRole("textbox", { name: `Document body ${GAMMA}` })).toBe(original);
    expect(original).toHaveValue("# Gamma on disk\n");
    expect(adapter.openDocument).toHaveBeenCalledTimes(openCalls);
    expect(screen.queryByLabelText("未保存")).toBeNull();
    fireEvent.contextMenu(file);
    fireEvent.click(screen.getByRole("menuitem", { name: "取消收藏" }));
    expect(within(favorites).queryByRole("button", { name: "alpha.md" })).toBeNull();
    expect(loadFavorites()).toEqual([]);
    expect(adapter.contents.get(ALPHA)).toBe("# Alpha on disk\n");
  });

  it("opens a favorite as an independent file without reopening its closed recent workspace", async () => {
    seedBrowsing();
    saveFavorites([ALPHA]);
    const adapter = new RestoreAdapter();
    setup(adapter, "empty");
    fireEvent.click(
      within(screen.getByRole("region", { name: "收藏" })).getByRole("button", {
        name: "alpha.md",
      }),
    );
    expect(
      await screen.findByRole("textbox", { name: `Document body ${ALPHA}` }),
    ).toHaveValue("# Alpha on disk\n");
    expect(adapter.openDocument).toHaveBeenCalledExactlyOnceWith(ALPHA);
    expect(adapter.listWorkspace).not.toHaveBeenCalled();
    expect(adapter.pickWorkspace).not.toHaveBeenCalled();
    expect(loadWorkspaceHistory().openWorkspaces).toEqual([]);
    expect(loadWorkspaceHistory().recentWorkspaces[0]?.path).toBe(ROOT);
    expect(loadFavorites()).toEqual([ALPHA]);
    fireEvent.click(screen.getByRole("button", { name: "全文搜索" }));
    expect(
      within(screen.getByRole("dialog")).getByText(
        "先打开一个工作区，即可搜索其中的文档和代码。",
      ),
    ).toBeVisible();
    expect(adapter.searchWorkspaces).not.toHaveBeenCalled();
  });

  it("trims stored search conditions immediately when the setting is lowered", async () => {
    localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify(
        Array.from({ length: 20 }, (_, index) => ({
          query: `query-${index}`,
          scopePath: "",
          caseSensitive: false,
          useRegex: false,
          fileFilter: "",
          lastUsedAt: index,
        })),
      ),
    );
    const adapter = new RestoreAdapter();
    setup(adapter, "empty");
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? "[]"),
      ).toHaveLength(15),
    );

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^设置…/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "最近搜索数量" }), {
      target: { value: "4" },
    });
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? "[]"),
      ).toHaveLength(4),
    );
    expect(screen.queryByRole("dialog", { name: "工作区全文搜索" })).toBeNull();
  });

  it("requires per-export opt-in for online images and cancellation starts no export", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    setup(adapter);
    await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^HTML…/ }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(adapter.exportHtml).not.toHaveBeenCalled();
    exportHtml();
    await waitFor(() => expect(adapter.exportHtml).toHaveBeenCalledTimes(1));
    expect(adapter.exportHtml.mock.calls[0]?.[4]).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^HTML…/ }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "选择保存位置并导出" }));
    await waitFor(() => expect(adapter.exportHtml).toHaveBeenCalledTimes(2));
    expect(adapter.exportHtml.mock.calls[1]?.[4]).toBe(true);
  });

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

  it("opens global content search from the toolbar with all open roots and only Files/Outline in the sidebar", async () => {
    const snapshot = seedBrowsing();
    const otherRoot = "/second-search-fixtures";
    const closedRoot = "/closed-search-fixtures";
    const first = { path: ROOT, name: "Session fixtures", lastOpenedAt: 1 };
    const second = {
      path: otherRoot,
      name: "Second fixtures",
      lastOpenedAt: 2,
      showHidden: true,
    };
    saveSessionSnapshot({ ...snapshot, workspacePaths: [ROOT, otherRoot] });
    saveWorkspaceHistory({
      openWorkspaces: [first, second],
      activeWorkspacePath: ROOT,
      recentWorkspaces: [
        first,
        second,
        { path: closedRoot, name: "Closed fixtures", lastOpenedAt: 0 },
      ],
      recentFiles: [],
    });
    const adapter = new RestoreAdapter();
    adapter.contents.set(`${otherRoot}/second.md`, "# Another workspace\n");
    setup(adapter);
    await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    const sidebarTabs = within(screen.getByRole("tablist", { name: "侧栏内容" }));
    expect(sidebarTabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "文件",
      "大纲",
    ]);
    expect(screen.getByRole("button", { name: /快速打开/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "全文搜索" }));
    const dialog = screen.getByRole("dialog");
    const scope = within(dialog).getByRole("combobox", { name: "搜索范围" });
    expect(scope).toHaveTextContent("全部已打开的工作区 (2)");
    expect(within(dialog).getByText(/磁盘正文，不包含未保存的修改/)).toBeVisible();
    expect(within(dialog).queryByText(/按文件名查找.*快速打开/)).toBeNull();
    const input = within(dialog).getByRole("searchbox");
    fireEvent.change(input, { target: { value: "查找" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() =>
      expect(adapter.searchWorkspaces).toHaveBeenCalledExactlyOnceWith(
        [
          { path: ROOT, showHidden: false },
          { path: otherRoot, showHidden: true },
        ],
        "查找",
        false,
        false,
        "",
      ),
    );
    fireEvent.click(scope);
    expect(within(dialog).queryByRole("option", { name: /Closed fixtures/ })).toBeNull();
  });

  it("searches disk in the global dialog and opens a result in the focused split without replacing a kept page", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    adapter.contents.set(ALPHA, "# Alpha\n中文查找内容\n");
    setup(adapter);
    const gamma = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.change(gamma, { target: { value: "# Local draft" } });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true, shiftKey: true });
    const search = await screen.findByRole("search");
    const input = within(search).getByRole("searchbox");
    fireEvent.change(input, { target: { value: "查找" } });
    fireEvent.submit(input.closest("form")!);
    const result = await within(search).findByRole("button", {
      name: /中文\s*查找\s*内容/,
    });
    const results = search.querySelector<HTMLElement>(".workspace-search__results")!;
    results.scrollTop = 96;
    fireEvent.scroll(results);
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
      false,
      "",
    );
    const tabs = rail(2);
    expect(within(tabs).getByTitle(GAMMA)).toBeInTheDocument();
    expect(within(tabs).getByLabelText("未保存")).toBeInTheDocument();
    expect(search).not.toBeInTheDocument();
    expect(document.querySelector(".workspace-search-dialog-layer")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "全文搜索" }));
    const reopenedSearch = await screen.findByRole("search");
    expect(within(reopenedSearch).getByRole("searchbox")).toHaveValue("查找");
    expect(adapter.searchWorkspaces).toHaveBeenCalledOnce();
    expect(within(reopenedSearch).getByTitle("alpha.md:2:3")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(
      reopenedSearch.querySelector<HTMLElement>(".workspace-search__results")!.scrollTop,
    ).toBe(96);
  });

  it("exports the current unsaved Markdown snapshot without saving or clearing dirty state", async () => {
    seedBrowsing();
    const adapter = new RestoreAdapter();
    setup(adapter);
    const gamma = await screen.findByRole("textbox", { name: `Document body ${GAMMA}` });
    fireEvent.change(gamma, { target: { value: "# Export latest\n\n中文内容" } });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^HTML…/ }));
    fireEvent.click(screen.getByRole("button", { name: "选择保存位置并导出" }));
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
      exportLabel: "导出",
      message:
        "导出失败：文档超过 HTML 导出的 8 MiB 大小限制。当前编辑已保留，请拆分文档后重试。",
    },
    {
      locale: "en-US" as const,
      more: "More Actions",
      exportLabel: "Export",
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
      fireEvent.click(screen.getByRole("menuitem", { name: /^HTML…/ }));
      fireEvent.click(
        screen.getByRole("button", {
          name: locale === "zh-CN" ? "选择保存位置并导出" : "Choose destination and export",
        }),
      );
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
