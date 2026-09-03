import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MarkdownEditorProps } from "../../features/editor/MarkdownEditor";
import {
  DemoDesktopAdapter,
  type OpenDocumentResult,
  type SavedClipboardImage,
  type WorkspaceNode,
} from "../../infrastructure/tauri/desktopAdapter";
import { AppSettingsProvider } from "../settings";
import { AppShell } from "./AppShell";

const { editors } = vi.hoisted(() => ({ editors: new Map<string, MarkdownEditorProps>() }));

vi.mock("../../features/editor/MarkdownEditor", () => ({
  MarkdownEditor: (props: MarkdownEditorProps) => {
    editors.set(props.documentId, props);
    return (
      <textarea
        aria-label="Document body"
        data-path={props.documentId}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        value={props.value}
      />
    );
  },
}));

const ROOT_A = "/clipboard-fixtures/alpha";
const ROOT_B = "/clipboard-fixtures/beta";
const ROOT_NESTED = `${ROOT_A}/nested`;
const NOTE_A = `${ROOT_A}/alpha.md`;
const NOTE_B = `${ROOT_B}/beta.md`;
const NOTE_NESTED = `${ROOT_NESTED}/child.md`;
const STANDALONE = "/clipboard-standalone/single.md";
const SAVED_DRAFT = `${ROOT_A}/saved-draft.md`;
const ROOTS = [
  { path: ROOT_A, name: "Alpha" },
  { path: ROOT_B, name: "Beta" },
  { path: ROOT_NESTED, name: "Nested" },
];
const savedImage = (documentPath: string, directoryPath?: string): SavedClipboardImage => ({
  path: `${directoryPath ?? documentPath.slice(0, documentPath.lastIndexOf("/"))}/paste.png`,
  markdownUri: directoryPath ? "../../images/paste.png" : "./paste.png",
  width: 4,
  height: 3,
});

class ClipboardFixtureAdapter extends DemoDesktopAdapter {
  private rootIndex = 0;
  readonly contents = new Map([
    [NOTE_A, "# Alpha\n"],
    [NOTE_B, "# Beta\n"],
    [NOTE_NESTED, "# Nested\n"],
    [STANDALONE, "# Standalone\n"],
  ]);
  override async pickWorkspace() {
    return ROOTS[this.rootIndex++]!;
  }
  override async pickDocument() {
    return { path: STANDALONE, name: "single.md" };
  }
  override async listWorkspace(root: string): Promise<readonly WorkspaceNode[]> {
    return [...this.contents.keys()]
      .filter((path) => path.startsWith(`${root}/`))
      .map((path) => ({
        name: path.split("/").at(-1)!,
        path,
        relativePath: path.slice(root.length + 1),
        kind: "markdown",
      }));
  }
  override async openDocument(path: string): Promise<OpenDocumentResult> {
    const content = this.contents.get(path);
    if (content === undefined) throw new Error("Missing synthetic document");
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
  override async saveDocumentAs(_name: string, content: string) {
    this.contents.set(SAVED_DRAFT, content);
    return { path: SAVED_DRAFT, bytesWritten: content.length };
  }
  override async saveClipboardImage(path: string, directoryPath?: string) {
    return savedImage(path, directoryPath);
  }
  override async pickImageDirectory() {
    return "/clipboard-images/selected";
  }
  async hasClipboardImage() {
    return true;
  }
}

afterEach(() => {
  editors.clear();
  vi.restoreAllMocks();
});

async function setup() {
  const adapter = new ClipboardFixtureAdapter();
  const saveImage = vi.spyOn(adapter, "saveClipboardImage");
  const saveAs = vi.spyOn(adapter, "saveDocumentAs");
  const choose = vi.spyOn(adapter, "pickImageDirectory");
  const rendered = render(
    <AppSettingsProvider initialSettings={{ locale: "zh-CN" }} storage={null}>
      <AppShell adapter={adapter} />
    </AppSettingsProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
  const sidebar = screen.getByRole("complementary", { name: "工作区侧栏" });
  fireEvent.doubleClick(await within(sidebar).findByRole("button", { name: "alpha.md" }));
  await waitFor(() => expect(editors.has(NOTE_A)).toBe(true));
  return { ...rendered, adapter, saveImage, saveAs, choose, sidebar };
}

async function addWorkspace(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "添加工作区…" }));
  await screen.findByRole("button", { name: `折叠工作区 · ${name}` });
}

async function settingsFor(name: string) {
  fireEvent.contextMenu(screen.getByRole("button", { name: `折叠工作区 · ${name}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: "图片保存位置…" }));
  return screen.findByRole("dialog", { name: "图片保存位置" });
}

async function setDirectory(
  name: string,
  path: string,
  choose: ReturnType<typeof vi.spyOn>,
) {
  choose.mockResolvedValueOnce(path);
  const dialog = await settingsFor(name);
  fireEvent.click(within(dialog).getByRole("radio", { name: "保存到指定目录" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "选择文件夹…" }));
  await waitFor(() => expect(within(dialog).getByRole("textbox")).toHaveValue(path));
  fireEvent.click(within(dialog).getByRole("button", { name: "保存设置" }));
}

async function paste(path: string, kind: "image" | "native-fallback" = "image") {
  let result: string | undefined;
  await act(async () => {
    result = await editors.get(path)!.onImagePaste!({ from: 1, to: 1 }, kind);
  });
  return result;
}

describe("workspace clipboard image integration", () => {
  it("defaults to the Markdown folder, including a standalone file", async () => {
    const { saveImage } = await setup();
    expect(await paste(NOTE_A)).toBe("![](./paste.png)");
    expect(saveImage).toHaveBeenLastCalledWith(NOTE_A);
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await waitFor(() => expect(editors.has(STANDALONE)).toBe(true));
    expect(await paste(STANDALONE)).toBe("![](./paste.png)");
    expect(saveImage).toHaveBeenLastCalledWith(STANDALONE);
  });

  it("routes each paste by document ownership, including the longest matching root", async () => {
    const { choose, saveImage, sidebar } = await setup();
    await addWorkspace("Beta");
    await addWorkspace("Nested");
    await setDirectory("Alpha", "/clipboard-images/alpha", choose);
    await setDirectory("Beta", "/clipboard-images/beta", choose);
    await setDirectory("Nested", "/clipboard-images/nested", choose);
    expect(choose).toHaveBeenLastCalledWith("zh-CN");

    await paste(NOTE_A);
    expect(saveImage).toHaveBeenLastCalledWith(NOTE_A, "/clipboard-images/alpha");
    fireEvent.doubleClick(within(sidebar).getByRole("button", { name: "beta.md" }));
    await waitFor(() => expect(editors.has(NOTE_B)).toBe(true));
    await paste(NOTE_B);
    expect(saveImage).toHaveBeenLastCalledWith(NOTE_B, "/clipboard-images/beta");
    fireEvent.doubleClick(within(sidebar).getAllByRole("button", { name: "child.md" })[0]!);
    await waitFor(() => expect(editors.has(NOTE_NESTED)).toBe(true));
    await paste(NOTE_NESTED);
    expect(saveImage).toHaveBeenLastCalledWith(NOTE_NESTED, "/clipboard-images/nested");
  });

  it("does not save cancelled settings and blocks document shortcuts behind the modal", async () => {
    const { choose, saveImage, container } = await setup();
    await setDirectory("Alpha", "/clipboard-images/kept", choose);
    const dialog = await settingsFor("Alpha");
    fireEvent.click(
      within(dialog).getByRole("radio", {
        name: "与 Markdown 文件保存在同一目录",
      }),
    );
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(container.querySelectorAll(".tab-rail__item")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await paste(NOTE_A);
    expect(saveImage).toHaveBeenLastCalledWith(NOTE_A, "/clipboard-images/kept");

    const resetDialog = await settingsFor("Alpha");
    fireEvent.click(
      within(resetDialog).getByRole("radio", {
        name: "与 Markdown 文件保存在同一目录",
      }),
    );
    fireEvent.click(within(resetDialog).getByRole("button", { name: "保存设置" }));
    await paste(NOTE_A);
    expect(saveImage).toHaveBeenLastCalledWith(NOTE_A);
  });

  it("saves an untitled document before queuing insertion on its remounted editor", async () => {
    const { saveAs, saveImage, choose } = await setup();
    await setDirectory("Alpha", "/clipboard-images/drafts", choose);
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    const draft = "untitled://未命名-1.md";
    await waitFor(() => expect(editors.has(draft)).toBe(true));
    expect(await paste(draft)).toBe("");
    expect(saveAs).toHaveBeenCalledOnce();
    expect(saveImage).toHaveBeenCalledWith(SAVED_DRAFT, "/clipboard-images/drafts");
    expect(saveAs.mock.invocationCallOrder[0]).toBeLessThan(
      saveImage.mock.invocationCallOrder[0]!,
    );
    const current = editors.get(SAVED_DRAFT)!;
    expect(current.imageInsertRequest).toMatchObject({
      documentId: SAVED_DRAFT,
      expectedText: "",
      editorMode: "visual",
      markdown: "![](../../images/paste.png)",
      selection: { from: 1, to: 1 },
    });
    expect(current.value).toBe("");
    act(() => current.onImageInsertConsumed?.(current.imageInsertRequest!.id));
    expect(editors.get(SAVED_DRAFT)?.imageInsertRequest).toBeUndefined();
  });

  it("does not write an image when Save As is cancelled or the empty clipboard has no image", async () => {
    const { adapter, saveAs, saveImage } = await setup();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    const draft = "untitled://未命名-1.md";
    await waitFor(() => expect(editors.has(draft)).toBe(true));
    const available = vi.spyOn(adapter, "hasClipboardImage").mockResolvedValue(false);
    expect(await paste(draft, "native-fallback")).toBe("");
    expect(saveAs).not.toHaveBeenCalled();
    expect(saveImage).not.toHaveBeenCalled();
    available.mockResolvedValue(true);
    saveAs.mockResolvedValueOnce(null as never);
    expect(await paste(draft)).toBe("");
    expect(saveImage).not.toHaveBeenCalled();
    expect(screen.getByText("已取消保存")).toBeVisible();
    expect(editors.get(draft)?.imageInsertRequest).toBeUndefined();
  });

  it("discards a queued Save As insertion when its editor surface changes", async () => {
    await setup();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    const draft = "untitled://未命名-1.md";
    await waitFor(() => expect(editors.has(draft)).toBe(true));
    await paste(draft);
    expect(editors.get(SAVED_DRAFT)?.imageInsertRequest?.editorMode).toBe("visual");

    fireEvent.click(screen.getByRole("button", { name: "源码" }));
    expect(editors.get(SAVED_DRAFT)?.imageInsertRequest).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "可视" }));
    expect(editors.get(SAVED_DRAFT)?.imageInsertRequest).toBeUndefined();
    expect(editors.get(SAVED_DRAFT)?.value).toBe("");
  });

  it("leaves text untouched on image failures and treats an empty fallback as a no-op", async () => {
    const { saveImage } = await setup();
    saveImage.mockRejectedValueOnce({ code: "clipboardNoImage" });
    expect(await paste(NOTE_A, "native-fallback")).toBe("");
    saveImage.mockRejectedValueOnce({ code: "imageDirectoryUnavailable" });
    await expect(paste(NOTE_A)).rejects.toThrow("图片保存目录不存在或不可用");
    expect(editors.get(NOTE_A)?.value).toBe("# Alpha\n");
    expect(editors.get(NOTE_A)?.imageInsertRequest).toBeUndefined();
  });

  it("does not carry a dirty tab's image paste error into another document", async () => {
    const { container, saveImage } = await setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Document body" }), {
      target: { value: "# Alpha draft\n" },
    });
    saveImage.mockRejectedValueOnce({ code: "clipboardUnavailable" });
    await act(async () => {
      const editor = editors.get(NOTE_A)!;
      try {
        await editor.onImagePaste!({ from: 1, to: 1 }, "image");
      } catch (error) {
        // The real surfaces forward a rejected image callback to onPasteError.
        editor.onPasteError?.((error as Error).message);
      }
    });
    expect(container.querySelector(".status-bar__state")).toHaveTextContent(
      "无法插入图片：无法读取系统剪贴板，请检查系统权限后重试。",
    );

    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    await waitFor(() => expect(editors.has(STANDALONE)).toBe(true));
    expect(container.querySelector(".status-bar__state")).not.toHaveTextContent(
      "无法插入图片",
    );
    expect(container.querySelector(".status-bar__state--error")).toBeNull();
    expect(editors.get(STANDALONE)?.value).toBe("# Standalone\n");
    expect(editors.get(NOTE_A)?.value).toBe("# Alpha draft\n");
  });

  it("discards late image results after the source tab closes", async () => {
    const { saveImage, sidebar } = await setup();
    let finish: (value: SavedClipboardImage) => void = () => undefined;
    saveImage.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const pending = editors.get(NOTE_A)!.onImagePaste!({ from: 1, to: 1 }, "image");
    fireEvent.click(screen.getByRole("button", { name: "关闭 alpha.md" }));
    fireEvent.doubleClick(within(sidebar).getByRole("button", { name: "alpha.md" }));
    let result: string | undefined;
    await act(async () => {
      finish(savedImage(NOTE_A));
      result = await pending;
    });
    expect(result).toBe("");
    expect(editors.get(NOTE_A)?.value).toBe("# Alpha\n");
    expect(editors.get(NOTE_A)?.imageInsertRequest).toBeUndefined();
  });
});
