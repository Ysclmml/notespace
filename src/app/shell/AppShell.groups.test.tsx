import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  DemoDesktopAdapter,
  type OpenDocumentResult,
  type WorkspaceNode,
} from "../../infrastructure/tauri/desktopAdapter";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "../../features/editor/spike/domTestSupport";
import { WORKSPACE_HISTORY_STORAGE_KEY } from "../../features/workspace/workspaceHistory";
import { TAB_DRAG_MIME } from "../../features/editor-groups/EditorGroupTabs";
import { AppSettingsProvider } from "../settings";
import { AppShell } from "./AppShell";

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

afterEach(() => {
  localStorage.removeItem(WORKSPACE_HISTORY_STORAGE_KEY);
  vi.restoreAllMocks();
});

const fixtureContents = new Map([
  ["/group-fixtures/alpha.json", '{"title":"alpha","enabled":true}\n'],
  ["/group-fixtures/beta.json", '{"title":"beta","count":2}\n'],
  ["/group-fixtures/gamma.json", '{"title":"gamma","count":3}\n'],
  ["/group-fixtures/delta.json", '{"title":"delta","count":4}\n'],
  ["/group-fixtures/guide.md", "# Group guide\n\nA synthetic Markdown note.\n"],
]);

class GroupFixtureAdapter extends DemoDesktopAdapter {
  readonly delayedPaths = new Set<string>();
  readonly pending: Array<{ path: string; resolve: () => void }> = [];

  override async pickWorkspace() {
    return { path: "/group-fixtures", name: "Group fixtures" };
  }

  override async listWorkspace(): Promise<readonly WorkspaceNode[]> {
    return Array.from(fixtureContents.keys(), (path) => ({
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      relativePath: path.slice(path.lastIndexOf("/") + 1),
      kind: path.endsWith(".md") ? "markdown" : "text",
    }));
  }

  override async openDocument(path: string): Promise<OpenDocumentResult> {
    if (this.delayedPaths.has(path)) {
      await new Promise<void>((resolve) => this.pending.push({ path, resolve }));
    }
    const content = fixtureContents.get(path);
    if (content === undefined) throw new Error("Missing synthetic fixture");
    const markdown = path.endsWith(".md");
    return {
      status: "editable",
      path,
      content,
      mode: "normal",
      documentKind: markdown ? "markdown" : "text",
      language: markdown ? "markdown" : "json",
      preflight: {
        sizeBytes: content.length,
        longestLineBytes: content.length,
        containsDataImageBase64: false,
      },
    };
  }
}

async function setup(adapter = new GroupFixtureAdapter()) {
  const result = render(
    <AppSettingsProvider initialSettings={{ locale: "zh-CN" }} storage={null}>
      <AppShell adapter={adapter} />
    </AppSettingsProvider>,
  );
  expect(result.container.querySelectorAll(".editor-tab-panel")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
  const sidebar = screen.getByRole("complementary", { name: "工作区侧栏" });
  await within(sidebar).findByRole("button", { name: "alpha.json" });
  return { ...result, adapter, sidebar };
}

function panel(index: number): HTMLElement {
  return screen.getByRole("region", { name: `编辑分屏 ${index}` });
}

function rail(index?: number): HTMLElement {
  return screen.getByRole("navigation", {
    name: index ? `分屏 ${index} 的标签页` : "文档标签页",
  });
}

function tab(name: string, index?: number): HTMLElement {
  return within(rail(index)).getByTitle(`/group-fixtures/${name}`);
}

function tabRow(name: string, index?: number): HTMLElement {
  const row = tab(name, index).closest<HTMLElement>(".tab-rail__item");
  if (!row) throw new Error("Tab row missing");
  return row;
}

async function openTree(sidebar: HTMLElement, name: string, index?: number) {
  fireEvent.click(within(sidebar).getByRole("button", { name }));
  return within(rail(index)).findByTitle(`/group-fixtures/${name}`);
}

async function editorView(index: number): Promise<EditorView> {
  return waitFor(() => {
    const mounted = panel(index).querySelector<HTMLElement>(".cm-editor");
    if (!mounted) throw new Error("CodeMirror has not mounted");
    const view = EditorView.findFromDOM(mounted);
    if (!view) throw new Error("CodeMirror view missing");
    return view;
  });
}

async function split(name: string, index?: number) {
  fireEvent.contextMenu(tab(name, index), { clientX: 350, clientY: 80 });
  fireEvent.click(screen.getByRole("menuitem", { name: "向右分屏" }));
  await screen.findByRole("navigation", { name: "分屏 2 的标签页" });
  // Split now moves, so explicitly open a second view for shared-session tests.
  fireEvent(panel(1), new MouseEvent("pointerdown", { button: 0, bubbles: true }));
  fireEvent.doubleClick(
    within(screen.getByRole("complementary", { name: "工作区侧栏" })).getByRole("button", {
      name,
    }),
  );
  await within(rail(1)).findByTitle(`/group-fixtures/${name}`);
  fireEvent.click(tab(name, 2));
}

function focus(view: EditorView) {
  act(() => view.focus());
}

function append(view: EditorView, value: string) {
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: value } }));
}

function drag(
  target: HTMLElement,
  type: "dragStart" | "dragOver" | "drop",
  dataTransfer: object,
) {
  const event = createEvent[type](target, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  fireEvent(target, event);
}

describe("AppShell editor groups and preview tabs", () => {
  it("finds only in the focused group and consumes closed requests across tab switches", async () => {
    const { sidebar } = await setup();
    await openTree(sidebar, "alpha.json");
    await split("alpha.json");
    focus(await editorView(2));
    fireEvent.keyDown(window, { key: "f", metaKey: true });
    const search = await within(panel(2)).findByRole("search", { name: "当前页查找" });
    expect(within(panel(1)).queryByRole("search")).toBeNull();
    fireEvent.change(within(search).getByRole("textbox"), { target: { value: "title" } });
    await within(search).findByText("1/1");
    expect(tabRow("alpha.json", 2)).not.toHaveTextContent("●");
    fireEvent.click(within(search).getByRole("button", { name: "关闭查找" }));
    await openTree(sidebar, "beta.json", 2);
    fireEvent.click(tab("alpha.json", 2));
    await editorView(2);
    expect(within(panel(2)).queryByRole("search")).toBeNull();
    focus(await editorView(1));
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    await within(panel(1)).findByRole("search", { name: "当前页查找" });
    expect(within(panel(2)).queryByRole("search")).toBeNull();
  });
  it("moves a sole tab to the right without duplicating its live editor, leaving an empty left group", async () => {
    const { sidebar, container } = await setup();
    await openTree(sidebar, "alpha.json");
    const originalId = panel(1).dataset.tabId;
    const originalView = await editorView(1);
    append(originalView, "unsaved moving text");
    fireEvent.contextMenu(tab("alpha.json"), { clientX: 350, clientY: 80 });
    fireEvent.click(screen.getByRole("menuitem", { name: "向右分屏" }));
    await within(rail(2)).findByTitle("/group-fixtures/alpha.json");
    expect(within(rail(1)).queryByTitle("/group-fixtures/alpha.json")).toBeNull();
    expect(panel(2)).toHaveAttribute("data-tab-id", originalId);
    expect(await editorView(2)).toBe(originalView);
    expect(originalView.state.doc.toString()).toContain("unsaved moving text");
    expect(container.querySelectorAll(".tab-rail__item")).toHaveLength(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent(panel(1), new MouseEvent("pointerdown", { button: 0, bubbles: true }));
    await openTree(sidebar, "beta.json", 1);
    fireEvent.contextMenu(tab("beta.json", 1), { clientX: 350, clientY: 80 });
    fireEvent.click(screen.getByRole("menuitem", { name: "向右分屏" }));
    // Reuse the right group, not a third column. The left source can collapse.
    expect(container.querySelectorAll(".editor-group-header").length).toBeLessThanOrEqual(
      2,
    );
    expect(container.querySelectorAll(".tab-rail__item")).toHaveLength(2);
  });
  it("single-clicks replace one italic preview and double-clicking the tab keeps it", async () => {
    const { sidebar, container } = await setup();
    await openTree(sidebar, "alpha.json");
    const originalId = panel(1).dataset.tabId;
    expect(tabRow("alpha.json")).toHaveClass("tab-rail__item--preview");
    await openTree(sidebar, "beta.json");
    expect(panel(1).dataset.tabId).toBe(originalId);
    expect(within(rail()).queryByTitle("/group-fixtures/alpha.json")).toBeNull();
    expect(rail().querySelectorAll(".tab-rail__item")).toHaveLength(1);
    expect(tabRow("beta.json")).toHaveClass("tab-rail__item--preview");
    fireEvent.doubleClick(tab("beta.json"));
    expect(tabRow("beta.json")).not.toHaveClass("tab-rail__item--preview");
    await openTree(sidebar, "gamma.json");
    expect(rail().querySelectorAll(".tab-rail__item")).toHaveLength(2);
    expect(tabRow("gamma.json")).toHaveClass("tab-rail__item--preview");
    expect(container.querySelectorAll(".editor-tab-panel")).toHaveLength(1);
  });

  it("double-clicks a Markdown tree item into a permanent tab while later previews stay separate", async () => {
    const { sidebar } = await setup();
    const file = within(sidebar).getByRole("button", { name: "guide.md" });
    fireEvent.click(file);
    fireEvent.doubleClick(file);
    await within(rail()).findByTitle("/group-fixtures/guide.md");
    await within(panel(1)).findByRole("heading", { name: "Group guide" });
    expect(tabRow("guide.md")).not.toHaveClass("tab-rail__item--preview");
    await openTree(sidebar, "alpha.json");
    expect(tab("guide.md")).toBeVisible();
    expect(tabRow("alpha.json")).toHaveClass("tab-rail__item--preview");
  });

  it("editing a preview pins it and retains its dirty text when another tree file opens", async () => {
    const { sidebar } = await setup();
    await openTree(sidebar, "alpha.json");
    const view = await editorView(1);
    append(view, "changed");
    await waitFor(() =>
      expect(within(tabRow("alpha.json")).getByLabelText("未保存")).toBeVisible(),
    );
    expect(tabRow("alpha.json")).not.toHaveClass("tab-rail__item--preview");
    await openTree(sidebar, "beta.json");
    expect(tab("alpha.json")).toBeVisible();
    fireEvent.click(tab("alpha.json"));
    const reopened = await editorView(1);
    await waitFor(() => expect(reopened.state.doc.toString()).toContain("changed"));
    fireEvent.click(within(rail()).getByRole("button", { name: "关闭 alpha.json" }));
    expect(
      await screen.findByRole("alertdialog", { name: "有未保存的更改" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(tab("alpha.json")).toBeVisible();
  });

  it("splits a shared file, synchronizes edits, and prompts only when closing its last reference", async () => {
    const { sidebar, container } = await setup();
    await openTree(sidebar, "alpha.json");
    await split("alpha.json");
    expect(container.querySelectorAll(".editor-tab-panel")).toHaveLength(2);
    expect(tabRow("alpha.json", 1)).not.toHaveClass("tab-rail__item--preview");
    expect(tabRow("alpha.json", 2)).not.toHaveClass("tab-rail__item--preview");
    const left = await editorView(1);
    const right = await editorView(2);
    expect(left).not.toBe(right);
    focus(right);
    append(right, "shared edit");
    await waitFor(() => expect(left.state.doc.toString()).toBe(right.state.doc.toString()));
    expect(left.state.doc.toString()).toContain("shared edit");
    expect(within(tabRow("alpha.json", 1)).getByLabelText("未保存")).toBeVisible();
    expect(within(tabRow("alpha.json", 2)).getByLabelText("未保存")).toBeVisible();
    fireEvent.click(within(rail(2)).getByRole("button", { name: "关闭 alpha.json" }));
    await waitFor(() =>
      expect(container.querySelectorAll(".editor-tab-panel")).toHaveLength(1),
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(within(rail()).getByRole("button", { name: "关闭 alpha.json" }));
    const dialog = await screen.findByRole("alertdialog", { name: "有未保存的更改" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(tab("alpha.json")).toBeVisible();
    fireEvent.click(within(rail()).getByRole("button", { name: "关闭 alpha.json" }));
    fireEvent.click(await screen.findByRole("button", { name: "放弃更改并关闭标签页" }));
    await screen.findByRole("heading", { name: "把本地文档，当作可以编辑的浏览器。" });
    expect(container.querySelectorAll(".editor-tab-panel")).toHaveLength(1);
    await openTree(sidebar, "alpha.json");
    const reopened = await editorView(1);
    expect(reopened.state.doc.toString()).toBe(
      fixtureContents.get("/group-fixtures/alpha.json"),
    );
    expect(tabRow("alpha.json")).toHaveClass("tab-rail__item--preview");
    expect(within(tabRow("alpha.json")).queryByLabelText("未保存")).toBeNull();
  });

  it("keeps Markdown surfaces independent while source edits update the other split's visual document", async () => {
    const { sidebar } = await setup();
    await openTree(sidebar, "guide.md");
    await within(panel(1)).findByRole("heading", { name: "Group guide" });
    await split("guide.md");
    await within(panel(2)).findByRole("heading", { name: "Group guide" });
    expect(panel(1).querySelector(".ProseMirror")).toBeTruthy();
    expect(panel(2).querySelector(".ProseMirror")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "源码" }));
    const source = await editorView(2);
    expect(panel(1).querySelector(".ProseMirror")).toBeTruthy();
    expect(panel(2).querySelector(".ProseMirror")).toBeNull();
    append(source, "\n\nShared Markdown update.\n");
    await within(panel(1)).findByText("Shared Markdown update.");
    expect(within(tabRow("guide.md", 1)).getByLabelText("未保存")).toBeVisible();
    expect(within(tabRow("guide.md", 2)).getByLabelText("未保存")).toBeVisible();
  });

  it("routes tree previews to whichever editor group was focused without replacing another group's page", async () => {
    const { sidebar } = await setup();
    await openTree(sidebar, "alpha.json");
    await split("alpha.json");
    await openTree(sidebar, "beta.json", 2);
    const left = await editorView(1);
    focus(left);
    expect(panel(1)).toHaveAttribute("data-focused", "true");
    await openTree(sidebar, "gamma.json", 1);
    expect(tab("beta.json", 2)).toHaveAttribute("aria-current", "page");
    expect(tab("gamma.json", 1)).toHaveAttribute("aria-current", "page");
    const right = await editorView(2);
    focus(right);
    expect(panel(2)).toHaveAttribute("data-focused", "true");
    await openTree(sidebar, "delta.json", 2);
    expect(within(rail(2)).queryByTitle("/group-fixtures/beta.json")).toBeNull();
    expect(tab("gamma.json", 1)).toHaveAttribute("aria-current", "page");
    expect((await editorView(1)).state.doc.toString()).toContain("gamma");
    expect((await editorView(2)).state.doc.toString()).toContain("delta");
  });

  it("moves a dirty tab through its menu, removes its empty group, and preserves the live editor", async () => {
    const { sidebar, container } = await setup();
    await openTree(sidebar, "alpha.json");
    await split("alpha.json");
    const movedId = panel(2).dataset.tabId;
    const movingView = await editorView(2);
    append(movingView, "not saved");
    fireEvent.contextMenu(tab("alpha.json", 2), { clientX: 700, clientY: 80 });
    fireEvent.click(screen.getByRole("menuitem", { name: "移到分屏 1" }));
    await waitFor(() =>
      expect(container.querySelectorAll(".editor-tab-panel")).toHaveLength(1),
    );
    expect(panel(1)).toHaveAttribute("data-tab-id", movedId);
    expect(rail().querySelectorAll(".tab-rail__item")).toHaveLength(2);
    expect(rail().querySelectorAll(".tab-rail__dirty")).toHaveLength(2);
    const movedView = await editorView(1);
    expect(movedView).toBe(movingView);
    expect(movedView.state.doc.toString()).toContain("not saved");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("drags a preview between tab rails, fixing it and keeping each group's current page", async () => {
    const { sidebar } = await setup();
    await openTree(sidebar, "alpha.json");
    await split("alpha.json");
    await openTree(sidebar, "beta.json", 2);
    const movingId = panel(2).dataset.tabId;
    const data = new Map<string, string>();
    const dataTransfer = {
      get types() {
        return Array.from(data.keys());
      },
      getData: (type: string) => data.get(type) ?? "",
      setData: (type: string, value: string) => {
        data.set(type, value);
      },
      effectAllowed: "none",
      dropEffect: "none",
    };
    drag(tabRow("beta.json", 2), "dragStart", dataTransfer);
    expect(data.get(TAB_DRAG_MIME)).toBe(movingId);
    drag(rail(1), "dragOver", dataTransfer);
    drag(rail(1), "drop", dataTransfer);
    await within(rail(1)).findByTitle("/group-fixtures/beta.json");
    expect(tabRow("beta.json", 1)).not.toHaveClass("tab-rail__item--preview");
    expect(within(rail(2)).queryByTitle("/group-fixtures/beta.json")).toBeNull();
    expect(tab("alpha.json", 2)).toHaveAttribute("aria-current", "page");
    expect(panel(1)).toHaveAttribute("data-tab-id", movingId);
  });

  it("lets an asynchronous tree double-click win over its earlier single-click preview request", async () => {
    const adapter = new GroupFixtureAdapter();
    adapter.delayedPaths.add("/group-fixtures/alpha.json");
    const { sidebar } = await setup(adapter);
    const file = within(sidebar).getByRole("button", { name: "alpha.json" });
    fireEvent.click(file);
    fireEvent.doubleClick(file);
    await waitFor(() => expect(adapter.pending).toHaveLength(2));
    await act(async () => adapter.pending[1]!.resolve());
    await within(rail()).findByTitle("/group-fixtures/alpha.json");
    expect(tabRow("alpha.json")).not.toHaveClass("tab-rail__item--preview");
    await act(async () => adapter.pending[0]!.resolve());
    expect(rail().querySelectorAll(".tab-rail__item")).toHaveLength(1);
    expect(tabRow("alpha.json")).not.toHaveClass("tab-rail__item--preview");
  });

  it("keeps the destination captured before file I/O when the user focuses another group", async () => {
    const adapter = new GroupFixtureAdapter();
    const { sidebar } = await setup(adapter);
    await openTree(sidebar, "alpha.json");
    await split("alpha.json");
    const leftId = panel(1).dataset.editorGroupId;
    const rightId = panel(2).dataset.editorGroupId;
    const left = await editorView(1);
    const right = await editorView(2);
    focus(left);
    adapter.delayedPaths.add("/group-fixtures/beta.json");
    fireEvent.click(within(sidebar).getByRole("button", { name: "beta.json" }));
    await waitFor(() => expect(adapter.pending).toHaveLength(1));
    focus(right);
    expect(panel(2)).toHaveAttribute("data-focused", "true");
    await act(async () => adapter.pending[0]!.resolve());
    await within(rail(1)).findByTitle("/group-fixtures/beta.json");
    expect(panel(1)).toHaveAttribute("data-editor-group-id", leftId);
    expect(panel(2)).toHaveAttribute("data-editor-group-id", rightId);
    expect(tab("alpha.json", 2)).toHaveAttribute("aria-current", "page");
    expect(within(rail(2)).queryByTitle("/group-fixtures/beta.json")).toBeNull();
  });
});
