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
import type {
  DesktopAdapter,
  OpenDocumentResult,
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

// Exercise the real Shell's mode, document, navigation and persistence wiring.
// Editor transaction/IME protection is covered by ReadingCodeSurfaces.dom.test.
vi.mock("../../features/editor/MarkdownEditor", () => ({
  MarkdownEditor: (props: MarkdownEditorProps) => (
    <textarea
      aria-label={`Markdown body ${props.documentId}`}
      data-mode={props.presentationMode}
      data-read-only={String(props.readOnly)}
      data-typing-hints={String(props.showTypingHints)}
      readOnly={props.readOnly}
      onChange={(event) => props.onChange(event.currentTarget.value)}
      value={props.value}
    />
  ),
}));

vi.mock("../../features/code-preview/CodeFilePreview", () => ({
  CodeFilePreview: (props: CodeFilePreviewProps) => (
    <textarea
      aria-label={`Code body ${props.path}`}
      data-read-only={String(props.readOnly)}
      readOnly={props.readOnly || !props.editable}
      onChange={(event) => props.onChange?.(event.currentTarget.value)}
      value={props.content}
    />
  ),
}));

const ROOT = "/reading-fixtures";
const GUIDE = `${ROOT}/guide.md`;
const SECOND = `${ROOT}/second.md`;
const CODE = `${ROOT}/example.txt`;

class ReadingAdapter implements DesktopAdapter {
  readonly kind = "tauri" as const;
  readonly contents = new Map([
    [GUIDE, "# Guide\n\nOriginal note.\n"],
    [SECOND, "# Second\n\nAnother note.\n"],
    [CODE, "first\nsecond\n"],
  ]);
  readonly pickWorkspace = vi.fn(async () => ({ path: ROOT, name: "Reading fixtures" }));
  readonly pickDocument = vi.fn(async () => ({ path: GUIDE, name: "guide.md" }));
  readonly listWorkspace = vi.fn(async (): Promise<WorkspaceNode[]> =>
    [...this.contents.keys()].map((path) => ({
      path,
      relativePath: path.slice(ROOT.length + 1),
      name: path.slice(ROOT.length + 1),
      kind: path.endsWith(".md") ? "markdown" : "text",
    })),
  );
  readonly openDocument = vi.fn(async (path: string): Promise<OpenDocumentResult> => {
    const content = this.contents.get(path);
    if (content === undefined) throw new Error("Missing reading fixture");
    return {
      status: "editable",
      path,
      content,
      mode: "normal",
      documentKind: path.endsWith(".md") ? "markdown" : "text",
      language: path.endsWith(".md") ? "markdown" : "text",
      preflight: {
        sizeBytes: content.length,
        longestLineBytes: content.length,
        containsDataImageBase64: false,
      },
    };
  });
  readonly saveDocument = vi.fn(async (path: string, content: string) => {
    this.contents.set(path, content);
    return { path, bytesWritten: content.length };
  });
  async revealInFileManager() {}
  async moveWorkspaceEntryToTrash() {}
  async createWorkspaceTextFile(): Promise<never> {
    throw new Error("Not used");
  }
  async previewLocalFile(): Promise<never> {
    throw new Error("Not used");
  }
  async saveDocumentAs(): Promise<never> {
    throw new Error("Not used");
  }
  async saveClipboardImage(): Promise<never> {
    throw new Error("Not used");
  }
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function mount(adapter = new ReadingAdapter()) {
  return {
    ...render(
      <AppSettingsProvider initialSettings={{ locale: "zh-CN" }}>
        <AppShell adapter={adapter} />
      </AppSettingsProvider>,
    ),
    adapter,
  };
}

function readingButton(name: "阅读" | "编辑") {
  return within(screen.getByRole("group", { name: "阅读模式" })).getByRole("button", {
    name,
  });
}

async function setup() {
  const result = mount();
  const sidebar = screen.getByRole("complementary", { name: "工作区侧栏" });
  fireEvent.click(within(sidebar).getByRole("button", { name: "打开工作区" }));
  await within(sidebar).findByRole("button", { name: "guide.md" });
  return { ...result, sidebar };
}

async function open(sidebar: HTMLElement, name: string) {
  fireEvent.click(within(sidebar).getByRole("button", { name }));
  return screen.findByRole("textbox", {
    name: `${name.endsWith(".md") ? "Markdown" : "Code"} body ${ROOT}/${name}`,
  });
}

describe("AppShell reading mode", () => {
  it("skips ordinary saves of clean reading pages and still saves an existing dirty draft", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { sidebar, adapter } = await setup();
    const body = await open(sidebar, "guide.md");
    fireEvent.click(readingButton("阅读"));
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await act(async () => Promise.resolve());
    expect(adapter.saveDocument).not.toHaveBeenCalled();
    fireEvent.click(readingButton("编辑"));
    fireEvent.change(body, { target: { value: "# Draft entered before reading" } });
    expect(screen.getByLabelText("未保存")).toBeVisible();
    fireEvent.click(readingButton("阅读"));
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    await waitFor(() => expect(adapter.saveDocument).toHaveBeenCalledOnce());
    expect(adapter.contents.get(GUIDE)).toBe("# Draft entered before reading");
    await waitFor(() => expect(screen.queryByLabelText("未保存")).not.toBeInTheDocument());
    expect(body).toHaveAttribute("readonly");
    expect(readingButton("阅读")).toHaveAttribute("aria-pressed", "true");
  });

  it("preserves the current source surface and dirty draft, and blocks surface shortcuts until editing resumes", async () => {
    const { sidebar, adapter } = await setup();
    const body = await open(sidebar, "guide.md");
    expect(readingButton("编辑")).toHaveAttribute("aria-pressed", "true");
    expect(body).toHaveAttribute("data-mode", "visual");
    expect(body).toHaveAttribute("data-read-only", "false");
    fireEvent.click(screen.getByRole("button", { name: "源码" }));
    expect(body).toHaveAttribute("data-mode", "source");
    fireEvent.change(body, { target: { value: "# Existing unsaved draft" } });
    expect(screen.getByLabelText("未保存")).toBeVisible();

    fireEvent.click(readingButton("阅读"));
    expect(readingButton("阅读")).toHaveAttribute("aria-pressed", "true");
    expect(readingButton("编辑")).toHaveAttribute("aria-pressed", "false");
    expect(body).toHaveAttribute("data-read-only", "true");
    expect(body).toHaveAttribute("readonly");
    expect(body).toHaveAttribute("data-typing-hints", "false");
    expect(body).toHaveAttribute("data-mode", "source");
    expect(body).toHaveValue("# Existing unsaved draft");
    expect(screen.getByLabelText("未保存")).toBeVisible();
    expect(screen.queryByRole("button", { name: "源码" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "/", ctrlKey: true });
    fireEvent.keyDown(window, { key: "/", metaKey: true });
    expect(body).toHaveAttribute("data-mode", "source");
    expect(adapter.saveDocument).not.toHaveBeenCalled();
    expect(adapter.contents.get(GUIDE)).toBe("# Guide\n\nOriginal note.\n");

    fireEvent.click(readingButton("编辑"));
    expect(screen.getByRole("textbox", { name: `Markdown body ${GUIDE}` })).toBe(body);
    expect(body).not.toHaveAttribute("readonly");
    expect(body).toHaveAttribute("data-mode", "source");
    expect(body).toHaveValue("# Existing unsaved draft");
    expect(screen.getByRole("button", { name: "源码" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "可视" }));
    expect(body).toHaveAttribute("data-mode", "visual");
  });

  it("applies reading to newly opened Markdown and code files and all editor groups", async () => {
    const { sidebar, container } = await setup();
    fireEvent.click(readingButton("阅读"));
    const guide = await open(sidebar, "guide.md");
    expect(guide).toHaveAttribute("data-read-only", "true");
    expect(guide).toHaveAttribute("data-mode", "visual");
    const tab = screen.getByRole("navigation", { name: "文档标签页" });
    fireEvent.contextMenu(within(tab).getByTitle(GUIDE), { clientX: 350, clientY: 80 });
    fireEvent.click(screen.getByRole("menuitem", { name: "向右分屏" }));
    const left = screen.getByRole("region", { name: "编辑分屏 1" });
    await screen.findByRole("navigation", { name: "分屏 2 的标签页" });
    expect(screen.getByRole("textbox", { name: `Markdown body ${GUIDE}` })).toBe(guide);
    fireEvent(left, new MouseEvent("pointerdown", { button: 0, bubbles: true }));
    const code = await open(sidebar, "example.txt");
    expect(code).toHaveAttribute("data-read-only", "true");
    expect(container.querySelectorAll(".editor-tab-panel")).toHaveLength(2);
    expect(guide).toHaveAttribute("readonly");
    expect(code).toHaveAttribute("readonly");
    const second = await open(sidebar, "second.md");
    expect(second).toHaveAttribute("data-read-only", "true");
    expect(screen.queryByLabelText("未保存")).not.toBeInTheDocument();
    fireEvent.click(readingButton("编辑"));
    expect(guide).toHaveAttribute("data-read-only", "false");
    expect(second).toHaveAttribute("data-read-only", "false");
    expect(guide).not.toHaveAttribute("readonly");
    expect(second).not.toHaveAttribute("readonly");
  });

  it("restores file and source-surface metadata on relaunch without persisting reading mode", async () => {
    const first = await setup();
    const body = await open(first.sidebar, "guide.md");
    fireEvent.click(screen.getByRole("button", { name: "源码" }));
    fireEvent.click(readingButton("阅读"));
    expect(body).toHaveAttribute("readonly");
    act(() => window.dispatchEvent(new Event("pagehide")));
    const snapshot = localStorage.getItem(SESSION_SNAPSHOT_STORAGE_KEY);
    expect(snapshot).toContain(GUIDE);
    expect(snapshot).not.toContain("readingMode");
    first.unmount();

    const second = mount();
    const restored = await screen.findByRole("textbox", { name: `Markdown body ${GUIDE}` });
    await waitFor(() => expect(second.adapter.openDocument).toHaveBeenCalledWith(GUIDE));
    expect(readingButton("编辑")).toHaveAttribute("aria-pressed", "true");
    expect(readingButton("阅读")).toHaveAttribute("aria-pressed", "false");
    expect(restored).toHaveAttribute("data-read-only", "false");
    expect(restored).toHaveAttribute("data-mode", "source");
    expect(restored).not.toHaveAttribute("readonly");
  });
});
