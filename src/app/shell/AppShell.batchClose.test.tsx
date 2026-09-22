import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeAll, expect, it, vi } from "vitest";
import {
  DemoDesktopAdapter,
  type DesktopAdapter,
  type OpenDocumentResult,
} from "../../infrastructure/tauri/desktopAdapter";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "../../features/editor/spike/domTestSupport";
import { AppSettingsProvider } from "../settings";
import { AppShell } from "./AppShell";

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

class BatchAdapter extends DemoDesktopAdapter {
  readonly files = new Map(["a", "b", "c"].map((name) => [`/batch/${name}.txt`, name]));
  override async pickWorkspace() {
    return { path: "/batch", name: "Batch fixtures" };
  }
  override async listWorkspace() {
    return [...this.files.keys()].map((path) => ({
      path,
      name: path.split("/").pop()!,
      relativePath: path.split("/").pop()!,
      kind: "text" as const,
    }));
  }
  override async openDocument(path: string): Promise<OpenDocumentResult> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error("Missing fixture");
    return {
      status: "editable",
      path,
      content,
      mode: "normal",
      documentKind: "text",
      language: "text",
      preflight: {
        sizeBytes: content.length,
        longestLineBytes: content.length,
        containsDataImageBase64: false,
      },
    };
  }
  override async saveDocument(path: string, content: string) {
    this.files.set(path, content);
    return { path, bytesWritten: content.length };
  }
}

async function setup(dirty = true) {
  const adapter = new BatchAdapter();
  const result = render(
    <AppSettingsProvider initialSettings={{ locale: "zh-CN" }} storage={null}>
      <AppShell adapter={adapter} />
    </AppSettingsProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "打开演示工作区" }));
  const sidebar = screen.getByRole("complementary", { name: "工作区侧栏" });
  const views: EditorView[] = [];
  for (const name of ["a", "b", "c"]) {
    fireEvent.doubleClick(
      await within(sidebar).findByRole("button", { name: `${name}.txt` }),
    );
    const view = await waitFor(() => {
      const found = [...result.container.querySelectorAll<HTMLElement>(".cm-editor")]
        .map((el) => EditorView.findFromDOM(el))
        .find((v) => v?.state.doc.toString() === name);
      if (!found) throw new Error("Editor not ready");
      return found;
    });
    if (dirty) act(() => view.dispatch({ changes: { from: 1, insert: " edited" } }));
    views.push(view);
  }
  return { ...result, adapter, views, sidebar };
}

function tab(name: string) {
  return screen
    .getByRole("navigation", { name: "文档标签页" })
    .querySelector<HTMLElement>(`.tab-rail__tab[title="/batch/${name}.txt"]`)!;
}
function closeMenu(action = "关闭全部标签页", name = "b") {
  fireEvent.contextMenu(tab(name), { clientX: 300, clientY: 80 });
  fireEvent.click(screen.getByRole("menuitem", { name: action }));
}
function dialog() {
  return screen.getByRole("alertdialog", { name: "有未保存的更改" });
}
function button(name: string) {
  return within(dialog()).getByRole("button", { name });
}
function remaining() {
  return [...document.querySelectorAll(".tab-rail__tab")].map((el) =>
    el.getAttribute("title"),
  );
}

it.each([
  ["关闭左侧标签页", ["b", "c"]],
  ["关闭右侧标签页", ["a", "b"]],
  ["关闭全部标签页", []],
] as const)(
  "%s closes the requested clean tabs without confirmation",
  async (action, names) => {
    await setup(false);
    closeMenu(action);
    expect(remaining()).toEqual(names.map((name) => `/batch/${name}.txt`));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  },
);

it("cancels the entire batch without saving or closing any tab", async () => {
  const { adapter } = await setup();
  const save = vi.spyOn(adapter, "saveDocument");
  closeMenu();
  expect(within(dialog()).getByText("a.txt")).toBeVisible();
  fireEvent.click(button("取消"));
  expect(remaining()).toHaveLength(3);
  expect(save).not.toHaveBeenCalled();
});

it("saves only the requested side and closes after every save succeeds", async () => {
  const { adapter } = await setup();
  const save = vi.spyOn(adapter, "saveDocument");
  closeMenu("关闭左侧标签页", "c");
  fireEvent.click(button("全部保存并关闭"));
  await waitFor(() => expect(remaining()).toEqual(["/batch/c.txt"]));
  expect(save.mock.calls).toEqual([
    ["/batch/a.txt", "a edited"],
    ["/batch/b.txt", "b edited"],
  ]);
  expect(adapter.files.get("/batch/c.txt")).toBe("c");
});

it("reviews each file, preserving skipped text if the user cancels later", async () => {
  const { adapter, views } = await setup();
  closeMenu();
  fireEvent.click(button("逐个处理…"));
  expect(within(dialog()).getByText("当前文件：/batch/a.txt")).toBeVisible();
  fireEvent.click(button("不保存此文件"));
  fireEvent.click(button("保存此文件"));
  await waitFor(() =>
    expect(within(dialog()).getByText("当前文件：/batch/c.txt")).toBeVisible(),
  );
  fireEvent.click(button("取消"));
  expect(remaining()).toHaveLength(3);
  expect(views[0]!.state.doc.toString()).toBe("a edited");
  expect(adapter.files.get("/batch/a.txt")).toBe("a");
  expect(adapter.files.get("/batch/b.txt")).toBe("b edited");
  closeMenu();
  expect(within(dialog()).getByText("a.txt")).toBeVisible();
  expect(within(dialog()).queryByText("b.txt")).toBeNull();
  fireEvent.click(button("全部保存并关闭"));
  await waitFor(() => expect(remaining()).toHaveLength(0));
});

it("keeps every tab when a later save fails, and can retry the remaining files", async () => {
  const { adapter } = await setup();
  const save = vi.spyOn(adapter, "saveDocument");
  save
    .mockImplementationOnce(async (path, content) => {
      adapter.files.set(path, content);
      return { path, bytesWritten: content.length };
    })
    .mockRejectedValueOnce(new Error("Disk full"));
  closeMenu();
  fireEvent.click(button("全部保存并关闭"));
  expect(await within(dialog()).findByRole("alert")).toHaveTextContent("Disk full");
  expect(remaining()).toHaveLength(3);
  expect(adapter.files.get("/batch/a.txt")).toBe("a edited");
  expect(adapter.files.get("/batch/c.txt")).toBe("c");
  fireEvent.click(button("全部保存并关闭"));
  await waitFor(() => expect(remaining()).toHaveLength(0));
  expect(save.mock.calls.map(([path]) => path)).toEqual([
    "/batch/a.txt",
    "/batch/b.txt",
    "/batch/b.txt",
    "/batch/c.txt",
  ]);
});

it("closes after every file is reviewed without writing files marked not to save", async () => {
  const { adapter } = await setup();
  const save = vi.spyOn(adapter, "saveDocument");
  closeMenu();
  fireEvent.click(button("逐个处理…"));
  fireEvent.click(button("不保存此文件"));
  fireEvent.click(button("保存此文件"));
  await waitFor(() => expect(button("保存此文件")).toBeEnabled());
  expect(remaining()).toHaveLength(3);
  fireEvent.click(button("不保存此文件"));
  expect(remaining()).toHaveLength(0);
  expect(save.mock.calls).toEqual([["/batch/b.txt", "b edited"]]);
  expect(adapter.files.get("/batch/a.txt")).toBe("a");
  expect(adapter.files.get("/batch/c.txt")).toBe("c");
});

it("stops on an external save conflict without discarding or overwriting other files", async () => {
  const { adapter } = await setup();
  const save = vi
    .spyOn(adapter, "saveDocument")
    .mockRejectedValueOnce({ code: "externalChange" });
  closeMenu();
  fireEvent.click(button("全部保存并关闭"));
  expect(await within(dialog()).findByRole("alert")).toBeVisible();
  expect(remaining()).toHaveLength(3);
  expect(save).toHaveBeenCalledTimes(1);
  expect([...adapter.files.values()]).toEqual(["a", "b", "c"]);
  fireEvent.click(button("取消"));
  expect(remaining()).toHaveLength(3);
});

it("does not close a document edited again while its save is pending", async () => {
  const { adapter, container } = await setup();
  fireEvent.click(tab("a"));
  const view = await waitFor(() => {
    const found = [...container.querySelectorAll<HTMLElement>(".cm-editor")]
      .map((el) => EditorView.findFromDOM(el))
      .find((v) => v?.state.doc.toString() === "a edited");
    if (!found) throw new Error("Active editor not ready");
    return found;
  });
  let finish!: () => void;
  vi.spyOn(adapter, "saveDocument").mockImplementationOnce(async (path, content) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    adapter.files.set(path, content);
    return { path, bytesWritten: content.length };
  });
  closeMenu();
  fireEvent.click(button("全部保存并关闭"));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(button("正在保存…")).toBeDisabled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(dialog()).toBeVisible();
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: " later" } }));
  await act(async () => finish());
  expect(await within(dialog()).findByRole("alert")).toBeVisible();
  expect(remaining()).toHaveLength(3);
  expect(view.state.doc.toString()).toBe("a edited later");
});

it("handles cancelled Save As and a later successful path migration before closing", async () => {
  const { adapter, container } = await setup(false);
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "新建文本文件" }));
  const view = await waitFor(() => {
    const v = [...container.querySelectorAll<HTMLElement>(".cm-editor")]
      .map((el) => EditorView.findFromDOM(el))
      .find((v) => v?.state.doc.length === 0);
    if (!v) throw new Error("Untitled editor not ready");
    return v;
  });
  act(() => view.dispatch({ changes: { from: 0, insert: "new draft" } }));
  const saveAs = vi
    .spyOn(adapter as DesktopAdapter, "saveDocumentAs")
    .mockResolvedValueOnce(null)
    .mockImplementationOnce(async (_name, content) => {
      adapter.files.set("/batch/saved.txt", content);
      return { path: "/batch/saved.txt", bytesWritten: content.length };
    });
  closeMenu();
  fireEvent.click(button("全部保存并关闭"));
  expect(await within(dialog()).findByRole("alert")).toBeVisible();
  expect(remaining()).toHaveLength(4);
  fireEvent.click(button("全部保存并关闭"));
  await waitFor(() => expect(remaining()).toHaveLength(0));
  expect(saveAs).toHaveBeenCalledTimes(2);
  expect(adapter.files.get("/batch/saved.txt")).toBe("new draft");
});
