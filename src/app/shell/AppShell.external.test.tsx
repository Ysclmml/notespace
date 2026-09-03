import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownEditorProps } from "../../features/editor/MarkdownEditor";
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
      aria-label="Test document"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

const ROOT = "/external-fixtures";
const PATH = `${ROOT}/note.md`;
class ExternalAdapter implements DesktopAdapter {
  readonly kind = "demo" as const;
  files = new Map([[PATH, { text: "# Original", revision: "one" }]]);
  listener?: (event: FileSystemChanges) => void;
  async pickWorkspace() {
    return { path: ROOT, name: "External fixtures" };
  }
  async pickDocument() {
    return { path: PATH, name: "note.md" };
  }
  listWorkspace = vi.fn(async (): Promise<WorkspaceNode[]> =>
    [...this.files.keys()].map((path) => ({
      path,
      relativePath: path.slice(ROOT.length + 1),
      name: path.split("/").at(-1)!,
      kind: "markdown",
    })),
  );
  openDocument = vi.fn(async (path: string): Promise<OpenDocumentResult> => {
    const file = this.files.get(path);
    if (!file) throw new Error("File missing");
    return {
      status: "editable",
      path,
      content: file.text,
      diskRevision: file.revision,
      mode: "normal",
      documentKind: "markdown",
      language: "markdown",
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
  changed() {
    this.listener?.({ paths: [PATH, ROOT] });
  }
  saveDocument = vi.fn(async (path: string, content: string, expectedRevision?: string) => {
    if (this.files.get(path)?.revision !== expectedRevision)
      throw { code: "externalChange" };
    this.files.set(path, { text: content, revision: "own-save" });
    this.changed();
    return { path, bytesWritten: content.length, diskRevision: "own-save" };
  });
  async saveDocumentAs(): Promise<SaveDocumentResult | null> {
    return null;
  }
  async revealInFileManager() {}
  async moveWorkspaceEntryToTrash() {}
  async createWorkspaceTextFile(): Promise<never> {
    throw new Error("Unused");
  }
  async previewLocalFile(): Promise<never> {
    throw new Error("Unused");
  }
  async saveClipboardImage(): Promise<never> {
    throw new Error("Unused");
  }
}

async function setup(autoSave = false) {
  const adapter = new ExternalAdapter();
  render(
    <AppSettingsProvider
      storage={null}
      initialSettings={{
        autoSaveMode: autoSave ? "afterDelay" : "manual",
        autoSaveDelaySeconds: 1,
      }}
    >
      <AppShell adapter={adapter} />
    </AppSettingsProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
  fireEvent.click(await screen.findByRole("button", { name: "note.md" }));
  await screen.findByRole("textbox", { name: "Test document" });
  await waitFor(() => expect(adapter.listener).toBeDefined());
  return adapter;
}
afterEach(cleanup);
describe("AppShell external files", () => {
  it("allows Save As to a previously closed clean cached path", async () => {
    const adapter = await setup();
    fireEvent.click(screen.getByRole("button", { name: "关闭 note.md" }));
    fireEvent.keyDown(window, { key: "n", metaKey: true });
    const input = await screen.findByRole("textbox");
    fireEvent.change(input, { target: { value: "# New document" } });
    vi.spyOn(adapter, "saveDocumentAs").mockImplementation(async () => {
      adapter.files.set(PATH, { text: "# New document", revision: "saved-as" });
      return { path: PATH, bytesWritten: 14, diskRevision: "saved-as" };
    });
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await screen.findByRole("button", { name: "关闭 note.md" });
    expect(screen.getByRole("textbox")).toHaveValue("# New document");
    expect(screen.queryByLabelText("未保存")).toBeNull();
  });
  it("does not mark a reopened session dirty when an earlier save finishes after close", async () => {
    const adapter = await setup(true);
    let finishSave!: () => void;
    adapter.saveDocument.mockImplementationOnce(async (path, content) => {
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      adapter.files.set(path, { text: content, revision: "late-save" });
      return { path, bytesWritten: content.length, diskRevision: "late-save" };
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# Saved draft" } });
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(finishSave).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "关闭 note.md" }));
    fireEvent.click(await screen.findByRole("button", { name: "放弃更改并关闭标签页" }));
    fireEvent.click(screen.getByRole("button", { name: "note.md" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("# Original"));
    await act(async () => {
      finishSave();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    expect(adapter.saveDocument).toHaveBeenCalledTimes(1);
    expect(adapter.files.get(PATH)?.text).toBe("# Saved draft");
    expect(screen.queryByLabelText("未保存")).toBeNull();
    act(() => adapter.changed());
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("# Saved draft"));
  });
  it("refreshes new/removed tree items and reloads an unedited open file", async () => {
    const adapter = await setup();
    adapter.files.set(PATH, { text: "# From another editor", revision: "two" });
    adapter.files.set(`${ROOT}/added.md`, { text: "# Added", revision: "new" });
    act(() => adapter.changed());
    await waitFor(() =>
      expect(screen.getByRole("textbox")).toHaveValue("# From another editor"),
    );
    expect(screen.getByRole("button", { name: "added.md" })).toBeInTheDocument();
    adapter.files.delete(`${ROOT}/added.md`);
    act(() => adapter.changed());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "added.md" })).toBeNull(),
    );
    expect(screen.queryByLabelText("外部文件变化")).toBeNull();
  });
  it("keeps unsaved content, pauses autosave, and confirms before reading disk", async () => {
    const adapter = await setup(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# My draft" } });
    adapter.files.set(PATH, { text: "# Other draft", revision: "two" });
    act(() => adapter.changed());
    const banner = await screen.findByLabelText("外部文件变化");
    expect(screen.getByRole("textbox")).toHaveValue("# My draft");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(adapter.saveDocument).not.toHaveBeenCalled();
    fireEvent.click(within(banner).getByRole("button", { name: "读取磁盘版本" }));
    expect(within(banner).getByText(/会放弃此文件尚未保存/)).toBeInTheDocument();
    fireEvent.click(within(banner).getByRole("button", { name: "取消" }));
    expect(screen.getByRole("textbox")).toHaveValue("# My draft");
    fireEvent.click(within(banner).getByRole("button", { name: "读取磁盘版本" }));
    fireEvent.click(within(banner).getByRole("button", { name: "确定" }));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("# Other draft"));
    expect(screen.queryByLabelText("外部文件变化")).toBeNull();
  });
  it("protects a manual save even before the watch event arrives and explicitly overwrites only the observed revision", async () => {
    const adapter = await setup();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "# My draft" } });
    adapter.files.set(PATH, { text: "# External", revision: "two" });
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    const banner = await screen.findByLabelText("外部文件变化");
    expect(adapter.files.get(PATH)?.text).toBe("# External");
    const overwrite = await within(banner).findByRole("button", {
      name: "用当前内容覆盖磁盘",
    });
    fireEvent.click(overwrite);
    fireEvent.click(within(banner).getByRole("button", { name: "确定" }));
    await waitFor(() => expect(adapter.files.get(PATH)?.text).toBe("# My draft"));
    expect(adapter.saveDocument).toHaveBeenLastCalledWith(PATH, "# My draft", "two");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    expect(screen.queryByLabelText("外部文件变化")).toBeNull();
  });
  it("retains externally removed contents and never recreates on ordinary save", async () => {
    const adapter = await setup();
    adapter.files.delete(PATH);
    act(() => adapter.changed());
    const banner = await screen.findByLabelText("外部文件变化");
    expect(within(banner).getByText(/文件已在外部删除或移动/)).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("# Original");
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(adapter.saveDocument).not.toHaveBeenCalled();
    expect(within(banner).getByRole("button", { name: "另存为…" })).toBeEnabled();
    expect(adapter.files.has(PATH)).toBe(false);
  });
});
