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

import type { CodeFilePreviewProps } from "../../features/code-preview/CodeFilePreview";
import type { MarkdownEditorProps } from "../../features/editor/MarkdownEditor";
import { SESSION_SNAPSHOT_STORAGE_KEY } from "../../features/session-restore/sessionSnapshot";
import { WORKSPACE_HISTORY_STORAGE_KEY } from "../../features/workspace/workspaceHistory";
import type {
  DesktopAdapter,
  DocumentInspection,
  FileSystemChanges,
  OpenDocumentResult,
  SaveDocumentResult,
  WorkspaceNode,
} from "../../infrastructure/tauri/desktopAdapter";
import { AppSettingsProvider } from "../settings";
import { AppShell } from "./AppShell";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    destroy: async () => undefined,
    onCloseRequested: async () => () => undefined,
  }),
}));
vi.mock("../../features/editor/MarkdownEditor", () => ({
  MarkdownEditor: (props: MarkdownEditorProps) => (
    <textarea
      aria-label="Statistics Markdown editor"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));
vi.mock("../../features/code-preview/CodeFilePreview", () => ({
  CodeFilePreview: (props: CodeFilePreviewProps) => (
    <textarea
      aria-label="Statistics text editor"
      value={props.content}
      readOnly={!props.editable}
      onChange={(event) => props.onChange?.(event.target.value)}
    />
  ),
}));

const ROOT = "/statistics-fixtures";
const NOTE = `${ROOT}/note.md`;
const SECOND = `${ROOT}/second.md`;
const TEXT = `${ROOT}/sample.txt`;

class StatisticsAdapter implements DesktopAdapter {
  readonly files = new Map([
    [NOTE, { text: "# 中文\n", revision: "one" }],
    [SECOND, { text: "# 第二页标题\n", revision: "one" }],
    [TEXT, { text: "Hello world\n中文", revision: "one" }],
  ]);
  listener?: (event: FileSystemChanges) => void;

  constructor(readonly kind: "demo" | "tauri" = "demo") {}

  async pickWorkspace() {
    return { path: ROOT, name: "Statistics fixtures" };
  }
  async pickDocument() {
    return { path: NOTE, name: "note.md" };
  }
  listWorkspace = vi.fn(async (): Promise<WorkspaceNode[]> =>
    [...this.files.keys()].map((path) => ({
      path,
      relativePath: path.slice(ROOT.length + 1),
      name: path.split("/").at(-1)!,
      kind: path.endsWith(".md") ? "markdown" : "text",
    })),
  );
  openDocument = vi.fn(async (path: string): Promise<OpenDocumentResult> => {
    const file = this.files.get(path);
    if (!file) throw new Error("Missing synthetic statistics fixture");
    return {
      status: "editable",
      path,
      content: file.text,
      diskRevision: file.revision,
      mode: "normal",
      documentKind: path.endsWith(".md") ? "markdown" : "text",
      language: path.endsWith(".md") ? "markdown" : "text",
      preflight: {
        sizeBytes: file.text.length,
        longestLineBytes: file.text.length,
        containsDataImageBase64: false,
      },
    };
  });
  inspectDocuments = vi.fn(
    async (paths: readonly string[]): Promise<DocumentInspection[]> =>
      paths.map((path) => {
        const file = this.files.get(path);
        return file
          ? { path, status: "present", revision: file.revision }
          : { path, status: "missing" };
      }),
  );
  async listenFileSystemChanges(listener: (event: FileSystemChanges) => void) {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }
  async watchFileSystem() {}
  changed(path: string) {
    this.listener?.({ paths: [path] });
  }
  saveDocument = vi.fn(async (path: string, content: string) => ({
    path,
    bytesWritten: content.length,
    diskRevision: "saved",
  }));
  async saveDocumentAs(): Promise<SaveDocumentResult | null> {
    return null;
  }
  async revealInFileManager() {}
  async moveWorkspaceEntryToTrash() {}
  async createWorkspaceTextFile(): Promise<never> {
    throw new Error("Unused synthetic operation");
  }
  async previewLocalFile(): Promise<never> {
    throw new Error("Unused synthetic operation");
  }
  async saveClipboardImage(): Promise<never> {
    throw new Error("Unused synthetic operation");
  }
}

function clearBrowsingMetadata() {
  localStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
  localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_KEY);
}

beforeEach(clearBrowsingMetadata);
afterEach(() => {
  cleanup();
  clearBrowsingMetadata();
  vi.restoreAllMocks();
});

async function setup(
  adapter = new StatisticsAdapter(),
  locale: "zh-CN" | "en-US" = "zh-CN",
) {
  render(
    <AppSettingsProvider
      storage={null}
      initialSettings={{ locale, startupBehavior: "empty" }}
    >
      <AppShell adapter={adapter} />
    </AppSettingsProvider>,
  );
  const workspaceAction =
    adapter.kind === "demo"
      ? locale === "zh-CN"
        ? "打开演示工作区"
        : "Open Demo Workspace"
      : locale === "zh-CN"
        ? "打开工作区"
        : "Open Workspace";
  fireEvent.click(
    within(screen.getByRole("main")).getByRole("button", { name: workspaceAction }),
  );
  const sidebar = screen.getByRole("complementary", {
    name: locale === "zh-CN" ? "工作区侧栏" : "Workspace Sidebar",
  });
  await within(sidebar).findByRole("button", { name: "note.md" });
  return { adapter, sidebar };
}

function statisticsButton(locale: "zh-CN" | "en-US" = "zh-CN") {
  return screen.getByRole("button", {
    name: locale === "zh-CN" ? "查看当前文档统计" : "View current document statistics",
  });
}

async function expectWords(count: number, locale: "zh-CN" | "en-US" = "zh-CN") {
  await waitFor(() =>
    expect(statisticsButton(locale)).toHaveTextContent(
      locale === "zh-CN" ? `字数：${count}` : `Words: ${count}`,
    ),
  );
}

async function openTree(sidebar: HTMLElement, name: string, pinned = false) {
  const row = within(sidebar).getByRole("button", { name });
  if (pinned) fireEvent.doubleClick(row);
  else fireEvent.click(row);
  await screen.findByRole("button", { name: `关闭 ${name}` });
  await screen.findByRole("textbox", {
    name: name.endsWith(".md") ? "Statistics Markdown editor" : "Statistics text editor",
  });
}

function detail(panel: HTMLElement, label: string) {
  return within(panel).getByText(label, { selector: "dt" }).nextElementSibling;
}

describe("AppShell current document statistics", () => {
  it("updates Chinese counts after continuous additions and deletions without reading disk", async () => {
    const { adapter, sidebar } = await setup();
    await openTree(sidebar, "note.md");
    await expectWords(2);
    expect(screen.queryByLabelText("未保存")).toBeNull();

    const editor = screen.getByRole("textbox", { name: "Statistics Markdown editor" });
    fireEvent.change(editor, { target: { value: "# 中文输\n" } });
    fireEvent.change(editor, { target: { value: "# 中文输入\n" } });
    await expectWords(4);
    fireEvent.change(editor, { target: { value: "# 中文输\n" } });
    await expectWords(3);

    fireEvent.click(statisticsButton());
    const panel = screen.getByRole("region", { name: "当前文档统计" });
    expect(detail(panel, "字数")).toHaveTextContent("3");
    expect(detail(panel, "字符数（含空白）")).toHaveTextContent("6");
    expect(detail(panel, "字符数（不含空白）")).toHaveTextContent("4");
    expect(detail(panel, "行数")).toHaveTextContent("2");
    expect(editor).toHaveValue("# 中文输\n");
    expect(screen.getByLabelText("未保存")).toBeInTheDocument();
    expect(adapter.openDocument).toHaveBeenCalledTimes(1);
    expect(adapter.saveDocument).not.toHaveBeenCalled();
    expect(adapter.files.get(NOTE)?.text).toBe("# 中文\n");
  });

  it("keeps statistics and mode switches view-only and hides statistics after the last tab closes", async () => {
    const { adapter, sidebar } = await setup();
    expect(screen.queryByRole("button", { name: "查看当前文档统计" })).toBeNull();
    await openTree(sidebar, "note.md");
    await expectWords(2);
    fireEvent.click(statisticsButton());
    expect(statisticsButton()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "当前文档统计" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "当前文档统计" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "源码" }));
    await expectWords(2);
    fireEvent.click(screen.getByRole("button", { name: "可视" }));
    await expectWords(2);
    expect(screen.queryByLabelText("未保存")).toBeNull();
    expect(adapter.openDocument).toHaveBeenCalledTimes(1);
    expect(adapter.saveDocument).not.toHaveBeenCalled();
    fireEvent.click(statisticsButton());
    fireEvent.click(screen.getByRole("button", { name: "关闭 note.md" }));
    expect(screen.queryByRole("button", { name: "查看当前文档统计" })).toBeNull();
    expect(screen.queryByRole("region", { name: "当前文档统计" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("follows active tabs and ignores a previous tab's pending calculation", async () => {
    const { adapter, sidebar } = await setup();
    await openTree(sidebar, "note.md", true);
    await expectWords(2);
    await openTree(sidebar, "second.md", true);
    await expectWords(5);
    const rail = screen.getByRole("navigation", { name: "文档标签页" });
    fireEvent.click(within(rail).getByTitle(NOTE));
    await expectWords(2);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "# 中文输入测试\n" },
    });
    fireEvent.click(within(rail).getByTitle(SECOND));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 160));
    });
    await expectWords(5);
    fireEvent.click(within(rail).getByTitle(NOTE));
    await expectWords(6);
    expect(screen.getByRole("textbox")).toHaveValue("# 中文输入测试\n");
    expect(adapter.openDocument).toHaveBeenCalledTimes(2);
    expect(adapter.saveDocument).not.toHaveBeenCalled();
  });

  it("uses the focused split's Markdown or plain-text session", async () => {
    const { adapter, sidebar } = await setup();
    await openTree(sidebar, "note.md", true);
    await openTree(sidebar, "sample.txt", true);
    await expectWords(4);
    const rail = screen.getByRole("navigation", { name: "文档标签页" });
    fireEvent.contextMenu(within(rail).getByTitle(TEXT), { clientX: 350, clientY: 80 });
    fireEvent.click(screen.getByRole("menuitem", { name: "向右分屏" }));
    const left = screen.getByRole("region", { name: "编辑分屏 1" });
    const right = screen.getByRole("region", { name: "编辑分屏 2" });
    const leftEditor = within(left).getByRole("textbox");
    const rightEditor = within(right).getByRole("textbox");
    fireEvent.focus(leftEditor);
    await expectWords(2);
    fireEvent.focus(rightEditor);
    await expectWords(4);
    fireEvent.change(rightEditor, { target: { value: "Hello 中文输入" } });
    await expectWords(5);
    fireEvent.focus(leftEditor);
    await expectWords(2);
    expect(leftEditor).toHaveValue("# 中文\n");
    expect(rightEditor).toHaveValue("Hello 中文输入");
    expect(adapter.openDocument).toHaveBeenCalledTimes(2);
    expect(adapter.saveDocument).not.toHaveBeenCalled();
    expect(within(left).queryByLabelText("未保存")).toBeNull();
  });

  it("refreshes an expanded count from a clean external reload without making it dirty", async () => {
    const { adapter, sidebar } = await setup();
    await openTree(sidebar, "note.md");
    await expectWords(2);
    fireEvent.click(statisticsButton());
    await waitFor(() => expect(adapter.listener).toBeDefined());
    adapter.files.set(NOTE, { text: "# 外部新内容\n", revision: "two" });
    act(() => adapter.changed(NOTE));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("# 外部新内容\n"));
    await expectWords(5);
    expect(
      detail(screen.getByRole("region", { name: "当前文档统计" }), "字数"),
    ).toHaveTextContent("5");
    expect(screen.queryByLabelText("未保存")).toBeNull();
    expect(screen.queryByLabelText("外部文件变化")).toBeNull();
    expect(adapter.openDocument).toHaveBeenCalledTimes(2);
    expect(adapter.saveDocument).not.toHaveBeenCalled();
  });

  it("localizes statistics and describes native files without an offline indicator", async () => {
    const { adapter, sidebar } = await setup(new StatisticsAdapter("tauri"), "en-US");
    expect(within(sidebar).getByText("Local files")).toHaveAttribute(
      "title",
      "Files are read and written locally; this is not a network or save-status indicator",
    );
    expect(within(sidebar).queryByText("Offline")).toBeNull();
    fireEvent.click(within(sidebar).getByRole("button", { name: "sample.txt" }));
    await screen.findByRole("textbox", { name: "Statistics text editor" });
    await expectWords(4, "en-US");
    fireEvent.click(statisticsButton("en-US"));
    const panel = screen.getByRole("region", { name: "Current document statistics" });
    expect(detail(panel, "Words")).toHaveTextContent("4");
    expect(detail(panel, "Characters (with whitespace)")).toHaveTextContent("14");
    expect(detail(panel, "Characters (without whitespace)")).toHaveTextContent("12");
    expect(detail(panel, "Lines")).toHaveTextContent("2");
    expect(screen.queryByLabelText("未保存")).toBeNull();
    expect(screen.queryByLabelText("Unsaved")).toBeNull();
    expect(adapter.openDocument).toHaveBeenCalledTimes(1);
    expect(adapter.saveDocument).not.toHaveBeenCalled();
  });
});
