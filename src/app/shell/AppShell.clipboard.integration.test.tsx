import { undo as undoSource } from "@codemirror/commands";
import { EditorView as CodeMirrorView } from "@codemirror/view";
import { undo as undoVisual } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { EditorView as ProseMirrorView } from "@milkdown/kit/prose/view";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "../../features/editor/spike/domTestSupport";
import { SESSION_SNAPSHOT_STORAGE_KEY } from "../../features/session-restore/sessionSnapshot";
import { WORKSPACE_HISTORY_STORAGE_KEY } from "../../features/workspace/workspaceHistory";
import {
  DemoDesktopAdapter,
  type OpenDocumentResult,
  type SavedClipboardImage,
  type WorkspaceNode,
} from "../../infrastructure/tauri/desktopAdapter";
import { AppSettingsProvider } from "../settings";
import { AppShell } from "./AppShell";

const nativeImage = vi.hoisted(() => ({ invoke: vi.fn() }));

// Keep both real editor surfaces and the real local-image resolver. Only the
// native boundary is synthetic; these tests never read the OS clipboard/files.
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  convertFileSrc: (path: string) => `asset://localhost${encodeURI(path)}`,
  invoke: nativeImage.invoke,
}));

const ROOT = "/clipboard-integration-fixtures";
const NOTE = `${ROOT}/capture.md`;
const ORIGINAL = "Before the screenshot.\n";
const IMAGE: SavedClipboardImage = {
  path: `${ROOT}/capture-01.png`,
  markdownUri: "./capture-01.png",
  width: 4,
  height: 3,
};
const IMAGE_MARKDOWN = `![](${IMAGE.markdownUri})`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((finish, fail) => {
    resolve = finish;
    reject = fail;
  });
  return { promise, resolve, reject };
}

class ClipboardIntegrationAdapter extends DemoDesktopAdapter {
  readonly contents = new Map([[NOTE, ORIGINAL]]);
  readonly images = new Set<string>();
  readonly imageWrite = deferred<SavedClipboardImage>();

  override async pickWorkspace() {
    return { path: ROOT, name: "Clipboard test workspace" };
  }

  override async listWorkspace(): Promise<readonly WorkspaceNode[]> {
    return [
      { path: NOTE, name: "capture.md", relativePath: "capture.md", kind: "markdown" },
    ];
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

  override async saveDocument(path: string, content: string) {
    this.contents.set(path, content);
    return { path, bytesWritten: content.length };
  }

  override async saveClipboardImage(documentPath: string) {
    if (!this.contents.has(documentPath)) throw new Error("Missing synthetic document");
    const saved = await this.imageWrite.promise;
    this.images.add(saved.path);
    return saved;
  }
}

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

beforeEach(() => {
  localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_KEY);
  localStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
  nativeImage.invoke.mockReset();
  nativeImage.invoke.mockImplementation(
    async (_command, args: { path: string }) => args.path,
  );
});

function captureVisualView() {
  const views = new Set<ProseMirrorView>();
  const updateState = ProseMirrorView.prototype.updateState;
  vi.spyOn(ProseMirrorView.prototype, "updateState").mockImplementation(function (
    this: ProseMirrorView,
    state,
  ) {
    updateState.call(this, state);
    views.add(this);
  });
  return (container: HTMLElement) =>
    waitFor(() => {
      const element = container.querySelector(".ProseMirror");
      const view = [...views].find((candidate) => candidate.dom === element);
      expect(view).toBeTruthy();
      return view!;
    });
}

async function setup() {
  const findVisualView = captureVisualView();
  const adapter = new ClipboardIntegrationAdapter();
  const saveImage = vi.spyOn(adapter, "saveClipboardImage");
  const saveDocument = vi.spyOn(adapter, "saveDocument");
  const rendered = render(
    <AppSettingsProvider
      initialSettings={{ locale: "zh-CN", startupBehavior: "empty" }}
      storage={null}
    >
      <AppShell adapter={adapter} />
    </AppSettingsProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
  const sidebar = screen.getByRole("complementary", { name: "工作区侧栏" });
  fireEvent.doubleClick(await within(sidebar).findByRole("button", { name: "capture.md" }));
  const visualView = await findVisualView(rendered.container);
  return { ...rendered, adapter, saveImage, saveDocument, visualView, findVisualView };
}

function pasteScreenshot(
  target: HTMLElement,
  representation: "png" | "image-html" = "png",
) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      items: [{ kind: "file", type: "image/png" }],
      files: [],
      types:
        representation === "png" ? ["image/png"] : ["image/png", "text/html", "text/plain"],
      getData: (type: string) =>
        representation === "image-html"
          ? type === "text/html"
            ? '<div><img src="file:///clipboard-integration-fixtures/clipboard.png"></div>'
            : type === "text/plain"
              ? "\n\uFFFC\n"
              : ""
          : "",
    },
  });
  fireEvent(target, event);
  return event;
}

describe("AppShell screenshot paste with real Markdown editors", () => {
  it("shows a screenshot failure on a dirty visual document and clears it on a successful retry", async () => {
    const { container, adapter, saveImage, saveDocument, visualView } = await setup();
    act(() => visualView.dispatch(visualView.state.tr.insertText("Draft ", 1)));
    await waitFor(() =>
      expect(container.querySelector(".tab-rail__dirty")).toBeInTheDocument(),
    );
    const draftDocument = visualView.state.doc;
    const selection = visualView.state.selection;
    expect(container.querySelector(".status-bar__state")).toHaveTextContent("未保存");

    const event = pasteScreenshot(visualView.dom);
    expect(event.defaultPrevented).toBe(true);
    expect(saveImage).toHaveBeenCalledExactlyOnceWith(NOTE);
    await act(async () => adapter.imageWrite.reject({ code: "clipboardUnavailable" }));

    expect(visualView.state.doc).toBe(draftDocument);
    expect(visualView.state.selection.eq(selection)).toBe(true);
    expect(container.querySelector(".visual-markdown-image__content")).toBeNull();
    expect(container.querySelector(".tab-rail__dirty")).toBeInTheDocument();
    expect(adapter.contents.get(NOTE)).toBe(ORIGINAL);
    expect(adapter.images.size).toBe(0);
    expect(saveDocument).not.toHaveBeenCalled();
    expect(nativeImage.invoke).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(container.querySelector(".status-bar__state")).toHaveTextContent(
        "无法插入图片：无法读取系统剪贴板，请检查系统权限后重试。",
      ),
    );

    const retry = deferred<SavedClipboardImage>();
    saveImage.mockImplementationOnce(() => retry.promise);
    expect(pasteScreenshot(visualView.dom).defaultPrevented).toBe(true);
    expect(container.querySelector(".status-bar__state")).toHaveTextContent("未保存");
    expect(container.querySelector(".status-bar__state")).not.toHaveTextContent(
      "无法插入图片",
    );
    expect(visualView.state.doc).toBe(draftDocument);
    await act(async () => retry.resolve(IMAGE));
    await waitFor(() =>
      expect(container.querySelector(".visual-markdown-image__content")).toHaveAttribute(
        "src",
        `asset://localhost${IMAGE.path}`,
      ),
    );
    expect(container.querySelector(".status-bar__state")).not.toHaveTextContent(
      "无法插入图片",
    );
    expect(container.querySelector(".status-bar__state--error")).toBeNull();
    expect(visualView.state.doc.textContent).toBe(draftDocument.textContent);
    expect(saveImage).toHaveBeenCalledTimes(2);
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it.each(["png", "image-html"] as const)(
    "keeps a visual %s paste through the native reply, Shell rerender, save and Undo",
    async (representation) => {
      const { container, adapter, saveImage, saveDocument, visualView, findVisualView } =
        await setup();
      const originalDoc = visualView.state.doc;
      act(() =>
        visualView.dispatch(
          visualView.state.tr.setSelection(
            TextSelection.create(originalDoc, originalDoc.content.size - 1),
          ),
        ),
      );
      const event = pasteScreenshot(visualView.dom, representation);
      expect(event.defaultPrevented).toBe(true);
      expect(saveImage).toHaveBeenCalledExactlyOnceWith(NOTE);
      expect(visualView.state.doc).toBe(originalDoc);
      expect(container.querySelector(".visual-markdown-image__content")).toBeNull();
      expect(container.querySelector(".tab-rail__dirty")).toBeNull();
      expect(saveDocument).not.toHaveBeenCalled();
      expect(adapter.contents.get(NOTE)).toBe(ORIGINAL);

      await act(async () => adapter.imageWrite.resolve(IMAGE));
      // Shell updates its status and document state after the host reply. The
      // dirty document message intentionally takes priority over image status.
      await waitFor(() =>
        expect(container.querySelector(".status-bar__state")).toHaveTextContent("未保存"),
      );
      const image = await waitFor(() => {
        const result = container.querySelector<HTMLImageElement>(
          ".visual-markdown-image__content",
        );
        expect(result).toHaveAttribute("src", `asset://localhost${IMAGE.path}`);
        return result!;
      });
      expect(image.dataset.visualImageReference).toBe(IMAGE.markdownUri);
      expect(nativeImage.invoke).toHaveBeenCalledExactlyOnceWith("prepare_local_image", {
        path: IMAGE.path,
      });
      expect(await findVisualView(container)).toBe(visualView);
      expect(visualView.state.doc.textContent).toBe(ORIGINAL.trim());
      expect(visualView.state.doc.firstChild?.lastChild?.type.name).toBe("image");
      expect(container.querySelector(".tab-rail__dirty")).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "s", metaKey: true });
      await waitFor(() => expect(saveDocument).toHaveBeenCalledOnce());
      const savedText = adapter.contents.get(NOTE)!;
      expect(savedText).toContain(IMAGE_MARKDOWN);
      expect(savedText).toContain(ORIGINAL.trim());
      expect(savedText).not.toContain("data:image/");
      await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeNull());

      act(() => {
        expect(undoVisual(visualView.state, visualView.dispatch)).toBe(true);
      });
      expect(visualView.state.doc.eq(originalDoc)).toBe(true);
      expect(container.querySelector(".visual-markdown-image__content")).toBeNull();
      expect(container.querySelector(".tab-rail__dirty")).toBeInTheDocument();
      expect(adapter.images).toEqual(new Set([IMAGE.path]));
      expect(adapter.contents.get(NOTE)).toBe(savedText);
      expect(saveImage).toHaveBeenCalledOnce();
    },
  );

  it("keeps a source paste through the native reply, saves its exact Markdown, and undoes only the link", async () => {
    const { container, adapter, saveImage, saveDocument } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "源码" }));
    const view = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(".cm-editor");
      const result = element ? CodeMirrorView.findFromDOM(element) : null;
      expect(result).toBeTruthy();
      return result!;
    });
    act(() => view.dispatch({ selection: { anchor: view.state.doc.length } }));
    const event = pasteScreenshot(view.contentDOM);
    expect(event.defaultPrevented).toBe(true);
    expect(saveImage).toHaveBeenCalledExactlyOnceWith(NOTE);
    expect(view.state.doc.toString()).toBe(ORIGINAL);
    expect(container.querySelector(".tab-rail__dirty")).toBeNull();

    await act(async () => adapter.imageWrite.resolve(IMAGE));
    await waitFor(() => expect(view.state.doc.toString()).toBe(ORIGINAL + IMAGE_MARKDOWN));
    expect(container.querySelector(".status-bar__state")).toHaveTextContent("未保存");
    expect(
      CodeMirrorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!),
    ).toBe(view);
    expect(container.querySelector(".tab-rail__dirty")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(saveDocument).toHaveBeenCalledOnce());
    expect(adapter.contents.get(NOTE)).toBe(ORIGINAL + IMAGE_MARKDOWN);
    await waitFor(() => expect(container.querySelector(".tab-rail__dirty")).toBeNull());

    act(() => {
      expect(undoSource(view)).toBe(true);
    });
    expect(view.state.doc.toString()).toBe(ORIGINAL);
    expect(container.querySelector(".tab-rail__dirty")).toBeInTheDocument();
    expect(adapter.images).toEqual(new Set([IMAGE.path]));
    expect(adapter.contents.get(NOTE)).toBe(ORIGINAL + IMAGE_MARKDOWN);
    expect(nativeImage.invoke).not.toHaveBeenCalled();
  });
});
