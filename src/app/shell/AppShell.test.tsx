import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { language as codeMirrorLanguage } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { StrictMode, type ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DemoDesktopAdapter,
  type DesktopAdapter,
  type NativeMenuActionId,
  type OpenDocumentResult,
  type WorkspaceNode,
} from "../../infrastructure/tauri/desktopAdapter";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "../../features/editor/spike/domTestSupport";
import { AppSettingsProvider } from "../settings";
import type { AppSettings } from "../settings";
import { WORKSPACE_HISTORY_STORAGE_KEY } from "../../features/workspace/workspaceHistory";
import { SESSION_SNAPSHOT_STORAGE_KEY } from "../../features/session-restore/sessionSnapshot";
import { AppShell } from "./AppShell";

const nativeWindowTestState = vi.hoisted(() => {
  const closeListeners: Array<(event: { preventDefault(): void }) => void> = [];
  return {
    closeListeners,
    close: vi.fn(async () => {
      for (const listener of [...closeListeners]) {
        listener({ preventDefault() {} });
      }
    }),
    destroy: vi.fn(async () => undefined),
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: nativeWindowTestState.close,
    destroy: nativeWindowTestState.destroy,
    onCloseRequested: async (listener: (event: { preventDefault(): void }) => void) => {
      nativeWindowTestState.closeListeners.push(listener);
      return () => {
        const index = nativeWindowTestState.closeListeners.indexOf(listener);
        if (index >= 0) nativeWindowTestState.closeListeners.splice(index, 1);
      };
    },
  }),
}));

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

afterEach(() => {
  localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_KEY);
  localStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
  nativeWindowTestState.closeListeners.length = 0;
  nativeWindowTestState.close.mockClear();
  nativeWindowTestState.destroy.mockClear();
  vi.restoreAllMocks();
});

const anchorDocuments = new Map([
  [
    "/workspace/main.md",
    [
      "# Main",
      "",
      "[Jump here](#local-section)",
      "",
      "[Open duplicate](other.md#section-1)",
      "",
      "Local source: `example.py:2`",
      "",
      "[Worker source](worker.rs)",
      "",
      "Worker target: `worker.rs:3`",
      "",
      "## Local section",
      "",
      "Body",
    ].join("\n"),
  ],
  [
    "/workspace/other.md",
    ["# Other", "", "## Section", "", "First", "", "## Section", "", "Second"].join("\n"),
  ],
  [
    "/workspace/example.py",
    [
      "from pathlib import Path",
      "",
      "def workspace_name(path: str) -> str:",
      "    return Path(path).name",
    ].join("\n"),
  ],
  [
    "/workspace/worker.rs",
    [
      "use std::path::Path;",
      "",
      "fn worker_name() -> &'static str {",
      '    "worker"',
      "}",
    ].join("\n"),
  ],
]);

const anchorTree: readonly WorkspaceNode[] = [
  {
    kind: "markdown",
    name: "main.md",
    path: "/workspace/main.md",
    relativePath: "main.md",
  },
  {
    kind: "markdown",
    name: "other.md",
    path: "/workspace/other.md",
    relativePath: "other.md",
  },
  {
    kind: "text",
    name: "example.py",
    path: "/workspace/example.py",
    relativePath: "example.py",
  },
  {
    kind: "text",
    name: "worker.rs",
    path: "/workspace/worker.rs",
    relativePath: "worker.rs",
  },
];

class AnchorDesktopAdapter implements DesktopAdapter {
  readonly kind: DesktopAdapter["kind"] = "demo";
  readonly revealedPaths: string[] = [];

  async pickWorkspace() {
    return { path: "/workspace", name: "Anchor fixtures" };
  }

  async pickDocument() {
    return { path: "/workspace/example.py", name: "example.py" };
  }

  async listWorkspace() {
    return anchorTree;
  }

  async openDocument(path: string): Promise<OpenDocumentResult> {
    const content = anchorDocuments.get(path);
    if (content === undefined) throw new Error("fixture missing");
    const isMarkdown = path.endsWith(".md");
    return {
      status: "editable",
      path,
      content,
      mode: "normal",
      documentKind: isMarkdown ? "markdown" : "text",
      language: isMarkdown
        ? "markdown"
        : path.endsWith(".py")
          ? "python"
          : path.endsWith(".rs")
            ? "rust"
            : "text",
      preflight: {
        sizeBytes: content.length,
        longestLineBytes: 40,
        containsDataImageBase64: false,
      },
    };
  }

  async revealInFileManager(path: string) {
    this.revealedPaths.push(path);
  }

  async moveWorkspaceEntryToTrash() {}

  async createWorkspaceTextFile(
    workspaceRoot: string,
    directoryPath: string,
    fileName: string,
  ): Promise<OpenDocumentResult> {
    if (workspaceRoot !== "/workspace" || !directoryPath.startsWith(workspaceRoot)) {
      throw new Error("outside fixture workspace");
    }
    const path = `${directoryPath}/${fileName}`;
    anchorDocuments.set(path, "");
    return this.openDocument(path);
  }

  async saveDocument(path: string, content: string) {
    return { path, bytesWritten: content.length };
  }

  async saveDocumentAs(suggestedFileName: string, content: string) {
    const path = `/workspace/${suggestedFileName}`;
    anchorDocuments.set(path, content);
    return { path, bytesWritten: content.length };
  }

  async previewLocalFile(reference: string) {
    const match = /^(.*?)(?::(\d+))?$/u.exec(reference);
    const referencePath = (match?.[1] ?? "example.py").replace(/^\.\//u, "");
    const path = referencePath.startsWith("/")
      ? referencePath
      : `/workspace/${referencePath}`;
    const targetLine = Number.parseInt(match?.[2] ?? "1", 10);
    return {
      path,
      language: path.endsWith(".py") ? "python" : path.endsWith(".rs") ? "rust" : "text",
      targetLine,
      startLine: 1,
      content: anchorDocuments.get(path) ?? "",
    };
  }

  async saveClipboardImage(): Promise<never> {
    throw new Error("not used");
  }
}

class TrashRecordingAdapter extends AnchorDesktopAdapter {
  readonly listWorkspaceCalls: string[] = [];
  readonly trashCalls: Array<{ workspaceRoot: string; path: string }> = [];
  private readonly trashedPaths = new Set<string>();

  override async listWorkspace(rootPath = "/workspace") {
    this.listWorkspaceCalls.push(rootPath);
    return anchorTree.filter((node) => !this.trashedPaths.has(node.path));
  }

  override async moveWorkspaceEntryToTrash(
    workspaceRoot = "/workspace",
    path = "/workspace/example.py",
  ) {
    this.trashCalls.push({ workspaceRoot, path });
    this.trashedPaths.add(path);
  }
}

class RefreshFailingCreateAdapter extends AnchorDesktopAdapter {
  readonly openedPaths: string[] = [];
  private failRefresh = false;

  override async listWorkspace() {
    if (this.failRefresh) throw new Error("refresh failed");
    return super.listWorkspace();
  }

  override async openDocument(path: string) {
    this.openedPaths.push(path);
    return super.openDocument(path);
  }

  override async createWorkspaceTextFile(
    workspaceRoot: string,
    directoryPath: string,
    fileName: string,
  ) {
    if (workspaceRoot !== "/workspace" || !directoryPath.startsWith(workspaceRoot)) {
      throw new Error("outside fixture workspace");
    }
    const path = `${directoryPath}/${fileName}`;
    anchorDocuments.set(path, "");
    const created = await super.openDocument(path);
    this.failRefresh = true;
    return created;
  }
}

class NativeAnchorDesktopAdapter extends AnchorDesktopAdapter {
  override readonly kind = "tauri" as const;
  private nativeMenuListener: ((actionId: NativeMenuActionId) => void) | undefined;

  async listenNativeMenuAction(listener: (actionId: NativeMenuActionId) => void) {
    this.nativeMenuListener = listener;
    return () => {
      if (this.nativeMenuListener === listener) this.nativeMenuListener = undefined;
    };
  }

  hasNativeMenuListener() {
    return this.nativeMenuListener !== undefined;
  }

  emitNativeMenuAction(actionId: NativeMenuActionId) {
    this.nativeMenuListener?.(actionId);
  }
}

class MultipleWorkspaceAdapter implements DesktopAdapter {
  readonly kind = "demo" as const;
  private workspaceIndex = 0;
  private readonly documents = new Map([
    ["/workspace-a/a.json", '{"workspace":"a"}'],
    ["/workspace-b/b.rs", "fn main() {}"],
  ]);

  async pickWorkspace() {
    const selections = [
      { path: "/workspace-a", name: "工作区 A" },
      { path: "/workspace-b", name: "工作区 B" },
    ];
    return selections[Math.min(this.workspaceIndex++, selections.length - 1)] ?? null;
  }

  async pickDocument() {
    return null;
  }

  async listWorkspace(rootPath: string): Promise<readonly WorkspaceNode[]> {
    const isA = rootPath === "/workspace-a";
    const name = isA ? "a.json" : "b.rs";
    return [
      {
        kind: "text",
        name,
        path: `${rootPath}/${name}`,
        relativePath: name,
      },
    ];
  }

  async openDocument(path: string): Promise<OpenDocumentResult> {
    const content = this.documents.get(path);
    if (content === undefined) throw new Error("fixture missing");
    return {
      status: "editable",
      path,
      content,
      mode: "normal",
      documentKind: "text",
      language: path.endsWith(".json") ? "json" : "rust",
      preflight: {
        sizeBytes: content.length,
        longestLineBytes: content.length,
        containsDataImageBase64: false,
      },
    };
  }

  async revealInFileManager() {
    return undefined;
  }

  async createWorkspaceTextFile(
    workspaceRoot: string,
    directoryPath: string,
    fileName: string,
  ): Promise<OpenDocumentResult> {
    const path = `${directoryPath}/${fileName}`;
    if (!directoryPath.startsWith(workspaceRoot)) throw new Error("outside fixture");
    this.documents.set(path, "");
    return this.openDocument(path);
  }

  async saveDocument(path: string, content: string) {
    this.documents.set(path, content);
    return { path, bytesWritten: content.length };
  }

  async saveDocumentAs(suggestedFileName: string, content: string) {
    const path = `/workspace-b/${suggestedFileName}`;
    this.documents.set(path, content);
    return { path, bytesWritten: content.length };
  }

  async previewLocalFile(): Promise<never> {
    throw new Error("not used");
  }

  async saveClipboardImage(): Promise<never> {
    throw new Error("not used");
  }

  async moveWorkspaceEntryToTrash() {}
}

class CodeTextDesktopAdapter extends AnchorDesktopAdapter {
  private readonly codeDocuments = new Map([
    [
      "/code-workspace/sample.json",
      ["{", '  "workspace": "sample",', '  "enabled": true', "}"].join("\n"),
    ],
    [
      "/code-workspace/start.sh",
      ["#!/bin/sh", "if [ -f .env ]; then", '  echo "ready"', "fi"].join("\n"),
    ],
  ]);

  override async pickWorkspace() {
    return { path: "/code-workspace", name: "Code fixtures" };
  }

  override async listWorkspace(): Promise<readonly WorkspaceNode[]> {
    return [
      {
        kind: "text",
        name: "sample.json",
        path: "/code-workspace/sample.json",
        relativePath: "sample.json",
      },
      {
        kind: "text",
        name: "start.sh",
        path: "/code-workspace/start.sh",
        relativePath: "start.sh",
      },
    ];
  }

  override async openDocument(path: string): Promise<OpenDocumentResult> {
    const content = this.codeDocuments.get(path);
    if (content === undefined) throw new Error("fixture missing");
    return {
      status: "editable",
      path,
      content,
      mode: "normal",
      documentKind: "text",
      language: path.endsWith(".json") ? "json" : "shell",
      preflight: {
        sizeBytes: content.length,
        longestLineBytes: Math.max(...content.split("\n").map((line) => line.length)),
        containsDataImageBase64: false,
      },
    };
  }
}

class CapturingSaveAsAdapter extends AnchorDesktopAdapter {
  excludedPaths: readonly string[] = [];

  override async saveDocumentAs(
    suggestedFileName: string,
    content: string,
    excludedPaths: readonly string[] = [],
  ) {
    this.excludedPaths = excludedPaths;
    return super.saveDocumentAs(suggestedFileName, content);
  }
}

class FailingSaveAdapter extends AnchorDesktopAdapter {
  override async saveDocument(): Promise<never> {
    throw new Error("disk full");
  }
}

class RecordingAutoSaveAdapter extends AnchorDesktopAdapter {
  readonly saved: Array<{ path: string; content: string }> = [];

  override async saveDocument(path: string, content: string) {
    this.saved.push({ path, content });
    return super.saveDocument(path, content);
  }
}

class SerializedSaveAdapter extends AnchorDesktopAdapter {
  readonly saveCalls: Array<{
    readonly path: string;
    readonly content: string;
    readonly resolve: () => void;
  }> = [];
  readonly completedContents: string[] = [];

  override saveDocument(path: string, content: string) {
    return new Promise<{ path: string; bytesWritten: number }>((resolve) => {
      this.saveCalls.push({
        path,
        content,
        resolve: () => {
          this.completedContents.push(content);
          resolve({ path, bytesWritten: content.length });
        },
      });
    });
  }

  release(index: number) {
    this.saveCalls[index]?.resolve();
  }
}

class DelayedNativeMenuAdapter extends AnchorDesktopAdapter {
  override readonly kind = "tauri" as const;
  readonly registrations: Array<{
    readonly listener: (actionId: NativeMenuActionId) => void;
    readonly resolve: (unlisten: () => void) => void;
  }> = [];
  unlistenCount = 0;

  listenNativeMenuAction(listener: (actionId: NativeMenuActionId) => void) {
    return new Promise<() => void>((resolve) => {
      this.registrations.push({ listener, resolve });
    });
  }

  releaseRegistration(index: number) {
    this.registrations[index]?.resolve(() => {
      this.unlistenCount += 1;
    });
  }
}

class RestoreRaceAdapter implements DesktopAdapter {
  readonly kind = "tauri" as const;
  readonly listCalls: string[] = [];
  private finishValidRestore: ((nodes: readonly WorkspaceNode[]) => void) | undefined;
  private readonly validRestore = new Promise<readonly WorkspaceNode[]>((resolve) => {
    this.finishValidRestore = resolve;
  });

  releaseValidRestore() {
    this.finishValidRestore?.([
      {
        kind: "text",
        name: "restored.json",
        path: "/stored-valid/restored.json",
        relativePath: "restored.json",
      },
    ]);
  }

  async pickWorkspace() {
    return { path: "/user-opened", name: "用户打开" };
  }

  async pickDocument() {
    return null;
  }

  async listWorkspace(rootPath: string): Promise<readonly WorkspaceNode[]> {
    this.listCalls.push(rootPath);
    if (rootPath === "/stored-valid") return this.validRestore;
    if (rootPath === "/stored-missing") throw new Error("missing");
    return [
      {
        kind: "text",
        name: "user.json",
        path: "/user-opened/user.json",
        relativePath: "user.json",
      },
    ];
  }

  async openDocument(): Promise<never> {
    throw new Error("not used");
  }

  async revealInFileManager(): Promise<never> {
    throw new Error("not used");
  }

  async createWorkspaceTextFile(): Promise<never> {
    throw new Error("not used");
  }

  async saveDocument(): Promise<never> {
    throw new Error("not used");
  }

  async saveDocumentAs(): Promise<never> {
    throw new Error("not used");
  }

  async previewLocalFile(): Promise<never> {
    throw new Error("not used");
  }

  async saveClipboardImage(): Promise<never> {
    throw new Error("not used");
  }

  async moveWorkspaceEntryToTrash() {}
}

function renderShell(shell: ReactElement, initialSettings?: Partial<AppSettings>) {
  return render(
    <AppSettingsProvider initialSettings={initialSettings} storage={null}>
      {shell}
    </AppSettingsProvider>,
  );
}

async function waitForEditorView(element: HTMLElement): Promise<EditorView> {
  return waitFor(() => {
    const editor = element.matches(".cm-editor")
      ? element
      : element.querySelector<HTMLElement>(".cm-editor");
    if (!editor) throw new Error("CodeMirror editor was not mounted");
    const view = EditorView.findFromDOM(editor);
    if (!view) throw new Error("CodeMirror view was not mounted");
    return view;
  });
}

describe("AppShell", () => {
  it("renders an actionable local-first welcome screen", () => {
    renderShell(<AppShell adapter={new DemoDesktopAdapter()} />);

    expect(
      screen.getByRole("heading", { name: "把本地文档，当作可以编辑的浏览器。" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "打开演示工作区" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "后退" })).toBeDisabled();
    expect(screen.getByText("可视化编辑 Markdown", { exact: false })).toBeVisible();
  });

  it("opens the browser demo workspace and exposes its Markdown tree", async () => {
    renderShell(<AppShell adapter={new DemoDesktopAdapter()} />);

    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));

    expect(await screen.findByRole("button", { name: /00-阅读导航\.md/ })).toBeVisible();
    expect(screen.getByText("4 篇文档")).toBeVisible();
    expect(
      screen.getAllByText("Paper & Ink 示例", { exact: false }).length,
    ).toBeGreaterThan(0);
  });

  it("creates a file at the workspace root and reveals files or folders", async () => {
    const adapter = new RefreshFailingCreateAdapter();
    renderShell(<AppShell adapter={adapter} />);

    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    await screen.findByRole("button", { name: /main\.md/ });
    const root = screen.getByRole("button", { name: /折叠工作区 · Anchor fixtures/ });
    fireEvent.contextMenu(root, { clientX: 30, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: "新建文件" }));
    const nameInput = screen.getByRole("textbox", { name: "文件名" });
    fireEvent.change(nameInput, { target: { value: "notes" } });
    fireEvent.submit(nameInput.closest("form") as HTMLFormElement);

    expect(
      await screen.findByRole("button", { name: /notes\.md/, current: "page" }),
    ).toBeVisible();
    expect(screen.getByText("已在工作区新建 notes.md")).toBeVisible();
    expect(adapter.openedPaths).not.toContain("/workspace/notes.md");

    fireEvent.contextMenu(root, { clientX: 30, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: /Finder|文件管理器/ }));
    await waitFor(() => expect(adapter.revealedPaths).toContain("/workspace"));
  });

  it("cancels or confirms moving an open workspace file to Trash", async () => {
    const adapter = new TrashRecordingAdapter();
    const { container } = renderShell(<AppShell adapter={adapter} />);

    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    const sidebar = screen.getByRole("complementary", { name: "工作区侧栏" });
    const file = await within(sidebar).findByRole("button", { name: /^example\.py/ });
    fireEvent.click(file);
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitForEditorView(editor);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nchanged" } });
    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeTruthy());
    await waitFor(() =>
      expect(
        container.querySelector('.tab-rail__tab[title="/workspace/example.py"]'),
      ).toBeTruthy(),
    );

    fireEvent.contextMenu(file, { clientX: 30, clientY: 60 });
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    const firstDialog = await screen.findByRole("alertdialog", {
      name: "将“example.py”移到废纸篓？",
    });
    expect(within(firstDialog).getByText(/其中有 1 个未保存文件/)).toBeVisible();
    fireEvent.click(within(firstDialog).getByRole("button", { name: "取消" }));

    expect(adapter.trashCalls).toEqual([]);
    expect(within(sidebar).getByRole("button", { name: /^example\.py/ })).toBeVisible();
    expect(
      container.querySelector('.tab-rail__tab[title="/workspace/example.py"]'),
    ).toBeTruthy();

    fireEvent.contextMenu(within(sidebar).getByRole("button", { name: /^example\.py/ }), {
      clientX: 30,
      clientY: 60,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    const secondDialog = await screen.findByRole("alertdialog", {
      name: "将“example.py”移到废纸篓？",
    });
    fireEvent.click(within(secondDialog).getByRole("button", { name: "移到废纸篓" }));

    await waitFor(() =>
      expect(adapter.trashCalls).toEqual([
        { workspaceRoot: "/workspace", path: "/workspace/example.py" },
      ]),
    );
    await waitFor(() =>
      expect(within(sidebar).queryByRole("button", { name: /^example\.py/ })).toBeNull(),
    );
    expect(
      container.querySelector('.tab-rail__tab[title="/workspace/example.py"]'),
    ).toBeNull();
    expect(adapter.listWorkspaceCalls).toEqual(["/workspace", "/workspace"]);
    expect(screen.getByText("已将 example.py 移到废纸篓")).toBeVisible();
  });

  it("wraps long delete paths in a dedicated dialog body and keeps keyboard focus inside", async () => {
    const longName = `${"long-file-name-".repeat(16)}.md`;
    const longPath = `/workspace/${"nested-folder/".repeat(16)}${longName}`;
    class LongPathAdapter extends TrashRecordingAdapter {
      override async listWorkspace() {
        return [
          {
            name: longName,
            path: longPath,
            relativePath: longName,
            kind: "markdown" as const,
          },
        ];
      }
    }
    const adapter = new LongPathAdapter();
    renderShell(<AppShell adapter={adapter} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.contextMenu(await screen.findByRole("button", { name: longName }), {
      clientX: 30,
      clientY: 60,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveClass("confirmation-dialog");
    expect(within(dialog).getByText(longPath)).toHaveClass("confirmation-dialog__path");
    const cancel = within(dialog).getByRole("button", { name: "取消" });
    const confirm = within(dialog).getByRole("button", { name: "移到废纸篓" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "k", metaKey: true });
    fireEvent.keyDown(cancel, { key: ",", metaKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cancel).toHaveFocus();
    screen.getByRole("button", { name: "更多操作" }).focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(adapter.trashCalls).toEqual([]);
  });

  it("keeps deletion confirmation exclusive from native commands and window close", async () => {
    const adapter = new NativeAnchorDesktopAdapter();
    renderShell(<AppShell adapter={adapter} />);
    await waitFor(() => expect(nativeWindowTestState.closeListeners).toHaveLength(1));
    await waitFor(() => expect(adapter.hasNativeMenuListener()).toBe(true));
    fireEvent.click(screen.getAllByRole("button", { name: "打开工作区" })[0]!);
    fireEvent.contextMenu(await screen.findByRole("button", { name: "example.py" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    const dialog = await screen.findByRole("alertdialog");

    adapter.emitNativeMenuAction("app.settings");
    adapter.emitNativeMenuAction("file.new");
    adapter.emitNativeMenuAction("app.quit");
    const preventDefault = vi.fn();
    nativeWindowTestState.closeListeners[0]?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^关闭 .*\.md/u })).toBeNull();
    expect(nativeWindowTestState.destroy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    nativeWindowTestState.closeListeners[0]?.({ preventDefault });
    await waitFor(() => expect(nativeWindowTestState.destroy).toHaveBeenCalledOnce());
  });

  it("creates folders from sidebar blank space in the active root without a persistent toolbar", async () => {
    class FolderAdapter extends MultipleWorkspaceAdapter {
      readonly folders: Array<{
        workspaceRoot: string;
        directoryPath: string;
        folderName: string;
      }> = [];
      async createWorkspaceFolder(
        workspaceRoot: string,
        directoryPath: string,
        folderName: string,
      ) {
        this.folders.push({ workspaceRoot, directoryPath, folderName });
      }
      override async listWorkspace(rootPath: string): Promise<readonly WorkspaceNode[]> {
        return [
          ...(await super.listWorkspace(rootPath)),
          ...this.folders
            .filter((entry) => entry.workspaceRoot === rootPath)
            .map((entry) => ({
              name: entry.folderName,
              path: `${entry.directoryPath}/${entry.folderName}`,
              relativePath: entry.folderName,
              kind: "directory" as const,
              children: [],
            })),
        ];
      }
    }
    const adapter = new FolderAdapter();
    const { container } = renderShell(<AppShell adapter={adapter} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    await screen.findByRole("button", { name: /a\.json/ });
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "添加工作区…" }));
    await screen.findByRole("button", { name: /b\.rs/ });
    expect(container.querySelector(".workspace-tree__toolbar")).toBeNull();
    fireEvent.contextMenu(screen.getByRole("tabpanel"), { clientX: 50, clientY: 400 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "新建文件夹" }));
    const nameInput = screen.getByRole("textbox", { name: "文件夹名称" });
    fireEvent.change(nameInput, { target: { value: "新目录" } });
    fireEvent.submit(nameInput.closest("form") as HTMLFormElement);
    expect(await screen.findByRole("button", { name: /新目录/ })).toBeVisible();
    expect(adapter.folders).toEqual([
      {
        workspaceRoot: "/workspace-b",
        directoryPath: "/workspace-b",
        folderName: "新目录",
      },
    ]);
    expect(screen.getByText("已在工作区新建文件夹 新目录")).toBeVisible();
    expect(screen.getByRole("button", { name: /a\.json/ })).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "大纲" }));
    fireEvent.click(screen.getByRole("tab", { name: "文件" }));
    expect(screen.queryByRole("menu", { name: "文件操作" })).toBeNull();
    fireEvent.contextMenu(screen.getByRole("tabpanel"), { clientX: 55, clientY: 410 });
    expect(await screen.findByRole("menu", { name: "文件操作" })).toBeVisible();
  });

  it("opens a file in a new tab from its context menu without replacing the current tab", async () => {
    renderShell(<AppShell adapter={new MultipleWorkspaceAdapter()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    const file = await screen.findByRole("button", { name: /a\.json/ });
    fireEvent.click(file);
    await screen.findByLabelText("代码编辑器");
    fireEvent.contextMenu(file, { clientX: 30, clientY: 90 });
    fireEvent.click(screen.getByRole("menuitem", { name: "在新标签页中打开" }));
    const tabs = screen.getByRole("navigation", { name: "文档标签页" });
    await waitFor(() =>
      expect(within(tabs).getAllByRole("button", { name: "关闭 a.json" })).toHaveLength(2),
    );
  });

  it("keeps multiple workspace roots visible at the same time", async () => {
    renderShell(<AppShell adapter={new MultipleWorkspaceAdapter()} />);

    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    expect(await screen.findByRole("button", { name: /a\.json/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "添加工作区…" }));
    expect(await screen.findByRole("button", { name: /b\.rs/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /a\.json/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "切换工作区" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /工作区 A/ }));
    expect(await screen.findByRole("button", { name: /a\.json/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /b\.rs/ })).toBeVisible();
  });

  it("opens JSON and shell files in the main tab as CodeMirror code, then closes the last tab", async () => {
    const { container } = renderShell(<AppShell adapter={new CodeTextDesktopAdapter()} />);

    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /^sample\.json/ }));

    const jsonPreview = await screen.findByTestId("code-file-preview");
    expect(jsonPreview).toHaveAttribute("data-language", "json");
    expect(within(jsonPreview).getByText("JSON")).toBeVisible();
    const jsonView = await waitFor(() => {
      const jsonEditor = jsonPreview.querySelector<HTMLElement>(".cm-editor");
      if (!jsonEditor) throw new Error("JSON CodeMirror editor was not mounted");
      const mountedView = EditorView.findFromDOM(jsonEditor);
      if (!mountedView) throw new Error("JSON CodeMirror view was not found");
      return mountedView;
    });
    await waitFor(() =>
      expect(jsonView.state.facet(codeMirrorLanguage)?.name).toBe("json"),
    );
    expect(jsonView.state.doc.lines).toBe(4);
    expect(container.querySelector(".workspace-pane--primary .ProseMirror")).toBeNull();
    expect(screen.queryByRole("button", { name: "可视" })).toBeNull();
    expect(screen.queryByRole("button", { name: "源码" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^start\.sh/ }));
    const shellPreview = await screen.findByTestId("code-file-preview");
    expect(shellPreview).toHaveAttribute("data-language", "shell");
    expect(within(shellPreview).getByText("Shell")).toBeVisible();
    let shellView: EditorView | undefined;
    await waitFor(() => {
      const shellEditor = shellPreview.querySelector<HTMLElement>(".cm-editor");
      if (!shellEditor) throw new Error("shell CodeMirror editor was not mounted");
      const currentView = EditorView.findFromDOM(shellEditor);
      if (!currentView) throw new Error("shell CodeMirror view was not found");
      expect(currentView).not.toBe(jsonView);
      expect(currentView.state.facet(codeMirrorLanguage)?.name).toBe("shell");
      shellView = currentView;
    });
    if (!shellView) throw new Error("shell CodeMirror view did not finish loading");
    expect(shellView.state.doc.lines).toBe(4);
    expect(container.querySelector(".workspace-pane--primary .ProseMirror")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "关闭 start.sh" }));
    await waitFor(() => expect(screen.queryByTestId("code-file-preview")).toBeNull());
    expect(
      screen.getByRole("heading", { name: "把本地文档，当作可以编辑的浏览器。" }),
    ).toBeVisible();
  });

  it("opens a workspace rather than a single file with Cmd-Shift-O", async () => {
    const adapter = new MultipleWorkspaceAdapter();
    const pickWorkspace = vi.spyOn(adapter, "pickWorkspace");
    const pickDocument = vi.spyOn(adapter, "pickDocument");
    renderShell(<AppShell adapter={adapter} />);

    fireEvent.keyDown(window, { key: "o", metaKey: true, shiftKey: true });

    expect(await screen.findByRole("button", { name: /a\.json/ })).toBeVisible();
    expect(pickWorkspace).toHaveBeenCalledOnce();
    expect(pickDocument).not.toHaveBeenCalled();
  });

  it("switches to the empty outline and collapses the sidebar", () => {
    renderShell(<AppShell adapter={new DemoDesktopAdapter()} />);

    fireEvent.click(screen.getByRole("tab", { name: "大纲" }));
    expect(screen.getByText("当前没有可用大纲")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "收起侧栏" }));
    expect(screen.queryByRole("complementary", { name: "工作区侧栏" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
    expect(screen.getByRole("complementary", { name: "工作区侧栏" })).toBeVisible();
  });

  it("opens settings and switches every menu to English", async () => {
    renderShell(<AppShell adapter={new DemoDesktopAdapter()} />);

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /设置/ }));
    expect(screen.getByRole("dialog", { name: "设置" })).toBeVisible();

    fireEvent.change(screen.getByLabelText("界面语言"), {
      target: { value: "en-US" },
    });
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Quick Open/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Files" })).toBeVisible();
  });

  it("creates an editable text file and relocates its tab after Save As", async () => {
    const { container } = renderShell(<AppShell adapter={new AnchorDesktopAdapter()} />);

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "新建文本文件" }));
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitForEditorView(editor);
    view.dispatch({ changes: { from: 0, insert: "hello from text file" } });

    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /另存为/ }));

    await waitFor(() =>
      expect(
        container.querySelector('.tab-rail__tab[title="/workspace/未命名-1.txt"]'),
      ).toHaveAttribute("aria-current", "page"),
    );
    expect(screen.getByText("未命名-1.txt 已保存")).toBeVisible();
  });

  it("auto-saves a saved document after the configured inactivity delay", async () => {
    const adapter = new RecordingAutoSaveAdapter();
    const { container } = renderShell(<AppShell adapter={adapter} />, {
      autoSaveMode: "afterDelay",
      autoSaveDelaySeconds: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /example\.py/ }));
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitForEditorView(editor);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n# autosave" } });

    await waitFor(
      () =>
        expect(adapter.saved).toContainEqual({
          path: "/workspace/example.py",
          content: expect.stringContaining("# autosave") as string,
        }),
      { timeout: 2200 },
    );
    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeNull());
    expect(screen.getByText("已自动保存 example.py")).toBeVisible();
  });

  it("replans a pending auto-save when the configured delay changes", async () => {
    const adapter = new RecordingAutoSaveAdapter();
    renderShell(<AppShell adapter={adapter} />, {
      autoSaveMode: "afterDelay",
      autoSaveDelaySeconds: 2,
    });

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /打开文件/ }));
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitForEditorView(editor);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n# rescheduled" } });

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /设置/ }));
    fireEvent.change(screen.getByLabelText("自动保存延迟"), {
      target: { value: "1" },
    });

    await waitFor(() => expect(adapter.saved.at(-1)?.content).toContain("# rescheduled"), {
      timeout: 1700,
    });
  });

  it("serializes an in-flight auto-save before a newer manual save", async () => {
    const adapter = new SerializedSaveAdapter();
    const { container } = renderShell(<AppShell adapter={adapter} />, {
      autoSaveMode: "afterDelay",
      autoSaveDelaySeconds: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "打开文件…" }));
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitFor(() => {
      const mountedView = EditorView.findFromDOM(editor);
      if (!mountedView) throw new Error("Text editor view was not mounted");
      return mountedView;
    });
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n# older" } });
    await waitFor(() => expect(adapter.saveCalls).toHaveLength(1), { timeout: 1800 });

    view.dispatch({ changes: { from: view.state.doc.length, insert: "\n# newest" } });
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(adapter.saveCalls).toHaveLength(1);

    adapter.release(0);
    await waitFor(() => expect(adapter.saveCalls).toHaveLength(2));
    expect(adapter.saveCalls[1]?.content).toContain("# newest");
    adapter.release(1);

    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeNull());
    expect(adapter.completedContents.at(-1)).toContain("# newest");
  });

  it("excludes every other open session path from Save As", async () => {
    const adapter = new CapturingSaveAsAdapter();
    const { container } = renderShell(<AppShell adapter={adapter} />);

    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
    await screen.findByLabelText("Markdown 可视化编辑器");
    fireEvent.doubleClick(screen.getByTitle("/workspace/main.md"));
    fireEvent.click(screen.getByRole("button", { name: /^other\.md/ }));
    await screen.findByTitle("/workspace/other.md");

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /打开文件/ }));
    await waitFor(() =>
      expect(
        container.querySelector('.tab-rail__tab[title="/workspace/example.py"]'),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭 example.py" }));
    await waitFor(() =>
      expect(
        container.querySelector('.tab-rail__tab[title="/workspace/example.py"]'),
      ).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "新建文本文件" }));
    await screen.findByLabelText("代码编辑器");
    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /另存为/ }));

    await waitFor(() =>
      expect(adapter.excludedPaths).toEqual(["/workspace/main.md", "/workspace/other.md"]),
    );
  }, 10_000);

  it("closes the only standalone file tab and returns to the start page", async () => {
    renderShell(<AppShell adapter={new AnchorDesktopAdapter()} />);

    fireEvent.click(screen.getByRole("button", { name: "打开文件…" }));
    expect(await screen.findByLabelText("代码编辑器")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "关闭 example.py" }));

    expect(
      await screen.findByRole("heading", {
        name: "把本地文档，当作可以编辑的浏览器。",
      }),
    ).toBeVisible();
    expect(screen.queryByLabelText("代码编辑器")).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭 example.py" })).toBeNull();
  });

  it("confirms dirty sessions that only survive in the closing tab history", async () => {
    const { container } = renderShell(<AppShell adapter={new AnchorDesktopAdapter()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /^example\.py/ }));
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitFor(() => {
      const mountedView = EditorView.findFromDOM(editor);
      if (!mountedView) throw new Error("Text editor view was not mounted");
      return mountedView;
    });
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nchanged" } });
    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeTruthy());

    // File-tree clicks keep the dirty Tab. Navigate within it to test history-only dirtiness.
    fireEvent.click(screen.getByRole("button", { name: "快速打开 ⌘K" }));
    const quickOpen = container.querySelector<HTMLElement>(".quick-open");
    if (!quickOpen) throw new Error("Quick Open was not mounted");
    fireEvent.click(within(quickOpen).getByRole("button", { name: /other\.md/ }));
    await screen.findByTitle("/workspace/other.md");
    expect(container.querySelector(".tab-rail__dirty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭 other.md" }));

    const dialog = await screen.findByRole("alertdialog", {
      name: "有未保存的更改",
    });
    expect(within(dialog).getByText("example.py")).toBeVisible();
    expect(screen.getByTitle("/workspace/other.md")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "有未保存的更改" })).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭 other.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "放弃更改并关闭标签页" }));
    await waitFor(() => expect(screen.queryByTitle("/workspace/other.md")).toBeNull());
  });

  it("prevents browser close while a referenced document is dirty", async () => {
    const { container } = renderShell(<AppShell adapter={new AnchorDesktopAdapter()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件…" }));
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitForEditorView(editor);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nchanged" } });
    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeTruthy());

    const dirtyClose = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(dirtyClose)).toBe(false);
    expect(dirtyClose.defaultPrevented).toBe(true);

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeNull());
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(
      true,
    );
  });

  it("prevents a native Tauri window close when the user keeps dirty changes", async () => {
    const { container } = renderShell(
      <AppShell adapter={new NativeAnchorDesktopAdapter()} />,
    );
    await waitFor(() => expect(nativeWindowTestState.closeListeners).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "打开文件…" }));
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitForEditorView(editor);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nchanged" } });
    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeTruthy());

    const preventDefault = vi.fn();
    nativeWindowTestState.closeListeners[0]?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(nativeWindowTestState.destroy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog", {
      name: "有未保存的更改",
    });
    expect(within(dialog).getByText("example.py")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "有未保存的更改" })).toBeNull(),
    );
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(
      true,
    );
  });

  it("keeps hidden history dirty state visible and can still close the native app", async () => {
    const { container } = renderShell(
      <AppShell adapter={new NativeAnchorDesktopAdapter()} />,
    );
    await waitFor(() => expect(nativeWindowTestState.closeListeners).toHaveLength(1));
    fireEvent.click(screen.getAllByRole("button", { name: "打开工作区" })[0]!);
    fireEvent.click(await screen.findByRole("button", { name: /^example\.py/ }));
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitFor(() => {
      const mountedView = EditorView.findFromDOM(editor);
      if (!mountedView) throw new Error("Text editor view was not mounted");
      return mountedView;
    });
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nchanged" } });
    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /^other\.md/ }));
    await screen.findByTitle("/workspace/other.md");
    expect(container.querySelector(".tab-rail__dirty")).toBeTruthy();

    const preventDefault = vi.fn();
    nativeWindowTestState.closeListeners[0]?.({ preventDefault });
    const dialog = await screen.findByRole("alertdialog", {
      name: "有未保存的更改",
    });
    expect(within(dialog).getByText("example.py")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "放弃更改并退出" }));

    expect(preventDefault).toHaveBeenCalledOnce();
    await waitFor(() => expect(nativeWindowTestState.destroy).toHaveBeenCalledOnce());
  });

  it("destroys a clean native Tauri window after intercepting its close request", async () => {
    renderShell(<AppShell adapter={new NativeAnchorDesktopAdapter()} />);
    await waitFor(() => expect(nativeWindowTestState.closeListeners).toHaveLength(1));
    const preventDefault = vi.fn();

    nativeWindowTestState.closeListeners[0]?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    await waitFor(() => expect(nativeWindowTestState.destroy).toHaveBeenCalledOnce());
  });

  it("reports a denied native destroy and lets the user retry closing", async () => {
    nativeWindowTestState.destroy
      .mockRejectedValueOnce(new Error("window.destroy not allowed"))
      .mockResolvedValueOnce(undefined);
    const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderShell(<AppShell adapter={new NativeAnchorDesktopAdapter()} />);
    await waitFor(() => expect(nativeWindowTestState.closeListeners).toHaveLength(1));

    nativeWindowTestState.closeListeners[0]?.({ preventDefault() {} });
    await waitFor(() =>
      expect(report).toHaveBeenCalledWith(
        "Failed to destroy the native application window",
        expect.objectContaining({ message: "window.destroy not allowed" }),
      ),
    );

    nativeWindowTestState.closeListeners[0]?.({ preventDefault() {} });
    await waitFor(() => expect(nativeWindowTestState.destroy).toHaveBeenCalledTimes(2));
  });

  it("destroys a dirty native Tauri window once after the user confirms", async () => {
    const { container } = renderShell(
      <AppShell adapter={new NativeAnchorDesktopAdapter()} />,
    );
    await waitFor(() => expect(nativeWindowTestState.closeListeners).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "打开文件…" }));
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitForEditorView(editor);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nchanged" } });
    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeTruthy());

    const preventDefault = vi.fn();
    nativeWindowTestState.closeListeners[0]?.({ preventDefault });
    nativeWindowTestState.closeListeners[0]?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(2);
    fireEvent.click(await screen.findByRole("button", { name: "放弃更改并退出" }));
    await waitFor(() => expect(nativeWindowTestState.destroy).toHaveBeenCalledOnce());
  });

  it("routes native close menu actions directly through terminal window destruction", async () => {
    const adapter = new NativeAnchorDesktopAdapter();
    renderShell(<AppShell adapter={adapter} />);
    await waitFor(() => expect(adapter.hasNativeMenuListener()).toBe(true));

    adapter.emitNativeMenuAction("window.close");
    await waitFor(() => expect(nativeWindowTestState.destroy).toHaveBeenCalledOnce());
    expect(nativeWindowTestState.close).not.toHaveBeenCalled();
  });

  it("converges a native quit menu action through one close request and destroy", async () => {
    const adapter = new NativeAnchorDesktopAdapter();
    renderShell(<AppShell adapter={adapter} />);
    await waitFor(() => expect(adapter.hasNativeMenuListener()).toBe(true));
    await waitFor(() => expect(nativeWindowTestState.closeListeners).toHaveLength(1));

    adapter.emitNativeMenuAction("app.quit");
    await waitFor(() => expect(nativeWindowTestState.destroy).toHaveBeenCalledOnce());
    expect(nativeWindowTestState.close).not.toHaveBeenCalled();

    adapter.emitNativeMenuAction("app.quit");
    expect(nativeWindowTestState.destroy).toHaveBeenCalledOnce();
    expect(nativeWindowTestState.close).not.toHaveBeenCalled();
  });

  it("keeps dirty native work open when quit is cancelled and destroys after retry", async () => {
    const adapter = new NativeAnchorDesktopAdapter();
    const { container } = renderShell(<AppShell adapter={adapter} />);
    await waitFor(() => expect(adapter.hasNativeMenuListener()).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "打开文件…" }));
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitForEditorView(editor);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nchanged" } });
    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeTruthy());

    adapter.emitNativeMenuAction("app.quit");
    expect(nativeWindowTestState.destroy).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));

    adapter.emitNativeMenuAction("app.quit");
    fireEvent.click(await screen.findByRole("button", { name: "放弃更改并退出" }));
    await waitFor(() => expect(nativeWindowTestState.destroy).toHaveBeenCalledOnce());
    expect(nativeWindowTestState.close).not.toHaveBeenCalled();
  });

  it("reports when the native reveal action has no saved active file", async () => {
    const adapter = new NativeAnchorDesktopAdapter();
    renderShell(<AppShell adapter={adapter} />);
    await waitFor(() => expect(adapter.hasNativeMenuListener()).toBe(true));

    adapter.emitNativeMenuAction("file.reveal");
    expect(
      await screen.findByText("当前没有可在文件管理器中显示的已保存文件"),
    ).toBeVisible();
    adapter.emitNativeMenuAction("file.new");
    adapter.emitNativeMenuAction("file.reveal");
    expect(screen.getByText("当前没有可在文件管理器中显示的已保存文件")).toBeVisible();
  });

  it("cleans up native menu listeners that resolve after a StrictMode teardown", async () => {
    const adapter = new DelayedNativeMenuAdapter();
    const { unmount } = renderShell(
      <StrictMode>
        <AppShell adapter={adapter} />
      </StrictMode>,
    );
    await waitFor(() => expect(adapter.registrations).toHaveLength(2));

    adapter.releaseRegistration(0);
    adapter.releaseRegistration(1);
    await waitFor(() => expect(adapter.unlistenCount).toBe(1));
    unmount();
    await waitFor(() => expect(adapter.unlistenCount).toBe(2));
  });

  it("deduplicates concurrent native requests to open the same workspace", async () => {
    const adapter = new NativeAnchorDesktopAdapter();
    const { container } = renderShell(<AppShell adapter={adapter} />);
    await waitFor(() => expect(adapter.hasNativeMenuListener()).toBe(true));

    adapter.emitNativeMenuAction("workspace.open");
    adapter.emitNativeMenuAction("workspace.open");
    await screen.findByRole("button", { name: /main\.md/ });
    await waitFor(() =>
      expect(container.querySelectorAll(".workspace-root")).toHaveLength(1),
    );
  });

  it("keeps a save failure visible even while the document remains dirty", async () => {
    const { container } = renderShell(<AppShell adapter={new FailingSaveAdapter()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开文件…" }));
    const editor = await screen.findByLabelText("代码编辑器");
    const view = await waitForEditorView(editor);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nchanged" } });
    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeTruthy());

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() =>
      expect(container.querySelector(".status-bar__state--error")).toHaveTextContent(
        "保存失败：disk full",
      ),
    );
    expect(container.querySelector(".tab-rail__dirty")).toBeTruthy();
  });

  it("merges a user-opened workspace into a delayed startup restore", async () => {
    localStorage.setItem(
      WORKSPACE_HISTORY_STORAGE_KEY,
      JSON.stringify({
        openWorkspaces: [
          { path: "/stored-valid", name: "已恢复", lastOpenedAt: 2 },
          { path: "/stored-missing", name: "已失效", lastOpenedAt: 1 },
        ],
        recentWorkspaces: [],
        recentFiles: [],
        activeWorkspacePath: "/stored-valid",
      }),
    );
    const adapter = new RestoreRaceAdapter();
    renderShell(
      <StrictMode>
        <AppShell adapter={adapter} />
      </StrictMode>,
    );
    await waitFor(() =>
      expect(adapter.listCalls).toEqual(
        expect.arrayContaining(["/stored-valid", "/stored-missing"]),
      ),
    );

    fireEvent.click(screen.getAllByRole("button", { name: "打开工作区" })[0]!);
    expect(await screen.findByRole("button", { name: /user\.json/ })).toBeVisible();
    adapter.releaseValidRestore();
    await screen.findByText("已恢复 1 个工作区");
    expect(screen.getByRole("button", { name: /user\.json/ })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "切换工作区" }));
    expect(screen.getByRole("menuitem", { name: /已恢复/ })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /用户打开/ })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /已失效/ })).toBeNull();
    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem(WORKSPACE_HISTORY_STORAGE_KEY) ?? "{}",
      ) as { openWorkspaces?: { path: string }[]; activeWorkspacePath?: string | null };
      expect(stored.openWorkspaces?.map((item) => item.path)).toEqual([
        "/stored-valid",
        "/user-opened",
      ]);
      expect(stored.activeWorkspacePath).toBe("/user-opened");
    });
  });

  it.each([false, true])(
    "does not revive a closed restoring workspace, while preserving manual reopen=%s",
    async (reopenBeforeRestore) => {
      const remembered = { path: "/workspace", name: "Anchor fixtures", lastOpenedAt: 1 };
      localStorage.setItem(
        WORKSPACE_HISTORY_STORAGE_KEY,
        JSON.stringify({
          openWorkspaces: [remembered],
          recentWorkspaces: [remembered],
          recentFiles: [],
          activeWorkspacePath: remembered.path,
        }),
      );
      let release!: () => void;
      const delayed = new Promise<readonly WorkspaceNode[]>((resolve) => {
        release = () => resolve(anchorTree);
      });
      class ClosingRestoreAdapter extends AnchorDesktopAdapter {
        override readonly kind: DesktopAdapter["kind"] = "tauri";
        listCalls = 0;
        override async listWorkspace() {
          this.listCalls += 1;
          return this.listCalls === 1 ? delayed : anchorTree;
        }
      }
      const adapter = new ClosingRestoreAdapter();
      renderShell(<AppShell adapter={adapter} />);
      await waitFor(() => expect(adapter.listCalls).toBe(1));
      fireEvent.click(screen.getAllByRole("button", { name: "打开工作区" })[0]!);
      const root = await screen.findByRole("button", {
        name: "折叠工作区 · Anchor fixtures",
      });
      fireEvent.contextMenu(root);
      fireEvent.click(screen.getByRole("menuitem", { name: "关闭工作区" }));
      expect(
        screen.queryByRole("button", { name: "折叠工作区 · Anchor fixtures" }),
      ).toBeNull();
      if (reopenBeforeRestore) {
        fireEvent.click(screen.getAllByRole("button", { name: "打开工作区" })[0]!);
        await screen.findByRole("button", { name: "折叠工作区 · Anchor fixtures" });
      }
      await act(async () => {
        release();
        await delayed;
      });
      expect(
        screen.queryByRole("button", { name: "折叠工作区 · Anchor fixtures" }) !== null,
      ).toBe(reopenBeforeRestore);
      await waitFor(() => {
        const persisted = JSON.parse(
          localStorage.getItem(WORKSPACE_HISTORY_STORAGE_KEY) ?? "{}",
        );
        expect(persisted.openWorkspaces.map((item: { path: string }) => item.path)).toEqual(
          reopenBeforeRestore ? ["/workspace"] : [],
        );
        expect(
          persisted.recentWorkspaces.map((item: { path: string }) => item.path),
        ).toContain("/workspace");
      });
      if (!reopenBeforeRestore) {
        fireEvent.click(screen.getAllByRole("button", { name: "打开工作区" })[0]!);
        expect(
          await screen.findByRole("button", { name: "折叠工作区 · Anchor fixtures" }),
        ).toBeVisible();
      }
    },
    30_000,
  );

  it("does not replace a newly enabled hidden-file tree with an older Save As refresh", async () => {
    const hidden: WorkspaceNode = {
      kind: "markdown",
      name: ".hidden.md",
      path: "/workspace/.hidden.md",
      relativePath: ".hidden.md",
    };
    let release!: () => void;
    const delayed = new Promise<readonly WorkspaceNode[]>((resolve) => {
      release = () => resolve(anchorTree);
    });
    class HiddenRefreshAdapter extends AnchorDesktopAdapter {
      blockNext = false;
      pending = false;
      readonly requests: boolean[] = [];
      override async listWorkspace(rootPath = "/workspace", showHidden = false) {
        if (rootPath !== "/workspace") throw new Error("Unexpected fixture workspace");
        this.requests.push(showHidden);
        if (this.blockNext) {
          this.blockNext = false;
          this.pending = true;
          return delayed;
        }
        return showHidden ? [...anchorTree, hidden] : anchorTree;
      }
    }
    const adapter = new HiddenRefreshAdapter();
    renderShell(<AppShell adapter={adapter} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: "example.py" }));
    await screen.findByLabelText("代码编辑器");
    adapter.blockNext = true;
    fireEvent.keyDown(window, { key: "s", metaKey: true, shiftKey: true });
    await waitFor(() => expect(adapter.pending).toBe(true));
    const root = screen.getByRole("button", { name: "折叠工作区 · Anchor fixtures" });
    fireEvent.contextMenu(root);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "显示隐藏文件和文件夹" }));
    expect(await screen.findByRole("button", { name: ".hidden.md" })).toBeVisible();
    await act(async () => {
      release();
      await delayed;
    });
    expect(screen.getByRole("button", { name: ".hidden.md" })).toBeVisible();
    expect(adapter.requests).toEqual([false, false, true]);
    fireEvent.contextMenu(root);
    expect(
      screen.getByRole("menuitemcheckbox", { name: "显示隐藏文件和文件夹" }),
    ).toHaveAttribute("aria-checked", "true");
  }, 30_000);

  it("clears invalid open and active workspace records when none restore", async () => {
    localStorage.setItem(
      WORKSPACE_HISTORY_STORAGE_KEY,
      JSON.stringify({
        openWorkspaces: [{ path: "/stored-missing", name: "已失效", lastOpenedAt: 1 }],
        recentWorkspaces: [{ path: "/stored-missing", name: "已失效", lastOpenedAt: 1 }],
        recentFiles: [],
        activeWorkspacePath: "/stored-missing",
      }),
    );
    renderShell(<AppShell adapter={new RestoreRaceAdapter()} />);

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem(WORKSPACE_HISTORY_STORAGE_KEY) ?? "{}",
      ) as { openWorkspaces?: unknown[]; activeWorkspacePath?: string | null };
      expect(stored.openWorkspaces).toEqual([]);
      expect(stored.activeWorkspacePath).toBeNull();
    });
    expect(screen.getByText("尚未打开工作区")).toBeVisible();
  });

  it("opens documents in one tab and enables browser-style back navigation", async () => {
    const { container } = renderShell(<AppShell adapter={new DemoDesktopAdapter()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));

    fireEvent.click(await screen.findByRole("button", { name: /00-阅读导航\.md/ }));
    expect(await screen.findByLabelText("Markdown 可视化编辑器")).toBeVisible();
    expect(screen.getByRole("button", { name: "可视" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const visualEditor = await screen.findByLabelText("Markdown 可视化编辑器");
    expect(visualEditor).not.toHaveTextContent("<!--");
    expect(container.querySelector(".workspace-tab__dirty")).toBeNull();

    const productLinks = await screen.findAllByRole(
      "link",
      { name: "产品设计" },
      { timeout: 12_000 },
    );
    fireEvent.click(productLinks[0]!);
    await waitFor(() => expect(screen.getByRole("button", { name: "后退" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "后退" }));
    await waitFor(() =>
      expect(screen.getByTitle("demo://paper-and-ink/00-阅读导航.md")).toBeVisible(),
    );
    expect(screen.getByText("00-阅读导航.md 已恢复")).toBeVisible();
  }, 60_000);

  it("opens an inline local code preview as an editable tab in the right editor group", async () => {
    const { container } = renderShell(<AppShell adapter={new AnchorDesktopAdapter()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
    await screen.findByLabelText("Markdown 可视化编辑器");
    const reference = await screen.findByText("example.py:2", {}, { timeout: 5_000 });

    fireEvent.click(reference);
    expect(await screen.findByText("第 2 行")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "在右侧打开" }));
    const side = await screen.findByRole("region", { name: "编辑分屏 2" });
    expect(await within(side).findByLabelText("代码编辑器")).toBeVisible();
    expect(within(side).getByLabelText("代码编辑器")).toHaveAttribute(
      "aria-readonly",
      "false",
    );
    expect(screen.getByRole("region", { name: "编辑分屏 1" })).toContainElement(
      screen.getByLabelText("Markdown 可视化编辑器"),
    );
    expect(screen.queryByLabelText("本地文件预览")).toBeNull();
    expect(container.querySelectorAll(".editor-tab-panel")).toHaveLength(2);
    expect(container.querySelector(".workspace-pane--side")).toBeNull();

    await waitFor(() =>
      expect(
        container.querySelector('.tab-rail__tab[title="/workspace/example.py"]'),
      ).toHaveAttribute("aria-current", "page"),
    );
    expect(await screen.findByLabelText("代码编辑器")).toBeVisible();
    await waitFor(() =>
      expect(container.querySelector(".code-document-view .cm-gutters")).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: "可视" })).toBeNull();
  }, 30_000);

  it("leaves inline glob and template examples inert without replacing a right editor tab", async () => {
    const examples = [
      "handlers/**/urls.py",
      "handlers/*/urls.py:12",
      "src/worker?.py",
      "server/src/run_<app>.py",
      "<app>/start.py",
      "src/${app}/start.py",
      "src/{http,mq}/urls.py",
    ];
    const adapter = new AnchorDesktopAdapter();
    const opened = await adapter.openDocument("/workspace/main.md");
    if (opened.status !== "editable") throw new Error("Fixture must be editable");
    const content = [
      opened.content,
      ...examples.map((value) => `\nExample: \`${value}\`\n`),
    ].join("\n");
    const open = vi.spyOn(adapter, "openDocument").mockResolvedValueOnce({
      ...opened,
      content,
    });
    const preview = vi.spyOn(adapter, "previewLocalFile");
    const { container } = renderShell(<AppShell adapter={adapter} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
    const editor = await screen.findByLabelText("Markdown 可视化编辑器");
    const codes = await Promise.all(
      examples.map((value) => within(editor).findByText(value)),
    );
    open.mockClear();

    const checkExamples = async () => {
      const backDisabled = screen
        .getByRole("button", { name: "后退" })
        .hasAttribute("disabled");
      const schedule = vi.spyOn(window, "setTimeout");
      for (const code of codes) {
        fireEvent.pointerOver(code);
        expect(schedule.mock.calls.some(([, delay]) => delay === 320)).toBe(false);
        await act(async () => {
          fireEvent.click(code);
        });
        fireEvent.pointerOut(code);
      }
      schedule.mockRestore();
      expect(preview).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("本地文件预览")).toBeNull();
      expect(container.querySelector(".tab-rail__dirty")).toBeNull();
      expect(screen.getByRole("button", { name: "后退" }).hasAttribute("disabled")).toBe(
        backDisabled,
      );
    };

    await checkExamples();
    fireEvent.click(within(editor).getByText("example.py:2"));
    expect(await screen.findByText("第 2 行")).toBeVisible();
    expect(preview).toHaveBeenCalledExactlyOnceWith("example.py:2", "/workspace/main.md");
    fireEvent.click(screen.getByRole("button", { name: "在右侧打开" }));
    const side = await screen.findByRole("region", { name: "编辑分屏 2" });
    await within(side).findByLabelText("代码编辑器");
    open.mockClear();
    preview.mockClear();
    await checkExamples();
    expect(screen.getByRole("region", { name: "编辑分屏 2" })).toBe(side);
    expect(within(side).getByText("/workspace/example.py")).toBeVisible();
    expect(within(side).getByText("第 2 行")).toBeVisible();
    expect(screen.queryByText(/referenced file does not exist/)).toBeNull();
  }, 30_000);

  it("still reports read failures for a concrete inline file reference", async () => {
    const adapter = new AnchorDesktopAdapter();
    const preview = vi
      .spyOn(adapter, "previewLocalFile")
      .mockRejectedValue(new Error("referenced file does not exist: example.py"));
    const { container } = renderShell(<AppShell adapter={adapter} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
    const editor = await screen.findByLabelText("Markdown 可视化编辑器");
    fireEvent.click(await within(editor).findByText("example.py:2"));
    expect(
      await screen.findByText("referenced file does not exist: example.py"),
    ).toBeVisible();
    expect(preview).toHaveBeenCalledExactlyOnceWith("example.py:2", "/workspace/main.md");
    expect(container.querySelector(".tab-rail__dirty")).toBeNull();
  });

  it("replaces the right temporary editor tab and navigates to a code target line", async () => {
    const { container } = renderShell(<AppShell adapter={new AnchorDesktopAdapter()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
    await screen.findByLabelText("Markdown 可视化编辑器");

    fireEvent.click(await screen.findByText("example.py:2", {}, { timeout: 5_000 }));
    fireEvent.click(await screen.findByRole("button", { name: "在右侧打开" }));
    const side = await screen.findByRole("region", { name: "编辑分屏 2" });
    expect(within(side).getByText("/workspace/example.py")).toBeVisible();
    const groupId = side.dataset.editorGroupId;

    fireEvent.click(await screen.findByRole("link", { name: "Worker source" }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "编辑分屏 2" })).getByText(
          "/workspace/worker.rs",
        ),
      ).toBeVisible(),
    );
    const right = screen.getByRole("region", { name: "编辑分屏 2" });
    expect(right.dataset.editorGroupId).toBe(groupId);
    expect(within(right).getByText("第 1 行")).toBeVisible();
    const rightTabs = screen.getByRole("navigation", { name: "分屏 2 的标签页" });
    expect(rightTabs.querySelectorAll(".tab-rail__tab")).toHaveLength(1);
    expect(
      rightTabs.querySelector('.tab-rail__tab[title="/workspace/example.py"]'),
    ).toBeNull();
    expect(screen.queryByLabelText("本地文件预览")).toBeNull();

    fireEvent.click(await screen.findByText("worker.rs:3"));

    await waitFor(() => expect(within(right).getByText("第 3 行")).toBeVisible());
    expect(right.querySelector(".code-file-preview__target-line")).toHaveTextContent(
      "fn worker_name",
    );
    expect(container.querySelectorAll(".editor-tab-panel")).toHaveLength(2);
    expect(screen.queryByLabelText("本地文件预览")).toBeNull();
  }, 30_000);

  it.each(["fixed", "dirty"] as const)(
    "preserves a %s right code tab when another code link opens in the same group",
    async (mode) => {
      renderShell(<AppShell adapter={new AnchorDesktopAdapter()} />);
      fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
      fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
      fireEvent.click(await screen.findByText("example.py:2"));
      fireEvent.click(await screen.findByRole("button", { name: "在右侧打开" }));
      const right = await screen.findByRole("region", { name: "编辑分屏 2" });
      const rail = screen.getByRole("navigation", { name: "分屏 2 的标签页" });
      const originalTab = within(rail).getByTitle("/workspace/example.py");
      if (mode === "fixed") fireEvent.doubleClick(originalTab);
      else {
        const view = await waitForEditorView(
          await within(right).findByLabelText("代码编辑器"),
        );
        act(() => view.dispatch({ changes: { from: 0, insert: "# unsaved fixture\n" } }));
      }
      expect(originalTab.closest(".tab-rail__item")).not.toHaveClass(
        "tab-rail__item--preview",
      );

      fireEvent.click(screen.getByRole("link", { name: "Worker source" }));
      await waitFor(() =>
        expect(within(rail).getByTitle("/workspace/worker.rs")).toHaveAttribute(
          "aria-current",
          "page",
        ),
      );
      expect(rail.querySelectorAll(".tab-rail__tab")).toHaveLength(2);
      expect(within(rail).getByTitle("/workspace/example.py")).toBeVisible();
      expect(screen.getAllByRole("region", { name: /^编辑分屏/ })).toHaveLength(2);
      expect(screen.queryByLabelText("本地文件预览")).toBeNull();

      fireEvent.click(within(rail).getByTitle("/workspace/example.py"));
      const restored = await waitForEditorView(await screen.findByLabelText("代码编辑器"));
      expect(restored.state.doc.toString()).toContain("from pathlib import Path");
      if (mode === "dirty") {
        expect(restored.state.doc.toString().startsWith("# unsaved fixture\n")).toBe(true);
        expect(rail.querySelector(".tab-rail__dirty")).toBeInTheDocument();
      }
    },
    30_000,
  );

  it("keeps the latest code-link request when an older right-group file read finishes late", async () => {
    const adapter = new AnchorDesktopAdapter();
    renderShell(<AppShell adapter={adapter} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
    fireEvent.click(await screen.findByText("example.py:2"));
    fireEvent.click(await screen.findByRole("button", { name: "在右侧打开" }));
    await screen.findByRole("region", { name: "编辑分屏 2" });

    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = adapter.openDocument.bind(adapter);
    const open = vi.spyOn(adapter, "openDocument").mockImplementation(async (path) => {
      const result = await read(path);
      if (path === "/workspace/worker.rs") await blocked;
      return result;
    });
    fireEvent.click(screen.getByRole("link", { name: "Worker source" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("/workspace/worker.rs"));
    fireEvent.click(screen.getByText("example.py:2"));
    await waitFor(() => expect(open).toHaveBeenCalledWith("/workspace/example.py"));
    await act(async () => {
      release();
      await blocked;
    });

    const rail = screen.getByRole("navigation", { name: "分屏 2 的标签页" });
    expect(rail.querySelectorAll(".tab-rail__tab")).toHaveLength(1);
    expect(within(rail).getByTitle("/workspace/example.py")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(rail).queryByTitle("/workspace/worker.rs")).toBeNull();
    const right = screen.getByRole("region", { name: "编辑分屏 2" });
    expect(within(right).getByText("第 2 行")).toBeVisible();
    expect(within(right).getByLabelText("代码编辑器")).toHaveTextContent(
      "from pathlib import Path",
    );
    expect(screen.queryByLabelText("本地文件预览")).toBeNull();
  }, 30_000);

  it.each(["success", "failure"] as const)(
    "ignores late right-code %s after the destination group is closed",
    async (outcome) => {
      const adapter = new AnchorDesktopAdapter();
      const { container } = renderShell(<AppShell adapter={adapter} />);
      fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
      fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
      fireEvent.click(await screen.findByText("example.py:2"));
      fireEvent.click(await screen.findByRole("button", { name: "在右侧打开" }));
      await screen.findByRole("region", { name: "编辑分屏 2" });

      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const read = adapter.openDocument.bind(adapter);
      const open = vi.spyOn(adapter, "openDocument").mockImplementation(async (path) => {
        const result = await read(path);
        if (path === "/workspace/worker.rs") {
          await blocked;
          if (outcome === "failure") throw new Error("stale right-code failure");
        }
        return result;
      });
      fireEvent.click(screen.getByRole("link", { name: "Worker source" }));
      await waitFor(() => expect(open).toHaveBeenCalledWith("/workspace/worker.rs"));
      fireEvent.click(screen.getByRole("button", { name: "关闭 example.py" }));
      await waitFor(() =>
        expect(screen.queryByRole("region", { name: "编辑分屏 2" })).toBeNull(),
      );
      await act(async () => {
        release();
        await blocked;
      });

      expect(container.querySelectorAll(".editor-tab-panel")).toHaveLength(1);
      expect(screen.queryByRole("region", { name: "编辑分屏 2" })).toBeNull();
      expect(
        container.querySelector('.tab-rail__tab[title="/workspace/worker.rs"]'),
      ).toBeNull();
      expect(
        container.querySelector('.tab-rail__tab[title="/workspace/main.md"]'),
      ).toHaveAttribute("aria-current", "page");
      expect(screen.getByLabelText("Markdown 可视化编辑器")).toBeVisible();
      expect(screen.queryByLabelText("本地文件预览")).toBeNull();
      expect(screen.queryByText(/stale right-code failure/u)).toBeNull();
    },
    30_000,
  );

  it("ignores a late popover open-on-right failure after its source tab closes", async () => {
    const adapter = new AnchorDesktopAdapter();
    renderShell(<AppShell adapter={adapter} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
    fireEvent.click(await screen.findByText("example.py:2"));
    await screen.findByRole("button", { name: "在右侧打开" });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const open = vi.spyOn(adapter, "openDocument").mockImplementation(async () => {
      await blocked;
      throw new Error("stale popover-open failure");
    });
    fireEvent.click(screen.getByRole("button", { name: "在右侧打开" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("/workspace/example.py"));
    fireEvent.click(screen.getByRole("button", { name: "关闭 main.md" }));
    await act(async () => {
      release();
      await blocked;
    });
    expect(screen.queryByText(/stale popover-open failure/u)).toBeNull();
    expect(screen.queryByLabelText("本地文件预览")).toBeNull();
    expect(screen.queryByRole("region", { name: "编辑分屏 2" })).toBeNull();
  }, 30_000);

  it.each(["escape", "pointer leave", "tab close"] as const)(
    "does not revive a dismissed local preview after %s during its read",
    async (dismissal) => {
      const adapter = new AnchorDesktopAdapter();
      const result = await adapter.previewLocalFile("example.py:2");
      let release!: () => void;
      const blocked = new Promise<typeof result>((resolve) => {
        release = () => resolve(result);
      });
      const preview = vi.spyOn(adapter, "previewLocalFile").mockReturnValue(blocked);
      renderShell(<AppShell adapter={adapter} />);
      fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
      fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
      const reference = await screen.findByText("example.py:2");
      fireEvent.click(reference);
      expect(await screen.findByText("正在读取本地文件…")).toBeVisible();
      if (dismissal === "escape") fireEvent.keyDown(window, { key: "Escape" });
      else if (dismissal === "pointer leave") fireEvent.pointerOut(reference);
      else fireEvent.click(screen.getByRole("button", { name: "关闭 main.md" }));
      await waitFor(() => expect(screen.queryByLabelText("本地文件预览")).toBeNull());
      await act(async () => {
        release();
        await blocked;
      });
      expect(preview).toHaveBeenCalledExactlyOnceWith("example.py:2", "/workspace/main.md");
      expect(screen.queryByLabelText("本地文件预览")).toBeNull();
      expect(screen.queryByLabelText("代码预览")).toBeNull();
    },
    30_000,
  );

  it("cancels a scheduled hover read when Escape dismisses the pending preview", async () => {
    const adapter = new AnchorDesktopAdapter();
    const preview = vi.spyOn(adapter, "previewLocalFile");
    renderShell(<AppShell adapter={adapter} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
    const reference = await screen.findByText("example.py:2");
    fireEvent.pointerOver(reference);
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    });
    expect(preview).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("本地文件预览")).toBeNull();
  }, 30_000);

  it("resizes a code tab using the shared editor-group divider with pointer and keyboard input", async () => {
    const { container } = renderShell(<AppShell adapter={new AnchorDesktopAdapter()} />);
    fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
    fireEvent.click(await screen.findByRole("button", { name: /^main\.md/ }));
    await screen.findByLabelText("Markdown 可视化编辑器");
    fireEvent.click(await screen.findByText("example.py:2", {}, { timeout: 5_000 }));
    fireEvent.click(await screen.findByRole("button", { name: "在右侧打开" }));

    const divider = await screen.findByRole("separator", {
      name: "调整分屏 1 与右侧分屏的宽度",
    });
    const panes = container.querySelector<HTMLElement>(".editor-groups");
    if (!panes) throw new Error("Editor groups were not mounted");
    for (const header of container.querySelectorAll<HTMLElement>(".editor-group-header"))
      vi.spyOn(header, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 500, 40));

    const initialDividerPercent = Number(divider.getAttribute("aria-valuenow"));
    fireEvent.keyDown(divider, { key: "ArrowLeft" });
    expect(Number(divider.getAttribute("aria-valuenow"))).toBeLessThan(
      initialDividerPercent,
    );

    fireEvent(
      divider,
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 600 }),
    );
    fireEvent(divider, new MouseEvent("pointermove", { bubbles: true, clientX: 700 }));
    fireEvent(divider, new MouseEvent("pointerup", { bubbles: true, clientX: 700 }));

    expect(Number(divider.getAttribute("aria-valuenow"))).toBe(60);
    expect(panes.style.gridTemplateColumns).toBe(
      "minmax(280px, 1.2fr) 6px minmax(280px, 0.8fr)",
    );
    expect(container.querySelector(".workspace-pane-resizer")).toBeNull();
  }, 30_000);

  it("queues a background anchor once and carries its semantic position across modes", async () => {
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      let top = 0;
      if (this.classList.contains("visual-markdown-editor")) top = 100;
      if (this.tagName === "H2") {
        const headings = Array.from(this.ownerDocument.querySelectorAll("h2"));
        top = headings.indexOf(this as HTMLHeadingElement) === 0 ? 300 : 700;
      }
      return {
        bottom: top + 40,
        height: 40,
        left: 0,
        right: 800,
        top,
        width: 800,
        x: 0,
        y: top,
        toJSON: () => undefined,
      };
    };

    try {
      const { container } = renderShell(<AppShell adapter={new AnchorDesktopAdapter()} />);
      fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
      fireEvent.click(await screen.findByRole("button", { name: /main\.md/ }));
      await screen.findByLabelText("Markdown 可视化编辑器");

      fireEvent.click(await screen.findByRole("link", { name: "Jump here" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "后退" })).toBeEnabled(),
      );
      const mainVisual = container.querySelector<HTMLElement>(
        '.visual-markdown-editor[data-document-id="/workspace/main.md"]',
      );
      if (!mainVisual) throw new Error("Main visual editor was not mounted");
      await waitFor(() => expect(mainVisual.scrollTop).toBe(164));
      fireEvent.click(screen.getByRole("button", { name: "后退" }));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "后退" })).toBeDisabled(),
      );
      await waitFor(() => expect(mainVisual.scrollTop).toBe(0));

      fireEvent.click(await screen.findByRole("link", { name: "Open duplicate" }), {
        metaKey: true,
      });
      const backgroundTab = await screen.findByTitle("/workspace/other.md");
      expect(screen.getByTitle("/workspace/main.md")).toHaveAttribute(
        "aria-current",
        "page",
      );

      fireEvent.click(backgroundTab);
      const visual = await waitFor(() => {
        const current = container.querySelector<HTMLElement>(
          '.visual-markdown-editor[data-document-id="/workspace/other.md"]',
        );
        expect(current).toBeTruthy();
        return current!;
      });
      await waitFor(() => expect(visual.scrollTop).toBe(564));

      visual.scrollTop = 777;
      fireEvent.scroll(visual);
      await new Promise((resolve) => window.setTimeout(resolve, 30));

      fireEvent.click(screen.getByRole("button", { name: "源码" }));
      const source = await screen.findByLabelText("Markdown 编辑器");
      const sourceScroller = source.querySelector<HTMLElement>(".cm-scroller");
      if (!sourceScroller) throw new Error("Source scroller was not mounted");
      const sourceView = await waitForEditorView(source);
      await waitFor(() => expect(sourceView.state.selection.main.from).toBeGreaterThan(0));

      fireEvent.click(screen.getByRole("button", { name: "可视" }));
      await waitFor(() => {
        const current = container.querySelector<HTMLElement>(
          '.visual-markdown-editor[data-document-id="/workspace/other.md"]',
        );
        expect(current).toBeTruthy();
        return current!;
      });
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalBounds;
    }
  }, 30_000);
});
