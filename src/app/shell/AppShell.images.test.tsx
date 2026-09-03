import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodeFilePreviewProps } from "../../features/code-preview/CodeFilePreview";
import type { MarkdownEditorProps } from "../../features/editor/MarkdownEditor";
import { WORKSPACE_HISTORY_STORAGE_KEY } from "../../features/workspace/workspaceHistory";
import {
  DemoDesktopAdapter,
  type LocalFilePreview,
  type OpenDocumentResult,
  type WorkspaceNode,
} from "../../infrastructure/tauri/desktopAdapter";
import { AppSettingsProvider } from "../settings";
import { AppShell } from "./AppShell";

vi.mock("../../features/editor/MarkdownEditor", () => ({
  MarkdownEditor: (props: MarkdownEditorProps) => (
    <div className="ProseMirror">
      <textarea
        aria-label="Document body"
        autoFocus={props.autofocus}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        value={props.value}
      />
      <button
        onClick={() => props.onInternalLink?.("./images/picture.png", "current")}
        type="button"
      >
        Local image link
      </button>
      <button
        onClick={() =>
          props.onInternalLink?.("https://example.test/photo.webp?size=2#detail", "current")
        }
        type="button"
      >
        Remote image link
      </button>
      <button
        onClick={() => props.onInternalLink?.("worker.py:12", "current")}
        type="button"
      >
        Code line link
      </button>
      <button
        onClick={() =>
          props.onInternalLink?.("https://example.test/guide?q=hello#section", "current")
        }
        type="button"
      >
        Website link
      </button>
      <button
        onClick={() =>
          props.onInternalLink?.("http://localhost:8080/docs", "newBackground")
        }
        type="button"
      >
        Local website link
      </button>
      <code>./images/inline.svg</code>
      <code>https://example.test/hover.png</code>
    </div>
  ),
}));

vi.mock("../../features/code-preview/CodeFilePreview", () => ({
  CodeFilePreview: (props: CodeFilePreviewProps) => (
    <section aria-label="Code preview" data-path={props.path}>
      <pre>{props.content}</pre>
      <span>Line {props.targetLine}</span>
      {props.onOpenSide && (
        <button onClick={props.onOpenSide} type="button">
          Open code on right
        </button>
      )}
    </section>
  ),
}));

afterEach(() => {
  localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_KEY);
  vi.restoreAllMocks();
});

const rootPath = "/image-fixtures";
const guidePath = `${rootPath}/left/guide.md`;
const otherPath = `${rootPath}/right/other.md`;
const codePath = `${rootPath}/left/worker.py`;
const contents = new Map([
  [guidePath, "# Guide\n\nA synthetic image-link document.\n"],
  [otherPath, "# Other\n\nA different image directory.\n"],
  [codePath, "def worker():\n    return 12\n"],
]);

class ImageFixtureAdapter extends DemoDesktopAdapter {
  override async pickWorkspace() {
    return { path: rootPath, name: "Image fixtures" };
  }

  override async listWorkspace(): Promise<readonly WorkspaceNode[]> {
    return Array.from(contents.keys(), (path) => ({
      kind: path.endsWith(".md") ? "markdown" : "text",
      path,
      name: path.split("/").at(-1) ?? path,
      relativePath: path.slice(rootPath.length + 1),
    }));
  }

  override async openDocument(path: string): Promise<OpenDocumentResult> {
    const content = contents.get(path);
    if (content === undefined) throw new Error("Missing synthetic image fixture");
    const markdown = path.endsWith(".md");
    return {
      status: "editable",
      path,
      content,
      mode: "normal",
      documentKind: markdown ? "markdown" : "text",
      language: markdown ? "markdown" : "python",
      preflight: {
        sizeBytes: content.length,
        longestLineBytes: content.length,
        containsDataImageBase64: false,
      },
    };
  }

  override async previewLocalFile(): Promise<LocalFilePreview> {
    return {
      path: codePath,
      language: "python",
      targetLine: 12,
      startLine: 11,
      content: contents.get(codePath)!,
    };
  }
}

function panel(index: number) {
  return screen.getByRole("region", { name: `编辑分屏 ${index}` });
}

function rail(index?: number) {
  return screen.getByRole("navigation", {
    name: index ? `分屏 ${index} 的标签页` : "文档标签页",
  });
}

async function setup() {
  const adapter = new ImageFixtureAdapter();
  const open = vi.spyOn(adapter, "openDocument");
  const preview = vi.spyOn(adapter, "previewLocalFile");
  const rendered = render(
    <AppSettingsProvider initialSettings={{ locale: "zh-CN" }} storage={null}>
      <AppShell adapter={adapter} />
    </AppSettingsProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
  const sidebar = screen.getByRole("complementary", { name: "工作区侧栏" });
  fireEvent.doubleClick(await within(sidebar).findByRole("button", { name: "guide.md" }));
  await within(rail()).findByTitle(guidePath);
  const editor = await within(panel(1)).findByRole("textbox", { name: "Document body" });
  open.mockClear();
  return { ...rendered, adapter, open, preview, sidebar, editor };
}

describe("AppShell image link navigation", () => {
  it("opens HTTP and HTTPS in the system browser without navigating or editing the document", async () => {
    const { adapter, container, editor, open, preview } = await setup();
    const external = vi.spyOn(adapter, "openExternalUrl").mockResolvedValue(undefined);
    const originalTab = panel(1).dataset.tabId;
    fireEvent.click(within(panel(1)).getByRole("button", { name: "Website link" }));
    await waitFor(() =>
      expect(external).toHaveBeenCalledWith("https://example.test/guide?q=hello#section"),
    );
    fireEvent.click(within(panel(1)).getByRole("button", { name: "Local website link" }));
    await waitFor(() =>
      expect(external).toHaveBeenCalledWith("http://localhost:8080/docs"),
    );
    expect(external).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(panel(1)).toHaveAttribute("data-tab-id", originalTab);
    expect(container.querySelectorAll(".tab-rail__item")).toHaveLength(1);
    expect(container.querySelector(".tab-rail__dirty")).toBeNull();
    expect(editor).toHaveValue(contents.get(guidePath));
    expect(screen.getByRole("button", { name: "后退" })).toBeDisabled();
  });

  it("reports browser-launch failures and keeps image URLs in the dedicated image viewer", async () => {
    const { adapter, editor } = await setup();
    const external = vi
      .spyOn(adapter, "openExternalUrl")
      .mockRejectedValue(new Error("No browser handler"));
    fireEvent.click(within(panel(1)).getByRole("button", { name: "Website link" }));
    expect(await screen.findByText("无法打开浏览器：No browser handler")).toBeVisible();
    expect(editor).toHaveValue(contents.get(guidePath));
    external.mockClear();
    fireEvent.click(within(panel(1)).getByRole("button", { name: "Remote image link" }));
    expect(await screen.findByRole("img", { name: "photo.webp" })).toBeInTheDocument();
    expect(external).not.toHaveBeenCalled();
  });

  it("opens an image without a line number, leaving the tab, text, dirty state, and reading position unchanged", async () => {
    const { container, editor, open, preview } = await setup();
    const textarea = editor as HTMLTextAreaElement;
    act(() => textarea.focus());
    textarea.setSelectionRange(7, 11);
    textarea.scrollTop = 120;
    const originalTab = panel(1).dataset.tabId;
    expect(container.querySelector(".tab-rail__dirty")).toBeNull();

    fireEvent.click(within(panel(1)).getByRole("button", { name: "Local image link" }));
    expect(await screen.findByRole("img", { name: "picture.png" })).toHaveAttribute(
      "src",
      `${rootPath}/left/images/picture.png`,
    );
    expect(open).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(container.querySelector(".tab-rail__dirty")).toBeNull();
    expect(container.querySelectorAll(".tab-rail__item")).toHaveLength(1);
    expect(panel(1)).toHaveAttribute("data-tab-id", originalTab);
    expect(textarea).toHaveValue(contents.get(guidePath));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("img")).toBeNull();
    expect(within(panel(1)).getByRole("textbox", { name: "Document body" })).toBe(editor);
    expect(textarea).toHaveFocus();
    expect([textarea.selectionStart, textarea.selectionEnd, textarea.scrollTop]).toEqual([
      7, 11, 120,
    ]);
  });

  it("preserves a dirty document and an already-open code sidebar when viewing an image", async () => {
    const { container, editor, open, preview } = await setup();
    const draft = `${contents.get(guidePath)}Unsaved change.\n`;
    fireEvent.change(editor, { target: { value: draft } });
    fireEvent.click(within(panel(1)).getByRole("button", { name: "Code line link" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open code on right" }));
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "本地文件预览" })).toBeNull(),
    );
    const code = screen.getByRole("region", { name: "Code preview" });
    open.mockClear();
    preview.mockClear();

    fireEvent.click(within(panel(1)).getByRole("button", { name: "Local image link" }));
    await screen.findByRole("img", { name: "picture.png" });
    expect(container.querySelectorAll(".tab-rail__dirty")).toHaveLength(1);
    expect(editor).toHaveValue(draft);
    expect(screen.getByRole("region", { name: "Code preview" })).toBe(code);
    expect(code).toHaveAttribute("data-path", codePath);
    expect(open).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "关闭查看器" }));
    expect(screen.getByRole("region", { name: "Code preview" })).toBe(code);
    expect(container.querySelectorAll(".tab-rail__dirty")).toHaveLength(1);
  });

  it("does not preload hovered image paths and opens remote image links in the viewer, not the browser", async () => {
    const { editor, open, preview } = await setup();
    const browserOpen = vi.spyOn(window, "open").mockImplementation(() => null);
    const schedule = vi.spyOn(window, "setTimeout");
    const inline = within(panel(1)).getByText("https://example.test/hover.png");
    fireEvent.pointerOver(inline);
    expect(schedule).not.toHaveBeenCalled();
    schedule.mockRestore();
    expect(screen.queryByRole("img")).toBeNull();

    fireEvent.click(within(panel(1)).getByRole("button", { name: "Remote image link" }));
    const image = await screen.findByRole("img", { name: "photo.webp" });
    expect(image).toHaveAttribute("src", "https://example.test/photo.webp?size=2#detail");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(browserOpen).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
    expect(editor).toHaveValue(contents.get(guidePath));
  });

  it("keeps the existing non-image file:line route to the bounded code preview", async () => {
    const { open, preview } = await setup();
    fireEvent.click(within(panel(1)).getByRole("button", { name: "Code line link" }));
    const code = await screen.findByRole("region", { name: "Code preview" });
    expect(code).toHaveTextContent("Line 12");
    expect(preview).toHaveBeenCalledExactlyOnceWith("worker.py:12", guidePath);
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
    expect(within(rail()).getByTitle(guidePath)).toHaveAttribute("aria-current", "page");
  });

  it("resolves both link and inline-image paths against their source tab, even when another split is focused", async () => {
    const { sidebar, open, preview } = await setup();
    fireEvent.contextMenu(within(rail()).getByTitle(guidePath), {
      clientX: 200,
      clientY: 80,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "向右分屏" }));
    fireEvent(panel(1), new MouseEvent("pointerdown", { button: 0, bubbles: true }));
    fireEvent.doubleClick(within(sidebar).getByRole("button", { name: "guide.md" }));
    await within(rail(1)).findByTitle(guidePath);
    const rightEditor = await within(panel(2)).findByRole("textbox", {
      name: "Document body",
    });
    act(() => rightEditor.focus());
    fireEvent.doubleClick(within(sidebar).getByRole("button", { name: "other.md" }));
    await within(rail(2)).findByTitle(otherPath);
    const focusedEditor = within(panel(2)).getByRole("textbox", { name: "Document body" });
    act(() => focusedEditor.focus());
    const tabs = [panel(1).dataset.tabId, panel(2).dataset.tabId];
    open.mockClear();

    fireEvent.click(within(panel(1)).getByRole("button", { name: "Local image link" }));
    expect(await screen.findByRole("img", { name: "picture.png" })).toHaveAttribute(
      "src",
      `${rootPath}/left/images/picture.png`,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(focusedEditor).toHaveFocus();

    fireEvent.click(within(panel(1)).getByText("./images/inline.svg"));
    expect(await screen.findByRole("img", { name: "inline.svg" })).toHaveAttribute(
      "src",
      `${rootPath}/left/images/inline.svg`,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(within(panel(2)).getByRole("button", { name: "Local image link" }));
    expect(await screen.findByRole("img", { name: "picture.png" })).toHaveAttribute(
      "src",
      `${rootPath}/right/images/picture.png`,
    );
    expect([panel(1).dataset.tabId, panel(2).dataset.tabId]).toEqual(tabs);
    expect(open).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled();
  });
});
