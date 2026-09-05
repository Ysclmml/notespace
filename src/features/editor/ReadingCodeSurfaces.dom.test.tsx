import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { CodeFilePreview } from "../code-preview/CodeFilePreview";
import { codeMirrorFindTarget } from "../find/codeMirrorFind";
import { MarkdownEditor } from "./MarkdownEditor";
import { installCodeMirrorDomMeasurementStubs } from "./spike/domTestSupport";

beforeAll(() => installCodeMirrorDomMeasurementStubs());

function surface(
  kind: "source" | "code",
  value: string,
  readOnly: boolean,
  onChange: (value: string) => void,
) {
  return kind === "source" ? (
    <MarkdownEditor
      documentId="/fixtures/reading.md"
      mode="sourceOnly"
      value={value}
      readOnly={readOnly}
      autofocus={false}
      onChange={onChange}
      findRequest={1}
    />
  ) : (
    <CodeFilePreview
      path="/fixtures/reading.txt"
      language="text"
      content={value}
      readOnly={readOnly}
      editable
      onChange={onChange}
      findRequest={1}
    />
  );
}

function viewIn(container: HTMLElement) {
  return EditorView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
}

describe.each(["source", "code"] as const)("%s reading mode", (kind) => {
  it("blocks typing, composition, paste, cut, drop and command mutations while keeping selection and find", async () => {
    const onChange = vi.fn();
    const value = "first 中文\nsecond 中文";
    const { container, getByRole, queryByRole } = render(
      surface(kind, value, true, onChange),
    );
    const view = viewIn(container);
    await waitFor(() =>
      expect(getByRole("textbox", { name: "当前页查找" })).toBeInTheDocument(),
    );
    expect(view.state.readOnly).toBe(true);
    expect(view.contentDOM).toHaveAttribute("contenteditable", "false");
    expect(view.contentDOM).toHaveAttribute("tabindex", "0");

    for (const type of ["beforeinput", "paste", "cut", "drop"]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      fireEvent(view.contentDOM, event);
      expect(event.defaultPrevented).toBe(true);
    }
    fireEvent.compositionStart(view.contentDOM);
    act(() => view.dispatch({ changes: { from: 0, insert: "误输入" }, filter: false }));
    fireEvent.compositionEnd(view.contentDOM);
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 0, head: 5 } });
    });
    fireEvent.keyDown(view.contentDOM, { key: "b", metaKey: true });
    fireEvent.keyDown(view.contentDOM, { key: "Backspace" });
    expect(view.state.doc.toString()).toBe(value);
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 5 });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(getByRole("textbox", { name: "当前页查找" }), {
      target: { value: "中文" },
    });
    await waitFor(() =>
      expect(container.querySelectorAll(".page-find-match")).toHaveLength(2),
    );
    expect(queryByRole("button", { name: "显示替换" })).not.toBeInTheDocument();
    expect(codeMirrorFindTarget(view).replace).toBeUndefined();
  });

  it("toggles on the same view, guards an old replace target, maps shared changes, and retains Undo/Redo", async () => {
    const onChange = vi.fn();
    const { container, rerender, queryByRole } = render(
      surface(kind, "first\nsecond", false, onChange),
    );
    const view = viewIn(container);
    await act(
      async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "!" } }));
    const staleTarget = codeMirrorFindTarget(view);
    act(() => view.dispatch({ selection: { anchor: 6, head: 12 } }));
    view.scrollDOM.scrollTop = 210;
    onChange.mockClear();
    rerender(surface(kind, "first\nsecond!", true, onChange));
    expect(viewIn(container)).toBe(view);
    expect(view.scrollDOM.scrollTop).toBe(210);
    expect(view.state.selection.main).toMatchObject({ from: 6, to: 12 });
    expect(staleTarget.replace?.([{ from: 0, to: 5 }], "oops")).toBe("readonly");
    act(() => undo(view));
    expect(view.state.doc.toString()).toBe("first\nsecond!");
    expect(onChange).not.toHaveBeenCalled();
    expect(queryByRole("button", { name: "显示替换" })).not.toBeInTheDocument();

    rerender(surface(kind, "new first\nsecond!", true, onChange));
    expect(view.state.doc.toString()).toBe("new first\nsecond!");
    expect(view.state.selection.main).toMatchObject({ from: 10, to: 16 });
    expect(view.scrollDOM.scrollTop).toBe(210);
    expect(onChange).not.toHaveBeenCalled();

    rerender(surface(kind, "new first\nsecond!", false, onChange));
    expect(viewIn(container)).toBe(view);
    act(() => expect(undo(view)).toBe(true));
    expect(view.state.doc.toString()).toBe("new first\nsecond");
    act(() => expect(redo(view)).toBe(true));
    expect(view.state.doc.toString()).toBe("new first\nsecond!");
  });

  it("finishes an existing IME draft before locking and accepts subsequent shared updates", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(surface(kind, "first\nsecond", false, onChange));
    const view = viewIn(container);
    fireEvent.compositionStart(view.contentDOM);
    rerender(surface(kind, "new first\nsecond", false, onChange));
    act(() => view.dispatch({ changes: { from: 6, insert: "中文" } }));
    expect(onChange).not.toHaveBeenCalled();

    rerender(surface(kind, "new first\nsecond", true, onChange));
    expect(view.state.doc.toString()).toBe("new first\n中文second");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith("new first\n中文second");
    onChange.mockClear();
    fireEvent.compositionEnd(view.contentDOM);
    act(() => view.dispatch({ changes: { from: 0, insert: "锁定后" } }));
    rerender(surface(kind, "latest first\n中文second", true, onChange));
    await act(
      async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    expect(view.state.doc.toString()).toBe("latest first\n中文second");
    expect(onChange).not.toHaveBeenCalled();
  });
});

it("discards a source image paste that completes after reading mode is enabled", async () => {
  let complete!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    complete = resolve;
  });
  const onImagePaste = vi.fn(() => pending);
  const onChange = vi.fn();
  const props = {
    documentId: "/fixtures/reading.md",
    mode: "sourceOnly" as const,
    value: "unchanged",
    autofocus: false,
    onChange,
    onImagePaste,
  };
  const { container, rerender } = render(<MarkdownEditor {...props} />);
  const view = viewIn(container);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: () => "",
      types: ["image/png"],
      items: [{ kind: "file", type: "image/png" }],
      files: [],
    },
  });
  fireEvent(view.contentDOM, event);
  expect(onImagePaste).toHaveBeenCalledOnce();
  rerender(<MarkdownEditor {...props} readOnly />);
  await act(async () => {
    complete("![test](./image.png)");
    await pending;
  });
  expect(view.state.doc.toString()).toBe("unchanged");
  expect(onChange).not.toHaveBeenCalled();
});

it("consumes a queued source image without inserting it in reading mode", async () => {
  const onChange = vi.fn();
  const onImageInsertConsumed = vi.fn();
  const props = {
    documentId: "/fixtures/reading.md",
    mode: "sourceOnly" as const,
    value: "unchanged",
    autofocus: false,
    onChange,
    onImageInsertConsumed,
    imageInsertRequest: {
      id: 1,
      documentId: "/fixtures/reading.md",
      editorMode: "source" as const,
      markdown: "![test](./image.png)",
      expectedText: "unchanged",
      selection: { from: 0, to: 0 },
    },
  };
  const { container, rerender } = render(<MarkdownEditor {...props} readOnly />);
  await waitFor(() => expect(onImageInsertConsumed).toHaveBeenCalledWith(1));
  rerender(<MarkdownEditor {...props} />);
  expect(viewIn(container).state.doc.toString()).toBe("unchanged");
  expect(onChange).not.toHaveBeenCalled();
});
