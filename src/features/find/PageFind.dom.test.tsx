import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { undo as undoCode } from "@codemirror/commands";
import { EditorView as CodeView } from "@codemirror/view";
import { undo as undoVisual } from "@milkdown/kit/prose/history";
import { EditorView as VisualView } from "@milkdown/kit/prose/view";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { CodeFilePreview } from "../code-preview/CodeFilePreview";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import { VisualMarkdownEditor } from "../editor/VisualMarkdownEditor";
import {
  installCodeMirrorDomMeasurementStubs,
  installImmediateIntersectionObserverStub,
} from "../editor/spike/domTestSupport";
import { codeFindDecorations } from "./codeMirrorFind";

beforeAll(() => {
  installCodeMirrorDomMeasurementStubs();
  installImmediateIntersectionObserverStub();
});

function expectReservedFindRow(container: HTMLElement) {
  const anchor = container.querySelector<HTMLElement>(".page-find-anchor")!;
  const bar = container.querySelector<HTMLElement>(".page-find")!;
  expect(getComputedStyle(anchor).position).toBe("relative");
  expect(getComputedStyle(anchor).flexShrink).toBe("0");
  expect(parseFloat(getComputedStyle(anchor).minHeight)).toBeGreaterThanOrEqual(60);
  expect(getComputedStyle(bar).position).toBe("relative");
}

describe("current-page find surfaces", () => {
  it("keeps a consumed request closed after its tab remounts and accepts a new request", () => {
    const consumed = vi.fn();
    const editor = (key: string, request: number) => (
      <CodeFilePreview
        key={key}
        path="/fixtures/remount.py"
        language="python"
        content="value = 1"
        findRequest={request}
        onFindRequestConsumed={consumed}
      />
    );
    const { rerender, getByRole, queryByRole } = render(editor("initial", 1));
    expect(consumed).toHaveBeenCalledExactlyOnceWith(1);
    rerender(editor("initial", 0));
    fireEvent.keyDown(getByRole("textbox", { name: "当前页查找" }), { key: "Escape" });
    rerender(editor("returned-tab", 0));
    expect(queryByRole("search")).toBeNull();
    rerender(editor("returned-tab", 2));
    expect(getByRole("textbox", { name: "当前页查找" })).toHaveFocus();
    expect(consumed).toHaveBeenLastCalledWith(2);
  });

  it.each(["source", "code", "readonly"] as const)(
    "finds literal CJK in %s, wraps and exits without dirtying or consuming Undo",
    async (surface) => {
      const onChange = vi.fn();
      const onFindRequestConsumed = vi.fn();
      const value = "first 中文\nsecond 中文\n";
      const renderEditor = (request: number) =>
        surface === "source" ? (
          <MarkdownEditor
            autofocus={false}
            documentId="/fixtures/find.md"
            findRequest={request}
            onFindRequestConsumed={onFindRequestConsumed}
            mode="normal"
            presentationMode="source"
            onChange={onChange}
            value={value}
          />
        ) : (
          <CodeFilePreview
            path="/fixtures/find.py"
            content={value}
            language="python"
            editable={surface !== "readonly"}
            findRequest={request}
            onFindRequestConsumed={onFindRequestConsumed}
            onChange={onChange}
          />
        );
      const { container, rerender, queryByRole, getByRole } = render(renderEditor(0));
      const view = await waitFor(() => {
        const element = container.querySelector<HTMLElement>(".cm-editor");
        expect(element).toBeTruthy();
        return CodeView.findFromDOM(element!)!;
      });
      const selection = view.state.selection;
      expect(queryByRole("search")).toBeNull();
      rerender(renderEditor(1));
      const input = getByRole("textbox", { name: "当前页查找" });
      expect(input).toHaveFocus();
      expectReservedFindRow(container);
      if (surface === "source") {
        const source = container.querySelector<HTMLElement>(".markdown-editor")!;
        const host = container.querySelector<HTMLElement>(".markdown-editor__source-host")!;
        expect(getComputedStyle(source).display).toBe("flex");
        expect(getComputedStyle(source).flexDirection).toBe("column");
        expect(getComputedStyle(host).minHeight).toBe("0");
      } else {
        const code = container.querySelector<HTMLElement>(".code-file-preview")!;
        const row = container.querySelector<HTMLElement>(".code-file-preview__find")!;
        expect(getComputedStyle(code).gridTemplateRows).toBe("46px auto minmax(0, 1fr)");
        expect(getComputedStyle(row).position).not.toBe("absolute");
      }
      expect(onFindRequestConsumed).toHaveBeenCalledExactlyOnceWith(1);
      rerender(renderEditor(0));
      expect(input).toHaveFocus();
      fireEvent.change(input, { target: { value: "中文" } });
      await waitFor(() =>
        expect(container.querySelector(".page-find__count")).toHaveTextContent("1/2"),
      );
      expect(view.state.field(codeFindDecorations).size).toBe(2);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(container.querySelector(".page-find__count")).toHaveTextContent("2/2");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(container.querySelector(".page-find__count")).toHaveTextContent("1/2");
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
      expect(container.querySelector(".page-find__count")).toHaveTextContent("2/2");
      expect(view.state.selection.eq(selection)).toBe(true);
      expect(view.state.doc.toString()).toBe(value);
      expect(onChange).not.toHaveBeenCalled();
      if (surface !== "readonly") expect(undoCode(view)).toBe(false);
      fireEvent.change(input, { target: { value: "absent" } });
      expect(container.querySelector(".page-find__count")).toHaveTextContent("无匹配项");
      expect(getByRole("button", { name: "下一个匹配" })).toBeDisabled();
      fireEvent.keyDown(input, { key: "Escape" });
      expect(queryByRole("search")).toBeNull();
      expect(container.querySelector(".page-find-anchor")).toBeNull();
      expect(view.state.field(codeFindDecorations).size).toBe(0);
      expect(view.hasFocus).toBe(true);
      rerender(renderEditor(2));
      expect(getByRole("textbox", { name: "当前页查找" })).toHaveFocus();
      expect(onFindRequestConsumed).toHaveBeenLastCalledWith(2);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("searches visual text across inline marks and embedded code, excludes URLs/UI and keeps panes isolated", async () => {
    const views = new Set<VisualView>();
    const originalUpdate = VisualView.prototype.updateState;
    vi.spyOn(VisualView.prototype, "updateState").mockImplementation(function (
      this: VisualView,
      state,
    ) {
      originalUpdate.call(this, state);
      views.add(this);
    });
    const onChange = vi.fn();
    const value =
      "# 中文标题\n\n中**文**正文 [中文链接](https://example.test/中文)\n\n```python\nvalue = '中文'\n```\n\n结尾\n";
    const { container } = render(
      <>
        <div data-testid="first-pane">
          <VisualMarkdownEditor
            autofocus={false}
            documentId="/fixtures/one.md"
            findRequest={1}
            value={value}
            onChange={onChange}
          />
        </div>
        <div data-testid="second-pane">
          <VisualMarkdownEditor
            autofocus={false}
            documentId="/fixtures/two.md"
            value="中文第二页"
            onChange={onChange}
          />
        </div>
      </>,
    );
    const first = container.querySelector<HTMLElement>('[data-testid="first-pane"]')!;
    const second = container.querySelector<HTMLElement>('[data-testid="second-pane"]')!;
    const view = await waitFor(() => {
      const found = [...views].find(
        (candidate) => candidate.dom === first.querySelector(".ProseMirror"),
      );
      expect(found).toBeTruthy();
      expect(first.querySelector(".cm-editor")).toBeTruthy();
      return found!;
    });
    const original = view.state.doc;
    const input = within(first).getByRole("textbox", { name: "当前页查找" });
    expectReservedFindRow(first);
    const frame = first.querySelector<HTMLElement>(".visual-markdown-editor-frame")!;
    const scroller = first.querySelector<HTMLElement>(".visual-markdown-editor")!;
    expect(scroller.querySelector(".page-find-anchor")).toBeNull();
    expect(scroller.previousElementSibling).toHaveClass("page-find-anchor");
    expect(getComputedStyle(frame).display).toBe("flex");
    expect(getComputedStyle(frame).flexDirection).toBe("column");
    expect(getComputedStyle(scroller).minHeight).toBe("0");
    fireEvent.change(input, { target: { value: "中文" } });
    await waitFor(() =>
      expect(first.querySelector(".page-find__count")).toHaveTextContent("1/4"),
    );
    expect(second.querySelector(".page-find")).toBeNull();
    expect(second.querySelector(".page-find-match")).toBeNull();
    const code = CodeView.findFromDOM(first.querySelector<HTMLElement>(".cm-editor")!)!;
    expect(code.state.field(codeFindDecorations).size).toBe(1);
    for (let index = 0; index < 3; index++) fireEvent.keyDown(input, { key: "Enter" });
    expect(first.querySelector(".page-find__count")).toHaveTextContent("4/4");
    expect(first.querySelector(".cm-editor .page-find-match--current")).toHaveTextContent(
      "中文",
    );
    expect(view.state.doc.eq(original)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(undoVisual(view.state, view.dispatch)).toBe(false);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(frame.querySelector(".page-find-anchor")).toBeNull();
    expect(first.querySelector(".page-find-match")).toBeNull();
    expect(code.state.field(codeFindDecorations).size).toBe(0);
    expect(view.hasFocus()).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("refreshes code match counts after real edits, leaving one normal Undo step", async () => {
    const onChange = vi.fn();
    const { container, getByRole } = render(
      <CodeFilePreview
        path="/fixtures/edit.txt"
        language="text"
        content="中文"
        editable
        findRequest={1}
        onChange={onChange}
      />,
    );
    const input = getByRole("textbox", { name: "当前页查找" });
    fireEvent.change(input, { target: { value: "中文" } });
    expect(container.querySelector(".page-find__count")).toHaveTextContent("1/1");
    const view = CodeView.findFromDOM(container.querySelector<HTMLElement>(".cm-editor")!)!;
    act(() => view.dispatch({ changes: { from: 2, insert: " 中文" } }));
    expect(container.querySelector(".page-find__count")).toHaveTextContent("1/2");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("中文 中文");
    act(() => {
      expect(undoCode(view)).toBe(true);
    });
    expect(view.state.doc.toString()).toBe("中文");
    expect(container.querySelector(".page-find__count")).toHaveTextContent("1/1");
  });
});
