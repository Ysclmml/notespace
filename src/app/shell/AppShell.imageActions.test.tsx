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
import { SESSION_SNAPSHOT_STORAGE_KEY } from "../../features/session-restore/sessionSnapshot";
import { WORKSPACE_HISTORY_STORAGE_KEY } from "../../features/workspace/workspaceHistory";
import type {
  DesktopAdapter,
  NativeMenuActionId,
  OpenDocumentResult,
  WorkspaceNode,
} from "../../infrastructure/tauri/desktopAdapter";
import { AppSettingsProvider } from "../settings";
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

vi.mock("../../features/editor/MarkdownEditor", () => ({
  MarkdownEditor: (props: MarkdownEditorProps) => {
    const reference = props.value.includes("https://")
      ? "https://images.example.test/picture.png"
      : "assets/picture.png";
    const source = reference.startsWith("https://")
      ? reference
      : "/image-fixtures/assets/picture.png";
    return (
      <div>
        <span className="ProseMirror" contentEditable suppressContentEditableWarning>
          <span className="visual-markdown-image" contentEditable={false}>
            <img
              src={source}
              alt="Synthetic picture"
              data-visual-image-reference={reference}
              data-visual-image-document={props.documentId}
              data-visual-image-source={source}
            />
          </span>
        </span>
        <output aria-label="Synthetic document text">{props.value}</output>
      </div>
    );
  },
}));

const ROOT = "/image-fixtures";
const NOTE = `${ROOT}/note.md`;
const IMAGE = `${ROOT}/assets/picture.png`;

class ImageActionsAdapter implements DesktopAdapter {
  listener?: (action: NativeMenuActionId) => void;
  constructor(
    readonly reference = "assets/picture.png",
    readonly kind: "demo" | "tauri" = "demo",
  ) {}
  get content() {
    return `![Synthetic picture](${this.reference})\n`;
  }
  async pickWorkspace() {
    return { path: ROOT, name: "Image fixtures" };
  }
  async pickDocument() {
    return { path: NOTE, name: "note.md" };
  }
  async listWorkspace(): Promise<readonly WorkspaceNode[]> {
    return [{ name: "note.md", path: NOTE, relativePath: "note.md", kind: "markdown" }];
  }
  openDocument = vi.fn(async (path: string): Promise<OpenDocumentResult> => ({
    status: "editable",
    path,
    content: this.content,
    mode: "normal",
    documentKind: "markdown",
    language: "markdown",
    preflight: {
      sizeBytes: this.content.length,
      longestLineBytes: this.content.length,
      containsDataImageBase64: false,
    },
  }));
  revealInFileManager = vi.fn(async (path: string): Promise<void> => {
    void path;
  });
  saveDocument = vi.fn(async (path: string, content: string) => ({
    path,
    bytesWritten: content.length,
  }));
  async saveDocumentAs() {
    return null;
  }
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
  async listenNativeMenuAction(listener: (action: NativeMenuActionId) => void) {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }
}

function clearBrowsingMetadata() {
  localStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
  localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_KEY);
}
beforeEach(() => {
  clearBrowsingMetadata();
  nativeWindow.destroy.mockClear();
});
afterEach(() => {
  cleanup();
  clearBrowsingMetadata();
  vi.restoreAllMocks();
});

async function setup(adapter = new ImageActionsAdapter()) {
  render(
    <AppSettingsProvider
      storage={null}
      initialSettings={{ locale: "zh-CN", startupBehavior: "empty" }}
    >
      <AppShell adapter={adapter} />
    </AppSettingsProvider>,
  );
  fireEvent.click(
    within(screen.getByRole("main")).getByRole("button", {
      name: adapter.kind === "demo" ? "打开演示工作区" : "打开工作区",
    }),
  );
  const sidebar = screen.getByRole("complementary", { name: "工作区侧栏" });
  fireEvent.click(await within(sidebar).findByRole("button", { name: "note.md" }));
  const image = await screen.findByRole("img", { name: "Synthetic picture" });
  fireEvent.contextMenu(image, { clientX: 420, clientY: 220 });
  return { adapter, menu: screen.getByRole("menu", { name: "图片" }) };
}

function expectUnchanged(adapter: ImageActionsAdapter) {
  expect(screen.getByLabelText("Synthetic document text")).toHaveTextContent(
    adapter.content.trim(),
  );
  expect(screen.queryByLabelText("未保存")).toBeNull();
  expect(adapter.openDocument).toHaveBeenCalledTimes(1);
  expect(adapter.saveDocument).not.toHaveBeenCalled();
}

describe("AppShell image context actions", () => {
  it("reveals the local image path, never its containing Markdown document", async () => {
    const { adapter, menu } = await setup();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "打开图片所在位置" }));
    await waitFor(() => expect(adapter.revealInFileManager).toHaveBeenCalledWith(IMAGE));
    expect(adapter.revealInFileManager).toHaveBeenCalledTimes(1);
    expect(adapter.revealInFileManager).not.toHaveBeenCalledWith(NOTE);
    expect(screen.getByText("已在文件管理器中显示 picture.png")).toBeInTheDocument();
    expectUnchanged(adapter);
  });

  it("does not offer local file-manager reveal for a remote image", async () => {
    const { adapter, menu } = await setup(
      new ImageActionsAdapter("https://images.example.test/picture.png"),
    );
    expect(within(menu).getByRole("menuitem", { name: "预览图片" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "打开图片所在位置" })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(adapter.revealInFileManager).not.toHaveBeenCalled();
    expectUnchanged(adapter);
  });

  it("keeps a failed reveal visible without changing the document or opening another file", async () => {
    const adapter = new ImageActionsAdapter();
    adapter.revealInFileManager.mockRejectedValueOnce(
      new Error("Synthetic reveal failure"),
    );
    const { menu } = await setup(adapter);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "打开图片所在位置" }));
    const message = "无法打开所在文件夹：Synthetic reveal failure";
    await screen.findByText(message);
    await waitFor(() => expect(screen.queryByRole("menu", { name: "图片" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "查看当前文档统计" }));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(adapter.revealInFileManager).toHaveBeenCalledExactlyOnceWith(IMAGE);
    expectUnchanged(adapter);
  });

  it("blocks background native and keyboard actions during an image modal, then permits closing again", async () => {
    const { adapter } = await setup(new ImageActionsAdapter("assets/picture.png", "tauri"));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(adapter.listener).toBeDefined();
      expect(nativeWindow.onClose).toBeDefined();
    });
    const dialog = document.createElement("section");
    dialog.className = "image-reference-dialog";
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    const preventDefault = vi.fn();
    try {
      act(() => {
        adapter.listener?.("file.new");
        adapter.listener?.("file.save");
        adapter.listener?.("window.close");
        nativeWindow.onClose?.({ preventDefault });
      });
      fireEvent.keyDown(window, { key: "n", metaKey: true });
      fireEvent.keyDown(window, { key: "s", metaKey: true });
      expect(screen.getAllByRole("button", { name: /^关闭 /u })).toHaveLength(1);
      expect(nativeWindow.destroy).not.toHaveBeenCalled();
      expect(preventDefault).toHaveBeenCalledOnce();
      expectUnchanged(adapter);
    } finally {
      dialog.remove();
    }
    act(() => adapter.listener?.("window.close"));
    await waitFor(() => expect(nativeWindow.destroy).toHaveBeenCalledOnce());
    expectUnchanged(adapter);
  });
});
